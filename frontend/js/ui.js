export function initUI(callbacks) {
    const voxelSlider = document.getElementById('voxel-size');
    const voxelValue = document.getElementById('voxel-value');
    const distanceSlider = document.getElementById('distance-threshold');
    const distanceValue = document.getElementById('distance-value');
    const angleSlider = document.getElementById('angle-tolerance');
    const angleValue = document.getElementById('angle-value');
    const clusterSlider = document.getElementById('cluster-radius');
    const clusterValue = document.getElementById('cluster-value');
    const minClusterSlider = document.getElementById('min-cluster-size');
    const minClusterValue = document.getElementById('min-cluster-value');
    const expandMarginSlider = document.getElementById('expand-margin');
    const expandMarginValue = document.getElementById('expand-margin-value');
    const fovSlider = document.getElementById('fov-slider');
    const fovValue = document.getElementById('fov-value');
    const overlayOpacitySlider = document.getElementById('overlay-opacity');
    const overlayOpacityValue = document.getElementById('overlay-opacity-value');
    const runButton = document.getElementById('run-extraction');
    const downloadButton = document.getElementById('download-lowpoly');
    const step1Button = document.getElementById('step1-btn');
    const step2FovButton = document.getElementById('step2-fov-btn');
    const step3Button = document.getElementById('step3-btn');
    const step4Button = document.getElementById('step4-btn');
    const step5Button = document.getElementById('step5-btn');
    const step6Button = document.getElementById('step6-btn');
    const wallDisplaySelect = document.getElementById('wall-display-mode');
    const ceilingDisplaySelect = document.getElementById('ceiling-display-mode');
    const floorDisplaySelect = document.getElementById('floor-display-mode');
    const markerShapeSelect = document.getElementById('marker-shape');
    const alignToNormalCheckbox = document.getElementById('align-to-normal');

    // Slider value updates
    voxelSlider.addEventListener('input', (e) => {
        voxelValue.textContent = e.target.value;
    });

    distanceSlider.addEventListener('input', (e) => {
        distanceValue.textContent = e.target.value;
    });

    angleSlider.addEventListener('input', (e) => {
        angleValue.textContent = e.target.value;
    });

    clusterSlider.addEventListener('input', (e) => {
        clusterValue.textContent = parseFloat(e.target.value).toFixed(2);
    });

    minClusterSlider.addEventListener('input', (e) => {
        minClusterValue.textContent = e.target.value;
    });

    expandMarginSlider.addEventListener('input', (e) => {
        expandMarginValue.textContent = parseFloat(e.target.value).toFixed(2);
    });

    fovSlider.addEventListener('input', (e) => {
        const fov = parseInt(e.target.value);
        fovValue.textContent = fov;
        if (callbacks.onFOVChange) callbacks.onFOVChange(fov);
    });

    overlayOpacitySlider.addEventListener('input', (e) => {
        const opacity = parseInt(e.target.value);
        overlayOpacityValue.textContent = opacity;
        if (callbacks.onPreviewOpacityChange) callbacks.onPreviewOpacityChange(opacity);
    });

    // Display mode selects
    wallDisplaySelect.addEventListener('change', (e) => {
        if (callbacks.onDisplayModeChange) callbacks.onDisplayModeChange('wall', e.target.value);
    });

    ceilingDisplaySelect.addEventListener('change', (e) => {
        if (callbacks.onDisplayModeChange) callbacks.onDisplayModeChange('ceiling', e.target.value);
    });

    floorDisplaySelect.addEventListener('change', (e) => {
        if (callbacks.onDisplayModeChange) callbacks.onDisplayModeChange('floor', e.target.value);
    });

    markerShapeSelect.addEventListener('change', (e) => {
        if (callbacks.onMarkerShapeChange) callbacks.onMarkerShapeChange(e.target.value);
    });

    alignToNormalCheckbox.addEventListener('change', (e) => {
        if (callbacks.onAlignToNormalChange) callbacks.onAlignToNormalChange(e.target.checked);
    });

    // Light control sliders
    const lightXSlider = document.getElementById('light-x');
    const lightYSlider = document.getElementById('light-y');
    const lightZSlider = document.getElementById('light-z');
    const lightXValue = document.getElementById('light-x-value');
    const lightYValue = document.getElementById('light-y-value');
    const lightZValue = document.getElementById('light-z-value');

    const updateLightPosition = () => {
        const x = parseInt(lightXSlider.value);
        const y = parseInt(lightYSlider.value);
        const z = parseInt(lightZSlider.value);
        lightXValue.textContent = x;
        lightYValue.textContent = y;
        lightZValue.textContent = z;
        if (callbacks.onLightDirectionChange) callbacks.onLightDirectionChange(x, y, z);
    };

    lightXSlider.addEventListener('input', updateLightPosition);
    lightYSlider.addEventListener('input', updateLightPosition);
    lightZSlider.addEventListener('input', updateLightPosition);

    // Light intensity slider
    const lightIntensitySlider = document.getElementById('light-intensity');
    const lightIntensityValue = document.getElementById('light-intensity-value');
    lightIntensitySlider.addEventListener('input', () => {
        const v = parseFloat(lightIntensitySlider.value);
        lightIntensityValue.textContent = v.toFixed(1);
        if (callbacks.onLightIntensityChange) callbacks.onLightIntensityChange(v);
    });

    // Grid visibility toggle
    const gridToggle = document.getElementById('grid-visible-toggle');
    gridToggle.addEventListener('change', () => {
        if (callbacks.onGridVisibleChange) callbacks.onGridVisibleChange(gridToggle.checked);
    });

    // Gizmo mode buttons
    document.querySelectorAll('.gizmo-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.gizmo-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const mode = btn.dataset.mode;
            if (callbacks.onGizmoModeChange) callbacks.onGizmoModeChange(mode);
        });
    });

    // Scale input
    const scaleInput = document.getElementById('scale-input');

    if (scaleInput) {
        scaleInput.addEventListener('change', (e) => {
            let value = parseFloat(e.target.value);
            if (isNaN(value)) value = 1;
            value = Math.max(0, Math.min(10, value));
            scaleInput.value = value.toFixed(2);
            if (callbacks.onScaleChange) callbacks.onScaleChange(value);
        });

        scaleInput.addEventListener('wheel', (e) => {
            e.preventDefault();
            let value = parseFloat(scaleInput.value) || 1;
            const step = 0.01;
            if (e.deltaY < 0) {
                value += step;
            } else {
                value -= step;
            }
            value = Math.max(0, Math.min(10, value));
            scaleInput.value = value.toFixed(2);
            if (callbacks.onScaleChange) callbacks.onScaleChange(value);
        }, { passive: false });
    }

    // Get current parameters
    const getParams = () => ({
        voxel_size: parseFloat(voxelSlider.value),
        distance_threshold: parseFloat(distanceSlider.value),
        angle_tolerance: parseFloat(angleSlider.value),
        cluster_radius: parseFloat(clusterSlider.value),
        min_cluster_size: parseInt(minClusterSlider.value),
        expand_margin: parseFloat(expandMarginSlider.value),
        enable_trimming: true
    });

    // Button handlers
    runButton.addEventListener('click', () => callbacks.onRunExtraction(getParams()));
    step1Button.addEventListener('click', () => callbacks.onStep1(getParams()));
    step2FovButton.addEventListener('click', () => callbacks.onComputeFOV());
    step3Button.addEventListener('click', () => callbacks.onStep3(getParams()));
    step4Button.addEventListener('click', () => callbacks.onStep4(getParams()));
    step5Button.addEventListener('click', () => callbacks.onStep5(getParams()));
    step6Button.addEventListener('click', () => callbacks.onStep6(getParams()));
    downloadButton.addEventListener('click', () => callbacks.onDownload());

    // Accordion toggle for step headers
    document.querySelectorAll('.step-header[data-target]').forEach(header => {
        header.addEventListener('click', (e) => {
            if (e.target.closest('.btn-step-run')) return;
            const bodyId = header.dataset.target;
            if (!bodyId) return;
            const body = document.getElementById(bodyId);
            if (!body) return;
            body.classList.toggle('collapsed');
            const arrow = header.querySelector('.step-arrow');
            if (arrow) arrow.classList.toggle('open', !body.classList.contains('collapsed'));
        });
    });

    // Apply initial values
    if (callbacks.onPreviewOpacityChange) callbacks.onPreviewOpacityChange(parseInt(overlayOpacitySlider.value));
    if (callbacks.onAlignToNormalChange) callbacks.onAlignToNormalChange(alignToNormalCheckbox.checked);
}

