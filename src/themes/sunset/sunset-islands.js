/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sunset — the islands: limestone karst standing out of the sea along the horizon.
 *
 * The sea stacks of the Andaman coast: steep grey-cream walls streaked with ochre and dark
 * seepage, the foot cut back by the sea into a dark notch, a cap of jungle on top and on every
 * ledge. They are scenery, 1.2 to 8 km out, never near the eye: a tall tower with a needle beside
 * it and a long ridge either side of the place the sun goes down, a tower and a ridge either side
 * of the place it comes up, and far islets behind them that the air has all but taken.
 *
 * The four shapes are the theme's own, modelled in Blender (scripts/blender/sunset_islands.py
 * writes sunset-islands-model.js). Each is used several times, turned, scaled and mirrored, so
 * four shapes stand as fourteen islands.
 *
 * Where they stand. The picture is composed round the card: the sun and the moon set at one
 * bearing (`setAz`) and rise at another (`riseAz`), and those two gates must stay open sea, for
 * the disc touching the water and its road of light. So the islands come in two groups, one
 * round each gate, each turned about the eye's foot so its islands keep their bearings from
 * their gate when the layout moves it; within a group nothing comes nearer its gate than
 * GATE_CLEAR degrees. When a layout brings the two gates close together (a narrow window with
 * no board), the islands of one group that would then stand in the OTHER gate are left out.
 *
 * The light is the boat's (sunset-boat.js): the sky the surface faces and the sea's light from
 * below, the sun or the moon on the faces turned to it, a silhouette against a low light with a
 * thin burning rim on the side the light is, and the far sea's own haze between the eye and the
 * island. Rock is shaded by its facets, so its form shadows stay crisp; the jungle by its
 * rounded crowns, and it lets a little light through at its rim.
 *
 * `skyline` is what the sea needs to mirror them: for every bearing from each gate, how high the
 * land stands over the horizon and how far off it is (see SKYLINE). `lights()` are points
 * round the near islands' feet, just over the water, where a village lamp can be lit at dusk.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, dot, exp, float, length, max, min, mix, normalLocal, normalWorld,
    normalize, positionLocal, positionWorld, smoothstep, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { DEG, EYE_HEIGHT, mulberry32 } from './sunset-core.js';
import { SUNSET_ISLANDS } from './sunset-islands-model.js';
import { horizonHaze, skyBase } from './sunset-tsl.js';

/** No island comes nearer its gate than this (degrees of bearing, at any height). */
export const GATE_CLEAR = 6.5;

/**
 * Where every island stands. `at`: degrees from its group's gate (negative: left of it);
 * `range`: metres from the eye's foot; `yaw`: how far it is turned (degrees; 0 shows the eye the
 * side the Blender script calls "side"); `scale`; `mirror`: its left and right changed over;
 * `lamps`: how many lights may hang round its foot (the near islands only).
 */
const isle = (shape, at, range, yaw, scale = 1, more = {}) => Object.freeze({
    shape, at, range, yaw, scale, mirror: false, lamps: 0, ...more,
});

export const ISLAND_LAYOUT = Object.freeze({
    // Round the place the sky goes down.
    set: Object.freeze([
        // The hero pair on the card's side: the tall tower, and the needle between it and the light.
        isle('tower', 11.55, 1560, 52, 1, { lamps: 3 }),
        isle('stack', 8.2, 1290, -20, 1, { lamps: 1 }),
        // The long ridge on the far side, its sheer end toward the light and turned to the eye.
        isle('ridge', -13.2, 2250, 147, 1, { lamps: 3 }),
        // Far islets, for depth. Each stands clear of the near ones (one that peeps out from
        // behind a near island's edge reads as that island's ghost): a needle alone between the
        // ridge and the light, and more either side that other layouts bring into the picture.
        isle('stack', -7.35, 5000, 215, 2.2),
        isle('ridge', -25.5, 5600, 200, 1.3, { mirror: true }),
        isle('tower', -31.5, 4800, 80, 1.1, { mirror: true }),
        isle('tower', 17.0, 4700, 250, 0.95, { mirror: true }),
        isle('ridge', 21.2, 5400, 15, 1.15),
    ]),
    // Round the place it comes up.
    rise: Object.freeze([
        // A tower on the card's side, small enough to stand right of the stats bar.
        isle('tower', -8.9, 2500, 200, 0.85, { mirror: true, lamps: 2 }),
        // The ridge on the far side, its sheer end toward the light and turned to the eye.
        isle('ridge', 12.0, 2050, 35, 1, { lamps: 3 }),
        // Far islets: a long island in the gap between the card and the stats bar, and more
        // behind them and beyond the ridge.
        isle('ridge', -19.7, 5200, 170, 1.2),
        isle('islet', -13.3, 4300, 80, 1.6, { mirror: true }),
        isle('tower', -27.0, 5800, 120, 1.1),
        isle('ridge', 21.5, 5600, 340, 1.3, { mirror: true }),
    ]),
});

