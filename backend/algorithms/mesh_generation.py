import numpy as np
import trimesh
from scipy.spatial import Delaunay
from typing import List, Tuple, Dict, Optional
import io
from .plane_intersection import clip_polygon_by_neighbor_plane
from shapely.geometry import Polygon, box


def polygon_to_mesh_2d(polygon: Polygon) -> Tuple[Optional[np.ndarray], Optional[np.ndarray]]:
    """
    Convert a 2D Shapely polygon to mesh vertices and faces.
    """
    try:
        coords = np.array(polygon.exterior.coords[:-1])
        if len(coords) < 3:
            return None, None
        tri = Delaunay(coords)
        return coords, tri.simplices
    except Exception as e:
        print(f"[Polygon Mesh] Failed to triangulate: {e}")
        return None, None


def project_to_2d(points: np.ndarray, plane_normal: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Project 3D points to 2D plane coordinate system.

    Returns:
        points_2d, basis_u, basis_v
    """
    normal = plane_normal / np.linalg.norm(plane_normal)

    if abs(normal[0]) < 0.9:
        basis_u = np.cross(normal, [1, 0, 0])
    else:
        basis_u = np.cross(normal, [0, 1, 0])

    basis_u = basis_u / np.linalg.norm(basis_u)
    basis_v = np.cross(normal, basis_u)

    centroid = np.mean(points, axis=0)
    centered = points - centroid
    points_2d = np.column_stack([
        np.dot(centered, basis_u),
        np.dot(centered, basis_v)
    ])

    return points_2d, basis_u, basis_v


def generate_low_poly_mesh(
    plane_model: np.ndarray,
    points: np.ndarray,
    alpha: float = 1.0,
    expand_margin: float = 0.3,
    semantic_label: Optional[str] = None,
    floor_plane: Optional[np.ndarray] = None,
    ceiling_plane: Optional[np.ndarray] = None,
    wall_planes: Optional[List[Tuple[np.ndarray, np.ndarray]]] = None,
    enable_trimming: bool = False
) -> trimesh.Trimesh:
    """
    Generate low-poly mesh from plane points with Phase 2 intelligent trimming.

    Phase 1: Expand to rectangle
    Phase 2: Clip by neighbor planes (walls, floor, ceiling)
    """
    if len(points) < 3:
        return None

    print(f"[Mesh Gen] {semantic_label}: expand={expand_margin:.2f}, trimming={enable_trimming}")

    normal = plane_model[:3] / np.linalg.norm(plane_model[:3])
    points_2d, basis_u, basis_v = project_to_2d(points, normal)

    # Phase 1: Expanded bounding box
    min_u, max_u = np.min(points_2d[:, 0]), np.max(points_2d[:, 0])
    min_v, max_v = np.min(points_2d[:, 1]), np.max(points_2d[:, 1])

    min_u -= expand_margin
    max_u += expand_margin
    min_v -= expand_margin
    max_v += expand_margin

    polygon = box(min_u, min_v, max_u, max_v)

    # Phase 2: Clip by neighbor planes
    if enable_trimming:
        centroid_3d = np.mean(points, axis=0)
        d = plane_model[3]
        projected_centroid = centroid_3d - (np.dot(normal, centroid_3d) + d) * normal

        neighbor_planes = []

        if semantic_label == 'wall':
            # Walls are clipped by floor, ceiling, and other walls
            if floor_plane is not None:
                neighbor_planes.append(floor_plane)
            if ceiling_plane is not None:
                neighbor_planes.append(ceiling_plane)
            if wall_planes:
                for other_plane, _ in wall_planes:
                    if not np.allclose(other_plane, plane_model):
                        neighbor_planes.append(other_plane)

        elif semantic_label in ['floor', 'ceiling']:
            # Floor/ceiling are clipped by all walls
            if wall_planes:
                neighbor_planes = [wp for wp, _ in wall_planes]

        print(f"[Mesh Gen] Clipping {semantic_label} against {len(neighbor_planes)} neighbors")

        for neighbor in neighbor_planes:
            polygon = clip_polygon_by_neighbor_plane(
                polygon,
                plane_model,
                projected_centroid,
                basis_u,
                basis_v,
                neighbor
            )

        if polygon.is_empty or polygon.area < 0.01:
            print(f"[Mesh Gen] Polygon too small after clipping, skipping")
            return None

    # Convert polygon to mesh
    vertices_2d, faces = polygon_to_mesh_2d(polygon)
    if vertices_2d is None or faces is None:
        print(f"[Mesh Gen] Failed to triangulate polygon")
        return None

    # Back-project to 3D
    try:
        centroid_3d = np.mean(points, axis=0)
        d = plane_model[3]
        projected_centroid = centroid_3d - (np.dot(normal, centroid_3d) + d) * normal

        basis_matrix = np.vstack([basis_u, basis_v]).T
        vertices_3d = projected_centroid + vertices_2d @ basis_matrix.T

        mesh = trimesh.Trimesh(
            vertices=vertices_3d,
            faces=faces,
            process=False
        )
        mesh.fix_normals()

        print(f"[Mesh Gen] Generated mesh: {len(vertices_3d)} vertices, {len(faces)} faces")
        return mesh

    except Exception as e:
        print(f"[Mesh Gen] Error: {e}")
        return None


def export_to_glb(meshes_by_label: Dict[str, List[trimesh.Trimesh]]) -> bytes:
    """
    Export classified meshes to GLB format with semantic colors.
    """
    color_map = {
        'floor': [76, 175, 80, 255],
        'ceiling': [244, 67, 54, 255],
        'wall': [33, 150, 243, 255]
    }

    combined_meshes = []

    for label, meshes in meshes_by_label.items():
        color = color_map.get(label, [128, 128, 128, 255])
        for mesh in meshes:
            if mesh is not None and len(mesh.vertices) > 0:
                mesh.visual.vertex_colors = color
                combined_meshes.append(mesh)

    if not combined_meshes:
        return None

    scene = trimesh.Scene(combined_meshes)
    output = io.BytesIO()
    scene.export(output, file_type='glb')
    return output.getvalue()
