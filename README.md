# Image Compare

A local web application for comparing images with the same name across multiple folders. Built for workflows like evaluating model outputs, reviewing rendering passes, or any task where you need to visually compare corresponding images side by side.

![Feature Overview](showcase/01_feature_overview.png)

## Features

### Grid Mode
Compare images from all selected folders simultaneously in a configurable rows x columns grid. Each cell is labeled with the folder name.

![Grid Mode](showcase/02_grid_mode.png)

### Overlay Mode
View a single image at full size and press the **left/right arrow keys** to instantly switch between the same image from different folders. The current folder name and position indicator are shown above the image.

![Overlay Mode](showcase/03_overlay_mode.png)

### Folder Management
- **Add folders** by entering their absolute path
- **Rename** folders inline for clearer identification
- **Drag to reorder** folders to control display order
- **Toggle on/off** with checkboxes to include or exclude folders from comparison
- **Remove** folders with one click

![Folder Management](showcase/04_folder_management.png)

### Searchable Image Browser
- Scrollable list of all image names that exist across **every** selected folder (intersection)
- **Search** to filter images by name
- **Keyboard navigation** with Up/Down arrow keys, or click to select

### Synchronized Zoom & Pan
- **Ctrl/Cmd + Scroll Wheel** to zoom in/out at the cursor position
- **Scroll Wheel** to pan vertically
- **Horizontal Scroll** to pan horizontally
- Zoom and pan are **synced across all grid cells** so you always compare the exact same region
- In Overlay mode, zoom/pan state **persists** when switching between folders

![Zoom & Pan](showcase/05_zoom_and_pan.png)

### Collapsible Sidebar
Click the toggle arrow to collapse or expand the sidebar, maximizing the display area when needed.

## Requirements

- Python 3.9+
- Flask

## Installation

```bash
pip install -r requirements.txt
```

## Usage

1. Start the server:

```bash
python app.py
```

2. Open your browser and go to **http://localhost:5000**

3. Add image folders:
   - Paste an absolute folder path into the input field at the top of the sidebar
   - Click **Add** (folders must contain supported image files)

4. Select an image from the sidebar list — the main area will display the matching images from all selected folders.

5. Switch between **Grid** and **Overlay** modes using the toggle buttons at the top.

6. In Grid mode, adjust the **Rows** and **Cols** controls to change the layout.

7. In Overlay mode, press **Left/Right arrow keys** to cycle through folder images.

8. Use **Ctrl/Cmd + Scroll** to zoom into details, and **Scroll** to pan around.

## Supported Image Formats

PNG, JPG, JPEG, GIF, WebP, TIFF, BMP, SVG

## Project Structure

```
├── app.py                  # Flask backend (API + image serving)
├── requirements.txt        # Python dependencies
├── templates/
│   └── index.html          # Main HTML template
└── static/
    ├── css/
    │   └── style.css       # Custom styles
    └── js/
        └── app.js          # Frontend logic (state, rendering, zoom/pan)
```
