/**
 * Verdant Hills — the plants of the down, as geometry.
 *
 * Long grass in clumps, and the four flowers that grow through it: buttercup, oxeye daisy,
 * red clover and the dandelion's clock. Every plant is real geometry built here from a
 * seed; nothing is an alpha card, so blades stay sharp against the light and need no
 * blending.
 *
 * Vertex data the meadow's shaders read:
 *   uv      x = a per-blade id, y = 0 at the root to 1 at the tip (grass only)
 *   paint   x = height above the root in metres (how far the wind may carry the vertex),
 *           y = part (grass: 1 on a seed head; flowers: 0 stem, 0.5 eye, 1 petal or down),
 *           z = a per-blade or per-plant id, w = 1 on the stalk that carries a seed head
 *   color   linear albedo (flowers only)
 */
import * as THREE from 'three/webgpu';

const TAU = Math.PI * 2;

/** Flower kinds and how the down shares them out. `patch` = drift frequency and threshold. */
export const VERDANT_HILLS_FLOWERS = Object.freeze([
    {
        id: 'buttercup', share: 0.44, patch: [0.035, 0.42], tall: 0.46,
    },
    {
        id: 'daisy', share: 0.26, patch: [0.05, 0.5], tall: 0.5,
    },
    {
        id: 'clover', share: 0.18, patch: [0.07, 0.44], tall: 0.26,
    },
    {
        id: 'clock', share: 0.12, patch: [0.09, 0.42], tall: 0.4,
    },
]);

/** Small deterministic generator, so a plant's shape does not depend on what was built before it. */
function plantRandom(seed) {
    let state = (seed * 2654435761) % 4294967296;
    return () => {
        state = (Math.imul(state ^ (state >>> 15), 2246822507) ^ Math.imul(state ^ (state >>> 13), 3266489909)) >>> 0;
        state = (state + 0x6d2b79f5) >>> 0;
        return (state >>> 8) / 16777216;
    };
}

/**
 * A clump of grass. Near clumps have curved blades and one seed head standing above them;
 * far clumps are a fan of broad single-bend blades.
 */
