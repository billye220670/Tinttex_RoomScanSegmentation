import numpy as np
import open3d as o3d
from typing import List, Tuple, Dict


def calibrate_up_vector(planes: List[Tuple[np.ndarray, np.ndarray, np.ndarray]]) -> np.ndarray:
    """
    Calibrate true gravity direction by finding largest horizontal planes
    and checking which direction points from lower to higher points
    """
    if not planes:
        return np.array([0, 1, 0])

    # Find the two largest horizontal planes (likely floor and ceiling)
    horizontal_planes = []

    for plane_model, points, normals in planes:
        normal = plane_model[:3]
        normal = normal / np.linalg.norm(normal)

        # Check if roughly horizontal (dot product with Y-axis)
        if abs(abs(normal[1]) - 1.0) < 0.3:  # Within ~17 degrees of vertical
            # Calculate average height along Y-axis
            avg_y = np.mean(points[:, 1])
            horizontal_planes.append((len(points), normal, avg_y, points))

    if not horizontal_planes:
        return np.array([0, 1, 0])

    # Sort by number of points (largest first)
    horizontal_planes.sort(key=lambda x: x[0], reverse=True)

    # Take the largest horizontal plane
    largest_count, largest_normal, largest_y, largest_points = horizontal_planes[0]

    # If we have at least 2 horizontal planes, use them to determine up direction
    if len(horizontal_planes) >= 2:
        second_count, second_normal, second_y, second_points = horizontal_planes[1]

        # The up vector should point from the lower plane to the higher plane
        if largest_y < second_y:
            # Largest plane is lower (floor), up vector should point away from it
            up_vector = -largest_normal if np.dot(largest_normal, [0, 1, 0]) > 0 else largest_normal
        else:
            # Largest plane is higher (ceiling), up vector should point toward it
            up_vector = largest_normal if np.dot(largest_normal, [0, 1, 0]) > 0 else -largest_normal
    else:
        # Only one horizontal plane found
        # Check if most points are above or below this plane
        all_points_y = []
        for _, points, _ in planes:
            all_points_y.extend(points[:, 1])

        median_y = np.median(all_points_y)

        # If the plane is below median, it's likely the floor (up vector points away from normal)
        # If the plane is above median, it's likely the ceiling (up vector points toward normal)
        if largest_y < median_y:
            up_vector = -largest_normal if np.dot(largest_normal, [0, 1, 0]) > 0 else largest_normal
        else:
            up_vector = largest_normal if np.dot(largest_normal, [0, 1, 0]) > 0 else -largest_normal

    return up_vector / np.linalg.norm(up_vector)


def classify_planes(
    planes: List[Tuple[np.ndarray, np.ndarray, np.ndarray]],
    angle_tolerance: float = 5.0,
    min_area: float = 1.0,
    min_wall_area: float = 3.5,
    min_wall_points: int = 1000,
    max_wall_aspect_ratio: float = 10.0,
    cluster_radius: float = 0.1,
    min_cluster_size: int = 500
) -> Dict[str, List[Tuple[np.ndarray, np.ndarray]]]:
    """
    Classify planes into floor, ceiling, and walls

    Returns:
        Dict with keys 'floor', 'ceiling', 'wall', each containing list of (plane_model, points)
    """
    up_vector = calibrate_up_vector(planes)
    angle_threshold = np.cos(np.radians(angle_tolerance))
    perpendicular_threshold = np.cos(np.radians(85.0))  # Wall must be within 5° of perpendicular

    classified = {'floor': [], 'ceiling': [], 'wall': []}
    horizontal_planes = []

    for plane_model, points, normals in planes:
        # Calculate plane area (approximate)
        if len(points) < 3:
            continue

        area = calculate_plane_area(points)
        if area < min_area:
            continue

        normal = plane_model[:3]
        normal = normal / np.linalg.norm(normal)

        # Calculate centroid height
        centroid = np.mean(points, axis=0)
        height = np.dot(centroid, up_vector)

        # Check alignment with up vector
        alignment = abs(np.dot(normal, up_vector))

        if alignment > angle_threshold:  # Horizontal plane
            # Filter out furniture (tables, beds) at 0.5-1.2m height
            if 0.5 < height < 1.2:
                continue
            horizontal_planes.append((height, plane_model, points))
        elif alignment < perpendicular_threshold:  # Vertical plane (wall)
            # Stricter filtering for walls to remove small fragments
            if area < min_wall_area or len(points) < min_wall_points:
                continue

            # Check aspect ratio to filter out thin strips
            aspect_ratio = calculate_aspect_ratio(points, normal)
            if aspect_ratio > max_wall_aspect_ratio:
                continue

            # Filter isolated fragments using connectivity analysis
            filtered_points = filter_isolated_fragments(points, cluster_radius, min_cluster_size)
            if len(filtered_points) < min_wall_points:
                continue

            classified['wall'].append((plane_model, filtered_points))

    # Classify horizontal planes by height
    if horizontal_planes:
        horizontal_planes.sort(key=lambda x: x[0])

        # Lowest = floor
        classified['floor'].append((horizontal_planes[0][1], horizontal_planes[0][2]))

        # Highest = ceiling
        if len(horizontal_planes) > 1:
            classified['ceiling'].append((horizontal_planes[-1][1], horizontal_planes[-1][2]))

    return classified


