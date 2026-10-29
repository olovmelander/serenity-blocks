// @ts-check
/**
 * Load an image as a texture decoded off the main thread.
 *
 * `TextureLoader` hands over an HTMLImageElement, and the WebGPU backend's first upload of it
 * (`copyExternalImageToTexture`, unpremultiplied) decodes the file again, synchronously, on the
 * main thread: `img.decode()` beforehand does not help. Neon District's atlases cost 204 and
 * 226 ms there, stalls of the outgoing theme and the board in an in-play switch
 * (docs/THEME_FLEET_240_2026-10.md). `createImageBitmap` on the fetched file decodes on a worker
 * thread with what the upload asks for (alpha unpremultiplied, colour managed the browser's
 * way), and flips it there instead of in the upload, so the upload copies ready pixels and the
 * texture reads the same texels. The bitmap is closed with the texture.
 */
import * as THREE from 'three/webgpu';

/**
 * Resolves null where there is no `createImageBitmap` (a headless host); the caller then loads
 * the image its old way.
 * @param {string} url
 * @returns {Promise<?THREE.Texture>}
 */
export async function loadBitmapTexture(url) {
    if (typeof createImageBitmap !== 'function' || typeof fetch !== 'function') return null;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob(), {
        imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'default',
    });
    const texture = new THREE.Texture(bitmap);
    texture.flipY = false; // flipped at decode
    texture.needsUpdate = true;
    texture.addEventListener('dispose', () => bitmap.close?.());
    return texture;
}
