// ===========================================================================
// State
// ===========================================================================
let folders = [];          // [{ id, path, name, checked }]
let imageNames = [];       // sorted intersection of filenames
let filteredImages = [];   // after search filter
let selectedImage = null;  // currently selected filename
let displayMode = 'grid';  // 'grid' | 'overlay'
let overlayIndex = 0;      // index into checkedFolders for overlay mode
let nextFolderId = 1;
let sidebarCollapsed = false;
let sidebarWidth = 300;        // current sidebar width in px (default 300)

// Zoom & Pan (shared across all images)
let zoomLevel = 1;        // 1 = fit, higher = zoomed in
let panX = 0.5;           // 0-1, normalized center of viewport in image space
let panY = 0.5;

// ===========================================================================
// DOM References
// ===========================================================================
const sidebarEl = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const toggleIcon = document.getElementById('toggle-icon');
const sidebarResize = document.getElementById('sidebar-resize');
const folderInput = document.getElementById('folder-input');
const addFolderBtn = document.getElementById('add-folder-btn');
const folderError = document.getElementById('folder-error');
const folderListEl = document.getElementById('folder-list');
const noFoldersEl = document.getElementById('no-folders');
const imageSearch = document.getElementById('image-search');
const imageListEl = document.getElementById('image-list');
const noImagesEl = document.getElementById('no-images');
const imageCountEl = document.getElementById('image-count');
const modeGridBtn = document.getElementById('mode-grid');
const modeOverlayBtn = document.getElementById('mode-overlay');
const gridConfig = document.getElementById('grid-config');
const gridRowsInput = document.getElementById('grid-rows');
const gridColsInput = document.getElementById('grid-cols');
const overlayInfo = document.getElementById('overlay-info');
const overlayFolderName = document.getElementById('overlay-folder-name');
const overlayCounter = document.getElementById('overlay-counter');
const gridView = document.getElementById('grid-view');
const overlayView = document.getElementById('overlay-view');
const overlayLabel = document.getElementById('overlay-label');
const overlayImg = document.getElementById('overlay-img');
const emptyState = document.getElementById('empty-state');
const displayArea = document.getElementById('display-area');
const capResolutionCb = document.getElementById('cap-resolution');

// ===========================================================================
// Helpers
// ===========================================================================
function getCheckedFolders() {
    return folders.filter(f => f.checked);
}

function showError(msg) {
    folderError.textContent = msg;
    folderError.classList.remove('hidden');
    setTimeout(() => folderError.classList.add('hidden'), 4000);
}

function imageUrl(folderPath, imageName) {
    const cap = capResolutionCb.checked ? '1' : '0';
    return `/api/image?folder=${encodeURIComponent(folderPath)}&name=${encodeURIComponent(imageName)}&cap=${cap}`;
}

// ===========================================================================
// Sidebar Collapse
// ===========================================================================
sidebarToggle.addEventListener('click', () => {
    sidebarCollapsed = !sidebarCollapsed;
    sidebarEl.classList.toggle('collapsed', sidebarCollapsed);
    toggleIcon.style.transform = sidebarCollapsed ? 'rotate(180deg)' : '';

    if (sidebarCollapsed) {
        // Clear inline width so the CSS .collapsed { width: 0 } takes effect
        sidebarEl.style.width = '';
        sidebarEl.querySelector('.sidebar-inner').style.width = '';
    } else {
        // Restore the custom width
        setSidebarWidth(sidebarWidth);
    }
});

// Refit images after the sidebar width transition finishes
sidebarEl.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'width') {
        applyZoomPan();
    }
});

// ===========================================================================
// Sidebar Resize
// ===========================================================================
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 600;

function setSidebarWidth(width) {
    sidebarWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));
    sidebarEl.style.width = sidebarWidth + 'px';
    sidebarEl.querySelector('.sidebar-inner').style.width = sidebarWidth + 'px';
}

