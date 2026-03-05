import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let scene, camera, renderer, controls;
let originalModel = null;
let lowPolyGroup = null;
let currentLowPolyData = null;

// Camera preview viewport
let fixedCamera, previewRenderer;

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

export function updateCameraFOV(fov) {
    if (fixedCamera) {
        fixedCamera.fov = fov;
        fixedCamera.updateProjectionMatrix();
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

    // Image aspect ratio: 3414 / 2560 = 1.333
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

    // Add fixed camera to main scene
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

    // Handle window resize for preview
    window.addEventListener('resize', onPreviewResize);

    // Animation loop for preview
    animatePreview();
}

function onPreviewResize() {
    const container = document.getElementById('camera-preview-container');
    if (fixedCamera && previewRenderer) {
        // Keep the fixed aspect ratio matching the background image
        const imageAspect = 3414 / 2560;
        fixedCamera.aspect = imageAspect;
        fixedCamera.updateProjectionMatrix();
        previewRenderer.setSize(container.clientWidth, container.clientHeight, false);
    }
}

function animatePreview() {
    requestAnimationFrame(animatePreview);

    // Temporarily remove scene background for transparent rendering
    const originalBackground = scene.background;
    scene.background = null;

    // Render main scene from fixed camera's perspective
    previewRenderer.render(scene, fixedCamera);

    // Restore original background
    scene.background = originalBackground;
}
