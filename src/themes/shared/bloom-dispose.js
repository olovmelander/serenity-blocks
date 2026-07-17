// @ts-check

/**
 * Deep disposal for the addons BloomNode (three/addons/tsl/display/BloomNode.js).
 *
 * three r181's BloomNode.dispose() frees its render targets but NOT its internal
 * NodeMaterials (_highPassFilterMaterial, _separableBlurMaterials[0..4],
 * _compositeMaterial). Those materials are rendered through the module-level
 * shared QuadMesh, so each one owns a renderer RenderObject that registers a
 * 'dispose' listener on the shared quad geometry (RenderObject subscribes to
 * both material and geometry dispose; only material disposal detaches it —
 * three.webgpu RenderObject.dispose()). Because the shared quad geometry is a
 * module singleton that is never disposed, every undisposed bloom material
 * permanently leaks its RenderObject, whose node-builder state retains the
 * scene pass (PassNode) and through it the ENTIRE disposed theme scene.
 *
 * Measured impact before this fix (PERFORMANCE_STABILITY_AUDIT.md SB-15):
 * +2.4–3.3 MB of GC-immune JS heap and +7 leaked quad-geometry dispose
 * listeners per theme activation for lunara / stellar-drift / ocean.
 *
 * The private-field access below is deliberately version-coupled to the pinned
 * three release (package.json: three 0.181.x). If three upgrades ever make
 * BloomNode.dispose() release its materials, this helper degrades to a no-op
 * for the missing fields.
 *
 * @param {object|null|undefined} bloomNode - A BloomNode instance (or null).
 */
export function disposeBloomNodeDeep(bloomNode) {
    if (!bloomNode) return;

    try {
        bloomNode.dispose?.();
    } catch (error) {
        console.warn('[bloom-dispose] BloomNode.dispose() failed:', error);
    }

    const materials = [
        bloomNode._highPassFilterMaterial,
        bloomNode._compositeMaterial,
        ...(Array.isArray(bloomNode._separableBlurMaterials) ? bloomNode._separableBlurMaterials : []),
    ];

    for (const material of materials) {
        if (!material) continue;
        try {
            material.dispose?.();
        } catch (error) {
            console.warn('[bloom-dispose] bloom material dispose failed:', error);
        }
        // BloomNode renders through a module-level shared QuadMesh and leaves the
        // last-rendered material parked on that singleton's .material — a strong
        // module-scope reference that survives both disposals above. Severing the
        // material's node graph here caps that parked reference at a few small
        // objects instead of the full TSL graph + node builder + scene pass.
        try {
            material.fragmentNode = null;
            material.colorNode = null;
            material.outputNode = null;
        } catch (error) {
            console.warn('[bloom-dispose] bloom material node severing failed:', error);
        }
    }
}
