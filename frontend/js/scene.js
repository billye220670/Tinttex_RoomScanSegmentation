import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ViewportRaycaster } from './viewport-raycaster.js';
import { SelectionManager } from './selection-manager.js';
import { DragDropLoader } from './drag-drop-loader.js';

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

// Drag-drop and selection system
let droppedModels = [];
let _selectionManager = null;
const _mainRaycaster = new ViewportRaycaster();

// Transform gizmo
let transformControls = null;
let transformMode = 'translate'; // 'translate'|'rotate'|'scale'|'select'
let _lastScalePerAxis = { x: 1, y: 1, z: 1 }; // Track scale to prevent over-scaling
let _justFinishedDragging = false; // Prevent click after dragging from deselecting

// Preview viewport interaction state
let _previewDraggingModel = null;
let _lastSelectionSource = 'main'; // Track selection source: 'main' or 'preview'
let _previewInteractionMode = 'select'; // 'select' | 'paint'

// Wall texture drag-drop state
let currentWallTexture = null;       // 用户拖入的自定义贴图（仅保存图像源，变换独立于每面墙）
let _textureDragging = false;        // 是否正在拖动贴图
let _textureDragMesh = null;         // 当前被拖动贴图的具体mesh
let _textureDragStartX = 0;          // 拖动起始屏幕X坐标
let _textureDragStartY = 0;          // 拖动起始屏幕Y坐标
let _textureDragStartOffsetX = 0;    // 拖动起始texture.offset.x
let _textureDragStartOffsetY = 0;    // 拖动起始texture.offset.y
let _textureDragDepth = 0;           // 拖动起始的相机到hit点距离

// Main viewport drag detection (to prevent click selection after camera drag)
let _mainViewportMouseDownPos = null;
let _mainViewportWasDragged = false;

// Display mode state per label: 'solid' | 'checker' | 'grid' | 'none'
// NOTE: 默认设为 'checker' 而非 'solid'，是为了绕过一个 Three.js r160 的已知问题：
// 当低模 mesh 材质首次以 MeshLambertMaterial 编译时（尚无任何投影源），
// 之后拖入带 castShadow 的模型也不会自动出现投影，必须手动切换一次 display mode
// 才能触发材质重新编译从而让阴影生效。
// 根本原因未能定位（疑似 WebGLPrograms 程序缓存与 shadow uniform 绑定的时序问题），
// 暂以 checker 作为默认值规避——checker 模式会生成 UV 并使用 MeshBasicMaterial，
// 切回任意支持阴影的模式时 program hash 不同，强制重新编译，阴影即可正常显示。
const displayModes = { wall: 'checker', ceiling: 'checker', floor: 'checker' };
const checkerTextures = {};
const gridTextures = {};

// Light reference
let directionalLight = null;

// Grid helper reference
let gridHelper = null;

// Per-renderer shadow map cache (two renderers share the scene but have different GL contexts)
let _mainShadowMap = null;
let _previewShadowMap = null;

const CHECKER_COLORS = {
    wall:    ['#3a7abf', '#c8e0ff'],
    ceiling: ['#3a9e3a', '#c8f0c8'],  // Swapped: was floor (green)
    floor:   ['#bf3a3a', '#ffc8c8'],  // Swapped: was ceiling (red)
};

const SEMANTIC_COLORS = {
    floor: 0xF44336,   // Swapped: red (was ceiling color)
    ceiling: 0x4CAF50, // Swapped: green (was floor color)
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
    renderer.sortObjects = true; // Ensure renderOrder is respected
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.zoomSpeed = 0.35;

    // Initialize Transform Gizmo
    transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.addEventListener('change', () => {
        // Apply sensitivity damping to scale (like mainstream 3D software)
        if (transformMode === 'scale' && transformControls.object) {
            const obj = transformControls.object;
            const minScale = 0.1;
            const maxScale = 10;
            const sensitivityDamping = 0.3; // 30% of intended scale change

            ['x', 'y', 'z'].forEach(axis => {
                let newScale = obj.scale[axis];

                // Prevent negative scale
                if (newScale < 0) newScale = -newScale;

                const lastScale = _lastScalePerAxis[axis];
                if (lastScale > 0) {
                    // Calculate scale factor (how much it changed)
                    const scaleFactor = newScale / lastScale;

                    // Apply damping: reduce sensitivity by multiplying factor change by damping coefficient
                    // e.g., if it wanted to scale by 2x, damping makes it 1.3x instead
                    const dampedScaleFactor = 1 + (scaleFactor - 1) * sensitivityDamping;

                    newScale = lastScale * dampedScaleFactor;
                }

                // Clamp to absolute limits
                newScale = Math.max(minScale, Math.min(maxScale, newScale));

                obj.scale[axis] = newScale;
                _lastScalePerAxis[axis] = newScale;
            });
        }
        renderer.render(scene, camera);
    });
    transformControls.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value;

        // When dragging stops, keep the gizmo attached and prevent click from deselecting
        if (!event.value) {
            _justFinishedDragging = true;
            // Reset the flag after a short delay so next click won't be ignored
            setTimeout(() => {
                _justFinishedDragging = false;
            }, 100);
        }
    });

    // Configure gizmo to not be occluded by other objects
    _configureGizmoRendering(transformControls);

    scene.add(transformControls);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(10, 10, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(4096, 4096);
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 100;
    directionalLight.shadow.camera.left = -25;
    directionalLight.shadow.camera.right = 25;
    directionalLight.shadow.camera.top = 25;
    directionalLight.shadow.camera.bottom = -25;
    directionalLight.shadow.bias = -0.0005;
    directionalLight.shadow.normalBias = 0.01;
    scene.add(directionalLight);
    scene.add(directionalLight.target); // Required for shadow camera matrix to be computed correctly

    gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
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
    if (label === 'wall' && currentWallTexture) {
        currentWallTexture.dispose();
        currentWallTexture = null;
        _updateTextureIndicator();
    }
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
    // GLTFLoader sometimes places the node name on the parent Object3D,
    // leaving the child Mesh with an empty name. Check both.
    const name = child.name || (child.parent && child.parent.name) || '';
    if (/^floor/i.test(name)) return 'ceiling';
    if (/^ceiling/i.test(name)) return 'floor';
    if (/^wall/i.test(name)) return 'wall';

    // Fallback: detect by vertex color
    const colors = child.geometry && child.geometry.attributes.color;
    if (colors && colors.count > 0) {
        const r = colors.getX(0), g = colors.getY(0), b = colors.getZ(0);
        if (g > 0.6 && r < 0.5 && b < 0.5) return 'ceiling';
        if (r > 0.7 && g < 0.4) return 'floor';
        if (b > 0.7 && r < 0.3) return 'wall';
    }
    return null;
}

