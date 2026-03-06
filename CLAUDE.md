# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

3D室内场景语义平面提取与轻量化重建系统。从高面数3D扫描模型（如MapAnything生成的GLB文件）中自动提取语义平面（墙体、地面、天花板），转换为低模网格用于Web 3D交互。

## Running the Application

```bash
# Install dependencies and start server (Windows)
start.bat

# Or manually:
pip install -r backend/requirements.txt
uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
```

Access at: http://localhost:8000

## Architecture

### Frontend (frontend/)
- **Three.js-based 3D rendering** with dual viewport system:
  - Main viewport: Interactive 3D scene with OrbitControls
  - Preview viewport: Fixed camera at origin (0,0,0) with transparent rendering overlay on Raw.png background image
- **scene.js**: Scene initialization, camera setup, GLB loading, and rendering loops
- **ui.js**: Control panel sliders and callbacks
- **main.js**: Application entry point, API communication, workflow orchestration

### Backend (backend/)
- **FastAPI server** (app.py) with static file serving and API endpoints
- **Algorithm pipeline** (backend/algorithms/):
  1. **preprocessing.py**: GLB→点云转换, 体素降采样, 法线估计
     - Applies 180° X-axis rotation to fix coordinate system
     - Filters out camera meshes from GLB scenes
  2. **plane_extraction.py**: Sequential RANSAC平面提取
     - Iteratively extracts up to 15 planes
     - Stops when <5% points remain or <100 inliers
  3. **semantic_classification.py**: 语义分类（floor/ceiling/wall）
     - **Critical**: Calibrates gravity direction from largest horizontal planes before classification
     - Uses angle tolerance to classify planes relative to calibrated up-vector
  4. **mesh_generation.py**: Phase 1 expanded rectangle mesh generation
     - Projects plane points to 2D, computes bbox, expands by expand_margin
  5. **plane_intersection.py**: Phase 2 trimming via half-plane intersection
     - `clip_polygon_by_neighbor_plane()` clips each mesh by neighbor plane intersection lines

### Data Flow
1. Frontend sends parameters (voxel_size, distance_threshold, angle_tolerance, etc.) via JSON
2. Backend processes TestScene.glb through pipeline steps
3. Returns base64-encoded GLB with color-coded meshes (green=floor, red=ceiling, blue=walls)
4. Frontend overlays low-poly result on semi-transparent original model

## API Endpoints

- `POST /api/extract` - Full pipeline (all steps, always trims)
- `POST /api/step1-preprocess` - Point cloud preprocessing only
- `POST /api/compute-fov` - Compute optimal preview FOV from cached point cloud (no body)
- `POST /api/step2-extract-planes` - RANSAC plane extraction (UI: Step 3)
- `POST /api/step3-classify` - Semantic classification with colors (UI: Step 4)
- `POST /api/step4-generate-mesh` - Low-poly mesh generation, no trimming (UI: Step 5)
- `POST /api/step5-trim-mesh` - Mesh generation with Phase 2 trimming (UI: Step 6)
- `GET /TestScene.glb` - Serve the input 3D model
- `GET /Raw.png` - Serve the preview camera background reference image

## Key Implementation Details

### Coordinate System
- Input GLB files are rotated 180° around X-axis during loading to correct orientation
- Gravity direction is auto-calibrated from largest horizontal planes, not assumed to be Y-axis

### Preview Camera System
- Fixed camera at origin with FOV slider control (30-120°, default 60°)
- Aspect ratio locked to Raw.png dimensions (3414:2560)
- Transparent rendering: `scene.background` temporarily set to `null` during preview render to show background image
- Canvas positioned with z-index:2 over background image (z-index:1)
- **Auto FOV** (`/api/compute-fov`): Computes minimum vertical FOV to cover all front-facing points
  - Uses 99.5th percentile of required per-point FOV (robust to outlier noise)
  - Maps horizontal spread to equivalent vertical via aspect ratio before taking max
  - Requires Step 1 (preprocess) to be run first to populate `_cached_pcd`
