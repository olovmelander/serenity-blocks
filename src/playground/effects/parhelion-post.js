/**
 * Parhelion post (spec §6).
 *
 * RenderPipeline + ONE HalfFloat scene pass (no setMRT: the manager's bare prewarm
 * compileAsync must have nothing to poison) + bloom with a 0.95 threshold, which sits above
 * the sky cap (0.82) and the snow cap (0.85): only optics, glitter and a flared rim bloom.
 *
 * outputNode is ONE compact Fn (under ADR-0020 the output quad is the one synchronous compile):
 * the calm-rect Loop (≤ 6 uniformArray rects: strength, dimScene, desat, feather) → per-rect
 * dim/desaturate for boards that are not stone-backed → bloom, ×0.3 over calm rects →
 * ph_tone (THE tone map, exactly once) → saturation + split-tone + vignette → manual
 * sRGBTransferOETF → frame-stable grain (uFrame = floor(uTime·24), so ?t= captures are
 * stable) → static ±1 LSB triangular dither.
 *
 * Tone mapping happens exactly once on this path: renderer.toneMapping = NoToneMapping and
 * `outputColorTransform = false` (RenderPipeline.render() forces the working colour space for
 * the quad, so nothing encodes twice).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    dot,
    float,
    floor,
    length,
    max,
    mix,
    pass,
    screenCoordinate,
    screenSize,
    screenUV,
    smoothstep,
    sRGBTransferOETF,
    uniform,
    uniformArray,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { hash21 } from '../../rendering/odyssey/chapter-environments/shared/odyssey-tsl-noise.js';
import { disposeBloomNodeDeep } from '../../themes/shared/bloom-dispose.js';
import {
    linearColor, phCalmBox, phTone, phTriDither,
} from './parhelion-optics.js';
import { resolveParhelionTier } from './parhelion-materials.js';

const BLOOM_RADIUS = 0.42;
const BLOOM_THRESHOLD = 0.95;
const WRITE_EPS = 1e-4;

/** Calm rects the output node evaluates (§6: solo card, MP boards, queue, HUD, fallback). */
export const CALM_RECTS_MAX = 6;

/**
 * Bloom multiplier over a calm rect: glow never spills onto a playfield. The spec's 0.3 let a
 * Clear Sky reveal lift the card mean to 0.019 (gate: ≤ 0.016 during any beat); 0.12 holds it.
 */
const BLOOM_ATTEN = 0.12;

