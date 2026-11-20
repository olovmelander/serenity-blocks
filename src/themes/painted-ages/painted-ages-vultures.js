/**
 * Painted Ages — the bearded vultures.
 *
 * The badlands' one creature: the lammergeier, the great soaring bird of these mountains, which
 * dyes its own breast rust orange by bathing in red iron-oxide earth (the bird that paints itself,
 * over painted rock). Two or three of them circle in a thermal over a hill, drifting downwind,
 * each gliding in over the frame's edge and out over it again; and now and then one comes past
 * the overlook's shoulder, close. painted-ages-vulture-routes.js lays the visits by numbers (where
 * they stand in each framing, clear of the board card and the HUD) and keeps the timetable.
 *
 * The bird is the theme's own, modelled in Blender at life size
 * (scripts/blender/painted_ages_vulture.py writes painted-ages-vulture-model.js: no file to load).
 * No skeleton: every vertex says how much of the shoulder's and of the wrist's turn and of the
 * tail's fan and twist it takes. One instanced draw; a bird's whole flight is a closed form of the
 * clock, evaluated in the vertex stage from five rows of numbers written when its visit begins
 * (a glide, an arc, a glide: its place, heading and bank, the wings' slow flex, a burst of deep
 * flaps as it sets off, the tail steering against the roll). Nothing is posed per frame on the
 * CPU: `update` only asks the timetable which visit the clock is in.
 *
 * The light is the land's: the sun on what is turned to it (wrapped a little: feathers scatter)
 * under the cloud deck's drifting shadow, the sky from above, the warm light the red rock throws
 * up onto the underside, a little sun through the spread flight feathers of a bird that stands
 * against it, then the same air as the hills (so a far bird sinks into the haze). Mostly a dark
 * shape on the sky; near, the pale shafts and the edges of its feathers show. They fly only while
 * the sun is up: the hour's light dissolves them toward the blue hour and under a game-over dusk.
 *
 * Dormant birds are drawn too, at no size, so the pipeline is built with the rest of the land and
 * the first visit in play compiles nothing.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, clamp, cos, cross, dot, faceDirection, float, floor, fract, fwidth, instanceIndex, length, max,
    normalGeometry, normalize, positionGeometry, select, sin, smoothstep, step, uniform, uniformArray, varyingProperty,
    vec3, vec4,
} from 'three/tsl';
import { PAINTED_AGES_VULTURE } from './painted-ages-vulture-model.js';
import {
    VULTURE_FLIGHT, VULTURE_MOST, VULTURE_ROWS, VULTURE_SEED, createVultureVisit, layVulturePass, layVultureThermal,
    vultureDaylight, vultureFraming, vulturePassAt, vultureRows, vultureThermalAt,
} from './painted-ages-vulture-routes.js';
import { aerial, cloudShadow } from './painted-ages-light.js';
import { flatVarying } from '../shared/flat-varying.js';

const TAU = Math.PI * 2;

/**
 * How the plumage takes the land's light: how far the sun wraps round the bird, the sky's and the
 * red ground's share, the sun through the thin feathers of a bird that stands against it, how
 * much paler a feather's shaft is, how much darker its edge and how far one feather's tone
 * stands from the next, and the least a far bird's thinnest part is drawn (pixels: no line of it
 * flickers in and out between two rows of them).
 */
export const VULTURE_LIGHT = Object.freeze({
    wrap: 0.3, sky: 1.0, bounce: 1.7, through: 0.5, shaft: 0.8, edge: 0.15, tone: 0.18, stout: 0.56,
});

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
 * `colours` (linear r, g, b, thin), `rig` (arm, hand, tail, shade), `feather` (number, along,
 * strength, spare), `parts` and `index`. The arrays are shared by every world built in a session.
 */
