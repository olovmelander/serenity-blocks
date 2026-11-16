/**
 * Halcyon Apex — the skyfarers: the craft that come to the sanctuary's light.
 *
 * Eight hulls modelled in Blender (halcyon-apex-visitor-plan.js) share one buffer and one material.
 * The sky may hold two dozen at once, formations and all, so the hulls are one instanced draw:
 * every instance carries where it is, how it is turned and which kind it is in a table of uniform
 * rows, and a vertex that belongs to another kind is thrown out of the clip volume. One pipeline
 * serves the whole fleet, and an empty sky draws nothing.
 *
 * Their lamps are sprites (a pool of instanced quads filled each frame), so a lamp still reads as a
 * point of light when its hull is a few pixels across. Their exhaust trails and the beams they lay
 * on the great crystals are ribbons: strips of quads turned to the eye on the CPU, each a run of
 * the craft's own path a few seconds back (the path is a function of the clock, so a trail needs no
 * memory and a seek draws the same one).
 *
 * The hulls shade themselves like everything in the sanctuary: chrome mirrors the dawn along its own
 * reflection (the lagoon below the horizon), pearl and paint take the sun and the sky's light and
 * darken where the hull shades itself (occlusion baked per vertex), glass holds a glow, engines and
 * seams burn in the hour's crystal colour, and distance fades them into the air. A craft that comes
 * or goes out of thin air dissolves into the sky behind it. All three parts stand in the lagoon's
 * mirror.
 *
 * Who is in the sky, and where, is a pure function of the world clock (halcyon-apex-flight.js), plus
 * whatever the board has called (a salute for four lines): seek(t) shows the same sky a replay does.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    instanceIndex,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    reflect,
    sin,
    smoothstep,
    step,
    uniformArray,
    uv,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SUNFIRE,
    TAU,
    haAtmosphere,
    haFogAmount,
    haFresnel,
    haFxMaterial,
    haLuma,
    haPart,
    haQuadGeometry,
    haSkyBase,
    haSkyLight,
} from './halcyon-apex-tsl.js';
import {
    LAMP_POOL,
    RIBBONS,
    RIBBON_SAMPLES,
    VISITOR_KIND,
    VISITOR_LAMPS,
    buildHulls,
    trailOrigin,
} from './halcyon-apex-visitor-plan.js';
import {
    CALL_LEAD,
    Flight,
    SHIP_SLOTS,
    makeSortie,
    quatTurn,
    sortiesAt,
} from './halcyon-apex-flight.js';

/** Frames after a build that a hull is drawn out of sight, so the pipelines exist before the first craft. */
export const VISITOR_WARM_FRAMES = 90;
/** Where a hull waits while it is only being warmed (far under the lagoon, outside every camera's view). */
const IDLE = Object.freeze([0, -5000, 0]);
/** Uniform rows per hull instance. */
const ROWS = 4;
/** Seconds between the puffs of spray a skimming hull throws, and between the rings a hovering one presses. */
const SPRAY_EVERY = 0.07;
const WASH_EVERY = 1.25;
/** Beyond this a hull is a few pixels: only its brightest lamps are lit. */
const FAR_LAMPS = 760;

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

