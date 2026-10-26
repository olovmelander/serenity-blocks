/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Waves — a dolphin's splashes, choreographed from its leap.
 *
 * Leaving the face: a burst of water it shoves ahead of it, thrown in a cone about its heading;
 * a rim of spray round the hole; a sheet of water dragged up through the hole after the body
 * until the flukes are out, and their last flick; then what runs off its flukes and fins rains
 * back in a dotted arc under the first half of the leap (backlit, a chain of sparks when it
 * crosses the sun). A boil of white water over the hole hides the moment it breaks out.
 *
 * Going back in: the nose cuts in and throws two low sheets aside along the slit; the body goes
 * under and the water closes over it in a crown that leans the way it went; the flukes go under
 * last and kick a tall plume of spray and big drops up and back. White water boils up in the
 * crown and the kick, and foam lies on the water after them.
 *
 * Every drop and puff is written the moment the dolphin breaks the surface, each with its own
 * birth on the world's clock (the trail's up to a few seconds ahead): nothing is stepped per
 * frame, so a splash looks the same at any frame rate and holds with the clock (four lines).
 * The drops go to the world's spray pool (waves-spray.js); the white water is its own pool
 * (FoamPool, below): additive, premultiplied, alpha 0, like everything in the air here.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, clamp, dot, exp, float, fract, length, max, mix, normalize, positionGeometry,
    smoothstep, texture, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { FLOW, TAU, wavePoint } from './waves-core.js';
import { FLUKE_REACH, NOSE_REACH, dolphinPose } from './waves-life.js';
import {
    additive, cameraRight, cameraUp, quads,
} from './waves-spray.js';

/** The white of the sea's own water in the air (the world's crowns use it too). */
export const SEA_WHITE = Object.freeze([1, 0.95, 0.86]);

/** The spray pool a splash is drawn for (the High tier's): a smaller pool gets fewer drops. */
const FULL_POOL = 2400;

/** How many of its drops a splash throws, for a spray pool of `count` (High's pool throws them all). */
export function splashDensity(count) {
    return Math.max(0.2, Math.min(1, count / FULL_POOL));
}

// ── White water ─────────────────────────────────────────────────────────────────────────────

const FOAM_STRIDE = 12;
/** How fast a puff's throw dies in the air (per second): it bursts out, then hangs. */
export const FOAM_DRAG = 1.8;
/** How fast a puff's spreading slows (per second). */
export const FOAM_EASE = 0.9;
/** The offshore wind carries what hangs in the air back over the wave (metres a second). */
export const FOAM_WIND = Object.freeze({ x: 0.22, z: FLOW.z * 0.35 });

/** How far a throw under FOAM_DRAG has carried a puff `t` seconds after it left (per m/s). */
export const foamThrow = (t) => (1 - Math.exp(-FOAM_DRAG * Math.max(0, t))) / FOAM_DRAG;

/**
 * Soft, torn puffs of white water: what a dolphin tears up where it breaks the surface, thrown
 * out and up, spreading and thinning as they hang. One that lies on the water (`flat`) is foam:
 * wide, low, lingering. Each puff is written once, when it leaves:
 * (x, y, z, birth), (vx, vy, vz, size), (spread, life, strength, flat); the vertex stage moves it
 * from there (a throw that dies under drag, the wind), like the drops: closed form.
 */
