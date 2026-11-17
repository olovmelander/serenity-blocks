/**
 * Summer — the swans of the lake.
 *
 * A pair of mute swans and their cygnets voyage round the whole lake: out from the water left of
 * the board where the sun lays its road, past the skerry and along the headland, round its tip to
 * the far water, behind the board to the water off the homestead and home again, a lap of some
 * fourteen minutes (summer-swan-routes.js: SWAN_VOYAGE). The cob leads, the pen follows, the
 * young in a loose line behind her; where they stay a while they draw together, spread out and
 * feed. Now and then one dips its head, and the cob lifts his wings a little, like sails.
 * And when the game asks (takeWing: a level-up), or by itself every few minutes, a skein of
 * swans crosses the lake on slow wings: in over the homestead's wood, down behind the board and
 * away low over the water under the sun (summer-swan-routes.js finds both ways by numbers).
 *
 * The birds are the theme's own, modelled in Blender (scripts/blender/summer_swan.py writes
 * summer-swan-model.js: no file to load). No skeleton: every vertex says how much of a wing's
 * turn or of a head-dip it takes, and the vertex stage turns it by the few numbers written per
 * bird each frame. Three instanced draws: the adults afloat, the cygnets, the birds on the wing.
 *
 * The light is the evening's own (summer-light.js): the sun on what faces it, the sky and the
 * bounce on the rest, and where the low sun stands behind a bird, as it does for most of them
 * from where the camera stands, a warm rim and a glow through the thin feathers.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, dot, mix, normalGeometry, normalize, positionGeometry, pow, saturate, step,
    varyingProperty, vec2, vec3,
} from 'three/tsl';
import { SUMMER_SWAN } from './summer-swan-model.js';
import {
    SWAN_FLIGHT, SWAN_SKEIN_MOST, laySwanSkein, laySwanVoyage, planSwanFlights, seededSwans, sessionSwanFlights,
    sessionSwanVoyage, swanFamily, swanFamilyPlace, swanFlightPlace, swanWingbeat,
} from './summer-swan-routes.js';
import { summerGroundHeight } from './summer-terrain.js';

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const clamp01 = (value) => (Number.isFinite(value) ? clamp(value, 0, 1) : 0);
const smooth = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
};

/** Floats a bird in an instance buffer: place + size, forward + first turn, up + second turn. */
export const SWAN_STRIDE = 12;
/** The tier's `swans` column when a table has none: cygnets, birds in a skein. */
const DEFAULT_COUNTS = Object.freeze([3, 5]);

// ── The model ────────────────────────────────────────────────────────────────

function bytes(text) {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
}

function decodeShape(shape, quant) {
    const raw = (text, Type) => new Type(bytes(text).buffer);
    return Object.freeze({
        vertexCount: shape.vertexCount,
        triangleCount: shape.triangleCount,
        positions: Float32Array.from(raw(shape.positions, Int16Array), (v) => v * quant),
        normals: Float32Array.from(raw(shape.normals, Int8Array), (v) => v / 127),
        colours: Float32Array.from(bytes(shape.colours), (v) => v / 255),
        rig: Float32Array.from(bytes(shape.rig), (v) => v / 255),
        parts: bytes(shape.parts),
        index: raw(shape.index, Uint16Array),
        neck: shape.neck || null,
    });
}

let decoded = null;

/**
 * The three shapes, decoded once: per shape `positions` (metres; x the bird's left, y up, z
 * forward), `normals`, `colours` (linear r, g, b, thin), `rig` (wing, hand, neck, shade),
 * `parts` and `index`. The arrays are shared by every world built in a session; each world
 * wraps them in attributes of its own.
 */