/** The hull material: one for every kind, each vertex told what it is made of and each instance where it flies. */
function createHullMaterial(u, v) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HalcyonApexVisitors';
    material.fog = false;
    const part = attribute('aPart', 'vec4');
    const normalIn = attribute('normal', 'vec3');
    const base = instanceIndex.mul(ROWS);
    const A = v.ships.element(base); // (x, y, z, scale)
    const Q = v.ships.element(base.add(1)); // its bearing, a quaternion
    const C = v.ships.element(base.add(2)); // (kind, presence, wing beat, throttle)
    const L = v.ships.element(base.add(3)); // (its light's colour, gain)
    const turn = (vector) => {
        const t = cross(Q.xyz, vector).mul(2.0);
        return vector.add(t.mul(Q.w)).add(cross(Q.xyz, t));
    };
    // The manta beats its wings: a slow wave out along the span, nothing at the heart.
    const span = abs(positionGeometry.z).div(22.0);
    const isManta = step(abs(part.z.sub(VISITOR_KIND.manta)), 0.5);
    const beat = sin(C.z.sub(span.mul(1.9))).mul(span).mul(span).mul(2.8)
        .mul(isManta);
    const local = vec3(positionGeometry.x, positionGeometry.y.add(beat), positionGeometry.z);
    const world = A.xyz.add(turn(local.mul(A.w)));
    // A vertex of another kind leaves the clip volume: one buffer, one pipeline, any mix of hulls.
    const mine = step(abs(part.z.sub(C.x)), 0.5);
    material.vertexNode = mix(vec4(0.0, 0.0, 2.0, 1.0), viewProjection(world), mine);

    const vP = varying(world, 'haShipP');
    const vN = varying(turn(normalIn), 'haShipN');
    const vPart = varying(vec4(part.x, part.y, part.w, C.y), 'haShipPart');
    const vLamp = varying(L, 'haShipLamp');
    const vLocal = varying(vec4(positionGeometry.mul(A.w), C.w), 'haShipLocal');

    material.colorNode = Fn(() => {
        const N = normalize(vN).toVar();
        const P = vP.toVar();
        const V = normalize(P.sub(cameraPosition)).toVar();
        const surface = floor(vPart.x.add(0.5)).toVar();
        const param = clamp(vPart.y, 0.0, 1.0).toVar();
        const occ = clamp(vPart.z, 0.0, 1.0).mul(0.78).add(0.22).toVar();
        const cosV = clamp(dot(N, V).negate(), 0.0, 1.0).toVar();
        const R = reflect(V, N).toVar();
        const lampRgb = vLamp.rgb.toVar();
        const lampGain = max(vLamp.w, 0.0).toVar();
        const throttle = clamp(vLocal.w, 0.0, 1.0).toVar();

        // What a polished face sees along its reflection: the dawn, or the lagoon mirroring it.
        const skyR = haSkyBase(u, vec3(R.x, abs(R.y), R.z));
        const lagoon = skyR.mul(0.35).add(u.deep.mul(0.3)).add(u.shallow.mul(0.06));
        const env = mix(lagoon, skyR, smoothstep(-0.05, 0.05, R.y)).toVar();
        const rs = clamp(dot(R, u.sunDir), 0.0, 1.0);
        const rs2 = rs.mul(rs);
        const rs4 = rs2.mul(rs2);
        const rs8 = rs4.mul(rs4);
        const rs32 = rs8.mul(rs8).mul(rs8).mul(rs8).toVar();
        const rs256 = rs32.mul(rs32).mul(rs32).mul(rs32).mul(rs32)
            .mul(rs32)
            .mul(rs32)
            .mul(rs32);
        const glint = u.sun.mul(rs256.mul(3.0).add(rs32.mul(0.22))).toVar();
        // The light a painted face takes: the sun, the sky over the way it faces, the lagoon below.
        // (A pale hull under a blue zenith would read as blue paint: the sky's share is taken half
        // way to grey, as the eye does it.)
        const facing = max(dot(N, u.sunDir), 0.0);
        const skyL = haSkyLight(u, N).toVar();
        const light = u.sun.mul(facing).mul(0.9)
            .add(mix(vec3(haLuma(skyL)), skyL, 0.5).mul(1.55))
            .add(mix(u.shallow, u.horizon, 0.5).mul(max(N.y.negate(), 0.0)).mul(0.6))
            .mul(occ)
            .toVar();

        // Seams between the hull's plates: lines square to its length, a fine set and a coarse one,
        // each gone before it would shimmer.
        const seam = (metres) => {
            const c = vLocal.x.div(metres);
            const w = max(fwidth(c), 1e-5);
            const off = abs(fract(c.sub(0.5)).sub(0.5));
            return float(1.0).sub(smoothstep(w.mul(0.7), w.mul(1.5), off)).mul(float(1.0).sub(smoothstep(0.1, 0.28, w)));
        };
        const plates = float(1.0).sub(max(seam(2.6), seam(17.0)).mul(0.26)).toVar();

        const amber = vec3(1.0, 0.36, 0.08);
        const chrome = env.mul(mix(float(0.55), float(1.0), haFresnel(cosV, 0.6))).mul(vec3(0.95, 0.93, 0.9)).mul(occ.mul(0.6).add(0.4))
            .add(glint)
            .add(light.mul(0.04));
        const satin = light.mul(param).mul(plates).add(env.mul(haFresnel(cosV, 0.04)).mul(0.7).mul(occ)).add(glint.mul(0.3));
        const matte = light.mul(param).mul(plates).add(env.mul(haFresnel(cosV, 0.04)).mul(0.45).mul(occ)).add(u.sun.mul(rs32).mul(0.08));
        // Pearl: a pale lacquer that takes a breath of the hour's crystal colour where it turns away.
        const grazing = float(1.0).sub(cosV);
        const nacre = mix(vec3(1.0, 0.97, 0.93), mix(vec3(1.0), lampRgb, 0.45), grazing.mul(grazing).mul(0.8));
        const pearl = light.mul(param).mul(nacre).mul(plates)
            .add(env.mul(haFresnel(cosV, 0.1)).mul(1.15).mul(occ))
            .add(glint.mul(0.8));
        const glass = env.mul(haFresnel(cosV, 0.08).mul(1.2).add(0.06)).add(glint)
            .add(lampRgb.mul(lampGain).mul(0.05).mul(cosV.mul(0.6).add(0.4)));
        const emitter = mix(lampRgb, amber, step(0.5, param)).mul(lampGain).mul(u.breath);
        const orb = lampRgb.mul(lampGain).mul(cosV.mul(cosV).mul(1.6).add(0.45)).mul(u.breath);
        const engine = mix(lampRgb, vec3(1.0), cosV.mul(0.4)).mul(throttle.mul(7.0).add(1.5)).mul(u.breath);
        const pulse = sin(u.time.mul(2.1).sub(vLocal.x.mul(0.35))).mul(0.2).add(0.8);
        const trim = lampRgb.mul(lampGain.mul(0.35).add(1.1)).mul(pulse).mul(u.breath);
        const crystal = env.mul(haFresnel(cosV, 0.1)).mul(0.9).add(glint.mul(0.6))
            .add(lampRgb.mul(lampGain).mul(0.5).mul(cosV.mul(cosV).mul(1.2).add(0.35)).mul(u.breath));

        const is = (k) => float(1.0).sub(step(0.5, abs(surface.sub(k))));
        const col = chrome.mul(is(0)).add(satin.mul(is(1))).add(matte.mul(is(2))).add(glass.mul(is(3)))
            .add(emitter.mul(is(4)))
            .add(orb.mul(is(5)))
            .add(pearl.mul(is(6)))
            .add(engine.mul(is(7)))
            .add(trim.mul(is(8)))
            .add(crystal.mul(is(9)));
        const seen = haAtmosphere(u, col, P);
        // Coming or going out of thin air, it dissolves into the sky behind it.
        const behind = haSkyBase(u, vec3(V.x, max(V.y, 0.015), V.z));
        return vec4(mix(behind, seen, clamp(vPart.w, 0.0, 1.0)), 1.0);
    })();
    return material;
}

