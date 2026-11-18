/**
 * Sakura Twilight — the cranes.
 *
 * Now and then a small flight of red-crowned cranes crosses the garden's night sky: white in the
 * moonlight, the black of their necks and of the trailing inner half of each wing against it,
 * necks stretched straight out and long legs trailing. They come from out of sight and go out of
 * sight at one pace, as one flock (sakura-crane-routes.js lays the routes by numbers through both
 * rest cameras, and keeps the timetable): across the lake from side to side, in front of the
 * mountain's cone or, nearer and higher, over its summit, so they are seen from the side. The
 * lake mirrors them (their mesh is not one the world leaves out of the reflection).
 *
 * The bird is the theme's own, modelled in Blender at life size (scripts/blender/sakura_crane.py
 * writes sakura-crane-model.js: no file to load) and drawn larger than life (CRANE_FLIGHT.size),
 * as far birds are in every theme here. No skeleton: every vertex says how much of the shoulder's
 * and of the wrist's turn it takes, and the vertex stage folds the wings about those two hinges
 * by the two angles written per bird each frame. One instanced draw, posed on the CPU (a dozen
 * floats a bird, nothing allocated per frame).
 *
 * The light is the garden's (sakura-light.js): the moon's colour on what is turned to it, wrapped
 * a little round the bird; the hour's sky from above and the ground's breath from below, and
 * under a bird the moon the lake gives back; a thin rim, and a little light through the flight
 * feathers, when the moon stands behind it; then the garden's air. Nothing adds light and nothing
 * is brighter than the bloom picks out. They are above the moon's shadow map, so they do not read it.
 *
 * At rest the draw is not parked: one bird of no size, under the ground, keeps its pipeline built
 * with the rest of the garden, so the first flight in play compiles nothing.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, dot, max, min, normalGeometry, normalize, positionGeometry, saturate, step,
    varyingProperty, vec3,
} from 'three/tsl';
import { SAKURA_CRANE } from './sakura-crane-model.js';
import {
    CRANE_FLIGHT, CRANE_ROUTES, CRANE_SEED, craneFlap, craneFlightPlace, craneGap, craneRouteFor, craneSkeinSize,
    craneWingbeat, createCraneFlight, layCraneSkein,
} from './sakura-crane-routes.js';

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Floats a bird in the instance buffer: place + size, forward + the shoulder's turn, up + the wrist's. */
export const SAKURA_CRANE_STRIDE = 12;
/**
 * How the plumage takes the garden's light: the moon on what faces it (and how far it wraps
 * round), the sky and the ground's breath, the moon off the lake under the bird, the rim and the
 * light through the thin feathers when the moon is behind; and the most a lit bird may be (the
 * bloom picks out what is brighter than 0.9: sakura-post.js), which the white eases into from
 * `knee` up, so the brightest hour's moon still leaves the bird its form.
 */
export const SAKURA_CRANE_LIGHT = Object.freeze({
    moon: 0.74, wrap: 0.9, sky: 2.0, lake: 0.28, rim: 0.3, through: 0.22, knee: 0.5, most: 0.88,
});
/** A flight due while the game is over (the reactions' `hush` above this) does not set out. */
const HUSHED = 0.5;

// ── The model ────────────────────────────────────────────────────────────────

function bytes(text) {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
}

let decoded = null;

/**
 * The bird, decoded once: `positions` (metres; x the bird's left, y up, z forward), `normals`,
 * `colours` (linear r, g, b, thin), `rig` (arm, hand, shade, unused), `parts` and `index`. The
 * arrays are shared by every world built in a session; each world wraps them in attributes of its own.
 */
export function sakuraCraneModel() {
    if (!decoded) {
        const raw = (text, Type) => new Type(bytes(text).buffer);
        decoded = Object.freeze({
            vertexCount: SAKURA_CRANE.vertexCount,
            triangleCount: SAKURA_CRANE.triangleCount,
            positions: Float32Array.from(raw(SAKURA_CRANE.positions, Int16Array), (v) => v * SAKURA_CRANE.quant),
            normals: Float32Array.from(raw(SAKURA_CRANE.normals, Int8Array), (v) => v / 127),
            colours: Float32Array.from(bytes(SAKURA_CRANE.colours), (v) => v / 255),
            rig: Float32Array.from(bytes(SAKURA_CRANE.rig), (v) => v / 255),
            parts: bytes(SAKURA_CRANE.partOf),
            index: raw(SAKURA_CRANE.index, Uint16Array),
        });
    }
    return decoded;
}

const turned = (a, b, angle) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [a * c - b * s, a * s + b * c];
};

/**
 * A vertex `p` with shares `rig` (arm, hand, …), the wing turned `arm` radians about the shoulder
 * and `hand` about the wrist (+ up): the wrist first, then the shoulder. The vertex stage's twin
 * (and sakura_crane.py's pose()).
 */
