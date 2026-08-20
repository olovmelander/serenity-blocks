// @ts-check

/**
 * Post-dispose severing for the addons BloomNode (three/addons/tsl/display/BloomNode.js).
 *
 * three r185's BloomNode.dispose() now frees its internal NodeMaterials
 * (_highPassFilterMaterial, _compositeMaterial, _separableBlurMaterials[0..4])
 * along with its render targets — the material-dispose half of the SB-15 leak
 * (PERFORMANCE_STABILITY_AUDIT.md) is fixed upstream, so this helper no longer
 * disposes them itself.
 *
 * What upstream still does NOT fix: BloomNode renders through a module-level
 * shared QuadMesh and leaves the last-rendered material parked on that
 * singleton's .material — a strong module-scope reference that survives
 * disposal. Without the severing below, that parked material retains its full
 * TSL graph + node builder + scene pass (PassNode) and through it the entire
 * disposed theme scene until the next bloom render overwrites it.
 *
 * The private-field access below is version-coupled to the installed three
 * release. If a future upgrade renames the fields, the helper degrades to a
 * no-op for the missing fields; tests/unit/bloom-dispose-contract.test.js pins
 * the contract so that fails loudly instead of silently.
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
        // Severing the material's node graph caps the reference parked on the
        // shared quad's .material at a few small objects instead of the full
        // TSL graph + node builder + scene pass.
        try {
            material.fragmentNode = null;
            material.colorNode = null;
            material.outputNode = null;
        } catch (error) {
            console.warn('[bloom-dispose] bloom material node severing failed:', error);
        }
    }
}