/** The lamp sprites: a pool of quads, filled each frame. */
function createLightMaterial(u) {
    const material = haFxMaterial('HalcyonApexVisitorLights');
    const at = attribute('aAt', 'vec4');
    const tint = attribute('aTint', 'vec4');
    // A camera-facing quad of `size` metres, never less than a few pixels.
    const clip = viewProjection(at.xyz);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    const px = clamp(at.w.mul(pxPerMetre), u.viewport.y.mul(0.004), u.viewport.y.mul(0.07)).mul(step(1e-4, at.w));
    material.vertexNode = vec4(
        clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(u.viewport.mul(0.5)).mul(clip.w)),
        clip.z,
        clip.w,
    );
    // The air between the eye and the light takes its share of it.
    const through = float(1.0).sub(haFogAmount(length(at.xyz.sub(cameraPosition)), at.y));
    const vTint = varying(tint.rgb.mul(tint.w).mul(through), 'haVisitorTint');
    material.colorNode = Fn(() => {
        const q = clamp(uv(), 0.0, 1.0);
        // A hot core in a soft halo.
        const d = length(q.sub(0.5).mul(2.0));
        const lampLight = exp(d.mul(d).mul(-22.0)).add(exp(d.mul(d).mul(-4.0)).mul(0.22))
            .mul(float(1.0).sub(smoothstep(0.8, 1.0, d)));
        return vec4(vTint.mul(lampLight).mul(u.breath), 0.0);
    })();
    return material;
}

/** Exhaust trails and beams: ribbons turned to the eye on the CPU. */
function createRibbonMaterial(u) {
    const material = haFxMaterial('HalcyonApexVisitorTrails');
    const rib = attribute('aRib', 'vec4'); // (across −1..1, along 0..1, beam 0 | 1, vapour)
    const tint = attribute('aTint', 'vec4'); // (colour, gain)
    material.vertexNode = viewProjection(positionGeometry);
    const through = float(1.0).sub(haFogAmount(length(positionGeometry.sub(cameraPosition)), positionGeometry.y));
    const vRib = varying(rib, 'haRib');
    const vTint = varying(vec4(tint.rgb.mul(tint.w), through), 'haRibTint');
    material.colorNode = Fn(() => {
        // Clamped: a ribbon thinner than a pixel is shaded from coordinates MSAA extrapolates.
        const across = clamp(vRib.x, -1.0, 1.0).toVar();
        const along = clamp(vRib.y, 0.0, 1.0).toVar();
        const through2 = clamp(vTint.w, 0.0, 1.0);
        const edge = float(1.0).sub(smoothstep(0.7, 1.0, abs(across)));
        // A trail: the engine's light, hottest at the hull and gone in a breath, in a longer wake
        // of vapour that takes the dawn.
        const left = float(1.0).sub(along);
        const core = exp(across.mul(across).mul(-7.0));
        const fire = core.mul(left.mul(left).mul(left)).mul(exp(along.mul(-9.0)).mul(3.0).add(1.0));
        const puff = sin(along.mul(46.0).sub(u.time.mul(1.3))).mul(0.14).add(0.86);
        const mist = edge.mul(left.mul(left.sqrt())).mul(clamp(vRib.w, 0.0, 1.0)).mul(puff)
            .mul(smoothstep(0.0, 0.06, along));
        const dawn = mix(u.cloud, u.glow, 0.35).mul(0.95);
        const trail = vec4(vTint.rgb.mul(fire).add(dawn.mul(mist).mul(0.55)), mist.mul(0.5));
        // A beam: soft across, brightest under the hull, a slow ripple running down it.
        const profile = exp(across.mul(across).mul(-4.5)).mul(edge);
        const ripple = along.mul(36.0).sub(u.time.mul(7.0)).sin().mul(0.2)
            .add(0.8);
        const lit = profile.mul(float(1.0).sub(smoothstep(0.86, 1.0, along))).mul(along.mul(-0.5).add(1.0)).mul(ripple)
            .mul(smoothstep(0.0, 0.1, along).mul(0.6).add(0.4));
        const beam = vec4(vTint.rgb.mul(lit), 0.0);
        return mix(trail, beam, step(0.5, vRib.z)).mul(through2).mul(u.breath.mul(0.8).add(0.2));
    })();
    return material;
}

