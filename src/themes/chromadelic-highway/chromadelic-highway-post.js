/**
 * Chromadelic Highway — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT, no compute; MSAA only on High and up), one bloom chain (Medium and
 * up) and ONE full-screen output pass:
 *   scene tap → board veil (the board card and HUD are translucent, so what shows through them is
 *   soft-clipped, hue-preserving) → bloom (max-channel soft-knee prefilter over 4 taps, so every
 *   hue blooms alike and thin lines do not flicker) → luminance contrast (the tone curve below is
 *   linear under 0.72, so mid-tone contrast is added first; the floor is left alone) →
 *   "neon-neutral" tone map (hue-faithful: emitter cores roll to white while their halos stay
 *   saturated) → vibrance, violet floor, event contrast dip → value-aware top/bottom vignette →
 *   sRGB encode → grain on the dark floor (High and up) → triangular dither.
 *
 * Values are authored scene-linear, so the authored value ladder is what reaches the screen.
 * Only thin emitters exceed the 1.0 bloom threshold.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    clamp,
    dot,
    float,
    floor,
    length,
    max,
    min,
    mix,
    pass,
    pow,
    renderOutput,
    screenCoordinate,
    screenSize,
    screenUV,
    select,
    smoothstep,
    step,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import {
    chdHash21, chdMax3, chdRoundBoxSdf, chdSoftClip,
} from './chromadelic-highway-tsl.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode (Low/Minimal, as the old theme did); the
 * emitters carry their own authored halos. `msaa` is the scene pass sample count.
 */
export const POST_LOOK = {
    Extreme: {
        bloom: true, bloomStrength: 0.8, bloomResolution: 0.4, grain: true, msaa: 4,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.75, bloomResolution: 0.375, grain: true, msaa: 4,
    },
    // Every thin element is anti-aliased analytically (lines, ring strips, discs, stars), so
    // scene MSAA is indistinguishable at High (measured) and kept only on the showcase tiers.
    High: {
        bloom: true, bloomStrength: 0.7, bloomResolution: 0.325, grain: true, msaa: 0,
    },
    Medium: {
        bloom: true, bloomStrength: 0.62, bloomResolution: 0.25, grain: false, msaa: 0,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, grain: false, msaa: 0,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, grain: false, msaa: 0,
    },
};

export const BLOOM_THRESHOLD = 1.0;
export const BLOOM_KNEE = 0.4;
export const BLOOM_RADIUS = 0.3;

const LUMA = vec3(0.2126, 0.7152, 0.0722);
const min3 = (c) => min(c.x, min(c.y, c.z));

/**
 * "Neon-neutral": the Khronos PBR Neutral curve with a later shoulder (startComp 0.72), a
 * stronger path to white for saturated emitters (desat 0.32) and a quarter-strength toe (the
 * full toe squares neutral darks below 0.08, which crushes the violet floor). Branchless.
 */
export const chdNeonNeutral = /* @__PURE__ */ Fn(([cIn, startComp, desat, toe]) => {
    const c = vec3(cIn);
    const x = min3(c);
    const off = toe.mul(mix(float(0.04), x.sub(x.mul(x).mul(6.25)), float(1.0).sub(step(0.08, x))));
    const col = c.sub(off).toVar();
    const peak = chdMax3(col);
    const d = float(1.0).sub(startComp);
    const np = float(1.0).sub(d.mul(d).div(max(peak.add(d).sub(startComp), 1e-4)));
    const g = float(1.0).sub(float(1.0).div(desat.mul(peak.sub(np)).add(1.0)));
    const compressed = mix(col.mul(np.div(max(peak, 1e-4))), vec3(np), g);
    return mix(compressed, col, float(1.0).sub(step(startComp, peak)));
}).setLayout({
    name: 'chd_neonNeutral',
    type: 'vec3',
    inputs: [
        { name: 'cIn', type: 'vec3' },
        { name: 'startComp', type: 'float' },
        { name: 'desat', type: 'float' },
        { name: 'toe', type: 'float' },
    ],
});

/** A render pipeline that only encodes the scene (the no-post / fallback path). */
export function createPassThroughPipeline(renderer, scene, camera) {
    const pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera, { samples: 0 });
    pipeline.outputNode = scenePass; // outputColorTransform: renderer tone mapping + sRGB
    return {
        render: () => pipeline.render(),
        update() {},
        setLayout() {},
        setSize() {},
        setGrainEnabled() {},
        dispose() {
            scenePass.dispose();
            pipeline.dispose();
        },
    };
}