sidebarResize.addEventListener('mousedown', (e) => {
    if (sidebarCollapsed) return;
    e.preventDefault();

    sidebarEl.classList.add('resizing');
    sidebarResize.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const startX = e.clientX;
    const startWidth = sidebarWidth;

    function onMouseMove(e) {
        const delta = e.clientX - startX;
        setSidebarWidth(startWidth + delta);
    }

    function onMouseUp() {
        sidebarEl.classList.remove('resizing');
        sidebarResize.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        // Re-apply zoom/pan since container dimensions changed
        applyZoomPan();
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
});

// ===========================================================================
// Folder Management
// ===========================================================================
function renderFolderList() {
    folderListEl.innerHTML = '';
    noFoldersEl.classList.toggle('hidden', folders.length > 0);

    folders.forEach(folder => {
        const li = document.createElement('li');
        li.className = 'folder-item';
        li.dataset.id = folder.id;

        // Drag handle
        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"/></svg>';

        // Checkbox
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = folder.checked;
        cb.className = 'accent-blue-500 cursor-pointer';
        cb.addEventListener('change', () => {
            folder.checked = cb.checked;
            onFolderSelectionChanged();
        });

        // Editable name
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'folder-name';
        nameInput.value = folder.name;
        nameInput.title = folder.path;
        nameInput.addEventListener('change', () => {
            folder.name = nameInput.value || folder.path.split('/').pop();
            renderDisplay();
        });
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') nameInput.blur();
        });

        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.title = 'Remove folder';
        removeBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
        removeBtn.addEventListener('click', () => {
            folders = folders.filter(f => f.id !== folder.id);
            renderFolderList();
            onFolderSelectionChanged();
        });

        // Image count badge
        const countBadge = document.createElement('span');
        countBadge.className = 'folder-count';
        countBadge.textContent = folder.imageCount != null ? `(${folder.imageCount})` : '';

        li.appendChild(handle);
        li.appendChild(cb);
        li.appendChild(nameInput);
        li.appendChild(countBadge);
        li.appendChild(removeBtn);
        folderListEl.appendChild(li);
    });

    initSortable();
}

let sortableInstance = null;

function initSortable() {
    if (sortableInstance) sortableInstance.destroy();
    sortableInstance = new Sortable(folderListEl, {
        animation: 150,
        handle: '.drag-handle',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        onEnd: (evt) => {
            const movedItem = folders.splice(evt.oldIndex, 1)[0];
            folders.splice(evt.newIndex, 0, movedItem);
            renderDisplay();
        },
    });
}

async function addFolder() {
    const path = folderInput.value.trim();
    if (!path) return;

    // Prevent duplicates
    if (folders.some(f => f.path === path)) {
        showError('Folder already added.');
        return;
    }

    try {
        const res = await fetch('/api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });
        const data = await res.json();

        if (!res.ok) {
            showError(data.error || 'Failed to add folder.');
            return;
        }

        folders.push({
            id: nextFolderId++,
            path: data.path,
            name: data.path.split('/').pop(),
            checked: true,
            imageCount: (data.images || []).length,
        });

        folderInput.value = '';
        renderFolderList();
        onFolderSelectionChanged();
    } catch (err) {
        showError('Network error. Is the server running?');
    }
}

addFolderBtn.addEventListener('click', addFolder);
folderInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addFolder();
});

// ===========================================================================
// Export / Load State
// ===========================================================================
const exportStateBtn = document.getElementById('export-state-btn');
const loadStateBtn = document.getElementById('load-state-btn');
const stateFileInput = document.getElementById('state-file-input');

function exportState() {
    if (folders.length === 0) {
        showError('No folders to export.');
        return;
    }

    const state = {
        folders: folders.map(f => ({
            path: f.path,
            name: f.name,
            checked: f.checked,
        })),
    };

    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'image-compare-state.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function loadState(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const state = JSON.parse(e.target.result);

            if (!state.folders || !Array.isArray(state.folders)) {
                showError('Invalid state file: missing folders array.');
                return;
            }

            // Restore folders with fresh IDs
            folders = state.folders.map(f => ({
                id: nextFolderId++,
                path: f.path,
                name: f.name || f.path.split('/').pop(),
                checked: f.checked !== false,
                imageCount: null,
            }));

            renderFolderList();
            onFolderSelectionChanged();
            fetchFolderCounts();
        } catch (err) {
            showError('Failed to parse state file.');
        }
    };
    reader.readAsText(file);
}

