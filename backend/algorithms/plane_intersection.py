import numpy as np
from typing import List, Tuple, Optional
from shapely.geometry import Polygon, Point
from shapely.errors import GEOSException


def plane_plane_intersection(
    plane1: np.ndarray,
    plane2: np.ndarray
) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    """
    Calculate intersection line between two planes.

    Returns:
        (line_point, line_direction) or None if planes are parallel
    """
    n1 = plane1[:3]
    n2 = plane2[:3]

    line_dir = np.cross(n1, n2)
    if np.linalg.norm(line_dir) < 1e-6:
        return None
    line_dir = line_dir / np.linalg.norm(line_dir)

    # Find a point on the line by solving 2x2 systems
    b = np.array([-plane1[3], -plane2[3]])
    for (i, j) in [(0, 1), (0, 2), (1, 2)]:
        A = np.array([[n1[i], n1[j]], [n2[i], n2[j]]])
        if abs(np.linalg.det(A)) > 1e-6:
            coords = np.linalg.solve(A, b)
            point = np.zeros(3)
            point[i] = coords[0]
            point[j] = coords[1]
            return point, line_dir

    return None


def clip_polygon_by_neighbor_plane(
    polygon: Polygon,
    target_plane: np.ndarray,
    projected_centroid: np.ndarray,
    basis_u: np.ndarray,
    basis_v: np.ndarray,
    neighbor_plane: np.ndarray,
) -> Polygon:
    """
    Clip a 2D polygon using the intersection line of target_plane and neighbor_plane.
    Keeps the half of the polygon that contains (0, 0) — the projected centroid.

    This is the core of Phase 2 trimming and works uniformly for:
      - Wall trimmed by floor/ceiling
      - Wall trimmed by adjacent walls
      - Floor/ceiling trimmed by walls
    """
    result = plane_plane_intersection(target_plane, neighbor_plane)
    if result is None:
        return polygon  # Parallel, no clipping

    line_point_3d, line_dir_3d = result

    # Project two points on the intersection line into the plane's local 2D system
    P1_3d = line_point_3d
    P2_3d = line_point_3d + line_dir_3d

    def to_2d(pt):
        c = pt - projected_centroid
        return np.array([np.dot(c, basis_u), np.dot(c, basis_v)])

    P1 = to_2d(P1_3d)
    P2 = to_2d(P2_3d)

    seg = P2 - P1
    seg_len = np.linalg.norm(seg)
    if seg_len < 1e-9:
        return polygon

    # Normal to the line in 2D (two possible directions)
    normal_2d = np.array([seg[1], -seg[0]]) / seg_len

    # Check which side (0,0) is on
    side = np.dot(-P1, normal_2d)  # dot(centroid - P1, normal_2d)

    if side < 0:
        normal_2d = -normal_2d  # Flip so normal points toward centroid

    # Build a large half-plane polygon on the centroid's side
    R = 1e4
    seg_unit = seg / seg_len
    c1 = P1 - R * seg_unit
    c2 = P2 + R * seg_unit
    halfplane = Polygon([
        (c1[0], c1[1]),
        (c2[0], c2[1]),
        (c2[0] + R * normal_2d[0], c2[1] + R * normal_2d[1]),
        (c1[0] + R * normal_2d[0], c1[1] + R * normal_2d[1]),
    ])

    try:
        clipped = polygon.intersection(halfplane)
    except GEOSException:
        return polygon

    if clipped.is_empty:
        # Don't clip to nothing — return the original
        return polygon

    # If MultiPolygon, keep the piece containing the centroid
    if clipped.geom_type == 'MultiPolygon':
        origin = Point(0, 0)
        best = max(clipped.geoms, key=lambda g: -origin.distance(g) + g.area)
        return best

    return clipped
