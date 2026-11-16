/**
 * Halcyon Apex — the dawn sky.
 *
 * One dome, drawn last among the solids (depth-tested, so it is shaded only where sky shows):
 * the sanctuary's sky function, the sun's disc and its aureole, and two decks of cloud. Each deck
 * is a plane at its own height, met by the view ray, so the clouds lie in true perspective and
 * close up toward the horizon. A cloud is lit from the sun's side (its density is read once more
 * a step toward the sun), thin edges near the sun burn gold, and its far side keeps the dawn's
 * blue.
 *
 * Gameplay: a chain of clears (and play that runs hot) clears the air (the decks thin and
 * brighten); a four-line clear sends a ring of light out over the sky from the Apex, and a second
 * ring (the perfect clear's crown, a back-to-back) opens beside it without cutting the first.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    acos,
    atan,
    cameraPosition,
    clamp,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
} from 'three/tsl';
import {
    haBell, haLuma, haPart, haSkyBase,
} from './halcyon-apex-tsl.js';

/** Radians a second the four-line ring opens across the sky, and how long it lasts. */
export const SHOCK_SPEED = 0.9;
export const SHOCK_LIFE = 2.6;
/** Radians a second a perfect clear's rings of the spectrum open across the sky, and how long they last. */
export const IRIS_SPEED = 0.46;
export const IRIS_LIFE = 4.6;
/** The giant that hangs in the dawn: its radius (radians), and how far out its rings reach (radii). */
export const PLANET_RADIUS = 0.074;
export const PLANET_RING = 2.3;

/**
 * @param {object} u  shared sanctuary uniforms
 * @param {object} [opts]
 * @param {number} [opts.decks=2]      cloud decks drawn (0 = clear sky, 1 = the low banks only)
 * @param {boolean} [opts.lit=true]    a deck's light costs one more fetch
 * @param {boolean} [opts.planet=true] the ringed giant low in the dawn
 */
