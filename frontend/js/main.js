import { initScene, loadOriginalModel, addLowPolyOverlay, getCurrentLowPolyData, initCameraPreview, updateCameraFOV, setPreviewOpacity, setDisplayMode, setMarkerShape, setAlignToNormal } from './scene.js';
import { initUI, showLoading, hideLoading, setButtonEnabled, showDownloadButton, updateStats, showError, setFOVSliderValue } from './ui.js';

// Initialize application
async function init() {
    // Initialize 3D scene
    initScene();

    // Initialize camera preview
    initCameraPreview();

    // Load original model
    showLoading('Loading TestScene.glb...');
    try {
        await loadOriginalModel();
        hideLoading();
    } catch (error) {
        hideLoading();
        showError(`Failed to load TestScene.glb: ${error.message}`);
        return;
    }

    // Initialize UI
    initUI({
        onRunExtraction: runExtraction,
        onDownload: downloadLowPoly,
        onStep1: runStep1,
        onComputeFOV: runComputeFOV,
        onStep3: runStep3,
        onStep4: runStep4,
        onStep5: runStep5,
        onStep6: runStep6,
        onFOVChange: updateCameraFOV,
        onPreviewOpacityChange: setPreviewOpacity,
        onDisplayModeChange: setDisplayMode,
        onMarkerShapeChange: setMarkerShape,
        onAlignToNormalChange: setAlignToNormal
    });
}

async function runStep1(params) {
    setButtonEnabled(false);
    showLoading('Step 1: Preprocessing point cloud...');

    try {
        const response = await fetch('/api/step1-preprocess', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Step 1 failed');
        }

        const result = await response.json();
        showLoading('Rendering preprocessed point cloud...');
        await addLowPolyOverlay(result.glb_data);

        updateStats({ ...result.stats, step: 'Step 1: Preprocessed' });
        hideLoading();
    } catch (error) {
        hideLoading();
        showError(error.message);
    } finally {
        setButtonEnabled(true);
    }
}

async function runComputeFOV() {
    setButtonEnabled(false);
    showLoading('Step 2: Computing optimal FOV...');

    try {
        const response = await fetch('/api/compute-fov', { method: 'POST' });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'FOV computation failed');
        }

        const { fov } = await response.json();
        setFOVSliderValue(fov);
        updateCameraFOV(fov);
        hideLoading();
    } catch (error) {
        hideLoading();
        showError(error.message);
    } finally {
        setButtonEnabled(true);
    }
}

async function runStep3(params) {
    setButtonEnabled(false);
    showLoading('Step 3: Extracting planes...');

    try {
        const response = await fetch('/api/step2-extract-planes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Step 3 failed');
        }

        const result = await response.json();
        showLoading('Rendering extracted planes...');
        await addLowPolyOverlay(result.glb_data);

        updateStats({ ...result.stats, step: 'Step 3: Planes Extracted' });
        hideLoading();
    } catch (error) {
        hideLoading();
        showError(error.message);
    } finally {
        setButtonEnabled(true);
    }
}

async function runStep4(params) {
    setButtonEnabled(false);
    showLoading('Step 4: Classifying planes...');

    try {
        const response = await fetch('/api/step3-classify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Step 4 failed');
        }

        const result = await response.json();
        showLoading('Rendering classified planes...');
        await addLowPolyOverlay(result.glb_data);

        updateStats({ ...result.stats, step: 'Step 4: Classified' });
        hideLoading();
    } catch (error) {
        hideLoading();
        showError(error.message);
    } finally {
        setButtonEnabled(true);
    }
}

async function runStep5(params) {
    setButtonEnabled(false);
    showLoading('Step 5: Generating meshes...');

    try {
        const response = await fetch('/api/step4-generate-mesh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Step 5 failed');
        }

        const result = await response.json();
        showLoading('Rendering final meshes...');
        await addLowPolyOverlay(result.glb_data);

        updateStats({ ...result.stats, step: 'Step 5: Mesh Generated' });
        showDownloadButton();
        hideLoading();
    } catch (error) {
        hideLoading();
        showError(error.message);
    } finally {
        setButtonEnabled(true);
    }
}

async function runStep6(params) {
    setButtonEnabled(false);
    showLoading('Step 6: Trimming meshes...');

    try {
        const response = await fetch('/api/step5-trim-mesh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Step 6 failed');
        }

        const result = await response.json();
        showLoading('Rendering trimmed meshes...');
        await addLowPolyOverlay(result.glb_data);

        updateStats({ ...result.stats, step: 'Step 6: Mesh Trimmed' });
        showDownloadButton();
        hideLoading();
    } catch (error) {
        hideLoading();
        showError(error.message);
    } finally {
        setButtonEnabled(true);
    }
}

async function runExtraction(params) {
    setButtonEnabled(false);
    showLoading('Extracting planes...');

    try {
        const response = await fetch('/api/extract', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(params)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Extraction failed');
        }

        const result = await response.json();

        // Add low-poly overlay
        showLoading('Rendering low-poly mesh...');
        await addLowPolyOverlay(result.glb_data);

        // Update stats
        updateStats(result.stats);

        // Show download button
        showDownloadButton();

        hideLoading();
    } catch (error) {
        hideLoading();
        showError(error.message);
    } finally {
        setButtonEnabled(true);
    }
}

function downloadLowPoly() {
    const glbData = getCurrentLowPolyData();
    if (!glbData) {
        showError('No low-poly model available');
        return;
    }

    // Convert base64 to blob
    const binaryString = atob(glbData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'model/gltf-binary' });

    // Create download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'low_poly_scene.glb';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Start application
init();
