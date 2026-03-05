import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let scene, camera, renderer, controls;
let originalModel = null;
let lowPolyGroup = null;
let currentLowPolyData = null;

// Camera preview viewport
let previewScene, previewCamera, previewRenderer;
let cameraModel = null;

export function initScene() {
    const container = document.getElementById('canvas-container');

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);

    // Camera
    camera = new THREE.PerspectiveCamera(
        60,
        container.clientWidth / container.clientHeight,
        0.1,
        1000
    );
    camera.position.set(5, 5, 5);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 10);
    scene.add(directionalLight);

    // Grid
    const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
    scene.add(gridHelper);

    // Handle window resize
    window.addEventListener('resize', onWindowResize);

    // Animation loop
    animate();
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
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
        // Clear previous low-poly
        clearLowPoly();

        // Store for download
        currentLowPolyData = base64glb;

        // Decode base64 to ArrayBuffer
        const binaryString = atob(base64glb);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // Load GLB
        const loader = new GLTFLoader();
        loader.parse(
            bytes.buffer,
            '',
            (gltf) => {
                lowPolyGroup = gltf.scene;

                // Ensure materials are visible
                lowPolyGroup.traverse((child) => {
                    if (child.isMesh) {
                        child.material.side = THREE.DoubleSide;
                        child.material.flatShading = true;
                    }
                });

                scene.add(lowPolyGroup);
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

export function initCameraPreview() {
    const container = document.getElementById('camera-preview-container');

    // Preview Scene
    previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0x1a1a1a);

    // Preview Camera - fixed position looking at origin
    previewCamera = new THREE.PerspectiveCamera(
        50,
        container.clientWidth / container.clientHeight,
        0.01,
        10
    );
    previewCamera.position.set(0.5, 0.3, 0.5);
    previewCamera.lookAt(0, 0, 0);

    // Preview Renderer
    previewRenderer = new THREE.WebGLRenderer({ antialias: true });
    previewRenderer.setSize(container.clientWidth, container.clientHeight);
    previewRenderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(previewRenderer.domElement);

    // Lights for preview
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    previewScene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight.position.set(1, 1, 1);
    previewScene.add(directionalLight);

    // Add coordinate axes helper
    const axesHelper = new THREE.AxesHelper(0.2);
    previewScene.add(axesHelper);

    // Load camera mesh
    loadCameraModel();

    // Animation loop for preview
    animatePreview();
}

function loadCameraModel() {
    const loader = new GLTFLoader();

    loader.load(
        '/TestScene.glb',
        (gltf) => {
            // Find camera mesh in the scene
            gltf.scene.traverse((child) => {
                if (child.isMesh && child.name.toLowerCase().includes('camera')) {
                    if (cameraModel) {
                        previewScene.remove(cameraModel);
                    }
                    cameraModel = child.clone();

                    // Make camera mesh visible with a distinct color
                    cameraModel.material = new THREE.MeshStandardMaterial({
                        color: 0x4CAF50,
                        metalness: 0.3,
                        roughness: 0.7
                    });

                    // Position at origin (zero transform)
                    cameraModel.position.set(0, 0, 0);
                    cameraModel.rotation.set(0, 0, 0);
                    cameraModel.scale.set(1, 1, 1);

                    previewScene.add(cameraModel);
                }
            });
        },
        undefined,
        (error) => {
            console.error('Failed to load camera model:', error);
        }
    );
}

function animatePreview() {
    requestAnimationFrame(animatePreview);

    // Slowly rotate the preview camera around the origin
    const time = Date.now() * 0.0003;
    previewCamera.position.x = Math.cos(time) * 0.5;
    previewCamera.position.z = Math.sin(time) * 0.5;
    previewCamera.lookAt(0, 0, 0);

    previewRenderer.render(previewScene, previewCamera);
}
