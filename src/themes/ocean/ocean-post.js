/**
 * Ocean — post stack (TSL RenderPipeline, both WebGPURenderer backends).
 *
 * One scene pass, the shafts, one bloom chain (Medium and up) and ONE full-screen pass:
 *
 *   the shafts (the light that comes down through the water is marched along every line of
 *   sight, at reduced resolution: each step looks up along the sun's ray to the pattern the
 *   surface throws, the same pattern that lays the caustic net on the sand, so a shaft stands
 *   over its own bright patch; the large animals' shadows and the great shaft of a four-line
 *   clear are in the same march) → pressure rings (a hard drop and a four-line clear send a ring
 *   through the water that bends the picture as it crosses) and lens fringe → calm zones (what
 *   shows through the translucent board card and HUD is soft-clipped and its bloom attenuated)
 *   → bloom → exposure and event flash → "sea filmic" tone map (hue preserving, the hottest
 *   cores roll to white) → grade (the shadows lean toward the hour's own deep water) → vignette
 *   → sRGB → grain and triangular dither.
 *
 * Tone mapping happens exactly once: renderer.toneMapping = NoToneMapping and the pipeline's
 * outputColorTransform is off (the output node encodes sRGB itself).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    abs,
    clamp,
    dot,
    exp,
    float,
    floor,
    interleavedGradientNoise,
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
    SURFACE, ocBeam, ocBell, ocHash21, ocLightPoint, ocLightRead, ocLuma, ocMax3, ocPow4, ocShade,
} from './ocean-tsl.js';

/**
 * Per-tier look. `bloom: false` builds no BloomNode. `shafts` is the march's step count (0 = no
 * march) and `shaftScale` the share of the frame's resolution it runs at; `shade` puts the large
 * animals' shadows in it; `fringe` = the chromatic split (two more scene taps); `msaa` =
 * scene-pass samples.
 */
export const POST_LOOK = Object.freeze({
    Extreme: {
        bloom: true, bloomStrength: 0.5, bloomResolution: 0.5, shafts: 24, shaftScale: 0.5, shade: true, fringe: true, msaa: 4,
    },
    Ultra: {
        bloom: true, bloomStrength: 0.5, bloomResolution: 0.5, shafts: 20, shaftScale: 0.5, shade: true, fringe: true, msaa: 4,
    },
    High: {
        bloom: true, bloomStrength: 0.48, bloomResolution: 0.45, shafts: 16, shaftScale: 0.5, shade: true, fringe: true, msaa: 4,
    },
    Medium: {
        bloom: true, bloomStrength: 0.45, bloomResolution: 0.33, shafts: 11, shaftScale: 0.4, shade: true, fringe: false, msaa: 0,
    },
    Low: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, shafts: 8, shaftScale: 0.33, shade: false, fringe: false, msaa: 0,
    },
    Minimal: {
        bloom: false, bloomStrength: 0, bloomResolution: 0.25, shafts: 6, shaftScale: 0.25, shade: false, fringe: false, msaa: 0,
    },
});

export const BLOOM_THRESHOLD = 0.82;
export const BLOOM_KNEE = 0.45;
export const BLOOM_RADIUS = 0.6;
export const EXPOSURE = 1.0;

/** Metres along a line of sight the shafts are followed. */
export const SHAFT_RANGE = 48;
/** How strongly the shafts stand in the water at rest. */
export const SHAFT_GAIN = 0.2;

/** Calm rects (board cards + HUD) the output pass evaluates. */
export const CALM_RECTS_MAX = 5;
/** Pressure rings in the picture at once. */
export const SHOCK_SLOTS = 2;