async function fetchFolderCounts() {
    const promises = folders.map(async (folder) => {
        try {
            const res = await fetch('/api/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: folder.path }),
            });
            if (res.ok) {
                const data = await res.json();
                folder.imageCount = (data.images || []).length;
            }
        } catch { /* ignore */ }
    });
    await Promise.all(promises);
    renderFolderList();
}

exportStateBtn.addEventListener('click', exportState);
loadStateBtn.addEventListener('click', () => stateFileInput.click());
stateFileInput.addEventListener('change', () => {
    if (stateFileInput.files.length > 0) {
        loadState(stateFileInput.files[0]);
        stateFileInput.value = '';  // reset so same file can be re-loaded
    }
});

// ===========================================================================
// Image Intersection
// ===========================================================================
async function fetchImageIntersection() {
    const checked = getCheckedFolders();
    if (checked.length === 0) {
        imageNames = [];
        filteredImages = [];
        selectedImage = null;
        renderImageList();
        renderDisplay();
        return;
    }

    try {
        const res = await fetch('/api/images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folders: checked.map(f => f.path) }),
        });
        const data = await res.json();
        imageNames = data.images || [];
    } catch {
        imageNames = [];
    }

    applyImageFilter();

    // Keep selection if still valid, otherwise select first
    if (selectedImage && !imageNames.includes(selectedImage)) {
        selectedImage = imageNames.length > 0 ? imageNames[0] : null;
    } else if (!selectedImage && imageNames.length > 0) {
        selectedImage = imageNames[0];
    }

    renderImageList();
    renderDisplay();
}

function onFolderSelectionChanged() {
    fetchImageIntersection();
}

// ===========================================================================
// Image List (Sidebar)
// ===========================================================================
function applyImageFilter() {
    const query = imageSearch.value.trim().toLowerCase();
    filteredImages = query
        ? imageNames.filter(name => name.toLowerCase().includes(query))
        : [...imageNames];
}

function renderImageList() {
    imageListEl.innerHTML = '';
    noImagesEl.classList.toggle('hidden', filteredImages.length > 0);

    // Update match count in the heading
    imageCountEl.textContent = imageNames.length > 0 ? `(${filteredImages.length}/${imageNames.length})` : '';

    filteredImages.forEach(name => {
        const li = document.createElement('li');
        li.className = 'image-item' + (name === selectedImage ? ' selected' : '');
        li.title = name;
        li.addEventListener('click', () => {
            selectImage(name);
        });

        // Image name label
        const nameSpan = document.createElement('span');
        nameSpan.className = 'image-name';
        nameSpan.textContent = name;

        // Copy button with clipboard icon
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.title = 'Copy filename';
        copyBtn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            copyImageName(name, copyBtn);
        });

        li.appendChild(nameSpan);
        li.appendChild(copyBtn);
        imageListEl.appendChild(li);
    });

    scrollSelectedIntoView();
}

function copyImageName(name, btn) {
    navigator.clipboard.writeText(name).then(() => {
        // Show checkmark briefly
        btn.classList.add('copied');
        btn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>';
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
        }, 1500);
    }).catch(() => {
        // Fallback for older browsers or non-HTTPS
        const ta = document.createElement('textarea');
        ta.value = name;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    });
}

function selectImage(name) {
    selectedImage = name;
    overlayIndex = 0;
    zoomLevel = 1;
    panX = 0.5;
    panY = 0.5;
    renderImageList();
    renderDisplay();
    preloadNearbyImages(name);
}

const PRELOAD_RADIUS = 5;
const preloadCache = new Set();

function preloadNearbyImages(currentName) {
    const checked = getCheckedFolders();
    if (checked.length === 0) return;

    const idx = filteredImages.indexOf(currentName);
    if (idx === -1) return;

    for (let offset = -PRELOAD_RADIUS; offset <= PRELOAD_RADIUS; offset++) {
        if (offset === 0) continue;
        const i = idx + offset;
        if (i < 0 || i >= filteredImages.length) continue;

        const imgName = filteredImages[i];
        checked.forEach(folder => {
            const url = imageUrl(folder.path, imgName);
            if (!preloadCache.has(url)) {
                preloadCache.add(url);
                const img = new Image();
                img.src = url;
            }
        });
    }
}

function scrollSelectedIntoView() {
    const selectedEl = imageListEl.querySelector('.image-item.selected');
    if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
    }
}

