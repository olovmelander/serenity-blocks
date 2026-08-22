import * as THREE from 'three';
import * as WEBGPU from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
const TEXTURE_BASE = `${BASE_URL}textures/lunara/`;
const HDRI_URL = `${BASE_URL}hdri/qwantani_moonrise_puresky_1k.hdr`;

export const LUNARA_DETAIL_ASSETS = Object.freeze({
    ground: {
        detail: 'moon_dusted_01_diff_1k.jpg',
        normal: 'moon_dusted_01_nor_gl_1k.jpg',
        roughness: 'moon_dusted_01_rough_1k.jpg',
    },
    rock: {
        detail: 'aerial_rocks_02_diff_1k.jpg',
        normal: 'aerial_rocks_02_nor_gl_1k.jpg',
        roughness: 'aerial_rocks_02_rough_1k.jpg',
    },
    mountain: {
        detail: 'cliff_side_diff_1k.jpg',
        normal: 'cliff_side_nor_gl_1k.jpg',
        roughness: 'cliff_side_rough_1k.jpg',
    },
    streamBank: {
        detail: 'dry_riverbed_rock_diff_1k.jpg',
        normal: 'dry_riverbed_rock_nor_gl_1k.jpg',
        roughness: 'dry_riverbed_rock_rough_1k.jpg',
    },
});

function neutralCanvas(hex = '#808080') {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.fillStyle = hex;
        ctx.fillRect(0, 0, 2, 2);
    }
    return canvas;
}

function configureTexture(texture, { repeat = 1, colorSpace = THREE.NoColorSpace } = {}) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.colorSpace = colorSpace;
    texture.anisotropy = 4;
    return texture;
}

function createPlaceholderTexture({ repeat = 1, color = '#808080', colorSpace = THREE.NoColorSpace } = {}) {
    const texture = new THREE.Texture(neutralCanvas(color) || undefined);
    configureTexture(texture, { repeat, colorSpace });
    texture.needsUpdate = true;
    return texture;
}

function loadLunaraTexture(url, {
    repeat = 1,
    colorSpace = THREE.NoColorSpace,
    fallbackColor = '#808080',
} = {}) {
    const loader = new THREE.TextureLoader();
    const texture = createPlaceholderTexture({ repeat, color: fallbackColor, colorSpace });
    texture.userData.lifecycleDisposed = false;
    texture.addEventListener('dispose', () => {
        texture.userData.lifecycleDisposed = true;
    });
    loader.load(
        url,
        (loaded) => {
            if (texture.userData.lifecycleDisposed) {
                loaded.dispose?.();
                return;
            }
            texture.image = loaded.image;
            configureTexture(texture, { repeat, colorSpace });
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.generateMipmaps = true;
            texture.needsUpdate = true;
            loaded.dispose?.();
        },
        undefined,
        () => {
            if (texture.userData.lifecycleDisposed) return;
            texture.image = neutralCanvas(fallbackColor) || undefined;
            configureTexture(texture, { repeat, colorSpace });
            texture.needsUpdate = true;
        },
    );
    return texture;
}

function createRoleTextures(role, repeat) {
    return {
        detail: loadLunaraTexture(
            `${TEXTURE_BASE}${role.detail}`,
            { repeat, colorSpace: THREE.NoColorSpace, fallbackColor: '#808080' },
        ),
        normal: loadLunaraTexture(
            `${TEXTURE_BASE}${role.normal}`,
            { repeat, colorSpace: THREE.NoColorSpace, fallbackColor: '#8080ff' },
        ),
        roughness: loadLunaraTexture(
            `${TEXTURE_BASE}${role.roughness}`,
            { repeat, colorSpace: THREE.NoColorSpace, fallbackColor: '#808080' },
        ),
    };
}

export function createLunaraDetailTextureSet() {
    return {
        ground: createRoleTextures(LUNARA_DETAIL_ASSETS.ground, 14),
        rock: createRoleTextures(LUNARA_DETAIL_ASSETS.rock, 10),
        mountain: createRoleTextures(LUNARA_DETAIL_ASSETS.mountain, 8),
        streamBank: createRoleTextures(LUNARA_DETAIL_ASSETS.streamBank, 11),
    };
}

export function disposeLunaraDetailTextureSet(set) {
    if (!set) return;
    Object.values(set).forEach((role) => {
        Object.values(role || {}).forEach((texture) => texture?.dispose?.());
    });
}

export function loadLunaraHdriEnvironment(renderer, scene, onReady = null) {
    if (!renderer || !scene) return null;

    let disposed = false;
    const loader = new HDRLoader();
    loader.load(
        HDRI_URL,
        (texture) => {
            if (disposed) {
                texture.dispose();
                return;
            }
            texture.mapping = THREE.EquirectangularReflectionMapping;
            texture.colorSpace = THREE.LinearSRGBColorSpace;

            let environment = texture;
            let sourceTexture = texture;
            try {
                const PMREMGeneratorClass = renderer.backend?.isWebGPUBackend
                    ? WEBGPU.PMREMGenerator
                    : THREE.PMREMGenerator;
                const pmrem = new PMREMGeneratorClass(renderer);
                const rt = pmrem.fromEquirectangular(texture);
                if (rt?.texture) {
                    environment = rt.texture;
                    sourceTexture = rt.texture;
                    texture.dispose();
                }
                pmrem.dispose();
            } catch (error) {
                // Raw equirectangular HDR is still a valid soft fallback.
                console.warn('[LunaraAssets] HDRI PMREM generation skipped:', error);
            }

            scene.environment = environment;
            onReady?.(sourceTexture);
        },
        undefined,
        (error) => {
            console.warn('[LunaraAssets] HDRI environment failed to load:', error);
        },
    );

    return () => {
        disposed = true;
    };
}
