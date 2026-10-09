/**
 * Voltage Storm — the sky.
 *
 * The whole sky (the clear twilight strip at the horizon, the hills and rain shafts standing in
 * it, and the supercell's underside) is painted once per frame into a reduced-resolution target:
 * the cloud is soft, so it does not need the screen's pixels, and the flooded plain mirrors the
 * same image (voltage-storm-water.js), so the mirror costs one fetch.
 *
 * The cloud is a slab walked along the view ray, front to back. Its lobes come from one baked 3D
 * noise read (a second, finer one erodes their edges). What makes them read as a ceiling of
 * hanging masses and not as fog is the light:
 *   - a lobe is lit by how LOW it hangs: its tip catches the strip's light, the recesses between
 *     lobes are nearly black;
 *   - and by what stands between it and the strip (one or two taps toward the horizon), so each
 *     lobe has a lit side and the far cloud, near the cell's edge, is the brightest;
 *   - every live lightning stroke is a light INSIDE the cloud: it is strongest deep in the slab,
 *     so the lobes in front of it stand dark against the glow;
 *   - the sheet lightning of a superbolt is a ring that runs out through the slab.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    atan,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    screenCoordinate,
    screenUV,
    sin,
    smoothstep,
    sqrt,
    step,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SHEET_SPEED, SKY_CODE_PEAK, STORM, vsFlashLight, vsPart, vsPassMaterial, vsTarget,
} from './voltage-storm-tsl.js';

/** Metres of full cloud that put out 63% of the light behind them. */
const EXTINCTION = 45;
/** How far toward the horizon's light the two shading taps reach (metres), and the way to it. */
const LIGHT_NEAR = 150;
const LIGHT_FAR = 480;
const LIGHT_WAY = Object.freeze([Math.sin(STORM.glowAzimuth) * 0.997, -0.07, -Math.cos(STORM.glowAzimuth) * 0.997]);
/** The band of the storm's edge (metres before `STORM.edge` where the cover thins out). */
const EDGE_BAND = 900;
/** The share of the slab the march walks (above it the cloud is solid and dark). */
const MARCH_TOP = 0.62;

/**
 * @param {object} u  shared storm uniforms
 * @param {object} options
 * @param {number} options.march       steps through the slab
 * @param {boolean} options.detail     second noise read and the light taps
 * @param {boolean} options.flashSteps light every step with the strokes (else once per pixel)
 */
