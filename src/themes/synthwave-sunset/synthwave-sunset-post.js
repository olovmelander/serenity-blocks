/**
 * Synthwave Sunset — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass (no MRT), one bloom chain (Medium and up), the sun's shafts (Medium and up: two
 * short radial marches at reduced resolution) and ONE full-screen output pass:
 *   scene (+ radial chromatic aberration on the showcase tiers) → the sea mist (a closed-form
 *   exponential height fog along each view ray, from the scene's depth, lit by the horizon's own
 *   colour on that bearing and by the sun ahead) → the sun's shafts through the wheel → bloom
 *   (4-tap, max-channel soft-knee prefilter so thin bulbs and railings do not flicker) → a
 *   hue-preserving filmic shoulder on the brightest channel (the sun and the neon keep their
 *   colour; only the hottest cores whiten) → split-tone grade by scaling only (teal shadows, warm
 *   highlights: no additive lift, so blacks never take a coloured veil) → vibrance → vignette →
 *   sRGB encode → grain on the darks → triangular dither.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    abs,
    clamp,
    dot,
    exp,
    float,
    floor,
    length,
    max,
    min,
    mix,
    normalize,
    pass,
    perspectiveDepthToViewZ,
    renderOutput,
    rtt,
    screenCoordinate,
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
    RIG, SUN, rgb, swHash21, swMax3, swSkyGradient,
} from './synthwave-sunset-tsl.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode (emitters still read through the grade).
 * `msaa` is the scene-pass sample count (WebGPU: 1 or 4). Shader detail is anti-aliased
 * analytically, but box silhouettes, palm trunks and mountain ridges are geometry edges that only
 * MSAA smooths — without it they stair-step and crawl as the camera drifts.
 * `shafts`: taps of the first radial march toward the sun (0 = none) at `shaftScale` resolution.
 */
export const POST_LOOK = {
    Extreme: {
        bloom: true, bloomStrength: 0.95, bloomResolution: 0.5, grain: true, ca: 1.0, msaa: 4, shafts: 28, shaftScale: 0.5,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.92, bloomResolution: 0.45, grain: true, ca: 0.7, msaa: 4, shafts: 24, shaftScale: 0.4,
    },
    High: {
        bloom: true, bloomStrength: 0.9, bloomResolution: 0.4, grain: true, ca: 0, msaa: 4, shafts: 20, shaftScale: 0.35,
    },
    Medium: {
        bloom: true, bloomStrength: 0.8, bloomResolution: 0.3, grain: false, ca: 0, msaa: 0, shafts: 14, shaftScale: 0.25,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, grain: false, ca: 0, msaa: 0, shafts: 0, shaftScale: 0.25,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, grain: false, ca: 0, msaa: 0, shafts: 0, shaftScale: 0.25,
    },
};

/**
 * The sea mist: density at sea level (1/m) and its scale height (m). It hugs the water, so the
 * pier's piles and the wheel's foot are hazed while its crown stays clear, the town round the bay
 * fades into it, and the setting sun's lower limb sinks into a warm band.
 */
export const MIST = Object.freeze({
    density: 1 / 420,
    height: 12,
    /** Where the sky's rays stop (m): the mist beyond is the horizon's own colour anyway. */
    reach: 6000,
    /** The share of the mist laid over the sky, whose gradient already holds the air. */
    overSky: 0.4,
});

/**
 * The mist's optical depth along a ray from an eye at height `eyeY` (m) with vertical direction
 * component `dirY`, over `t` metres: the output pass's closed form, for tests and tuning.
 */
export function mistOpticalDepth(eyeY, dirY, t) {
    const kt = (dirY / MIST.height) * t;
    const shape = Math.abs(kt) < 1e-3 ? 1 - kt / 2 : (1 - Math.exp(-kt)) / kt;
    return MIST.density * Math.exp(-eyeY / MIST.height) * t * shape;
}

