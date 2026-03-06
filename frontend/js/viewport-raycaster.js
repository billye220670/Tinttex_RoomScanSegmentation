import * as THREE from 'three';

/**
 * Reusable viewport raycaster.
 * Converts mouse/pointer events (or raw NDC) to 3D intersections against a
 * scene object list, without allocating a new Raycaster every frame.
 */
export class ViewportRaycaster {
    constructor() {
        this._rc  = new THREE.Raycaster();
        this._ndc = new THREE.Vector2();
    }

    /**
     * Cast from a mouse/pointer event on a canvas element.
     * @param {MouseEvent}         event
     * @param {HTMLElement}        canvas
     * @param {THREE.Camera}       camera
     * @param {THREE.Object3D[]}   objects   - flat list; no deep traversal by default
     * @param {boolean}            recursive
     * @returns {THREE.Intersection | null}
     */
    cast(event, canvas, camera, objects, recursive = false) {
        const rect = canvas.getBoundingClientRect();
        this._ndc.set(
            ((event.clientX - rect.left) / rect.width)  *  2 - 1,
           -((event.clientY - rect.top)  / rect.height) *  2 + 1
        );
        return this._intersect(camera, objects, recursive);
    }

    /**
     * Cast from pre-computed NDC coordinates ([-1,1] on both axes).
     * @param {number}           ndcX
     * @param {number}           ndcY
     * @param {THREE.Camera}     camera
     * @param {THREE.Object3D[]} objects
     * @param {boolean}          recursive
     * @returns {THREE.Intersection | null}
     */
    castFromNDC(ndcX, ndcY, camera, objects, recursive = false) {
        this._ndc.set(ndcX, ndcY);
        return this._intersect(camera, objects, recursive);
    }

    _intersect(camera, objects, recursive) {
        this._rc.setFromCamera(this._ndc, camera);
        const hits = this._rc.intersectObjects(objects, recursive);
        return hits.length > 0 ? hits[0] : null;
    }
}
