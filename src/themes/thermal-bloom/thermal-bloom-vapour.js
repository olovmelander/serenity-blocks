/**
 * Thermal Bloom — the vapour: the basin's near steam as a ray-marched volume.
 *
 * A post pass (the Moonlit Greenhouse pattern, SKILL.md "a post pass that walks the scene's
 * depth"): on a reduced target, each pixel's ray runs from the eye to the scene's depth through
 * the steam BODIES the world writes every frame (VAPOUR_SLOTS of them, three rows each, see
 * thermal-bloom-core.js): the Iris's dome, the Chalice's thread, a lock's boil-over, a hard
 * drop's jet, the chain's ladder of vents, the steam phases, the devils, the spray of the
 * eruptions. The world writes them near to far; each is marched over its own box only (so a
 * small puff beside the card gets as many steps as the dome behind it) and composited front to
 * back, and the march stops once nothing behind can show.
 *
 * Each body is an analytic envelope (a column widening as it rises and leaning downwind, a dome's
 * shell, a swelling ball, a spinning column, a cloud of drops) carved by a baked 3D billow noise
 * (thermal-bloom-bake.js bakeVapourNoise) that climbs with the steam — or falls, for drops — so
 * its edges are round lobes, not a fog with a border. Light: the sun through one tap of the
 * body toward it (its billows' relief) and an envelope tap further on (its bulk: the far flank
 * in shade), with a multiple-scattering floor so a dense core is never black; the sky above and
 * the warm sinter below; and the light each body takes from beneath — the Iris's turquoise over
 * its water and apricot over its mats, a lock's piece colour, the chain's heat. Drops scatter
 * forward and carry the bow. Aerial perspective per body, as everywhere.
 *
 * The result (rgb the light the steam sends to the eye, a the share of the scene behind that
 * comes through) is brought to full resolution with a joint bilateral upsample on the scene's
 * depth, so steam never bleeds onto the edge of the Stair or a pine in front of it.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    abs,
    atan,
    clamp,
    dot,
    exp,
    float,
    floor,
    getViewPosition,
    int,
    interleavedGradientNoise,
    length,
    max,
    min,
    mix,
    normalize,
    rtt,
    screenCoordinate,
    sin,
    cos,
    smoothstep,
    step,
    texture3D,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    IRIS_RADIUS,
    VAPOUR_CODE,
    VAPOUR_KIND,
    VAPOUR_ROWS_PER,
    tbAerial,
    tbBow,
    tbCloudShade,
    tbGustBand,
    tbHgMix,
    tbLuma,
} from './thermal-bloom-tsl.js';

/** Optical density of steam per unit of body density per metre. */
const SIGMA = 0.11;
/** The morning mist: the top of its layer (metres), its density, its scale height. */
const MIST_TOP = 14;
const MIST_DENSITY = 0.011;
const MIST_FALL = 4.5;
/** How fast a spray's drops fall (m/s); every other body climbs at its own speed (its row). */
const FALL = 7.5;
/** How fast a plume's billows evolve: its read's slide through the noise volume (billow units a second). */
const EVOLVE = 0.22;

/** The vapour's 3D noise as a tileable, linearly filtered volume (RGBA8: filterable everywhere). */
export function createVapourTexture(data, size) {
    const tex = new THREE.Data3DTexture(data, size, size, size);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.wrapR = THREE.RepeatWrapping;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.unpackAlignment = 1;
    tex.name = 'thermal-bloom-vapour';
    tex.needsUpdate = true;
    return tex;
}

/**
 * The march, on a reduced target.
 * @param {object} q
 * @param {object} q.u            the world's uniforms (with u.vapour / u.vapourCount)
 * @param {THREE.Data3DTexture} q.noise  the vapour's 3D noise
 * @param {object} q.depth        the scene pass's depth texture node
 * @param {object} q.projInv      uniform: the scene camera's projectionMatrixInverse
 * @param {object} q.camWorld     uniform: the scene camera's matrixWorld
 * @param {{ steps: number, scale: number, detail: boolean }} q.look  the tier's march
 * @returns {object} an RTT node: rgb light, a transmittance
 */
