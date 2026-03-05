import numpy as np
import trimesh
from scipy.spatial import Delaunay
from typing import List, Tuple, Dict
import io


def project_to_2d(points: np.ndarray, plane_normal: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Project 3D points to 2D plane coordinate system

    Returns:
        points_2d, basis_u, basis_v
    """
    normal = plane_normal / np.linalg.norm(plane_normal)

    # Create orthonormal basis
    if abs(normal[0]) < 0.9:
        basis_u = np.cross(normal, [1, 0, 0])
    else:
        basis_u = np.cross(normal, [0, 1, 0])

    basis_u = basis_u / np.linalg.norm(basis_u)
    basis_v = np.cross(normal, basis_u)

    # Project points
    centroid = np.mean(points, axis=0)
    centered = points - centroid
    points_2d = np.column_stack([
        np.dot(centered, basis_u),
        np.dot(centered, basis_v)
    ])

    return points_2d, basis_u, basis_v


def compute_alpha_shape(points_2d: np.ndarray, alpha: float = 0.5) -> List[Tuple[int, int]]:
    """
    Compute alpha shape (concave hull) using Delaunay triangulation

    Returns:
        List of edge indices forming the boundary
    """
    if len(points_2d) < 3:
        return []

    try:
        tri = Delaunay(points_2d)
        edges = set()

        # For each triangle, check edge lengths
        for simplex in tri.simplices:
            for i in range(3):
                edge = tuple(sorted([simplex[i], simplex[(i+1)%3]]))
                p1, p2 = points_2d[edge[0]], points_2d[edge[1]]
                length = np.linalg.norm(p1 - p2)

                # Alpha shape criterion
                if length < alpha:
                    edges.add(edge)

        return list(edges)
    except:
        return []


def generate_low_poly_mesh(
    plane_model: np.ndarray,
    points: np.ndarray,
    alpha: float = 1.0
) -> trimesh.Trimesh:
    """
    Generate low-poly mesh from plane points using alpha shape
    """
    if len(points) < 3:
        return None

    normal = plane_model[:3]
    normal = normal / np.linalg.norm(normal)

    # Project to 2D
    points_2d, basis_u, basis_v = project_to_2d(points, normal)

    # Compute alpha shape boundary
    edges = compute_alpha_shape(points_2d, alpha)

    if not edges:
        return None

    # Triangulate the 2D boundary
    try:
        tri = Delaunay(points_2d)

        # Back-project to 3D using correct matrix multiplication
        centroid_3d = np.mean(points, axis=0)
        # Project centroid onto the plane: centroid - (n·centroid + d) * n
        d = plane_model[3]
        projected_centroid = centroid_3d - (np.dot(normal, centroid_3d) + d) * normal

        # Reconstruct 3D vertices from 2D coordinates
        basis_matrix = np.vstack([basis_u, basis_v]).T  # 3x2 matrix
        vertices_3d = projected_centroid + points_2d @ basis_matrix.T

        # Create mesh
        mesh = trimesh.Trimesh(
            vertices=vertices_3d,
            faces=tri.simplices,
            process=False
        )

        # Fix normals
        mesh.fix_normals()

        return mesh
    except:
        return None


def export_to_glb(meshes_by_label: Dict[str, List[trimesh.Trimesh]]) -> bytes:
    """
    Export classified meshes to GLB format with semantic colors

    Colors:
        floor: green (0x4CAF50)
        ceiling: red (0xF44336)
        wall: blue (0x2196F3)
    """
    color_map = {
        'floor': [76, 175, 80, 255],      # Green
        'ceiling': [244, 67, 54, 255],    # Red
        'wall': [33, 150, 243, 255]       # Blue
    }

    combined_meshes = []

    for label, meshes in meshes_by_label.items():
        color = color_map.get(label, [128, 128, 128, 255])

        for mesh in meshes:
            if mesh is not None and len(mesh.vertices) > 0:
                # Apply color
                mesh.visual.vertex_colors = color
                combined_meshes.append(mesh)

    if not combined_meshes:
        return None

    # Combine all meshes
    scene = trimesh.Scene(combined_meshes)

    # Export to GLB
    output = io.BytesIO()
    scene.export(output, file_type='glb')
    return output.getvalue()