function generatePlanarUVs(geometry) {
    geometry.computeVertexNormals();
    const normals = geometry.attributes.normal;
    const positions = geometry.attributes.position;

    // Compute average normal
    const N = new THREE.Vector3();
    const tmpN = new THREE.Vector3();
    for (let i = 0; i < normals.count; i++) {
        tmpN.fromBufferAttribute(normals, i);
        N.add(tmpN);
    }
    N.normalize();

    // T = cross(Y_world, N) — guaranteed horizontal for any wall orientation:
    // The cross product of Y=(0,1,0) and N always has ty=0, so T lies flat in
    // world space no matter how N is rotated. Only depends on N, so it remains
    // stable after Phase-2 trimming which changes polygon shape but not N.
    // Special case: floor/ceiling (N ≈ Y) — use world X instead.
    const Y_WORLD = new THREE.Vector3(0, 1, 0);
    let T;
    if (Math.abs(N.dot(Y_WORLD)) > 0.9) {
        // Horizontal surface (floor/ceiling)
        T = new THREE.Vector3(1, 0, 0);
        T.addScaledVector(N, -T.dot(N)).normalize();
    } else {
        // Wall: T = cross(Y, N) — always horizontal, ty = 0
        T = new THREE.Vector3().crossVectors(Y_WORLD, N).normalize();
    }

    // B = N × T — lies in the plane, approximately world-up for walls
    const B = new THREE.Vector3().crossVectors(N, T).normalize();

    // Project each vertex onto T (horizontal) and B (vertical-in-plane)
    const count = positions.count;
    const ru = new Float32Array(count);
    const rv = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        ru[i] = x * T.x + y * T.y + z * T.z;
        rv[i] = x * B.x + y * B.y + z * B.z;
    }

    // Sort all vertex indices by V (B-axis = vertical), split into bottom / top halves,
    // then sort each half by U (T-axis = horizontal).
    // Assign corners: bottom-left→(0,0), bottom-right→(1,0), top-left→(0,1), top-right→(1,1).
    // This guarantees the texture fills [0,1]×[0,1] regardless of how irregular the quad is,
    // because the two triangles together cover the full UV square exactly.
    const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => rv[a] - rv[b]);
    const bN = Math.ceil(count / 2);
    const tN = count - bN;
    const bottom = order.slice(0, bN).sort((a, b) => ru[a] - ru[b]);
    const top    = order.slice(bN).sort((a, b) => ru[a] - ru[b]);

    const uvs = new Float32Array(count * 2);
    bottom.forEach((vi, k) => {
        uvs[vi * 2]     = bN > 1 ? k / (bN - 1) : 0.5;
        uvs[vi * 2 + 1] = 0;
    });
    top.forEach((vi, k) => {
        uvs[vi * 2]     = tN > 1 ? k / (tN - 1) : 0.5;
        uvs[vi * 2 + 1] = 1;
    });
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

function _applyWallTextureToMeshes() {
    if (!lowPolyGroup || !currentWallTexture) return;
    lowPolyGroup.traverse((child) => {
        if (!child.isMesh) return;
        if (getLabelFromMesh(child) !== 'wall') return;
        const tex = currentWallTexture.clone();
        tex.center.set(0.5, 0.5); // rotate around texture center
        tex.needsUpdate = true;
        child.receiveShadow = true;
        child.material = new THREE.MeshLambertMaterial({
            map: tex,
            side: THREE.FrontSide,
        });
        child.material.needsUpdate = true;
    });
}

function _updateTextureIndicator() {
    const indicator = document.getElementById('wall-texture-indicator');
    if (!indicator) return;
    indicator.style.display = currentWallTexture ? 'flex' : 'none';
}

export function clearWallTexture() {
    if (currentWallTexture) {
        currentWallTexture.dispose();
        currentWallTexture = null;
    }
    _updateTextureIndicator();
    applyDisplayModes();
}

export function setPreviewInteractionMode(mode) {
    _previewInteractionMode = mode;
    // Reset any in-progress drag when switching modes
    _textureDragging = false;
    _textureDragMesh = null;
    _previewDraggingModel = null;
    // Restore cursor based on new mode
    if (previewRenderer) {
        previewRenderer.domElement.style.cursor = 'crosshair';
    }
}