export function showLoading(message = 'Processing...') {
    const overlay = document.getElementById('loading-overlay');
    const text = document.getElementById('loading-text');
    text.textContent = message;
    overlay.classList.remove('hidden');
}

export function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.add('hidden');
}

export function setButtonEnabled(enabled) {
    const runButton = document.getElementById('run-extraction');
    const step1Button = document.getElementById('step1-btn');
    const step2FovButton = document.getElementById('step2-fov-btn');
    const step3Button = document.getElementById('step3-btn');
    const step4Button = document.getElementById('step4-btn');
    const step5Button = document.getElementById('step5-btn');
    const step6Button = document.getElementById('step6-btn');

    runButton.disabled = !enabled;
    step1Button.disabled = !enabled;
    step2FovButton.disabled = !enabled;
    step3Button.disabled = !enabled;
    step4Button.disabled = !enabled;
    step5Button.disabled = !enabled;
    step6Button.disabled = !enabled;
}

export function showDownloadButton() {
    const downloadButton = document.getElementById('download-lowpoly');
    downloadButton.classList.remove('hidden');
}

export function updateStats(stats) {
    const statsDiv = document.getElementById('stats');

    if (stats.point_count !== undefined) {
        document.getElementById('floor-count').textContent = '-';
        document.getElementById('ceiling-count').textContent = '-';
        document.getElementById('wall-count').textContent = '-';
        document.getElementById('total-planes').textContent = stats.point_count + ' points';
    } else if (stats.plane_count !== undefined) {
        document.getElementById('floor-count').textContent = '-';
        document.getElementById('ceiling-count').textContent = '-';
        document.getElementById('wall-count').textContent = '-';
        document.getElementById('total-planes').textContent = stats.plane_count;
    } else {
        document.getElementById('floor-count').textContent = stats.floor_count || 0;
        document.getElementById('ceiling-count').textContent = stats.ceiling_count || 0;
        document.getElementById('wall-count').textContent = stats.wall_count || 0;
        document.getElementById('total-planes').textContent = stats.total_planes || 0;
    }

    statsDiv.classList.remove('hidden');
}

export function showError(message) {
    alert(`Error: ${message}`);
}

export function setFOVSliderValue(fov) {
    const clamped = Math.round(Math.max(30, Math.min(120, fov)));
    document.getElementById('fov-slider').value = clamped;
    document.getElementById('fov-value').textContent = clamped;
}

export function updateSelectionInfo(text) {
    const el = document.getElementById('selection-info');
    if (el) el.textContent = text ?? 'No selection';
}
