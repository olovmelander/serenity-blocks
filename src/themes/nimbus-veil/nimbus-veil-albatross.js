/**
 * Nimbus Veil — the albatrosses.
 *
 * The birds of a sea without a shore: a few great soaring birds cross the view on stiff, very
 * long wings, one behind the other on one course, swinging in a long S (up one side of it with
 * the belly shown, down the other and low over the cloud heads with the back shown), banked into
 * every turn. nimbus-veil-albatross-flight.js flies them by numbers; this file draws them.
 *
 * The bird is the theme's own, modelled in Blender at life size
 * (scripts/blender/nimbus_veil_albatross.py writes nimbus-veil-albatross-model.js: no file to
 * load). No skeleton: every vertex says how much of the shoulder's and of the wrist's turn and of
 * the tail's fan and twist it takes. One instanced draw: a bird is three rows of four numbers
 * (its place and size, its heading and roll, its wings and tail), posed on the CPU each frame
 * for the few birds there are and read in the vertex stage by the instance's number.
 *
 * The light is the cloud sea's: the sun on what is turned to it (wrapped a little: feathers
 * scatter), the sky from above, the bright deck from below (a white underwing over a sunlit sea
 * of cloud is lit from under), the sun through the thin flight feathers of a bird that stands
 * against it and along its outline, then the same air as the deck. Mostly the eye looks toward
 * the sun, so a bird is a dark back and a pale belly turning against the light.
 *
 * They are solid: they write their depth, a cloud head can hide one and a veil of mist drifts in
 * front of it. And a bird marks itself in the scene's alpha (ALBATROSS_MASK): bloom and the sun's
 * shafts are light ADDED over everything, and next to the sun they add more than a bird has, so
 * the post keeps its glare off whatever carries the mark (nimbus-veil-post.js) and a bird that
 * crosses the sun stays a dark shape instead of a pale ghost. Birds that are not in the air are drawn too, at no size, so the pipeline is built
 * with the rest of the world and the first passage in play compiles nothing.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, cos, cross, dot, float, instanceIndex, length, max, mix,
    normalGeometry, normalize, positionGeometry, screenSize, sin, step, uniformArray, varyingProperty, vec3, vec4,
} from 'three/tsl';
import { NIMBUS_VEIL_ALBATROSS } from './nimbus-veil-albatross-model.js';
import {
    ALBATROSS_MOST, ALBATROSS_ROWS, layAlbatrossPassage, poseAlbatrosses,
} from './nimbus-veil-albatross-flight.js';
import { nvApplyHaze } from './nimbus-veil-tsl.js';
import { SEA_HAZE } from './nimbus-veil-cloudsea.js';

/**
 * How the plumage takes the light: how far the sun wraps round the bird, the sky's share and the
 * deck's (the sun the cloud sea throws back up, and the sky it does), the sun through the thin
 * feathers of a bird that stands against it, the lining of light along its outline, how dark a
 * bird goes in the sun's own glare (the eye is stopped down there: a white bird against the sun is
 * a dark shape, and a pale one would be lost in the glow), and the least a far bird's thinnest
 * part is drawn (pixels: no line of it flickers in and out between two rows of them).
 */
export const ALBATROSS_LIGHT = Object.freeze({
    wrap: 0.3, sun: 0.9, sky: 1.1, deck: 0.42, deckSky: 0.8, through: 0.2, lining: 0.3, glare: 0.88, stout: 0.56,
});

/**
 * What a bird writes into the scene pass's alpha. Everything else in the world writes 1 or leaves
 * the alpha alone (the optics card adds its light with an alpha of 0).
 */
export const ALBATROSS_MASK = 0.3;

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
 * `colours` (linear r, g, b, thin), `rig` (arm, hand, tail, shade), `parts` and `index`. The
 * arrays are shared by every world built in a session.
 */
