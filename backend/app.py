from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel
import base64
import os
from pathlib import Path
import numpy as np
import trimesh
import io

from .algorithms.preprocessing import load_glb_to_pointcloud, voxel_downsample, estimate_normals
from .algorithms.plane_extraction import extract_planes_sequential
from .algorithms.semantic_classification import classify_planes
from .algorithms.mesh_generation import generate_low_poly_mesh, export_to_glb


app = FastAPI(title="3D Scene Plane Extraction API")

# Get project root directory
BASE_DIR = Path(__file__).parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
GLB_FILE = BASE_DIR / "TestScene.glb"

# Global cache for preprocessed point cloud
_cached_pcd = None


class ExtractionRequest(BaseModel):
    voxel_size: float = 0.05
    distance_threshold: float = 0.05
    angle_tolerance: float = 5.0
    cluster_radius: float = 0.1
    min_cluster_size: int = 500
    expand_margin: float = 1.5


@app.get("/")
async def root():
    """Serve the main HTML page"""
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/TestScene.glb")
async def get_test_scene():
    """Serve the test GLB file"""
    if not GLB_FILE.exists():
        raise HTTPException(status_code=404, detail="TestScene.glb not found")
    return FileResponse(GLB_FILE)


@app.get("/Raw.png")
async def get_raw_image():
    """Serve the background reference image"""
    img_file = FRONTEND_DIR / "Raw.png"
    if not img_file.exists():
        raise HTTPException(status_code=404, detail="Raw.png not found")
    return FileResponse(img_file)


@app.post("/api/extract")
async def extract_planes(request: ExtractionRequest):
    """
    Extract semantic planes from TestScene.glb and return low-poly GLB
    """
    try:
        # Validate parameters
        if not (0.01 <= request.voxel_size <= 0.2):
            raise HTTPException(status_code=400, detail="voxel_size must be between 0.01 and 0.2")
        if not (0.01 <= request.distance_threshold <= 0.2):
            raise HTTPException(status_code=400, detail="distance_threshold must be between 0.01 and 0.2")
        if not (1.0 <= request.angle_tolerance <= 15.0):
            raise HTTPException(status_code=400, detail="angle_tolerance must be between 1.0 and 15.0")

        # Check if GLB file exists
        if not GLB_FILE.exists():
            raise HTTPException(status_code=404, detail="TestScene.glb not found")

        # Step 1: Load and preprocess
        print(f"Loading GLB from {GLB_FILE}...")
        pcd = load_glb_to_pointcloud(str(GLB_FILE))

        print(f"Downsampling with voxel_size={request.voxel_size}...")
        pcd = voxel_downsample(pcd, request.voxel_size)

        print("Estimating normals...")
        pcd = estimate_normals(pcd)

        # Step 2: Extract planes
        print(f"Extracting planes with distance_threshold={request.distance_threshold}...")
        planes = extract_planes_sequential(pcd, request.distance_threshold)

        if not planes:
            raise HTTPException(status_code=400, detail="No planes detected. Try adjusting parameters.")

        # Step 3: Classify planes
        print(f"Classifying planes with angle_tolerance={request.angle_tolerance}...")
        classified = classify_planes(planes, request.angle_tolerance)

        # Step 4: Generate low-poly meshes
        print("Generating low-poly meshes...")
        meshes_by_label = {}

        # Extract floor and ceiling planes for trimming
        floor_plane = classified['floor'][0][0] if classified.get('floor') else None
        ceiling_plane = classified['ceiling'][0][0] if classified.get('ceiling') else None
        wall_planes = classified.get('wall', [])  # list of (plane_model, points)

        for label in ['floor', 'ceiling', 'wall']:
            meshes_by_label[label] = []
            for plane_model, points in classified.get(label, []):
                mesh = generate_low_poly_mesh(
                    plane_model,
                    points,
                    alpha=1.0,
                    expand_margin=request.expand_margin,
                    semantic_label=label,
                    floor_plane=floor_plane,
                    ceiling_plane=ceiling_plane,
                    wall_planes=wall_planes,
                    enable_trimming=True
                )
                if mesh is not None:
                    meshes_by_label[label].append(mesh)

        # Step 5: Export to GLB
        print("Exporting to GLB...")
        glb_bytes = export_to_glb(meshes_by_label)

        if glb_bytes is None:
            raise HTTPException(status_code=500, detail="Failed to generate GLB file")

        # Encode to base64
        glb_base64 = base64.b64encode(glb_bytes).decode('utf-8')

        # Prepare statistics
        stats = {
            'floor_count': len(meshes_by_label.get('floor', [])),
            'ceiling_count': len(meshes_by_label.get('ceiling', [])),
            'wall_count': len(meshes_by_label.get('wall', [])),
            'total_planes': len(planes)
        }

        print(f"Extraction complete: {stats}")

        return JSONResponse({
            'glb_data': glb_base64,
            'stats': stats
        })

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error during extraction: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")


