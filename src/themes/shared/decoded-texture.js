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
 * The fetched file as an ImageBitmap decoded on a worker thread the way the upload wants it, or
 * null where it cannot be (no createImageBitmap). Rejects when the fetch or the decode fails.
 * @param {string} url
 * @param {boolean} flipY
 * @returns {Promise<?ImageBitmap>}
 */
async function decodeBitmap(url, flipY) {
    if (typeof createImageBitmap !== 'function' || typeof fetch !== 'function') return null;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return createImageBitmap(await response.blob(), {
        imageOrientation: flipY ? 'flipY' : 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default',
    });
}

/**
 * Resolves null where there is no `createImageBitmap` (a headless host); the caller then loads
 * the image its old way. `flipY` is the texture's own flip (three's default true): it is done at
 * decode, so the texture is handed over with `flipY = false` either way and reads the same texels.
 * @param {string} url
 * @param {{ flipY?: boolean }} [options]
 * @returns {Promise<?THREE.Texture>}
 */
export async function loadBitmapTexture(url, { flipY = true } = {}) {
    const bitmap = await decodeBitmap(url, flipY);
    if (!bitmap) return null;
    const texture = new THREE.Texture(bitmap);
    texture.flipY = false; // flipped at decode, when it is to be
    texture.needsUpdate = true;
    texture.addEventListener('dispose', () => bitmap.close?.());
    return texture;
}

/**
 * `loadBitmapTexture`, or `textureLoader.loadAsync(url)` where a bitmap cannot be decoded (a
 * headless host, a test's injected loader): for the asset loaders that take a TextureLoader.
 * A texture that wants `flipY = false` must say so here: the bitmap is flipped (or not) at decode.
 * @param {string} url
 * @param {{ loadAsync: (url: string) => Promise<any> }} textureLoader
 * @param {{ flipY?: boolean }} [options]
 * @returns {Promise<any>}
 */
export async function loadDecodedTexture(url, textureLoader, options = {}) {
    let bitmap = null;
    try {
        bitmap = await loadBitmapTexture(url, options);
    } catch {
        bitmap = null; // the loader tries it the old way, and reports the failure its own way
    }
    return bitmap ?? textureLoader.loadAsync(url);
}

/**
 * `new THREE.TextureLoader().load(url)` decoded off the main thread: the texture is returned at
 * once, imageless, and filled when the bitmap arrives (as TextureLoader fills its texture when the
 * image arrives). Where a bitmap cannot be decoded, an ImageLoader fills it the old way (three's
 * own flip). A texture disposed before its image arrives lets the bitmap go.
 * @param {string} url
 * @param {{ flipY?: boolean }} [options] the texture's flip, done at decode (three's default true)
 * @returns {THREE.Texture}
 */
export function loadTextureDecoded(url, { flipY = true } = {}) {
    const texture = new THREE.Texture();
    texture.flipY = flipY;
    let disposed = false;
    texture.addEventListener('dispose', () => { disposed = true; });
    const viaLoader = () => {
        if (disposed) return;
        new THREE.ImageLoader().load(url, (image) => {
            if (disposed) return;
            texture.image = image;
            texture.needsUpdate = true;
        });
    };
    decodeBitmap(url, flipY).then((bitmap) => {
        if (!bitmap) {
            viaLoader();
            return;
        }
        if (disposed) {
            bitmap.close?.();
            return;
        }
        texture.image = bitmap;
        texture.flipY = false; // flipped at decode, when it is to be
        texture.needsUpdate = true;
        texture.addEventListener('dispose', () => bitmap.close?.());
    }, viaLoader);
    return texture;
}