export function albatrossModel() {
    if (!decoded) {
        const M = NIMBUS_VEIL_ALBATROSS;
        const raw = (text, Type) => new Type(bytes(text).buffer);
        decoded = Object.freeze({
            vertexCount: M.vertexCount,
            triangleCount: M.triangleCount,
            positions: Float32Array.from(raw(M.positions, Int16Array), (v) => v * M.quant),
            normals: Float32Array.from(raw(M.normals, Int8Array), (v) => v / 127),
            colours: Float32Array.from(bytes(M.colours), (v) => v / 255),
            rig: Float32Array.from(bytes(M.rig), (v) => v / 255),
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
 * nimbus_veil_albatross.py's pose()).
 */
export function poseAlbatross(p, rig, arm = 0, hand = 0, fan = 0, twist = 0, out = [0, 0, 0]) {
    const M = NIMBUS_VEIL_ALBATROSS;
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
 * The albatrosses' material. The vertex stage folds the wings and steers the tail
 * (poseAlbatross's twin) and sets the bird on its heading and its roll; the fragment stage lights
 * the plumage as the cloud sea is lit and gives it the sea's air. `rows`: the birds' table.
 */
function createAlbatrossMaterial(u, rows) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NimbusAlbatross';
    material.fog = false;
    // Both sides: far off, where a wing is drawn no thinner than a pixel, its upper and lower
    // sheets stand apart, and from behind the eye looks in between them (its trailing edge is
    // sharp). Every surface carries its own outward normal, so neither side asks which it is.
    material.side = THREE.DoubleSide;
    const M = NIMBUS_VEIL_ALBATROSS;
    const L = ALBATROSS_LIGHT;
    const rig = attribute('albatrossRig', 'vec4');
    const tint = attribute('albatrossTint', 'vec4');
    const vNormal = varyingProperty('vec3', 'vNvAlbatrossNormal');
    const vWorld = varyingProperty('vec3', 'vNvAlbatrossWorld');
    const base = instanceIndex.mul(ALBATROSS_ROWS);
    const [Sx, Sy] = M.shoulder;
    const [Wx, Wy] = M.wrist;

    material.positionNode = Fn(() => {
        const at = rows.element(base).toVar(); // (its place, its size)
        const way = rows.element(base.add(1)).toVar(); // (its heading, its roll)
        const wings = rows.element(base.add(2)).toVar(); // (arm, hand, fan, twist)
        // Its frame: forward along its flight, up square to it, rolled into the turn.
        // (A bird that is not in the air has a heading all the same: the frame is made of numbers.)
        const fwd = normalize(way.xyz.add(vec3(0.0, 0.0, 1e-6))).toVar();
        const flat = normalize(vec3(fwd.z, 0.0, fwd.x.negate()).add(vec3(1e-6, 0.0, 0.0))).toVar();
        const tall = cross(fwd, flat).toVar();
        const left = flat.mul(cos(way.w)).add(tall.mul(sin(way.w))).toVar();
        const up = tall.mul(cos(way.w)).sub(flat.mul(sin(way.w))).toVar();
        // The wings and the tail.
        const armTurn = wings.x.mul(rig.x).toVar();
        const handTurn = wings.y.mul(rig.y).toVar();
        const twist = wings.w.mul(rig.z).toVar();
        const p = positionGeometry;
        const n = normalGeometry;
        const wing = step(0.0, p.x).mul(2.0).sub(1.0).toVar();
        let [du, dy] = turn(abs(p.x).sub(Wx), p.y.sub(Wy), handTurn);
        [du, dy] = turn(du.add(Wx - Sx), dy.add(Wy - Sy), armTurn);
        const spread = wing.mul(du.add(Sx)).mul(wings.z.mul(rig.z).mul(M.fanGain).add(1.0));
        const [lx, ly] = turn(spread, dy.add(Sy - M.tail[1]), twist);
        let [nu, nv] = turn(wing.mul(n.x), n.y, handTurn);
        [nu, nv] = turn(nu, nv, armTurn);
        const [nx, ny] = turn(wing.mul(nu), nv, twist);
        const normal = vec3(nx, ny, n.z).toVar();
        // Far off, a wing seen edge-on is thinner than a pixel: it is drawn no thinner than one.
        const size = at.w;
        const far = length(at.xyz.sub(cameraPosition));
        const pixel = float(2.0).div(u.invTanHalfV.mul(max(screenSize.y, 1.0)));
        const stout = pixel.mul(far).mul(L.stout).div(max(size, 0.01));
        const local = vec3(lx, ly.add(M.tail[1]), p.z).add(normal.mul(stout)).toVar();
        // (A bird that is not in the air has no size: every one of its triangles is a point.)
        const set = left.mul(local.x).add(up.mul(local.y)).add(fwd.mul(local.z));
        const world = at.xyz.add(set.mul(size)).toVar();
        vNormal.assign(left.mul(normal.x).add(up.mul(normal.y)).add(fwd.mul(normal.z)));
        vWorld.assign(world);
        return world;
    })();

    // The whole fragment, not a colour: an opaque material's own alpha is the mark (a colorNode's
    // would be forced to 1).
    material.fragmentNode = Fn(() => {
        const N = normalize(vNormal).toVar();
        const rel = vWorld.sub(cameraPosition).toVar();
        const view = normalize(rel).toVar();
        const sun = u.sunDir;
        const toward = dot(N, sun).toVar();
        const gloam = float(1.0).sub(u.day).toVar();
        const sunCol = u.mood.sunLight.mul(u.day).mul(L.sun).toVar();
        // The sun on what is turned to it, wrapped a little round the bird.
        const facing = clamp(toward.add(L.wrap).div(1 + L.wrap), 0.0, 1.0);
        // A bird that stands against the sun: a little of it comes through the flight feathers,
        // and its outline wears a lining of light as the cloud heads do.
        const against = clamp(dot(view, sun), 0.0, 1.0).toVar();
        const a2 = against.mul(against).toVar();
        const away = clamp(toward.negate().mul(0.5).add(0.5), 0.0, 1.0);
        const passed = tint.w.mul(a2.mul(a2)).mul(away).mul(L.through);
        const graze = float(1.0).sub(abs(dot(N, view))).toVar();
        const lining = graze.mul(graze).mul(graze).mul(a2.mul(a2)).mul(L.lining);
        // The sky from above; from below the deck: the sun it throws back up, and the sky it does.
        const sky = mix(u.mood.skyLow, u.mood.skyHigh, N.y.mul(0.5).add(0.5)).mul(gloam.mul(1.2).add(1.0)).mul(L.sky);
        const under = clamp(N.y.negate(), 0.0, 1.0);
        const deck = sunCol.mul(L.deck).add(u.mood.skyLow.mul(L.deckSky)).mul(under);
        // In the glare round the sun the bird is a dark shape (only its thin feathers and its
        // outline keep their light).
        const dim = float(1.0).sub(a2.mul(a2).mul(a2).mul(u.day).mul(L.glare));
        const lit = tint.xyz.mul(sunCol.mul(facing).add(sky.add(deck).mul(rig.w))).mul(dim)
            .add(tint.xyz.mul(sunCol).mul(passed))
            .add(sunCol.mul(lining).mul(tint.xyz.mul(0.6).add(0.1)));
        return vec4(nvApplyHaze(u, lit, rel, float(SEA_HAZE), u.sunPulse), ALBATROSS_MASK);
    })();
    return material;
}

/**
 * The albatrosses: `{ mesh, most, fly(slot, age, dur, frame), rest(), state(), dispose() }`.
 * `most` is how many birds this tier flies at once (a passage may hold fewer).
 *
 * @param {object} u     the world's uniforms
 * @param {number} most  the tier's birds
 */
export function createAlbatrosses(u, most) {
    const slots = Math.max(1, Math.min(ALBATROSS_MOST, Math.round(Number(most) || 1)));
    const model = albatrossModel();
    const table = Array.from({ length: slots * ALBATROSS_ROWS }, (_, i) => (
        // A heading for a bird that is not in the air.
        new THREE.Vector4(0, 0, i % ALBATROSS_ROWS === 1 ? 1 : 0, 0)
    ));
    const scratch = new Float64Array(ALBATROSS_MOST * ALBATROSS_ROWS * 4);
    const rows = uniformArray(table, 'vec4');
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(model.index, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(model.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(model.normals, 3));
    geometry.setAttribute('albatrossTint', new THREE.BufferAttribute(model.colours, 4));
    geometry.setAttribute('albatrossRig', new THREE.BufferAttribute(model.rig, 4));
    geometry.instanceCount = slots;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const material = createAlbatrossMaterial(u, rows);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NimbusAlbatross';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    // Solid: after the deck, before the sky is laid behind everything (the towers, the veils and
    // the light in the air come after, and stop at a bird or pass in front of it by its depth).
    mesh.renderOrder = -5;

    const plan = {};
    let laidFor = '';
    let flying = 0;

    const write = () => {
        for (let i = 0; i < table.length; i += 1) {
            table[i].set(scratch[i * 4], scratch[i * 4 + 1], scratch[i * 4 + 2], scratch[i * 4 + 3]);
        }
    };

    return {
        mesh,
        most: slots,
        table,
        /**
         * One frame of the passage of `slot`, `age` seconds in, of `dur` seconds in all, in the
         * lens's frame (nimbus-veil-albatross-flight.js AlbatrossFrame). Returns how many fly.
         */
        fly(slot, age, dur, frame) {
            const key = `${slot}:${dur}`;
            if (key !== laidFor) {
                layAlbatrossPassage(slot, slots, dur, plan);
                laidFor = key;
            }
            flying = poseAlbatrosses(plan, age, frame, scratch);
            write();
            return flying;
        },
        /** No birds in the air. */
        rest() {
            if (!flying && laidFor === '') return;
            flying = 0;
            laidFor = '';
            for (let i = 0; i < table.length; i += 1) table[i].set(0, 0, i % ALBATROSS_ROWS === 1 ? 1 : 0, 0);
        },
        /** What is in the air (tests, diagnostics): how many birds, and the passage's plan. */
        state() {
            return { flying, plan: laidFor ? plan : null };
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