/** The groups, in the order of the skyline's rows. */
export const ISLAND_GROUPS = Object.freeze(['set', 'rise']);

/**
 * The skyline the sea mirrors: `width` columns across `half` degrees either side of a gate, a
 * row a group. R: the tangent of the land's height over the horizon, over `tanMax`; G: how far
 * off that land is, over `far` metres; B: land or none.
 */
export const SKYLINE = Object.freeze({
    width: 512, half: 40, tanMax: 0.2, far: 9000,
});

/** How the light falls on an island (shares of the hour's colours, as for the boat). */
export const TONE = Object.freeze({
    sky: 0.62,
    sea: 0.34,
    seaSun: 0.1,
    /** What is left of the sky's light on a face seen against a low light. */
    against: 0.16,
    key: 1.0,
    keyAgainst: 0.5,
    /** The burning rim near the light: on rock, and through the jungle's edge. */
    rim: 0.6,
    leaf: 0.4,
    /** How much of the key light the jungle lets through to its shaded side. */
    through: 0.5,
    /**
     * How much further the air's haze reaches for an island than for the sea (a multiple of
     * TUNE.hazeReach). The sea pales fast because what fades is a dark body under a grazing
     * mirror; a wall standing in the same air keeps its darks for longer.
     */
    air: 2.0,
    /** How far the rock is shaded by its facets, and the jungle (the rest by its smooth normal). */
    facetRock: 0.78,
    facetJungle: 0.3,
});

/** The grain drawn on the islands in the fragment (metres a tile of the detail noise spans). */
export const GRAIN = Object.freeze({
    /** Stains running down a wall: across it, and down it. */
    streak: Object.freeze([110, 620]),
    /** Beds of limestone: along the wall, and their thickness. */
    bed: Object.freeze([640, 58]),
    /** The jungle's crowns. */
    crown: 84,
});

// ── The models ────────────────────────────────────────────────────────────────────────────

function decode(text, Type) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer);
}

let decoded = null;

/** The shapes as the bundle carries them, decoded once: { name: { positions, index, colours, … } }. */
export function islandModels() {
    if (decoded) return decoded;
    const { quant } = SUNSET_ISLANDS;
    decoded = Object.freeze(Object.fromEntries(SUNSET_ISLANDS.shapes.map((shape) => [shape.name, Object.freeze({
        name: shape.name,
        positions: Float32Array.from(decode(shape.positions, Int16Array), (v) => v * quant),
        index: decode(shape.index, Uint16Array),
        colours: decode(shape.colours, Uint8Array),
        vertexCount: shape.vertexCount,
        triangleCount: shape.triangleCount,
        height: shape.height,
        radius: shape.radius,
        lamps: shape.lamps,
    })])));
    return decoded;
}

/** A point of an island's own frame → its group's frame (the gate along −z), in place. */
function placePoint(island, out) {
    const turn = (island.yaw - island.at) * DEG;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const x = out.x * island.scale * (island.mirror ? -1 : 1);
    const z = out.z * island.scale;
    out.x = x * c + z * s + island.range * Math.sin(island.at * DEG);
    out.y *= island.scale;
    out.z = -x * s + z * c - island.range * Math.cos(island.at * DEG);
    return out;
}

/** A bearing from the gate (degrees, negative left) of a point of a group's frame. */
const bearingOf = (x, z) => Math.atan2(x, -z) / DEG;

/**
 * One group's islands as one mesh's arrays, in the group's frame. The islands are in the order
 * they would be left out: the one reaching furthest toward the OTHER gate last. `islands[i]`
 * carries its span of bearings (`from`, `to`), how far it reaches toward the other gate
 * (`inner`), its height as the eye sees it (`tall`, degrees), where its triangles end in the
 * index (`indexEnd`) and its lamp points.
 */