function applyDisplayModes() {
    if (!lowPolyGroup) return;

    lowPolyGroup.traverse((child) => {
        if (!child.isMesh) return;

        const label = getLabelFromMesh(child);
        if (!label) return;

        const mode = displayModes[label];
        const color = SEMANTIC_COLORS[label];

        child.receiveShadow = false;
        child.castShadow = false;

        // Custom texture override for walls
        if (label === 'wall' && currentWallTexture) {
            const tex = currentWallTexture.clone();
            tex.center.set(0.5, 0.5);
            tex.needsUpdate = true;
            child.receiveShadow = true;
            child.material = new THREE.MeshLambertMaterial({
                map: tex,
                side: THREE.FrontSide,
            });
            child.material.needsUpdate = true;
            return; // skip normal mode
        }

        if (mode === 'shadowcatcher') {
            child.receiveShadow = true;
            child.material = new THREE.ShadowMaterial({ opacity: 0.6 });
            child.material.needsUpdate = true;
        } else if (mode === 'none') {
            // Invisible but still in scene, selectable, and participates in raycast
            child.material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0,
                side: THREE.DoubleSide
            });
        } else if (mode === 'solid') {
            child.receiveShadow = true;
            child.material = new THREE.MeshLambertMaterial({
                color,
                side: THREE.DoubleSide,
                flatShading: true
            });
            child.material.needsUpdate = true;
        } else if (mode === 'checker') {
            child.receiveShadow = true;
            if (!checkerTextures[label]) checkerTextures[label] = createCheckerTexture(label);
            // Always regenerate planar UVs for non-merged walls
            // (backend GLB may include default TEXCOORD_0 that skips generatePlanarUVs)
            const isMerged = child.name && child.name.includes('merged');
            if (!isMerged) {
                generatePlanarUVs(child.geometry);
            }
            child.material = new THREE.MeshBasicMaterial({
                map: checkerTextures[label],
                side: THREE.DoubleSide
            });
            child.material.needsUpdate = true;
        } else if (mode === 'grid') {
            child.receiveShadow = true;
            if (!gridTextures[label]) gridTextures[label] = createGridTexture(label);
            const isMerged = child.name && child.name.includes('merged');
            if (!isMerged) {
                generatePlanarUVs(child.geometry);
            }
            child.material = new THREE.MeshBasicMaterial({
                map: gridTextures[label],
                transparent: true,
                side: THREE.DoubleSide
            });
            child.material.needsUpdate = true;
        }
    });

    // Force shadow map recomputation whenever any mesh receives shadows
    if (renderer) {
        renderer.shadowMap.needsUpdate = true;
    }
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
                // (applyDisplayModes handles receiveShadow/castShadow per mode)
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
    previewRenderer.shadowMap.enabled = true;
    previewRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(previewRenderer.domElement);

    previewRenderer.domElement.style.cursor = 'crosshair';
    previewRenderer.domElement.addEventListener('mousemove', onPreviewMouseMove);
    previewRenderer.domElement.addEventListener('mouseleave', onPreviewMouseLeave);

    // Image drag-drop onto preview canvas → apply as wall texture
    const previewCanvas = previewRenderer.domElement;
    const previewOverlay = document.getElementById('preview-drop-overlay');

    previewCanvas.addEventListener('dragenter', (e) => {
        if (_isDragImage(e.dataTransfer)) {
            e.preventDefault();
            if (previewOverlay) previewOverlay.style.display = 'flex';
        }
    });
    previewCanvas.addEventListener('dragleave', () => {
        if (previewOverlay) previewOverlay.style.display = 'none';
    });
    previewCanvas.addEventListener('dragover', (e) => {
        if (_isDragImage(e.dataTransfer)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }
    });
    previewCanvas.addEventListener('drop', (e) => {
        e.preventDefault();
        if (previewOverlay) previewOverlay.style.display = 'none';
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            _loadWallTexture(file);
        }
    });

    window.addEventListener('resize', onPreviewResize);
    animatePreview();
}

function _isDragImage(dataTransfer) {
    if (!dataTransfer || !dataTransfer.items || dataTransfer.items.length === 0) return false;
    return dataTransfer.items[0].type.startsWith('image/');
}

function _loadWallTexture(file) {
    const url = URL.createObjectURL(file);
    const loader = new THREE.TextureLoader();
    loader.load(url, (texture) => {
        URL.revokeObjectURL(url);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        if (currentWallTexture) currentWallTexture.dispose();
        currentWallTexture = texture;
        _applyWallTextureToMeshes();
        _updateTextureIndicator();
    });
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

        // Update cursor based on interaction mode
        if (_previewInteractionMode === 'paint' && currentWallTexture && getLabelFromMesh(hit.object) === 'wall') {
            previewRenderer.domElement.style.cursor = _textureDragging ? 'grabbing' : 'grab';
        } else {
            previewRenderer.domElement.style.cursor = 'crosshair';
        }
    } else {
        markerSphere.visible = false;
        previewRenderer.domElement.style.cursor = 'crosshair';
    }
}

function onPreviewMouseLeave() {
    if (markerSphere) markerSphere.visible = false;
}

function animatePreview() {
    requestAnimationFrame(animatePreview);

    // Swap to preview renderer's own shadow map so both renderers
    // maintain independent WebGLRenderTarget in their own GL context.
    _mainShadowMap = directionalLight.shadow.map;
    directionalLight.shadow.map = _previewShadowMap;

    const originalBackground = scene.background;
    scene.background = null;

    previewRenderer.render(scene, fixedCamera);

    scene.background = originalBackground;

    // Save preview's shadow map and restore main renderer's
    _previewShadowMap = directionalLight.shadow.map;
    directionalLight.shadow.map = _mainShadowMap;
}

// ========== Drag-Drop and Selection System ==========

