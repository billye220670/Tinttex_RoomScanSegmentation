import open3d as o3d
import numpy as np
from typing import List, Tuple


def extract_planes_sequential(
    pcd: o3d.geometry.PointCloud,
    distance_threshold: float,
    max_planes: int = 15,
    min_points_ratio: float = 0.05
) -> List[Tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """
    Extract planes using sequential RANSAC

    Returns:
        List of (plane_model, inlier_points, inlier_normals)
        plane_model: [a, b, c, d] where ax + by + cz + d = 0
    """
    planes = []
    remaining_pcd = pcd
    total_points = len(pcd.points)
    min_points = int(total_points * min_points_ratio)

    for i in range(max_planes):
        if len(remaining_pcd.points) < min_points:
            break

        # RANSAC plane segmentation
        plane_model, inliers = remaining_pcd.segment_plane(
            distance_threshold=distance_threshold,
            ransac_n=3,
            num_iterations=1000
        )

        if len(inliers) < 100:  # Too few points
            break

        # Extract inlier points and normals
        inlier_cloud = remaining_pcd.select_by_index(inliers)
        inlier_points = np.asarray(inlier_cloud.points)
        inlier_normals = np.asarray(inlier_cloud.normals) if inlier_cloud.has_normals() else None

        planes.append((plane_model, inlier_points, inlier_normals))

        # Remove inliers for next iteration
        remaining_pcd = remaining_pcd.select_by_index(inliers, invert=True)

    return planes