export function poseCrane(p, rig, arm = 0, hand = 0, out = [0, 0, 0]) {
    const side = p[0] >= 0 ? 1 : -1;
    const [Sx, Sy] = SAKURA_CRANE.shoulder;
    const [Wx, Wy] = SAKURA_CRANE.wrist;
    let [du, dy] = turned(Math.abs(p[0]) - Wx, p[1] - Wy, hand * rig[1]);
    [du, dy] = turned(du + Wx - Sx, dy + Wy - Sy, arm * rig[0]);
    /* eslint-disable no-param-reassign */
    out[0] = side * (du + Sx);
    out[1] = dy + Sy;
    out[2] = p[2];
    /* eslint-enable no-param-reassign */
    return out;
}

// ── Drawing ──────────────────────────────────────────────────────────────────

/** Rotate the pair (a, b) by `angle` (TSL). */
const turn = (a, b, angle) => {
    const c = angle.cos();
    const s = angle.sin();
    return [a.mul(c).sub(b.mul(s)), a.mul(s).add(b.mul(c))];
};

/**
 * The cranes' material. The vertex stage folds the wings about the wrist, then the shoulder (the
 * normals with them), and sets the bird on its heading; the fragment stage lights the plumage by
 * the garden's rig and gives it the garden's air.
 */
function createCraneMaterial(light) {
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'SakuraCranes';
    const A = attribute('iCraneA', 'vec4');
    const B = attribute('iCraneB', 'vec4');
    const C = attribute('iCraneC', 'vec4');
    const rig = attribute('craneRig', 'vec4');
    const tint = attribute('craneTint', 'vec4');
    const vNormal = varyingProperty('vec3', 'vSakuraCraneNormal');
    const vWorld = varyingProperty('vec3', 'vSakuraCraneWorld');
    const [Sx, Sy] = SAKURA_CRANE.shoulder;
    const [Wx, Wy] = SAKURA_CRANE.wrist;

    material.positionNode = Fn(() => {
        const p = positionGeometry;
        const n = normalGeometry;
        const fwd = B.xyz;
        const up = C.xyz;
        const left = up.cross(fwd).toVar();
        const side = step(0.0, p.x).mul(2.0).sub(1.0).toVar();
        const handTurn = C.w.mul(rig.y).toVar();
        const armTurn = B.w.mul(rig.x).toVar();
        let [du, dy] = turn(abs(p.x).sub(Wx), p.y.sub(Wy), handTurn);
        [du, dy] = turn(du.add(Wx - Sx), dy.add(Wy - Sy), armTurn);
        const local = vec3(side.mul(du.add(Sx)), dy.add(Sy), p.z).toVar();
        let [nu, nv] = turn(side.mul(n.x), n.y, handTurn);
        [nu, nv] = turn(nu, nv, armTurn);
        const normal = vec3(side.mul(nu), nv, n.z).toVar();
        const world = A.xyz.add(left.mul(local.x).add(up.mul(local.y)).add(fwd.mul(local.z)).mul(A.w)).toVar();
        vNormal.assign(left.mul(normal.x).add(up.mul(normal.y)).add(fwd.mul(normal.z)));
        vWorld.assign(world);
        return world;
    })();

    material.colorNode = Fn(() => {
        const look = SAKURA_CRANE_LIGHT;
        const N = normalize(vNormal).toVar();
        const P = vWorld;
        const albedo = tint.xyz;
        const toEye = normalize(cameraPosition.sub(P)).toVar();
        const toward = dot(N, light.uMoonDir).toVar();
        // The moon on what is turned to it, wrapped a little round the bird (feathers scatter).
        const facing = saturate(toward.add(look.wrap).div(1 + look.wrap)).toVar();
        // How squarely the eye looks into the moon past this bird (1: the moon right behind it).
        const against = saturate(dot(toEye, light.uMoonDir).negate()).toVar();
        const graze = saturate(dot(N, toEye)).oneMinus().toVar();
        const rim = graze.mul(graze).mul(graze).mul(against.mul(0.85).add(0.15));
        // A little of the moon through the flight feathers of a bird that stands against it.
        const through = tint.w.mul(against).mul(against).mul(saturate(toward.negate().mul(0.5).add(0.5)));
        const moon = light.uMoonColor.mul(facing.mul(look.moon).add(rim.mul(look.rim)).add(through.mul(look.through)));
        // The hour's sky from above and the ground's breath from below; under the bird the lake
        // gives the moon back.
        const around = light.ambient(N).mul(look.sky).add(light.uMoonColor.mul(saturate(N.y.negate()).mul(look.lake)));
        const lit = albedo.mul(moon.add(around.mul(rig.z))).toVar();
        // No brighter than `most`, eased into from `knee` (nothing here adds light or feeds the bloom).
        const room = look.most - look.knee;
        const over = max(lit.sub(look.knee), 0).div(room);
        const held = min(lit, vec3(look.knee)).add(over.negate().exp().oneMinus().mul(room));
        return light.haze(held, { world: P });
    })();
    return material;
}

