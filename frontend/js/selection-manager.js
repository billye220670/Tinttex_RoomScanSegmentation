import * as THREE from 'three';

/**
 * SelectionManager: Pure selection/highlight logic
 * Responsibilities:
 * - Track selection state and type (model/wall/ceiling/floor/face)
 * - Apply and clear visual highlights in scene
 * - Emit onChange events for UI updates
 *
 * Does NOT:
 * - Perform raycasting (caller's responsibility)
 * - Manipulate DOM
 * - Know about droppedModels (passed via getter)
 */
export class SelectionManager {
    constructor(scene, getLabelFn, getDroppedModelsFn) {
        this.scene = scene;
        this.getLabelFn = getLabelFn; // (mesh) => 'floor'|'ceiling'|'wall'|null
        this.getDroppedModelsFn = getDroppedModelsFn; // () => [models...]

        this.selectionType = 'model'; // 'model'|'wall'|'ceiling'|'floor'|'face'
        this.selectedObject = null; // { object, type, faceIndex? }

        this.highlightMeshes = []; // Array of THREE.LineSegments or Mesh for highlights
        this.callbacks = [];
    }

    /**
     * Change selection type
     */
    setType(type) {
        if (['model', 'wall', 'ceiling', 'floor'].includes(type)) {
            this.selectionType = type;
            // Clear current highlight since type changed
            this._clearHighlight();
        }
    }

    /**
     * Handle a raycaster hit
     * @param {THREE.Intersection} hit - from raycaster.intersectObjects()
     * @returns {boolean} true if selection changed
     */
    handleHit(hit) {
        if (!hit) {
            this.deselect();
            return true;
        }

        const target = this._resolveTarget(hit);
        if (!target) {
            this.deselect();
            return true;
        }

        this._clearHighlight();
        this.selectedObject = target;
        this._applyHighlight(target);
        this._notifyChange();
        return true;
    }

    /**
     * Clear selection and highlight
     */
    deselect() {
        if (!this.selectedObject) return;
        this._clearHighlight();
        this.selectedObject = null;
        this._notifyChange();
    }

    /**
     * Get current selection
     * @returns {{ object, type, faceIndex? } | null}
     */
    getSelected() {
        return this.selectedObject;
    }

    /**
     * Register a callback for selection changes
     */
    onChange(callback) {
        this.callbacks.push(callback);
    }

    /**
     * Dispose of all highlight meshes
     */
    dispose() {
        this._clearHighlight();
    }

    // ========== Private Methods ==========

    /**
     * Resolve the actual target object from a hit based on selectionType
     * @private
     */
    _resolveTarget(hit) {
        if (!hit || !hit.object) return null;

        if (this.selectionType === 'model') {
            // Walk up the hierarchy to find root in droppedModels
            let obj = hit.object;
            const droppedModels = this.getDroppedModelsFn();
            while (obj) {
                if (droppedModels.includes(obj)) {
                    return { object: obj, type: 'model' };
                }
                obj = obj.parent;
            }
            return null;
        }

        if (['wall', 'ceiling', 'floor'].includes(this.selectionType)) {
            // Check if the mesh matches the label
            const label = this.getLabelFn(hit.object);
            if (label === this.selectionType) {
                return { object: hit.object, type: this.selectionType };
            }

            // If not matching and parent has correct label, use parent
            if (hit.object.parent && hit.object.parent.isMesh) {
                const parentLabel = this.getLabelFn(hit.object.parent);
                if (parentLabel === this.selectionType) {
                    return { object: hit.object.parent, type: this.selectionType };
                }
            }
            return null;
        }

        return null;
    }

    /**
     * Apply visual highlight
     * @private
     */
    _applyHighlight(target) {
        const color = 0xffee00; // Yellow

        if (target.type === 'model') {
            // For model (Group), highlight all child meshes
            const group = target.object;
            group.traverse((child) => {
                if (child.isMesh) {
                    const edgesGeo = new THREE.EdgesGeometry(child.geometry);
                    const edgesMat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
                    const lines = new THREE.LineSegments(edgesGeo, edgesMat);
                    lines.renderOrder = 1;

                    child.add(lines);
                    this.highlightMeshes.push(lines);
                }
            });
        } else if (['wall', 'ceiling', 'floor'].includes(target.type)) {
            // Edge highlight for mesh
            const mesh = target.object;

            const edgesGeo = new THREE.EdgesGeometry(mesh.geometry);
            const edgesMat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
            const lines = new THREE.LineSegments(edgesGeo, edgesMat);
            lines.renderOrder = 1;

            mesh.add(lines);
            this.highlightMeshes.push(lines);
        }
    }

    /**
     * Remove all highlights from scene
     * @private
     */
    _clearHighlight() {
        this.highlightMeshes.forEach(highlight => {
            if (highlight.parent) {
                highlight.parent.remove(highlight);
            }
            if (highlight.geometry) highlight.geometry.dispose();
            if (highlight.material) {
                if (Array.isArray(highlight.material)) {
                    highlight.material.forEach(m => m.dispose());
                } else {
                    highlight.material.dispose();
                }
            }
        });
        this.highlightMeshes = [];
    }

    /**
     * Notify change listeners
     * @private
     */
    _notifyChange() {
        const selInfo = this.selectedObject
            ? `${this.selectedObject.type}: ${this.selectedObject.object?.name || 'unnamed'}`
            : null;

        this.callbacks.forEach(cb => cb(selInfo));
    }
}