- **Crosshair + Marker Sphere** (spatial mapping aid):
  - Preview canvas cursor set to `crosshair`
  - `mousemove` on preview canvas casts a ray from `fixedCamera` through NDC coords, intersects `lowPolyGroup` meshes
  - Hit → marker object appears at the 3D intersection point in the main scene
  - Miss or `mouseleave` → marker hidden
  - Layer isolation: marker children on layer 1; `camera.layers.enable(1)` lets main camera see them; `fixedCamera` stays on layer 0 only
  - **Marker shape selector** (dropdown in preview-controls): Point (glow dot) / Cone / Square / Sphere
    - `setMarkerShape(shape)` calls `rebuildMarkerGeometry()` which disposes old children and builds new ones
    - Cone: base at hit point, tip points +Y (natural axis)
    - Square: `PlaneGeometry` pre-rotated −90° on X → lies flat, normal faces +Y
    - Sphere: larger ball with glow
  - **Align to face normal** checkbox: when enabled, `markerSphere.quaternion.setFromUnitVectors(Y_UP, worldNormal)` where `worldNormal = face.normal.transformDirection(object.matrixWorld)`; when disabled, quaternion reset to identity

### Semantic Classification Logic
- **Floor**: Horizontal plane (parallel to calibrated up-vector) with lowest Y position
- **Ceiling**: Horizontal plane with highest Y position
- **Walls**: Planes perpendicular to up-vector (dot product ≈ 0 within angle tolerance)
- Filters out small planes (<1m²) and mid-height horizontal surfaces (0.5-1.2m, likely furniture)

### Robustness Features
- Clustering with DBSCAN to separate disconnected wall segments
- Alpha Shape (not simple bounding box) for accurate L-shaped wall boundaries
- Point cloud caching (`_cached_pcd`) to avoid reprocessing in step-by-step mode
- Sample limiting (50k points max) to prevent browser OOM

### Phase 1/2 Mesh Expansion
- **Phase 1**: Project plane points to 2D → compute bounding box → expand by `expand_margin` → generate rectangular mesh
  - Walls/floor: bbox also includes camera projection at (0,0,0) onto the plane
- **Phase 2 (Step 6/api/step5-trim-mesh)**: Clip each expanded rectangle using neighbor plane intersection lines
  - Walls: clipped by floor, ceiling, and other walls
  - Floor/ceiling: clipped by all walls
  - Core function: `clip_polygon_by_neighbor_plane()` in `backend/algorithms/plane_intersection.py`
  - Requires `shapely==2.0.3`

### Step-by-Step UI (6 steps)
1. **Step 1**: Preprocess — loads GLB, voxel-downsamples, estimates normals, caches point cloud
2. **Step 2**: Compute FOV — auto-fills FOV slider with optimal value (requires Step 1 first)
3. **Step 3**: Extract Planes — runs Sequential RANSAC on cached point cloud
4. **Step 4**: Classify — semantic labeling (floor/ceiling/wall) with colors
5. **Step 5**: Generate Mesh — Phase 1 expanded rectangles, no trimming
6. **Step 6**: Trim Mesh — Phase 1 + Phase 2 trimming applied

## Common Parameters

- **voxel_size** (0.01-0.2, default 0.05): Point cloud downsampling density
- **distance_threshold** (0.01-0.2, default 0.05): RANSAC plane fitting tolerance
- **angle_tolerance** (1.0-15.0°, default 5.0): Semantic classification strictness
- **cluster_radius** (0.05-0.30, default 0.10): DBSCAN connectivity radius
- **min_cluster_size** (100-2000, default 500): Minimum points per wall cluster
- **expand_margin** (0.0-3.0m, default 1.5m): Phase 1 outward expansion per plane

## File Locations

- Input model: `TestScene.glb` (root directory)
- Preview background: `frontend/Raw.png` and `Raw.png` (root, legacy)
- Static assets: `frontend/css/`, `frontend/js/`
