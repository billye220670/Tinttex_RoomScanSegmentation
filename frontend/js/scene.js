import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ViewportRaycaster } from './viewport-raycaster.js';

let scene, camera, renderer, controls;
let originalModel = null;
let lowPolyGroup = null;
let currentLowPolyData = null;
let markerSphere = null;
let markerShape = 'point';
let alignToNormal = true;

// Camera preview viewport
let fixedCamera, previewRenderer;
const _previewRaycaster = new ViewportRaycaster();

// Display mode state per label: 'solid' | 'checker' | 'grid'
const displayModes = { wall: 'solid', ceiling: 'solid', floor: 'solid' };
const checkerTextures = {};
const gridTextures = {};

const CHECKER_COLORS = {
    wall:    ['#3a7abf', '#c8e0ff'],
    ceiling: ['#bf3a3a', '#ffc8c8'],
    floor:   ['#3a9e3a', '#c8f0c8'],
};

const SEMANTIC_COLORS = {
    floor: 0x4CAF50,
    ceiling: 0xF44336,
    wall: 0x2196F3
};

export function initScene() {
    const container = document.getElementById('canvas-container');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);

    camera = new THREE.PerspectiveCamera(
        60,
        container.clientWidth / container.clientHeight,
        0.1,
        1000
    );
    camera.position.set(5, 5, 5);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.zoomSpeed = 0.35;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 10);
    scene.add(directionalLight);

    const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
    scene.add(gridHelper);

    window.addEventListener('resize', onWindowResize);

    camera.layers.enable(1);
    createMarker();

    animate();
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

function createMarker() {
    markerSphere = new THREE.Object3D();
    markerSphere.visible = false;
    scene.add(markerSphere);
    rebuildMarkerGeometry();
}

function rebuildMarkerGeometry() {
    // Dispose and remove all existing children
    while (markerSphere.children.length > 0) {
        const child = markerSphere.children[0];
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
        markerSphere.remove(child);
    }

    const color = 0xffee00;

    if (markerShape === 'point') {
        const inner = new THREE.Mesh(
            new THREE.SphereGeometry(0.04, 16, 16),
            new THREE.MeshBasicMaterial({ color })
        );
        inner.layers.set(1);
        markerSphere.add(inner);

        const glow = new THREE.Mesh(
            new THREE.SphereGeometry(0.10, 16, 16),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.BackSide })
        );
        glow.layers.set(1);
        markerSphere.add(glow);

    } else if (markerShape === 'cone') {
        const h = 0.20, r = 0.04;
        const cone = new THREE.Mesh(
            new THREE.ConeGeometry(r, h, 16),
            new THREE.MeshBasicMaterial({ color })
        );
        cone.position.y = h / 2; // base at origin, tip points +Y
        cone.layers.set(1);
        markerSphere.add(cone);

        const glow = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 12, 12),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.20, side: THREE.BackSide })
        );
        glow.layers.set(1);
        markerSphere.add(glow);

    } else if (markerShape === 'square') {
        const size = 0.20;
        const square = new THREE.Mesh(
            new THREE.PlaneGeometry(size, size),
            new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
        );
        square.rotation.x = -Math.PI / 2; // flat horizontal by default; normal faces +Y
        square.layers.set(1);
        markerSphere.add(square);

        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.PlaneGeometry(size, size)),
            new THREE.LineBasicMaterial({ color: 0xffffff })
        );
        edges.rotation.x = -Math.PI / 2;
        edges.layers.set(1);
        markerSphere.add(edges);

    } else if (markerShape === 'sphere') {
        const ball = new THREE.Mesh(
            new THREE.SphereGeometry(0.08, 16, 16),
            new THREE.MeshBasicMaterial({ color })
        );
        ball.layers.set(1);
        markerSphere.add(ball);

        const glow = new THREE.Mesh(
            new THREE.SphereGeometry(0.16, 16, 16),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.20, side: THREE.BackSide })
        );
        glow.layers.set(1);
        markerSphere.add(glow);
    }

    // Point light for all shapes
    const pt = new THREE.PointLight(color, 1.5, 2.0);
    pt.layers.set(1);
    markerSphere.add(pt);
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

export function updateCameraFOV(fov) {
    if (fixedCamera) {
        fixedCamera.fov = fov;
        fixedCamera.updateProjectionMatrix();
    }
}

export function setPreviewOpacity(opacity) {
    // opacity: 0-100
    if (previewRenderer) {
        previewRenderer.domElement.style.opacity = (opacity / 100).toString();
    }
}

export function setDisplayMode(label, mode) {
    displayModes[label] = mode;
    applyDisplayModes();
}

export function setMarkerShape(shape) {
    markerShape = shape;
    if (markerSphere) rebuildMarkerGeometry();
}

export function setAlignToNormal(enabled) {
    alignToNormal = enabled;
    if (!enabled && markerSphere) markerSphere.quaternion.identity();
}