export class ParhelionPost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} [options]
     * @param {object|string} [options.tier]
     * @param {number} [options.exposure]
     * @param {number} [options.bloomStrength] overrides the tier's strength (debug / A-B only)
     * @param {object} [options.aspect] shared uAspect uniform
     * @param {object} [options.time] shared uTime uniform (grain frame counter)
     */
    constructor(renderer, scene, camera, {
        tier: tierIn = 'High', exposure = 1, bloomStrength, aspect = null, time = null,
    } = {}) {
        const tier = resolveParhelionTier(tierIn);
        this.tier = tier;
        this.baseBloomStrength = Number.isFinite(bloomStrength) ? bloomStrength : (tier.bloomStrength || 0.34);

        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera);
        this.pipeline.scenePass = this.scenePass;
        const sceneColor = this.scenePass.getTextureNode('output');

        this.bloomNode = bloom(sceneColor, this.baseBloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD);
        // Reduced-res bloom targets through the r185 public API (r185's setSize multiplies by
        // _resolutionScale itself, so no setSize monkey-patch).
        this.bloomNode.setResolutionScale(0.5 * (tier.bloomD || 0.7));
        // Version-pinned lever: BloomNode keeps its mip count in a private field (_nMips, checked
        // against the pinned three; re-check on every upgrade). 3 mips at Low.
        if (tier.bloomMips && tier.bloomMips < 5) this.bloomNode._nMips = tier.bloomMips;

        // Calm rects: (x0, y0, x1, y1) and (strength, dimScene, desat, feather); count ≤ 6.
        this.calmRects = Array.from({ length: CALM_RECTS_MAX }, () => new THREE.Vector4());
        this.calmParams = Array.from({ length: CALM_RECTS_MAX }, () => new THREE.Vector4(0, 0, 0, 0.015));
        this.uCalmRects = uniformArray(this.calmRects, 'vec4');
        this.uCalmParams = uniformArray(this.calmParams, 'vec4');
        this.uCalmCount = uniform(0, 'int');
        this.uExposure = uniform(exposure);
        this.uBloomKick = 0;
        const uAspect = aspect || uniform(16 / 9);
        const uTime = time || uniform(0);

        const {
            bloomNode, uCalmRects, uCalmParams, uCalmCount, uExposure,
        } = this;
        this.pipeline.outputColorTransform = false;
        this.pipeline.outputNode = Fn(() => {
            const uv = screenUV;
            const calm = float(0.0).toVar();
            const dim = float(0.0).toVar();
            const desat = float(0.0).toVar();
            Loop(uCalmCount, ({ i }) => {
                const p = uCalmParams.element(i);
                const m = phCalmBox(uv, uCalmRects.element(i), p.w, uAspect);
                calm.assign(max(calm, m.mul(p.x)));
                dim.assign(max(dim, m.mul(p.y)));
                desat.assign(max(desat, m.mul(p.z)));
            });
            const luma = vec3(0.2126, 0.7152, 0.0722);
            // Only non-stone-backed boards get dim/desaturate (their params are 0 otherwise).
            const base = sceneColor.rgb.mul(float(1.0).sub(dim));
            const flat = mix(base, vec3(dot(base, luma)), desat);
            const hdr = flat.add(bloomNode.rgb.mul(mix(1.0, BLOOM_ATTEN, calm)));
            const toned = phTone(hdr.mul(uExposure)).toVar();
            // Grade: a touch of saturation, split-tone (cobalt shadows / warm highlights), vignette.
            const sat = mix(vec3(dot(toned, luma)), toned, 1.05);
            const l = dot(sat, luma);
            const lo = float(1.0).sub(l);
            const cool = mix(sat, linearColor(0x1B2A55), lo.mul(lo).mul(0.06));
            const split = mix(cool, linearColor(0xFFF0D2), l.mul(l).mul(0.05));
            const vig = length(uv.sub(0.5).mul(vec2(uAspect, 1.0)).mul(0.9));
            const graded = split.mul(float(1.0).sub(smoothstep(0.45, 1.05, vig).mul(0.2)));
            const encoded = sRGBTransferOETF(max(graded, vec3(0.0)));
            // Grain on a 24 fps frame counter (stable under ?t=), halved over calm rects.
            const frame = floor(uTime.mul(24.0));
            const grain = hash21(uv.mul(screenSize).add(frame.mul(7.13))).sub(0.5).mul(0.008);
            const dither = phTriDither(screenCoordinate.xy).div(255.0);
            return vec4(encoded.add(grain.mul(float(1.0).sub(calm.mul(0.5)))).add(dither), 1.0);
        })();
        this.pipeline.needsUpdate = true;
    }

    /**
     * Calm rects from setLayout (never per frame). `rects` entries: `{ rect: {x0,y0,x1,y1},
     * strength, dimScene, desat, feather }`; at most CALM_RECTS_MAX are used.
     */
    setCalmRects(rects, count) {
        const n = Math.min(CALM_RECTS_MAX, count);
        for (let i = 0; i < CALM_RECTS_MAX; i++) {
            const e = i < n ? rects[i] : null;
            if (e) {
                this.calmRects[i].set(e.rect.x0, e.rect.y0, e.rect.x1, e.rect.y1);
                this.calmParams[i].set(e.strength, e.dimScene, e.desat, e.feather);
            } else {
                this.calmRects[i].set(0, 0, 0, 0);
                this.calmParams[i].set(0, 0, 0, 0.015);
            }
        }
        this.uCalmCount.value = n;
    }

    /** Bloom kick from reactions (0 at rest); writes only when the strength actually moves. */
    setBloomKick(kick) {
        const strength = this.baseBloomStrength * (1 + kick);
        if (Math.abs(this.bloomNode.strength.value - strength) > WRITE_EPS) {
            this.bloomNode.strength.value = strength;
        }
        this.uBloomKick = kick;
    }

    render() {
        this.pipeline.render();
    }

    dispose() {
        this.scenePass?.dispose?.();
        disposeBloomNodeDeep(this.bloomNode);
        this.pipeline?.dispose?.();
        this.scenePass = null;
        this.bloomNode = null;
        this.pipeline = null;
    }
}