export function placeIslands(group) {
    const models = islandModels();
    const toward = group === 'set' ? 1 : -1;
    const tmp = { x: 0, y: 0, z: 0 };
    const placed = ISLAND_LAYOUT[group].map((island) => {
        const model = models[island.shape];
        const spec = {
            scale: 1, mirror: false, lamps: 0, ...island,
        };
        const positions = new Float32Array(model.positions.length);
        let from = Infinity;
        let to = -Infinity;
        let tall = 0;
        for (let i = 0; i < model.positions.length; i += 3) {
            tmp.x = model.positions[i];
            tmp.y = model.positions[i + 1];
            tmp.z = model.positions[i + 2];
            placePoint(spec, tmp);
            positions[i] = tmp.x;
            positions[i + 1] = tmp.y;
            positions[i + 2] = tmp.z;
            const bearing = bearingOf(tmp.x, tmp.z);
            from = Math.min(from, bearing);
            to = Math.max(to, bearing);
            tall = Math.max(tall, Math.atan2(tmp.y - EYE_HEIGHT, Math.hypot(tmp.x, tmp.z)) / DEG);
        }
        // Lamp points: the ones on the side the eye sees, spread along the foot.
        const lamps = [];
        if (spec.lamps > 0) {
            const centre = placePoint(spec, { x: 0, y: 0, z: 0 });
            const seen = model.lamps.map(([x, y, z]) => {
                const p = placePoint(spec, { x, y, z });
                const range = Math.hypot(p.x, p.z);
                const out = Math.hypot(p.x - centre.x, p.z - centre.z) || 1;
                // How squarely this side of the island faces the eye.
                const facing = -((p.x - centre.x) * p.x + (p.z - centre.z) * p.z) / (out * range);
                return { ...p, bearing: bearingOf(p.x, p.z), facing };
            }).filter((p) => p.facing > 0.15).sort((a, b) => a.bearing - b.bearing);
            for (let k = 0; k < Math.min(spec.lamps, seen.length); k += 1) {
                const pick = seen[Math.round(((k + 0.5) / spec.lamps) * seen.length - 0.5)];
                lamps.push({ x: pick.x, y: pick.y, z: pick.z });
            }
        }
        return {
            spec, model, positions, from, to, tall, lamps, inner: toward * (toward > 0 ? to : from),
        };
    }).sort((a, b) => a.inner - b.inner);

    const vertexCount = placed.reduce((sum, p) => sum + p.model.vertexCount, 0);
    const indexCount = placed.reduce((sum, p) => sum + p.model.index.length, 0);
    const positions = new Float32Array(vertexCount * 3);
    const colours = new Uint8Array(vertexCount * 4);
    const index = new Uint32Array(indexCount);
    let v = 0;
    let k = 0;
    const islands = placed.map((p) => {
        positions.set(p.positions, v * 3);
        colours.set(p.model.colours, v * 4);
        const src = p.model.index;
        // A mirrored island's faces are wound the other way: turn them back outward.
        const flip = p.spec.mirror === true;
        for (let i = 0; i < src.length; i += 3) {
            index[k] = v + src[i];
            index[k + 1] = v + src[flip ? i + 2 : i + 1];
            index[k + 2] = v + src[flip ? i + 1 : i + 2];
            k += 3;
        }
        v += p.model.vertexCount;
        return Object.freeze({
            shape: p.spec.shape,
            at: p.spec.at,
            range: p.spec.range,
            scale: p.spec.scale,
            from: p.from,
            to: p.to,
            inner: p.inner,
            tall: p.tall,
            lamps: p.lamps,
            indexEnd: k,
        });
    });
    return {
        group, positions, colours, index, islands,
    };
}

/**
 * One row of the skyline from a group's placed mesh (its first `indexCount` indices): per
 * column the highest the land stands over the horizon as the eye at (0, EYE_HEIGHT, 0) sees it
 * (a tangent), and how far off that land is. Every edge of every triangle is walked across the
 * columns it spans, so no column between two vertices is left empty. Returns { tan, range }.
 */