imageSearch.addEventListener('input', () => {
    applyImageFilter();
    renderImageList();
});

// ===========================================================================
// Keyboard Navigation
// ===========================================================================
document.addEventListener('keydown', (e) => {
    // Don't intercept when typing in inputs
    const tag = e.target.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA';

    if (e.key === 'ArrowUp' && !isInput) {
        e.preventDefault();
        navigateImageList(-1);
    } else if (e.key === 'ArrowDown' && !isInput) {
        e.preventDefault();
        navigateImageList(1);
    } else if (e.key === 'ArrowLeft' && !isInput && displayMode === 'overlay') {
        e.preventDefault();
        navigateOverlay(-1);
    } else if (e.key === 'ArrowRight' && !isInput && displayMode === 'overlay') {
        e.preventDefault();
        navigateOverlay(1);
    }
});

function navigateImageList(direction) {
    if (filteredImages.length === 0) return;

    let idx = filteredImages.indexOf(selectedImage);
    if (idx === -1) {
        idx = 0;
    } else {
        idx += direction;
        if (idx < 0) idx = filteredImages.length - 1;
        if (idx >= filteredImages.length) idx = 0;
    }

    selectImage(filteredImages[idx]);
}

function navigateOverlay(direction) {
    const checked = getCheckedFolders();
    if (checked.length === 0) return;

    overlayIndex += direction;
    if (overlayIndex < 0) overlayIndex = checked.length - 1;
    if (overlayIndex >= checked.length) overlayIndex = 0;

    renderOverlay();
}

// ===========================================================================
// Display Mode
// ===========================================================================
function setMode(mode) {
    displayMode = mode;
    modeGridBtn.classList.toggle('active', mode === 'grid');
    modeOverlayBtn.classList.toggle('active', mode === 'overlay');
    gridConfig.classList.toggle('hidden', mode !== 'grid');
    overlayInfo.classList.toggle('hidden', mode !== 'overlay');
    renderDisplay();
}

modeGridBtn.addEventListener('click', () => setMode('grid'));
modeOverlayBtn.addEventListener('click', () => setMode('overlay'));

capResolutionCb.addEventListener('change', () => {
    preloadCache.clear();
    renderDisplay();
});

gridRowsInput.addEventListener('input', () => renderDisplay());
gridColsInput.addEventListener('input', () => renderDisplay());

// ===========================================================================
// Render Display
// ===========================================================================
function renderDisplay() {
    const checked = getCheckedFolders();

    if (!selectedImage || checked.length === 0) {
        gridView.classList.add('hidden');
        overlayView.classList.add('hidden');
        emptyState.classList.remove('hidden');
        overlayInfo.classList.add('hidden');
        return;
    }

    emptyState.classList.add('hidden');

    if (displayMode === 'grid') {
        gridView.classList.remove('hidden');
        overlayView.classList.add('hidden');
        overlayInfo.classList.add('hidden');
        renderGrid();
    } else {
        gridView.classList.add('hidden');
        overlayView.classList.remove('hidden');
        overlayInfo.classList.remove('hidden');
        if (overlayIndex >= checked.length) overlayIndex = 0;
        renderOverlay();
    }
}

// ===========================================================================
// Grid Mode
// ===========================================================================
function renderGrid() {
    const checked = getCheckedFolders();
    const rows = Math.max(1, parseInt(gridRowsInput.value) || 1);
    const cols = Math.max(1, parseInt(gridColsInput.value) || 2);

    gridView.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    gridView.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    gridView.innerHTML = '';

    checked.forEach(folder => {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';

        const label = document.createElement('div');
        label.className = 'cell-label';
        label.textContent = folder.name;
        label.title = folder.path;

        const zoomContainer = document.createElement('div');
        zoomContainer.className = 'zoom-container';

        const img = document.createElement('img');
        img.className = 'zoom-img';
        img.src = imageUrl(folder.path, selectedImage);
        img.alt = `${folder.name} - ${selectedImage}`;
        img.addEventListener('load', () => applyZoomPan());

        zoomContainer.appendChild(img);
        cell.appendChild(label);
        cell.appendChild(zoomContainer);
        gridView.appendChild(cell);
    });

    // Apply zoom after a frame so containers have layout dimensions
    requestAnimationFrame(() => applyZoomPan());
}

