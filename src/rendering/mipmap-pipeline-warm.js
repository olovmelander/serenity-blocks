// @ts-check
/**
 * Warm three's mipmap pipelines on a new renderer's device, off the GPU process's main thread.
 *
 * three generates a texture's mips with one render pipeline per format
 * (WebGPUTexturePassUtils.getTransferPipeline: `mipmap-${format}-${viewDimension}`, layout 'auto'),
 * created with the SYNCHRONOUS device.createRenderPipeline the first time a texture of that format
 * needs mips. Every theme starts on a fresh GPUDevice (theme-device-spare), so every theme start
 * compiled them again on the GPU process's main thread, which also draws the display. They were the
 * only synchronous pipelines of an in-play theme switch, and in 11 of 40 first-visit switches the
 * switch's worst frame began at one: Blood Moon 79-84 ms, Neon Quarter 80-82, Verdant Hills 78,
 * Grainfields 55-60, Solar Eclipse 50-52, Ice Temple 35-39 (fleet bench, three r187, 2026-10-31).
 *
 * This creates the same pipelines with createRenderPipelineAsync (compiled on Dawn's workers) and puts
 * each into three's own cache (`transferPipelines[`${format}-${viewDimension}`]`) when it lands,
 * unless three has made one by then (it then simply keeps its own). Same shader module, entry point,
 * target and 'auto' layout, so three's bind groups (`getBindGroupLayout( 0 )`) fit it. Any failure is
 * ignored: three then creates the pipeline itself, as before.
 * Pinned by tests/unit/mipmap-pipeline-warm.test.js against the installed three.
 */

/** The formats themes generate mips for (the switches' synchronous pipelines, most common first). */
export const MIPMAP_WARM_FORMATS = Object.freeze(['rgba8unorm', 'rgba8unorm-srgb', 'rgba16float', 'r8unorm']);

/**
 * @param {any} renderer an initialised WebGPU renderer (anything else is left alone)
 * @param {readonly string[]} [formats]
 * @param {string} [viewDimension] three's textureBindingViewDimension ('2d-array' for 2D textures)
 * @returns {Promise<number>} how many pipelines went into three's cache; never rejects
 */
export function warmMipmapPipelines(renderer, formats = MIPMAP_WARM_FORMATS, viewDimension = '2d-array') {
    const backend = renderer?.backend;
    const device = backend?.device;
    const textureUtils = backend?.textureUtils;
    if (backend?.isWebGPUBackend !== true || !device || typeof device.createRenderPipelineAsync !== 'function'
        || typeof textureUtils?._getPassUtils !== 'function') {
        return Promise.resolve(0);
    }
    let passUtils;
    try {
        passUtils = textureUtils._getPassUtils();
    } catch {
        return Promise.resolve(0);
    }
    const cache = passUtils?.transferPipelines;
    const module = passUtils?.mipmapShaderModule;
    if (!cache || !module) return Promise.resolve(0);
    const entryPoint = `main_${viewDimension.replace('-', '_')}`;
    const jobs = formats.map((format) => {
        const key = `${format}-${viewDimension}`;
        if (cache[key] !== undefined) return Promise.resolve(false);
        let job;
        try {
            job = device.createRenderPipelineAsync({
                label: `mipmap-${format}-${viewDimension}`,
                vertex: { module },
                fragment: { module, entryPoint, targets: [{ format }] },
                layout: 'auto',
            });
        } catch {
            return Promise.resolve(false);
        }
        return Promise.resolve(job).then((pipeline) => {
            if (cache[key] !== undefined) return false; // three needed it first and made its own
            cache[key] = pipeline;
            return true;
        }, () => false);
    });
    return Promise.all(jobs).then((done) => done.filter(Boolean).length, () => 0);
}
