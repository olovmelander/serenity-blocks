// @ts-check

/**
 * Textures an Odyssey module builds once and keeps for the whole process: noise bakes, palettes,
 * band ramps. three never destroys a texture's GPU copy when its renderer is disposed (it only
 * drops its own map), and the texture's 'dispose' listener keeps that renderer's backend alive.
 * The board builds a new renderer for every Odyssey visit, so each kept texture held one more
 * GPU copy and one more dead renderer per visit (about 8 MiB of VRAM, never freed).
 *
 * The board releases them as it disposes. Their CPU data stays on the texture, and the next
 * renderer to use one uploads it again.
 */

/** @type {Set<{ dispose: () => void }>} */
const residentTextures = new Set();

/**
 * Keep a texture across visits; the board frees its GPU copy when it disposes.
 * @template {{ dispose: () => void }} T
 * @param {T} texture
 * @returns {T}
 */
export function keepOdysseyTexture(texture) {
    if (texture) residentTextures.add(texture);
    return texture;
}

/** Free the GPU copy of every kept texture, before the renderer that holds them goes. */
export function releaseOdysseyTextures() {
    residentTextures.forEach((texture) => texture.dispose());
}