export function createVapourMarch({
    u, noise, depth, projInv, camWorld, look,
}) {
    const steps = Math.max(4, Math.round(look.steps));
    const n3 = (p) => texture3D(noise, p).level(0);

    const march = Fn(() => {
        const st = uv();
        const z = depth.sample(st).x;
        const view = getViewPosition(st, z, projInv);
        const wp = camWorld.mul(vec4(view, 1.0)).xyz;
        const eye = u.camPos;
        const toward = wp.sub(eye);
        const sceneT = length(toward).toVar();
        const dir = toward.div(max(sceneT, 1e-3)).toVar();
        // A ray along an axis divides by zero in the box test: nudge it a hair off.
        const inv = vec3(1.0).div(dir.add(vec3(1e-6, 1e-6, 1e-6).mul(step(abs(dir), vec3(1e-6))))).toVar();
        const jitter = interleavedGradientNoise(screenCoordinate.xy).toVar();
        const light = vec3(0.0).toVar();
        const through = float(1.0).toVar();
        const t = u.time;

        // The sun stands behind the camera's shoulder: we see the steam's back-scatter (a broad
        // lobe), and a faint forward lobe where a ray looks across toward the sun's side.
        const cosSun = dot(dir, u.sunDir);
        const away = clamp(cosSun.negate(), 0.0, 1.0);
        // (and a strong forward lobe: where the view looks toward the low sun the steam's thin edges
        // light up, a silver lining round every billow)
        const phase = float(0.72).add(away.mul(away).mul(0.25)).add(tbHgMix(cosSun, float(0.68)).mul(1.6)).toVar();
        // Drops scatter mostly forward and hold the bow round the antisolar point.
        const bow = tbBow(dot(dir.negate(), u.sunDir)).toVar();
        const skyAmb = mix(u.haze, u.zenith, 0.55).mul(0.5).toVar();
        const groundAmb = vec3(0.62, 0.56, 0.46).mul(u.sunColor).mul(max(u.sunDir.y, 0.0).mul(0.42)).toVar();
        // The sun on steam: its colour a little softened (droplets scatter every colour alike; at
        // full warmth the bright billows read cream, not white).
        const sunSteam = mix(vec3(tbLuma(u.sunColor)), u.sunColor, 0.7).toVar();
        const shade = vec3(0.34, 0.43, 0.56).toVar();

        Loop({
            start: int(0), end: u.vapourCount, type: 'int', condition: '<', name: 'vb',
        }, ({ vb }) => {
            const A = u.vapour.element(vb.mul(VAPOUR_ROWS_PER)).toVar();
            const B = u.vapour.element(vb.mul(VAPOUR_ROWS_PER).add(1)).toVar();
            const C = u.vapour.element(vb.mul(VAPOUR_ROWS_PER).add(2)).toVar();
            const code = floor(C.w.add(0.5));
            const seed = floor(code.div(VAPOUR_CODE.seed));
            const kind = code.sub(seed.mul(VAPOUR_CODE.seed));
            const isKind = (k) => step(abs(kind.sub(k)), 0.5);
            const isDome = isKind(VAPOUR_KIND.dome).toVar();
            const isPuff = isKind(VAPOUR_KIND.puff).toVar();
            const isDevil = isKind(VAPOUR_KIND.devil).toVar();
            const isSpray = isKind(VAPOUR_KIND.spray).toVar();
            const H = max(A.w, 0.5).toVar();
            const rMax = max(B.x, B.y).toVar();
            // The axis: where it stands (offsets from the foot) at the heights f = k / 6, written
            // by the world. A plume's bends with the wind's history (its puffs drifted with every
            // wind they met since they left the vent, so a change bends it from the bottom up);
            // any other body leans as one. A gust's front tears whatever it reaches thinner.
            const D1 = u.vapour.element(vb.mul(VAPOUR_ROWS_PER).add(3)).toVar();
            const D2 = u.vapour.element(vb.mul(VAPOUR_ROWS_PER).add(4)).toVar();
            const D3 = u.vapour.element(vb.mul(VAPOUR_ROWS_PER).add(5)).toVar();
            const nodes = [D1.xy, D1.zw, D2.xy, D2.zw, D3.xy, D3.zw];
            const gustHere = tbGustBand(u, A.xz).toVar();
            let dLo = vec2(0.0, 0.0);
            let dHi = vec2(0.0, 0.0);
            nodes.forEach((n) => {
                dLo = min(dLo, n);
                dHi = max(dHi, n);
            });
            const lo = vec3(A.x.add(dLo.x).sub(rMax), A.y, A.z.add(dLo.y).sub(rMax));
            const hi = vec3(A.x.add(dHi.x).add(rMax), A.y.add(H), A.z.add(dHi.y).add(rMax));
            /** The axis's offset at a height fraction f: through the nodes, piecewise linear. */
            const driftAt = (f) => {
                const x = f.mul(nodes.length);
                let sum = vec2(0.0, 0.0);
                nodes.forEach((n, k) => {
                    sum = sum.add(n.mul(max(float(1.0).sub(abs(x.sub(k + 1))), 0.0)));
                });
                return sum;
            };
            const t0 = lo.sub(eye).mul(inv);
            const t1 = hi.sub(eye).mul(inv);
            const tIn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z));
            const tOut = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
            const a = max(tIn, 0.0).toVar();
            const b = min(tOut, sceneT).toVar();
            If(b.greaterThan(a).and(through.greaterThan(0.02)), () => {
                // The billows' size follows the body (a 3 m puff is not made of 25 m billows).
                const scale = clamp(mix(B.x, B.y, 0.5).mul(0.85), 2.5, 26.0).toVar();
                const ofs = vec3(seed.mul(0.137), seed.mul(0.291), seed.mul(0.073)).toVar();
                // Billows climb at the body's own speed (a far column's with its puffs; drops fall).
                const climb = mix(B.w, float(-FALL), isSpray).mul(t).div(scale).toVar();
                const spin = t.mul(mix(float(0.0), float(1.4), isDevil)).toVar();
                // A plume's billows evolve as they climb: its read slides slowly through the noise
                // volume along the line of sight, so each billow swells, splits and merges in place
                // (a slide across the view would read as drift, a warp shears the lobes).
                const isPlume = isKind(VAPOUR_KIND.plume).toVar();
                const sight = normalize(A.xz.sub(eye.xz).add(vec2(1e-3, 0.0)));
                const evolve = vec3(sight.x, 0.0, sight.y).mul(t.mul(EVOLVE).mul(isPlume)).toVar();

                /** The body's envelope at a point (0..1) and where its billows are read. */
                const body = (p) => {
                    const h = p.y.sub(A.y);
                    const f = clamp(h.div(H), 0.0, 1.0);
                    const axis = A.xz.add(driftAt(f));
                    const R = max(mix(B.x, B.y, f.pow(0.7)), 0.3);
                    const rel = p.xz.sub(axis);
                    const d = length(rel);
                    const qd = d.div(R);
                    // A column (plume, devil, spray): a stem widening upward, thin where it leaves
                    // its vent, fading out over its top third.
                    const column = float(1.0).sub(smoothstep(0.4, 1.0, qd))
                        .mul(smoothstep(0.0, 0.1, f)).mul(float(1.0).sub(smoothstep(0.58, 1.0, f)));
                    // The dome: a heap narrowing as it rises, densest in its skin.
                    const eDome = length(vec2(d.div(R.mul(float(1.0).sub(f.mul(0.35)))), f));
                    const dome = float(1.0).sub(smoothstep(0.78, 1.0, eDome))
                        .mul(smoothstep(0.25, 0.8, eDome).mul(0.65).add(0.35))
                        .mul(smoothstep(0.06, 0.32, f));
                    // A puff: a ball standing on its foot, a little taller than wide.
                    const ePuff = length(vec2(qd, f.mul(2.0).sub(1.0)));
                    const puff = float(1.0).sub(smoothstep(0.45, 1.0, ePuff));
                    // A devil: a spun tube, its core clear (the vortex throws the steam outward),
                    // its wall wound into two bands that climb it as it turns.
                    const theta = atan(rel.y, rel.x);
                    const wind = theta.mul(2.0).add(h.mul(0.38)).sub(t.mul(4.5)).add(seed);
                    const helix = smoothstep(-0.35, 0.75, sin(wind));
                    const wall = smoothstep(0.06, 0.5, qd).mul(0.8).add(0.2);
                    const devil = column.mul(wall).mul(helix.mul(0.75).add(0.25));
                    const crown = mix(float(1.0), smoothstep(0.1, 0.65, f).mul(0.8).add(0.2), isSpray);
                    const env = mix(mix(mix(column, devil, isDevil), dome, isDome), puff, isPuff).mul(crown);
                    // Where the billows are read: climbing (falling, for drops), turned about the
                    // axis for a devil, and anchored to a puff so its lobes swell with it.
                    const ang = spin.add(h.mul(0.2).mul(isDevil));
                    const ca = cos(ang);
                    const sa = sin(ang);
                    const twisted = vec2(rel.x.mul(ca).sub(rel.y.mul(sa)), rel.x.mul(sa).add(rel.y.mul(ca)));
                    const local = vec3(twisted.x, h.div(mix(float(1.0), float(3.0), isDevil)), twisted.y).div(scale);
                    const q = local.add(ofs).sub(vec3(0.0, climb, 0.0)).add(evolve);
                    return {
                        env, q, f, h,
                    };
                };

                const span = b.sub(a).toVar();
                const dt = span.div(steps).toVar();
                const tt = a.add(dt.mul(jitter)).toVar();
                const bodyLight = vec3(0.0).toVar();
                const bodyThrough = float(1.0).toVar();
                const reach = rMax.mul(0.35).toVar();
                // The drifting cumulus shade a column as they shade the floor (read once, mid-body).
                const cloudLit = tbCloudShade(u, vec3(A.x, A.y.add(H.mul(0.4)), A.z)).toVar();
                Loop(steps, () => {
                    const p = eye.add(dir.mul(tt)).toVar();
                    const raw = body(p);
                    const s = {
                        env: raw.env.toVar(), q: raw.q.toVar(), f: raw.f.toVar(), h: raw.h.toVar(),
                    };
                    If(s.env.greaterThan(0.002), () => {
                        const nz = n3(s.q.mul(0.25)).toVar();
                        let billow = nz.x;
                        // The edges tear into wisps: finer cells erode the billows, most toward
                        // the body's edge (its core stays whole).
                        const fine = n3(s.q.mul(0.83).add(vec3(0.0, climb.mul(0.4), 0.0))).y;
                        let erosion = fine;
                        if (look.detail) {
                            const finer = n3(s.q.mul(2.3).add(vec3(0.37, climb.mul(0.9), 0.61))).y;
                            erosion = fine.mul(0.6).add(finer.mul(0.4));
                        }
                        const erode = mix(float(0.6), float(0.22), s.env);
                        billow = billow.sub(float(1.0).sub(billow).mul(erosion).mul(erode));
                        // Coverage remap: in the core the billows fill in; toward the edge only
                        // their tops survive, as round lobes.
                        const env = s.env.mul(nz.z.mul(0.5).add(0.75));
                        const dens = clamp(billow.sub(float(1.0).sub(env)).div(max(env, 0.12)), 0.0, 1.0)
                            .mul(B.z).toVar();
                        dens.mulAssign(float(1.0).sub(gustHere.mul(0.3)));
                        // The gust's clear lane through the Iris's dome.
                        const across = vec2(u.windDir.y.negate(), u.windDir.x);
                        const laneAt = mix(float(-1.6), float(1.6), clamp(u.gust.x, 0.0, 1.0)).mul(IRIS_RADIUS);
                        const lane = dot(p.xz.sub(A.xz), across).sub(laneAt).div(IRIS_RADIUS * 0.4);
                        const laneClear = exp(lane.mul(lane).negate()).mul(step(0.0, u.gust.x)).mul(isDome);
                        dens.mulAssign(float(1.0).sub(laneClear.mul(0.92)));
                        // Looked down on steeply (the upright phone's high camera) the dome is only
                        // a veil: from above, the eye must read through it.
                        dens.mulAssign(float(1.0).sub(smoothstep(0.32, 0.55, dir.y.negate()).mul(isDome).mul(0.85)));
                        // Over the deep water the dome is only wisps: the eye shows through it.
                        const fromEye = length(p.xz.sub(u.irisCentre)).div(IRIS_RADIUS);
                        const overEye = float(1.0).sub(smoothstep(0.45, 0.9, fromEye));
                        const lowOver = float(1.0).sub(smoothstep(22.0, 55.0, s.h));
                        dens.mulAssign(float(1.0).sub(overEye.mul(isDome).mul(lowOver)));
                        If(dens.greaterThan(0.002), () => {
                            // Toward the sun: one tap through the billows, one through the bulk.
                            const pn = p.add(u.sunDir.mul(reach));
                            const sn = body(pn);
                            const nearB = n3(sn.q.mul(0.25)).x.sub(float(1.0).sub(sn.env));
                            const near = clamp(nearB.div(max(sn.env, 0.12)), 0.0, 1.0);
                            const far = body(p.add(u.sunDir.mul(reach.mul(2.6)))).env;
                            // (a strong self-shadow: a plume shows a lit flank and a shade flank)
                            const tau = near.mul(reach).add(far.mul(reach.mul(1.6))).mul(B.z).mul(SIGMA * 2.8);
                            const sunT = max(exp(tau.negate()), exp(tau.mul(-0.18)).mul(0.16));
                            // The light from below: the Iris's water and mats under its dome, the
                            // body's own colour (a lock's piece, the chain's heat) under the rest:
                            // only its foot, where the coloured water lights it (steam is white).
                            const rr = length(p.xz.sub(u.irisCentre)).div(IRIS_RADIUS);
                            const waterMats = smoothstep(0.8, 1.15, rr);
                            const domeUnder = mix(vec3(0.05, 0.5, 0.62), vec3(0.95, 0.45, 0.14), waterMats)
                                .mul(exp(s.h.div(-26.0))).mul(0.85);
                            const foot = float(1.0).sub(smoothstep(0.0, 0.26, s.f));
                            const footFall = exp(s.h.div(max(H.mul(0.12), 1.0)).negate()).mul(0.6).add(0.4);
                            const ownUnder = C.xyz.mul(foot.mul(foot)).mul(footFall);
                            const under = mix(ownUnder, domeUnder, isDome);
                            // A body lit from below by colour (a lock's piece) glows in it through
                            // its lower part even where the sun reaches it.
                            const cMax = max(max(C.x, C.y), max(C.z, 1e-3));
                            const ownTint = C.xyz.div(cMax);
                            const tintAmt = clamp(cMax.mul(0.45), 0.0, 0.7).mul(foot)
                                .mul(float(1.0).sub(isDome));
                            const sunLit = sunSteam.mul(sunT.mul(cloudLit)).mul(phase)
                                .mul(mix(float(1.05), float(1.2), isSpray))
                                .mul(mix(vec3(1.0), ownTint, tintAmt));
                            const amb = mix(groundAmb, skyAmb, s.f.mul(0.7).add(0.3));
                            // Drops: whiter, with the bow in them (only while the eruption lights it).
                            // (only where the spray is dense: a bow never floats in thin air)
                            const bowLight = bow.xyz.mul(u.bow).mul(sunT).mul(isSpray).mul(0.45)
                                .mul(smoothstep(0.12, 0.5, dens));
                            const col = sunLit.add(amb).add(under).add(shade.mul(0.12)).add(bowLight);
                            const ext = dens.mul(SIGMA).mul(dt);
                            const absorb = float(1.0).sub(exp(ext.negate()));
                            bodyLight.addAssign(col.mul(absorb).mul(bodyThrough));
                            bodyThrough.mulAssign(exp(ext.negate()));
                        });
                    });
                    tt.addAssign(dt);
                });
                // The body seen through the basin's air (its middle distance), then laid behind
                // what is already in front of it.
                const mid = a.add(span.mul(0.5));
                const seen = float(1.0).sub(bodyThrough);
                const hazed = tbAerial(u, bodyLight.div(max(seen, 1e-4)), mid, dir).mul(seen);
                light.addAssign(hazed.mul(through));
                through.mulAssign(bodyThrough);
            });
        });
        // ── The morning mist: a thin layer lying over the warm ground, thickest round the Iris,
        // torn into drifting banks, lit warm by the low sun, behind whatever steam stands in it ──
        if (look.mistSteps > 0) {
            const down = dir.y.negate();
            If(down.greaterThan(0.004).and(through.greaterThan(0.02)), () => {
                const tA = max(eye.y.sub(MIST_TOP).div(down), 0.0);
                const tB = min(sceneT, eye.y.div(down).add(2.0));
                If(tB.greaterThan(tA), () => {
                    const n = look.mistSteps;
                    const dm = tB.sub(tA).div(n).toVar();
                    const tm = tA.add(dm.mul(jitter)).toVar();
                    const mistLight = vec3(0.0).toVar();
                    const mistThrough = float(1.0).toVar();
                    const drift = vec3(u.windDir.x, 0.0, u.windDir.y).mul(u.windSpeed.mul(t).mul(0.35));
                    const sunMist = u.sunColor.mul(phase.mul(0.9)).add(skyAmb.mul(0.9));
                    Loop(n, () => {
                        const p = eye.add(dir.mul(tm)).toVar();
                        const fromIris = length(p.xz.sub(u.irisCentre)).div(IRIS_RADIUS);
                        const warm = exp(fromIris.mul(fromIris).mul(-0.08)).mul(0.75).add(0.25)
                            .mul(smoothstep(0.85, 1.35, fromIris));
                        const q = vec3(p.x, p.y.mul(4.0), p.z).sub(drift).div(85.0);
                        const banks = smoothstep(0.42, 0.85, n3(q).x);
                        // (a gust's front blows the banks off the ground as it passes)
                        const blown = float(1.0).sub(tbGustBand(u, p.xz).mul(0.75));
                        const dens = banks.mul(warm).mul(blown).mul(exp(max(p.y, 0.0).div(-MIST_FALL))).mul(u.steam)
                            .mul(MIST_DENSITY);
                        const ext = dens.mul(dm);
                        mistLight.addAssign(sunMist.mul(float(1.0).sub(exp(ext.negate()))).mul(mistThrough));
                        mistThrough.mulAssign(exp(ext.negate()));
                        tm.addAssign(dm);
                    });
                    light.addAssign(mistLight.mul(through));
                    through.mulAssign(mistThrough);
                });
            });
        }
        return vec4(light, through);
    });
    return rtt(march(), null, null, { resolutionScale: look.scale, type: THREE.HalfFloatType });
}