const WHITE = Object.freeze([1, 1, 1]);
const WARM_WHITE = Object.freeze([1, 0.96, 0.9]);
const AMBER = Object.freeze([1, 0.36, 0.08]);
const WINDOW = Object.freeze([1, 0.84, 0.6]);
const RED = Object.freeze([1, 0.12, 0.06]);
const GREEN = Object.freeze([0.2, 1, 0.45]);

/**
 * @param {object} u  shared sanctuary uniforms
 * @returns {object} { hulls, lights, trails, update, call, reset, state }
 */
export function createVisitors(u) {
    const hullData = buildHulls();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(hullData.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(hullData.normal, 3));
    geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(hullData.part, 4));
    geometry.setIndex(new THREE.BufferAttribute(hullData.index, 1));
    geometry.instanceCount = 1;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const rows = Array.from({ length: SHIP_SLOTS * ROWS }, () => new THREE.Vector4(0, 0, 0, 0));
    const v = { ships: uniformArray(rows, 'vec4') };
    const hulls = haPart('HalcyonApexVisitors', geometry, createHullMaterial(u, v), -12);

    // ── Lamps ──
    const aAt = new Float32Array(LAMP_POOL * 4);
    const aTint = new Float32Array(LAMP_POOL * 4);
    const lightGeometry = haQuadGeometry(LAMP_POOL, { aAt: [aAt, 4], aTint: [aTint, 4] });
    lightGeometry.getAttribute('aAt').setUsage(THREE.DynamicDrawUsage);
    lightGeometry.getAttribute('aTint').setUsage(THREE.DynamicDrawUsage);
    lightGeometry.instanceCount = 1;
    const lights = haPart('HalcyonApexVisitorLights', lightGeometry, createLightMaterial(u), 24);

    // ── Ribbons ──
    const S = RIBBON_SAMPLES;
    const ribbonVerts = RIBBONS * S * 2;
    const rPosition = new Float32Array(ribbonVerts * 3);
    const rRib = new Float32Array(ribbonVerts * 4);
    const rTint = new Float32Array(ribbonVerts * 4);
    const rIndex = new Uint16Array(RIBBONS * (S - 1) * 6);
    for (let r = 0; r < RIBBONS; r++) {
        for (let s = 0; s < S - 1; s++) {
            const a = (r * S + s) * 2;
            const o = (r * (S - 1) + s) * 6;
            rIndex.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], o);
        }
    }
    const ribbonGeometry = new THREE.BufferGeometry();
    ribbonGeometry.setAttribute('position', new THREE.BufferAttribute(rPosition, 3).setUsage(THREE.DynamicDrawUsage));
    ribbonGeometry.setAttribute('aRib', new THREE.BufferAttribute(rRib, 4).setUsage(THREE.DynamicDrawUsage));
    ribbonGeometry.setAttribute('aTint', new THREE.BufferAttribute(rTint, 4).setUsage(THREE.DynamicDrawUsage));
    ribbonGeometry.setIndex(new THREE.BufferAttribute(rIndex, 1));
    ribbonGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const trails = haPart('HalcyonApexVisitorTrails', ribbonGeometry, createRibbonMaterial(u), 23);

    let frames = 0;
    /** Sorties the board has called: { sortie, start }. */
    const calls = [];
    /** A Flight for every sortie in the sky, kept while it flies. */
    const flights = new Map();
    const scheduled = [];
    const active = [];
    const pose = {
        p: [0, 0, 0], q: [0, 0, 0, 1], speed: 0, throttle: 0, presence: 1, flash: 0, spin: 0, up: [0, 1, 0],
    };
    const lampAt = [0, 0, 0];
    const centre = [0, 0, 0];
    const tmp = [0, 0, 0];
    const state = {
        /** The hero in the sky (or the first sortie there is), its hull kind, how far into its flight. */
        route: null, kind: null, age: 0, presence: 0, at: [0, 0, 0], sorties: [], ships: 0, lamps: 0, ribbons: 0,
    };
    let nShips = 0;
    let nLamps = 0;
    let nRibbons = 0;

    const flightFor = (key, sortie, frame) => {
        let flight = flights.get(key);
        if (!flight || flight.sortie !== sortie) {
            flight = new Flight(sortie, frame);
            flight.sprayTick = [];
            flight.washTick = -1;
            flight.giftTick = -1;
            flights.set(key, flight);
        } else if (flight.signature !== Flight.signatureOf(frame)) flight.resolve(frame);
        flight.seen = frames;
        return flight;
    };

    const lampOut = (x, y, z, size, rgb, gain) => {
        if (nLamps >= LAMP_POOL || !(gain > 0.001)) return;
        const o = nLamps * 4;
        aAt[o] = x;
        aAt[o + 1] = y;
        aAt[o + 2] = z;
        aAt[o + 3] = size;
        aTint[o] = rgb[0];
        aTint[o + 1] = rgb[1];
        aTint[o + 2] = rgb[2];
        aTint[o + 3] = gain;
        nLamps += 1;
    };

    /** One cross-section of a ribbon: its centre, half its width, where along it lies. */
    const ribbonVertex = (r, s, c, side, along, beam, vapour, rgb, gain) => {
        for (let k = 0; k < 2; k++) {
            const i = (r * S + s) * 2 + k;
            const sign = k ? 1 : -1;
            rPosition[i * 3] = c[0] + side[0] * sign;
            rPosition[i * 3 + 1] = c[1] + side[1] * sign;
            rPosition[i * 3 + 2] = c[2] + side[2] * sign;
            rRib[i * 4] = sign;
            rRib[i * 4 + 1] = along;
            rRib[i * 4 + 2] = beam;
            rRib[i * 4 + 3] = vapour;
            rTint[i * 4] = rgb[0];
            rTint[i * 4 + 1] = rgb[1];
            rTint[i * 4 + 2] = rgb[2];
            rTint[i * 4 + 3] = gain;
        }
    };
    const samples = Array.from({ length: S }, () => [0, 0, 0]);
    const side = [0, 0, 0];
    /** Lay ribbon `r` through `count` points (the rest of its strip collapses onto the last). */
    const ribbonThrough = (r, count, eye, width, widthEnd, beam, vapour, rgb, gain) => {
        for (let s = 0; s < S; s++) {
            const k = Math.min(s, count - 1);
            const c = samples[k];
            const a = samples[Math.max(0, k - 1)];
            const b = samples[Math.min(count - 1, k + 1)];
            const tx = b[0] - a[0];
            const ty = b[1] - a[1];
            const tz = b[2] - a[2];
            const ex = eye[0] - c[0];
            const ey = eye[1] - c[1];
            const ez = eye[2] - c[2];
            let sx = ty * ez - tz * ey;
            let sy = tz * ex - tx * ez;
            let sz = tx * ey - ty * ex;
            const sl = Math.hypot(sx, sy, sz);
            const along = count > 1 ? k / (count - 1) : 0;
            const half = (width + (widthEnd - width) * along) * (s < count ? 1 : 0);
            if (sl > 1e-6) {
                sx = (sx / sl) * half;
                sy = (sy / sl) * half;
                sz = (sz / sl) * half;
            } else {
                sx = 0;
                sy = 0;
                sz = 0;
            }
            side[0] = sx;
            side[1] = sy;
            side[2] = sz;
            ribbonVertex(r, s, c, side, along, beam, vapour, rgb, gain);
        }
    };

    const mixRgb = (a, b, k, out) => {
        out[0] = a[0] + (b[0] - a[0]) * k;
        out[1] = a[1] + (b[1] - a[1]) * k;
        out[2] = a[2] + (b[2] - a[2]) * k;
        return out;
    };
    const own = [0, 0, 0];
    const pale = [0, 0, 0];
    const cargoTint = [0, 0, 0];

    /** Light one hull's lamps. */
    const lightHull = (kind, slot, flight, shipIndex, age, far, shown, pal, hooks) => {
        const lamps = VISITOR_LAMPS[kind];
        if (!lamps.length) return;
        const { sortie } = flight;
        const A = rows[slot * ROWS];
        const { q } = pose;
        const scale = A.w;
        const beam = flight.beam(age);
        const blink = (period, offset, width = 0.13) => {
            const x = ((((age + offset) % period) + period) % period) / width;
            return x < 1 ? Math.sin(x * Math.PI) : 0;
        };
        for (let k = 0; k < lamps.length; k++) {
            const lamp = lamps[k];
            const g = lamp.group;
            let rgb = own;
            let gain = 0;
            let { size } = lamp;
            if (kind === 'saucer') {
                if (g === 'rim') {
                    if (far && lamp.index % 3) continue;
                    const chase = 0.5 + 0.5 * Math.cos(3 * (lamp.index / 12) * TAU - age * 4.2);
                    gain = 9 * (0.22 + 0.78 * chase ** 4);
                } else {
                    rgb = mixRgb(own, WHITE, 0.55, pale);
                    gain = 2.5 * (0.85 + 0.15 * Math.sin(age * 2.3)) + 2.5 * beam;
                }
            } else if (kind === 'swift') {
                // (A salute flies low overhead, its dark belly to the eye: its keel and engines burn brighter.)
                const fete = sortie.tint === 'sunfire' ? 2.2 : 1;
                if (g === 'engine') gain = (5 + 9 * pose.throttle) * fete;
                else if (far) continue;
                else if (g === 'keel') gain = 2.4 * fete * fete;
                else if (g === 'nose') {
                    rgb = WHITE;
                    gain = 3;
                } else {
                    rgb = g === 'port' ? RED : GREEN;
                    gain = 5 * (0.35 + 0.65 * blink(1.3, shipIndex * 0.37 + (g === 'port' ? 0 : 0.65), 0.2));
                }
            } else if (kind === 'manta') {
                if (g === 'corner') {
                    rgb = WARM_WHITE;
                    gain = 10 * (0.92 + 0.08 * Math.sin(age * 13 + lamp.index * 2));
                } else if (g === 'core') {
                    rgb = AMBER;
                    gain = 3 + 6 * (0.5 + 0.5 * Math.sin((age * TAU) / 2.6)) ** 2;
                } else gain = 3 + 3 * pose.throttle;
            } else if (kind === 'barge') {
                if (g === 'engine') gain = 4 + 6 * pose.throttle;
                else if (g === 'cargo') {
                    if (far && lamp.index % 2) continue;
                    // Each crystal of cargo holds its own shade of the hour; unloading, they pour
                    // out one by one.
                    const hue = (lamp.index % 3) / 2;
                    rgb = mixRgb(pal.crystal, pal.glow, 0.15 + hue * 0.5, cargoTint);
                    let fill = 1;
                    if (sortie.unload) {
                        const span = (sortie.unload.to - sortie.unload.from) / 6;
                        const from = sortie.unload.from + lamp.index * span;
                        const k2 = Math.max(0, Math.min(1, (age - from) / span));
                        fill = 1 + 2.2 * Math.sin(k2 * Math.PI) - 0.86 * k2;
                    }
                    gain = 3.2 * fill * (0.9 + 0.1 * Math.sin(age * 1.7 + lamp.index));
                } else if (far) continue;
                else if (g === 'port' || g === 'starboard') {
                    rgb = g === 'port' ? RED : GREEN;
                    gain = 5;
                } else if (g === 'tail') {
                    rgb = RED;
                    gain = 9 * blink(1.9, 0.9);
                } else {
                    rgb = WHITE;
                    gain = g === 'crown' ? 12 * blink(1.9, 0) : 3;
                }
            } else if (kind === 'ark') {
                if (g === 'window') {
                    const dim = lamp.index === 2 || lamp.index === 6 ? 0.3 : 1;
                    rgb = WINDOW;
                    gain = 10 * dim * (0.8 + 0.2 * Math.sin(age * 0.9 + lamp.index * 1.7));
                } else if (g === 'nose') {
                    rgb = WHITE;
                    gain = 16 * blink(1.7, 0);
                } else if (g === 'tail') {
                    rgb = RED;
                    gain = 14 * blink(1.7, 0.85);
                } else if (g === 'crown') gain = 5 + 3 * Math.sin(age * 1.1 + lamp.index * 2.1);
                else gain = 6 + 0.8 * Math.sin(age * 3);
            } else if (kind === 'hoop') {
                if (g === 'core') {
                    gain = 3.2 + 1.2 * Math.sin(age * 2.6) + 5 * beam;
                    size *= 1 + 0.5 * beam;
                } else {
                    rgb = WARM_WHITE;
                    gain = 7 * (0.6 + 0.4 * Math.sin(age * 3.1 + lamp.index * 2.1));
                }
            } else if (kind === 'orb') {
                gain = 2.6 + 0.9 * Math.sin(age * 5.1 + shipIndex * 2.1);
            }
            // The lamp's place: its hull-space point through the hull's bearing and the wing beat's none.
            tmp[0] = lamp.at[0] * scale;
            tmp[1] = lamp.at[1] * scale;
            tmp[2] = lamp.at[2] * scale;
            quatTurn(q, tmp, lampAt);
            lampOut(A.x + lampAt[0], A.y + lampAt[1], A.z + lampAt[2], size * scale * (far ? 1.5 : 1), rgb, gain * shown * (far ? 1.4 : 1));
        }
        // Unloading, a barge pours its cargo down onto the causeway, and the ley line takes it to the Apex.
        if (kind === 'barge' && sortie.unload && hooks) {
            const span = (sortie.unload.to - sortie.unload.from) / 6;
            const tick = Math.floor((age - sortie.unload.from) / span);
            if (tick >= 0 && tick < 6 && tick !== flight.giftTick) {
                flight.giftTick = tick;
                hooks.gift?.(0, cargoTint, 0.9, A.x, A.y - 2, A.z);
            }
        }
    };

    /** Hide everything (or, while the pipelines are being built, draw one hull out of sight). */
    const idle = (warm) => {
        hulls.mesh.visible = warm;
        lights.mesh.visible = warm;
        trails.mesh.visible = warm;
        state.route = null;
        state.kind = null;
        state.presence = 0;
        state.sorties.length = 0;
        state.ships = 0;
        state.lamps = 0;
        state.ribbons = 0;
        if (!warm) return;
        rows[0].set(IDLE[0], IDLE[1], IDLE[2], 1);
        rows[1].set(0, 0, 0, 1);
        rows[2].set(0, 0, 0, 0);
        rows[3].set(1, 1, 1, 0);
        geometry.instanceCount = 1;
        aAt.fill(0, 0, 4);
        aTint.fill(0, 0, 4);
        lightGeometry.instanceCount = 1;
        lightGeometry.getAttribute('aAt').needsUpdate = true;
        lightGeometry.getAttribute('aTint').needsUpdate = true;
        rPosition.fill(0, 0, S * 2 * 3);
        for (let i = 0; i < S * 2; i++) rPosition[i * 3 + 1] = IDLE[1];
        ribbonGeometry.getAttribute('position').needsUpdate = true;
        ribbonGeometry.setDrawRange(0, (S - 1) * 6);
    };

    /**
     * Each frame: who is in the sky at `t`, where, how their lamps burn and what they trail.
     * @param {number} t
     * @param {object} frame  { yaw, eye, upright, halcyonTop, halcyon, apex, palette, reduced }
     * @param {number[]} eye  the camera's place (ribbons turn to it)
     * @param {object} [hooks]  { spray(x, z, strength, rgb), wash(x, z, rgb), gift(line, rgb, amount, x, y, z) }
     */
    const update = (t, frame, eye = [0, 3.2, 0], hooks = null) => {
        frames += 1;
        const warm = frames <= VISITOR_WARM_FRAMES;
        const reduced = frame.reduced === true;
        active.length = 0;
        for (let i = calls.length - 1; i >= 0; i--) {
            const call = calls[i];
            const age = t - call.start;
            if (age > call.sortie.duration || age < -CALL_LEAD) calls.splice(i, 1);
            else if (age >= 0) {
                active.push({
                    flight: flightFor(call, call.sortie, frame), age, stream: 'call',
                });
            }
        }
        if (frame.schedule === false) scheduled.length = 0;
        else sortiesAt(t, reduced, scheduled);
        for (let i = 0; i < scheduled.length; i++) {
            const plan = scheduled[i];
            active.push({
                flight: flightFor(plan.sortie, plan.sortie, frame), age: plan.age, stream: plan.stream,
            });
        }
        // Flights that have left the sky are forgotten.
        if (flights.size > active.length) {
            flights.forEach((flight, key) => {
                if (flight.seen !== frames) flights.delete(key);
            });
        }
        if (!active.length) {
            idle(warm);
            return;
        }

        const pal = frame.palette || {};
        const crystalRgb = pal.crystal || [0.2, 0.92, 0.88];
        const sunRaw = pal.sun || [4.6, 3.3, 2.0];
        const sunPeak = Math.max(sunRaw[0], sunRaw[1], sunRaw[2], 1e-3);
        const palette = { crystal: crystalRgb, glow: pal.glow || [1, 0.62, 0.28] };
        nShips = 0;
        nLamps = 0;
        nRibbons = 0;
        state.sorties.length = 0;
        state.route = null;
        state.stream = null;
        for (let a = 0; a < active.length; a++) {
            const { flight, age, stream } = active[a];
            const { sortie } = flight;
            state.sorties.push(sortie.name);
            if (sortie.tint === 'sunfire') mixRgb(SUNFIRE, SUNFIRE, 0, own);
            else if (sortie.tint === 'sun') {
                own[0] = (sunRaw[0] / sunPeak) * 0.6 + 0.4;
                own[1] = (sunRaw[1] / sunPeak) * 0.6 + 0.4;
                own[2] = (sunRaw[2] / sunPeak) * 0.6 + 0.4;
            } else mixRgb(crystalRgb, crystalRgb, 0, own);
            const beam = flight.beam(age);
            for (let i = 0; i < sortie.ships.length && nShips < SHIP_SLOTS; i++) {
                const ship = sortie.ships[i];
                flight.pose(i, age, pose);
                if (!(pose.presence > 0.002)) continue;
                const kind = ship.kind || sortie.kind;
                const scale = ship.scale || sortie.scale || 1;
                const slot = nShips;
                nShips += 1;
                const flare = 1 + 3 * pose.flash;
                const shown = pose.presence * flare;
                let gain = 3 * flare;
                if (kind === 'orb') gain = 5 * flare * pose.presence;
                else if (kind === 'hoop') gain = (3 + 5 * beam) * flare;
                else if (kind === 'saucer') gain = (2.5 + 3 * beam) * flare;
                else if (kind === 'manta') gain = 4 * flare;
                rows[slot * ROWS].set(pose.p[0], pose.p[1], pose.p[2], scale);
                rows[slot * ROWS + 1].set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
                rows[slot * ROWS + 2].set(VISITOR_KIND[kind], pose.presence, age * 1.15 + (ship.phase || 0), pose.throttle);
                rows[slot * ROWS + 3].set(own[0], own[1], own[2], gain);
                // The sortie the state names: what the board called, else the hero, else the first there is.
                if (state.route === null || ((stream === 'hero' || stream === 'call') && i === 0 && state.stream !== 'call')) {
                    state.stream = stream;
                    state.route = sortie.name;
                    state.kind = kind;
                    state.age = age;
                    state.presence = pose.presence;
                    state.at[0] = pose.p[0];
                    state.at[1] = pose.p[1];
                    state.at[2] = pose.p[2];
                }
                const dist = Math.hypot(pose.p[0] - eye[0], pose.p[1] - eye[1], pose.p[2] - eye[2]);
                const far = dist > FAR_LAMPS;
                lightHull(kind, slot, flight, i, age, far, shown, palette, hooks);

                // ── Its trail: its own path, a few seconds back ──
                const { trail } = sortie;
                const origin = trail ? trailOrigin(kind) : null;
                if (origin && nRibbons < RIBBONS && pose.speed > 4) {
                    const span = trail.seconds * (ship.kind && ship.kind !== sortie.kind ? 0.5 : 1);
                    // The engine's place on the hull, carried along the trail's head.
                    tmp[0] = origin[0] * scale;
                    tmp[1] = origin[1] * scale;
                    tmp[2] = origin[2] * scale;
                    quatTurn(pose.q, tmp, centre);
                    for (let s = 0; s < S; s++) {
                        flight.shipPoint(i, age - (s / (S - 1)) * span, samples[s]);
                        const k = 1 - s / (S - 1);
                        samples[s][0] += centre[0] * k;
                        samples[s][1] += centre[1] * k;
                        samples[s][2] += centre[2] * k;
                    }
                    const width = trail.width * scale * 0.5;
                    const fade = Math.min(1, pose.speed / 40) * pose.presence;
                    // (A far courier's trail is vapour in the dawn more than its engine's colour.)
                    const hue = trail.pale ? mixRgb(own, WHITE, trail.pale, pale) : own;
                    ribbonThrough(nRibbons, S, eye, width, width * 2.6, 0, trail.vapour, hue, trail.gain * (1 + 1.5 * pose.throttle) * fade * (far ? 1.6 : 1));
                    nRibbons += 1;
                }

                // ── Spray under a hull skimming the lagoon; rings under one that hangs over it ──
                if (hooks && sortie.spray && pose.p[1] < 9 * scale && pose.speed > 30) {
                    const tick = Math.floor(t / SPRAY_EVERY);
                    if (flight.sprayTick[i] !== tick) {
                        flight.sprayTick[i] = tick;
                        hooks.spray?.(pose.p[0], pose.p[2], 1 - pose.p[1] / (9 * scale), own);
                    }
                }
            }
            if (hooks && sortie.downwash) {
                flight.pose(0, age, pose);
                if (pose.presence > 0.5 && pose.speed < 7 && pose.p[1] < 48) {
                    const tick = Math.floor(age / WASH_EVERY);
                    if (flight.washTick !== tick) {
                        flight.washTick = tick;
                        hooks.wash?.(pose.p[0], pose.p[2], own, 1 - pose.p[1] / 60);
                    }
                }
            }
            // ── Its beam, from under the hull down to what it lights ──
            if (beam > 0.001 && sortie.beam && nRibbons < RIBBONS) {
                flight.pose(0, age, pose);
                const to = sortie.beam.to === 'apex' ? frame.apex : frame.halcyonTop;
                if (to) {
                    samples[0][0] = pose.p[0];
                    samples[0][1] = pose.p[1] - 1.2;
                    samples[0][2] = pose.p[2];
                    samples[1][0] = to[0];
                    samples[1][1] = to[1] - 1.5;
                    samples[1][2] = to[2];
                    mixRgb(own, WHITE, 0.5, pale);
                    ribbonThrough(nRibbons, 2, eye, 1.2, 4.5, 1, 0, pale, 0.9 * beam * pose.presence);
                    nRibbons += 1;
                    // What the beam lays on the crystal, the crystal keeps.
                    if (hooks) {
                        const tick = Math.floor(age / 0.9);
                        if (flight.giftTick !== tick) {
                            flight.giftTick = tick;
                            hooks.gift?.(sortie.beam.to === 'apex' ? 0 : 1, own, 0.5 * beam, null);
                        }
                    }
                }
            }
        }
        state.ships = nShips;
        state.lamps = nLamps;
        state.ribbons = nRibbons;
        if (nShips === 0) {
            idle(warm);
            return;
        }
        hulls.mesh.visible = true;
        geometry.instanceCount = nShips;
        lights.mesh.visible = nLamps > 0;
        lightGeometry.instanceCount = Math.max(1, nLamps);
        lightGeometry.getAttribute('aAt').needsUpdate = true;
        lightGeometry.getAttribute('aTint').needsUpdate = true;
        trails.mesh.visible = nRibbons > 0;
        ribbonGeometry.setDrawRange(0, Math.max(1, nRibbons) * (S - 1) * 6);
        ribbonGeometry.getAttribute('position').needsUpdate = true;
        ribbonGeometry.getAttribute('aRib').needsUpdate = true;
        ribbonGeometry.getAttribute('aTint').needsUpdate = true;
    };

    return {
        hulls,
        lights,
        trails,
        update,
        /**
         * Fly sortie `name` from world time `start` (the board's salutes, captures). `seed` draws its
         * numbers; `opts` are the sortie's own (a salute's `count`).
         */
        call(name, start, seed = 1, opts = undefined) {
            const sortie = makeSortie(name, seed, opts);
            if (!sortie) return false;
            // The same call twice (a replay stepping over its moment again) is one flight.
            if (calls.some((c) => c.sortie.name === name && Math.abs(c.start - start) < 1e-6)) return true;
            if (calls.length >= 6) calls.shift();
            calls.push({ sortie, start });
            return true;
        },
        /** A rebuilt or reseeked sky: nothing called, the pipelines warmed again. */
        reset() {
            calls.length = 0;
            flights.clear();
        },
        state,
    };
}
