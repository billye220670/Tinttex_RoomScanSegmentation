/**
 * DragDropLoader: Handles drag-and-drop GLTF/GLB file loading
 * Responsibilities:
 * - Listen for dragover/drop events on a canvas element
 * - Validate dropped files (.glb / .gltf)
 * - Parse file and invoke callbacks
 *
 * Does NOT:
 * - Place models in scene (caller's responsibility)
 * - Know about raycasting or viewport positioning
 */
export class DragDropLoader {
    constructor(canvas, gltfLoader) {
        this.canvas = canvas;
        this.gltfLoader = gltfLoader;
        this.listeners = null;
        this.dragDepth = 0; // Track nested dragover events
    }

    /**
     * Initialize drag-drop event listeners
     * @param {Object} callbacks - { onLoad, onError, onDragEnter, onDragLeave }
     */
    init(callbacks) {
        this.listeners = callbacks;

        this.canvas.addEventListener('dragover', this._handleDragOver.bind(this));
        this.canvas.addEventListener('dragleave', this._handleDragLeave.bind(this));
        this.canvas.addEventListener('drop', this._handleDrop.bind(this));
        this.canvas.addEventListener('dragenter', this._handleDragEnter.bind(this));
    }

    /**
     * Clean up event listeners
     */
    dispose() {
        if (this.canvas) {
            this.canvas.removeEventListener('dragover', this._handleDragOver);
            this.canvas.removeEventListener('dragleave', this._handleDragLeave);
            this.canvas.removeEventListener('drop', this._handleDrop);
            this.canvas.removeEventListener('dragenter', this._handleDragEnter);
        }
    }

    // ========== Private Methods ==========

    _handleDragEnter(e) {
        e.preventDefault();
        this.dragDepth++;
        if (this.dragDepth === 1 && this.listeners?.onDragEnter) {
            this.listeners.onDragEnter();
        }
    }

    _handleDragLeave(e) {
        e.preventDefault();
        this.dragDepth--;
        if (this.dragDepth === 0 && this.listeners?.onDragLeave) {
            this.listeners.onDragLeave();
        }
    }

    _handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    }

    _handleDrop(e) {
        e.preventDefault();
        this.dragDepth = 0;

        if (this.listeners?.onDragLeave) {
            this.listeners.onDragLeave();
        }

        const files = e.dataTransfer.files;
        if (!files || files.length === 0) {
            if (this.listeners?.onError) {
                this.listeners.onError(new Error('No files dropped'));
            }
            return;
        }

        // Process first file
        const file = files[0];
        const ext = file.name.split('.').pop().toLowerCase();

        if (!['glb', 'gltf'].includes(ext)) {
            if (this.listeners?.onError) {
                this.listeners.onError(new Error(`Unsupported file type: ${ext}`));
            }
            return;
        }

        // Read file as ArrayBuffer
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const buffer = evt.target.result;
                this.gltfLoader.parse(
                    buffer,
                    '',
                    (gltf) => {
                        if (this.listeners?.onLoad) {
                            this.listeners.onLoad(gltf, e);
                        }
                    },
                    (err) => {
                        if (this.listeners?.onError) {
                            this.listeners.onError(err);
                        }
                    }
                );
            } catch (err) {
                if (this.listeners?.onError) {
                    this.listeners.onError(err);
                }
            }
        };

        reader.onerror = () => {
            if (this.listeners?.onError) {
                this.listeners.onError(new Error('Failed to read file'));
            }
        };

        reader.readAsArrayBuffer(file);
    }
}