export function skylineRow(placed, indexCount = placed.index.length) {
    const { width, half } = SKYLINE;
    const tan = new Float32Array(width);
    const range = new Float32Array(width);
    const { positions, index } = placed;
    const count = positions.length / 3;
    const column = new Float32Array(count);
    const rise = new Float32Array(count);
    const far = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        const x = positions[i * 3];
        const z = positions[i * 3 + 2];
        far[i] = Math.hypot(x, z);
        column[i] = ((bearingOf(x, z) + half) / (2 * half)) * width - 0.5;
        rise[i] = (positions[i * 3 + 1] - EYE_HEIGHT) / far[i];
    }
    const walk = (a, b) => {
        const lo = column[a] <= column[b] ? a : b;
        const hi = lo === a ? b : a;
        const first = Math.max(0, Math.ceil(column[lo]));
        const last = Math.min(width - 1, Math.floor(column[hi]));
        const span = column[hi] - column[lo];
        for (let c = first; c <= last; c += 1) {
            const t = span > 1e-9 ? (c - column[lo]) / span : 0;
            const h = rise[lo] + (rise[hi] - rise[lo]) * t;
            if (h > tan[c]) {
                tan[c] = h;
                range[c] = far[lo] + (far[hi] - far[lo]) * t;
            }
        }
    };
    for (let i = 0; i < indexCount; i += 3) {
        walk(index[i], index[i + 1]);
        walk(index[i + 1], index[i + 2]);
        walk(index[i + 2], index[i]);
    }
    return { tan, range };
}

/** Write a skyline row into the texture's bytes (row 0: the set group, row 1: the rise group). */
function writeSkyline(data, row, { tan, range }) {
    const { width, tanMax, far } = SKYLINE;
    for (let c = 0; c < width; c += 1) {
        const at = (row * width + c) * 4;
        const land = tan[c] > 0;
        data[at] = land ? Math.max(1, Math.min(255, Math.round((tan[c] / tanMax) * 255))) : 0;
        data[at + 1] = land ? Math.min(255, Math.round((range[c] / far) * 255)) : 0;
        data[at + 2] = land ? 255 : 0;
        data[at + 3] = 255;
    }
}

// ── The grain ─────────────────────────────────────────────────────────────────────────────

/** A tileable value-noise fBm, 0..1 (mean 0.5), `cells` lattice cells across at its broadest. */
function grainField(size, rand, cells, octaves) {
    const out = new Float32Array(size * size);
    let amp = 1;
    let total = 0;
    for (let o = 0; o < octaves; o += 1) {
        const n = cells * 2 ** o;
        const lattice = new Float32Array(n * n);
        for (let i = 0; i < lattice.length; i += 1) lattice[i] = rand();
        for (let j = 0; j < size; j += 1) {
            const y = (j * n) / size;
            const y0 = Math.floor(y);
            const fy = y - y0;
            const sy = fy * fy * (3 - 2 * fy);
            for (let i = 0; i < size; i += 1) {
                const x = (i * n) / size;
                const x0 = Math.floor(x);
                const fx = x - x0;
                const sx = fx * fx * (3 - 2 * fx);
                const a = lattice[(y0 % n) * n + (x0 % n)];
                const b = lattice[(y0 % n) * n + ((x0 + 1) % n)];
                const c = lattice[((y0 + 1) % n) * n + (x0 % n)];
                const d = lattice[((y0 + 1) % n) * n + ((x0 + 1) % n)];
                out[j * size + i] += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * amp;
            }
        }
        total += amp;
        amp *= 0.5;
    }
    for (let i = 0; i < out.length; i += 1) out[i] /= total;
    return out;
}