const INSTANCE_NAMES = Object.freeze(['iCraneA', 'iCraneB', 'iCraneC']);

/** Write a bird into the instance buffer. */
function put(data, at, x, y, z, size, fx, fy, fz, arm, ux, uy, uz, hand) {
    const o = at * SAKURA_CRANE_STRIDE;
    /* eslint-disable no-param-reassign */
    data[o] = x;
    data[o + 1] = y;
    data[o + 2] = z;
    data[o + 3] = size;
    data[o + 4] = fx;
    data[o + 5] = fy;
    data[o + 6] = fz;
    data[o + 7] = arm;
    data[o + 8] = ux;
    data[o + 9] = uy;
    data[o + 10] = uz;
    data[o + 11] = hand;
    /* eslint-enable no-param-reassign */
}

export class SakuraCranes {
    /**
     * @param {object} options
     * @param {object} options.light the garden's light rig (SakuraLight)
     * @param {object} options.tier the quality tier; `tier.cranes` is the most birds a skein has
     * @param {number} [options.seed] the cranes' own seed (they take none of the garden's chances)
     * @param {ReadonlyArray<object>} [options.routes] the routes to fly (the night's own by default)
     */
    constructor({
        light, tier, seed = CRANE_SEED, routes = CRANE_ROUTES,
    } = {}) {
        this.light = light;
        this.tier = tier;
        this.seed = seed >>> 0;
        this.routes = routes;
        this.group = new THREE.Group();
        this.group.name = 'SakuraCranes';
        /** The most birds a skein has on this tier (none: the tier has no cranes). */
        this.most = clamp(Math.round(Number(tier?.cranes) || 0), 0, CRANE_FLIGHT.most);
        /** The skein in the air (or the last one): its route, its birds, how long it flies. */
        this.flight = createCraneFlight();
        this.choice = { route: 0, reversed: false };
        this.place = [0, 0, 0, 0, 0, 0];
        this.wing = [0, 0, 0];
        this.geometry = null;
        this.material = null;
        this.mesh = null;
        this.data = null;
        this.buffer = null;
        this.built = false;
        this.time = 0;
        this.rewind();
    }

    /** The timetable from the night's start: no flight yet, the first one due. */
    rewind() {
        /** Which flight of the night the clock is in (-1: before the first), when it set out, when the next does. */
        this.number = -1;
        this.start = 0;
        this.next = craneGap(this.seed, -1);
        /** The flight the birds in `flight` are laid for (-1: none), and one that does not fly (-1: none). */
        this.laid = -1;
        this.dropped = -1;
        /** A flight staged by hand (fly()): when it set out, or null. */
        this.staged = null;
        this.flying = 0;
        this.flown = 0;
    }