def pointcloud_to_glb(pcd, color=[128, 128, 128]) -> bytes:
    """Convert Open3D point cloud to GLB format"""
    points = np.asarray(pcd.points)
    if len(points) == 0:
        return None

    # Create point cloud as small spheres
    vertices = []
    faces = []
    colors = []

    # Sample points if too many
    if len(points) > 50000:
        indices = np.random.choice(len(points), 50000, replace=False)
        points = points[indices]

    for point in points:
        vertices.append(point)
        colors.append(color)

    # Create mesh from points (as vertices only, no faces for point cloud visualization)
    # Use trimesh PointCloud instead
    cloud = trimesh.PointCloud(vertices=vertices, colors=colors)

    output = io.BytesIO()
    cloud.export(output, file_type='glb')
    return output.getvalue()


def planes_to_glb(planes, colors_map=None) -> bytes:
    """Convert list of planes (as point clouds) to colored GLB"""
    all_points = []
    all_colors = []

    for i, (plane_model, points, normals) in enumerate(planes):
        if colors_map and i < len(colors_map):
            color = colors_map[i]
        else:
            # Random color for each plane
            np.random.seed(i)
            color = [np.random.randint(50, 255) for _ in range(3)] + [255]

        for point in points:
            all_points.append(point)
            all_colors.append(color)

    if len(all_points) == 0:
        return None

    # Sample if too many
    if len(all_points) > 50000:
        indices = np.random.choice(len(all_points), 50000, replace=False)
        all_points = [all_points[i] for i in indices]
        all_colors = [all_colors[i] for i in indices]

    cloud = trimesh.PointCloud(vertices=all_points, colors=all_colors)
    output = io.BytesIO()
    cloud.export(output, file_type='glb')
    return output.getvalue()


