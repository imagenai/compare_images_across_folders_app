import io
import os
from functools import lru_cache
from flask import Flask, render_template, request, jsonify, send_from_directory, send_file, abort, make_response
from PIL import Image
import tifffile

app = Flask(__name__)

IMAGE_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.webp',
    '.tiff', '.tif', '.bmp', '.svg',
}

# Formats that browsers cannot display natively — convert before serving
NEEDS_CONVERSION = {'.tiff', '.tif', '.bmp'}

# Maximum number of converted images to keep in cache
CONVERSION_CACHE_SIZE = 256

# Max pixel dimension (longest side) for converted images — 0 means no limit
MAX_RESOLUTION = 3000


def is_image_file(filename):
    _, ext = os.path.splitext(filename)
    return ext.lower() in IMAGE_EXTENSIONS


def list_images_in_folder(folder_path):
    """Return a sorted list of image filenames in the given folder."""
    try:
        return sorted(
            f for f in os.listdir(folder_path)
            if os.path.isfile(os.path.join(folder_path, f)) and is_image_file(f)
        )
    except OSError:
        return []


def get_image_stems(folder_path):
    """Return a set of image stems (filenames without extension) in the folder."""
    stems = set()
    try:
        for f in os.listdir(folder_path):
            if os.path.isfile(os.path.join(folder_path, f)) and is_image_file(f):
                stems.add(os.path.splitext(f)[0])
    except OSError:
        pass
    return stems


def find_image_by_stem(folder_path, stem):
    """Find the actual filename for an image stem in a folder."""
    try:
        for f in os.listdir(folder_path):
            if os.path.isfile(os.path.join(folder_path, f)) and is_image_file(f):
                if os.path.splitext(f)[0] == stem:
                    return f
    except OSError:
        pass
    return None


def find_image_by_stem_fuzzy(folder_path, stem):
    """Find the best matching image using containment-based stem matching.

    Priority: exact > file stem contains query (shortest) > query contains file stem (longest).
    """
    best_contains = None
    best_contains_len = float('inf')
    best_contained = None
    best_contained_len = 0

    try:
        for f in os.listdir(folder_path):
            if not (os.path.isfile(os.path.join(folder_path, f)) and is_image_file(f)):
                continue
            file_stem = os.path.splitext(f)[0]

            if file_stem == stem:
                return f

            if stem in file_stem and len(file_stem) < best_contains_len:
                best_contains = f
                best_contains_len = len(file_stem)
            elif file_stem in stem and len(file_stem) > best_contained_len:
                best_contained = f
                best_contained_len = len(file_stem)
    except OSError:
        pass

    return best_contains or best_contained


def resolve_stem_fuzzy(candidate, stem_set):
    """Return the best matching stem from stem_set using containment.

    Priority: exact > candidate is substring of stem (shortest) > stem is substring of candidate (longest).
    """
    if candidate in stem_set:
        return candidate

    contains = [s for s in stem_set if candidate in s]
    if contains:
        return min(contains, key=len)

    contained = [s for s in stem_set if s in candidate]
    if contained:
        return max(contained, key=len)

    return None


def load_tiff_as_pil(file_path):
    """Open a TIFF as a PIL Image. Float32 TIFFs are clamped to [0,1] and scaled to 8-bit."""
    with tifffile.TiffFile(file_path) as tf:
        is_float = tf.pages[0].dtype.kind == 'f'

    if not is_float:
        return Image.open(file_path)

    arr = tifffile.imread(file_path)
    if arr.ndim == 3 and arr.shape[-1] == 1:
        arr = arr[..., 0]

    arr = arr.clip(0.0, 1.0)
    arr = (arr * 255.0 + 0.5).astype('uint8')

    if arr.ndim == 2:
        return Image.fromarray(arr, 'L')
    if arr.ndim == 3 and arr.shape[-1] == 3:
        return Image.fromarray(arr, 'RGB')
    if arr.ndim == 3 and arr.shape[-1] == 4:
        return Image.fromarray(arr, 'RGBA')

    return Image.open(file_path)


