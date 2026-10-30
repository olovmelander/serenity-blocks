/**
 * Warm three's reflection map (PMREM) pipelines before a theme's first frame.
 *
 * A material that samples an equirectangular environment (scene.environment) makes three's
 * PMREMNode turn it into a PMREM the first time it builds: its passes compile synchronously on the
 * GPU process then (they draw into cube targets, which the app's async pipelines leave synchronous),
 * a stall of the theme still playing in an in-play switch. On r186 that was 21 + 39 ms in Chiral
 * Gold, and its worst load frame went 84-96 -> 38 ms with the warm. Compiling the same draws
 * asynchronously first, into targets of the same size and format, leaves those pipelines cached for
 * that first build.
 *
 * r187 (#34585) builds a PMREM from cube render targets: fromEquirectangular draws the texture into
 * a source cube (the equirect pass), then every level of the PMREM from it (the GGX pass for the
 * sharp levels, the integration pass for the rough ones), each with the generator's box mesh and
 * cube camera through `_renderCube(target, lod, material)`. The warm runs that very conversion with
 * `_renderCube` recording instead of drawing (the generator sets every uniform as it would), then
 * compiles each recorded (target, material) pair once.
 *
 * three frees a pipeline when the last material using it is disposed, so the warm materials are
 * kept until the theme lets them go (the returned release, at its dispose); their render targets
 * are freed at once (a pipeline does not hold them).
 *
 * It drives PMREMGenerator's internals (_setSize, _allocateTarget, _textureToCubemap, _applyPMREM,
 * _renderCube, _boxMesh, _cubeCamera, _sourceTarget): pinned to three r187 (tests/unit/pmrem-warm.test.js
 * checks they exist). Any failure is ignored: the first build then compiles them as before.
 */
import * as THREE from 'three/webgpu';

/**
 * @param {THREE.WebGPURenderer} renderer  an initialised renderer (WebGPU; WebGL2 is left alone)
 * @param {THREE.Texture} texture  the equirectangular environment the scene will use
 * @returns {Promise<?Function>} a release for the warm materials (null when nothing was warmed);
 *   never rejects
 */
export async function warmPmremPipelines(renderer, texture) {
    if (!renderer?.backend?.isWebGPUBackend || !texture?.image) return null;
    if (typeof renderer.getRenderTarget !== 'function' || typeof renderer.compileAsync !== 'function') return null;
    const generator = new THREE.PMREMGenerator(renderer);
    const previous = {
        target: renderer.getRenderTarget(),
        face: renderer.getActiveCubeFace?.() ?? 0,
        level: renderer.getActiveMipmapLevel?.() ?? 0,
    };
    let pmrem = null;
    let warmed = false;
    try {
        await renderer.init?.();
        /** target → the materials drawn into it (and the first level each is drawn at) */
        const draws = new Map();
        generator._renderCube = (target, lod, material) => {
            if (!draws.has(target)) draws.set(target, new Map());
            const materials = draws.get(target);
            if (!materials.has(material)) materials.set(material, lod);
        };
        // What _fromTexture does for an equirectangular texture, recorded instead of drawn.
        generator._setSize(texture.image.width / 4);
        pmrem = generator._allocateTarget();
        generator._textureToCubemap(texture);
        generator._applyPMREM(pmrem);
        const mesh = generator._boxMesh;
        const camera = generator._cubeCamera.children[0];
        for (const [target, materials] of draws) {
            for (const [material, lod] of materials) {
                mesh.material = material;
                renderer.setRenderTarget(target, 0, lod);
                // eslint-disable-next-line no-await-in-loop -- one pass at a time, as the build draws them
                await renderer.compileAsync(mesh, camera);
                warmed = true;
            }
        }
    } catch {
        warmed = false;
    } finally {
        renderer.setRenderTarget(previous.target, previous.face, previous.level);
        delete generator._renderCube;
        pmrem?.dispose();
        generator._sourceTarget?.dispose();
        generator._sourceTarget = null;
    }
    if (!warmed) {
        generator.dispose();
        return null;
    }
    let released = false;
    return () => {
        if (released) return;
        released = true;
        generator.dispose();
    };
}