export function initDragDrop() {
    const loader = new GLTFLoader();
    const dragDropLoader = new DragDropLoader(renderer.domElement, loader);

    dragDropLoader.init({
        onDragEnter() {
            const overlay = document.getElementById('drop-overlay');
            if (overlay) overlay.classList.remove('hidden');
        },
        onDragLeave() {
            const overlay = document.getElementById('drop-overlay');
            if (overlay) overlay.classList.add('hidden');
        },
        onLoad(gltf, event) {
            const overlay = document.getElementById('drop-overlay');
            if (overlay) overlay.classList.add('hidden');

            // Get drop position via raycasting
            const meshes = [];
            if (lowPolyGroup) {
                lowPolyGroup.traverse(child => { if (child.isMesh) meshes.push(child); });
            }

            let worldPos = new THREE.Vector3(0, 0, 0);

            // Try to intersect with low-poly meshes first
            const hit = _mainRaycaster.cast(event, renderer.domElement, camera, meshes);
            if (hit) {
                worldPos.copy(hit.point);
            } else if (meshes.length === 0) {
                // Fallback: intersect with Y=0 plane
                const raycaster = new THREE.Raycaster();
                const mouse = new THREE.Vector2();
                const rect = renderer.domElement.getBoundingClientRect();
                const dpr = renderer.getPixelRatio();

                mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

                raycaster.setFromCamera(mouse, camera);
                const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
                raycaster.ray.intersectPlane(plane, worldPos);
            }

            // Load and position model
            const model = gltf.scene;
            model.scale.multiplyScalar(0.01); // Default scale to 1% of original
            model.position.copy(worldPos);
            // Enable shadow casting for the model
            model.traverse((child) => {
                if (child.isMesh) child.castShadow = true;
            });
            scene.add(model);
            droppedModels.push(model);

            // ── Shadow workaround（未彻底解决，暂时保留） ──────────────────
            // 问题：拖入模型后低模 mesh 不立即显示投影，需手动来回切换 display mode。
            // 已尝试：shadow map dispose+重建、MeshBasicMaterial 临时替换、
            //         双帧 rAF、material.needsUpdate 等方案，均无效。
            // 当前实际规避方式：将默认 displayMode 改为 'checker'（见模块顶部注释）。
            // 以下代码为调试残留，逻辑上无害，暂不删除以备后续排查。
            if (directionalLight.shadow.map) {
                directionalLight.shadow.map.dispose();
                directionalLight.shadow.map = null;
            }
            _mainShadowMap = null;
            _previewShadowMap = null;

            if (lowPolyGroup) {
                lowPolyGroup.traverse(child => {
                    if (!child.isMesh) return;
                    const label = getLabelFromMesh(child);
                    const color = label ? SEMANTIC_COLORS[label] : 0x888888;
                    child.receiveShadow = false;
                    child.material = new THREE.MeshBasicMaterial({
                        color,
                        side: THREE.DoubleSide
                    });
                });
            }

            requestAnimationFrame(() => {
                applyDisplayModes();
            });
            // ── end shadow workaround ─────────────────────────────────────

            // Auto-switch to 'model' selection type when a model is dropped
            if (_selectionManager) {
                _selectionManager.setType('model');
                // Update selection type dropdown if it exists
                const selectElement = document.getElementById('selection-type');
                if (selectElement) {
                    selectElement.value = 'model';
                }
            }

            console.log(`Dropped model at [${worldPos.x.toFixed(2)}, ${worldPos.y.toFixed(2)}, ${worldPos.z.toFixed(2)}]`);
        },
        onError(err) {
            const overlay = document.getElementById('drop-overlay');
            if (overlay) overlay.classList.add('hidden');
            console.error('Drag-drop error:', err);
        }
    });
}

export function initSelectionSystem(onSelectionChange) {
    _selectionManager = new SelectionManager(
        scene,
        getLabelFromMesh,
        () => droppedModels
    );

    _selectionManager.onChange((selInfo) => {
        onSelectionChange(selInfo);
    });

    // Detect viewport dragging to prevent accidental selection after camera rotation
    renderer.domElement.addEventListener('mousedown', (event) => {
        if (event.button === 0) { // Left mouse button
            _mainViewportMouseDownPos = { x: event.clientX, y: event.clientY };
            _mainViewportWasDragged = false;
        }
    });

    renderer.domElement.addEventListener('mousemove', (event) => {
        if (_mainViewportMouseDownPos && event.buttons === 1) { // Left button still pressed
            const dx = event.clientX - _mainViewportMouseDownPos.x;
            const dy = event.clientY - _mainViewportMouseDownPos.y;
            const dragDistance = Math.sqrt(dx * dx + dy * dy);

            // If moved more than 5 pixels, consider it a drag
            if (dragDistance > 5) {
                _mainViewportWasDragged = true;
            }
        }
    });

    // Click listener on main viewport
    renderer.domElement.addEventListener('click', (event) => {
        // Ignore click right after dragging to preserve selection state
        if (_justFinishedDragging || _mainViewportWasDragged) {
            _mainViewportWasDragged = false;
            return;
        }

        const meshes = [];
        if (lowPolyGroup) {
            lowPolyGroup.traverse(child => { if (child.isMesh) meshes.push(child); });
        }

        // Include dropped models for 'model' selection type
        const droppedMeshes = [];
        droppedModels.forEach(model => {
            model.traverse(child => { if (child.isMesh) droppedMeshes.push(child); });
        });

        const allMeshes = [...meshes, ...droppedMeshes];

        if (allMeshes.length === 0) {
            console.warn('No meshes available for selection. Run extraction or drop models first.');
            _selectionManager.deselect();
            _detachGizmo();
            return;
        }

        const hit = _mainRaycaster.cast(event, renderer.domElement, camera, allMeshes);

        if (hit) {
            console.log(`Hit object: ${hit.object.name || '(unnamed)'}, Type: ${hit.object.constructor.name}`);

            // Auto-detect selection type based on what was hit
            let targetType = 'model'; // Default to model
            if (hit.object) {
                const label = getLabelFromMesh(hit.object);
                if (label === 'wall' || label === 'ceiling' || label === 'floor') {
                    targetType = label;
                } else if (hit.object.parent && hit.object.parent.isMesh) {
                    const parentLabel = getLabelFromMesh(hit.object.parent);
                    if (parentLabel === 'wall' || parentLabel === 'ceiling' || parentLabel === 'floor') {
                        targetType = parentLabel;
                    }
                }
            }

            // Set the type and handle the hit (with Shift for multi-select)
            // Only call setType if not shift-selecting (type change would clear selection)
            if (!event.shiftKey) {
                _selectionManager.setType(targetType);
            }
            _selectionManager.handleHit(hit, event.shiftKey);

            const selected = _selectionManager.getSelected();
            if (selected) {
                console.log(`Selected: ${selected.object?.name || '(unnamed)'} [${selected.type}]`);
                // Mark selection from main viewport
                _lastSelectionSource = 'main';
                // Only attach gizmo for model type; wall/ceiling/floor can be selected but not transformed
                if (transformMode !== 'select' && selected.type === 'model') {
                    _attachGizmo(selected.object);
                } else {
                    _detachGizmo();
                }
            } else {
                console.log(`No valid target for selection type: ${_selectionManager.selectionType}`);
                _detachGizmo();
            }
        } else {
            console.log('No mesh hit by raycaster');
            _selectionManager.deselect();
            _detachGizmo();
        }
    });

    // Keyboard shortcuts: Q=Select, W=Translate, E=Rotate, R=Scale, G=Merge Walls
    // Only allow gizmo activation when selecting from main viewport
    document.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();

        if (key === 'g') {
            _mergeSelectedWalls();
            e.preventDefault();
        } else if (key === 'q') {
            setGizmoMode('select');
            e.preventDefault();
        } else if (_lastSelectionSource === 'main') {
            // Only allow gizmo mode changes from main viewport selection
            if (key === 'w') {
                setGizmoMode('translate');
                e.preventDefault();
            } else if (key === 'e') {
                setGizmoMode('rotate');
                e.preventDefault();
            } else if (key === 'r') {
                setGizmoMode('scale');
                e.preventDefault();
            }
        }
    });
}