export function summerSwanModel() {
    if (!decoded) {
        decoded = Object.freeze({
            afloat: decodeShape(SUMMER_SWAN.shapes.afloat, SUMMER_SWAN.quant),
            cygnet: decodeShape(SUMMER_SWAN.shapes.cygnet, SUMMER_SWAN.quant),
            flying: decodeShape(SUMMER_SWAN.shapes.flying, SUMMER_SWAN.quant),
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
 * An afloat vertex `p` with shares `rig` (wing, hand, neck, shade), its wings raised by `lift`
 * (0..1) and its head dipped `dip` radians about the neck's root `pivot` (y, z). The vertex
 * stage's twin (and summer_swan.py's pose_afloat).
 */
export function poseAfloat(p, rig, pivot, lift = 0, dip = 0, out = [0, 0, 0]) {
    const side = p[0] >= 0 ? 1 : -1;
    const [rx, ry, rz] = SUMMER_SWAN.raise;
    const raised = rig[0] * lift;
    const [dz, dy] = turned(p[2] + rz * raised - pivot[1], p[1] + ry * raised - pivot[0], -dip * rig[2]);
    out[0] = p[0] + side * rx * raised;
    out[1] = pivot[0] + dy;
    out[2] = pivot[1] + dz;
    return out;
}

/**
 * A flying vertex with the wing turned `arm` radians about the shoulder and `hand` about the
 * wrist (+ up): the wrist first, then the shoulder. The vertex stage's twin (pose_flying).
 */
export function poseFlying(p, rig, arm = 0, hand = 0, out = [0, 0, 0]) {
    const side = p[0] >= 0 ? 1 : -1;
    const [Sx, Sy] = SUMMER_SWAN.shoulder;
    const [Wx, Wy] = SUMMER_SWAN.wrist;
    let [du, dy] = turned(Math.abs(p[0]) - Wx, p[1] - Wy, hand * rig[1]);
    [du, dy] = turned(du + Wx - Sx, dy + Wy - Sy, arm * rig[0]);
    out[0] = side * (du + Sx);
    out[1] = dy + Sy;
    out[2] = p[2];
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
 * A swan's material. The vertex stage turns the wings (flying) or raises them and dips the head
 * (afloat) by the bird's own numbers, then sets it on its heading; the light is the evening's:
 * the sun on what faces it, the sky and the bounce on the rest, a warm rim and a glow through
 * the thin feathers where the low sun stands behind the bird.
 */
function createSwanMaterial(light, { name, flying, pivot }) {
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = name;
    const A = attribute('iSwanA', 'vec4');
    const B = attribute('iSwanB', 'vec4');
    const C = attribute('iSwanC', 'vec4');
    const rig = attribute('swanRig', 'vec4');
    const tint = attribute('swanTint', 'vec4');
    const vNormal = varyingProperty('vec3', `v${name}Normal`);
    const vWorld = varyingProperty('vec3', `v${name}World`);

    material.positionNode = Fn(() => {
        const p = positionGeometry;
        const n = normalGeometry;
        const fwd = B.xyz;
        const up = C.xyz;
        const left = up.cross(fwd).toVar();
        const side = step(0.0, p.x).mul(2.0).sub(1.0).toVar();
        let local;
        let normal;
        if (flying) {
            // The wrist, then the shoulder: two hinges along the body (summer-swans.js: poseFlying).
            const [Sx, Sy] = SUMMER_SWAN.shoulder;
            const [Wx, Wy] = SUMMER_SWAN.wrist;
            const handTurn = C.w.mul(rig.y).toVar();
            const armTurn = B.w.mul(rig.x).toVar();
            let [du, dy] = turn(abs(p.x).sub(Wx), p.y.sub(Wy), handTurn);
            [du, dy] = turn(du.add(Wx - Sx), dy.add(Wy - Sy), armTurn);
            local = vec3(side.mul(du.add(Sx)), dy.add(Sy), p.z);
            let [nu, nv] = turn(side.mul(n.x), n.y, handTurn);
            [nu, nv] = turn(nu, nv, armTurn);
            normal = vec3(side.mul(nu), nv, n.z);
        } else {
            // The folded wings lift like sails; the neck turns down about its root (poseAfloat).
            const [rx, ry, rz] = SUMMER_SWAN.raise;
            const raised = rig.x.mul(B.w).toVar();
            const dip = C.w.mul(rig.z).negate().toVar();
            const [dz, dy] = turn(p.z.add(raised.mul(rz)).sub(pivot[1]), p.y.add(raised.mul(ry)).sub(pivot[0]), dip);
            local = vec3(p.x.add(side.mul(raised).mul(rx)), dy.add(pivot[0]), dz.add(pivot[1]));
            const [nz, ny] = turn(n.z, n.y, dip);
            normal = vec3(n.x, ny, nz);
        }
        const world = A.xyz.add(left.mul(local.x).add(up.mul(local.y)).add(fwd.mul(local.z)).mul(A.w)).toVar();
        vNormal.assign(left.mul(normal.x).add(up.mul(normal.y)).add(fwd.mul(normal.z)));
        vWorld.assign(world);
        return world;
    })();

    material.colorNode = Fn(() => {
        const N = normalize(vNormal).toVar();
        const P = vWorld;
        const albedo = tint.xyz;
        const toEye = normalize(cameraPosition.sub(P)).toVar();
        const sun = light.uSunColor.mul(light.sunlight()).toVar();
        const toward = dot(N, light.uSunDir).toVar();
        // How squarely the eye looks into the sun past this bird (1: the sun right behind it).
        const against = saturate(dot(toEye, light.uSunDir).negate()).toVar();
        const facing = saturate(toward.mul(0.8).add(0.2));
        const graze = saturate(dot(N, toEye)).oneMinus().toVar();
        const rim = graze.mul(graze).mul(against.mul(0.8).add(0.2));
        // The low sun through the thin feathers of a bird that stands against it.
        const through = tint.w.mul(against.mul(against)).mul(saturate(toward.negate().mul(0.6).add(0.6)));
        // Over the lake the light from below is the sky in the water more than the meadow's green.
        const around = mix(light.ambient(N), light.ambient(vec3(0, 1, 0)), 0.45);
        // Seen against the low sun a white bird is its own shaded side: darker than the bright water
        // behind it, with the light along its back and its edges (a bird lit as white as the glare
        // it swims in is lost in it).
        // Deepest in the sun's own road on the water, where the bird is a silhouette in the glitter.
        const eyeFlat = normalize(vec2(toEye.x, toEye.z).negate().add(vec2(1e-4, 0)));
        const sunFlat = normalize(vec2(light.uSunDir.x, light.uSunDir.z).add(vec2(1e-4, 0)));
        const road = pow(saturate(dot(eyeFlat, sunFlat)), 48).mul(against);
        const shaded = against.mul(against).mul(-0.42).add(1).sub(road.mul(0.3));
        const lit = albedo.mul(sun).mul(facing.mul(0.42).add(rim.mul(0.55)).add(through.mul(0.3)))
            .add(albedo.mul(around).mul(rig.w).mul(shaded));
        return light.haze(lit, { world: P });
    })();
    return material;
}

const INSTANCE_NAMES = Object.freeze(['iSwanA', 'iSwanB', 'iSwanC']);

/** One instanced draw of a shape: the model's arrays in attributes of its own, and a buffer of birds. */
function createSwanDraw(shape, capacity, material, name) {
    const data = new Float32Array(capacity * SWAN_STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(data, SWAN_STRIDE);
    buffer.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(shape.index, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(shape.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(shape.normals, 3));
    geometry.setAttribute('swanTint', new THREE.BufferAttribute(shape.colours, 4));
    geometry.setAttribute('swanRig', new THREE.BufferAttribute(shape.rig, 4));
    INSTANCE_NAMES.forEach((key, k) => {
        geometry.setAttribute(key, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4));
    });
    geometry.instanceCount = 1;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 10, -60), 400);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return {
        mesh, geometry, data, buffer, capacity,
    };
}

/** Write a bird into an instance buffer. */
function put(data, at, x, y, z, size, fx, fy, fz, first, ux, uy, uz, second) {
    const o = at * SWAN_STRIDE;
    data[o] = x;
    data[o + 1] = y;
    data[o + 2] = z;
    data[o + 3] = size;
    data[o + 4] = fx;
    data[o + 5] = fy;
    data[o + 6] = fz;
    data[o + 7] = first;
    data[o + 8] = ux;
    data[o + 9] = uy;
    data[o + 10] = uz;
    data[o + 11] = second;
}

/**
 * How the family behaves: how often and how long a head dips, how much more often it dips to feed
 * where the family stays (the share of the period, and the lingering it sets in over), the cob's
 * sails, the wake's rings.
 */
const MANNERS = Object.freeze({
    dip: Object.freeze({ cob: [47, 3.6, 1.75], pen: [34, 3.4, 1.8], cygnet: [15, 1.9, 1.25] }),
    feed: Object.freeze({ every: 0.3, from: 0.2, to: 0.55 }),
    sails: Object.freeze({ every: 71, lasts: 11, rest: 0.18 }),
    wake: Object.freeze({ every: 5.5, strength: 0.13 }),
    // By itself a skein comes every three to five minutes (s), a smaller one than a level calls.
    ambient: Object.freeze({ first: [150, 240], gap: [180, 300], strength: 0.55 }),
});

/** Frames a world has drawn before it scores its flights by itself (a launch before that scores them). */
const PLAN_FRAME = 120;

/** A bell over the first `lasts` seconds of every `every` (0 otherwise): up, held a moment, down. */
function bell(time, every, lasts, phase) {
    const t = (((time + phase) % every) + every) % every;
    if (t >= lasts) return 0;
    const u = t / lasts;
    return smooth(0, 0.35, u) * (1 - smooth(0.6, 1, u));
}

export class SummerSwans {
    /**
     * @param {object} options
     * @param {object} options.light the theme's light rig (SummerLight)
     * @param {object} options.tier the quality tier; `tier.swans` is [cygnets, birds in a skein]
     * @param {() => number} [options.rng] the theme's generator. Kept, never drawn from: the swans
     *   have a sequence of their own (the parts built after them keep their draws, and a flight is
     *   the same flight whatever the game drew before it)
     * @param {(x: number, z: number) => number} [options.groundHeight] the land's height (the lake's
     *   bed where it is under 0)
     */
    constructor({
        light, tier, rng = Math.random, groundHeight = summerGroundHeight,
    } = {}) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.groundHeight = groundHeight;
        this.group = new THREE.Group();
        this.group.name = 'SummerSwans';
        const [cygnets, skein] = Array.isArray(tier?.swans) ? tier.swans : DEFAULT_COUNTS;
        this.cygnets = clamp(Math.round(Number(cygnets) || 0), 0, 8);
        this.skein = clamp(Math.round(Number(skein) || 0), 0, SWAN_SKEIN_MOST);
        this.family = swanFamily(this.cygnets);
        /** The family's voyage round the lake (summer-swan-routes.js), laid when built; null on a lake without one. */
        this.voyage = null;
        /** Seconds the voyage runs ahead of the clock (the playground's ?swanAt= puts the family anywhere on it). */
        this.shift = 0;
        /** The lines a skein may fly, best first; null until they are scored (plan()). */
        this.flights = null;
        this.frames = 0;
        /** The skein in the air (or the last one): its line, its birds, when it went up. */
        this.flight = {
            live: false,
            start: 0,
            life: 0,
            route: null,
            reversed: false,
            count: 0,
            birds: Array.from({ length: SWAN_SKEIN_MOST }, () => ({
                out: 0, back: 0, up: 0, hz: SWAN_FLIGHT.beat, phase: 0, wander: 0, rate: 1, size: 1,
            })),
        };
        this.motion = 1;
        this.time = 0;
        this.launches = 0;
        this.nextAmbient = null;
        this.wakeBeat = -1;
        this.flying = 0;
        this.ring = { x: 0, z: 0, strength: 0 };
        this.place = [0, 0, 0, 0, 0];
        this.wing = [0, 0, 0];
        this.bird = [0, 0, 0, 0, 0, 0, 0];
        this.draws = null;
        this.owned = [];
        this.built = false;
    }

    build() {
        if (this.built) return this;
        this.built = true;
        const { light } = this;
        this.voyage = this.groundHeight === summerGroundHeight
            ? sessionSwanVoyage() : laySwanVoyage({ groundHeight: this.groundHeight });
        const model = summerSwanModel();
        const draw = (shape, capacity, name, options) => {
            const material = createSwanMaterial(light, { name, ...options });
            const made = createSwanDraw(shape, capacity, material, name);
            this.group.add(made.mesh);
            this.owned.push(made.geometry, material);
            return made;
        };
        const { afloat, cygnet } = SUMMER_SWAN.shapes;
        const young = this.voyage ? this.cygnets : 0;
        this.draws = {
            afloat: this.voyage ? draw(model.afloat, 2, 'SummerSwans', { flying: false, pivot: afloat.neck }) : null,
            cygnets: young ? draw(model.cygnet, young, 'SummerCygnets', { flying: false, pivot: cygnet.neck }) : null,
            flying: this.skein ? draw(model.flying, this.skein, 'SummerSwanSkein', { flying: true }) : null,
        };
        this.writeFamily(0, 1);
        this.writeSkein(0);
        return this;
    }

    /**
     * Score the lines a skein may fly (once; the theme's own lake keeps them for the session). Not
     * done while the world builds: the first launch does it, or a quiet frame a little into play.
     */
    plan() {
        if (!this.flights) {
            this.flights = this.groundHeight === summerGroundHeight
                ? sessionSwanFlights() : planSwanFlights({ groundHeight: this.groundHeight });
        }
        return this.flights;
    }

    /** Reduce motion: calmer on the water (less rocking, shallower dips), and no skeins by themselves under a half. */
    setMotion(share) {
        this.motion = Number.isFinite(share) ? clamp(share, 0, 1) : 1;
    }

    /** Forget the flight in the air (a new session, a seek, effects switched off). */
    reset() {
        this.flight.live = false;
        this.flight.count = 0;
        this.launches = 0;
        this.nextAmbient = null;
        this.wakeBeat = -1;
        this.flying = 0;
        if (this.built) this.writeSkein(this.time);
    }

    /**
     * Send a skein across the lake now: `strength` 1 the tier's whole skein, less a smaller one
     * (never under three). False when one is already in the air (it flies on), or the tier has none.
     */
    takeWing(strength = 1) {
        if (!this.built || !this.draws?.flying || this.flight.live || !this.plan().length) return false;
        // Each flight since the last reset draws its own choices: the same ones after a seek.
        this.launches += 1;
        const random = seededSwans(0x51a7 + this.launches * 7919);
        const most = this.skein;
        const count = Math.min(most, Math.max(Math.min(3, most), Math.round(3 + (most - 3) * clamp01(strength))));
        // One of the best few lines, flown either way, so one flight is not the last one again.
        const pool = Math.min(4, this.flights.length);
        const route = this.flights[Math.floor(random() * pool) % pool];
        laySwanSkein(this.flight, route, count, random, random() < 0.35);
        this.flight.start = this.time;
        this.flight.live = true;
        return true;
    }

    /** How many swans are drawn now: the pair, their cygnets, the birds of a skein in the air. */
    counts() {
        return {
            afloat: this.draws?.afloat ? 2 : 0,
            cygnets: this.draws?.cygnets ? this.cygnets : 0,
            flying: this.flying,
        };
    }

    /**
     * One frame. Returns null, or the place of a faint ring a swan's wake leaves on the lake
     * ({ x, z, strength }: the same object every time, read it before the next frame). `frame` is
     * the reactions' (its gust rocks the birds a little, and a settled one leaves no rings), `worn`
     * the world's reading of it (SummerWorld.wear: the gust eased, Reduce motion's share).
     */
    update(time, dt = 0, frame = {}, worn = null) {
        // Hidden (the playground's ?swans=0), the swans leave no rings and send no skein.
        if (!this.built || !this.group.visible) return null;
        const at = Number.isFinite(time) ? Math.max(0, time) : this.time;
        this.frames += 1;
        if (this.frames === PLAN_FRAME && this.draws?.flying) this.plan();
        // The clock ran back (a seek): a skein that went up later is not in the air yet.
        if (this.flight.live && at < this.flight.start) this.flight.live = false;
        this.time = at;
        const motion = Math.min(this.motion, worn && Number.isFinite(worn.motion) ? clamp01(worn.motion) : 1);
        // A gust off the meadow rocks them a little more.
        const gust = clamp01(worn ? worn.gust : frame?.gust);
        this.writeFamily(at, motion * (1 + 1.4 * gust));
        this.fly(at, motion);
        // Once the session has ended the lake is left to settle, as the fish leave it (frame.settled).
        return frame?.settled === true ? null : this.wake(at, dt, motion);
    }

    /** The skein in the air, and the ones that come by themselves. */
    fly(time, motion) {
        const { flight } = this;
        if (flight.live && time - flight.start >= flight.life) {
            flight.live = false;
            this.nextAmbient = null;
        }
        if (!flight.live && this.draws?.flying) {
            const { ambient } = MANNERS;
            if (this.nextAmbient === null) {
                // The first by itself waits a few minutes; the next ones as long after a flight is gone.
                const [low, high] = this.launches ? ambient.gap : ambient.first;
                const share = seededSwans(0x5a17 + this.launches * 977)();
                this.nextAmbient = time + low + (high - low) * share;
            }
            if (time >= this.nextAmbient) {
                if (motion >= 0.5) this.takeWing(ambient.strength);
                else this.nextAmbient = null;
            }
        }
        this.writeSkein(time);
    }

    writeFamily(time, motion) {
        const { voyage, draws } = this;
        if (!voyage || !draws?.afloat) return;
        const { place } = this;
        const voyageTime = time + (Number.isFinite(this.shift) ? this.shift : 0);
        // How much the water moves them: Reduce motion's share, and a little more in a gust.
        const calm = clamp(motion, 0, 2.4);
        const manner = Math.min(calm, 1);
        let cygnet = 0;
        for (let i = 0; i < this.family.length; i += 1) {
            const member = this.family[i];
            swanFamilyPlace(voyage, member, voyageTime, place);
            const young = member.kind === 'cygnet';
            const seed = i * 1.7;
            // Riding the water: a slow rock and nod, a breath of bob.
            const roll = (0.03 * Math.sin(time * 0.83 + seed) + 0.012 * Math.sin(time * 2.1 + seed * 3)) * calm
                * (young ? 1.8 : 1);
            const nod = 0.018 * Math.sin(time * 0.61 + seed * 2.2) * calm * (young ? 1.6 : 1);
            const bob = 0.006 * Math.sin(time * 1.3 + seed) * calm;
            const hx = place[2];
            const hz = place[3];
            // The heading's left seen from above is (hz, 0, -hx); up leans a little to it and along.
            let ux = hz * roll + hx * nod;
            let uz = -hx * roll + hz * nod;
            const ul = Math.hypot(ux, 1, uz);
            ux /= ul;
            uz /= ul;
            const uy = 1 / ul;
            // Forward, square to that up.
            const along = hx * ux + hz * uz;
            let fx = hx - ux * along;
            let fy = -uy * along;
            let fz = hz - uz * along;
            const fl = Math.hypot(fx, fy, fz);
            fx /= fl;
            fy /= fl;
            fz /= fl;
            const [every, lasts, deep] = MANNERS.dip[member.kind];
            // Where the family stays it feeds: the heads go down far more often.
            const { feed } = MANNERS;
            const feeding = smooth(feed.from, feed.to, place[4]);
            const dip = Math.max(
                bell(time, every * (1 + 0.13 * (i % 3)), lasts, 11 + i * 9.7),
                feeding * bell(time, every * feed.every * (1 + 0.21 * (i % 4)), lasts, 5 + i * 6.1),
            ) * deep * manner;
            if (young) {
                put(draws.cygnets.data, cygnet, place[0], bob, place[1], member.size, fx, fy, fz, 0, ux, uy, uz, dip);
                cygnet += 1;
            } else {
                const { sails } = MANNERS;
                const lift = member.kind === 'cob'
                    ? sails.rest + (1 - sails.rest) * bell(time, sails.every, sails.lasts, 23) * manner : 0;
                put(draws.afloat.data, i, place[0], bob, place[1], member.size, fx, fy, fz, lift, ux, uy, uz, dip);
            }
        }
        draws.afloat.geometry.instanceCount = 2;
        draws.afloat.buffer.needsUpdate = true;
        if (draws.cygnets) {
            draws.cygnets.geometry.instanceCount = Math.max(1, cygnet);
            draws.cygnets.buffer.needsUpdate = true;
        }
    }

    writeSkein(time) {
        const draw = this.draws?.flying;
        if (!draw) return;
        const { flight, bird, wing } = this;
        let shown = 0;
        if (flight.live) {
            const age = time - flight.start;
            for (let i = 0; i < flight.count; i += 1) {
                const one = flight.birds[i];
                swanFlightPlace(flight, i, age, bird);
                swanWingbeat(TAU * one.hz * age + one.phase, wing);
                const [x, y, z, fx, fy, fz] = bird;
                // Up, square to the heading (the skein flies level turns: no bank to speak of).
                const flat = Math.hypot(fx, fz) || 1;
                const ux = (-fx * fy) / flat;
                const uz = (-fz * fy) / flat;
                put(draw.data, shown, x, y + wing[2], z, one.size, fx, fy, fz, wing[0], ux, flat, uz, wing[1]);
                shown += 1;
            }
        }
        // Nothing in the air: one bird of no size keeps the draw (and its pipeline) warm.
        if (shown === 0) put(draw.data, 0, 0, -50, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0);
        this.flying = shown;
        draw.geometry.instanceCount = Math.max(1, shown);
        draw.buffer.needsUpdate = true;
    }

    /** A faint ring behind the cob or the pen every few seconds, as the clock passes each beat. */
    wake(time, dt, motion) {
        const draw = this.draws?.afloat;
        if (!draw || !(dt > 0)) return null;
        const { wake } = MANNERS;
        const beat = Math.floor(time / wake.every);
        if (beat === this.wakeBeat) return null;
        const first = this.wakeBeat < 0;
        this.wakeBeat = beat;
        if (first) return null;
        const o = (beat % 2) * SWAN_STRIDE;
        const { ring } = this;
        ring.x = draw.data[o] - draw.data[o + 4] * 0.5;
        ring.z = draw.data[o + 2] - draw.data[o + 6] * 0.5;
        ring.strength = wake.strength * (0.7 + 0.3 * Math.sin(beat * 2.4) ** 2) * (0.6 + 0.4 * clamp01(motion));
        return ring;
    }

    dispose() {
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.draws = null;
        this.built = false;
        this.flight.live = false;
        this.group.removeFromParent();
        this.group.clear();
    }
}