/** Rounded-box signed distance in pixels. rect = (x0, y0, x1, y1) in pixels (top-left origin). */
const roundBoxSdf = /* @__PURE__ */ Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
}).setLayout({
    name: 'oc_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/**
 * Sea filmic: a hue-preserving shoulder on the max channel (identity below `k`), then a path to
 * white for the hottest values, so a coral's rose stays rose under the sun and only the sun
 * itself burns clean.
 */
const seaFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(ocMax3(c), 1e-5);
    const k = float(0.46);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(mapped, mapped, mapped), smoothstep(1.4, 6.0, peak).mul(0.8));
}).setLayout({ name: 'oc_seaFilmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

export class OceanPost {
    /**
     * @param {THREE.WebGPURenderer} renderer
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {object} params
     * @param {object} params.look        POST_LOOK entry
     * @param {object} params.u           the world's shared uniforms (the light the shafts march through)
     * @param {boolean} [params.falseColor=false]
     */
    constructor(renderer, scene, camera, params = {}) {
        const look = params.look || POST_LOOK.High;
        const { u } = params;
        this.look = look;
        this.renderer = renderer;
        this.camera = camera;
        this.pipeline = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera, { samples: params.samples ?? look.msaa ?? 0 });
        const sceneColor = this.scenePass.getTextureNode('output');
        const sceneDepth = this.scenePass.getTextureNode('depth');

        this.uAspect = uniform(16 / 9);
        this.uSrcTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
        this.uViewport = uniform(new THREE.Vector2(1920, 1080));
        this.uTime = uniform(0);
        this.uExposure = uniform(EXPOSURE);
        this.uFlash = uniform(0); // event flash (a lift), 0..1
        this.uKick = uniform(0); // impact, 0..1: widens the fringe
        this.uShafts = uniform(1); // gain on the shafts
        this.uBloomBoost = uniform(0);
        /** What the grade leans the shadows toward (the hour's own deep water), scene-linear. */
        this.uShade = uniform(new THREE.Vector3(0.004, 0.03, 0.07));
        /** Pressure rings: (centre x, centre y in screen fractions, radius in screen heights, strength). */
        this.shockRows = Array.from({ length: SHOCK_SLOTS }, () => new THREE.Vector4(0.5, 0.5, 0, 0));
        this.uShock = this.shockRows.map((v) => uniform(v));
        // The camera's basis, scaled so that `forward + right·x + up·y` is the ray through a pixel.
        this.uEye = uniform(new THREE.Vector3());
        this.uForward = uniform(new THREE.Vector3(0, 0, -1));
        this.uRight = uniform(new THREE.Vector3(1, 0, 0));
        this.uUp = uniform(new THREE.Vector3(0, 1, 0));
        this.uNear = uniform(0.2);
        this.uFar = uniform(420);
        this.uShaftTexel = uniform(new THREE.Vector2(1 / 960, 1 / 540));
        this.drawing = new THREE.Vector2();

        this.calmRects = Array.from({ length: CALM_RECTS_MAX }, () => new THREE.Vector4(0, 0, 0, 0));
        this.uCalm = this.calmRects.map((v) => uniform(v));
        this.uCalmStrength = uniform(0);

        // ── The shafts ──
        this.shaftsNode = null;
        if (u && look.shafts > 0 && params.shafts !== false) {
            this.shaftsNode = rtt(this.buildShafts(u, sceneDepth, look), null, null, {
                resolutionScale: look.shaftScale,
            });
            this.shaftsNode.renderTarget.texture.name = 'Ocean — light through the water';
        }

        // ── Bloom: max-channel soft knee over a 4-tap box ──
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
                // Hue-preserving clamp on the max channel: a per-channel clamp would turn a
                // coral's rose white and the gold shafts yellow.
                const tap = (dx, dy) => {
                    const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
                    return c.mul(min(float(1.0), float(6.0).div(max(ocMax3(c), 1e-4))));
                };
                const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1))
                    .mul(0.25);
                const br = ocMax3(c);
                const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
                const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
                return vec4(c.mul(w), 1.0);
            });
        }

        const falseColor = params.falseColor === true;

        const outputFn = Fn(() => {
            const st = screenUV;
            const px = st.mul(this.uViewport);
            const fromCentre = st.sub(0.5);

            // ── Calm zones (board cards + HUD) ──
            const hScale = this.uViewport.y.div(1080.0);
            const calm = float(0.0).toVar();
            for (let i = 0; i < CALM_RECTS_MAX; i++) {
                const r = this.uCalm[i];
                const sdf = roundBoxSdf(px, r.mul(vec4(this.uViewport, this.uViewport)), hScale.mul(16.0));
                const inside = float(1.0).sub(smoothstep(-20.0, 6.0, sdf)).mul(step(0.001, r.z.sub(r.x)));
                calm.assign(max(calm, inside));
            }
            calm.mulAssign(this.uCalmStrength);

            // ── Pressure rings: the picture is pushed outward along each ring's radius ──
            const bend = vec2(0.0).toVar();
            const glint = float(0.0).toVar();
            for (let i = 0; i < SHOCK_SLOTS; i++) {
                const ring = this.uShock[i];
                const from = st.sub(ring.xy).mul(vec2(this.uAspect, 1.0));
                const reach = max(length(from), 1e-3);
                const band = ocBell(reach.sub(ring.z).div(0.07)).mul(ring.w);
                bend.addAssign(from.div(reach).div(vec2(this.uAspect, 1.0)).mul(band).mul(-0.022));
                glint.addAssign(band);
            }
            bend.mulAssign(float(1.0).sub(calm));
            const at = st.add(bend).toVar();

            const S = vec3(sceneColor.sample(at).rgb).toVar();
            if (look.fringe) {
                const r2 = fromCentre.dot(fromCentre);
                const fringe = r2.mul(0.0045).add(this.uKick.mul(0.005)).add(glint.mul(0.006))
                    .mul(float(1.0).sub(calm));
                const split = fromCentre.mul(fringe).toVar();
                If(fringe.greaterThan(2e-4), () => {
                    S.assign(vec3(
                        sceneColor.sample(at.sub(split)).level(0).r,
                        S.g,
                        sceneColor.sample(at.add(split)).level(0).b,
                    ));
                });
            }

            // ── The light through the water ──
            if (this.shaftsNode) {
                // Four taps a half-texel apart: a tent that takes the march's grain out.
                const tap = (x, y) => this.shaftsNode.sample(at.add(this.uShaftTexel.mul(vec2(x, y)))).rgb;
                const shafts = tap(-0.5, -0.5).add(tap(0.5, -0.5)).add(tap(-0.5, 0.5)).add(tap(0.5, 0.5))
                    .mul(0.25);
                S.addAssign(vec3(shafts).mul(this.uShafts));
            }
            // A ring carries a little light on its crest.
            S.mulAssign(glint.mul(0.35).add(1.0));

            // What shows through the card is soft-clipped (hue-preserving).
            const m = max(ocMax3(S), 1e-5);
            const clipped = S.mul(min(m, float(0.22).add(m.mul(0.2))).div(m));
            S.assign(mix(S, clipped, calm.mul(0.9)));

            // ── Bloom ──
            const glare = vec3(0.0).toVar();
            if (this.bloomNode) {
                const bt = this.bloomNode.getTextureNode();
                glare.assign(vec3(bt.sample(at).rgb).mul(float(1.0).add(this.uBloomBoost.mul(0.5))));
                glare.mulAssign(float(1.0).sub(calm.mul(0.86)));
            }
            const H = S.add(glare);

            // ── Tone map + grade ──
            const X = H.mul(this.uExposure).mul(float(1.0).add(this.uFlash.mul(0.35)));
            const T = seaFilmic(X).toVar();
            const L = ocLuma(T);
            // The dark of the sea is a colour, not a hole.
            const lo = float(1.0).sub(smoothstep(0.0, 0.24, L));
            T.assign(T.add(this.uShade.mul(lo).mul(0.5)));
            T.assign(mix(vec3(ocLuma(T)), T, 1.08));
            // Vignette, measured from the frame, a touch heavier in the corners.
            const cv = fromCentre.mul(vec2(this.uAspect.div(1.778), 1.0));
            const vig = smoothstep(0.45, 1.12, length(cv.mul(1.5)));
            T.mulAssign(float(1.0).sub(vig.mul(0.4)));

            // ── Encode, then finish in display space ──
            const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
            const pxi = floor(screenCoordinate);
            const frame = floor(this.uTime.mul(24.0));
            const grain = ocHash21(pxi.add(vec2(frame.mul(1.7), frame.mul(-2.3)))).sub(0.5);
            D.addAssign(grain.mul(0.014).mul(float(1.0).sub(calm.mul(0.7))));
            const dth = ocHash21(pxi).add(ocHash21(pxi.add(vec2(17.17, 17.17)))).sub(1.0);
            D.addAssign(dth.div(255.0));

            let out = vec4(clamp(D, 0.0, 1.0), 1.0);
            if (falseColor) {
                const mx = ocMax3(H);
                const fc = select(
                    mx.lessThan(0.1),
                    vec3(0.05, 0.1, 0.6),
                    select(mx.lessThan(0.6), vec3(0.1, 0.55, 0.15), select(
                        mx.lessThan(1.0),
                        vec3(0.85, 0.8, 0.1),
                        select(mx.lessThan(2.5), vec3(1.0, 0.45, 0.05), vec3(0.95, 0.05, 0.05)),
                    )),
                );
                out = vec4(fc, 1.0);
            }
            return out;
        });

        this.pipeline.outputColorTransform = false;
        this.pipeline.outputNode = outputFn();
        this.pipeline.needsUpdate = true;
    }

    /**
     * The light that stands in the water along each pixel's line of sight. Every step asks the
     * surface's pattern whether the sun reaches that point of the water; where it does, the
     * water glows, so the bright places between the waves stand in the sea as shafts.
     */
    buildShafts(u, sceneDepth, look) {
        const steps = look.shafts;
        return Fn(() => {
            const st = uv();
            const depth = sceneDepth.sample(st).r;
            const viewZ = perspectiveDepthToViewZ(depth, this.uNear, this.uFar);
            const ray = this.uForward.add(this.uRight.mul(st.x.mul(2).sub(1)))
                .add(this.uUp.mul(float(1).sub(st.y.mul(2)))).toVar();
            const direction = normalize(ray).toVar();
            // As far as the scene, the surface or the march's range, whichever comes first.
            const toSurface = float(SURFACE).sub(this.uEye.y).div(max(direction.y, 1e-3));
            const ceiling = select(direction.y.greaterThan(1e-3), toSurface, float(SHAFT_RANGE));
            const reach = min(min(length(ray).mul(viewZ.negate()), ceiling), SHAFT_RANGE).toVar();
            const stride = reach.div(steps).toVar();
            const travelled = stride.mul(interleavedGradientNoise(screenCoordinate.xy)).toVar();
            // What a metre of water takes out of the shafts' own light on its way to the eye. (More
            // than the water's own share: the columns near the eye are the ones that read as shafts,
            // and the far ones would only add up to a veil.)
            const thin = dot(u.ext, vec3(0.2, 0.45, 0.35)).mul(float(1.0).sub(u.lift.mul(0.55))).add(0.03);
            const glow = float(0).toVar();
            Loop(steps, () => {
                const point = this.uEye.add(direction.mul(travelled)).toVar();
                const mask = ocLightRead(u, ocLightPoint(u, point)).g;
                const under = max(float(SURFACE).sub(point.y), 0.0);
                // A shaft is brightest under the surface and gone by the deep.
                const sunk = exp(under.mul(-0.085));
                const seen = exp(travelled.mul(thin).negate());
                const lit = mask.mul(mask).mul(sunk).add(ocBeam(u, point).mul(1.1)).toVar();
                if (look.shade) lit.mulAssign(ocShade(u, point));
                glow.addAssign(lit.mul(seen));
                travelled.addAssign(stride);
            });
            // Light scatters forward: the shafts are strongest looking up their length.
            const sunward = clamp(dot(direction, u.sunDir), 0.0, 1.0);
            const phase = ocPow4(sunward).mul(1.7).add(0.32);
            return vec4(u.shaft.mul(glow.mul(stride)).mul(phase).mul(SHAFT_GAIN).mul(u.breath), 1.0);
        })();
    }

    /** Per-frame values (all optional). */
    update({
        flash, kick, bloomBoost, exposure, shafts, time, shade, shocks,
    } = {}) {
        if (flash !== undefined) this.uFlash.value = flash;
        if (kick !== undefined) this.uKick.value = kick;
        if (bloomBoost !== undefined) this.uBloomBoost.value = bloomBoost;
        if (exposure !== undefined) this.uExposure.value = exposure;
        if (shafts !== undefined) this.uShafts.value = shafts;
        if (time !== undefined) this.uTime.value = time;
        if (shade) this.uShade.value.set(shade[0], shade[1], shade[2]);
        if (shocks) {
            for (let i = 0; i < SHOCK_SLOTS; i++) {
                const s = shocks[i];
                if (s) this.shockRows[i].set(s.x, s.y, s.radius, s.strength);
                else this.shockRows[i].set(0.5, 0.5, 0, 0);
            }
        }
    }

    /**
     * Calm rects in screen fractions (x0, y0, x1, y1; y down), at most CALM_RECTS_MAX, and the
     * eased strength (0 = off).
     */
    setCalmRects(rects, strength) {
        for (let i = 0; i < CALM_RECTS_MAX; i++) {
            const r = rects?.[i];
            if (r) this.calmRects[i].set(r.x0, r.y0, r.x1, r.y1);
            else this.calmRects[i].set(0, 0, 0, 0);
        }
        this.uCalmStrength.value = strength;
    }

    setSize(width, height, bufferWidth = width, bufferHeight = height) {
        if (width > 0 && height > 0) this.uAspect.value = width / height;
        if (bufferWidth > 0 && bufferHeight > 0) {
            this.uSrcTexel.value.set(1 / bufferWidth, 1 / bufferHeight);
            this.uViewport.value.set(bufferWidth, bufferHeight);
            const scale = this.look.shaftScale || 0.5;
            this.uShaftTexel.value.set(
                1 / Math.max(1, Math.floor(bufferWidth * scale)),
                1 / Math.max(1, Math.floor(bufferHeight * scale)),
            );
        }
    }

    /** Hand this frame's camera to the march. */
    aim() {
        const { camera } = this;
        if (!camera?.isPerspectiveCamera) return;
        camera.updateMatrixWorld();
        const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
        this.uEye.value.setFromMatrixPosition(camera.matrixWorld);
        this.uRight.value.setFromMatrixColumn(camera.matrixWorld, 0).normalize().multiplyScalar(tanV * camera.aspect);
        this.uUp.value.setFromMatrixColumn(camera.matrixWorld, 1).normalize().multiplyScalar(tanV);
        this.uForward.value.setFromMatrixColumn(camera.matrixWorld, 2).normalize().negate();
        this.uNear.value = camera.near;
        this.uFar.value = camera.far;
    }

    render() {
        this.aim();
        this.pipeline.render();
    }

    dispose() {
        this.scenePass?.dispose();
        this.shaftsNode?.dispose?.();
        this.shaftsNode?.renderTarget?.dispose?.();
        if (this.bloomNode) disposeBloomNodeDeep(this.bloomNode);
        this.pipeline?.dispose();
        this.scenePass = null;
        this.shaftsNode = null;
        this.bloomNode = null;
        this.pipeline = null;
        this.renderer = null;
        this.camera = null;
    }
}

/** A render pipeline that only encodes the scene (the fallback path if the post fails to build). */
export function createPassThroughPipeline(renderer, scene, camera) {
    const pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera, { samples: 0 });
    pipeline.outputNode = scenePass;
    return {
        render: () => pipeline.render(),
        update() {},
        setCalmRects() {},
        setSize() {},
        dispose() {
            scenePass.dispose();
            pipeline.dispose();
        },
    };
}