// ===========================================================================
// Overlay Mode
// ===========================================================================
function renderOverlay() {
    const checked = getCheckedFolders();
    if (checked.length === 0 || !selectedImage) return;

    if (overlayIndex >= checked.length) overlayIndex = 0;

    const folder = checked[overlayIndex];
    overlayLabel.textContent = folder.name;
    overlayImg.src = imageUrl(folder.path, selectedImage);
    overlayImg.alt = `${folder.name} - ${selectedImage}`;

    overlayFolderName.textContent = folder.name;
    overlayCounter.textContent = `(${overlayIndex + 1} / ${checked.length})`;

    // Apply zoom/pan (image onload will re-apply once dimensions are known)
    requestAnimationFrame(() => applyZoomPan());

    // Preload adjacent images
    preloadOverlayImages(checked);
}

function preloadOverlayImages(checked) {
    const prevIdx = (overlayIndex - 1 + checked.length) % checked.length;
    const nextIdx = (overlayIndex + 1) % checked.length;

    [prevIdx, nextIdx].forEach(idx => {
        if (idx !== overlayIndex) {
            const img = new Image();
            img.src = imageUrl(checked[idx].path, selectedImage);
        }
    });
}

// ===========================================================================
// Zoom & Pan
// ===========================================================================

/**
 * Compute the "object-fit: contain" dimensions for an image inside a container.
 */
function getFitDimensions(containerW, containerH, natW, natH) {
    const imgAspect = natW / natH;
    const contAspect = containerW / containerH;
    let fitW, fitH;
    if (contAspect > imgAspect) {
        fitH = containerH;
        fitW = containerH * imgAspect;
    } else {
        fitW = containerW;
        fitH = containerW / imgAspect;
    }
    return { fitW, fitH };
}

/**
 * Return only zoom-containers that are actually visible (non-zero size).
 * Hidden containers (inside a display:none parent) report 0 dimensions.
 */
function getVisibleZoomContainers() {
    return Array.from(document.querySelectorAll('.zoom-container')).filter(
        c => c.clientWidth > 0 && c.clientHeight > 0
    );
}

/**
 * Clamp panX/panY so no empty space is shown beyond image edges.
 * Uses the first visible zoom-container for reference dimensions.
 */
function clampPan() {
    const containers = getVisibleZoomContainers();
    if (containers.length === 0) return;
    const container = containers[0];
    const img = container.querySelector('.zoom-img');
    if (!img || !img.naturalWidth) return;

    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const { fitW, fitH } = getFitDimensions(cW, cH, img.naturalWidth, img.naturalHeight);
    const displayW = fitW * zoomLevel;
    const displayH = fitH * zoomLevel;

    if (displayW <= cW) {
        panX = 0.5;
    } else {
        const minPanX = cW / (2 * displayW);
        const maxPanX = 1 - minPanX;
        panX = Math.max(minPanX, Math.min(maxPanX, panX));
    }
    if (displayH <= cH) {
        panY = 0.5;
    } else {
        const minPanY = cH / (2 * displayH);
        const maxPanY = 1 - minPanY;
        panY = Math.max(minPanY, Math.min(maxPanY, panY));
    }
}

/**
 * Apply the shared zoomLevel / panX / panY to every visible .zoom-container.
 */
function applyZoomPan() {
    clampPan();

    const containers = getVisibleZoomContainers();
    containers.forEach(container => {
        const img = container.querySelector('.zoom-img');
        if (!img || !img.naturalWidth) return;

        const cW = container.clientWidth;
        const cH = container.clientHeight;

        const { fitW, fitH } = getFitDimensions(cW, cH, img.naturalWidth, img.naturalHeight);
        const displayW = fitW * zoomLevel;
        const displayH = fitH * zoomLevel;

        img.style.width = displayW + 'px';
        img.style.height = displayH + 'px';

        // Position so that panX/panY (image-space fraction) is at container center
        let left, top;
        if (displayW <= cW) {
            left = (cW - displayW) / 2;
        } else {
            left = cW / 2 - panX * displayW;
            left = Math.max(cW - displayW, Math.min(0, left));
        }
        if (displayH <= cH) {
            top = (cH - displayH) / 2;
        } else {
            top = cH / 2 - panY * displayH;
            top = Math.max(cH - displayH, Math.min(0, top));
        }

        img.style.left = left + 'px';
        img.style.top = top + 'px';
    });
}

