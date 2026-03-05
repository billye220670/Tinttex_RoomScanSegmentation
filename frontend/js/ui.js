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
    const runButton = document.getElementById('run-extraction');
    const downloadButton = document.getElementById('download-lowpoly');
    const step1Button = document.getElementById('step1-btn');
    const step2Button = document.getElementById('step2-btn');
    const step3Button = document.getElementById('step3-btn');
    const step4Button = document.getElementById('step4-btn');

    // Update slider values
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

    // Get current parameters
    const getParams = () => ({
        voxel_size: parseFloat(voxelSlider.value),
        distance_threshold: parseFloat(distanceSlider.value),
        angle_tolerance: parseFloat(angleSlider.value),
        cluster_radius: parseFloat(clusterSlider.value),
        min_cluster_size: parseInt(minClusterSlider.value)
    });

    // Run extraction
    runButton.addEventListener('click', () => {
        callbacks.onRunExtraction(getParams());
    });

    // Step buttons
    step1Button.addEventListener('click', () => {
        callbacks.onStep1(getParams());
    });

    step2Button.addEventListener('click', () => {
        callbacks.onStep2(getParams());
    });

    step3Button.addEventListener('click', () => {
        callbacks.onStep3(getParams());
    });

    step4Button.addEventListener('click', () => {
        callbacks.onStep4(getParams());
    });

    // Download low-poly
    downloadButton.addEventListener('click', () => {
        callbacks.onDownload();
    });
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
    const step2Button = document.getElementById('step2-btn');
    const step3Button = document.getElementById('step3-btn');
    const step4Button = document.getElementById('step4-btn');

    runButton.disabled = !enabled;
    step1Button.disabled = !enabled;
    step2Button.disabled = !enabled;
    step3Button.disabled = !enabled;
    step4Button.disabled = !enabled;
}

export function showDownloadButton() {
    const downloadButton = document.getElementById('download-lowpoly');
    downloadButton.classList.remove('hidden');
}

export function updateStats(stats) {
    const statsDiv = document.getElementById('stats');

    // Handle different stat formats
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