/**
 * The vapour at full resolution: a joint bilateral upsample of the reduced target (Moonlit
 * Greenhouse's): each pixel blends the 3 × 3 texels round it, weighted by a tent on distance and
 * by how near each texel's depth is to its own (every tier: a 2 × 2 read left the march's jitter
 * visible as a dither).
 * @param {object} q
 * @param {object} q.target    the RTT node
 * @param {object} q.depth     the scene's depth texture node
 * @param {object} q.projInv   uniform: the scene camera's projectionMatrixInverse
 * @param {object} q.viewport  uniform vec2: the drawing buffer in pixels
 * @param {number} q.scale     the target's resolution scale
 * @param {object} st          the full-resolution UV
 */
export function upsampleVapour({
    target, depth, projInv, viewport, scale,
}, st) {
    const viewZ = (p) => getViewPosition(p, depth.sample(p).x, projInv).z;
    const low = floor(viewport.mul(scale));
    const f = st.mul(low).sub(0.5);
    const zHere = viewZ(st);
    const zScale = float(1.0).div(max(abs(zHere), 0.1));
    const sum = vec4(0.0).toVar();
    const weight = float(0.0).toVar();
    const tap = (cell, nearW) => {
        const q = cell.add(0.5).div(low);
        const rel = viewZ(q).sub(zHere).mul(zScale);
        const w = nearW.mul(exp(rel.mul(rel).mul(-300.0)).add(1e-4));
        sum.addAssign(target.sample(q).mul(w));
        weight.addAssign(w);
    };
    const base = floor(f.add(0.5));
    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            const cell = base.add(vec2(dx, dy));
            const off = abs(f.sub(cell));
            tap(cell, max(float(1.5).sub(off.x), 0.0).mul(max(float(1.5).sub(off.y), 0.0)));
        }
    }
    return sum.div(max(weight, 1e-6));
}