export class ChromadelicHighwayPost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} [params]
     * @param {object} [params.look]          POST_LOOK entry
     * @param {number} [params.samples]       scene-pass MSAA samples (default look.msaa)
     * @param {number} [params.aspect]
     * @param {boolean} [params.grain=true]   false in deterministic capture modes
     * @param {boolean} [params.falseColor]   debug: band the pre-tone-map max channel
     */
    constructor(renderer, scene, camera, params = {}) {
        const look = params.look || POST_LOOK.High;
        this.look = look;
        this.renderer = renderer;
        this.postProcessing = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: params.samples ?? look.msaa ?? 0 });
        const sceneColor = this.scenePass.getTextureNode('output');

        this.uAspect = uniform(params.aspect ?? 1.78);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uDip = uniform(0); // event contrast dip of everything that is not blooming
        this.uBloomBoost = uniform(0); // 0..1 → ≤ +10 % bloom
        this.uContrast = uniform(1.12);
        this.uBoardRect = uniform(new THREE.Vector4(0.4, 0.067, 0.6, 0.951)); // screen fractions
        this.uHudRect = uniform(new THREE.Vector4(0.626, 0.25, 0.714, 0.75));
        this.uVeil = uniform(0); // eased 0 → 1 once the DOM rects are known and stable
        this.uHudVeil = uniform(0);
        this.boardSeen = false; // a board rect has been set (the veil may fade over it)
        this.hudLive = false; // the HUD was on screen with the last board
        this.grainEnabled = params.grain !== false && look.grain === true;
        this.uGrain = uniform(this.grainEnabled ? 3 / 255 : 0);
        this.uGrainPhase = uniform(0);

        // ── Bloom: max-channel soft knee over a 4-tap box (Medium and up) ──
        this.bloomNode = null;
        if (look.bloom) {
            this.bloomNode = bloom(sceneColor, look.bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD);
            this.bloomNode.threshold.value = BLOOM_THRESHOLD;
            this.bloomNode.smoothWidth.value = BLOOM_KNEE;
            this.bloomNode.setResolutionScale(look.bloomResolution);
            const { uSrcTexel } = this;
            // BloomNode's documented hook, read once at setup: set before anything compiles.
            // Inline (no setLayout): `input` must stay the raw scene TextureNode for .sample().
            this.bloomNode.highPassFn = Fn(({ input, threshold, smoothWidth }) => {
                const st = uv();
                const o = uSrcTexel.mul(1.25);
                const tap = (dx, dy) => clamp(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb, 0.0, 6.0);
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = chdMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;
        const outputFn = Fn(() => {
            const centered = screenUV.sub(0.5).toVar();
            const p = screenUV.mul(screenSize).toVar();
            const S = vec3(sceneColor.sample(screenUV).rgb).toVar();

            // ── Board veil: what shows through the card / HUD is soft-clipped ──
            const hScale = screenSize.y.div(1080.0);
            const sdfC = chdRoundBoxSdf(p, this.uBoardRect.mul(vec4(screenSize, screenSize)), hScale.mul(20.0));
            const sdfH = chdRoundBoxSdf(p, this.uHudRect.mul(vec4(screenSize, screenSize)), hScale.mul(12.0));
            const inC = float(1.0).sub(smoothstep(-24.0, 0.0, sdfC)).mul(this.uVeil);
            const bandC = smoothstep(hScale.mul(110.0), 0.0, sdfC).mul(step(0.0, sdfC)).mul(this.uVeil);
            const inH = float(1.0).sub(smoothstep(-8.0, 0.0, sdfH)).mul(this.uHudVeil);
            S.assign(mix(S, chdSoftClip(S, float(0.1)).mul(0.85), inC));
            S.assign(mix(S, chdSoftClip(S, float(0.12)), inH));
            S.mulAssign(float(1.0).sub(bandC.mul(0.12)));

            // ── Bloom composite ──
            let B = vec3(0.0);
            if (this.bloomNode) {
                let bl = vec3(this.bloomNode.getTextureNode().sample(screenUV).rgb);
                // Faint-halo unifier: dim halos lean violet so seven hues read as one light.
                const faint = float(1.0).sub(smoothstep(0.02, 0.35, chdMax3(bl))).mul(0.35);
                bl = mix(bl, bl.mul(vec3(0.86, 0.74, 1.22)), faint);
                bl = bl.mul(float(1.0).add(this.uBloomBoost.mul(0.1)));
                bl = bl.mul(max(float(1.0).sub(inC.mul(0.8)).sub(inH.mul(0.6)).sub(bandC.mul(0.3)), 0.0));
                B = bl;
            }
            const H = S.add(B).toVar();

            // ── Luminance contrast before the tone map (the floor is left alone) ──
            const Lh = max(dot(H, LUMA), 1e-4);
            H.mulAssign(pow(Lh.div(0.18), this.uContrast.sub(1.0).mul(smoothstep(0.012, 0.06, Lh))));

            // ── Tone map + grade (scene-linear) ──
            const T = chdNeonNeutral(H, float(0.72), float(0.32), float(0.25)).toVar();
            const tl = dot(T, LUMA);
            const tMax = chdMax3(T);
            const sat = tMax.sub(min3(T)).div(max(tMax, 1e-4));
            T.assign(mix(vec3(tl), T, float(1.0).add(float(0.12).mul(float(1.0).sub(sat)).mul(smoothstep(0.02, 0.2, tl)))));
            // Violet floor: pure black never reaches the screen.
            T.addAssign(vec3(0.001, 0.0004, 0.0036).mul(float(1.0).sub(smoothstep(0.0, 0.05, tl))));
            // Event contrast dip: everything that is not blooming steps back.
            T.mulAssign(float(1.0).sub(this.uDip.mul(float(1.0).sub(smoothstep(0.03, 0.25, chdMax3(B))))));
            // Value-aware top/bottom bands (the bottom corners hold the road wedges) + weak radial.
            const edge = max(
                float(1.0).sub(smoothstep(0.0, 0.13, screenUV.y)),
                float(1.0).sub(smoothstep(0.0, 0.1, float(1.0).sub(screenUV.y))),
            );
            T.mulAssign(float(1.0).sub(edge.mul(float(0.22).add(tl.mul(0.187)))));
            const rad = length(centered.mul(vec2(this.uAspect.div(1.778), 1.0)).mul(2.0));
            T.mulAssign(float(1.0).sub(smoothstep(0.6, 1.2, rad).mul(0.1)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const px = floor(screenCoordinate);
            // Grain on the dark floor only (±1.5/255, 24 Hz phase from the sim clock).
            const gp = this.uGrainPhase;
            const gn = chdHash21(px.add(vec2(gp.mul(113.1), gp.mul(71.7)))).sub(0.5);
            D.addAssign(gn.mul(this.uGrain).mul(float(1.0).sub(smoothstep(0.02, 0.06, chdMax3(D)))));
            // Triangular ±1/255 dither (static: captures stay deterministic).
            const dth = chdHash21(px).add(chdHash21(px.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let output = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                // Debug: band the pre-tone-map max channel after the veil (blue < .1 < green <
                // .6 < yellow < 1 < orange < 2.5 < red). Only thin emitters should show orange/red.
                const m = chdMax3(S.add(B));
                const fc = select(
                    m.lessThan(0.1),
                    vec3(0.05, 0.1, 0.6),
                    select(
                        m.lessThan(0.6),
                        vec3(0.1, 0.55, 0.15),
                        select(
                            m.lessThan(1.0),
                            vec3(0.85, 0.8, 0.1),
                            select(m.lessThan(2.5), vec3(1.0, 0.45, 0.05), vec3(0.95, 0.05, 0.05)),
                        ),
                    ),
                );
                output = vec4(fc, 1.0);
            }
            return output;
        });

        this.postProcessing.outputColorTransform = false;
        this.postProcessing.outputNode = outputFn();
        this.postProcessing.needsUpdate = true;
        this.size = { width: 0, height: 0 };
    }

    /**
     * Per-frame uniforms. All optional.
     * @param {{time?: number, dip?: number, bloomBoost?: number}} params
     */
    update(params) {
        if (params.time !== undefined) {
            // Deterministic under seek, and small enough to keep the hash precise.
            this.uGrainPhase.value = Math.floor(params.time * 24) % 256;
        }
        if (params.dip !== undefined) this.uDip.value = params.dip;
        if (params.bloomBoost !== undefined) this.uBloomBoost.value = params.bloomBoost;
    }

    /**
     * Board/HUD rects in screen fractions (x0, y0, x1, y1; y down), or null to fade that veil
     * out. `strength` 0..1 is applied as-is (the caller eases it): once the board is gone the
     * last rects stay, so the eased strength fades the veil where the board was.
     */
    setLayout(board, hud, strength = 1) {
        if (board) {
            this.uBoardRect.value.set(board.x0, board.y0, board.x1, board.y1);
            this.boardSeen = true;
            this.hudLive = Boolean(hud);
        }
        if (hud) this.uHudRect.value.set(hud.x0, hud.y0, hud.x1, hud.y1);
        this.uVeil.value = this.boardSeen ? strength : 0;
        this.uHudVeil.value = this.hudLive ? strength : 0;
    }

    setGrainEnabled(enabled) {
        this.uGrain.value = enabled && this.look.grain === true ? 3 / 255 : 0;
    }

    render() {
        this.postProcessing.render();
    }

    /**
     * The scene pass and bloom chain size themselves from the drawing buffer every frame
     * (PassNode/BloomNode.updateBefore); only the aspect and the prefilter texel need this.
     */
    setSize(width, height, bufferWidth = width, bufferHeight = height) {
        this.size.width = width;
        this.size.height = height;
        if (width > 0 && height > 0) this.uAspect.value = width / height;
        if (bufferWidth > 0 && bufferHeight > 0) this.uSrcTexel.value.set(1 / bufferWidth, 1 / bufferHeight);
    }

    dispose() {
        this.scenePass.dispose();
        if (this.bloomNode) disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing.dispose();
    }
}
