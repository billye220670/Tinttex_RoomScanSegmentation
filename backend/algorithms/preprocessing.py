import open3d as o3d
import numpy as np
import trimesh


def load_glb_to_pointcloud(file_path: str, sample_points: int = 100000, apply_rotation: bool = True) -> o3d.geometry.PointCloud:
    """Load GLB file and convert to point cloud"""
    try:
        # Load GLB - might be Scene or Mesh
        loaded = trimesh.load(file_path)

        # Handle Scene (multiple meshes) or single Mesh
        if isinstance(loaded, trimesh.Scene):
            print(f"Scene contains {len(loaded.geometry)} geometries:")
            for name, geom in loaded.geometry.items():
                print(f"  - {name}: {type(geom).__name__}")

            # Filter out camera mesh, only keep scene meshes
            scene_meshes = [
                geom for name, geom in loaded.geometry.items()
                if isinstance(geom, trimesh.Trimesh) and 'camera' not in name.lower()
            ]

            if not scene_meshes:
                raise RuntimeError("No valid scene meshes found (only camera mesh?)")

            # Combine all scene meshes
            mesh = trimesh.util.concatenate(scene_meshes)
            print(f"Loaded {len(scene_meshes)} scene mesh(es), filtered out camera")
        else:
            mesh = loaded

        # Sample points from mesh surface
        points, face_indices = trimesh.sample.sample_surface(mesh, sample_points)

        # Apply rotation to fix coordinate system orientation
        if apply_rotation:
            # Rotate 180 degrees around X-axis to flip upside down
            rotation_matrix = np.array([
                [1,  0,  0],
                [0, -1,  0],
                [0,  0, -1]
            ])
            points = points @ rotation_matrix.T

        # Create Open3D point cloud
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(points)

        return pcd
    except Exception as e:
        raise RuntimeError(f"Failed to load GLB file: {str(e)}")


def voxel_downsample(pcd: o3d.geometry.PointCloud, voxel_size: float) -> o3d.geometry.PointCloud:
    """Downsample point cloud using voxel grid"""
    return pcd.voxel_down_sample(voxel_size)


def estimate_normals(pcd: o3d.geometry.PointCloud, radius: float = 0.1, max_nn: int = 30) -> o3d.geometry.PointCloud:
    """Estimate and orient normals consistently"""
    pcd.estimate_normals(
        search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=radius, max_nn=max_nn)
    )
    pcd.orient_normals_consistent_tangent_plane(k=15)
    return pcd