export class FoamPool {
    constructor({ tier, U, noise }) {
        this.count = Math.max(4, tier.foam);
        this.U = U;
        this.cursor = 0;
        this.data = new Float32Array(this.count * FOAM_STRIDE);
        const { base, geometry } = quads(this.count);
        this.buffer = new THREE.InstancedInterleavedBuffer(this.data, FOAM_STRIDE);
        this.buffer.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('aStart', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
        geometry.setAttribute('aMove', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
        geometry.setAttribute('aLook', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
        this.base = base;
        this.geometry = geometry;

        const aStart = attribute('aStart', 'vec4');
        const aMove = attribute('aMove', 'vec4');
        const aLook = attribute('aLook', 'vec4');
        const material = additive('waves-foam');
        const age = U.time.sub(aStart.w);
        const t = max(age, 0.0);
        const life = max(aLook.y, 0.05);
        const flat = aLook.w;
        const thrown = float(1.0).sub(exp(t.mul(-FOAM_DRAG))).div(FOAM_DRAG);
        // Foam on the water drifts with it, slower than the spray the wind takes.
        const drift = vec3(FOAM_WIND.x, 0.0, FOAM_WIND.z).mul(t).mul(float(1.0).sub(flat.mul(0.5)));
        const centre = aStart.xyz.add(aMove.xyz.mul(thrown)).add(drift);
        const spread = float(1.0).sub(exp(t.mul(-FOAM_EASE))).div(FOAM_EASE);
        const size = aMove.w.add(aLook.x.mul(spread));
        const fade = smoothstep(0.0, 0.1, age).mul(float(1.0).sub(smoothstep(life.mul(0.3), life, age)));
        const wide = mix(float(1.0), float(2.4), flat);
        const tall = mix(float(1.0), float(0.42), flat);
        material.positionNode = centre
            .add(cameraRight().mul(positionGeometry.x.mul(size).mul(wide)))
            .add(cameraUp().mul(positionGeometry.y.mul(size).mul(tall)));
        // Lit like everything in the air here, a little whiter than the spindrift: mostly by the
        // sun standing behind it.
        const toPuff = normalize(centre.sub(cameraPosition));
        const forward = clamp(dot(toPuff, U.sun), 0.0, 1.0);
        const f2 = forward.mul(forward);
        const f4 = f2.mul(f2);
        const light = vec3(0.5, 0.58, 0.64).mul(U.light.skyTint)
            .add(vec3(2.4, 1.35, 0.55).mul(f4.mul(f4)).mul(0.8).add(vec3(1.0, 0.62, 0.3).mul(f2).mul(0.4))
                .mul(U.light.fireTint))
            .mul(mix(vec3(1.0), vec3(1.15, 1.0, 0.82), U.warm));
        const vLook = varying(light.mul(fade).mul(aLook.z), 'vWaveFoam');
        const vSeed = varying(vec4(
            fract(aStart.x.mul(0.731).add(aStart.w.mul(1.37))),
            fract(aStart.z.mul(0.519).add(aStart.w.mul(2.11))),
            clamp(age.div(life), 0.0, 1.0),
            flat,
        ), 'vWaveFoamSeed');
        material.outputNode = Fn(() => {
            const p = uv().sub(0.5).mul(2.0);
            const d = length(p);
            // A boil, not a disc: a dense heart torn into lobes at its edge, thinner as it ages.
            const at = uv().mul(0.5).add(vec2(vSeed.x.mul(7.3), vSeed.y.mul(3.1))).add(vec2(vSeed.z.mul(0.2), 0.0));
            const wisp = texture(noise, at).b.mul(0.65).add(texture(noise, at.mul(2.7)).a.mul(0.35));
            const torn = smoothstep(0.05, 0.5, wisp.sub(d.mul(d).mul(mix(float(0.5), float(0.8), vSeed.z))));
            const soft = float(1.0).sub(smoothstep(0.5, 1.0, d));
            const heart = exp(d.mul(d).mul(-3.0));
            return vec4(vLook.mul(torn).mul(soft).mul(heart.mul(0.5).add(0.5)), 0.0);
        })();
        this.material = material;
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.name = 'waves-foam';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 30;
        this.reset();
    }

    reset() {
        this.cursor = 0;
        for (let i = 0; i < this.count; i += 1) {
            const at = i * FOAM_STRIDE;
            this.data.fill(0, at, at + FOAM_STRIDE);
            this.data[at + 3] = -1e4;
            this.data[at + 9] = 0.1;
        }
        this.buffer.needsUpdate = true;
    }

    /** Seconds puff `i` still has to show at `now` (≤ 0: gone). */
    remaining(i, now) {
        const at = i * FOAM_STRIDE;
        return this.data[at + 9] - (now - this.data[at + 3]);
    }

    /** The slot the next puff takes: a spent one from the cursor on, else the one nearest its end. */
    slotFor(now) {
        let best = this.cursor;
        let least = Infinity;
        for (let k = 0; k < this.count; k += 1) {
            const i = (this.cursor + k) % this.count;
            const left = this.remaining(i, now);
            if (left <= 0) {
                best = i;
                break;
            }
            if (left < least) {
                least = left;
                best = i;
            }
        }
        this.cursor = (best + 1) % this.count;
        return best;
    }

    /**
     * One puff, written at `now`, leaving (x, y, z) at `birth` (past or future).
     * @param {object} [o]
     * @param {number[]} [o.v]       its throw (m/s), dying away under FOAM_DRAG
     * @param {number} [o.size]      half its width as it leaves (metres)
     * @param {number} [o.spread]    metres a second it spreads at first
     * @param {number} [o.life]      seconds it shows
     * @param {number} [o.strength]  how much light it adds
     * @param {number} [o.flat]      1: foam lying on the water; 0: a puff in the air
     */
    puff(now, birth, x, y, z, {
        v = [0, 0, 0], size = 0.3, spread = 0.4, life = 2, strength = 0.3, flat = 0,
    } = {}) {
        const at = this.slotFor(now) * FOAM_STRIDE;
        const d = this.data;
        d[at] = x;
        d[at + 1] = y;
        d[at + 2] = z;
        d[at + 3] = birth;
        d[at + 4] = v[0];
        d[at + 5] = v[1];
        d[at + 6] = v[2];
        d[at + 7] = size;
        d[at + 8] = spread;
        d[at + 9] = life;
        d[at + 10] = strength;
        d[at + 11] = flat;
        this.buffer.needsUpdate = true;
    }

    dispose() {
        this.mesh.removeFromParent();
        this.geometry.dispose();
        this.base.dispose();
        this.material.dispose();
    }
}

// ── The choreography ────────────────────────────────────────────────────────────────────────

/**
 * The dolphins leap 9 to 18 metres from the eye, where a drop of spray is less than a pixel: a
 * splash that far off throws its drops as clumps, drawn bigger with the distance (never smaller
 * than up close), and its white water a little bigger too.
 */
export function splashReach(x, y, z, eye) {
    if (!eye) return 1;
    return Math.max(1, Math.min(2.6, Math.hypot(x - eye.x, y - eye.y, z - eye.z) / 7));
}

const pose = {};
const hold = {};
const face = {
    nx: 0, ny: 1, tx: 1, ty: 0,
};
const lo = { x: 0, y: 0, z: 0 };
const hi = { x: 0, y: 0, z: 0 };

/** The face at the hole a leap left: its normal out of the water (nx, ny) and the way up it (tx, ty). */
function faceAt(arc) {
    const d = -arc.z;
    wavePoint(arc.row - 0.01, d, arc.open, lo);
    wavePoint(arc.row + 0.01, d, arc.open, hi);
    const len = Math.hypot(hi.x - lo.x, hi.y - lo.y) || 1;
    face.tx = (hi.x - lo.x) / len;
    face.ty = (hi.y - lo.y) / len;
    face.nx = -face.ty;
    face.ny = face.tx;
    return face;
}

/** The dolphin's own frame at a pose: `side` to its left, `up` off its back (both unit). */
function frame(p, out) {
    const sl = Math.hypot(p.fx, p.fz) || 1;
    out.sx = -p.fz / sl;
    out.sy = 0;
    out.sz = p.fx / sl;
    out.ux = -out.sz * p.fy;
    out.uy = out.sz * p.fx - out.sx * p.fz;
    out.uz = out.sx * p.fy;
    return out;
}

/** A unit vector from a point toward the eye, flat on the water (white water stands in front). */
function toward(x, z, eye, out) {
    const dx = (eye ? eye.x : x) - x;
    const dz = (eye ? eye.z : z + 1) - z;
    const len = Math.hypot(dx, dz) || 1;
    out.x = dx / len;
    out.z = dz / len;
    return out;
}

const count = (n, density) => Math.max(1, Math.round(n * density));
const front = { x: 0, z: 1 };

/**
 * The dolphin breaks out of the face (`arc` = WavesPod's leap, just started).
 * @param {object} p
 * @param {import('./waves-spray.js').SprayPool} p.spray
 * @param {FoamPool} [p.foam]
 * @param {object} p.arc
 * @param {number} p.now          the world's clock as it is written
 * @param {number} [p.density]    splashDensity() of the spray pool
 * @param {{x: number, y: number, z: number}} [p.eye]  where it is seen from (splashReach)
 * @param {number[]} [p.rgb]
 */
export function dolphinBreach({
    spray, foam, arc, now, density = 1, eye = null, rgb = SEA_WHITE,
}) {
    const { rand } = spray;
    const range = (a, b) => a + (b - a) * rand();
    const { t0 } = arc;
    const {
        nx, ny, tx, ty,
    } = faceAt(arc);
    dolphinPose(arc, 0, pose);
    const f = frame(pose, {});
    const {
        fx, fy, fz, speed,
    } = pose;
    const scale = arc.size / 1.25;
    const grow = splashReach(arc.x, arc.y, arc.z, eye);
    // Round the heading: a direction `spread` radians off it, at angle `a` about it.
    const cone = (a, spread, out) => {
        const c = Math.cos(spread);
        const s = Math.sin(spread);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        out[0] = fx * c + (f.sx * ca + f.ux * sa) * s;
        out[1] = fy * c + (f.sy * ca + f.uy * sa) * s;
        out[2] = fz * c + (f.sz * ca + f.uz * sa) * s;
        return out;
    };
    const dir = [0, 0, 0];

    // The burst: the water it shoves ahead of it out of the face.
    for (let k = count(44, density); k > 0; k -= 1) {
        cone(rand() * TAU, 0.6 * Math.sqrt(rand()), dir);
        const v = speed * range(0.4, 0.95);
        const a = rand() * TAU;
        const r = range(0.1, 0.35) * scale;
        spray.drop(
            now,
            t0 + range(-0.04, 0.1),
            arc.x + tx * Math.cos(a) * r + nx * 0.04,
            arc.y + ty * Math.cos(a) * r + ny * 0.04,
            arc.z + Math.sin(a) * r,
            dir[0] * v,
            dir[1] * v,
            dir[2] * v,
            (range(0.03, 0.06) + 0.05 * rand() ** 4) * grow,
            rgb,
            range(2, 3.2),
        );
    }
    // The rim: a ring of spray thrown off the face round the hole, the flow dragging it up the face.
    for (let k = count(28, density); k > 0; k -= 1) {
        const a = rand() * TAU;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const r = range(0.25, 0.45) * scale;
        const out = range(0.25, 0.6);
        const up = range(0.3, 0.75);
        spray.drop(
            now,
            t0 + range(0, 0.15),
            arc.x + tx * ca * r + nx * 0.03,
            arc.y + ty * ca * r + ny * 0.03,
            arc.z + sa * r,
            tx * (ca * out + FLOW.u * 0.3) + nx * up,
            ty * (ca * out + FLOW.u * 0.3) + ny * up,
            sa * out + FLOW.z * 0.5,
            range(0.025, 0.05) * grow,
            rgb,
            range(1.8, 2.8),
        );
    }
    // The sheet: water dragged up through the hole after the body, until the flukes are out.
    const clear = Math.max(0.1, arc.clearAt);
    for (let k = count(40, density); k > 0; k -= 1) {
        const tau = clear * rand() ** 0.8;
        const a = rand() * TAU;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const r = range(0.15, 0.3) * scale;
        const rx = f.sx * ca + f.ux * sa;
        const ry = f.sy * ca + f.uy * sa;
        const rz = f.sz * ca + f.uz * sa;
        const drag = speed * range(0.35, 0.8) * (1 - 0.45 * (tau / clear));
        const out = range(0.06, 0.2);
        spray.drop(
            now,
            t0 + tau + 0.03,
            arc.x + rx * r,
            arc.y + ry * r,
            arc.z + rz * r,
            fx * drag + rx * out,
            fy * drag + ry * out,
            fz * drag + rz * out,
            range(0.025, 0.05) * grow,
            rgb,
            range(2.4, 3.4),
        );
    }
    // The flick: the flukes leave the hole with a last throw.
    dolphinPose(arc, clear, pose);
    frame(pose, hold);
    const tailX = pose.x - pose.fx * FLUKE_REACH * arc.size;
    const tailY = pose.y - pose.fy * FLUKE_REACH * arc.size;
    const tailZ = pose.z - pose.fz * FLUKE_REACH * arc.size;
    for (let k = count(18, density); k > 0; k -= 1) {
        const across = range(-0.3, 0.3) * arc.size;
        const keep = range(0.5, 0.85);
        const lift = range(0.05, 0.3);
        const aside = range(-0.25, 0.25);
        spray.drop(
            now,
            t0 + clear + range(-0.03, 0.08),
            tailX + hold.sx * across,
            tailY + hold.sy * across,
            tailZ + hold.sz * across,
            pose.vx * keep + hold.ux * lift + hold.sx * aside,
            pose.vy * keep + hold.uy * lift + hold.sy * aside,
            pose.vz * keep + hold.uz * lift + hold.sz * aside,
            (range(0.03, 0.055) + 0.05 * rand() ** 4) * grow,
            rgb,
            range(2.6, 3.6),
        );
    }
    // The trail: what runs off the flukes and fins over the first half of the leap, once they are
    // out of the face, slower than the body (the air takes it), so it peels off behind and below
    // and rains back.
    const from = clear;
    const to = Math.max(from + 0.1, arc.flight * 0.55);
    for (let k = count(56, density); k > 0; k -= 1) {
        const tau = from + (to - from) * rand() ** 1.6;
        dolphinPose(arc, tau, pose);
        frame(pose, hold);
        const flukes = rand() < 0.7;
        const lx = flukes ? -FLUKE_REACH * range(0.9, 1.05) : range(-0.1, 0.45);
        const ly = flukes ? 0.02 : range(-0.28, -0.18);
        const lz = flukes ? range(-0.3, 0.3) : range(-0.35, 0.35);
        const s = arc.size;
        const keep = range(0.55, 0.85);
        spray.drop(
            now,
            t0 + tau,
            pose.x + (pose.fx * lx + hold.ux * ly + hold.sx * lz) * s,
            pose.y + (pose.fy * lx + hold.uy * ly + hold.sy * lz) * s,
            pose.z + (pose.fz * lx + hold.uz * ly + hold.sz * lz) * s,
            pose.vx * keep + range(-0.06, 0.06),
            pose.vy * keep + range(-0.06, 0.06),
            pose.vz * keep + range(-0.06, 0.06),
            (range(0.022, 0.04) + 0.04 * rand() ** 5) * grow,
            rgb,
            range(3, 4.5),
        );
    }
    if (!foam) return;
    // White water: a boil round the body as it bursts out (round it and in front of it, never only
    // behind it: it hides the moment it breaks the surface), and a puff carried up in the sheet.
    const big = Math.sqrt(grow) * scale;
    toward(arc.x, arc.z, eye, front);
    for (let k = 0; k < 5; k += 1) {
        const a = (k / 5 + rand() * 0.2) * TAU;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const r = range(0.25, 0.45) * scale;
        const v = speed * range(0.2, 0.45);
        foam.puff(
            now,
            t0 + range(-0.08, 0.04),
            arc.x + tx * ca * r + nx * 0.25 + front.x * 0.35,
            arc.y + ty * ca * r + ny * 0.25,
            arc.z + sa * r + front.z * 0.35,
            {
                v: [fx * v + tx * ca * 0.25 + nx * 0.1, fy * v + ty * ca * 0.25 + ny * 0.1, fz * v + sa * 0.25],
                size: range(0.45, 0.6) * big,
                spread: range(0.45, 0.7),
                life: range(1.5, 2.3),
                strength: range(0.28, 0.36),
            },
        );
    }
    foam.puff(now, t0 + clear * 0.5, arc.x + front.x * 0.3, arc.y, arc.z + front.z * 0.3, {
        v: [fx * speed * 0.5, fy * speed * 0.5, fz * speed * 0.5],
        size: 0.35 * big,
        spread: 0.5,
        life: 1.6,
        strength: 0.2,
    });
}

/**
 * The dolphin goes back into the sea (`arc` = WavesPod's leap, its nose touching the water).
 * Takes the same parameters as dolphinBreach.
 */
export function dolphinEntry({
    spray, foam, arc, now, density = 1, eye = null, rgb = SEA_WHITE,
}) {
    const { rand } = spray;
    const range = (a, b) => a + (b - a) * rand();
    const { t0 } = arc;
    const scale = arc.size / 1.25;
    // Where the middle of the body goes in, and the way it heads, flat on the water.
    const ex = arc.x + arc.vx * arc.flight;
    const ez = arc.z + arc.vz * arc.flight;
    const grow = splashReach(ex, 0, ez, eye);
    const hl = Math.hypot(arc.vx, arc.vz) || 1;
    const hx = arc.vx / hl;
    const hz = arc.vz / hl;
    // Its left, flat on the water.
    const sx = -hz;
    const sz = hx;
    const flowX = FLOW.u * 0.25;
    const flowZ = FLOW.z * 0.5;

    // The nose cuts in: two low sheets thrown aside along the slit, from where the nose touched
    // to where the middle goes in.
    dolphinPose(arc, arc.noseAt, pose);
    const nx = pose.x + pose.fx * NOSE_REACH * arc.size;
    const nz = pose.z + pose.fz * NOSE_REACH * arc.size;
    for (let k = count(26, density); k > 0; k -= 1) {
        const u = rand();
        const side = rand() < 0.5 ? -1 : 1;
        const out = range(0.25, 0.55) * side;
        const ahead = range(0.05, 0.3);
        const off = range(0.08, 0.2) * side * scale;
        spray.drop(
            now,
            t0 + arc.noseAt + (arc.flight - arc.noseAt) * u,
            nx + (ex - nx) * u + sx * off,
            0.02,
            nz + (ez - nz) * u + sz * off,
            sx * out + hx * ahead + flowX,
            range(0.25, 0.65),
            sz * out + hz * ahead + flowZ,
            range(0.025, 0.045) * grow,
            rgb,
            range(1.6, 2.6),
        );
    }
    // The crown: the water closes over the body in a ring, thrown higher on the side it went toward.
    for (let k = count(52, density); k > 0; k -= 1) {
        const a = rand() * TAU;
        const rx = Math.cos(a);
        const rz = Math.sin(a);
        const lean = Math.max(0, rx * hx + rz * hz);
        const r = range(0.25, 0.45) * scale;
        const out = range(0.18, 0.5);
        const ahead = range(0.1, 0.35);
        spray.drop(
            now,
            t0 + arc.flight + range(-0.12, 0.22),
            ex + rx * r,
            0.02,
            ez + rz * r,
            rx * out + hx * ahead + flowX,
            range(0.45, 1.05) * (0.75 + 0.35 * lean),
            rz * out + hz * ahead + flowZ,
            (range(0.028, 0.055) + 0.05 * rand() ** 4) * grow,
            rgb,
            range(2.4, 3.6),
        );
    }
    // The kick: the flukes go under and throw a tall plume of spray and big drops up and back.
    dolphinPose(arc, arc.tailAt, pose);
    const kx = pose.x - pose.fx * FLUKE_REACH * arc.size;
    const kz = pose.z - pose.fz * FLUKE_REACH * arc.size;
    for (let k = count(46, density); k > 0; k -= 1) {
        const back = range(0.12, 0.5);
        const aside = range(-0.25, 0.25);
        spray.drop(
            now,
            t0 + arc.tailAt + range(-0.08, 0.14),
            kx + range(-0.15, 0.15) * scale,
            0.03,
            kz + range(-0.15, 0.15) * scale,
            -hx * back + sx * aside + flowX,
            range(0.6, 1.2),
            -hz * back + sz * aside + flowZ,
            (range(0.03, 0.06) + 0.06 * rand() ** 3) * grow,
            rgb,
            range(2.8, 4),
        );
    }
    if (!foam) return;
    // White water boils up in the crown and in the kick, and foam lies on the water after them.
    const big = Math.sqrt(grow) * scale;
    toward(ex, ez, eye, front);
    for (let k = 0; k < 3; k += 1) {
        const a = rand() * TAU;
        const rx = Math.cos(a) * 0.2;
        const rz = Math.sin(a) * 0.2;
        const birth = t0 + arc.flight + range(-0.1, 0.12);
        foam.puff(now, birth, ex + rx + front.x * 0.3, 0.1, ez + rz + front.z * 0.3, {
            v: [rx + hx * 0.2 + flowX, range(0.35, 0.6), rz + hz * 0.2 + flowZ],
            size: range(0.38, 0.52) * big,
            spread: range(0.5, 0.8),
            life: range(2, 2.8),
            strength: range(0.26, 0.34),
        });
    }
    for (let k = 0; k < 2; k += 1) {
        const birth = t0 + arc.tailAt + range(0, 0.12);
        foam.puff(now, birth, kx - hx * 0.2 + front.x * 0.3, 0.14, kz - hz * 0.2 + front.z * 0.3, {
            v: [-hx * 0.25 + flowX, range(0.5, 0.85), -hz * 0.25 + flowZ],
            size: range(0.36, 0.48) * big,
            spread: range(0.55, 0.85),
            life: range(2, 2.8),
            strength: range(0.24, 0.3),
        });
    }
    [[arc.flight, ex, ez], [arc.tailAt, kx, kz]].forEach(([at, x, z]) => {
        foam.puff(now, t0 + at, x + front.x * 0.2, 0.03, z + front.z * 0.2, {
            size: range(0.55, 0.75) * big,
            spread: range(0.3, 0.45),
            life: range(3.5, 4.5),
            strength: range(0.22, 0.3),
            flat: 1,
        });
    });
}
