/**
 * Chromadelic Highway — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (4× MSAA from High up via shared sceneSamples so our Blender-sculpted 3D
 * pylons, beveled edges, rings and lanes stay razor-sharp), one bloom chain (Medium and up
 * with a max-channel soft-knee prefilter so every hue blooms alike), and ONE output pass:
 *   scene tap (+ subtle radial warp-focus during Quad / Fever / Level-Up / Perfect Clear,
 *   strictly outside the board calm zone and disabled under reduced motion) ->
 *   value-aware board & HUD veil -> bloom composite with violet faint-halo unifier ->
 *   luminance contrast (deep velvet floor untouched) -> neon-neutral tone map -> vibrance,
 *   deep velvet floor, event contrast dip -> gentle top/bottom vignette -> sRGB encode ->
 *   dark-floor grain (High+) -> triangular dither.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
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
import { sceneSamples } from '../shared/scene-antialias.js';
import {
    chdHash21, chdMax3, chdRoundBoxSdf, chdSoftClip,
} from './chromadelic-highway-tsl.js';

/**
 * Per-tier look. High+ now uses 4× MSAA (matching sceneSamples) so the sculpted 3D highway
 * cantilever pylons and speed chevrons show crisp anti-aliased bevels on every frame.
 */
export const POST_LOOK = {
    Extreme: {
        bloom: true, bloomStrength: 0.82, bloomResolution: 0.4, grain: true, msaa: 4, warpBlur: true,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.78, bloomResolution: 0.375, grain: true, msaa: 4, warpBlur: true,
    },
    High: {
        bloom: true, bloomStrength: 0.74, bloomResolution: 0.325, grain: true, msaa: sceneSamples('High', true), warpBlur: true,
    },
    Medium: {
        bloom: true, bloomStrength: 0.64, bloomResolution: 0.25, grain: false, msaa: 0, warpBlur: false,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, grain: false, msaa: 0, warpBlur: false,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, grain: false, msaa: 0, warpBlur: false,
    },
};

export const BLOOM_THRESHOLD = 1.0;
export const BLOOM_KNEE = 0.42;
export const BLOOM_RADIUS = 0.32;

const LUMA = vec3(0.2126, 0.7152, 0.0722);
const min3 = (c) => min(c.x, min(c.y, c.z));