def calculate_plane_area(points: np.ndarray) -> float:
    """Approximate plane area using convex hull"""
    if len(points) < 3:
        return 0.0

    try:
        from scipy.spatial import ConvexHull
        # Project to 2D for area calculation
        pca_mean = np.mean(points, axis=0)
        centered = points - pca_mean
        _, _, vh = np.linalg.svd(centered)
        projected = centered @ vh.T[:, :2]
        hull = ConvexHull(projected)
        return hull.volume  # In 2D, volume is area
    except:
        return 0.0


def calculate_aspect_ratio(points: np.ndarray, normal: np.ndarray) -> float:
    """
    Calculate aspect ratio of a plane (longest dimension / shortest dimension)
    to filter out thin strips
    """
    if len(points) < 3:
        return 0.0

    try:
        # Project points onto the plane's local 2D coordinate system
        pca_mean = np.mean(points, axis=0)
        centered = points - pca_mean

        # Create orthonormal basis on the plane
        normal = normal / np.linalg.norm(normal)

        # Find arbitrary perpendicular vector
        if abs(normal[0]) < 0.9:
            basis_u = np.cross(normal, np.array([1, 0, 0]))
        else:
            basis_u = np.cross(normal, np.array([0, 1, 0]))
        basis_u = basis_u / np.linalg.norm(basis_u)

        basis_v = np.cross(normal, basis_u)
        basis_v = basis_v / np.linalg.norm(basis_v)

        # Project to 2D
        points_2d = np.column_stack([
            centered @ basis_u,
            centered @ basis_v
        ])

        # Calculate bounding box dimensions
        min_coords = np.min(points_2d, axis=0)
        max_coords = np.max(points_2d, axis=0)
        dimensions = max_coords - min_coords

        # Aspect ratio = longer side / shorter side
        if dimensions[0] > 0 and dimensions[1] > 0:
            aspect_ratio = max(dimensions) / min(dimensions)
            return aspect_ratio
        else:
            return float('inf')
    except:
        return float('inf')


def filter_isolated_fragments(points: np.ndarray, radius: float = 0.1, min_cluster_size: int = 500) -> np.ndarray:
    """
    Remove isolated fragments, keep only the largest connected region

    Args:
        points: Input point cloud as numpy array
        radius: DBSCAN eps parameter for connectivity
        min_cluster_size: Minimum points required in the largest cluster

    Returns:
        Filtered points containing only the largest connected component
    """
    if len(points) < min_cluster_size:
        return np.array([])

    try:
        # Create Open3D point cloud
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(points)

        # DBSCAN clustering to find connected regions
        labels = np.array(pcd.cluster_dbscan(eps=radius, min_points=10))

        # Get unique cluster labels (excluding noise label -1)
        unique_labels = set(labels)
        unique_labels.discard(-1)

        if not unique_labels:
            return np.array([])

        # Find the largest cluster
        largest_cluster = max(unique_labels, key=lambda l: np.sum(labels == l))

        # Keep only points from the largest cluster
        mask = labels == largest_cluster
        filtered_points = points[mask]

        # Check if largest cluster meets minimum size requirement
        if len(filtered_points) >= min_cluster_size:
            return filtered_points
        else:
            return np.array([])
    except Exception as e:
        print(f"Warning: filter_isolated_fragments failed: {e}")
        return points