function _attachGizmo(object) {
    if (transformControls && object) {
        transformControls.attach(object);
        transformControls.setMode(transformMode);
        // Ensure gizmo is visible and not occluded
        transformControls.visible = true;

        // Reset scale tracking when attaching to a new object
        _lastScalePerAxis.x = object.scale.x;
        _lastScalePerAxis.y = object.scale.y;
        _lastScalePerAxis.z = object.scale.z;
    }
}

function _detachGizmo() {
    if (transformControls) {
        transformControls.detach();
        transformControls.visible = false;
    }
}

/**
 * Configure TransformControls to render on top of all objects
 * @private
 */
function _configureGizmoRendering(controls) {
    // Set a high renderOrder to ensure gizmo is drawn last
    controls.traverse((child) => {
        if (child.isMesh) {
            child.renderOrder = 100;
            if (child.material) {
                // Disable depth test so gizmo is not occluded
                child.material.depthTest = false;
                child.material.depthWrite = false;
            }
        }
    });
}

/**
 * Initialize preview viewport selection and drag-to-move interaction.
 * Allows clicking to select objects and dragging to move dropped models.
 */
export function initPreviewSelection() {
    const previewCanvas = previewRenderer.domElement;

    // Per-model yaw offset (radians) accumulated via scroll wheel during preview drag
    const _modelYaws = new WeakMap();

    // ===== Click to Select =====
    previewCanvas.addEventListener('click', (event) => {
        // Paint mode: no selection on click
        if (_previewInteractionMode !== 'select') return;

        // Don't select if we just finished dragging
        if (_previewDraggingModel) {
            return;
        }

        const meshes = [];
        if (lowPolyGroup) {
            lowPolyGroup.traverse(child => { if (child.isMesh) meshes.push(child); });
        }

        // Include dropped models
        const droppedMeshes = [];
        droppedModels.forEach(model => {
            model.traverse(child => { if (child.isMesh) droppedMeshes.push(child); });
        });

        const allMeshes = [...meshes, ...droppedMeshes];

        if (allMeshes.length === 0) {
            if (_selectionManager) {
                _selectionManager.deselect();
                _detachGizmo();
            }
            return;
        }

        const hit = _previewRaycaster.cast(event, previewCanvas, fixedCamera, allMeshes);

        if (hit && _selectionManager) {
            // Auto-detect selection type
            let targetType = 'model';
            if (hit.object) {
                const label = getLabelFromMesh(hit.object);
                if (label === 'wall' || label === 'ceiling' || label === 'floor') {
                    targetType = label;
                } else if (hit.object.parent && hit.object.parent.isMesh) {
                    const parentLabel = getLabelFromMesh(hit.object.parent);
                    if (parentLabel === 'wall' || parentLabel === 'ceiling' || parentLabel === 'floor') {
                        targetType = parentLabel;
                    }
                }
            }

            _selectionManager.setType(targetType);
            _selectionManager.handleHit(hit, event.shiftKey);

            const selected = _selectionManager.getSelected();
            if (selected) {
                // Preview viewport: always stay in select mode, never attach gizmo
                _lastSelectionSource = 'preview';
                _detachGizmo();
                // Force select mode when clicking in preview
                transformMode = 'select';
            } else {
                _detachGizmo();
            }
        } else {
            if (_selectionManager) {
                _selectionManager.deselect();
                _detachGizmo();
            }
        }
    });

    // ===== Drag to Move (only for dropped models, select mode only) =====
    previewCanvas.addEventListener('mousedown', (event) => {
        // Only allow dragging with left mouse button
        if (event.button !== 0) return;

        // In paint mode: handle texture drag only (skip model drag)
        if (_previewInteractionMode === 'paint') {
            if (currentWallTexture) {
                const wallMeshes = [];
                if (lowPolyGroup) {
                    lowPolyGroup.traverse(c => {
                        if (c.isMesh && getLabelFromMesh(c) === 'wall') wallMeshes.push(c);
                    });
                }
                if (wallMeshes.length > 0) {
                    const wallHit = _previewRaycaster.cast(event, previewCanvas, fixedCamera, wallMeshes);
                    if (wallHit) {
                        const tex = wallHit.object.material && wallHit.object.material.map;
                        if (tex) {
                            _textureDragging = true;
                            _textureDragMesh = wallHit.object;
                            _textureDragStartX = event.clientX;
                            _textureDragStartY = event.clientY;
                            _textureDragStartOffsetX = tex.offset.x;
                            _textureDragStartOffsetY = tex.offset.y;
                            _textureDragDepth = wallHit.point.length();
                            previewCanvas.style.cursor = 'grabbing';
                            event.preventDefault();
                        }
                    }
                }
            }
            return; // never model-drag in paint mode
        }

        // ===== Select mode: model drag only =====
        const droppedMeshes = [];
        droppedModels.forEach(model => {
            model.traverse(child => { if (child.isMesh) droppedMeshes.push(child); });
        });

        if (droppedMeshes.length === 0) return;

        // Raycast to dropped models to find which one to drag
        const hit = _previewRaycaster.cast(event, previewCanvas, fixedCamera, droppedMeshes);

        if (hit) {
            // Find the root dropped model
            let dragModel = null;
            for (const model of droppedModels) {
                if (model.getObjectById(hit.object.id) || hit.object === model) {
                    dragModel = model;
                    break;
                }
                // Check if hit object is descendant of this model
                let current = hit.object;
                while (current) {
                    if (current === model) {
                        dragModel = model;
                        break;
                    }
                    current = current.parent;
                }
                if (dragModel) break;
            }

            if (dragModel) {
                _previewDraggingModel = dragModel;
            }
        }
    });

    previewCanvas.addEventListener('mousemove', (event) => {
        // Texture sliding has highest priority — handle before model drag
        if (_textureDragging && _textureDragMesh) {
            const tex = _textureDragMesh.material && _textureDragMesh.material.map;
            if (!tex) { _textureDragging = false; _textureDragMesh = null; return; }

            const screenDeltaX = event.clientX - _textureDragStartX;
            const screenDeltaY = event.clientY - _textureDragStartY;

            // Convert screen pixels to world metres at the drag depth
            const fovVRad = (fixedCamera.fov * Math.PI) / 180;
            const canvasW = previewRenderer.domElement.width;
            const canvasH = previewRenderer.domElement.height;
            const aspect = canvasW / canvasH;
            const fovHRad = 2 * Math.atan(Math.tan(fovVRad / 2) * aspect);

            const depth = _textureDragDepth > 0 ? _textureDragDepth : 1;
            const worldPerPixelH = (2 * depth * Math.tan(fovHRad / 2)) / canvasW;
            const worldPerPixelV = (2 * depth * Math.tan(fovVRad / 2)) / canvasH;

            tex.offset.x = _textureDragStartOffsetX + screenDeltaX * worldPerPixelH;
            tex.offset.y = _textureDragStartOffsetY - screenDeltaY * worldPerPixelV;
            // offset/repeat/rotation are shader uniforms — no needsUpdate required
            return; // don't update marker while sliding texture
        }

        if (!_previewDraggingModel) return;

        // Always raycast to lowPolyGroup (not dropped models) for consistent movement
        const lowPolyMeshes = [];
        if (lowPolyGroup) {
            lowPolyGroup.traverse(child => { if (child.isMesh) lowPolyMeshes.push(child); });
        }

        let currentHit = null;
        if (lowPolyMeshes.length > 0) {
            currentHit = _previewRaycaster.cast(event, previewCanvas, fixedCamera, lowPolyMeshes);
        }

        if (currentHit) {
            // Set model position directly to hit point (same as marker sphere)
            _previewDraggingModel.position.copy(currentHit.point);

            // Apply alignment to normal like marker sphere does
            if (alignToNormal && currentHit.face) {
                const worldNormal = currentHit.face.normal.clone()
                    .transformDirection(currentHit.object.matrixWorld);
                _previewDraggingModel.quaternion.setFromUnitVectors(
                    new THREE.Vector3(0, 1, 0), worldNormal
                );
            } else {
                _previewDraggingModel.quaternion.identity();
            }
        } else {
            // No hit on lowPoly: project to Y=0 plane and reset rotation
            const point = _projectToPlane(event, previewCanvas, new THREE.Vector3(0, 1, 0), 0);
            _previewDraggingModel.position.copy(point);
            _previewDraggingModel.quaternion.identity();
        }

        // Apply per-model yaw (surface-normal axis rotation) on top of alignment
        const yaw = _modelYaws.get(_previewDraggingModel) || 0;
        if (yaw !== 0) {
            const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
            _previewDraggingModel.quaternion.multiply(yawQ);
        }
    });

    // ===== Scroll Wheel =====
    previewCanvas.addEventListener('wheel', (event) => {
        // Paint mode + texture drag: scale (default) or rotate (alt held)
        if (_previewInteractionMode === 'paint' && _textureDragging && _textureDragMesh) {
            event.preventDefault();
            const tex = _textureDragMesh.material && _textureDragMesh.material.map;
            if (!tex) return;
            if (event.altKey) {
                // Alt + scroll → rotate around texture center (set in _applyWallTextureToMeshes)
                tex.rotation += event.deltaY * 0.003;
            } else {
                // Scroll → uniform scale: repeat shrinks = texture appears larger
                const factor = Math.pow(0.998, event.deltaY);
                tex.repeat.x *= factor;
                tex.repeat.y *= factor;
            }
            // offset/repeat/rotation are shader uniforms — no needsUpdate required
            return;
        }

        // Select mode: yaw rotation for dragged model
        if (!_previewDraggingModel) return;
        event.preventDefault();
        // ~0.003 rad per pixel of deltaY → roughly 17° per scroll notch (deltaY≈100)
        const delta = event.deltaY * 0.003;
        const currentYaw = _modelYaws.get(_previewDraggingModel) || 0;
        _modelYaws.set(_previewDraggingModel, currentYaw + delta);
        // Apply immediately so rotation is visible without waiting for next mousemove
        const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), delta);
        _previewDraggingModel.quaternion.multiply(yawQ);
    }, { passive: false });

    previewCanvas.addEventListener('mouseup', () => {
        _previewDraggingModel = null;
        if (_textureDragging) {
            _textureDragging = false;
            _textureDragMesh = null;
            previewCanvas.style.cursor = 'grab';
        }
    });

    previewCanvas.addEventListener('mouseleave', () => {
        _previewDraggingModel = null;
        if (_textureDragging) {
            _textureDragging = false;
            _textureDragMesh = null;
            previewCanvas.style.cursor = 'crosshair';
        }
    });
}

