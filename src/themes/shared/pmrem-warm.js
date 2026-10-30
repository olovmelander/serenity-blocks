/**
 * Warm three's reflection map (PMREM) pipelines before a theme's first frame.
 *
 * A material that samples an equirectangular environment (scene.environment) makes three's
 * PMREMNode turn it into a PMREM the first time it builds: its equirect pass and its GGX blur
 * compile synchronously on the GPU process then (21 + 39 ms in Chiral Gold, a stall of the theme
 * still playing in an in-play switch; with the warm its worst load frame went 84-96 -> 38 ms). Compiling the same materials asynchronously first, into a
 * target of the same size and format, leaves those pipelines cached for that first build.
 *
 * three frees a pipeline when the last material using it is disposed, so the warm materials are
 * kept until the theme lets them go (the returned release, at its dispose); their render targets
 * are freed at once (a pipeline does not hold them).
 *
 * It drives PMREMGenerator's internals (_setSizeFromTexture, _allocateTarget, _init, _lodMeshes,
 * _equirectMaterial, _ggxMaterial, _pingPongRenderTarget): pinned to three r186 (tests/unit/pmrem-warm.test.js
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
    const previous = renderer.getRenderTarget();
    let target = null;
    let warmed = false;
    try {
        generator._setSizeFromTexture(texture);
        target = generator._allocateTarget(false);
        generator._init(target);
        await renderer.init?.();
        // The very draws fromEquirectangular makes (its cube-face meshes carry the vertex layout,
        // the studio the texture binding): the equirect pass on face mesh 0, the GGX filter on the
        // next level's, both into a target of the PMREM's size and format.
        const camera = new THREE.OrthographicCamera();
        await generator.compileEquirectangularShader();
        const equirect = generator._equirectMaterial;
        equirect.fragmentNode.value = texture;
        const face = generator._lodMeshes[0];
        face.material = equirect;
        renderer.setRenderTarget(target);
        await renderer.compileAsync(face, camera);
        const level = generator._lodMeshes[Math.min(1, generator._lodMeshes.length - 1)];
        level.material = generator._ggxMaterial;
        await renderer.compileAsync(level, camera);
        warmed = true;
    } catch {
        warmed = false;
    } finally {
        renderer.setRenderTarget(previous);
        target?.dispose();
        generator._pingPongRenderTarget?.dispose();
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