export function createVerdantHillsGrassGeometry({ far = false, seed = 1 } = {}) {
    const rng = plantRandom(seed + (far ? 500 : 0));
    const positions = [];
    const uvs = [];
    const paint = [];
    const indices = [];
    const blades = far ? 7 : 14;
    // A seed head is a thread of stalk with a spindle at its top: where along it, how wide, how ripe.
    const SPINDLE = [[0, 0.002, 0], [0.4, 0.0018, 0], [0.76, 0.0014, 0], [0.84, 0.0042, 1], [0.93, 0.0034, 1],
        [1, 0.0003, 1]];
    for (let blade = 0; blade < blades; blade += 1) {
        const head = !far && blade === blades - 1;
        const angle = rng() * TAU;
        const spread = rng() * (far ? 0.24 : 0.15);
        const lean = head ? 0.03 + rng() * 0.05 : 0.1 + rng() * 0.28;
        const height = head ? 0.6 + rng() * 0.12 : 0.3 + rng() * 0.34;
        const width = (far ? 0.02 : 0.0062) + rng() * (far ? 0.011 : 0.004);
        const id = rng();
        const across = [Math.cos(angle + 1.57), Math.sin(angle + 1.57)];
        const base = positions.length / 3;
        const steps = far ? 2 : 4;
        const rungs = head ? SPINDLE : Array.from({ length: steps + 1 }, (_, step) => {
            const t = step / steps;
            return [t, width * (1 - t ** 1.6 * 0.95), 0];
        });
        rungs.forEach(([t, half, mark], step) => {
            // A blade arches over under its own weight: out as the square, down a little at the tip.
            const out = spread + lean * t * t;
            const cx = Math.cos(angle) * out;
            const cz = Math.sin(angle) * out;
            const y = height * (t - (head ? 0 : 0.12 * lean * t * t * t));
            positions.push(cx - across[0] * half, y, cz - across[1] * half);
            positions.push(cx + across[0] * half, y, cz + across[1] * half);
            uvs.push(id, t, id, t);
            paint.push(y, mark, id, head ? 1 : 0, y, mark, id, head ? 1 : 0);
            if (step < rungs.length - 1) {
                const a = base + step * 2;
                indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            }
        });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('paint', new THREE.Float32BufferAttribute(paint, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.name = `VerdantHillsGrass${far ? ' far' : ''}`;
    return geometry;
}

class PlantBuilder {
    constructor(id) {
        this.id = id;
        this.position = [];
        this.color = [];
        this.paint = [];
        this.index = [];
    }

    vertex(x, y, z, colour, part) {
        this.position.push(x, y, z);
        this.color.push(colour.r, colour.g, colour.b);
        this.paint.push(Math.max(0, y), part, this.id, 0);
        return this.position.length / 3 - 1;
    }

    tri(a, b, c) {
        this.index.push(a, b, c);
    }

    /** A thin three-sided stalk from the root to `top`, bowed sideways by `bow`. */
    stalk(top, bow, radius, colour) {
        const rings = [];
        for (let step = 0; step <= 3; step += 1) {
            const t = step / 3;
            const x = top.x * t + bow.x * Math.sin(t * Math.PI);
            const z = top.z * t + bow.z * Math.sin(t * Math.PI);
            const r = radius * (1 - t * 0.45);
            rings.push([0, 1, 2].map((side) => this.vertex(
                x + Math.cos((side / 3) * TAU) * r,
                top.y * t,
                z + Math.sin((side / 3) * TAU) * r,
                colour,
                0,
            )));
        }
        for (let step = 0; step < 3; step += 1) {
            for (let side = 0; side < 3; side += 1) {
                const next = (side + 1) % 3;
                this.tri(rings[step][side], rings[step + 1][side], rings[step][next]);
                this.tri(rings[step][next], rings[step + 1][side], rings[step + 1][next]);
            }
        }
    }

    /** A fan of `count` kite-shaped petals around a head, tilted up by `cup` radians. */
    petals(centre, count, length, width, cup, base, tip, turn = 0) {
        for (let i = 0; i < count; i += 1) {
            const angle = turn + (i / count) * TAU;
            const out = [Math.cos(angle) * Math.cos(cup), Math.sin(cup), Math.sin(angle) * Math.cos(cup)];
            const side = [-Math.sin(angle), 0, Math.cos(angle)];
            const at = (along, across) => [
                centre.x + out[0] * along + side[0] * across,
                centre.y + out[1] * along,
                centre.z + out[2] * along + side[2] * across,
            ];
            const root = this.vertex(...at(length * 0.08, 0), base, 1);
            const left = this.vertex(...at(length * 0.62, -width), tip, 1);
            const right = this.vertex(...at(length * 0.62, width), tip, 1);
            const point = this.vertex(...at(length, 0), tip, 1);
            this.tri(root, right, left);
            this.tri(left, right, point);
        }
    }

    /** A small faceted dome for the eye of a flower or the head of a clover. */
    dome(centre, radius, height, low, high, sides = 6) {
        const top = this.vertex(centre.x, centre.y + height, centre.z, high, 0.5);
        const ring = Array.from({ length: sides }, (_, i) => this.vertex(
            centre.x + Math.cos((i / sides) * TAU) * radius,
            centre.y,
            centre.z + Math.sin((i / sides) * TAU) * radius,
            low,
            0.5,
        ));
        for (let i = 0; i < sides; i += 1) this.tri(top, ring[(i + 1) % sides], ring[i]);
    }

    geometry(name) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
        geometry.setAttribute('paint', new THREE.Float32BufferAttribute(this.paint, 4));
        geometry.setIndex(this.index);
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        geometry.name = name;
        return geometry;
    }
}

const tint = (hex) => new THREE.Color(hex);
const STEM = tint(0x4f8526);

const BUILDERS = {
    /** Three or four glossy yellow cups on a branching stem. */
    buttercup(b, rng) {
        const heads = 3 + Math.floor(rng() * 2);
        for (let i = 0; i < heads; i += 1) {
            const angle = rng() * TAU;
            const reach = 0.03 + rng() * 0.09;
            const top = new THREE.Vector3(Math.cos(angle) * reach, 0.3 + rng() * 0.2, Math.sin(angle) * reach);
            b.stalk(top, { x: Math.cos(angle) * 0.02, z: Math.sin(angle) * 0.02 }, 0.0028, STEM);
            b.petals(top, 5, 0.019, 0.0115, 0.75, tint(0xf2b705), tint(0xffe21f), rng() * TAU);
            b.dome(top, 0.006, 0.004, tint(0xb8a012), tint(0xe2c21a), 5);
        }
    },
    /** White rays around a golden eye, one or two to a plant. */
    daisy(b, rng) {
        const heads = 1 + Math.floor(rng() * 2);
        for (let i = 0; i < heads; i += 1) {
            const angle = rng() * TAU;
            const reach = 0.02 + rng() * 0.07;
            const top = new THREE.Vector3(Math.cos(angle) * reach, 0.34 + rng() * 0.2, Math.sin(angle) * reach);
            b.stalk(top, { x: Math.cos(angle) * 0.015, z: Math.sin(angle) * 0.015 }, 0.003, STEM);
            b.petals(top, 13, 0.034, 0.0075, 0.14, tint(0xf3f1e2), tint(0xffffff), rng() * TAU);
            b.dome(top, 0.011, 0.007, tint(0xd99a0c), tint(0xffcf2a));
        }
    },
    /** Rose-purple globes close to the ground. */
    clover(b, rng) {
        const heads = 2 + Math.floor(rng() * 2);
        for (let i = 0; i < heads; i += 1) {
            const angle = rng() * TAU;
            const reach = 0.03 + rng() * 0.08;
            const top = new THREE.Vector3(Math.cos(angle) * reach, 0.16 + rng() * 0.12, Math.sin(angle) * reach);
            b.stalk(top, { x: 0, z: 0 }, 0.003, STEM);
            b.dome(top, 0.016, 0.02, tint(0xb04a86), tint(0xf09ac6), 7);
            b.petals(top, 7, 0.018, 0.009, -0.5, tint(0x9a3f78), tint(0xd874ac), rng() * TAU);
        }
    },
    /** A dandelion clock: a ball of down on a bare hollow stalk. */
    clock(b, rng) {
        const top = new THREE.Vector3((rng() - 0.5) * 0.05, 0.3 + rng() * 0.16, (rng() - 0.5) * 0.05);
        b.stalk(top, { x: 0.012, z: 0 }, 0.0034, tint(0x86a25a));
        const down = tint(0xf4f2ea);
        const core = tint(0xc9c2a6);
        // Down as spokes: slivers from the heart to the surface of a ball, facing all ways.
        for (let i = 0; i < 26; i += 1) {
            const lift = Math.acos(1 - 2 * ((i + 0.5) / 26));
            const turn = i * 2.39996;
            const out = [Math.sin(lift) * Math.cos(turn), Math.cos(lift), Math.sin(lift) * Math.sin(turn)];
            const side = [-out[2], 0, out[0]];
            const norm = Math.hypot(side[0], side[2]) || 1;
            const radius = 0.032;
            const half = 0.0075;
            const heart = b.vertex(top.x + out[0] * 0.004, top.y + out[1] * 0.004, top.z + out[2] * 0.004, core, 1);
            const left = b.vertex(
                top.x + out[0] * radius - (side[0] / norm) * half,
                top.y + out[1] * radius,
                top.z + out[2] * radius - (side[2] / norm) * half,
                down,
                1,
            );
            const right = b.vertex(
                top.x + out[0] * radius + (side[0] / norm) * half,
                top.y + out[1] * radius,
                top.z + out[2] * radius + (side[2] / norm) * half,
                down,
                1,
            );
            b.tri(heart, right, left);
        }
    },
};

/** Geometry for one flower kind; `variant` picks one of the shapes a kind comes in. */
export function createVerdantHillsFlowerGeometry(id, { variant = 0 } = {}) {
    const index = VERDANT_HILLS_FLOWERS.findIndex((flower) => flower.id === id);
    if (index < 0) throw new Error(`[Verdant Hills] Unknown flower "${id}".`);
    const builder = new PlantBuilder(index / VERDANT_HILLS_FLOWERS.length);
    BUILDERS[id](builder, plantRandom(211 + index * 37 + variant * 7));
    return builder.geometry(`VerdantHillsFlower ${id} ${variant}`);
}
