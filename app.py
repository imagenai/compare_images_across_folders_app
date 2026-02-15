import io
import os
from functools import lru_cache
from flask import Flask, render_template, request, jsonify, send_from_directory, send_file, abort
from PIL import Image

app = Flask(__name__)

IMAGE_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.webp',
    '.tiff', '.tif', '.bmp', '.svg',
}

# Formats that browsers cannot display natively — convert before serving
NEEDS_CONVERSION = {'.tiff', '.tif', '.bmp'}

# Maximum number of converted images to keep in cache
CONVERSION_CACHE_SIZE = 256


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


@lru_cache(maxsize=CONVERSION_CACHE_SIZE)
def convert_image(file_path, mtime):
    """Convert an image to JPEG bytes. Cached by path + modification time.

    The mtime parameter ensures the cache is invalidated when the file changes.
    """
    img = Image.open(file_path)
    if img.mode in ('RGBA', 'LA', 'P'):
        img = img.convert('RGB')
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=92)
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
    """
    data = request.get_json(force=True)
    folders = data.get('folders', [])

    if not folders:
        return jsonify({'images': []})

    stem_sets = [get_image_stems(folder_path) for folder_path in folders]

    intersection = stem_sets[0]
    for s in stem_sets[1:]:
        intersection &= s

    return jsonify({'images': sorted(intersection)})


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

    # Try exact filename first
    file_path = os.path.join(folder, name)
    if os.path.isfile(file_path) and is_image_file(name):
        actual_name = name
    else:
        # Treat name as a stem and find the matching image
        actual_name = find_image_by_stem(folder, name)
        if not actual_name:
            abort(404)
        file_path = os.path.join(folder, actual_name)

    # Security: ensure the resolved path is within the folder
    if not os.path.abspath(file_path).startswith(folder):
        abort(403)

    # Convert browser-unsupported formats (TIFF, BMP) to JPEG on the fly
    ext = os.path.splitext(actual_name)[1].lower()
    if ext in NEEDS_CONVERSION:
        try:
            mtime = os.path.getmtime(file_path)
            jpeg_bytes = convert_image(file_path, mtime)
            return send_file(
                io.BytesIO(jpeg_bytes),
                mimetype='image/jpeg',
            )
        except Exception:
            abort(500)

    return send_from_directory(folder, actual_name)


def find_free_port():
    """Find an available port by letting the OS assign one."""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Image Compare — compare images across folders')
    parser.add_argument('-p', '--port', type=int, default=5000,
                        help='Port to run the server on (default: 5000)')
    parser.add_argument('--auto-port', action='store_true',
                        help='Automatically pick an available port')
    args = parser.parse_args()

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

    print(f' * Starting on http://127.0.0.1:{port}')
    app.run(host='127.0.0.1', port=port, debug=True)