/** The sun's shafts: how far each pixel marches toward it (share of the way), the decay a tap. */
export const SHAFTS = Object.freeze({
    length: 0.72,
    decay: 0.976,
    /** The emitter: the sun's disc (linear level) and its aureole's fall-off (per disc radius²). */
    disc: 2.3,
    aureole: 0.14,
    aureoleLevel: 0.75,
    strength: 0.82,
    /** The share of the shafts' light laid over the sun's own disc. */
    overDisc: 0.3,
});

export const BLOOM_THRESHOLD = 1.0;
export const BLOOM_KNEE = 0.5;
export const BLOOM_RADIUS = 0.55;

const LUMA = vec3(0.2126, 0.7152, 0.0722);

/** A render pipeline that only encodes the scene (the no-post / fallback path). */
export function createPassThroughPipeline(renderer, scene, camera) {
    const pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera, { samples: 0 });
    pipeline.outputNode = scenePass;
    return {
        render: () => pipeline.render(),
        update() {},
        setSize() {},
        dispose() {
            scenePass.dispose();
            pipeline.dispose();
        },
    };
}

export class SynthwaveSunsetPost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} [params]
     * @param {object} [params.look]     POST_LOOK entry
     * @param {number} [params.samples]  scene-pass MSAA samples (default look.msaa)
     * @param {boolean} [params.grain=true]  false in deterministic capture modes
     * @param {object} [params.uniforms]  the world's uniforms (createWorldUniforms): the mist takes
     *                                    the horizon's colour from the sky's own gradient and the
     *                                    shafts the sun's height. Without them neither is built.
     * @param {boolean} [params.mist=true]    false: no sea mist (an A/B aid)
     * @param {boolean} [params.shafts=true]  false: no sun shafts (an A/B aid)
     */
    constructor(renderer, scene, camera, params = {}) {
        const look = params.look || POST_LOOK.High;
        this.look = look;
        this.renderer = renderer;
        this.camera = camera;
        this.postProcessing = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: params.samples ?? look.msaa ?? 0 });
        const sceneColor = this.scenePass.getTextureNode('output');
        const u = params.uniforms ?? null;
        this.u = u;

        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uSun = uniform(new THREE.Vector2(0.25, 0.55));
        /** The sun disc's radius in screen heights (from the lens, each render). */
        this.uSunR = uniform(0.1);
        this.uSunVis = uniform(0);
        this.uBloomBoost = uniform(0);
        this.uExposure = uniform(1.0);
        this.grainEnabled = params.grain !== false && look.grain === true;
        this.uGrain = uniform(this.grainEnabled ? 3.5 / 255 : 0);
        this.uGrainPhase = uniform(0);
        // Inside the pipeline the camera nodes are the output quad's: the scene camera's own
        // matrices (live references, updated in place by three) and its eye, set before each render.
        this.uProjInv = uniform(camera.projectionMatrixInverse);
        this.uCamWorld = uniform(camera.matrixWorld);
        this.uEye = uniform(new THREE.Vector3(0, RIG.height, RIG.z));
        this.uNear = uniform(camera.near ?? RIG.near);
        this.uFar = uniform(camera.far ?? RIG.far);
        const withMist = u !== null && params.mist !== false;
        const withShafts = u !== null && params.shafts !== false && look.shafts > 0;
        const sceneDepth = withMist || withShafts ? this.scenePass.getTextureNode('depth') : null;

        // ── The sun's shafts (Medium and up) ──
        this.shaftsNode = withShafts ? this.createShafts(sceneDepth, look) : null;

        // ── Bloom (Medium and up) ──
        this.bloomNode = null;
        if (look.bloom) {
            this.bloomNode = bloom(sceneColor, look.bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD);
            this.bloomNode.threshold.value = BLOOM_THRESHOLD;
            this.bloomNode.smoothWidth.value = BLOOM_KNEE;
            this.bloomNode.setResolutionScale(look.bloomResolution);
            const { uSrcTexel } = this;
            // BloomNode's documented hook, read once at setup. Inline (no setLayout): `input`
            // must stay the raw scene TextureNode for .sample().
            this.bloomNode.highPassFn = Fn(({ input, threshold, smoothWidth }) => {
                const st = uv();
                const o = uSrcTexel.mul(1.25);
                const tap = (dx, dy) => clamp(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb, 0.0, 8.0);
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = swMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const caAmount = look.ca ?? 0;
        const outputFn = Fn(() => {
            const st = screenUV;
            const centered = st.sub(0.5).toVar();

            // ── Scene (+ radial CA on the showcase tiers) ──
            const S = vec3(sceneColor.sample(st).rgb).toVar();
            if (caAmount > 0) {
                const off = centered.mul(length(centered)).mul(0.0045 * caAmount);
                S.x.assign(sceneColor.sample(st.add(off)).r);
                S.z.assign(sceneColor.sample(st.sub(off)).b);
            }

            // ── The sea mist: an exponential height fog integrated in closed form along the view
            // ray to what the depth says it meets (the sky's rays to MIST.reach) ──
            if (withMist) {
                const depth = sceneDepth.sample(st).x.toVar();
                const ndc = vec2(st.x.mul(2.0).sub(1.0), float(1.0).sub(st.y.mul(2.0)));
                const vp = this.uProjInv.mul(vec4(ndc, 1.0, 1.0));
                const viewDir = normalize(vp.xyz.div(vp.w)).toVar();
                const D = normalize(this.uCamWorld.mul(vec4(viewDir, 0.0)).xyz).toVar();
                const viewZ = perspectiveDepthToViewZ(depth, this.uNear, this.uFar);
                const isSky = step(0.9999995, depth);
                const t = mix(viewZ.div(min(viewDir.z, -1e-4)), float(MIST.reach), isSky).toVar();
                const kt = D.y.div(MIST.height).mul(t).toVar();
                const small = abs(kt).lessThan(1e-3);
                const ktSafe = select(small, float(1e-3), kt);
                const shape = select(small, float(1.0).sub(kt.mul(0.5)), float(1.0).sub(exp(ktSafe.negate())).div(ktSafe));
                // The sky's own gradient already holds the air: over it the mist only softens the
                // horizon and sinks the sun's lower limb, it does not cover the disc.
                const tau = float(MIST.density).mul(exp(this.uEye.y.div(-MIST.height))).mul(t).mul(shape)
                    .mul(mix(float(1.0), float(MIST.overSky), isSky));
                const trans = exp(tau.negate()).toVar();
                // Lit by the horizon's own colour on this bearing, warmer and brighter toward the sun.
                const flat = normalize(vec3(D.x, 0.0, D.z.sub(1e-5)));
                const horizonCol = swSkyGradient(u, flat).color;
                const ahead = exp(dot(D, u.sunDir).sub(1.0).mul(10.0));
                const sunUp = smoothstep(-0.16, 0.06, u.sunDir.y);
                const mistCol = horizonCol.mul(0.94).add(rgb(0xffa060).mul(ahead.mul(sunUp).mul(0.5)));
                S.assign(S.mul(trans).add(mistCol.mul(float(1.0).sub(trans))));
            }

            // ── The sun's shafts through the wheel ──
            if (this.shaftsNode) {
                // Held back over the disc itself, so the sun keeps its edge inside its own glow.
                const fromSun = length(st.sub(this.uSun).mul(vec2(this.uAspect, 1.0))).div(this.uSunR);
                const overDisc = mix(float(SHAFTS.overDisc), float(1.0), smoothstep(0.7, 1.6, fromSun));
                // Once the sun is down the afterglow keeps a little; the lights on the wheel, which
                // draw no depth and so pass for sky, must not throw shafts of their own.
                const sunHigh = smoothstep(-0.11, 0.02, u.sunDir.y).mul(0.85).add(0.15);
                S.addAssign(this.shaftsNode.sample(st).rgb.mul(this.uSunVis.mul(SHAFTS.strength).mul(overDisc).mul(sunHigh)));
            }

            // ── Bloom ──
            const B = vec3(0.0).toVar();
            if (this.bloomNode) {
                const glow = vec3(this.bloomNode.getTextureNode().sample(st).rgb);
                B.assign(glow.mul(float(1.0).add(this.uBloomBoost.mul(0.25))));
            }
            const H = S.add(B).toVar();

            // ── Tone curve: identity to 0.62, then a soft shoulder to 1 on the max channel; the
            // other channels keep their ratio to it, so hue survives. Only cores above ~4 bleach.
            const E = H.mul(this.uExposure).toVar();
            const m = max(swMax3(E), 1e-5).toVar();
            const knee = float(0.62);
            const shoulder = knee.add(float(1.0).sub(knee).mul(float(1.0).sub(exp(m.sub(knee).div(float(1.0).sub(knee)).negate()))));
            const mapped = select(m.lessThan(knee), m, shoulder);
            const T = E.mul(mapped.div(m)).toVar();
            // vec3(select) collapses to a scalar in r186: spell the vector out.
            T.assign(mix(T, vec3(mapped, mapped, mapped), smoothstep(4.0, 14.0, m).mul(0.55)));
            const L = dot(T, LUMA).toVar();
            // Split tone by scaling only: teal-blue shadows, warm highlights.
            const shadow = float(1.0).sub(smoothstep(0.0, 0.3, L));
            const high = smoothstep(0.35, 0.95, L);
            T.mulAssign(mix(vec3(1.0), vec3(0.9, 0.97, 1.1), shadow.mul(0.5)));
            T.mulAssign(mix(vec3(1.0), vec3(1.05, 0.99, 0.92), high.mul(0.4)));
            // Vibrance: lift the less-saturated colours most.
            const mx = swMax3(T);
            const sat = mx.sub(min(T.x, min(T.y, T.z))).div(max(mx, 1e-4));
            T.assign(mix(vec3(L), T, float(1.0).add(float(0.14).mul(float(1.0).sub(sat)))));
            // Vignette: mostly the corners, gentler on bright pixels.
            const rad = length(centered.mul(vec2(this.uAspect.div(1.778), 1.0)).mul(2.0));
            T.mulAssign(float(1.0).sub(smoothstep(0.55, 1.35, rad).mul(float(0.34).sub(L.mul(0.15)))));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const px = floor(screenCoordinate);
            const gp = this.uGrainPhase;
            const gn = swHash21(px.add(vec2(gp.mul(113.1), gp.mul(71.7)))).sub(0.5);
            D.addAssign(gn.mul(this.uGrain).mul(float(1.0).sub(smoothstep(0.03, 0.18, swMax3(D)))));
            const dth = swHash21(px).add(swHash21(px.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));
            return vec4(clamp(D, 0.0, 1.0), 1.0);
        });

        this.postProcessing.outputColorTransform = false;
        this.postProcessing.outputNode = outputFn();
        this.postProcessing.needsUpdate = true;
        this.size = { width: 0, height: 0 };
    }

    /**
     * The sun's shafts: their emitters once, then two short marches instead of one long one (the
     * breathing stage's pattern, src/ui/effects/breathing/stage/breath-post.js).
     *
     * The emitters are the bright SKY near the sun (the depth says sky where nothing was drawn),
     * taken once per reduced-resolution texel from four scene taps, so the wheel's spokes, its
     * cabins and the pier cut dark lanes into the light (a spoke thinner than the texel still dims
     * it) and the marches read one small texture instead of the multisampled scene and its depth.
     * The first march walks each pixel toward the sun and gathers them; the second walks the
     * first's result over one of its steps. N + M taps give the smoothness of N × M, with no jitter
     * and so no grain. Emitters fade with their distance from the sun and the march's last steps
     * fade out, so the glow never switches on at a hard radius.
     */
    createShafts(sceneDepth, look) {
        const count = look.shafts;
        const refine = 6;
        const {
            u, uSun, uAspect, uSrcTexel,
        } = this;
        const emit = Fn(() => {
            const coord = uv().toVar();
            const o = uSrcTexel.mul(0.25 / look.shaftScale).toVar();
            const open = (dx, dy) => step(0.9999995, sceneDepth.sample(coord.add(vec2(o.x.mul(dx), o.y.mul(dy)))).x);
            const sky = open(-1, -1).add(open(1, -1)).add(open(-1, 1)).add(open(1, 1))
                .mul(0.25);
            // The light is the sun's own (its disc and aureole, from where it stands on screen),
            // never the scene's colour: fireworks and bulbs draw no depth and so pass for sky, and
            // read from the frame they would throw beams of their own.
            const r = length(coord.sub(uSun).mul(vec2(uAspect, 1.0))).div(this.uSunR).toVar();
            const disc = float(1.0).sub(smoothstep(0.85, 1.1, r));
            const aureole = exp(r.mul(r).mul(-SHAFTS.aureole));
            const light = mix(rgb(0xffa45a), rgb(0xff7040), u.dusk).mul(disc.mul(SHAFTS.disc).add(aureole.mul(SHAFTS.aureoleLevel)));
            return vec4(light.mul(sky), 1.0);
        })();
        this.shaftsEmit = rtt(emit, null, null, { resolutionScale: look.shaftScale });
        const source = this.shaftsEmit;
        const gather = Fn(() => {
            const coord = uv().toVar();
            const stride = uSun.sub(coord).mul(SHAFTS.length / count).toVar();
            const at = coord.toVar();
            const sum = vec3(0.0).toVar();
            const weight = float(1.0).toVar();
            Loop(count, ({ i }) => {
                at.addAssign(stride);
                const taper = float(1.0).sub(smoothstep(count * 0.72, count, float(i).add(1.0)));
                sum.addAssign(source.sample(at).rgb.mul(weight.mul(taper)));
                weight.mulAssign(SHAFTS.decay);
            });
            return vec4(sum.div(count), 1.0);
        })();
        this.shaftsFirst = rtt(gather, null, null, { resolutionScale: look.shaftScale });
        const first = this.shaftsFirst;
        const fill = Fn(() => {
            const coord = uv().toVar();
            const stride = uSun.sub(coord).mul(SHAFTS.length / (count * refine)).toVar();
            const at = coord.toVar();
            const sum = vec3(0.0).toVar();
            Loop(refine, () => {
                sum.addAssign(first.sample(at).rgb);
                at.addAssign(stride);
            });
            return vec4(sum.div(refine), 1.0);
        })();
        return rtt(fill, null, null, { resolutionScale: look.shaftScale });
    }

    /**
     * Per-frame uniforms (all optional).
     * @param {{time?: number, sun?: THREE.Vector2, sunVis?: number, bloomBoost?: number}} params
     */
    update(params) {
        if (params.time !== undefined) this.uGrainPhase.value = Math.floor(params.time * 24) % 256;
        if (params.sun) this.uSun.value.copy(params.sun);
        if (params.sunVis !== undefined) this.uSunVis.value = params.sunVis;
        if (params.bloomBoost !== undefined) this.uBloomBoost.value = params.bloomBoost;
    }

    setGrainEnabled(enabled) {
        this.uGrain.value = enabled && this.look.grain === true ? 3.5 / 255 : 0;
    }

    render() {
        const { camera } = this;
        this.uEye.value.setFromMatrixPosition(camera.matrixWorld);
        if (camera.fov) this.uSunR.value = (0.5 * Math.tan(SUN.radius)) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
        this.postProcessing.render();
    }

    /** The scene pass and bloom chain size themselves from the drawing buffer every frame. */
    setSize(width, height, bufferWidth = width, bufferHeight = height) {
        this.size.width = width;
        this.size.height = height;
        if (width > 0 && height > 0) this.uAspect.value = width / height;
        if (bufferWidth > 0 && bufferHeight > 0) this.uSrcTexel.value.set(1 / bufferWidth, 1 / bufferHeight);
    }

    dispose() {
        this.scenePass.dispose();
        this.shaftsEmit?.dispose();
        this.shaftsFirst?.dispose();
        this.shaftsNode?.dispose();
        if (this.bloomNode) disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing.dispose();
    }
}