function createGridTexture(label) {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Transparent background — only lines are drawn
    ctx.clearRect(0, 0, size, size);

    const minorColors = {
        wall:    'rgba(50, 120, 220, 0.55)',
        ceiling: 'rgba(220, 50, 50, 0.55)',
        floor:   'rgba(40, 160, 40, 0.55)',
    };
    const majorColors = {
        wall:    'rgba(20, 80, 180, 0.9)',
        ceiling: 'rgba(180, 20, 20, 0.9)',
        floor:   'rgba(20, 130, 20, 0.9)',
    };

    const divisions = 16;
    const step = size / divisions;

    // Minor grid lines
    ctx.strokeStyle = minorColors[label] || 'rgba(100,100,100,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= divisions; i++) {
        const pos = i * step;
        ctx.moveTo(pos, 0); ctx.lineTo(pos, size);
        ctx.moveTo(0, pos); ctx.lineTo(size, pos);
    }
    ctx.stroke();

    // Major grid lines every 4 cells
    ctx.strokeStyle = majorColors[label] || 'rgba(60,60,60,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= divisions; i += 4) {
        const pos = i * step;
        ctx.moveTo(pos, 0); ctx.lineTo(pos, size);
        ctx.moveTo(0, pos); ctx.lineTo(size, pos);
    }
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

function createCheckerTexture(label) {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const tiles = 8;
    const tileSize = size / tiles;
    const [colorA, colorB] = CHECKER_COLORS[label] || ['#cccccc', '#888888'];
    for (let y = 0; y < tiles; y++) {
        for (let x = 0; x < tiles; x++) {
            ctx.fillStyle = (x + y) % 2 === 0 ? colorA : colorB;
            ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
        }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

function getLabelFromMesh(child) {
    // Try by node/mesh name first
    const name = child.name || '';
    if (/^floor/i.test(name)) return 'floor';
    if (/^ceiling/i.test(name)) return 'ceiling';
    if (/^wall/i.test(name)) return 'wall';

    // Fallback: detect by vertex color
    const colors = child.geometry && child.geometry.attributes.color;
    if (colors && colors.count > 0) {
        const r = colors.getX(0), g = colors.getY(0), b = colors.getZ(0);
        if (g > 0.6 && r < 0.5 && b < 0.5) return 'floor';
        if (r > 0.7 && g < 0.4) return 'ceiling';
        if (b > 0.7 && r < 0.3) return 'wall';
    }
    return null;
}

function generatePlanarUVs(geometry) {
    geometry.computeVertexNormals();
    const normals = geometry.attributes.normal;
    const positions = geometry.attributes.position;

    // Compute average normal
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < normals.count; i++) {
        nx += normals.getX(i);
        ny += normals.getY(i);
        nz += normals.getZ(i);
    }
    const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nlen > 0) { nx /= nlen; ny /= nlen; nz /= nlen; }

    // Compute tangent (horizontal direction in the plane)
    let tx, ty = 0, tz;
    if (Math.abs(ny) > 0.9) {
        // Horizontal surface
        tx = 1; tz = 0;
    } else {
        const hlen = Math.sqrt(nx * nx + nz * nz);
        tx = hlen > 0 ? -nz / hlen : 1;
        tz = hlen > 0 ? nx / hlen : 0;
    }

    // Bitangent = N x T
    const bx = ny * tz - nz * ty;
    const by = nz * tx - nx * tz;
    const bz = nx * ty - ny * tx;

    // Centroid
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < positions.count; i++) {
        cx += positions.getX(i);
        cy += positions.getY(i);
        cz += positions.getZ(i);
    }
    cx /= positions.count;
    cy /= positions.count;
    cz /= positions.count;

    const scale = 0.5; // 2m per checker tile
    const uvs = new Float32Array(positions.count * 2);
    for (let i = 0; i < positions.count; i++) {
        const dx = positions.getX(i) - cx;
        const dy = positions.getY(i) - cy;
        const dz = positions.getZ(i) - cz;
        uvs[i * 2]     = (dx * tx + dy * ty + dz * tz) * scale;
        uvs[i * 2 + 1] = (dx * bx + dy * by + dz * bz) * scale;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

function applyDisplayModes() {
    if (!lowPolyGroup) return;

    lowPolyGroup.traverse((child) => {
        if (!child.isMesh) return;

        const label = getLabelFromMesh(child);
        if (!label) return;

        const mode = displayModes[label];
        const color = SEMANTIC_COLORS[label];

        if (mode === 'solid') {
            child.material = new THREE.MeshLambertMaterial({
                color,
                side: THREE.DoubleSide,
                flatShading: true
            });
        } else if (mode === 'checker') {
            if (!checkerTextures[label]) checkerTextures[label] = createCheckerTexture(label);
            if (!child.geometry.attributes.uv) {
                generatePlanarUVs(child.geometry);
            }
            child.material = new THREE.MeshBasicMaterial({
                map: checkerTextures[label],
                side: THREE.DoubleSide
            });
        } else if (mode === 'grid') {
            if (!gridTextures[label]) gridTextures[label] = createGridTexture(label);
            if (!child.geometry.attributes.uv) {
                generatePlanarUVs(child.geometry);
            }
            child.material = new THREE.MeshBasicMaterial({
                map: gridTextures[label],
                transparent: true,
                side: THREE.DoubleSide
            });
        }
    });
}

export function loadOriginalModel() {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();

        loader.load(
            '/TestScene.glb',
            (gltf) => {
                if (originalModel) {
                    scene.remove(originalModel);
                }

                originalModel = gltf.scene;

                // Make semi-transparent
                originalModel.traverse((child) => {
                    if (child.isMesh) {
                        child.material = child.material.clone();
                        child.material.transparent = true;
                        child.material.opacity = 0.3;
                        child.material.depthWrite = false;
                    }
                });

                scene.add(originalModel);

                // Center camera on model
                const box = new THREE.Box3().setFromObject(originalModel);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());

                controls.target.copy(center);
                camera.position.set(
                    center.x + size.x,
                    center.y + size.y,
                    center.z + size.z
                );

                // Set zoom limits based on actual model scale to prevent
                // camera from passing through the target (which breaks orbit)
                const maxDim = Math.max(size.x, size.y, size.z);
                controls.minDistance = maxDim * 0.08;
                controls.maxDistance = maxDim * 25;
                controls.update();
                resolve();
            },
            undefined,
            (error) => {
                reject(error);
            }
        );
    });
}