/**
 * Project mouse position to a plane at a given distance along normal.
 * @private
 */
function _projectToPlane(event, canvas, planeNormal, planeDistance) {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), fixedCamera);

    const plane = new THREE.Plane(planeNormal, planeDistance);
    const point = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, point);

    return point;
}

export function setSelectionType(type) {
    if (_selectionManager) {
        _selectionManager.setType(type);
    }
}

export function getLabelFromMeshPublic(mesh) {
    return getLabelFromMesh(mesh);
}

export function getDroppedModels() {
    return droppedModels;
}

export function setGizmoMode(mode) {
    transformMode = mode;
    if (mode === 'select') {
        // Detach gizmo when entering select mode
        if (transformControls) {
            transformControls.detach();
            transformControls.visible = false;
        }
    } else if (transformControls) {
        transformControls.setMode(mode);
        // Only attach gizmo if model is selected, not for wall/ceiling/floor
        const selected = _selectionManager?.getSelected();
        if (selected && selected.type === 'model') {
            _attachGizmo(selected.object);
        } else {
            // Detach if selected object is not a model
            transformControls.detach();
            transformControls.visible = false;
        }
    }
}

export function applyScaleFactor(factor) {
    const selected = _selectionManager?.getSelected();
    if (!selected || !selected.object) {
        console.warn('No object selected for scaling');
        return;
    }

    const obj = selected.object;

    // Set scale to the specified value (0-10)
    ['x', 'y', 'z'].forEach(axis => {
        let newScale = factor;

        // Prevent negative or zero scale
        if (newScale <= 0) newScale = 0.1;

        obj.scale[axis] = newScale;
        _lastScalePerAxis[axis] = newScale;
    });

    // Trigger render
    renderer.render(scene, camera);
    console.log(`Set object scale to ${factor}. New scale: [${obj.scale.x.toFixed(3)}, ${obj.scale.y.toFixed(3)}, ${obj.scale.z.toFixed(3)}]`);
}

