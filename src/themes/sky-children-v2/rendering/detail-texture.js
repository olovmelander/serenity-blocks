/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sky Children V2 — Poly Haven CC0 greyscale detail textures (painterly "tooth").
 *
 * This theme is 100% procedural and fully UNLIT: every surface is a
 * MeshBasicNodeMaterial shaded by the hand-rolled painterly TSL lib
 * (wrappedDiffuse + coloredShadowBlend + fresnelRim + glitter). A photoreal PBR
 * texture therefore CANNOT be dropped in as a material — its albedo / normal /
 * roughness would clash with the flat painterly look, and the unlit pipeline would
 * not even consume the PBR maps.
 *
 * So we use Poly Haven textures in the ONE mode that fits (per the Polyhaven audit):
 * sample LUMINANCE ONLY, remap to a tight low-contrast band, and MULTIPLY it into
 * the hand-authored palette colours. The asset's real colour + detail-frequency are
 * discarded; coloredShadowBlend and the aerial-perspective fog then recolour /
 * dissolve the result, so it reads as a faint hand-painted grain, never a photo.
 *
 * Zero first-paint cost: the Texture starts as a mid-grey 2×2 placeholder
 * (luma ≈ 0.5 → a near-neutral multiplier) and swaps to the real image when it
 * arrives, so materials can be built synchronously with the texture node wired in.
 *
 * Textures are CC0; see ../../../../public/textures/sky-children-v2/ATTRIBUTION.md
 */
import * as THREE from 'three';
import {
    abs, dot, float, mix, vec3, texture as textureNode,
} from 'three/tsl';

const BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
const ASSET_BASE = `${BASE_URL}textures/sky-children-v2/`;

// Logical role → downloaded Poly Haven CC0 file (1k JPG diffuse).
export const SKY_DETAIL_ASSETS = Object.freeze({
    grass: 'leafy_grass_diff_1k.jpg', // meadow ground grain
    dirt: 'dirt_diff_1k.jpg', // low-frequency soil variation
    mountain: 'gray_rocks_diff_1k.jpg', // far-range massif tooth
    skirt: 'rock_05_diff_1k.jpg', // cliff-skirt tooth
});

function greyPlaceholder() {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    const ctx = c.getContext('2d');
    if (ctx) {
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, 2, 2);
    }
    return c;
}

/**
 * Build a repeat-wrapped detail Texture that loads asynchronously behind a neutral
 * grey placeholder. Safe to wire into a material node immediately.
 */
export function createSkyDetailTexture(fileName) {
    const tex = new THREE.Texture(greyPlaceholder() || undefined);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.NoColorSpace; // we read luminance, not graded colour
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    tex.userData.lifecycleDisposed = false;
    tex.addEventListener('dispose', () => {
        tex.userData.lifecycleDisposed = true;
    });

    new THREE.TextureLoader().load(
        `${ASSET_BASE}${fileName}`,
        (loaded) => {
            if (tex.userData.lifecycleDisposed) {
                loaded.dispose?.();
                return;
            }
            tex.image = loaded.image;
            tex.needsUpdate = true;
            loaded.dispose?.();
        },
        undefined,
        () => {
            // On load failure leave the neutral placeholder → detail is just a no-op.
        },
    );
    return tex;
}

/** Convenience: build the full {grass, dirt, mountain, skirt} texture set. */
export function createSkyDetailTextureSet() {
    return {
        grass: createSkyDetailTexture(SKY_DETAIL_ASSETS.grass),
        dirt: createSkyDetailTexture(SKY_DETAIL_ASSETS.dirt),
        mountain: createSkyDetailTexture(SKY_DETAIL_ASSETS.mountain),
        skirt: createSkyDetailTexture(SKY_DETAIL_ASSETS.skirt),
    };
}

export function disposeSkyDetailTextureSet(set) {
    if (!set) return;
    Object.values(set).forEach((t) => t?.dispose?.());
}

const luma = (s) => dot(s.rgb, vec3(0.299, 0.587, 0.114));

/**
 * Planar (world XZ) luminance multiplier — for ~horizontal ground (terrain meadow).
 * These are PLAIN-JS node builders (not Fn-wrapped) so the Texture binds directly,
 * exactly like shadeGround() in valley-terrain.js.
 * @returns scalar node in [lo, hi] (both kept near 1.0)
 */
export function detailLumaPlanar(tex, worldXZ, scale, lo, hi) {
    const s = textureNode(tex, worldXZ.mul(scale));
    return mix(float(lo), float(hi), luma(s));
}

/**
 * Triplanar luminance multiplier — for steep / arbitrary surfaces (mountains,
 * cliff skirt). Three fetches blended by |normal| so vertical faces don't smear.
 * @returns scalar node in [lo, hi]
 */
export function detailLumaTriplanar(tex, worldP, N, scale, lo, hi) {
    const an = abs(N).toVar();
    const w = an.div(an.x.add(an.y).add(an.z).add(float(0.0001))).toVar();
    const sx = textureNode(tex, worldP.yz.mul(scale));
    const sy = textureNode(tex, worldP.xz.mul(scale));
    const sz = textureNode(tex, worldP.xy.mul(scale));
    const l = luma(sx).mul(w.x).add(luma(sy).mul(w.y)).add(luma(sz).mul(w.z));
    return mix(float(lo), float(hi), l);
}