export function vultureModel() {
    if (!decoded) {
        const M = PAINTED_AGES_VULTURE;
        const raw = (text, Type) => new Type(bytes(text).buffer);
        const feather = Float32Array.from(raw(M.feather, Uint16Array), (v) => v / 65535);
        for (let i = 0; i < feather.length; i += 4) feather[i] *= 65535 * M.featherUnit;
        decoded = Object.freeze({
            vertexCount: M.vertexCount,
            triangleCount: M.triangleCount,
            positions: Float32Array.from(raw(M.positions, Int16Array), (v) => v * M.quant),
            normals: Float32Array.from(raw(M.normals, Int8Array), (v) => v / 127),
            colours: Float32Array.from(bytes(M.colours), (v) => v / 255),
            rig: Float32Array.from(bytes(M.rig), (v) => v / 255),
            feather,
            parts: bytes(M.partOf),
            index: raw(M.index, Uint16Array),
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
 * A vertex `p` with shares `rig` (arm, hand, tail, …): the wing turned `arm` radians about the
 * shoulder and `hand` about the wrist (+ up; the wrist first), the tail fanned by `fan` (-1 closed
 * .. 1 wide) and twisted `twist` radians about the body's axis. The vertex stage's twin (and
 * painted_ages_vulture.py's pose()).
 */
export function poseVulture(p, rig, arm = 0, hand = 0, fan = 0, twist = 0, out = [0, 0, 0]) {
    const M = PAINTED_AGES_VULTURE;
    const side = p[0] >= 0 ? 1 : -1;
    const [Sx, Sy] = M.shoulder;
    const [Wx, Wy] = M.wrist;
    let [du, dy] = turned(Math.abs(p[0]) - Wx, p[1] - Wy, hand * rig[1]);
    [du, dy] = turned(du + Wx - Sx, dy + Wy - Sy, arm * rig[0]);
    const x1 = side * (du + Sx) * (1 + M.fanGain * fan * rig[2]);
    const [tx, ty] = turned(x1, dy + Sy - M.tail[1], twist * rig[2]);
    /* eslint-disable no-param-reassign */
    out[0] = tx;
    out[1] = ty + M.tail[1];
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
 * The vultures' material. The vertex stage flies the bird (vulturePlace's and vultureWings' twin),
 * folds its wings and steers its tail (poseVulture's twin), and sets it on its heading and its
 * bank; the fragment stage lights the plumage as the land is lit and gives it the land's air.
 * `v`: the table of rows, the two visits' presence and how many of the birds are the thermal's.
 */
function createVultureMaterial(u, t, v) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PaintedAgesVultures';
    material.fog = false;
    // (Dissolved by the hour's light, so blended; but a bird is solid: it writes its depth, and
    // the sun's shafts and the motes behind it stop at it.)
    material.transparent = true;
    material.depthWrite = true;
    material.alphaTest = 0.004;
    // Both sides: far off, where the wing is drawn no thinner than a pixel, its upper and lower
    // sheets stand apart, and from behind the eye looks in between them (its trailing edge is sharp).
    material.side = THREE.DoubleSide;
    const M = PAINTED_AGES_VULTURE;
    const F = VULTURE_FLIGHT;
    const L = VULTURE_LIGHT;
    const rig = attribute('vultureRig', 'vec4');
    const tint = attribute('vultureTint', 'vec4');
    const feather = attribute('vultureFeather', 'vec4');
    const vNormal = varyingProperty('vec3', 'vPaVultureNormal');
    const vWorld = varyingProperty('vec3', 'vPaVultureWorld');
    const base = instanceIndex.mul(VULTURE_ROWS);
    const [Sx, Sy] = M.shoulder;
    const [Wx, Wy] = M.wrist;
    // Which visit a bird belongs to: the thermal's come first, the pass's own bird after them.
    const shown = select(instanceIndex.lessThan(v.thermalSlots), v.show.x, v.show.y);
    const vShow = flatVarying(shown, 'vPaVultureShow');

    material.positionNode = Fn(() => {
        const circle = v.rows.element(base).toVar(); // (middle x, middle z, radius, turn rate)
        const joins = v.rows.element(base.add(1)).toVar(); // (phase, height, joins at, leaves at)
        const air = v.rows.element(base.add(2)).toVar(); // (drift x, drift z, climb, sink)
        const self = v.rows.element(base.add(3)).toVar(); // (visit's start, size, bank, seed)
        const span = v.rows.element(base.add(4)).toVar(); // (drawn from, until, flaps at, flaps at)
        const age = u.time.sub(self.x).toVar();
        const side = step(0.0, circle.w).mul(2.0).sub(1.0).toVar();
        const held = clamp(age, joins.z, joins.w).toVar();
        const phi = joins.x.add(circle.w.mul(held.sub(joins.z))).toVar();
        const pace = abs(circle.w).mul(circle.z).toVar();
        const off = age.sub(held).toVar();
        const cosP = cos(phi).toVar();
        const sinP = sin(phi).toVar();
        const tx = sinP.negate().mul(side).toVar();
        const tz = cosP.mul(side).toVar();
        // The share of its bank it holds: none on the glides, all of it on the arc.
        const on = smoothstep(joins.z.sub(F.ease), joins.z.add(F.ease), age)
            .mul(float(1.0).sub(smoothstep(joins.w.sub(F.ease), joins.w.add(F.ease), age))).toVar();
        const rise = air.w.negate().add(air.z.add(air.w).mul(on)).toVar();
        // A burst of slow deep flaps: whichever of the two is running.
        const burstA = clamp(age.sub(span.z).mul(F.beat / F.beats), 0.0, 1.0).toVar();
        const burstB = clamp(age.sub(span.w).mul(F.beat / F.beats), 0.0, 1.0);
        const through = select(burstA.greaterThan(0.0).and(burstA.lessThan(1.0)), burstA, burstB).toVar();
        const beat = smoothstep(0.0, 0.18, through).mul(float(1.0).sub(smoothstep(0.82, 1.0, through))).toVar();
        const theta = through.mul(TAU * F.beats).toVar();
        const seed = self.w;
        const rock = sin(age.mul(F.rock[1]).add(seed.mul(40.0))).mul(F.rock[0])
            .add(sin(age.mul(F.rock[3]).add(seed.mul(11.0))).mul(F.rock[2])).toVar();
        const size = self.y;
        const middle = vec3(
            circle.x.add(air.x.mul(age)).add(circle.z.mul(cosP)).add(tx.mul(pace).mul(off)),
            joins.y.add(air.z.mul(held.sub(joins.z)))
                .add(air.w.mul(max(joins.z.sub(age), 0.0).sub(max(age.sub(joins.w), 0.0))))
                .sub(beat.mul(sin(theta)).mul(size).mul(F.heave)),
            circle.y.add(air.y.mul(age)).add(circle.z.mul(sinP)).add(tz.mul(pace).mul(off)),
        ).toVar();
        // Its frame: forward along its flight, up square to it, rolled into the turn.
        // (A dormant row has no pace: the offset keeps its heading a number.)
        const fwd = normalize(vec3(tx.mul(pace), rise, tz.mul(pace)).add(vec3(0.0, 0.0, 1e-6))).toVar();
        const flat = normalize(vec3(fwd.z, 0.0, fwd.x.negate()).add(vec3(1e-6, 0.0, 0.0))).toVar();
        const tall = cross(fwd, flat).toVar();
        const roll = self.z.mul(side).mul(on).add(rock).toVar();
        const left = flat.mul(cos(roll)).add(tall.mul(sin(roll))).toVar();
        const up = tall.mul(cos(roll)).sub(flat.mul(sin(roll))).toVar();
        // The wings and the tail.
        const armTurn = float(F.arm).add(sin(age.mul(F.lift[1]).add(seed.mul(29.0))).mul(F.lift[0]))
            .add(beat.mul(sin(theta)).mul(F.stroke[0])).mul(rig.x)
            .toVar();
        const handTurn = float(F.hand).add(sin(age.mul(F.flex[1]).add(seed.mul(6.3))).mul(F.flex[0]))
            .add(sin(age.mul(F.flex[3]).add(seed.mul(17.0))).mul(F.flex[2]))
            .add(beat.mul(sin(theta.sub(F.stroke[2]))).mul(F.stroke[1]))
            .mul(rig.y)
            .toVar();
        const fan = float(F.fan[0]).add(on.mul(F.fan[1] - F.fan[0]))
            .add(sin(age.mul(F.fan[3]).add(seed.mul(23.0))).mul(F.fan[2]));
        const twist = rock.mul(F.twist[0]).add(side.mul(on).mul(F.twist[1])).mul(rig.z).toVar();
        const p = positionGeometry;
        const n = normalGeometry;
        const wing = step(0.0, p.x).mul(2.0).sub(1.0).toVar();
        let [du, dy] = turn(abs(p.x).sub(Wx), p.y.sub(Wy), handTurn);
        [du, dy] = turn(du.add(Wx - Sx), dy.add(Wy - Sy), armTurn);
        const spread = wing.mul(du.add(Sx)).mul(fan.mul(rig.z).mul(M.fanGain).add(1.0));
        const [lx, ly] = turn(spread, dy.add(Sy - M.tail[1]), twist);
        let [nu, nv] = turn(wing.mul(n.x), n.y, handTurn);
        [nu, nv] = turn(nu, nv, armTurn);
        const [nx, ny] = turn(wing.mul(nu), nv, twist);
        const normal = vec3(nx, ny, n.z).toVar();
        // Far off, a wing seen edge-on is thinner than a pixel: it is drawn no thinner than one.
        const far = length(middle.sub(u.eye));
        const stout = u.pixelAngle.mul(far).mul(L.stout).div(max(size, 0.01));
        const local = vec3(lx, ly.add(M.tail[1]), p.z).add(normal.mul(stout)).toVar();
        // Out of its hours, or in no visit: drawn at no size.
        const alive = step(span.x, age).mul(step(age, span.y)).mul(step(0.004, shown));
        const set = left.mul(local.x).add(up.mul(local.y)).add(fwd.mul(local.z));
        const world = middle.add(set.mul(size.mul(alive))).toVar();
        vNormal.assign(left.mul(normal.x).add(up.mul(normal.y)).add(fwd.mul(normal.z)));
        vWorld.assign(world);
        return world;
    })();

    material.colorNode = Fn(() => {
        const N = normalize(vNormal).mul(faceDirection).toVar();
        const P = vWorld;
        const view = normalize(P.sub(u.eye)).toVar();
        const sun = u.sunDir;
        const toward = dot(N, sun).toVar();
        // The feathers: a thin pale shaft down each one's middle, its darker edge under the next
        // and a tone a little its own, gone before a feather is too few pixels wide to carry them.
        const across = abs(fract(feather.x).sub(0.5)).toVar();
        const grain = max(fwidth(feather.x), 1e-5).toVar();
        const fine = float(1.0).sub(smoothstep(0.14, 0.4, grain)).mul(clamp(feather.z, 0.0, 1.0)).toVar();
        const shaft = float(1.0).sub(smoothstep(grain.mul(0.7).add(0.012), grain.mul(1.4).add(0.04), across))
            .mul(smoothstep(0.05, 0.3, feather.y)).mul(fine)
            .toVar();
        const edge = smoothstep(0.4, 0.5, across).mul(fine);
        const tone = fract(sin(floor(feather.x).mul(12.9898)).mul(43758.5453)).sub(0.5).mul(fine);
        const albedo = tint.xyz.mul(float(1.0).sub(edge.mul(L.edge))).mul(tone.mul(L.tone).add(1.0))
            .mul(shaft.mul(L.shaft).add(1.0)).add(shaft.mul(0.012))
            .toVar();
        // The sun on what is turned to it, wrapped a little round the bird, under the deck's shadow.
        const facing = clamp(toward.add(L.wrap).div(1 + L.wrap), 0.0, 1.0);
        // A little of it through the flight feathers of a bird that stands against the sun.
        const against = clamp(dot(view, sun), 0.0, 1.0).toVar();
        const lit4 = against.mul(against).mul(against).mul(against);
        const passed = tint.w.mul(lit4).mul(clamp(toward.negate().mul(0.5).add(0.5), 0.0, 1.0)).mul(L.through);
        const direct = u.sun.mul(facing.add(passed)).mul(cloudShadow(u, t.noise, P)).mul(u.sunUp);
        // The sky from above, the red rock's warm light from below.
        const sky = u.fill.mul(N.y.mul(0.35).add(0.65)).mul(L.sky);
        const ground = u.bounce.mul(clamp(N.y.negate(), 0.0, 1.0)).mul(L.bounce);
        const lit = albedo.mul(direct.add(sky.add(ground).mul(rig.w)));
        return vec4(aerial(u, P, lit), clamp(vShow, 0.0, 1.0));
    })();
    return material;
}

/**
 * The vultures: `{ mesh, meshes, update(time, dt), dispose() }` and what a capture needs
 * (`stage`), what a test reads (`state`). `tier.vultures` is the most birds a thermal has; the
 * pass's own bird is drawn after them. (`fields`, the baked land, is every part's fourth
 * argument; the routes are laid clear of it by numbers and the tests hold them to it.)
 */
export function createVultures(u, textures, tier, fields, { seed = VULTURE_SEED } = {}) {
    const most = Math.max(1, Math.min(VULTURE_MOST, Math.round(Number(tier?.vultures) || 2)));
    const slots = most + 1;
    const model = vultureModel();
    const table = Array.from({ length: slots * VULTURE_ROWS }, () => new THREE.Vector4(0, 0, 0, 0));
    const scratch = new Float64Array(VULTURE_ROWS * 4);
    const v = {
        rows: uniformArray(table, 'vec4'),
        show: uniform(new THREE.Vector2(0, 0)),
        thermalSlots: most,
    };
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(model.index, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(model.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(model.normals, 3));
    geometry.setAttribute('vultureTint', new THREE.BufferAttribute(model.colours, 4));
    geometry.setAttribute('vultureRig', new THREE.BufferAttribute(model.rig, 4));
    geometry.setAttribute('vultureFeather', new THREE.BufferAttribute(model.feather, 4));
    geometry.instanceCount = slots;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 200, -400), 2000);
    const material = createVultureMaterial(u, textures, v);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PaintedAgesVultures';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    // After the cumulus banks (they stand kilometres behind any bird), before the motes' light.
    mesh.renderOrder = 12;

    const thermal = {
        visit: createVultureVisit(), number: -1, open: false, first: 0,
    };
    const pass = {
        visit: createVultureVisit(), number: -1, open: false, first: most,
    };
    let framing = '';
    let last = -Infinity;
    /** A visit staged by hand (a capture, a test): { kind, number, side, way, start }, or null. */
    let staged = null;

    /** Write a visit's birds into the table (the slots it does not fill lie dormant). */
    const write = (group, count) => {
        for (let i = 0; i < count; i += 1) {
            vultureRows(group.visit, i, scratch);
            for (let k = 0; k < VULTURE_ROWS; k += 1) {
                const row = table[(group.first + i) * VULTURE_ROWS + k];
                row.set(scratch[k * 4], scratch[k * 4 + 1], scratch[k * 4 + 2], scratch[k * 4 + 3]);
            }
        }
    };
    const clear = (group, count) => {
        // eslint-disable-next-line no-param-reassign
        group.visit.count = 0;
        write(group, count);
    };
    clear(thermal, most);
    clear(pass, 1);

    /** One group's turn: which visit the clock (or the capture) is in, laid when it changes. */
    const turnTo = (group, kind, time, day) => {
        let number = -1;
        if (staged) number = staged.kind === kind ? staged.number : -1;
        else number = kind === 'thermal' ? vultureThermalAt(time, seed) : vulturePassAt(time, seed);
        /* eslint-disable no-param-reassign */
        if (number !== group.number) {
            group.number = number;
            if (number >= 0) {
                const side = staged?.side || 0;
                if (kind === 'thermal') layVultureThermal(group.visit, number, framing, most, side, seed);
                else layVulturePass(group.visit, number, framing, side, staged?.way || 0, seed);
                if (staged) group.visit.epoch = staged.start;
                write(group, kind === 'thermal' ? most : 1);
            } else clear(group, kind === 'thermal' ? most : 1);
            // A visit that begins in the dark stays down: nothing fades in mid-flight.
            group.open = day > 0.5;
        } else if (day < 0.02) group.open = false;
        /* eslint-enable no-param-reassign */
        return number >= 0 && group.open ? day : 0;
    };

    const forget = () => {
        thermal.number = -2;
        pass.number = -2;
    };

    return {
        mesh,
        meshes: [mesh],
        slots,
        most,
        table,
        show: v.show,
        /**
         * One frame: only the timetable is asked (the birds fly in the vertex stage). The hour's
         * light is read from the uniforms the world has just written.
         */
        update(time) {
            const at = Number.isFinite(time) ? time : 0;
            const now = vultureFraming(u.aspect.value);
            // The clock ran back (a seek) or the frame changed shape: the visits are laid again.
            if (at < last - 1e-6 || now !== framing) forget();
            framing = now;
            last = at;
            const day = vultureDaylight(u.sunUp.value, u.dusk.value);
            v.show.value.set(turnTo(thermal, 'thermal', at, day), turnTo(pass, 'pass', at, day));
        },
        /**
         * Stage a visit by hand (a capture, a test): `kind` 'thermal' or 'pass' flies that visit
         * alone, `age` seconds into it at `time` (the clock's last by default; ages count from when
         * the first bird banks, so an arrival is a few seconds before 0), on `side` (-1 left, 1
         * right, 0 the timetable's), as visit `visit` of the timetable (its seeded birds), a pass
         * flown `way` (1, -1, 0 the timetable's). 'off': no birds. Anything else: the timetable again.
         */
        stage({
            kind = null, age = 0, side = 0, visit = 0, way = 0, time = last,
        } = {}) {
            const at = Number.isFinite(time) ? time : 0;
            if (kind === 'thermal' || kind === 'pass') {
                staged = {
                    kind,
                    number: Math.max(0, Math.round(Number(visit) || 0)),
                    side: Math.sign(Number(side) || 0),
                    way: Math.sign(Number(way) || 0),
                    start: at - (Number(age) || 0),
                };
            } else staged = kind === 'off' ? { kind: 'off', number: -1 } : null;
            forget();
        },
        /** What is in the air (tests, diagnostics). */
        state() {
            return {
                framing,
                thermal: thermal.number,
                pass: pass.number,
                birds: thermal.number >= 0 ? thermal.visit.count : 0,
                show: [v.show.value.x, v.show.value.y],
                staged: staged ? staged.kind : null,
                visits: { thermal: thermal.visit, pass: pass.visit },
            };
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