@app.post("/api/step1-preprocess")
async def step1_preprocess(request: ExtractionRequest):
    """Step 1: Load and preprocess point cloud"""
    global _cached_pcd
    try:
        if not GLB_FILE.exists():
            raise HTTPException(status_code=404, detail="TestScene.glb not found")

        pcd = load_glb_to_pointcloud(str(GLB_FILE))
        pcd = voxel_downsample(pcd, request.voxel_size)
        pcd = estimate_normals(pcd)

        # Cache the preprocessed point cloud
        _cached_pcd = pcd

        glb_bytes = pointcloud_to_glb(pcd, color=[200, 200, 200, 255])
        if glb_bytes is None:
            raise HTTPException(status_code=500, detail="Failed to generate point cloud GLB")

        return JSONResponse({
            'glb_data': base64.b64encode(glb_bytes).decode('utf-8'),
            'stats': {'point_count': len(pcd.points)}
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Step 1 failed: {str(e)}")


@app.post("/api/step2-extract-planes")
async def step2_extract_planes(request: ExtractionRequest):
    """Step 2: Extract planes using RANSAC"""
    global _cached_pcd
    try:
        # Use cached point cloud if available
        if _cached_pcd is None:
            if not GLB_FILE.exists():
                raise HTTPException(status_code=404, detail="TestScene.glb not found")
            pcd = load_glb_to_pointcloud(str(GLB_FILE))
            pcd = voxel_downsample(pcd, request.voxel_size)
            pcd = estimate_normals(pcd)
            _cached_pcd = pcd
        else:
            pcd = _cached_pcd

        planes = extract_planes_sequential(pcd, request.distance_threshold)

        if not planes:
            raise HTTPException(status_code=400, detail="No planes detected")

        glb_bytes = planes_to_glb(planes)
        if glb_bytes is None:
            raise HTTPException(status_code=500, detail="Failed to generate planes GLB")

        return JSONResponse({
            'glb_data': base64.b64encode(glb_bytes).decode('utf-8'),
            'stats': {'plane_count': len(planes)}
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Step 2 failed: {str(e)}")


@app.post("/api/step3-classify")
async def step3_classify(request: ExtractionRequest):
    """Step 3: Classify planes semantically"""
    global _cached_pcd
    try:
        # Use cached point cloud if available
        if _cached_pcd is None:
            if not GLB_FILE.exists():
                raise HTTPException(status_code=404, detail="TestScene.glb not found")
            pcd = load_glb_to_pointcloud(str(GLB_FILE))
            pcd = voxel_downsample(pcd, request.voxel_size)
            pcd = estimate_normals(pcd)
            _cached_pcd = pcd
        else:
            pcd = _cached_pcd

        planes = extract_planes_sequential(pcd, request.distance_threshold)
        classified = classify_planes(
            planes,
            request.angle_tolerance,
            cluster_radius=request.cluster_radius,
            min_cluster_size=request.min_cluster_size
        )

        # Convert classified planes to colored point clouds
        all_points = []
        all_colors = []

        color_map = {
            'floor': [76, 175, 80, 255],
            'ceiling': [244, 67, 54, 255],
            'wall': [33, 150, 243, 255]
        }

        for label, plane_list in classified.items():
            color = color_map[label]
            for plane_model, points in plane_list:
                for point in points:
                    all_points.append(point)
                    all_colors.append(color)

        if len(all_points) == 0:
            raise HTTPException(status_code=400, detail="No classified planes")

        # Sample if too many
        if len(all_points) > 50000:
            indices = np.random.choice(len(all_points), 50000, replace=False)
            all_points = [all_points[i] for i in indices]
            all_colors = [all_colors[i] for i in indices]

        cloud = trimesh.PointCloud(vertices=all_points, colors=all_colors)
        output = io.BytesIO()
        cloud.export(output, file_type='glb')
        glb_bytes = output.getvalue()

        return JSONResponse({
            'glb_data': base64.b64encode(glb_bytes).decode('utf-8'),
            'stats': {
                'floor_count': len(classified.get('floor', [])),
                'ceiling_count': len(classified.get('ceiling', [])),
                'wall_count': len(classified.get('wall', []))
            }
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Step 3 failed: {str(e)}")


@app.post("/api/step4-generate-mesh")
async def step4_generate_mesh(request: ExtractionRequest):
    """Step 4: Generate low-poly meshes"""
    global _cached_pcd
    try:
        # Use cached point cloud if available
        if _cached_pcd is None:
            if not GLB_FILE.exists():
                raise HTTPException(status_code=404, detail="TestScene.glb not found")
            pcd = load_glb_to_pointcloud(str(GLB_FILE))
            pcd = voxel_downsample(pcd, request.voxel_size)
            pcd = estimate_normals(pcd)
            _cached_pcd = pcd
        else:
            pcd = _cached_pcd

        planes = extract_planes_sequential(pcd, request.distance_threshold)
        classified = classify_planes(
            planes,
            request.angle_tolerance,
            cluster_radius=request.cluster_radius,
            min_cluster_size=request.min_cluster_size
        )

        meshes_by_label = {}
        for label in ['floor', 'ceiling', 'wall']:
            meshes_by_label[label] = []
            for plane_model, points in classified.get(label, []):
                mesh = generate_low_poly_mesh(
                    plane_model,
                    points,
                    alpha=1.0,
                    expand_margin=request.expand_margin,
                    semantic_label=label,
                    enable_trimming=False  # Step 4: No trimming
                )
                if mesh is not None:
                    meshes_by_label[label].append(mesh)

        glb_bytes = export_to_glb(meshes_by_label)
        if glb_bytes is None:
            raise HTTPException(status_code=500, detail="Failed to generate mesh GLB")

        return JSONResponse({
            'glb_data': base64.b64encode(glb_bytes).decode('utf-8'),
            'stats': {
                'floor_count': len(meshes_by_label.get('floor', [])),
                'ceiling_count': len(meshes_by_label.get('ceiling', [])),
                'wall_count': len(meshes_by_label.get('wall', []))
            }
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Step 4 failed: {str(e)}")


@app.post("/api/step5-trim-mesh")
async def step5_trim_mesh(request: ExtractionRequest):
    """Step 5: Apply intelligent trimming to meshes"""
    global _cached_pcd
    try:
        # Use cached point cloud if available
        if _cached_pcd is None:
            if not GLB_FILE.exists():
                raise HTTPException(status_code=404, detail="TestScene.glb not found")
            pcd = load_glb_to_pointcloud(str(GLB_FILE))
            pcd = voxel_downsample(pcd, request.voxel_size)
            pcd = estimate_normals(pcd)
            _cached_pcd = pcd
        else:
            pcd = _cached_pcd

        planes = extract_planes_sequential(pcd, request.distance_threshold)
        classified = classify_planes(
            planes,
            request.angle_tolerance,
            cluster_radius=request.cluster_radius,
            min_cluster_size=request.min_cluster_size
        )

        # Extract floor, ceiling, and wall planes for trimming
        floor_plane = classified['floor'][0][0] if classified.get('floor') else None
        ceiling_plane = classified['ceiling'][0][0] if classified.get('ceiling') else None
        wall_planes = classified.get('wall', [])

        meshes_by_label = {}
        for label in ['floor', 'ceiling', 'wall']:
            meshes_by_label[label] = []
            for plane_model, points in classified.get(label, []):
                mesh = generate_low_poly_mesh(
                    plane_model,
                    points,
                    alpha=1.0,
                    expand_margin=request.expand_margin,
                    semantic_label=label,
                    floor_plane=floor_plane,
                    ceiling_plane=ceiling_plane,
                    wall_planes=wall_planes,
                    enable_trimming=True  # Step 5: Always trim
                )
                if mesh is not None:
                    meshes_by_label[label].append(mesh)

        glb_bytes = export_to_glb(meshes_by_label)
        if glb_bytes is None:
            raise HTTPException(status_code=500, detail="Failed to generate trimmed mesh GLB")

        return JSONResponse({
            'glb_data': base64.b64encode(glb_bytes).decode('utf-8'),
            'stats': {
                'floor_count': len(meshes_by_label.get('floor', [])),
                'ceiling_count': len(meshes_by_label.get('ceiling', [])),
                'wall_count': len(meshes_by_label.get('wall', []))
            }
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Step 5 failed: {str(e)}")


# Mount static files (CSS, JS)
app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