export function addLowPolyOverlay(base64glb) {
    return new Promise((resolve, reject) => {
        clearLowPoly();
        currentLowPolyData = base64glb;

        // Decode base64 to ArrayBuffer
        const binaryString = atob(base64glb);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const loader = new GLTFLoader();
        loader.parse(
            bytes.buffer,
            '',
            (gltf) => {
                lowPolyGroup = gltf.scene;
                scene.add(lowPolyGroup);
                // Apply current display modes to newly loaded meshes
                applyDisplayModes();
                resolve();
            },
            (error) => {
                reject(error);
            }
        );
    });
}

export function clearLowPoly() {
    if (lowPolyGroup) {
        scene.remove(lowPolyGroup);
        lowPolyGroup = null;
    }
}

export function getCurrentLowPolyData() {
    return currentLowPolyData;
}

export function hideOriginalModel() {
    if (originalModel) originalModel.visible = false;
}

export function initCameraPreview() {
    const container = document.getElementById('camera-preview-container');

    // Image aspect ratio: 3414 / 2560
    const imageAspect = 3414 / 2560;

    // Create fixed camera at origin (0,0,0) with zero rotation
    fixedCamera = new THREE.PerspectiveCamera(
        60,
        imageAspect,
        0.1,
        1000
    );
    fixedCamera.position.set(0, 0, 0);
    fixedCamera.rotation.set(0, 0, 0);

    scene.add(fixedCamera);

    // Preview Renderer with transparent background
    previewRenderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true
    });
    previewRenderer.setClearColor(0x000000, 0);
    previewRenderer.setSize(container.clientWidth, container.clientHeight, false);
    previewRenderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(previewRenderer.domElement);

    previewRenderer.domElement.style.cursor = 'crosshair';
    previewRenderer.domElement.addEventListener('mousemove', onPreviewMouseMove);
    previewRenderer.domElement.addEventListener('mouseleave', onPreviewMouseLeave);

    window.addEventListener('resize', onPreviewResize);
    animatePreview();
}

function onPreviewResize() {
    const container = document.getElementById('camera-preview-container');
    if (fixedCamera && previewRenderer) {
        const imageAspect = 3414 / 2560;
        fixedCamera.aspect = imageAspect;
        fixedCamera.updateProjectionMatrix();
        previewRenderer.setSize(container.clientWidth, container.clientHeight, false);
    }
}

function onPreviewMouseMove(event) {
    if (!lowPolyGroup || !markerSphere) return;

    const meshes = [];
    lowPolyGroup.traverse(child => { if (child.isMesh) meshes.push(child); });

    const hit = _previewRaycaster.cast(
        event, previewRenderer.domElement, fixedCamera, meshes
    );

    if (hit) {
        markerSphere.position.copy(hit.point);

        if (alignToNormal && hit.face) {
            const worldNormal = hit.face.normal.clone()
                .transformDirection(hit.object.matrixWorld);
            markerSphere.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, 1, 0), worldNormal
            );
        } else {
            markerSphere.quaternion.identity();
        }

        markerSphere.visible = true;
    } else {
        markerSphere.visible = false;
    }
}

function onPreviewMouseLeave() {
    if (markerSphere) markerSphere.visible = false;
}

function animatePreview() {
    requestAnimationFrame(animatePreview);

    // Temporarily remove scene background for transparent rendering
    const originalBackground = scene.background;
    scene.background = null;

    previewRenderer.render(scene, fixedCamera);

    // Restore original background
    scene.background = originalBackground;
}
