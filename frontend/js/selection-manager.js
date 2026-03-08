import * as THREE from 'three';

/**
 * SelectionManager: Pure selection/highlight logic
 * Responsibilities:
 * - Track selection state and type (model/wall/ceiling/floor/face)
 * - Apply and clear visual highlights in scene
 * - Emit onChange events for UI updates
 * - Support multi-select via Shift+Click (same type only)
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
        // Multi-select: list of { object, type, faceIndex? }
        this._selectedItems = [];
        this._selectionType = null; // Common type of all selected items

        // Backward compat alias (kept for external callers using getSelected())
        this.selectedObject = null;

        this.highlightMeshes = []; // Array of { lines, forObject } for per-object removal
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
            this._selectedItems = [];
            this._selectionType = null;
            this.selectedObject = null;
        }
    }

    /**
     * Handle a raycaster hit
     * @param {THREE.Intersection} hit - from raycaster.intersectObjects()
     * @param {boolean} shiftHeld - if true, add/remove from multi-selection
     * @returns {boolean} true if selection changed
     */
    handleHit(hit, shiftHeld = false) {
        if (!hit) {
            this.deselect();
            return true;
        }

        const target = this._resolveTarget(hit);
        if (!target) {
            if (!shiftHeld) this.deselect();
            return true;
        }

        if (!shiftHeld) {
            // Normal click: replace selection entirely
            this._clearHighlight();
            this._selectedItems = [target];
            this._selectionType = target.type;
            this.selectedObject = target;
            this._applyHighlight(target);
            this._notifyChange();
            return true;
        }

        // Shift+Click multi-select (same type only)
        if (this._selectionType !== null && target.type !== this._selectionType) {
            // Type mismatch: ignore
            return false;
        }

        const idx = this._selectedItems.findIndex(x => x.object === target.object);
        if (idx >= 0) {
            // Already selected: deselect this item
            this._removeHighlightForObject(this._selectedItems[idx].object);
            this._selectedItems.splice(idx, 1);
        } else {
            // New item: add to selection
            this._selectedItems.push(target);
            this._appendHighlight(target);
        }

        this._selectionType = this._selectedItems.length > 0 ? this._selectedItems[0].type : null;
        this.selectedObject = this._selectedItems[0] || null;
        this._notifyChange();
        return true;
    }

    /**
     * Clear selection and highlight
     */
    deselect() {
        if (this._selectedItems.length === 0) return;
        this._clearHighlight();
        this._selectedItems = [];
        this._selectionType = null;
        this.selectedObject = null;
        this._notifyChange();
    }

    /**
     * Directly set a single resolved target (bypasses _resolveTarget).
     * Used after merge to re-select the merged mesh.
     * @param {{ object, type }} target
     */
    _selectSingle(target) {
        this._clearHighlight();
        this._selectedItems = [target];
        this._selectionType = target.type;
        this.selectedObject = target;
        this._applyHighlight(target);
        this._notifyChange();
    }

    /**
     * Get current selection (first item for backward compat)
     * @returns {{ object, type, faceIndex? } | null}
     */
    getSelected() {
        return this._selectedItems[0] || null;
    }

    /**
     * Get all selected items
     * @returns {Array<{ object, type }>}
     */
    getSelectedItems() {
        return [...this._selectedItems];
    }

    /**
     * Get the common type of selected items, or null if nothing selected
     * @returns {string|null}
     */
    getSelectedType() {
        return this._selectionType;
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
     * Apply visual highlight for a target (single target, appends to list)
     * @private
     */
    _applyHighlight(target) {
        this._appendHighlight(target);
    }

    /**
     * Append highlight lines for one target without clearing existing ones
     * @private
     */
    _appendHighlight(target) {
        const color = 0xffee00; // Yellow

        if (target.type === 'model') {
            const group = target.object;
            group.traverse((child) => {
                if (child.isMesh) {
                    const edgesGeo = new THREE.EdgesGeometry(child.geometry);
                    const edgesMat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
                    const lines = new THREE.LineSegments(edgesGeo, edgesMat);
                    lines.renderOrder = 1;
                    child.add(lines);
                    this.highlightMeshes.push({ lines, forObject: child });
                }
            });
        } else if (['wall', 'ceiling', 'floor'].includes(target.type)) {
            const mesh = target.object;
            const edgesGeo = new THREE.EdgesGeometry(mesh.geometry);
            const edgesMat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
            const lines = new THREE.LineSegments(edgesGeo, edgesMat);
            lines.renderOrder = 1;
            mesh.add(lines);
            this.highlightMeshes.push({ lines, forObject: mesh });
        }
    }

    /**
     * Remove highlight for a specific object only
     * @private
     */
    _removeHighlightForObject(mesh) {
        const toRemove = this.highlightMeshes.filter(h => h.forObject === mesh);
        toRemove.forEach(h => {
            if (h.lines.parent) h.lines.parent.remove(h.lines);
            if (h.lines.geometry) h.lines.geometry.dispose();
            if (h.lines.material) h.lines.material.dispose();
        });
        this.highlightMeshes = this.highlightMeshes.filter(h => h.forObject !== mesh);
    }

    /**
     * Remove all highlights from scene
     * @private
     */
    _clearHighlight() {
        this.highlightMeshes.forEach(h => {
            if (h.lines.parent) {
                h.lines.parent.remove(h.lines);
            }
            if (h.lines.geometry) h.lines.geometry.dispose();
            if (h.lines.material) {
                if (Array.isArray(h.lines.material)) {
                    h.lines.material.forEach(m => m.dispose());
                } else {
                    h.lines.material.dispose();
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
        let selInfo;
        if (this._selectedItems.length === 0) {
            selInfo = null;
        } else if (this._selectedItems.length === 1) {
            const item = this._selectedItems[0];
            selInfo = `${item.type}: ${item.object?.name || 'unnamed'}`;
        } else {
            const names = this._selectedItems.map(x => x.object?.name || 'unnamed').join(', ');
            selInfo = `${this._selectedItems.length} ${this._selectionType}s selected: ${names}`;
        }

        this.callbacks.forEach(cb => cb(selInfo));
    }
}