/**
 * Handle wheel events on the display area for zoom (Ctrl/Cmd+scroll)
 * and pan (plain scroll).
 */
function handleWheel(e) {
    const container = e.target.closest('.zoom-container');
    if (!container) return;

    const img = container.querySelector('.zoom-img');
    if (!img || !img.naturalWidth) return;

    e.preventDefault();

    const isZoom = e.ctrlKey || e.metaKey;

    if (isZoom) {
        // --- Zoom toward cursor ---
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const cW = container.clientWidth;
        const cH = container.clientHeight;
        const { fitW, fitH } = getFitDimensions(cW, cH, img.naturalWidth, img.naturalHeight);
        const displayW = fitW * zoomLevel;
        const displayH = fitH * zoomLevel;

        // Current image offset
        const curLeft = parseFloat(img.style.left) || (cW - displayW) / 2;
        const curTop  = parseFloat(img.style.top)  || (cH - displayH) / 2;

        // Normalized image point under cursor (0-1)
        const imgPtX = (mouseX - curLeft) / displayW;
        const imgPtY = (mouseY - curTop)  / displayH;

        // Compute new zoom level
        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 16;
        const factor = Math.pow(0.998, delta);
        const newZoom = Math.max(1, Math.min(40, zoomLevel * factor));
        if (newZoom === zoomLevel) return;

        const newDisplayW = fitW * newZoom;
        const newDisplayH = fitH * newZoom;

        // New offset so that same image point stays under cursor
        const newLeft = mouseX - imgPtX * newDisplayW;
        const newTop  = mouseY - imgPtY * newDisplayH;

        // Derive new pan center (fraction of image at viewport center)
        panX = (cW / 2 - newLeft) / newDisplayW;
        panY = (cH / 2 - newTop)  / newDisplayH;
        zoomLevel = newZoom;

        applyZoomPan();
    } else {
        // --- Pan ---
        if (zoomLevel <= 1) return;

        const cW = container.clientWidth;
        const cH = container.clientHeight;
        const { fitW, fitH } = getFitDimensions(cW, cH, img.naturalWidth, img.naturalHeight);
        const displayW = fitW * zoomLevel;
        const displayH = fitH * zoomLevel;

        let deltaX = e.deltaX;
        let deltaY = e.deltaY;
        if (e.deltaMode === 1) { deltaX *= 16; deltaY *= 16; }

        // Convert pixel scroll to fraction of displayed image
        panX += deltaX / displayW;
        panY += deltaY / displayH;

        applyZoomPan();
    }
}

// Attach wheel handler to the display area (covers both grid and overlay)
displayArea.addEventListener('wheel', handleWheel, { passive: false });

// Middle-mouse-button drag to pan (cursor stays locked in place)
displayArea.addEventListener('mousedown', (e) => {
    if (e.button !== 1) return;          // middle button only
    if (zoomLevel <= 1) return;          // nothing to pan at fit level

    const container = e.target.closest('.zoom-container');
    if (!container) return;

    const img = container.querySelector('.zoom-img');
    if (!img || !img.naturalWidth) return;

    e.preventDefault();

    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const { fitW, fitH } = getFitDimensions(cW, cH, img.naturalWidth, img.naturalHeight);
    const displayW = fitW * zoomLevel;
    const displayH = fitH * zoomLevel;

    function onMouseMove(e) {
        panX -= e.movementX / displayW;
        panY -= e.movementY / displayH;
        applyZoomPan();
    }

    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.exitPointerLock();
    }

    // Lock the cursor in place so it doesn't drift while panning
    displayArea.requestPointerLock();
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
});

// Prevent default middle-click auto-scroll on the display area
displayArea.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
});

// Re-apply zoom/pan on window resize so positions stay correct
window.addEventListener('resize', () => applyZoomPan());

// Overlay image onload: re-apply zoom/pan once natural dimensions are known
overlayImg.addEventListener('load', () => applyZoomPan());

// ===========================================================================
// Initialize
// ===========================================================================
setMode('grid');
renderFolderList();
renderImageList();
renderDisplay();
