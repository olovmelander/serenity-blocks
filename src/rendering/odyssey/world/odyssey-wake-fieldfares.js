/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE GUST'S FIELDFARES — the birds the turn's gust lifts out of the broadleaf crowns
 * (odyssey-turn-wake.js), drawn as the Blender fieldfare (2026-11-22).
 *
 * They were flat dark cut-outs: one quad per bird, cut by an alpha test into two wings at the
 * beat's angle and a small body, the same dark brown seen from every side. Near the rail they
 * come to 60-100 px on a phone, beside Blender gulls, swallows, geese and an eagle, and the owner
 * asked for them to be modelled properly. Now each is the fieldfare `odyssey_birds.py` builds
 * (scripts/blender/odyssey; 602 triangles): the chestnut back between a blue-grey head and rump,
 * the black tail, the white underwing that flashes with every beat, the spotted rust breast;
 * folded by the bird rig (composition/odyssey-bird-rig.js) on the keyframed beat.
 *
 * THE FLIGHT is the wake's own: each bird keeps the route `turnWakeBirdAt` gives it (out of its
 * crown, over the forest on an arc with one wheel, into a crown downwind), and everything else
 * follows from that route in closed form, so it holds at any frame rate and any clock jump:
 *   - it faces along its velocity (the route's derivative), its climb and its dive held to a
 *     bird's (`pitch`), its heading leaning toward the hop where the route rises straight up
 *     out of the crown (`headingBias`);
 *   - it banks into its turn by its sideways acceleration (the route's second derivative), once
 *     it has the speed to turn on its wings (`bankSpeed`);
 *   - it beats hard as it climbs out of the crown, then flies a thrush's way: bursts of beats
 *     and short bounds with the wings drawn in (the Blender `bound` pose) and the body dipping;
 *     it glides in with its wings spread and flutters as it drops into the crown it settles in;
 *   - its tail spreads as it lifts and as it brakes, and twists with the bank.
 * `wakeFieldfareFrameAt` and `wakeFieldfarePoseAt` are the vertex stage's CPU twins (the tests).
 *
 * LIGHT: the land's own (the world renderer's `lightAt`: the sun as it falls on that place, under
 * the drifting and the turning shade), the sky from above, the forest bounced up under the wings,
 * a rim of sky on the edges, then the world's own air (`toOutput`). The sun keeps its brightness
 * and BIRD_SUN_HUE of its hue, as on every Blender bird (a low sun turns chestnut orange).
 *
 * COST: one instanced opaque draw, 33 birds x 602 triangles (~20 k), drawn only while a wake is
 * in the air: it is a child of the wake's mesh, shown and hidden with it, and compiled with the
 * world (the world's prewarm reveals every descendant).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, atan, attribute, cameraPosition, clamp, cos, dot, faceDirection, float, fract, length, max, mix,
    modelWorldMatrix, normalize, positionLocal, positionWorld, sin, smoothstep, varying, vec2, vec3, vec4,
} from 'three/tsl';
import {
    BIRD_SUN_HUE, beatHarmonicsNode, beatSeriesConstants, beatSeriesNode, birdWingPoseAt, decodeBirdModel,
    foldBirdNode, setBirdTemplate, smootherstep, smootherstepNode, tailBirdNode,
} from '../composition/odyssey-bird-rig.js';
import { ODYSSEY_DAY_TURN } from './odyssey-day-turn.js';
import { ODYSSEY_TURN_WAKE } from './odyssey-turn-wake.js';

export const WAKE_FIELDFARES = Object.freeze({
    /** Wingspan (world units): the cut-outs' size (about ten times life, to read 150-300 u off). */
    span: Object.freeze([3.6, 4.8]),
    /** Each bird's own beat rate: the model's, times 1 -/+ half of this. */
    rateJitter: 0.16,
    /** Full beats as it climbs out of the crown, easing into the bursts over these seconds. */
    takeoff: Object.freeze([1.3, 2.1]),
    /** Bursts: beating while sin(age * rate + seed) is above [from, to] (a thrush's 4-5 beats, then a
     * bound of about half a second). */
    bursts: Object.freeze([-0.35, 0.15, 4.4]),
    /** How far a bound draws the wings in (0 glide .. 1 the Blender bound pose), and how far the
     * body dips in it (u). */
    bound: 0.9,
    dip: 0.45,
    /** Seconds before it settles: the glide in begins and is whole, then the flutter into the
     * crown begins and is whole. */
    landing: Object.freeze([1.8, 1.2, 0.8, 0.45]),
    /** Its heading leans toward the hop by this speed (u/s) where the route has none of its own. */
    headingBias: 6,
    /** The dive and the climb it leans toward and never reaches (rad; a soft limit, so the body
     * never stops turning with a corner): it flushes steeply out of a crown and drops more gently
     * into the next. */
    pitch: Object.freeze([-0.6, 0.85]),
    /** Bank: sideways acceleration over this (u/s^2) is the bank's tangent, softly held under
     * `bankMax`, and only as it has the speed to turn on its wings (in over this horizontal speed,
     * u/s): a bird lifting out of a crown or dropping into one is not banking. */
    bankGain: 14,
    bankMax: 0.85,
    bankSpeed: Object.freeze([8, 22]),
    /** The tail: spread at rest, more as it lifts and brakes; twist per radian of bank. */
    tail: Object.freeze([0.10, 0.22, 0.25]),
    /** The forest's colour bounced up under the wings (linear). */
    bounce: Object.freeze([0.10, 0.13, 0.07]),
});

const TAU = Math.PI * 2;
const B = ODYSSEY_TURN_WAKE.birds;
// Downwind (the turning shade's heading) and across it: the wheel swings the bird across.
const HX = ODYSSEY_DAY_TURN.heading[0];
const HZ = ODYSSEY_DAY_TURN.heading[1];
const PX = -HZ;
const PZ = HX;
/** x held softly under m (C-infinity; slope 1 at 0, never reaching m). */
const soft = (x, m) => (m * x) / Math.sqrt((m * m) + (x * x));

/** A bird's wingspan (u), from its seed. */
export function wakeFieldfareSpan(bird, cfg = WAKE_FIELDFARES) {
    return cfg.span[0] + ((cfg.span[1] - cfg.span[0]) * bird.s2);
}

/**
 * The route `turnWakeBirdAt` flies, with its velocity (u/s) and acceleration (u/s^2), `age`
 * seconds after the bird lifted (clamped to its flight).
 */
export function wakeFieldfareMotionAt(bird, age) {
    const a = Math.min(Math.max(age, 0), bird.life);
    const L = bird.life;
    const u = a / L;
    const e = u * u * (3 - (2 * u));
    const e1 = 6 * u * (1 - u);
    const e2 = 6 * (1 - (2 * u));
    const arc = 4 * u * (1 - u);
    const arc1 = 4 * (1 - (2 * u));
    const arc2 = -8;
    const W = B.wheel[0] + ((B.wheel[1] - B.wheel[0]) * bird.s2);
    const k = TAU * B.turns;
    const phi = (k * u) + (bird.s1 * TAU);
    const s = Math.sin(phi);
    const c = Math.cos(phi);
    const wheel = s * arc * W;
    const wheel1 = W * ((k * c * arc) + (s * arc1));
    const wheel2 = W * ((-k * k * s * arc) + (2 * k * c * arc1) + (s * arc2));
    const D = [bird.tx - bird.x, bird.ty - bird.y, bird.tz - bird.z];
    return {
        position: [
            bird.x + (D[0] * e) + (PX * wheel),
            bird.y + (D[1] * e) + (arc * bird.rise),
            bird.z + (D[2] * e) + (PZ * wheel),
        ],
        velocity: [
            ((D[0] * e1) + (PX * wheel1)) / L,
            ((D[1] * e1) + (bird.rise * arc1)) / L,
            ((D[2] * e1) + (PZ * wheel1)) / L,
        ],
        acceleration: [
            ((D[0] * e2) + (PX * wheel2)) / (L * L),
            ((D[1] * e2) + (bird.rise * arc2)) / (L * L),
            ((D[2] * e2) + (PZ * wheel2)) / (L * L),
        ],
    };
}

/**
 * The body's frame `age` seconds after it lifted (the vertex stage's twin): where it is, the way
 * it faces (`forward`, `left`, `up`: unit, right-handed as the bird frame), its pitch and bank.
 */
export function wakeFieldfareFrameAt(bird, age, cfg = WAKE_FIELDFARES) {
    const { position, velocity: v, acceleration: acc } = wakeFieldfareMotionAt(bird, age);
    const dx = bird.tx - bird.x;
    const dz = bird.tz - bird.z;
    const dl = Math.hypot(dx, dz) || 1;
    let hx = v[0] + ((dx / dl) * cfg.headingBias);
    let hz = v[2] + ((dz / dl) * cfg.headingBias);
    const hl = Math.hypot(hx, hz) || 1;
    hx /= hl;
    hz /= hl;
    const speedH = Math.hypot(v[0], v[2]);
    const rise = Math.atan2(v[1], Math.sqrt((speedH * speedH) + 4));
    const pitch = soft(rise, rise < 0 ? -cfg.pitch[0] : cfg.pitch[1]);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const forward = [hx * cp, sp, hz * cp];
    const left0 = [hz, 0, -hx];
    const up0 = [-hx * sp, cp, -hz * sp];
    const side = (acc[0] * left0[0]) + (acc[2] * left0[2]);
    const roll = soft(Math.atan(-side / cfg.bankGain), cfg.bankMax)
        * smootherstep(cfg.bankSpeed[0], cfg.bankSpeed[1], speedH);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    return {
        position,
        forward,
        left: [0, 1, 2].map((i) => (left0[i] * cr) + (up0[i] * sr)),
        up: [0, 1, 2].map((i) => (up0[i] * cr) - (left0[i] * sr)),
        pitch,
        roll,
    };
}

/**
 * How much of a beat (`weight`), of a bound (`bound`), of the lift and the brake (`brake`) at
 * `age`. Every ramp is C2 and the beat's reasons are joined as 1 - (1 - a)(1 - b)(1 - c), not
 * by a max, so the wings never change pace with a corner where one reason takes over.
 */
export function wakeFieldfareRhythmAt(bird, age, cfg = WAKE_FIELDFARES) {
    const a = Math.min(Math.max(age, 0), bird.life);
    const [l0, l1, f0, f1] = cfg.landing;
    const takeoff = 1 - smootherstep(cfg.takeoff[0], cfg.takeoff[1], a);
    const [b0, b1, br] = cfg.bursts;
    const gate = smootherstep(b0, b1, Math.sin((a * br) + (bird.s1 * 9)));
    const glideIn = smootherstep(bird.life - l0, bird.life - l1, a);
    const flutter = smootherstep(bird.life - f0, bird.life - f1, a);
    return {
        weight: 1 - ((1 - takeoff) * (1 - (gate * (1 - glideIn))) * (1 - flutter)),
        bound: cfg.bound * (1 - gate) * (1 - takeoff) * (1 - glideIn),
        brake: 1 - ((1 - takeoff) * (1 - glideIn)),
    };
}

/**
 * The wing pose `age` seconds after it lifted (the twin): the glide drawn toward the bound, the
 * keyframed beat over that by the beat's weight, the body's heave, the tail's spread and twist.
 */
export function wakeFieldfarePoseAt(bird, age, out = {}, cfg = WAKE_FIELDFARES) {
    const model = decodeBirdModel('fieldfare');
    const { glide, bound: tuck } = model.flight;
    const r = wakeFieldfareRhythmAt(bird, age, cfg);
    const rate = model.flight.rate * (1 - (cfg.rateJitter / 2) + (cfg.rateJitter * bird.s1));
    const a = Math.min(Math.max(age, 0), bird.life);
    const phase = (a * rate) + (bird.s2 * 7);
    const held = {};
    Object.keys(glide).forEach((n) => { held[n] = glide[n] + ((tuck[n] - glide[n]) * r.bound) - glide[n]; });
    birdWingPoseAt(model, (phase - Math.floor(phase)) * TAU, r.weight, out, held);
    const frame = wakeFieldfareFrameAt(bird, age, cfg);
    out.tailSpread = cfg.tail[0] + (cfg.tail[1] * r.brake);
    out.tailTwist = cfg.tail[2] * frame.roll;
    out.weight = r.weight;
    out.bound = r.bound;
    return out;
}

/** `soft` in the vertex stage. */
function softNode(x, m) {
    return m.mul(x).div(m.mul(m).add(x.mul(x)).sqrt());
}

/**
 * @param {object} p
 * @param {Array<object>} p.birds  the wake's birds (`planTurnWake(...).birds`)
 * @param {object} p.time          float node: the world's clock
 * @param {object} p.uWake         the wake's uniform (the clock when the gust was let go, the
 *   rail's x and z then): the turn wake's `uniforms.uWake`
 * @param {(xz: object) => {sun: object, direct: object}} [p.lightAt]  the land's light at a place
 * @param {object} p.skyColour     vec3 node: the sky's light
 * @param {object} [p.sunDir]      vec3 node or array: toward the sun (the world group's frame)
 * @param {(colour: object, at: object) => object} p.toOutput  the world's air and output stage
 * @returns {null | {mesh: object, dispose: Function}} null when there is no bird
 */
export function createWakeFieldfares({
    birds, time, uWake, lightAt = null, skyColour, sunDir = [-0.46, 0.36, 0.61], toOutput,
}, cfg = WAKE_FIELDFARES) {
    if (!birds || !birds.length) return null;
    const model = decodeBirdModel('fieldfare');
    const geometry = setBirdTemplate(new THREE.InstancedBufferGeometry(), model, THREE.BufferAttribute);
    // aFrom: the crown it leaves (xyz) and how long after the gust reaches it it lifts (s).
    // aInto: the crown it settles in (xyz) and the arc's height (u).
    // aFly: seconds in the air, two seeds, the wingspan (u).
    const aFrom = new Float32Array(birds.length * 4);
    const aInto = new Float32Array(birds.length * 4);
    const aFly = new Float32Array(birds.length * 4);
    birds.forEach((b, i) => {
        aFrom.set([b.x, b.y, b.z, b.wait], i * 4);
        aInto.set([b.tx, b.ty, b.tz, b.rise], i * 4);
        aFly.set([b.life, b.s1, b.s2, wakeFieldfareSpan(b, cfg)], i * 4);
    });
    geometry.setAttribute('aFrom', new THREE.InstancedBufferAttribute(aFrom, 4));
    geometry.setAttribute('aInto', new THREE.InstancedBufferAttribute(aInto, 4));
    geometry.setAttribute('aFly', new THREE.InstancedBufferAttribute(aFly, 4));
    geometry.instanceCount = birds.length;

    const { glide } = model.flight;
    const tuck = model.flight.bound;
    const sun = Array.isArray(sunDir) ? vec3(...new THREE.Vector3(...sunDir).normalize().toArray()) : sunDir;
    const vN = varying(vec3(0, 1, 0), 'wakeBirdN');
    const vAt = varying(vec3(0), 'wakeBirdAt');
    const vSun = varying(vec3(0), 'wakeBirdSun');
    const vFar = varying(float(0), 'wakeBirdFar');

    const positionNode = Fn(() => {
        const from = attribute('aFrom', 'vec4');
        const into = attribute('aInto', 'vec4');
        const fly = attribute('aFly', 'vec4');
        const life = fly.x;
        const s1 = fly.y;
        const s2 = fly.z;
        // Seconds since the gust reached its tree and it lifted (the leaves' clock).
        const age = time.sub(uWake.x)
            .sub(length(from.xz.sub(uWake.yz)).div(ODYSSEY_TURN_WAKE.gustSpeed))
            .sub(from.w)
            .toVar();
        const a = clamp(age, 0, life).toVar();

        // ── the route and its derivatives (the twin: wakeFieldfareMotionAt) ──
        const u = a.div(life).toVar();
        const e = u.mul(u).mul(float(3).sub(u.mul(2)));
        const e1 = u.mul(float(1).sub(u)).mul(6);
        const e2 = float(1).sub(u.mul(2)).mul(6);
        const arc = u.mul(float(1).sub(u)).mul(4);
        const arc1 = float(1).sub(u.mul(2)).mul(4);
        const W = mix(float(B.wheel[0]), float(B.wheel[1]), s2);
        const k = TAU * B.turns;
        const phi = u.mul(k).add(s1.mul(TAU)).toVar();
        const sPhi = sin(phi).toVar();
        const cPhi = cos(phi).toVar();
        const wheel = sPhi.mul(arc).mul(W);
        const wheel1 = W.mul(cPhi.mul(arc).mul(k).add(sPhi.mul(arc1)));
        const wheel2 = W.mul(sPhi.mul(arc).mul(-k * k).add(cPhi.mul(arc1).mul(2 * k)).sub(sPhi.mul(8)));
        const D = into.xyz.sub(from.xyz).toVar();
        const P = vec3(PX, 0, PZ);
        const Y = vec3(0, 1, 0);
        const centre = from.xyz.add(D.mul(e)).add(P.mul(wheel)).add(Y.mul(arc.mul(into.w)))
            .toVar();
        const vel = D.mul(e1).add(P.mul(wheel1)).add(Y.mul(arc1.mul(into.w))).div(life)
            .toVar();
        const acc = D.mul(e2).add(P.mul(wheel2)).add(Y.mul(into.w.mul(-8))).div(life.mul(life));

        // ── the body's frame (the twin: wakeFieldfareFrameAt) ──
        const hop = normalize(D.xz.add(vec2(0, 1e-4)));
        const h = normalize(vel.xz.add(hop.mul(cfg.headingBias))).toVar();
        const speedH = length(vel.xz).toVar();
        const rise = atan(vel.y, speedH.mul(speedH).add(4.0).sqrt()).toVar();
        const pitch = softNode(rise, rise.lessThan(0.0).select(float(-cfg.pitch[0]), float(cfg.pitch[1])));
        const cp = cos(pitch);
        const sp = sin(pitch);
        const forward = vec3(h.x.mul(cp), sp, h.y.mul(cp)).toVar();
        const left0 = vec3(h.y, 0, h.x.negate()).toVar();
        const up0 = vec3(h.x.negate().mul(sp), cp, h.y.negate().mul(sp)).toVar();
        const roll = softNode(atan(dot(acc, left0).negate().div(cfg.bankGain)), float(cfg.bankMax))
            .mul(smootherstepNode(cfg.bankSpeed[0], cfg.bankSpeed[1], speedH))
            .toVar();
        const cr = cos(roll);
        const sr = sin(roll);
        const left = left0.mul(cr).add(up0.mul(sr)).toVar();
        const up = up0.mul(cr).sub(left0.mul(sr)).toVar();

        // ── the rhythm (the twin: wakeFieldfareRhythmAt) ──
        const [l0, l1, f0, f1] = cfg.landing;
        const takeoff = float(1).sub(smootherstepNode(cfg.takeoff[0], cfg.takeoff[1], a)).toVar();
        const [b0, b1, br] = cfg.bursts;
        const gate = smootherstepNode(b0, b1, sin(a.mul(br).add(s1.mul(9.0)))).toVar();
        const glideIn = smootherstepNode(life.sub(l0), life.sub(l1), a).toVar();
        const flutter = smootherstepNode(life.sub(f0), life.sub(f1), a);
        const weight = float(1).sub(float(1).sub(takeoff).mul(float(1).sub(gate.mul(float(1).sub(glideIn))))
            .mul(float(1).sub(flutter)))
            .toVar();
        const bound = float(cfg.bound).mul(float(1).sub(gate)).mul(float(1).sub(takeoff))
            .mul(float(1).sub(glideIn))
            .toVar();
        const brake = float(1).sub(float(1).sub(takeoff).mul(float(1).sub(glideIn)));

        // ── the wings: the glide drawn toward the bound, the keyframed beat over it ──
        const rate = float(model.flight.rate).mul(s1.mul(cfg.rateJitter).add(1 - (cfg.rateJitter / 2)));
        const beatPhi = fract(a.mul(rate).add(s2.mul(7.0))).mul(TAU).toVar();
        const hs = beatHarmonicsNode(beatPhi);
        const series = beatSeriesConstants(model);
        const held = (n) => mix(float(glide[n]), float(tuck[n]), bound);
        const pose = (n) => mix(held(n), beatSeriesNode(series[n], hs), weight).toVar();
        const heave = beatSeriesNode(series.heave, hs).mul(weight);
        const tailed = tailBirdNode({
            position: positionLocal,
            normal: attribute('normal', 'vec3'),
            tail: attribute('aTop', 'vec4').w,
            spread: brake.mul(cfg.tail[1]).add(cfg.tail[0]),
            twist: roll.mul(cfg.tail[2]),
            tailY: float(model.tailY),
        });
        const { local, normal } = foldBirdNode({
            position: tailed.position,
            normal: tailed.normal,
            hinge: attribute('aHinge', 'vec4'),
            pose: {
                lift: pose('lift'), sweep: pose('sweep'), bend: pose('bend'), fold: pose('fold'), curl: pose('curl'),
            },
            shoulder: model.shoulder,
            wrist: model.wrist,
        });

        // ── how much of it: it grows out of its crown and shrinks into the next ──
        const shown = smoothstep(0, B.grow, age).mul(float(1).sub(smoothstep(life.sub(B.settle), life, age)));
        const size = fly.w.div(model.span).mul(shown);
        const body = centre.add(Y.mul(bound.mul(-cfg.dip))).toVar();

        // ── its light: the land's sun on this place, how far off it is ──
        const land = lightAt ? lightAt(centre.xz) : { sun: vec3(1.0, 0.93, 0.80), direct: float(1) };
        vSun.assign(land.sun.mul(land.direct));
        vAt.assign(centre);
        vN.assign(left.mul(normal.x).add(up.mul(normal.y)).add(forward.mul(normal.z)));
        // A far bird darkens toward its silhouette (the flights' rule: under ~24 px across it reads
        // only while darker than the air behind it).
        const seen = modelWorldMatrix.mul(vec4(centre, 1.0)).xyz;
        const across = fly.w.div(max(length(seen.sub(cameraPosition)), 1.0));
        vFar.assign(float(1).sub(smoothstep(0.0048, 0.0192, across)));
        return body.add(left.mul(local.x).add(up.mul(local.y.add(heave))).add(forward.mul(local.z)).mul(size));
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OdysseyWakeFieldfares';
    material.positionNode = positionNode;
    material.colorNode = Fn(() => {
        // (Clamped: with MSAA a varying is read at the pixel centre on a sliver of a far wing.)
        const top = clamp(attribute('aTop', 'vec4').xyz, 0.0, 1.0);
        const under = clamp(attribute('aUnder', 'vec3'), 0.0, 1.0);
        const thin = clamp(attribute('aHinge', 'vec4').w, 0.0, 1.0);
        const far = clamp(vFar, 0.0, 1.0);
        const albedo = mix(under, top, faceDirection.mul(0.5).add(0.5)).mul(float(1).sub(far.mul(0.5)));
        const N = normalize(vN.add(vec3(0, 1e-5, 0))).mul(faceDirection).toVar();
        const V = normalize(cameraPosition.sub(positionWorld));
        const ndl = clamp(dot(N, sun), 0.0, 1.0);
        const skyUp = clamp(N.y, 0.0, 1.0);
        const groundUp = clamp(N.y.negate(), 0.0, 1.0);
        const sunLight = mix(vec3(dot(vSun, vec3(0.2126, 0.7152, 0.0722))), vSun, BIRD_SUN_HUE);
        const ambient = skyColour.mul(skyUp.mul(0.22).add(0.18)).add(vec3(...cfg.bounce).mul(groundUp.mul(0.45)));
        const lit = albedo.mul(sunLight.mul(ndl.mul(0.92)).add(ambient));
        const edge = float(1.0).sub(abs(dot(N, V)));
        const rim = skyColour.mul(edge.mul(edge).mul(edge).mul(thin.mul(0.14).add(0.06))).mul(float(1).sub(far));
        return toOutput(lit.add(rim), vAt);
    })();
    material.side = THREE.DoubleSide;
    material.depthWrite = true;
    // It carries the world's own air (toOutput); scene fog is not the world's.
    material.fog = false;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-world-turn-wake-fieldfares';
    // Placed in the vertex stage from the routes: the template's bounds mean nothing.
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.removeFromParent();
        },
    };
}