export function updateLightDirection(x, y, z) {
    if (directionalLight) {
        directionalLight.position.set(x, y, z);
        directionalLight.target.updateMatrixWorld(); // Recompute shadow camera orientation
        directionalLight.shadow.camera.updateProjectionMatrix();
        renderer.shadowMap.needsUpdate = true;
    }
}

export function updateLightIntensity(intensity) {
    if (directionalLight) {
        directionalLight.intensity = intensity;
    }
}

export function setGridVisible(visible) {
    if (gridHelper) {
        gridHelper.visible = visible;
    }
}

// ========== Multi-Select Wall Merge (G Key) ==========

/**
 * Show a temporary error message in #selection-info, then restore previous text.
 */
function _showMergeError(msg) {
    const el = document.getElementById('selection-info');
    if (!el) return;
    const prev = el.textContent;
    el.style.color = '#ff4444';
    el.textContent = `⚠ ${msg}`;
    setTimeout(() => { el.style.color = ''; el.textContent = prev; }, 2000);
}

/**
 * Check if two meshes share at least one pair of vertices within tol distance.
 * Vertices are compared in world space.
 */
function _areWallsAdjacent(m1, m2, tol = 0.10) {
    const pos1 = m1.geometry.attributes.position;
    const pos2 = m2.geometry.attributes.position;
    if (!pos1 || !pos2) return false;

    const tolSq = tol * tol;
    const mw1 = m1.matrixWorld;
    const mw2 = m2.matrixWorld;

    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();

    // Build world-space AABB of m2 for quick prefilter
    const box2 = new THREE.Box3().setFromBufferAttribute(pos2);
    box2.min.applyMatrix4(mw2);
    box2.max.applyMatrix4(mw2);
    box2.expandByScalar(tol);

    for (let i = 0; i < pos1.count; i++) {
        v1.fromBufferAttribute(pos1, i).applyMatrix4(mw1);
        if (!box2.containsPoint(v1)) continue;
        for (let j = 0; j < pos2.count; j++) {
            v2.fromBufferAttribute(pos2, j).applyMatrix4(mw2);
            if (v1.distanceToSquared(v2) < tolSq) return true;
        }
    }
    return false;
}

/**
 * Sort meshes into a linear chain using adjacency.
 * Returns ordered array or null if not a simple chain.
 */
