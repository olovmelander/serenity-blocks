/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Winter — Poly Haven CC0 snow detail textures (kills the "built from squares" ground).
 *
 * The foreground snow GROUND (buildFacetedSnowDrifts) reads as flat low-poly facets: a
 * displaced plane `toNonIndexed()` + `computeVertexNormals()` gives per-FACE normals, and
 * the unlit moon-lambert shading then paints each triangle one flat tone — so the surface
 * looks built from squares.
 *
 * Unlike the pure-painterly Sky-Children surfaces (which are luminance-ONLY because they
 * have no lighting to perturb), this ground material DOES compute lighting from the surface
 * normal, so a real snow NORMAL map is consumable: it perturbs the lighting normal per-texel
 * → the flat facets gain believable micro-relief and stop reading as triangles. The DIFFUSE
 * is used as a tight greyscale LUMINANCE tooth (not photoreal albedo) multiplied into the
 * hand-authored snow palette, so it survives the WinterPipeline grade and stays painterly.
 *
 * Zero first-paint cost: each Texture starts as a 2×2 placeholder (grey for diffuse → neutral
 * 0.5 multiplier; #8080ff for normal → flat tangent normal) and swaps to the real image when
 * it arrives, so materials build synchronously with the nodes wired in.
 *
 * Textures are CC0; see ../../../../public/textures/winter/ATTRIBUTION.md
 */
import * as THREE from 'three';
import {
    dot, float, mix, vec3, normalize, texture as textureNode,
} from 'three/tsl';

const BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
const ASSET_BASE = `${BASE_URL}textures/winter/`;

function placeholder(hex) {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    const ctx = c.getContext('2d');
    if (ctx) {
        ctx.fillStyle = hex;
        ctx.fillRect(0, 0, 2, 2);
    }
    return c;
}

function loadTex(fileName, placeholderHex) {
    const tex = new THREE.Texture(placeholder(placeholderHex) || undefined);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.NoColorSpace; // we read luminance / raw normal, not graded colour
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
            // On load failure leave the neutral placeholder → detail is a no-op.
        },
    );
    return tex;
}

/** Build the {diff, nor} detail set for a snow variant ('snow_01' | 'snow_02'). */
export function createWinterSnowDetail(variant = 'snow_01') {
    return {
        diff: loadTex(`${variant}_diff_1k.jpg`, '#808080'),
        nor: loadTex(`${variant}_nor_gl_1k.jpg`, '#8080ff'),
    };
}

export function disposeWinterSnowDetail(set) {
    if (!set) return;
    set.diff?.dispose?.();
    set.nor?.dispose?.();
}

const luma = (s) => dot(s.rgb, vec3(0.299, 0.587, 0.114));

/**
 * Planar luminance tooth sampled on world XZ (for ~horizontal ground).
 * @returns scalar node in [lo, hi] (both kept near 1.0 so it reads as grain, not albedo).
 */
export function snowLumaPlanar(tex, worldXZ, scale, lo, hi) {
    const s = textureNode(tex, worldXZ.mul(scale));
    return mix(float(lo), float(hi), luma(s));
}

/**
 * Perturb a base world normal with a tangent-space (nor_gl) snow normal map sampled planar
 * on world XZ. Adds only the horizontal tilt (keeps the geometry's slope), so flat facets
 * gain micro-relief in the lighting without flattening real slopes.
 * @returns normalized world normal node.
 */
export function snowPerturbNormal(tex, worldXZ, scale, baseN, strength) {
    const n = textureNode(tex, worldXZ.mul(scale)).xyz.mul(2.0).sub(1.0); // [-1,1] tangent normal
    // tangent x → world x, tangent y(green) → world z; keep baseN's up component.
    return normalize(baseN.add(vec3(n.x, float(0.0), n.y).mul(strength)));
}