@lru_cache(maxsize=CONVERSION_CACHE_SIZE)
def convert_image(file_path, mtime, cap_resolution=True):
    """Convert an image to JPEG bytes. Cached by path + modification time.

    The mtime parameter ensures the cache is invalidated when the file changes.
    Downscales to MAX_RESOLUTION if cap_resolution is True and the image exceeds it.
    """
    ext = os.path.splitext(file_path)[1].lower()
    if ext in ('.tif', '.tiff'):
        img = load_tiff_as_pil(file_path)
    else:
        img = Image.open(file_path)

    if cap_resolution and MAX_RESOLUTION > 0:
        longest = max(img.size)
        if longest > MAX_RESOLUTION:
            img.thumbnail((MAX_RESOLUTION, MAX_RESOLUTION), Image.BILINEAR)

    if img.mode in ('RGBA', 'LA', 'P'):
        img = img.convert('RGB')
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=85)
    return buf.getvalue()


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/folders', methods=['POST'])
def add_folder():
    """Validate a folder path and return its image list."""
    data = request.get_json(force=True)
    folder_path = data.get('path', '').strip()

    if not folder_path:
        return jsonify({'error': 'No path provided'}), 400

    folder_path = os.path.abspath(folder_path)

    if not os.path.isdir(folder_path):
        return jsonify({'error': f'Directory not found: {folder_path}'}), 404

    images = list_images_in_folder(folder_path)
    if not images:
        return jsonify({'error': f'No supported images found in: {folder_path}'}), 400

    return jsonify({
        'path': folder_path,
        'images': images,
    })


@app.route('/api/images', methods=['POST'])
def get_images_intersection():
    """Return image stems that exist across ALL provided folder paths.

    Matching is by stem (filename without extension), so image1.jpg and
    image1.tif are considered the same image.

    When strict=false, stems match by containment: "cat" matches "cat_v2"
    because one stem contains the other.
    """
    data = request.get_json(force=True)
    folders = data.get('folders', [])
    strict = data.get('strict', True)

    if not folders:
        return jsonify({'images': []})

    stem_sets = [get_image_stems(folder_path) for folder_path in folders]

    if strict:
        intersection = stem_sets[0]
        for s in stem_sets[1:]:
            intersection &= s
        return jsonify({'images': sorted(intersection)})

    # Non-strict: containment-based matching
    all_stems = set()
    for s in stem_sets:
        all_stems.update(s)

    passing = {
        c for c in all_stems
        if all(resolve_stem_fuzzy(c, ss) is not None for ss in stem_sets)
    }

    # Deduplicate: group candidates by the concrete files they resolve to,
    # keeping the shortest representative per group.
    resolution_map = {}
    for candidate in passing:
        key = tuple(resolve_stem_fuzzy(candidate, ss) for ss in stem_sets)
        if key not in resolution_map or len(candidate) < len(resolution_map[key]):
            resolution_map[key] = candidate

    return jsonify({'images': sorted(resolution_map.values())})


@app.route('/api/image')
def serve_image():
    """Serve a single image file from a given folder.

    The 'name' parameter can be a full filename or a stem (without extension).
    If it's a stem, the first matching image file in the folder is served.
    """
    folder = request.args.get('folder', '')
    name = request.args.get('name', '')

    if not folder or not name:
        abort(400)

    folder = os.path.abspath(folder)

    if not os.path.isdir(folder):
        abort(404)

    strict = request.args.get('strict', '1') != '0'

    # Try exact filename first
    file_path = os.path.join(folder, name)
    if os.path.isfile(file_path) and is_image_file(name):
        actual_name = name
    else:
        # Treat name as a stem and find the matching image
        if strict:
            actual_name = find_image_by_stem(folder, name)
        else:
            actual_name = find_image_by_stem_fuzzy(folder, name)
        if not actual_name:
            abort(404)
        file_path = os.path.join(folder, actual_name)

    # Security: ensure the resolved path is within the folder
    if not os.path.abspath(file_path).startswith(folder):
        abort(403)

    # Convert browser-unsupported formats (TIFF, BMP) to JPEG on the fly
    ext = os.path.splitext(actual_name)[1].lower()
    cap = request.args.get('cap', '1') != '0'
    if ext in NEEDS_CONVERSION:
        try:
            mtime = os.path.getmtime(file_path)
            jpeg_bytes = convert_image(file_path, mtime, cap_resolution=cap)
            resp = make_response(jpeg_bytes)
            resp.headers['Content-Type'] = 'image/jpeg'
            resp.headers['Cache-Control'] = 'private, max-age=300'
            resp.headers['ETag'] = f'"{hash((file_path, mtime))}"'
            return resp
        except Exception:
            abort(500)

    resp = make_response(send_from_directory(folder, actual_name))
    resp.headers['Cache-Control'] = 'private, max-age=300'
    return resp