/** A tileable field of round clumps: 1 at a clump's heart, 0 between clumps. */
function clumpField(size, rand, cells) {
    const px = new Float32Array(cells * cells);
    const py = new Float32Array(cells * cells);
    for (let i = 0; i < px.length; i += 1) {
        px[i] = 0.15 + 0.7 * rand();
        py[i] = 0.15 + 0.7 * rand();
    }
    const out = new Float32Array(size * size);
    for (let j = 0; j < size; j += 1) {
        const y = (j * cells) / size;
        const cy = Math.floor(y);
        for (let i = 0; i < size; i += 1) {
            const x = (i * cells) / size;
            const cx = Math.floor(x);
            let best = 9;
            for (let oy = -1; oy <= 1; oy += 1) {
                for (let ox = -1; ox <= 1; ox += 1) {
                    const gx = cx + ox;
                    const gy = cy + oy;
                    const at = (((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells);
                    const dx = gx + px[at] - x;
                    const dy = gy + py[at] - y;
                    best = Math.min(best, dx * dx + dy * dy);
                }
            }
            out[j * size + i] = Math.max(0, 1 - Math.sqrt(best) * 1.5);
        }
    }
    return out;
}

/**
 * The grain's noise, as bytes (RGBA8), tileable: R the stains that run down a wall, G where
 * water seeps, B the jungle's crowns, A the beds of the limestone.
 */
export function bakeIslandGrain(size = 128, seed = 20261117) {
    const rand = mulberry32(seed);
    const stain = grainField(size, rand, 8, 3);
    const seep = grainField(size, rand, 11, 2);
    const crown = clumpField(size, rand, 9);
    const bed = grainField(size, rand, 7, 3);
    const data = new Uint8Array(size * size * 4);
    const byte = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255);
    for (let i = 0; i < size * size; i += 1) {
        data[i * 4] = byte((stain[i] - 0.5) * 2.2 + 0.5);
        data[i * 4 + 1] = byte((seep[i] - 0.5) * 2.4 + 0.5);
        data[i * 4 + 2] = byte(crown[i]);
        data[i * 4 + 3] = byte((bed[i] - 0.5) * 2.2 + 0.5);
    }
    return data;
}

// ── The part ──────────────────────────────────────────────────────────────────────────────

/**
 * The islands: `update(clock, { setAz, riseAz })` turns the two groups to their gates (degrees
 * right of the line the eye looks down); nothing else moves. `skyline` and `lights()` are for
 * the sea and the lamps (see the file's header).
 */
export function createIslands({ U, seed = 29 }) {
    const grainSize = 128;
    const grainBytes = bakeIslandGrain(grainSize, 20261117 + seed);
    const grain = new THREE.DataTexture(grainBytes, grainSize, grainSize, THREE.RGBAFormat);
    grain.wrapS = THREE.RepeatWrapping;
    grain.wrapT = THREE.RepeatWrapping;
    grain.magFilter = THREE.LinearFilter;
    grain.minFilter = THREE.LinearMipmapLinearFilter;
    grain.generateMipmaps = true;
    grain.anisotropy = 4;
    grain.colorSpace = THREE.NoColorSpace;
    grain.needsUpdate = true;
    grain.name = 'sunset-islands-grain';

    const aPaint = attribute('color', 'vec4');

    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'sunset-islands';
    material.colorNode = Fn(() => {
        const { light } = U;
        const paint = aPaint.toVar();
        const jungle = paint.a;
        // The island's own frame (its group's): the grain must not swim when a gate moves.
        const P = positionLocal.toVar();
        const Nl = normalize(normalLocal).toVar();
        const Ns = normalize(normalWorld).toVar();
        // The facet's own normal: rock keeps its edges, its form shadows crisp.
        const facet = positionWorld.dFdx().cross(positionWorld.dFdy());
        const Nf = normalize(facet.add(Ns.mul(1e-5))).toVar();
        const N = normalize(mix(Ns, Nf, mix(float(TONE.facetRock), float(TONE.facetJungle), jungle))).toVar();

        // ── The grain. Stains stand in the rock, not in the face: one set of upright sheets
        // across x and one across z, and a face shows the set that crosses it (the two RESULTS
        // are mixed; a mixed coordinate would swirl with every turn of the wall). ──
        const alongX = Nl.x.mul(Nl.x).div(Nl.x.mul(Nl.x).add(Nl.z.mul(Nl.z)).add(1e-4));
        const [across, down] = GRAIN.streak;
        const runA = texture(grain, vec2(P.z.div(across), P.y.div(down)));
        const runB = texture(grain, vec2(P.x.div(across).add(0.37), P.y.div(down).add(0.61)));
        const run = mix(runB, runA, alongX).toVar();
        const bed = texture(grain, vec2(P.x.add(P.z).div(GRAIN.bed[0]), P.y.div(GRAIN.bed[1]))).a;
        const crown = texture(grain, P.xz.div(GRAIN.crown).add(vec2(P.y.div(GRAIN.crown * 1.7), 0.0))).b;
        // Rock: lighter and darker runs, rust where they are strongest, dark where water seeps,
        // and the beds as faint bands.
        const stain = smoothstep(0.5, 0.82, run.r);
        const rockTone = run.r.mul(0.55).add(0.62).mul(bed.mul(0.36).add(0.82))
            .mul(float(1.0).sub(smoothstep(0.55, 0.85, run.g).mul(0.55)));
        const rock = paint.rgb.mul(mix(vec3(1.0), vec3(1.12, 0.78, 0.46), stain.mul(0.75))).mul(rockTone).toVar();
        // Jungle: the crowns lighter than the dark between them.
        const leaves = paint.rgb.mul(crown.mul(0.8).add(0.6)).toVar();

        // ── The light (the boat's, sunset-boat.js). ──
        const toIsle = positionWorld.sub(cameraPosition).toVar();
        const dist = length(toIsle).toVar();
        const look = toIsle.div(dist).toVar();
        const key = normalize(mix(U.sun, U.moon, U.moonKey)).toVar();
        const keyUp = mix(U.sunUp, U.moonUp, U.moonKey).toVar();
        // The sky the face looks at, and the sea's light from below.
        const seeSky = N.y.mul(0.5).add(0.5);
        const skyLight = skyBase(normalize(vec3(N.x, max(N.y, 0.0).add(0.25), N.z)), U);
        const seaLight = skyBase(normalize(vec3(N.x, 0.12, N.z)), U).mul(TONE.sea)
            .add(light.cloudLit.mul(keyUp).mul(TONE.seaSun));
        // Seen against a low light an island is a cut-out; with the sun high it is a place in
        // the light.
        const toward = dot(look, key).toVar();
        const sunHigh = smoothstep(Math.sin(18 * DEG), Math.sin(38 * DEG), key.y);
        const glare = smoothstep(Math.cos(55 * DEG), Math.cos(12 * DEG), toward).mul(sunHigh.oneMinus()).toVar();
        const ambient = mix(seaLight, skyLight.mul(TONE.sky), seeSky)
            .mul(mix(float(1.0), float(TONE.against), glare));
        const facing = dot(N, key).toVar();
        const keyLight = light.cloudLit.mul(keyUp.mul(mix(float(1.0), float(TONE.keyAgainst), glare))).toVar();
        const direct = keyLight.mul(max(facing, 0.0).mul(TONE.key));
        // Leaves let the light through: a crown seen from its shaded side glows yellow-green.
        const through = keyLight.mul(max(facing.negate(), 0.0).mul(0.7).add(0.3).mul(TONE.through))
            .mul(vec3(0.8, 1.0, 0.42));
        // The burning rim. A facet seen nearly edge-on is a sliver along the outline or along
        // a rib: those burn, on the side that looks toward the light ACROSS the picture (the
        // light's direction with the line of sight taken out of it), near the light only, and
        // as long as any of the disc stands over the sea.
        const edge = smoothstep(0.5, 0.9, float(1.0).sub(abs(dot(N, look))));
        const nearLight = smoothstep(Math.cos(34 * DEG), Math.cos(7 * DEG), toward);
        const aside = key.sub(look.mul(toward)).toVar();
        const lightSide = smoothstep(-0.2, 0.45, dot(N, aside.div(max(length(aside), 1e-3))));
        const rim = light.cloudRim.mul(edge.mul(nearLight).mul(lightSide).mul(smoothstep(0.0, 0.4, keyUp))
            .mul(mix(float(TONE.rim), float(TONE.leaf), jungle)));
        const lit = ambient.add(direct).toVar();
        const col = mix(rock.mul(lit), leaves.mul(lit.add(through)), jungle).add(rim);
        // The air between the eye and the island: the far sea's own haze.
        // (U.hazeReach: how far the eye sees is the weather's.)
        const haze = float(1.0).sub(exp(dist.div(U.hazeReach.mul(TONE.air)).negate()));
        return vec4(mix(col, horizonHaze(look, U), haze.mul(min(haze.mul(1.4), 1.0))), 1.0);
    })();

    const root = new THREE.Group();
    root.name = 'sunset-islands';
    const skylineData = new Uint8Array(SKYLINE.width * 2 * 4);
    const skylineTexture = new THREE.DataTexture(skylineData, SKYLINE.width, 2, THREE.RGBAFormat);
    skylineTexture.wrapS = THREE.ClampToEdgeWrapping;
    skylineTexture.wrapT = THREE.ClampToEdgeWrapping;
    skylineTexture.magFilter = THREE.LinearFilter;
    skylineTexture.minFilter = THREE.LinearFilter;
    skylineTexture.generateMipmaps = false;
    skylineTexture.colorSpace = THREE.NoColorSpace;
    skylineTexture.name = 'sunset-islands-skyline';

    const groups = ISLAND_GROUPS.map((name, row) => {
        const placed = placeIslands(name);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(placed.positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(placed.index, 1));
        geometry.computeVertexNormals();
        geometry.setAttribute('color', new THREE.BufferAttribute(placed.colours, 4, true));
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `sunset-islands-${name}`;
        // Opaque, after the sea, before the sky's dome: the dome is shaded only where they are not.
        mesh.renderOrder = 5;
        // (Turned with its group: its bounds are the whole arc of the horizon.)
        mesh.frustumCulled = false;
        const group = new THREE.Group();
        group.name = `sunset-islands-${name}-group`;
        group.add(mesh);
        root.add(group);
        return {
            name, row, placed, geometry, mesh, group, az: NaN, drawn: -1,
        };
    });

    const state = {
        shown: true, setAz: NaN, riseAz: NaN, room: Infinity,
    };
    const lamps = [];

    /** How many of a group's islands stand clear of the other gate, `room` degrees away. */
    const clearOf = (g, room) => {
        let n = 0;
        while (n < g.placed.islands.length && g.placed.islands[n].inner <= room) n += 1;
        return n;
    };

    const refreshLamps = () => {
        lamps.length = 0;
        groups.forEach((g) => {
            const turn = g.group.rotation.y;
            const c = Math.cos(turn);
            const s = Math.sin(turn);
            for (let i = 0; i < g.drawn; i += 1) {
                const island = g.placed.islands[i];
                island.lamps.forEach((p) => {
                    lamps.push({
                        x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c, group: g.name, range: island.range,
                    });
                });
            }
        });
    };

    const update = (_clock, { setAz, riseAz }) => {
        if (setAz === state.setAz && riseAz === state.riseAz) return;
        state.setAz = setAz;
        state.riseAz = riseAz;
        // Each group turns to its gate; an island that would stand in the other gate is left out.
        state.room = riseAz - setAz - GATE_CLEAR;
        let redraw = false;
        groups.forEach((g) => {
            const az = g.name === 'set' ? setAz : riseAz;
            g.group.rotation.y = -az * DEG;
            const drawn = clearOf(g, state.room);
            if (drawn !== g.drawn) {
                g.drawn = drawn;
                const indexCount = drawn > 0 ? g.placed.islands[drawn - 1].indexEnd : 0;
                g.geometry.setDrawRange(0, indexCount);
                writeSkyline(skylineData, g.row, skylineRow(g.placed, indexCount));
                redraw = true;
            }
        });
        if (redraw) skylineTexture.needsUpdate = true;
        refreshLamps();
    };
    // The solo layout's gates until the world gives its own (the skyline and the lamps are
    // then never empty).
    update(0, { setAz: -25, riseAz: 32 });

    return {
        /** The two groups under one root (the world adds this to its own group). */
        mesh: root,
        material,
        meshes: groups.map((g) => g.mesh),
        skyline: Object.freeze({
            texture: skylineTexture, half: SKYLINE.half, tanMax: SKYLINE.tanMax, far: SKYLINE.far,
        }),
        update,
        /** World points just over the water round the near islands' feet: { x, y, z, group, range }. */
        lights() {
            return lamps;
        },
        /** Draw the islands or leave them out (a capture of some parts only). */
        setShown(on) {
            state.shown = on !== false;
            root.visible = state.shown;
        },
        /** For the tests and the playground's diagnostics. */
        getState() {
            return {
                shown: state.shown,
                setAz: state.setAz,
                riseAz: state.riseAz,
                room: state.room,
                islands: Object.fromEntries(groups.map((g) => [g.name, g.placed.islands.length])),
                drawn: Object.fromEntries(groups.map((g) => [g.name, Math.max(0, g.drawn)])),
                triangles: groups.reduce((sum, g) => sum + g.geometry.drawRange.count / 3, 0),
                lights: lamps.length,
            };
        },
        dispose() {
            root.removeFromParent();
            groups.forEach((g) => g.geometry.dispose());
            material.dispose();
            grain.dispose();
            skylineTexture.dispose();
        },
    };
}