export function createSky(u, { march = 14, detail = true, flashSteps = true } = {}) {
    const yLo = STORM.cloudBase - STORM.cloudSag;
    const yHi = STORM.cloudBase + STORM.cloudDepth;
    const span = yHi - yLo;

    /** A world point in the cloud's own drifting, twisting ground plan. */
    const plan = (p) => {
        // The cell winds up over the hero tower on a T-spin: the noise domain turns with it.
        const rel = p.xz.sub(u.twist.xy);
        const turn = u.twist.z.mul(exp(dot(rel, rel).div(u.twist.w.mul(u.twist.w)).negate()));
        const c = cos(turn);
        const s = sin(turn);
        return vec2(rel.x.mul(c).sub(rel.y.mul(s)), rel.x.mul(s).add(rel.y.mul(c))).add(u.twist.xy).add(u.drift.xz);
    };
    const height = (p) => clamp(p.y.sub(yLo).div(span), 0.0, 1.0);
    /** Where in the 3D noise a world point reads (`w` = its place in the cloud's ground plan). */
    const noisePoint = (p, w) => vec3(w.x, p.y.mul(1.12).add(u.churn.mul(5.5)), w.y).div(STORM.cloudTile);
    /**
     * The lobes' density at a point, 0..1, for a given slow `cover` value: only the deepest lobes
     * hang into the bottom of the slab; a third of the way up it is solid.
     */
    const lobeField = (p, cover, w) => {
        const n = u.cloudNoise(noisePoint(p, w));
        const need = mix(float(0.74), float(0.2), smoothstep(0.0, 0.46, height(p))).sub(cover.sub(0.5).mul(0.36));
        return n.r.sub(need);
    };
    const lobes = (p, cover, w) => clamp(lobeField(p, cover, w).mul(4.2), 0.0, 1.0);

    const paint = Fn(() => {
        const st = uv();
        const ndc = vec2(st.x.mul(2.0).sub(1.0), float(1.0).sub(st.y.mul(2.0)));
        const ray = normalize(
            u.camFwd.add(u.camRight.mul(ndc.x.mul(u.tanHalf.x))).add(u.camUp.mul(ndc.y.mul(u.tanHalf.y))),
        ).toVar();
        const el = ray.y.toVar();
        const up = max(el, 0.0).toVar();
        const flat = max(length(ray.xz), 1e-4).toVar();
        const az = atan(ray.x, ray.z.negate()).toVar();
        const toGlow = az.sub(STORM.glowAzimuth);
        const lobe = exp(toGlow.mul(toGlow).mul(-1.5)).toVar();

        // ── The clear strip ──
        const low = exp(up.mul(-15.0));
        const core = exp(up.mul(-70.0)).mul(lobe).mul(lobe);
        const sky = u.gap.mul(exp(up.mul(-4.5)).mul(0.7).add(0.3))
            .add(u.horizon.mul(low.mul(lobe.mul(1.3).add(0.26)).add(core.mul(1.0))))
            .toVar();
        // Far bars of cloud lying in the strip, lit from under.
        const bars = u.noise(vec2(az.mul(0.55).add(0.2), up.mul(7.5).add(0.13)));
        const bar = smoothstep(0.5, 0.72, bars.r).mul(exp(up.mul(-9.0))).mul(smoothstep(0.012, 0.05, up));
        sky.assign(mix(sky, u.haze.mul(0.7).add(u.horizon.mul(lobe).mul(0.08)), bar.mul(0.6)));
        // Rain shafts hang in it, darker than the light behind them; a stroke lights them.
        // They lean with the wind and their edges are ragged; they only ever DIM what is behind
        // them (a veil that lightened the dark cloud read as a pale pillar).
        const leaned = az.add(up.mul(0.55)).add(u.drift.x.mul(0.00011));
        const shaftNoise = u.noise(vec2(leaned.mul(0.9), up.mul(0.6).add(0.37)));
        const frayed = u.noise(vec2(leaned.mul(4.3), up.mul(2.1).add(0.11))).r.sub(0.5).mul(0.16);
        const shaft = smoothstep(0.56, 0.86, shaftNoise.g.add(frayed)).mul(exp(up.mul(-3.2)));
        sky.assign(sky.mul(float(1.0).sub(shaft.mul(0.44))).add(u.haze.add(u.veil.mul(0.12)).mul(shaft.mul(0.2))));
        // The far shore: a low line of hills against the strip.
        const ridge = u.noise(vec2(az.mul(0.33), 0.71)).r.mul(0.011)
            .add(u.noise(vec2(az.mul(1.6), 0.19)).g.mul(0.004))
            .add(0.001);
        const hills = float(1.0).sub(smoothstep(ridge.sub(0.0009), ridge.add(0.0009), el));
        sky.assign(mix(sky, mix(u.haze.mul(0.5), sky, 0.26), hills));

        // ── The cell ──
        const col = vec3(0.0).toVar();
        const trans = float(1.0).toVar();
        const cover = float(0.0).toVar();
        const entry = float(0.0).toVar();
        If(el.greaterThan(0.014), () => {
            const t0 = float(yLo).sub(u.camPos.y).div(el).toVar();
            // Above MARCH_TOP of the slab the cloud is solid: the steps are spent on the lobes.
            const t1 = float(yLo + span * MARCH_TOP).sub(u.camPos.y).div(el).toVar();
            entry.assign(t0);
            If(t0.mul(flat).lessThan(STORM.edge + 900), () => {
                const ds = t1.sub(t0).div(march).toVar();
                // Interleaved gradient noise: a different start per pixel hides the steps.
                const jitter = fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189));
                const lightWay = vec3(LIGHT_WAY[0], LIGHT_WAY[1], LIGHT_WAY[2]);
                // Forward scatter: how nearly this ray looks into the strip's light.
                const toward = smoothstep(0.15, 0.97, dot(ray, lightWay)).mul(0.8).add(0.2).toVar();
                const pixelFlash = vec3(0.0).toVar();
                if (!flashSteps) {
                    const mid = u.camPos.add(ray.mul(t0.add(t1.sub(t0).mul(0.5))));
                    pixelFlash.assign(vsFlashLight(u, mid, 'fp'));
                }
                const sheetAge = u.time.sub(u.sheet.z);
                const sheetFront = max(sheetAge, 0.0).mul(SHEET_SPEED);
                const sheetGain = u.sheet.w.mul(step(0.0, sheetAge)).mul(exp(max(sheetAge, 0.0).mul(-0.85)));
                Loop(march, ({ i }) => {
                    const t = t0.add(ds.mul(float(i).add(jitter)));
                    const p = u.camPos.add(ray.mul(t)).toVar();
                    const w = plan(p).toVar();
                    const slow = u.noiseLod(w.div(STORM.coverTile), 0).r.toVar();
                    const out = length(p.xz).add(slow.sub(0.5).mul(1500.0));
                    // The cell ends: beyond its edge the clear strip shows.
                    const inCell = float(1.0).sub(smoothstep(STORM.edge - EDGE_BAND, STORM.edge, out));
                    const field = lobeField(p, slow, w).toVar();
                    const coarse = clamp(field.mul(4.2), 0.0, 1.0).toVar();
                    const d = coarse.mul(inCell).toVar();
                    If(field.greaterThan(detail ? -0.12 : 0.001).and(inCell.greaterThan(0.002)), () => {
                        const h = height(p).toVar();
                        if (detail) {
                            // Smaller billows ride on the lobes and fray their edges.
                            const e = u.cloudNoise(noisePoint(p, w).mul(3.7)
                                .add(vec3(0.31, u.churn.mul(0.045).add(0.17), 0.53)));
                            const billow = e.g.sub(0.56).mul(float(0.26).sub(h.mul(0.14)));
                            d.assign(clamp(field.add(billow).mul(6.5), 0.0, 1.0).mul(inCell));
                        }
                        // How low it hangs: 1 at a lobe's tip, 0 in the recesses and deep inside.
                        const lowness = float(1.0).sub(smoothstep(0.0, 0.36, h)).toVar();
                        // The strip's light reaches in under the cell from its edge: the far cloud
                        // is lit, the cloud overhead is not, and what hangs low in between stands
                        // dark against the lit cloud behind it.
                        const reachOut = smoothstep(150.0, STORM.edge, length(p.xz));
                        const lightIn = reachOut.mul(reachOut.mul(0.6).add(0.4));
                        let lit = float(0.6);
                        let facing = float(0.5);
                        if (detail) {
                            const p1 = p.add(lightWay.mul(LIGHT_NEAR));
                            const p2 = p.add(lightWay.mul(LIGHT_FAR));
                            const near1 = lobes(p1, slow, plan(p1));
                            const near2 = lobes(p2, slow, plan(p2));
                            lit = exp(near1.mul(0.9).add(near2.mul(1.8)).negate());
                            // Thinner toward the light than here: this side of the lobe faces it.
                            facing = clamp(coarse.sub(near1).mul(1.2).add(0.5), 0.0, 1.0);
                        }
                        const body = u.cloud.mul(lowness.mul(0.9).add(0.45));
                        const key = u.rim.mul(lightIn.mul(0.78).add(0.13)).mul(lit.mul(0.7).add(0.3))
                            .mul(lowness.mul(0.55).add(0.45))
                            .mul(lobe.mul(1.1).add(0.42))
                            .mul(facing.mul(0.8).add(0.6));
                        // A little of it comes THROUGH a lobe's thin edge, looking toward the strip.
                        const thin = float(1.0).sub(smoothstep(0.06, 0.62, d));
                        const silver = u.rim.mul(lit).mul(thin).mul(toward).mul(lightIn)
                            .mul(0.8);
                        const own = body.add(key).add(silver).mul(u.breath.mul(0.6).add(0.4));
                        // A stroke burns deep in the slab: what hangs in front of it is its shadow.
                        const deep = smoothstep(0.06, 0.4, h);
                        const depth = deep.mul(deep).mul(0.94).add(0.06);
                        const struck = (flashSteps ? vsFlashLight(u, p, 'fs') : pixelFlash).toVar();
                        // A soft ceiling: right beside a stroke the cloud glows, it does not blank out.
                        const flash = struck.mul(depth).div(max(struck.x, max(struck.y, struck.z)).mul(0.4).add(1.0));
                        const fromSheet = length(p.xz.sub(u.sheet.xy)).sub(sheetFront).div(260.0);
                        const sheetBand = exp(fromSheet.mul(fromSheet).negate()).mul(sheetGain);
                        const sheet = u.flash.mul(sheetBand.mul(depth).mul(1.5));
                        const a = float(1.0).sub(exp(d.mul(ds).div(-EXTINCTION)));
                        col.addAssign(own.add(flash).add(sheet).mul(trans).mul(a));
                        trans.mulAssign(float(1.0).sub(a));
                    });
                });
                // What is left of the ray ends in the cell's dark heart (lit, deep inside, by a
                // stroke) or, past the cell's edge, in the clear sky.
                const exit = u.camPos.add(ray.mul(float(yHi).sub(u.camPos.y).div(el)));
                cover.assign(float(1.0).sub(smoothstep(STORM.edge - EDGE_BAND, STORM.edge + 250, length(exit.xz))));
                const heart = u.cloud.mul(0.3).mul(u.breath.mul(0.6).add(0.4))
                    .add((flashSteps ? vsFlashLight(u, exit, 'fe') : pixelFlash).mul(0.45));
                col.addAssign(mix(sky, heart, cover).mul(trans));
            }).Else(() => {
                col.assign(sky);
            });
        }).Else(() => {
            col.assign(sky);
        });

        // Distance and rain take the far cloud toward the haze.
        const veiled = float(1.0).sub(exp(entry.div(-7000.0))).mul(cover).mul(0.75);
        col.assign(mix(col, u.haze, veiled));
        if (!u.floatSky) return vec4(sqrt(clamp(col.div(SKY_CODE_PEAK), 0.0, 1.0)), 1.0);
        return vec4(col, 1.0);
    });

    const material = vsPassMaterial('VoltageStormSkyPass', paint());
    const quad = new THREE.QuadMesh(material);
    quad.name = 'VoltageStormSkyPass';
    let target = vsTarget(4, 4, 'voltage-storm-sky', u.floatSky);
    u.skyTex.value = target.texture;

    // The backdrop: the target, stretched over the frame behind everything.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const backdrop = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    backdrop.name = 'VoltageStormBackdrop';
    backdrop.fog = false;
    backdrop.vertexNode = vec4(positionGeometry.xy, 1.0, 1.0);
    backdrop.colorNode = vec4(u.skyAt(screenUV), 1.0);
    const part = vsPart('VoltageStormBackdrop', geometry, backdrop, -100);

    part.pass = { quad, material };
    /** Size the target for a drawing buffer and a tier's scale. Returns true if it was rebuilt. */
    part.resize = (bufferWidth, bufferHeight, scale) => {
        const w = Math.max(2, Math.round(bufferWidth * scale));
        const h = Math.max(2, Math.round(bufferHeight * scale));
        if (target.width === w && target.height === h) return false;
        target.dispose();
        target = vsTarget(w, h, 'voltage-storm-sky', u.floatSky);
        u.skyTex.value = target.texture;
        return true;
    };
    /** Paint the sky for this frame (the camera uniforms must be current). */
    part.render = (renderer) => {
        if (!renderer || typeof renderer.setRenderTarget !== 'function') return false;
        const previous = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
        renderer.setRenderTarget(target);
        quad.render(renderer);
        renderer.setRenderTarget(previous);
        return true;
    };
    part.target = () => target;
    part.dispose = () => {
        target.dispose();
        material.dispose();
    };
    part.march = march;
    return part;
}