def find_free_port():
    """Find an available port by letting the OS assign one."""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def generate_self_signed_cert(cert_dir=None):
    """Generate a self-signed SSL certificate and return (cert_path, key_path).

    Uses the cryptography library if available, otherwise falls back to
    the openssl CLI.
    """
    import tempfile
    import subprocess

    if cert_dir is None:
        cert_dir = tempfile.mkdtemp(prefix='image-compare-ssl-')

    cert_path = os.path.join(cert_dir, 'cert.pem')
    key_path = os.path.join(cert_dir, 'key.pem')

    if os.path.isfile(cert_path) and os.path.isfile(key_path):
        return cert_path, key_path

    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        import datetime

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Image Compare')])
        cert = (
            x509.CertificateBuilder()
            .subject_name(name)
            .issuer_name(name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.utcnow())
            .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=365))
            .sign(key, hashes.SHA256())
        )

        with open(key_path, 'wb') as f:
            f.write(key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption(),
            ))
        with open(cert_path, 'wb') as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))

    except ImportError:
        subprocess.run([
            'openssl', 'req', '-x509', '-newkey', 'rsa:2048',
            '-keyout', key_path, '-out', cert_path,
            '-days', '365', '-nodes',
            '-subj', '/CN=Image Compare',
        ], check=True, capture_output=True)

    return cert_path, key_path


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Image Compare — compare images across folders')
    parser.add_argument('-p', '--port', type=int, default=5000,
                        help='Port to run the server on (default: 5000)')
    parser.add_argument('--auto-port', action='store_true',
                        help='Automatically pick an available port')
    parser.add_argument('--public', action='store_true',
                        help='Listen on all interfaces (0.0.0.0) so the app is accessible over the network')
    parser.add_argument('--ssl', action='store_true',
                        help='Enable HTTPS with a self-signed certificate (browsers will show a warning on first visit)')
    parser.add_argument('--ssl-cert', type=str, default=None,
                        help='Path to SSL certificate file (use with --ssl-key to provide your own cert)')
    parser.add_argument('--ssl-key', type=str, default=None,
                        help='Path to SSL private key file (use with --ssl-cert)')
    parser.add_argument('--max-resolution', type=int, default=3000,
                        help='Max pixel dimension for converted images like TIFF (default: 3000, 0=no limit)')
    args = parser.parse_args()

    MAX_RESOLUTION = args.max_resolution

    # Persist the port in an env var so Flask's reloader reuses the same port
    env_key = 'IMAGE_COMPARE_PORT'
    if env_key in os.environ:
        port = int(os.environ[env_key])
    elif args.auto_port:
        port = find_free_port()
        os.environ[env_key] = str(port)
    else:
        port = args.port
        os.environ[env_key] = str(port)

    host = '0.0.0.0' if args.public else '127.0.0.1'
    protocol = 'http'
    ssl_context = None

    if args.ssl_cert and args.ssl_key:
        ssl_context = (args.ssl_cert, args.ssl_key)
        protocol = 'https'
    elif args.ssl:
        cert_path, key_path = generate_self_signed_cert()
        ssl_context = (cert_path, key_path)
        protocol = 'https'

    print(f' * Starting on {protocol}://{host}:{port}')
    app.run(host=host, port=port, debug=True, ssl_context=ssl_context)