function _buildWallChain(meshes) {
    const n = meshes.length;
    // Build adjacency list
    const adj = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (_areWallsAdjacent(meshes[i], meshes[j])) {
                adj[i].push(j);
                adj[j].push(i);
            }
        }
    }

    // Validate: each node at most 2 neighbors (no T-junction)
    for (let i = 0; i < n; i++) {
        if (adj[i].length > 2) return null; // branching – unsupported
    }

    // Find endpoints (nodes with exactly 1 neighbor)
    const endpoints = [];
    for (let i = 0; i < n; i++) {
        if (adj[i].length === 1) endpoints.push(i);
        if (adj[i].length === 0 && n > 1) return null; // isolated node
    }

    // For 1 mesh it's trivially a chain (no merge needed, but validate anyway)
    if (n === 1) return meshes;

    // Must have exactly 2 endpoints for a linear chain
    if (endpoints.length !== 2) return null;

    // BFS to check connectivity
    const visited = new Set();
    const queue = [endpoints[0]];
    while (queue.length > 0) {
        const cur = queue.shift();
        if (visited.has(cur)) continue;
        visited.add(cur);
        for (const nb of adj[cur]) queue.push(nb);
    }
    if (visited.size !== n) return null; // disconnected

    // Traverse chain from one endpoint
    const order = [endpoints[0]];
    let prev = -1;
    let cur = endpoints[0];
    while (order.length < n) {
        const next = adj[cur].find(nb => nb !== prev);
        if (next === undefined) break;
        order.push(next);
        prev = cur;
        cur = next;
    }

    return order.map(i => meshes[i]);
}

/**
 * Find the centroid of vertices shared between two meshes (within tol).
 * Returns a THREE.Vector3 in world space.
 */
function _findSharedEdgeCenter(m1, m2, tol = 0.10) {
    const pos1 = m1.geometry.attributes.position;
    const pos2 = m2.geometry.attributes.position;
    const mw1 = m1.matrixWorld;
    const mw2 = m2.matrixWorld;
    const tolSq = tol * tol;

    const sharedPts = [];
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();

    for (let i = 0; i < pos1.count; i++) {
        v1.fromBufferAttribute(pos1, i).applyMatrix4(mw1);
        for (let j = 0; j < pos2.count; j++) {
            v2.fromBufferAttribute(pos2, j).applyMatrix4(mw2);
            if (v1.distanceToSquared(v2) < tolSq) {
                sharedPts.push(v1.clone());
                break;
            }
        }
    }

    if (sharedPts.length === 0) return null;
    const center = new THREE.Vector3();
    sharedPts.forEach(p => center.add(p));
    center.divideScalar(sharedPts.length);
    return center;
}

/**
 * Compute horizontal tangent for a wall geometry, pointing from entry to exit.
 * geo: already transformed to lowPolyGroup-local space.
 * entryPt, exitPt: THREE.Vector3 in world/local space (may be null).
 */
/**
 * Merge selected walls into a single mesh with continuous UV mapping.
 * Reuses each wall's existing UV layout; u is offset per wall for continuity.
 */
function _mergeSelectedWalls() {
    if (!_selectionManager) return;

    const items = _selectionManager.getSelectedItems();

    if (items.length < 2) {
        _showMergeError('Select at least 2 walls to merge');
        return;
    }

    if (items.some(x => x.type !== 'wall')) {
        _showMergeError('Can only merge walls (all selected must be walls)');
        return;
    }

    const meshes = items.map(x => x.object);

    // Validate geometry
    for (const m of meshes) {
        if (!m.geometry || !m.geometry.attributes.position) {
            _showMergeError('One or more walls have invalid geometry');
            return;
        }
    }

    // Build ordered chain
    const chain = _buildWallChain(meshes);
    if (!chain) {
        _showMergeError('Walls must form a connected linear chain (no branching)');
        return;
    }

    // Build merged geometry: reuse existing UVs, offset u for continuity
    const n = chain.length;
    const groupInvMatrix = new THREE.Matrix4().copy(lowPolyGroup.matrixWorld).invert();
    const geometries = [];
    let globalUOffset = 0;

    for (let i = 0; i < n; i++) {
        const mesh = chain[i];
        const geo = mesh.geometry.clone();

        // Transform vertices to lowPolyGroup local space
        const relMatrix = groupInvMatrix.clone().multiply(mesh.matrixWorld);
        geo.applyMatrix4(relMatrix);
        geo.computeVertexNormals();

        const uvAttr = geo.attributes.uv;
        if (!uvAttr) {
            _showMergeError('One or more walls are missing UV data — apply a display mode first');
            return;
        }

        // Find u range of this wall's existing UVs
        let uMin = Infinity, uMax = -Infinity;
        for (let vi = 0; vi < uvAttr.count; vi++) {
            const u = uvAttr.getX(vi);
            if (u < uMin) uMin = u;
            if (u > uMax) uMax = u;
        }

        // Shift u so it starts at globalUOffset, keep v unchanged
        const uShift = globalUOffset - uMin;
        const uvs = new Float32Array(uvAttr.count * 2);
        for (let vi = 0; vi < uvAttr.count; vi++) {
            uvs[vi * 2]     = uvAttr.getX(vi) + uShift;
            uvs[vi * 2 + 1] = uvAttr.getY(vi);
        }
        geo.deleteAttribute('uv');
        geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

        globalUOffset += (uMax - uMin);
        geometries.push(geo);
    }

    // Merge all geometries
    const mergedGeo = mergeGeometries(geometries, false);
    if (!mergedGeo) {
        _showMergeError('Geometry merge failed');
        return;
    }
    mergedGeo.computeVertexNormals();

    // Create the merged mesh with wall color
    const mergedMesh = new THREE.Mesh(
        mergedGeo,
        new THREE.MeshLambertMaterial({ color: 0x2196F3, side: THREE.DoubleSide })
    );
    mergedMesh.name = 'wall_merged';
    mergedMesh.castShadow = false;
    mergedMesh.receiveShadow = false;

    // Remove original meshes
    for (const mesh of chain) {
        const parent = mesh.parent || lowPolyGroup;
        parent.remove(mesh);
        mesh.geometry.dispose();
    }

    lowPolyGroup.add(mergedMesh);

    // Clear selection, re-select merged mesh, apply display modes
    _selectionManager.deselect();
    _selectionManager.setType('wall');
    _selectionManager._selectSingle({ object: mergedMesh, type: 'wall' });

    applyDisplayModes();

    console.log(`Merged ${n} walls → wall_merged (u span: 0..${globalUOffset.toFixed(2)})`);
}