export function createSky(u, opts = {}) {
    const decks = opts.decks ?? 2;
    const litClouds = opts.lit !== false;
    const planet = opts.planet !== false;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HalcyonApexSky';
    material.fog = false;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = true;

    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const up = max(dir.y, 0.0).toVar();
        const cs = dot(dir, u.sunDir).toVar();
        const toward = max(cs, 0.0);
        const col = haSkyBase(u, dir).toVar();

        // ── A world in the dawn: a pale ringed giant low over the ranges, a limb of it lit toward
        //    the sun. By day it is little more than a paler disc of sky; as the hour darkens it
        //    stands out with the stars. Drawn before the clouds, which pass in front of it. (No
        //    derivative and no texture inside the branch: it is taken per pixel.) ──
        /** How much of the sky behind a pixel the giant covers (the stars go out behind it). */
        const globe = float(0.0).toVar();
        if (planet) {
            If(dot(dir, u.planetDir).greaterThan(u.planet.y), () => {
                const px = dot(dir, u.planetRight).div(u.planet.x).toVar();
                const py = dot(dir, u.planetUp).div(u.planet.x).toVar();
                const r2 = px.mul(px).add(py.mul(py)).toVar();
                const disc = float(1.0).sub(smoothstep(0.972, 1.0, r2.sqrt())).toVar();
                const nz = max(float(1.0).sub(r2), 0.0).sqrt();
                const lit = smoothstep(-0.1, 0.34, px.mul(u.planetSun.x).add(py.mul(u.planetSun.y)).add(nz.mul(u.planetSun.z)));
                // Its bands and its rings share a tilt.
                const ct = u.planet.w.cos();
                const st = u.planet.w.sin();
                const bx = px.mul(ct).add(py.mul(st)).toVar();
                const by = py.mul(ct).sub(px.mul(st)).toVar();
                const band = by.mul(7.0).add(bx.mul(1.3)).sin().mul(0.6)
                    .add(by.mul(19.0).sin().mul(0.4))
                    .mul(0.11)
                    .add(0.89);
                const pale = mix(u.cloud, vec3(1.0, 0.95, 0.88), 0.35).toVar();
                const body = mix(col.mul(0.93), pale.mul(band).mul(nz.mul(0.35).add(0.75)), lit.mul(0.92));
                col.assign(mix(col, body, disc.mul(u.planet.z)));
                globe.assign(disc);
                // The rings: a flat disc seen nearly edge on, a gap in it, the far half behind the globe.
                const ry = by.div(0.21);
                const rr = bx.mul(bx).add(ry.mul(ry)).sqrt().toVar();
                const ring = smoothstep(1.36, 1.42, rr).mul(float(1.0).sub(smoothstep(PLANET_RING - 0.1, PLANET_RING, rr)))
                    .mul(float(1.0).sub(smoothstep(1.7, 1.74, rr).mul(float(1.0).sub(smoothstep(1.8, 1.84, rr))).mul(0.85)))
                    .mul(rr.mul(31.0).sin().mul(0.18).add(0.82));
                const behind = disc.mul(step(0.0, by));
                // The globe's shadow lies across the rings on the side away from the sun.
                const shade = float(1.0).sub(smoothstep(0.2, -0.5, bx.mul(u.planetSun.x).add(by.mul(u.planetSun.y))).mul(float(1.0).sub(smoothstep(0.9, 1.5, abs(by.mul(1.6))))).mul(0.7));
                col.addAssign(pale.mul(ring).mul(float(1.0).sub(behind)).mul(shade).mul(u.planet.z)
                    .mul(0.34));
            });
        }

        // ── The sun: a disc, a hot rim of air round it ──
        const edge = u.sunSize.cos();
        const disc = smoothstep(edge.sub(0.00012), edge.add(0.00004), cs);
        const t16 = toward.pow(16.0);
        const aureole = t16.pow(40.0).mul(0.5).add(t16.pow(6.0).mul(0.085));
        const sunLight = u.sun.mul(disc.mul(5.0).add(aureole)).mul(u.breath).toVar();

        // ── Clouds ──
        const sunFlat = normalize(vec2(u.sunDir.x, u.sunDir.z));
        const veil = float(0.0).toVar();
        const clearing = u.power.mul(0.16);
        if (decks >= 2) {
            // High streaks, combed by the wind: they take the dawn's colour whole.
            const hv = dir.xz.div(up.add(0.11));
            const sv = vec2(hv.x.mul(0.86).add(hv.y.mul(0.5)), hv.y.mul(0.86).sub(hv.x.mul(0.5)));
            const s1 = u.noise(vec2(sv.x.mul(0.11), sv.y.mul(0.5)).add(vec2(u.cloudDrift.mul(0.0011), 0.0))).b;
            const s2 = u.noise(vec2(sv.x.mul(0.31), sv.y.mul(1.3)).add(vec2(u.cloudDrift.mul(0.0019), 0.3))).g;
            const streak = smoothstep(float(0.5).add(clearing), 0.82, s1.mul(0.72).add(s2.mul(0.28))).mul(smoothstep(0.03, 0.22, up));
            const high = mix(u.cloud, u.glow.mul(1.5).add(u.cloud), toward.pow(5.0).mul(0.7)).mul(toward.mul(0.5).add(0.62));
            col.assign(mix(col, high, streak.mul(0.5)));
            veil.addAssign(streak.mul(0.35));
        }
        if (decks >= 1) {
            // Low banks standing on the horizon.
            const lv = dir.xz.div(up.add(0.045)).toVar();
            const drift = vec2(u.cloudDrift.mul(0.0016), u.cloudDrift.mul(0.0006));
            const at = (q) => u.noise(q.mul(0.24).add(drift)).r.mul(0.62).add(u.noise(q.mul(0.83).add(drift.mul(2.3))).g.mul(0.38));
            const here = at(lv).toVar();
            const cover = float(0.49).add(clearing);
            const mass = smoothstep(cover, cover.add(0.2), here).toVar();
            // The banks stand low: they thin out overhead and sink into the haze at the horizon.
            const band = smoothstep(0.0, 0.05, up).mul(float(1.0).sub(smoothstep(0.2, 0.5, up)));
            const opacity = mass.mul(band).toVar();
            const bank = u.cloud.toVar();
            if (litClouds) {
                const sunward = at(lv.add(sunFlat.mul(0.3)));
                const facing = clamp(here.sub(sunward).mul(5.5).add(0.5), 0.0, 1.0);
                bank.assign(mix(u.cloudShade, u.cloud.mul(1.2), facing));
            } else {
                bank.assign(mix(u.cloudShade, u.cloud, 0.6));
            }
            // Thin edges toward the sun burn.
            const lining = float(1.0).sub(mass).mul(mass).mul(4.0)
                .mul(toward.pow(7.0));
            const lowCol = bank.mul(toward.mul(0.35).add(0.8)).add(u.glow.mul(lining).mul(1.6)).mul(u.breath.mul(0.4).add(0.6));
            // Distance hazes a bank toward the sky it stands in.
            col.assign(mix(col, mix(lowCol, col, exp(up.mul(-16.0)).mul(0.75)), opacity.mul(0.92)));
            veil.addAssign(opacity);
        }
        // The sun burns through thin cloud, not through a bank.
        col.addAssign(sunLight.mul(float(1.0).sub(clamp(veil, 0.0, 1.0).mul(0.8))));

        // ── Stars, where the hour's zenith is dark enough to show them (the blue hour) ──
        // One star at most in each cell of a 3D lattice of directions: round everywhere on the
        // dome, no seam. They come out overhead first and sink into the glow toward the sun.
        const dark = float(1.0).sub(smoothstep(0.035, 0.075, haLuma(u.zenith))).toVar();
        const starLayer = (scale, gain) => {
            const q = dir.mul(scale);
            const cell = floor(q);
            const h = vec3(
                fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))).mul(43758.5453)),
                fract(sin(dot(cell, vec3(269.5, 183.3, 246.1))).mul(43758.5453)),
                fract(sin(dot(cell, vec3(113.5, 271.9, 124.6))).mul(43758.5453)),
            ).toVar();
            const at = normalize(cell.add(h.mul(0.56).add(0.22)));
            const off = length(dir.sub(at)).mul(scale);
            // Never under a pixel: a sub-pixel star would shimmer as the camera breathes.
            const px = length(fwidth(dir)).mul(scale);
            const r = max(float(0.09), px.mul(0.7));
            const core = exp(off.mul(off).div(r.mul(r)).negate()).mul(float(0.09).div(r).pow(2.0));
            const mag = h.y.pow(6.0).mul(smoothstep(0.35, 0.5, h.x));
            const twinkle = sin(u.time.mul(h.z.mul(2.0).add(0.8)).add(h.x.mul(30.0))).mul(0.25).add(0.75);
            const tint = mix(vec3(1.0, 0.86, 0.74), vec3(0.76, 0.86, 1.0), h.z);
            return tint.mul(core.mul(mag).mul(twinkle).mul(gain));
        };
        // Skipped outright in the bright hours: a zero gain is not free.
        If(dark.greaterThan(0.01), () => {
            const stars = starLayer(60.0, 2.4).add(starLayer(140.0, 0.8));
            const overhead = smoothstep(0.06, 0.35, up).mul(float(1.0).sub(toward.pow(4.0).mul(0.9)));
            col.addAssign(stars.mul(dark).mul(overhead).mul(float(1.0).sub(clamp(veil.add(globe), 0.0, 1.0)))
                .mul(u.breath));
        });

        // ── A four-line clear: a ring of light opens over the sky from the Apex. Two of them, so
        //    a second one (a perfect clear's crown, a back-to-back, a level) opens beside the
        //    first instead of pulling it back to the Apex ──
        const toApex = normalize(u.apexPos.sub(cameraPosition));
        const angle = acos(clamp(dot(dir, toApex), -1.0, 1.0));
        const shockRing = (birth, strength) => {
            const age = u.time.sub(birth);
            const front = age.mul(SHOCK_SPEED);
            const live = step(0.0, age).mul(strength);
            const ringLight = haBell(angle.sub(front).div(float(0.035).add(front.mul(0.05)))).mul(exp(age.mul(-1.5)));
            const wash = float(1.0).sub(smoothstep(0.0, 0.4, angle.sub(front).abs())).mul(exp(age.mul(-2.2)));
            return ringLight.mul(2.2).add(wash.mul(0.07)).mul(live);
        };
        const rings = shockRing(u.shock.x, u.shock.y).add(shockRing(u.shock.z, u.shock.w));
        col.addAssign(mix(u.ley, vec3(1.0, 0.92, 0.78), 0.55).mul(rings));

        // ── A perfect clear's crown: rings of the spectrum open from the Apex, each colour a step
        //    behind the last, and a glory of rays stands round the crystal. Skipped outright at rest. ──
        const irisAge = u.time.sub(u.iris.x).toVar();
        If(irisAge.greaterThan(0.0).and(irisAge.lessThan(IRIS_LIFE)).and(u.iris.y.greaterThan(0.001)), () => {
            const env = exp(irisAge.mul(-0.7)).mul(smoothstep(0.0, 0.12, irisAge))
                .mul(float(1.0).sub(smoothstep(IRIS_LIFE - 0.9, IRIS_LIFE, irisAge)))
                .mul(u.iris.y);
            const spectrumRing = (front, gain) => {
                const width = float(0.02).add(front.mul(0.034));
                const at = (lag) => haBell(angle.sub(front.sub(lag)).div(width));
                return vec3(at(0.0), at(width.mul(0.9)), at(width.mul(1.8))).mul(gain);
            };
            const front = irisAge.mul(IRIS_SPEED);
            const spectra = spectrumRing(front, 1.5).add(spectrumRing(front.mul(0.64), 1.0)).add(spectrumRing(front.mul(0.36), 0.7));
            const e1 = normalize(cross(toApex, vec3(0.0, 1.0, 0.0)));
            const e2 = cross(e1, toApex);
            const phi = atan(dot(dir, e2), dot(dir, e1));
            const coarse = phi.mul(9.0).add(irisAge.mul(0.45)).cos().mul(0.5)
                .add(0.5);
            const fine = phi.mul(23.0).sub(irisAge.mul(0.7)).cos().mul(0.5)
                .add(0.5);
            const c2 = coarse.mul(coarse);
            const f2 = fine.mul(fine);
            const rays = c2.mul(c2).mul(c2).add(f2.mul(f2).mul(f2).mul(f2).mul(0.5));
            const glory = rays.mul(exp(angle.mul(-5.0))).mul(smoothstep(0.03, 0.1, angle)).mul(0.75);
            col.addAssign(spectra.add(mix(u.ley, vec3(1.0, 0.9, 0.72), 0.6).mul(glory)).mul(env));
        });
        // (The overdrive no longer lifts the whole dawn: a four-line clear's light is its pillars'
        // and its rings', so the sky keeps its depth at the payoff.)
        return col;
    })();

    const geometry = new THREE.SphereGeometry(9000, 48, 24);
    const part = haPart('HalcyonApexSky', geometry, material, -10);
    return part;
}