    build() {
        if (this.built) return this;
        this.built = true;
        if (!this.most || !this.routes?.length) return this;
        const model = sakuraCraneModel();
        const data = new Float32Array(this.most * SAKURA_CRANE_STRIDE);
        const buffer = new THREE.InstancedInterleavedBuffer(data, SAKURA_CRANE_STRIDE);
        buffer.setUsage(THREE.DynamicDrawUsage);
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setIndex(new THREE.BufferAttribute(model.index, 1));
        geometry.setAttribute('position', new THREE.BufferAttribute(model.positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(model.normals, 3));
        geometry.setAttribute('craneTint', new THREE.BufferAttribute(model.colours, 4));
        geometry.setAttribute('craneRig', new THREE.BufferAttribute(model.rig, 4));
        // One interleaved buffer for the three instance attributes (a pipeline has eight vertex buffers).
        INSTANCE_NAMES.forEach((key, k) => {
            geometry.setAttribute(key, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4));
        });
        geometry.instanceCount = 1;
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 40, -100), 900);
        const material = createCraneMaterial(this.light);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'SakuraCranes';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        this.geometry = geometry;
        this.material = material;
        this.mesh = mesh;
        this.data = data;
        this.buffer = buffer;
        this.group.add(mesh);
        this.write(0);
        return this;
    }

    /**
     * Forget the flight in the air (a new session, effects switched off). The timetable goes on:
     * the next flight sets out when it would have.
     */
    reset() {
        if (this.flying && !this.staged) this.dropped = this.number;
        this.staged = null;
        if (this.built) this.write(this.time);
    }

    /**
     * Send a flight out by hand (a capture, a test): on route `route`, `age` seconds before now,
     * `reversed` the other way, `count` birds (the tier's most by default), as flight `number` of
     * the night (its shape and looseness). False when the tier has no cranes or there is no route.
     */
    fly({
        route = 0, age = 0, reversed = false, count = this.most, number = 0,
    } = {}) {
        if (!this.built || !this.mesh || !this.routes?.length) return false;
        const index = ((Math.round(Number(route) || 0) % this.routes.length) + this.routes.length) % this.routes.length;
        const birds = clamp(Math.round(count) || this.most, 1, this.most);
        layCraneSkein(this.flight, this.routes[index], birds, this.seed, number, reversed);
        this.choice.route = index;
        this.choice.reversed = reversed;
        this.laid = -1;
        this.staged = { start: this.time - Math.max(0, Number(age) || 0) };
        this.write(this.time);
        return true;
    }

    /**
     * One frame. `time` is the garden's clock (seconds); `frame` the reactions' frame: its `hush`
     * (the game is over) keeps a flight that is due on the ground. Neither reduced motion nor the
     * effects setting holds the cranes: they are scenery, and slow.
     */
    update(time, dt, frame = {}) {
        if (!this.built || !this.mesh) return;
        const at = Number.isFinite(time) ? Math.max(0, time) : this.time;
        // The clock ran back (a seek, a new night): the timetable begins again.
        if (at < this.time - 1e-6) this.rewind();
        this.time = at;
        let due = false;
        while (at >= this.next) {
            this.number += 1;
            this.start = this.next;
            this.next = this.start + craneGap(this.seed, this.number);
            due = true;
        }
        if (due) {
            const hush = Number.isFinite(frame?.hush) ? frame.hush : 0;
            if (hush > HUSHED || this.staged) this.dropped = this.number;
        }
        if (this.staged && at - this.staged.start >= this.flight.life) this.staged = null;
        if (!this.staged && this.number >= 0 && this.number !== this.dropped && this.laid !== this.number
            && this.routes.length) {
            // Each flight draws its own choices from its number: the same ones after a seek.
            craneRouteFor(this.seed, this.number, this.routes.length, this.choice);
            layCraneSkein(
                this.flight,
                this.routes[this.choice.route],
                craneSkeinSize(this.seed, this.number, this.most),
                this.seed,
                this.number,
                this.choice.reversed,
            );
            this.laid = this.number;
            this.flown += 1;
        }
        this.write(at);
    }

    /** Seconds since the skein in the air set out, or -1 when the sky is empty. */
    age(time = this.time) {
        if (this.staged) return time - this.staged.start;
        if (this.number < 0 || this.number === this.dropped || this.laid !== this.number) return -1;
        const age = time - this.start;
        return age < this.flight.life ? age : -1;
    }

    /** Pose the birds in the air into the instance buffer (none: one bird of no size under the ground). */
    write(time) {
        const {
            data, flight, place, wing,
        } = this;
        if (!data) return;
        const age = this.age(time);
        let shown = 0;
        if (age >= 0 && age < flight.life) {
            for (let i = 0; i < flight.count; i += 1) {
                const bird = flight.birds[i];
                craneFlightPlace(flight, i, age, place);
                craneWingbeat(TAU * bird.hz * age + bird.phase, craneFlap(flight, i, age), wing);
                const fx = place[3];
                const fy = place[4];
                const fz = place[5];
                // Up, square to the heading (the routes bend too gently for a bank worth drawing:
                // a degree at their tightest).
                const flat = Math.hypot(fx, fz) || 1;
                put(
                    data,
                    shown,
                    place[0],
                    place[1] + wing[2] * bird.size,
                    place[2],
                    bird.size,
                    fx,
                    fy,
                    fz,
                    wing[0],
                    (-fx * fy) / flat,
                    flat,
                    (-fz * fy) / flat,
                    wing[1],
                );
                shown += 1;
            }
        }
        // (Only a change is uploaded: an empty sky stays as it was written.)
        const parked = this.geometry.instanceCount === 1 && data[3] === 0 && data[1] === -50;
        if (shown === 0 && this.flying === 0 && parked) return;
        if (shown === 0) put(data, 0, 0, -50, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0);
        this.flying = shown;
        this.geometry.instanceCount = Math.max(1, shown);
        this.buffer.needsUpdate = true;
    }

    getDiagnostics() {
        return {
            most: this.most,
            routes: this.routes?.length ?? 0,
            flying: this.flying,
            flown: this.flown,
            flight: this.number,
            route: this.flying ? this.choice.route : -1,
            reversed: this.flying ? this.choice.reversed : false,
            age: this.age(),
            next: this.next,
        };
    }

    dispose() {
        this.geometry?.dispose();
        this.material?.dispose();
        this.geometry = null;
        this.material = null;
        this.mesh = null;
        this.data = null;
        this.buffer = null;
        this.built = false;
        this.flying = 0;
        this.staged = null;
        this.group.removeFromParent();
        this.group.clear();
    }
}