/**
 * "Neon-neutral": Khronos PBR Neutral curve with later shoulder (0.72), rich path to white
 * for saturated emitters (desat 0.32), and quarter toe so deep violet obsidian never crushes.
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
    pipeline.outputNode = scenePass;
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
    constructor(renderer, scene, camera, params = {}) {
        const look = params.look || POST_LOOK.High;
        this.look = look;
        this.renderer = renderer;
        this.postProcessing = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: params.samples ?? look.msaa ?? 0 });
        const sceneColor = this.scenePass.getTextureNode('output');

        this.uAspect = uniform(params.aspect ?? 1.78);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uDip = uniform(0);
        this.uBloomBoost = uniform(0);
        this.uWarpRush = uniform(0); // 0..1 subtle outer radial velocity focus during Quad / Fever / LevelUp
        this.uContrast = uniform(1.15);
        this.uBoardRect = uniform(new THREE.Vector4(0.4, 0.067, 0.6, 0.951));
        this.uHudRect = uniform(new THREE.Vector4(0.626, 0.25, 0.714, 0.75));
        this.uVeil = uniform(0);
        this.uHudVeil = uniform(0);
        this.boardSeen = false;
        this.hudLive = false;
        this.grainEnabled = params.grain !== false && look.grain === true;
        this.uGrain = uniform(this.grainEnabled ? 3 / 255 : 0);
        this.uGrainPhase = uniform(0);

        this.bloomNode = null;
        if (look.bloom) {
            this.bloomNode = bloom(sceneColor, look.bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD);
            this.bloomNode.threshold.value = BLOOM_THRESHOLD;
            this.bloomNode.smoothWidth.value = BLOOM_KNEE;
            this.bloomNode.setResolutionScale(look.bloomResolution);
            const { uSrcTexel } = this;
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
        const useWarpBlur = look.warpBlur === true;
        const outputFn = Fn(() => {
            const centered = screenUV.sub(0.5).toVar();
            const p = screenUV.mul(screenSize).toVar();
            const S = vec3(sceneColor.sample(screenUV).rgb).toVar();

            // ── Board & HUD veil (soft-clips anything showing through the translucent UI) ──
            const hScale = screenSize.y.div(1080.0);
            const sdfC = chdRoundBoxSdf(p, this.uBoardRect.mul(vec4(screenSize, screenSize)), hScale.mul(20.0)).toVar();
            const sdfH = chdRoundBoxSdf(p, this.uHudRect.mul(vec4(screenSize, screenSize)), hScale.mul(12.0));
            const inC = float(1.0).sub(smoothstep(-24.0, 0.0, sdfC)).mul(this.uVeil).toVar();
            const bandC = smoothstep(hScale.mul(110.0), 0.0, sdfC).mul(step(0.0, sdfC)).mul(this.uVeil);
            const inH = float(1.0).sub(smoothstep(-8.0, 0.0, sdfH)).mul(this.uHudVeil).toVar();

            // ── Peripheral hyper-warp velocity focus (Quad / Level-Up / Perfect / Fever, High+) ──
            // Strictly outside the board card and capped per-tap (gotcha #904) so highlights never ring.
            if (useWarpBlur) {
                If(this.uWarpRush.greaterThan(0.0001), () => {
                    const vpDelta = screenUV.sub(vec2(0.5, 0.458)).toVar();
                    const rushMask = smoothstep(0.24, 0.65, length(vpDelta))
                        .mul(float(1.0).sub(inC)).mul(float(1.0).sub(inH)).mul(this.uWarpRush)
                        .toVar();
                    If(rushMask.greaterThan(0), () => {
                        const stepUV = vpDelta.mul(rushMask.mul(0.018));
                        const tap = (offset) => {
                            // The scene pass has one resolved mip. Explicit LOD also permits
                            // sampling inside the per-pixel board and periphery mask on WebGPU.
                            const st = clamp(screenUV.sub(stepUV.mul(offset)), 0.001, 0.999);
                            const c = sceneColor.sample(st).level(0).rgb.toVar();
                            return c.mul(min(float(1.0), float(3.2).div(max(chdMax3(c), 0.001))));
                        };
                        const blurred = S.mul(0.55).add(tap(1).mul(0.3)).add(tap(2).mul(0.15));
                        S.assign(mix(S, blurred, clamp(rushMask.mul(0.85), 0.0, 0.85)));
                    });
                });
            }

            S.assign(mix(S, chdSoftClip(S, float(0.1)).mul(0.85), inC));
            S.assign(mix(S, chdSoftClip(S, float(0.12)), inH));
            S.mulAssign(float(1.0).sub(bandC.mul(0.12)));

            // ── Bloom composite ──
            let B = vec3(0.0);
            if (this.bloomNode) {
                let bl = vec3(this.bloomNode.getTextureNode().sample(screenUV).rgb);
                const faint = float(1.0).sub(smoothstep(0.02, 0.35, chdMax3(bl))).mul(0.32);
                bl = mix(bl, bl.mul(vec3(0.86, 0.74, 1.24)), faint);
                bl = bl.mul(float(1.0).add(this.uBloomBoost.mul(0.14)));
                bl = bl.mul(max(float(1.0).sub(inC.mul(0.82)).sub(inH.mul(0.62)).sub(bandC.mul(0.3)), 0.0));
                B = bl;
            }
            const H = S.add(B).toVar();

            // ── Luminance contrast before tone map (deep velvet floor stays untouched) ──
            const Lh = max(dot(H, LUMA), 1e-4);
            H.mulAssign(pow(Lh.div(0.18), this.uContrast.sub(1.0).mul(smoothstep(0.015, 0.065, Lh))));

            // ── Tone map + grade (scene-linear) ──
            const T = chdNeonNeutral(H, float(0.72), float(0.32), float(0.25)).toVar();
            const tl = dot(T, LUMA);
            const tMax = chdMax3(T);
            const sat = tMax.sub(min3(T)).div(max(tMax, 1e-4));
            T.assign(mix(vec3(tl), T, float(1.0).add(float(0.15).mul(float(1.0).sub(sat)).mul(smoothstep(0.02, 0.2, tl)))));
            // Subtle velvet indigo floor (gotcha #227: keep near-zero so space stays rich OLED obsidian).
            T.addAssign(vec3(0.0006, 0.00025, 0.0022).mul(float(1.0).sub(smoothstep(0.0, 0.04, tl))));
            // Event contrast dip: non-blooming darks step back slightly so neon emitters blaze.
            T.mulAssign(float(1.0).sub(this.uDip.mul(float(1.0).sub(smoothstep(0.03, 0.25, chdMax3(B))))));
            // Value-aware top/bottom bands + subtle radial vignette.
            const edge = max(
                float(1.0).sub(smoothstep(0.0, 0.12, screenUV.y)),
                float(1.0).sub(smoothstep(0.0, 0.09, float(1.0).sub(screenUV.y))),
            );
            T.mulAssign(float(1.0).sub(edge.mul(float(0.2).add(tl.mul(0.16)))));
            const rad = length(centered.mul(vec2(this.uAspect.div(1.778), 1.0)).mul(2.0));
            T.mulAssign(float(1.0).sub(smoothstep(0.62, 1.24, rad).mul(0.12)));

            // ── Encode + finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const px = floor(screenCoordinate);
            const gp = this.uGrainPhase;
            const gn = chdHash21(px.add(vec2(gp.mul(113.1), gp.mul(71.7)))).sub(0.5);
            D.addAssign(gn.mul(this.uGrain).mul(float(1.0).sub(smoothstep(0.02, 0.06, chdMax3(D)))));
            const dth = chdHash21(px).add(chdHash21(px.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let output = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
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

    update(params) {
        if (params.time !== undefined) {
            this.uGrainPhase.value = Math.floor(params.time * 24) % 256;
        }
        if (params.dip !== undefined) this.uDip.value = params.dip;
        if (params.bloomBoost !== undefined) this.uBloomBoost.value = params.bloomBoost;
        if (params.warpRush !== undefined) this.uWarpRush.value = params.warpRush;
    }

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
