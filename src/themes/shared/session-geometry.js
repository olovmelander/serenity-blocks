// @ts-check
/**
 * Session memo for a theme's deterministic geometry builds.
 *
 * Some worlds build large meshes from analytic or baked ground on every start. Spring's land,
 * river, waterfall pour and step face took 75-200 ms each, warm, every time the theme opened: one
 * long task each in an in-play switch, where the outgoing theme and the board stall with it
 * (docs/THEME_FLEET_240_2026-10.md §7). Their output depends only on the inputs that make the
 * memo key (the tier's resolution and the session's ground bake), so the first build's arrays are
 * kept and later starts get a new BufferGeometry over the same arrays: identical vertices, and
 * no CPU work.
 *
 * Each start still gets its own geometry and attribute objects, so the world's dispose() works as
 * before (it releases that geometry's GPU buffers; a later renderer uploads its new attributes).
 * The arrays are shared between visits, so only geometry nothing writes to after it is built
 * belongs here.
 */
import * as THREE from 'three/webgpu';

/** scope (an object such as the ground bake, or NONE) -> key -> snapshot of the first build */
const memo = new WeakMap();
const NONE = {};

function snapshot(geometry) {
    return {
        attributes: Object.entries(geometry.attributes).map(([name, a]) => ({
            name, array: a.array, itemSize: a.itemSize, normalized: a.normalized,
        })),
        index: geometry.index ? geometry.index.array : null,
        groups: geometry.groups.map((g) => ({ ...g })),
        drawRange: { ...geometry.drawRange },
        boundingSphere: geometry.boundingSphere ? geometry.boundingSphere.clone() : null,
        boundingBox: geometry.boundingBox ? geometry.boundingBox.clone() : null,
        name: geometry.name,
    };
}

function rebuild(snap) {
    const geometry = new THREE.BufferGeometry();
    for (const a of snap.attributes) {
        geometry.setAttribute(a.name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
    }
    if (snap.index) geometry.setIndex(new THREE.BufferAttribute(snap.index, 1));
    for (const g of snap.groups) geometry.addGroup(g.start, g.count, g.materialIndex);
    geometry.setDrawRange(snap.drawRange.start, snap.drawRange.count);
    geometry.boundingSphere = snap.boundingSphere ? snap.boundingSphere.clone() : null;
    geometry.boundingBox = snap.boundingBox ? snap.boundingBox.clone() : null;
    geometry.name = snap.name;
    return geometry;
}

/**
 * @template {{ geometry: THREE.BufferGeometry }} T
 * @param {?object} scope an object the build depends on (the memo forgets it with it), or null
 * @param {string} key everything else the build depends on
 * @param {() => T} build a builder returning `{ geometry, ...plain values }`
 * @returns {T} the builder's result, with a geometry of its own over the shared arrays
 */
export function sessionGeometry(scope, key, build) {
    const owner = scope && typeof scope === 'object' ? scope : NONE;
    let byKey = memo.get(owner);
    if (!byKey) {
        byKey = new Map();
        memo.set(owner, byKey);
    }
    let entry = byKey.get(key);
    if (!entry) {
        const out = build();
        entry = { out, snap: snapshot(out.geometry) };
        byKey.set(key, entry);
        return out;
    }
    return { ...entry.out, geometry: rebuild(entry.snap) };
}
