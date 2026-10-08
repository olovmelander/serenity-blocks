/**
 * Summer — the flowers of the meadow, as geometry.
 *
 * On Midsummer's Eve you pick seven kinds of flowers. Each of the seven tetrominoes has
 * one: poppy (I), harebell (O), buttercup (T), oxeye daisy (S), lupine (Z), orange
 * hawkweed (J) and wood cranesbill (L). Red clover, cow parsley and dandelion clocks fill
 * the meadow around them. Every plant is real geometry, built here from a seed: petals are
 * kites and fans, not alpha cards, so they stay sharp against a low sun and need no
 * blending.
 *
 * Vertex data the meadow's shader reads:
 *   color   linear albedo
 *   paint   x = height above the root in metres (how far the wind may carry the vertex),
 *           y = part (0 stem and leaf, 0.5 the eye of a flower, 0.75 down, 1 petal),
 *           z = position along the part (0 base, 1 tip), w = spare
 *   head    xyz = offset from the middle of the vertex's flower head (zero on stems), so a
 *           head can swell when a gust from the board passes; w = the plant's flower kind
 */
import * as THREE from 'three/webgpu';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

/** Flower kinds, in the order of their excitement slots (see SummerLight.speciesGlow). */
export const SUMMER_FLOWERS = Object.freeze([
    {
        id: 'harebell', slot: 0, piece: 'O', petal: 0x7fa6f5, share: 0.12, patch: [0.045, 0.34], crest: 0.6, tall: 0.45,
    },
    {
        id: 'buttercup', slot: 1, piece: 'T', petal: 0xffd21f, share: 0.22, patch: [0.03, 0.3], crest: 0.4, tall: 0.58,
    },
    {
        id: 'cranesbill', slot: 2, piece: 'L', petal: 0xb267e0, share: 0.11, patch: [0.05, 0.42], crest: 0.7, tall: 0.5,
    },
    {
        id: 'daisy', slot: 3, piece: 'S', petal: 0xfffdf2, share: 0.15, patch: [0.036, 0.26], crest: 1, tall: 0.62,
    },
    {
        id: 'poppy', slot: 4, piece: 'I', petal: 0xe4412c, share: 0.07, patch: [0.06, 0.5], crest: 1.2, tall: 0.68,
    },
    {
        id: 'lupine', slot: 5, piece: 'Z', petal: 0x5d5fd6, share: 0.07, patch: [0.04, 0.52], crest: 1.6, tall: 1,
    },
    {
        id: 'hawkweed', slot: 6, piece: 'J', petal: 0xff8a2e, share: 0.08, patch: [0.07, 0.44], crest: 0.3, tall: 0.4,
    },
    {
        id: 'clover', slot: 7, piece: null, petal: 0xe06aa2, share: 0.1, patch: [0.05, 0.38], crest: 0.2, tall: 0.3,
    },
    {
        id: 'parsley', slot: 7, piece: null, petal: 0xfffef4, share: 0.05, patch: [0.03, 0.5], crest: 1.8, tall: 1.2,
    },
    {
        id: 'clock', slot: 7, piece: null, petal: 0xeeeadf, share: 0.02, patch: [0.08, 0.5], crest: 0.4, tall: 0.34,
    },
]);

/** Flower kind for a tetromino letter, or -1. */
export function summerFlowerSlotForPiece(piece) {
    // The company flowers carry `piece: null`: only a letter may match.
    if (typeof piece !== 'string') return -1;
    const kind = SUMMER_FLOWERS.find((flower) => flower.piece === piece);
    return kind ? kind.slot : -1;
}

const tint = (hex) => new THREE.Color(hex);
const STEM = tint(0x4f7d27);
const STEM_PALE = tint(0x86a046);
const LEAF = tint(0x4f8a2a);
const LEAF_DARK = tint(0x3d7424);

class PlantBuilder {
    constructor(slot) {
        this.slot = slot;
        this.position = [];
        this.color = [];
        this.paint = [];
        this.head = [];
        this.index = [];
    }

    vertex(point, colour, part = 0, along = 0, centre = null) {
        const index = this.position.length / 3;
        this.position.push(point.x, point.y, point.z);
        this.color.push(colour.r, colour.g, colour.b);
        this.paint.push(Math.max(0, point.y), part, along, 0);
        if (centre) this.head.push(point.x - centre.x, point.y - centre.y, point.z - centre.z, this.slot);
        else this.head.push(0, 0, 0, this.slot);
        return index;
    }

    tri(a, b, c) {
        this.index.push(a, b, c);
    }

    geometry(name) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
        geometry.setAttribute('paint', new THREE.Float32BufferAttribute(this.paint, 4));
        geometry.setAttribute('head', new THREE.Float32BufferAttribute(this.head, 4));
        geometry.setIndex(this.index);
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        geometry.name = name;
        return geometry;
    }
}

/** Two unit vectors perpendicular to `axis` and to each other. */
function frame(axis) {
    const u = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) < 0.95 ? UP : new THREE.Vector3(1, 0, 0))
        .normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    return { u, v };
}

const at = (origin, ...terms) => {
    const point = origin.clone();
    for (let i = 0; i < terms.length; i += 2) point.addScaledVector(terms[i], terms[i + 1]);
    return point;
};

/** A stalk through `points`, three-sided and tapering. */
function stalk(b, points, r0, r1, c0 = STEM, c1 = STEM_PALE) {
    let previous = null;
    points.forEach((point, step) => {
        const t = step / (points.length - 1);
        const next = points[Math.min(points.length - 1, step + 1)];
        const before = points[Math.max(0, step - 1)];
        const { u, v } = frame(next.clone().sub(before).normalize());
        const radius = r0 + (r1 - r0) * t;
        const colour = c0.clone().lerp(c1, t);
        const ring = [0, 1, 2].map((side) => {
            const angle = (side / 3) * TAU;
            return b.vertex(at(point, u, Math.cos(angle) * radius, v, Math.sin(angle) * radius), colour, 0, t);
        });
        if (previous) {
            for (let side = 0; side < 3; side += 1) {
                const n = (side + 1) % 3;
                b.tri(previous[side], previous[n], ring[side]);
                b.tri(previous[n], ring[n], ring[side]);
            }
        }
        previous = ring;
    });
}

/** A stalk for the distance: one thin quad. */
function wisp(b, from, to, width, colour = STEM) {
    const side = new THREE.Vector3(width * 0.5, 0, 0);
    const a = b.vertex(from.clone().sub(side), colour, 0, 0);
    const c = b.vertex(from.clone().add(side), colour, 0, 0);
    const d = b.vertex(to.clone().sub(side.clone().multiplyScalar(0.6)), colour, 0, 1);
    const e = b.vertex(to.clone().add(side.clone().multiplyScalar(0.6)), colour, 0, 1);
    b.tri(a, c, d);
    b.tri(c, e, d);
}

/** A curved path from `from` to `to`, bowed sideways by `bow`. */
function curve(from, to, bow, steps = 3) {
    const points = [];
    const { u } = frame(to.clone().sub(from).normalize());
    for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        points.push(from.clone().lerp(to, t).addScaledVector(u, Math.sin(t * Math.PI) * bow));
    }
    return points;
}

/** A leaf: a folded kite from `base` along `direction`. */
function leaf(b, base, direction, length, width, colour = LEAF, tip = null) {
    const { u, v } = frame(direction);
    const fold = v.y > 0 ? v : v.clone().negate();
    const a = b.vertex(base, colour, 0, 0);
    const left = b.vertex(at(base, direction, length * 0.5, u, width * 0.5, fold, width * 0.22), colour, 0, 0.5);
    const right = b.vertex(at(base, direction, length * 0.5, u, -width * 0.5, fold, width * 0.22), colour, 0, 0.5);
    const end = b.vertex(at(base, direction, length, fold, -length * 0.12), tip || colour, 0, 1);
    b.tri(a, right, left);
    b.tri(left, right, end);
}

/** A petal: a kite leaving a flower's `centre` along `out`, lifted along the flower's `axis`. */
function petal(b, centre, out, axis, {
    start = 0.01, length = 0.03, width = 0.016, lift = 0, base, tip, part = 1,
}) {
    const across = new THREE.Vector3().crossVectors(axis, out).normalize();
    const a = b.vertex(at(centre, out, start), base, part, 0, centre);
    const l = b.vertex(at(centre, out, start + length * 0.55, across, width * 0.5, axis, lift * 0.5), base.clone()
        .lerp(tip, 0.55), part, 0.55, centre);
    const r = b.vertex(at(centre, out, start + length * 0.55, across, -width * 0.5, axis, lift * 0.5), base.clone()
        .lerp(tip, 0.55), part, 0.55, centre);
    const end = b.vertex(at(centre, out, start + length, axis, lift), tip, part, 1, centre);
    b.tri(a, r, l);
    b.tri(l, r, end);
}

/** The eye of a flower: a low cone of `sides` faces. */
function eye(b, centre, axis, radius, height, rim, top, sides = 6, part = 0.5) {
    const { u, v } = frame(axis);
    const apex = b.vertex(at(centre, axis, height), top, part, 1, centre);
    const ring = [];
    for (let i = 0; i < sides; i += 1) {
        const angle = (i / sides) * TAU;
        ring.push(b.vertex(at(centre, u, Math.cos(angle) * radius, v, Math.sin(angle) * radius), rim, part, 0, centre));
    }
    for (let i = 0; i < sides; i += 1) b.tri(apex, ring[i], ring[(i + 1) % sides]);
}

/** A flower seen from far off: a shallow fan, its rim the colour of the petals. */
function rosette(b, centre, axis, radius, rim, heart, sides = 6, lift = 0.2) {
    const { u, v } = frame(axis);
    const middle = b.vertex(at(centre, axis, -radius * lift), heart, 0.5, 0, centre);
    const ring = [];
    for (let i = 0; i < sides; i += 1) {
        const angle = (i / sides) * TAU;
        ring.push(b.vertex(at(centre, u, Math.cos(angle) * radius, v, Math.sin(angle) * radius), rim, 1, 1, centre));
    }
    for (let i = 0; i < sides; i += 1) b.tri(middle, ring[i], ring[(i + 1) % sides]);
}

const tilted = (rng, amount) => new THREE.Vector3((rng() - 0.5) * amount, 1, (rng() - 0.5) * amount + amount * 0.3)
    .normalize();
const outward = (axis, angle) => {
    const { u, v } = frame(axis);
    return u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(v, Math.sin(angle));
};

// -- the seven, and their company --------------------------------------------------------

function daisyHead(b, rng, centre, axis, size = 1) {
    const white = tint(0xfffdf2);
    const shade = tint(0xe9e6d2);
    eye(b, centre, axis, 0.017 * size, 0.009 * size, tint(0xe8a818), tint(0xf7cf3a), 7);
    const rays = 15;
    for (let i = 0; i < rays; i += 1) {
        petal(b, centre, outward(axis, (i / rays) * TAU + rng() * 0.12), axis, {
            start: 0.012 * size,
            length: (0.03 + rng() * 0.006) * size,
            width: 0.0125 * size,
            lift: (-0.004 + rng() * 0.006) * size,
            base: shade,
            tip: white,
        });
    }
}

function daisy(rng, far) {
    const b = new PlantBuilder(3);
    const heads = far ? 1 : 1 + Math.floor(rng() * 2);
    for (let h = 0; h < heads; h += 1) {
        const height = 0.5 + rng() * 0.2 - h * 0.12;
        const top = new THREE.Vector3((rng() - 0.5) * 0.14 + h * 0.07, height, (rng() - 0.5) * 0.14);
        const axis = tilted(rng, 0.7);
        if (far) {
            wisp(b, new THREE.Vector3(), top, 0.012);
            rosette(b, top, axis, 0.045, tint(0xfffdf2), tint(0xf0b820), 6, 0.1);
        } else {
            stalk(b, curve(new THREE.Vector3(h * 0.02, 0, 0), top, 0.03 * (rng() - 0.5) * 2), 0.0055, 0.0035);
            for (let l = 0; l < 2; l += 1) {
                const t = 0.2 + l * 0.25;
                leaf(b, new THREE.Vector3(top.x * t, height * t, top.z * t), outward(UP, rng() * TAU)
                    .add(new THREE.Vector3(0, 0.5, 0)).normalize(), 0.07, 0.018, LEAF);
            }
            daisyHead(b, rng, top, axis, 1);
        }
    }
    return b;
}

function buttercup(rng, far) {
    const b = new PlantBuilder(1);
    const height = 0.46 + rng() * 0.2;
    const fork = new THREE.Vector3((rng() - 0.5) * 0.05, height * 0.6, (rng() - 0.5) * 0.05);
    const gold = tint(0xffc814);
    const bright = tint(0xffe24e);
    if (!far) stalk(b, curve(new THREE.Vector3(), fork, 0.015), 0.0045, 0.003);
    else wisp(b, new THREE.Vector3(), fork, 0.01);
    const heads = far ? 2 : 3;
    for (let h = 0; h < heads; h += 1) {
        const angle = (h / heads) * TAU + rng();
        const top = new THREE.Vector3(
            fork.x + Math.cos(angle) * (0.05 + rng() * 0.05),
            height - h * 0.06,
            fork.z + Math.sin(angle) * (0.05 + rng() * 0.05),
        );
        const axis = tilted(rng, 0.5);
        if (far) {
            wisp(b, fork, top, 0.008);
            rosette(b, top, axis, 0.026, bright, gold, 5, -0.25);
        } else {
            stalk(b, curve(fork, top, 0.012, 2), 0.003, 0.002);
            eye(b, top, axis, 0.006, 0.004, tint(0xc99212), tint(0xe6b422), 5);
            for (let i = 0; i < 5; i += 1) {
                petal(b, top, outward(axis, (i / 5) * TAU + h), axis, {
                    start: 0.004, length: 0.021, width: 0.023, lift: 0.011, base: gold, tip: bright,
                });
            }
        }
    }
    if (!far) {
        for (let l = 0; l < 3; l += 1) {
            leaf(b, new THREE.Vector3(0, 0.06 + l * 0.07, 0), outward(UP, l * 2.1 + rng())
                .add(new THREE.Vector3(0, 0.4, 0)).normalize(), 0.06, 0.026, LEAF);
        }
    }
    return b;
}

function harebell(rng, far) {
    const b = new PlantBuilder(0);
    const height = 0.36 + rng() * 0.16;
    const lean = outward(UP, rng() * TAU);
    const top = at(new THREE.Vector3(0, height, 0), lean, 0.09);
    const deep = tint(0x5f84ea);
    const pale = tint(0xa6c0ff);
    const stem = [new THREE.Vector3(), new THREE.Vector3(0, height * 0.55, 0),
        at(new THREE.Vector3(0, height * 0.9, 0), lean, 0.03), top];
    if (far) wisp(b, stem[0], stem[2], 0.009, STEM_PALE);
    else stalk(b, stem, 0.0032, 0.0018, STEM, STEM_PALE);
    const bells = far ? 2 : 3;
    for (let n = 0; n < bells; n += 1) {
        const hang = at(stem[2], lean, 0.03 + n * 0.035, UP, 0.03 - n * 0.035);
        const axis = new THREE.Vector3(lean.x * 0.45, -1, lean.z * 0.45).normalize();
        const { u, v } = frame(axis);
        const middle = at(hang, axis, 0.016);
        if (far) {
            rosette(b, at(hang, axis, 0.03), axis.clone().negate(), 0.02, pale, deep, 5, 1.4);
        } else {
            const neck = [];
            const mouth = [];
            for (let i = 0; i < 5; i += 1) {
                const angle = (i / 5) * TAU;
                const around = u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(v, Math.sin(angle));
                neck.push(b.vertex(at(hang, around, 0.006), deep, 1, 0, middle));
                const lip = deep.clone().lerp(pale, 0.4);
                mouth.push(b.vertex(at(hang, around, 0.017, axis, 0.027), lip, 1, 0.7, middle));
            }
            for (let i = 0; i < 5; i += 1) {
                const n2 = (i + 1) % 5;
                b.tri(neck[i], mouth[i], neck[n2]);
                b.tri(neck[n2], mouth[i], mouth[n2]);
                const angle = ((i + 0.5) / 5) * TAU;
                const around = u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(v, Math.sin(angle));
                const lobe = b.vertex(at(hang, around, 0.026, axis, 0.037), pale, 1, 1, middle);
                b.tri(mouth[i], lobe, mouth[n2]);
            }
        }
    }
    return b;
}

function cranesbill(rng, far) {
    const b = new PlantBuilder(2);
    const height = 0.44 + rng() * 0.18;
    const fork = new THREE.Vector3((rng() - 0.5) * 0.06, height * 0.55, (rng() - 0.5) * 0.06);
    const violet = tint(0xa85ee0);
    const pale = tint(0xe9d8fa);
    if (far) wisp(b, new THREE.Vector3(), fork, 0.011);
    else stalk(b, curve(new THREE.Vector3(), fork, 0.02), 0.005, 0.0035);
    const heads = far ? 2 : 3;
    for (let h = 0; h < heads; h += 1) {
        const angle = (h / heads) * TAU + rng() * 2;
        const top = new THREE.Vector3(
            fork.x + Math.cos(angle) * 0.07,
            height - h * 0.05,
            fork.z + Math.sin(angle) * 0.07,
        );
        const axis = tilted(rng, 0.8);
        if (far) {
            wisp(b, fork, top, 0.008);
            rosette(b, top, axis, 0.03, violet, pale, 5, 0.05);
        } else {
            stalk(b, curve(fork, top, 0.015, 2), 0.003, 0.002);
            eye(b, top, axis, 0.005, 0.005, tint(0xf3ecc8), tint(0xcdb36a), 5);
            for (let i = 0; i < 5; i += 1) {
                petal(b, top, outward(axis, (i / 5) * TAU + h * 0.7), axis, {
                    start: 0.004, length: 0.026, width: 0.025, lift: 0.004, base: pale, tip: violet,
                });
            }
        }
    }
    if (!far) {
        // Palmate leaves on long stalks.
        for (let l = 0; l < 2; l += 1) {
            const out = outward(UP, l * 2.6 + rng() * 2);
            const hub = at(new THREE.Vector3(0, 0.16 + l * 0.08, 0), out, 0.09);
            for (let f = 0; f < 5; f += 1) {
                const fan = outward(UP, Math.atan2(out.z, out.x) + (f - 2) * 0.55);
                leaf(b, hub, fan.add(new THREE.Vector3(0, 0.15, 0)).normalize(), 0.075, 0.03, LEAF);
            }
        }
    }
    return b;
}

function poppy(rng, far) {
    const b = new PlantBuilder(4);
    const height = 0.56 + rng() * 0.2;
    const top = new THREE.Vector3((rng() - 0.5) * 0.16, height, (rng() - 0.5) * 0.16);
    const axis = tilted(rng, 0.9);
    const scarlet = tint(0xe23a26);
    const flame = tint(0xf4603c);
    const heart = tint(0x57110c);
    if (far) {
        wisp(b, new THREE.Vector3(), top, 0.011, STEM_PALE);
        rosette(b, top, axis, 0.05, flame, heart, 6, -0.3);
        return b;
    }
    stalk(b, curve(new THREE.Vector3(), top, 0.04 * (rng() - 0.5) * 2), 0.0048, 0.0032, STEM, STEM_PALE);
    eye(b, top, axis, 0.011, 0.012, tint(0x1c1a14), tint(0x687a2e), 6);
    for (let i = 0; i < 4; i += 1) {
        // Each petal is a broad crinkled fan cupped into a bowl.
        const out = outward(axis, (i / 4) * TAU + 0.3);
        const across = new THREE.Vector3().crossVectors(axis, out).normalize();
        const base = b.vertex(at(top, out, 0.006), heart, 1, 0, top);
        const rim = [-1, -0.45, 0.45, 1].map((s, k) => b.vertex(
            at(top, out, 0.04 + (Math.abs(s) < 0.5 ? 0.012 : 0)
            + rng() * 0.005, across, s * 0.034, axis, 0.018 + (k % 2) * 0.006),
            Math.abs(s) < 0.5 ? flame : scarlet,
            1,
            1,
            top,
        ));
        for (let k = 0; k < 3; k += 1) b.tri(base, rim[k], rim[k + 1]);
    }
    // A nodding bud on its own crook of stem.
    const crook = at(new THREE.Vector3(0, height * 0.72, 0), outward(UP, rng() * TAU), 0.07);
    stalk(b, [new THREE.Vector3(0, height * 0.3, 0), at(crook, UP, 0.05), crook], 0.003, 0.002, STEM, STEM_PALE);
    eye(b, crook, new THREE.Vector3(0, -1, 0), 0.008, 0.022, STEM_PALE, STEM, 5, 0);
    for (let l = 0; l < 2; l += 1) {
        leaf(b, new THREE.Vector3(0, 0.1 + l * 0.12, 0), outward(UP, l * 2.4 + rng()).add(new THREE.Vector3(0, 0.5, 0))
            .normalize(), 0.11, 0.035, LEAF_DARK);
    }
    return b;
}

function lupine(rng, far) {
    const b = new PlantBuilder(5);
    const height = 0.84 + rng() * 0.24;
    const sway = (rng() - 0.5) * 0.08;
    const foot = height * 0.52;
    const deep = tint(0x5a55c4);
    const mid = tint(0x8572dc);
    const bud = tint(0xb9b4ea);
    const spine = (y) => new THREE.Vector3(sway * (y / height) ** 2, y, 0);
    if (far) {
        wisp(b, new THREE.Vector3(), spine(foot), 0.014);
        const levels = [[foot, 0.034, deep], [foot + (height - foot) * 0.5, 0.026, mid], [height, 0.004, bud]];
        let previous = null;
        levels.forEach(([y, radius, colour], level) => {
            const centre = spine(foot + (height - foot) * 0.5);
            const ring = [0, 1, 2].map((s) => b.vertex(
                at(spine(y), outward(UP, (s / 3) * TAU + 0.4), radius),
                colour,
                1,
                level / 2,
                centre,
            ));
            if (previous) {
                for (let s = 0; s < 3; s += 1) {
                    const n = (s + 1) % 3;
                    b.tri(previous[s], previous[n], ring[s]);
                    b.tri(previous[n], ring[n], ring[s]);
                }
            }
            previous = ring;
        });
        return b;
    }
    stalk(b, [spine(0), spine(foot * 0.5), spine(foot), spine(height)], 0.0075, 0.002);
    const whorls = 13;
    for (let w = 0; w < whorls; w += 1) {
        const t = w / (whorls - 1);
        const y = foot + (height - foot) * (t ** 0.9) * 0.97;
        const reach = 0.036 * (1 - t) ** 0.7 + 0.006;
        const colour = t < 0.6 ? deep.clone().lerp(mid, t / 0.6) : mid.clone().lerp(bud, (t - 0.6) / 0.4);
        const centre = spine(y);
        for (let f = 0; f < 5; f += 1) {
            petal(b, centre, outward(UP, (f / 5) * TAU + w * 0.7), UP, {
                start: 0.004,
                length: reach,
                width: 0.02 * (1 - t * 0.6),
                lift: 0.014 + t * 0.012,
                base: colour,
                tip: colour.clone().lerp(bud, 0.35),
            });
        }
    }
    // Palmate leaves: a wheel of leaflets on each stalk.
    for (let l = 0; l < 3; l += 1) {
        const out = outward(UP, l * 2.2 + rng() * 2);
        const hub = at(spine(0.2 + l * 0.1), out, 0.11, UP, 0.04);
        stalk(b, [spine(0.14 + l * 0.08), hub], 0.003, 0.002);
        for (let f = 0; f < 7; f += 1) {
            leaf(b, hub, outward(UP, (f / 7) * TAU).add(new THREE.Vector3(0, 0.25, 0)).normalize(), 0.07, 0.017, LEAF);
        }
    }
    return b;
}

function hawkweed(rng, far) {
    const b = new PlantBuilder(6);
    const ember = tint(0xf2601c);
    const amber = tint(0xffb22a);
    const heads = far ? 1 : 2;
    for (let h = 0; h < heads; h += 1) {
        const height = 0.3 + rng() * 0.14;
        const top = new THREE.Vector3((rng() - 0.5) * 0.12 + h * 0.05, height, (rng() - 0.5) * 0.12);
        const axis = tilted(rng, 0.6);
        if (far) {
            wisp(b, new THREE.Vector3(), top, 0.009, STEM_PALE);
            rosette(b, top, axis, 0.03, ember, amber, 6, 0.05);
        } else {
            stalk(b, curve(new THREE.Vector3(h * 0.02, 0, 0), top, 0.02), 0.0036, 0.0026, STEM, STEM_PALE);
            eye(b, top, axis, 0.008, 0.004, amber, tint(0xffd24a), 6);
            for (let i = 0; i < 14; i += 1) {
                petal(b, top, outward(axis, (i / 14) * TAU), axis, {
                    start: 0.006, length: 0.02 + (i % 2) * 0.004, width: 0.009, lift: 0.002, base: amber, tip: ember,
                });
            }
        }
    }
    if (!far) {
        for (let l = 0; l < 4; l += 1) {
            leaf(b, new THREE.Vector3(0, 0.012, 0), outward(UP, l * 1.6 + rng()).add(new THREE.Vector3(0, 0.12, 0))
                .normalize(), 0.09, 0.03, LEAF_DARK);
        }
    }
    return b;
}

function clover(rng, far) {
    const b = new PlantBuilder(7);
    const rose = tint(0xd9558f);
    const blush = tint(0xf4b2d0);
    const heads = far ? 1 : 2;
    for (let h = 0; h < heads; h += 1) {
        const height = 0.22 + rng() * 0.12;
        const top = new THREE.Vector3((rng() - 0.5) * 0.1 + h * 0.06, height, (rng() - 0.5) * 0.1);
        if (far) {
            wisp(b, new THREE.Vector3(), top, 0.01);
            rosette(b, at(top, UP, 0.012), UP, 0.022, rose, blush, 5, -0.9);
        } else {
            stalk(b, curve(new THREE.Vector3(h * 0.02, 0, 0), top, 0.015, 2), 0.004, 0.003);
            eye(b, at(top, UP, 0.012), UP, 0.017, 0.02, rose, blush, 6, 1);
            eye(b, at(top, UP, 0.012), new THREE.Vector3(0, -1, 0), 0.017, 0.012, rose, tint(0xa83a70), 6, 1);
            for (let l = 0; l < 3; l += 1) {
                leaf(
                    b,
                    at(top, UP, -0.05),
                    outward(UP, (l / 3) * TAU + h).add(new THREE.Vector3(0, 0.2, 0)).normalize(),
                    0.05,
                    0.034,
                    LEAF,
                    tint(0x7fb04a),
                );
            }
        }
    }
    return b;
}

function parsley(rng, far) {
    const b = new PlantBuilder(7);
    const height = 0.95 + rng() * 0.32;
    const lace = tint(0xfffef4);
    const cream = tint(0xe6ebc4);
    const crown = new THREE.Vector3((rng() - 0.5) * 0.1, height * 0.8, (rng() - 0.5) * 0.1);
    if (far) wisp(b, new THREE.Vector3(), crown, 0.014, STEM_PALE);
    else stalk(b, curve(new THREE.Vector3(), crown, 0.03), 0.0065, 0.004, STEM, STEM_PALE);
    const umbels = far ? 3 : 5;
    for (let n = 0; n < umbels; n += 1) {
        const out = outward(UP, (n / umbels) * TAU + rng());
        const top = at(crown, out, 0.07 + rng() * 0.06, UP, height * 0.2 - rng() * 0.05);
        const axis = out.clone().multiplyScalar(0.3).add(UP).normalize();
        if (far) {
            wisp(b, crown, top, 0.007, STEM_PALE);
            rosette(b, top, axis, 0.05, lace, cream, 6, 0.15);
        } else {
            stalk(b, [crown, top], 0.0026, 0.0018, STEM_PALE, STEM_PALE);
            // An umbel is a low dome of florets, each a tiny rosette of its own.
            for (let f = 0; f < 7; f += 1) {
                const spoke = f === 0 ? new THREE.Vector3() : outward(axis, (f / 6) * TAU).multiplyScalar(0.034);
                const floret = at(top, spoke, 1, axis, f === 0 ? 0.008 : 0);
                const { u, v } = frame(axis);
                const a = b.vertex(at(floret, u, 0.014), lace, 1, 1, top);
                const c = b.vertex(at(floret, u, -0.007, v, 0.012), lace, 1, 1, top);
                const d = b.vertex(at(floret, u, -0.007, v, -0.012), cream, 1, 0.4, top);
                b.tri(a, c, d);
            }
        }
    }
    if (!far) {
        for (let l = 0; l < 3; l += 1) {
            const out = outward(UP, l * 2.3 + rng() * 2);
            const hub = at(new THREE.Vector3(0, 0.22 + l * 0.16, 0), out, 0.05);
            for (let f = -1; f <= 1; f += 1) {
                leaf(
                    b,
                    hub,
                    outward(UP, Math.atan2(out.z, out.x) + f * 0.6).add(new THREE.Vector3(0, 0.3, 0)).normalize(),
                    0.13,
                    0.04,
                    LEAF,
                );
            }
        }
    }
    return b;
}

function clock(rng, far) {
    const b = new PlantBuilder(7);
    const height = 0.3 + rng() * 0.1;
    const top = new THREE.Vector3((rng() - 0.5) * 0.06, height, (rng() - 0.5) * 0.06);
    const down = tint(0xf2efe6);
    if (far) wisp(b, new THREE.Vector3(), top, 0.009, STEM_PALE);
    else stalk(b, curve(new THREE.Vector3(), top, 0.012, 2), 0.0034, 0.0028, STEM_PALE, STEM_PALE);
    // A ball of seed down: two cones base to base.
    const radius = far ? 0.03 : 0.034;
    eye(b, top, UP, radius, radius, down, down, far ? 5 : 8, 0.75);
    eye(b, top, new THREE.Vector3(0, -1, 0), radius, radius * 0.8, down, tint(0xcfd0bc), far ? 5 : 8, 0.75);
    return b;
}

/**
 * A water lily: a notched pad lying on the lake and, when `flowering`, a white cup of petals
 * beside it. Planted with the meadow's flower shader, which treats height as how far the
 * wind may carry a vertex, so every vertex is given the same small height and the whole
 * plant rocks as one.
 */
export function createSummerLilyGeometry({ flowering = false } = {}) {
    const b = new PlantBuilder(7);
    const pad = tint(0x2c661a);
    const rim = tint(0x4a8a26);
    const middle = b.vertex(new THREE.Vector3(0, 0, 0), pad, 0, 0);
    const ring = [];
    const sides = 11;
    for (let i = 0; i <= sides; i += 1) {
        // A lily pad is a disc with one slit to its middle.
        const angle = 0.22 + (i / sides) * (TAU - 0.44);
        const reach = 0.24 + 0.02 * Math.sin(i * 2.3);
        ring.push(b.vertex(new THREE.Vector3(Math.cos(angle) * reach, 0.004, Math.sin(angle) * reach), rim, 0, 1));
    }
    for (let i = 0; i < sides; i += 1) b.tri(middle, ring[i + 1], ring[i]);
    if (flowering) {
        const centre = new THREE.Vector3(0.19, 0.03, 0.16);
        const white = tint(0xfffdf6);
        const blush = tint(0xf6dde4);
        eye(b, centre, UP, 0.022, 0.02, tint(0xe8a818), tint(0xf7cf3a), 6);
        for (let i = 0; i < 9; i += 1) {
            petal(b, centre, outward(UP, (i / 9) * TAU), UP, {
                start: 0.012, length: 0.085, width: 0.04, lift: 0.022, base: blush, tip: white,
            });
        }
        for (let i = 0; i < 6; i += 1) {
            petal(b, centre, outward(UP, (i / 6) * TAU + 0.4), UP, {
                start: 0.01, length: 0.058, width: 0.034, lift: 0.05, base: white, tip: white,
            });
        }
    }
    for (let i = 0; i < b.paint.length; i += 4) b.paint[i] = 0.3;
    return b.geometry(`SummerLily${flowering ? ' in flower' : ''}`);
}

const BUILDERS = {
    harebell, buttercup, cranesbill, daisy, poppy, lupine, hawkweed, clover, parsley, clock,
};

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
 * Geometry for one flower kind. `far` asks for the handful-of-triangles version drawn
 * beyond the crest; `variant` picks one of the shapes a kind comes in.
 */
export function createSummerFlowerGeometry(id, { far = false, variant = 0 } = {}) {
    const build = Object.prototype.hasOwnProperty.call(BUILDERS, id) ? BUILDERS[id] : null;
    if (!build) throw new Error(`[Summer] Unknown flower "${id}".`);
    const index = SUMMER_FLOWERS.findIndex((flower) => flower.id === id);
    const rng = plantRandom(101 + index * 37 + variant * 7 + (far ? 1000 : 0));
    return build(rng, far).geometry(`SummerFlower ${id}${far ? ' far' : ''} ${variant}`);
}

/**
 * A clump of grass. Near clumps have curved blades and a few seed heads standing above
 * them; far clumps are a fan of single-piece blades. uv.x is a per-blade id, uv.y runs
 * from root to tip; paint.x is height in metres, paint.y marks a seed head and paint.w the
 * stalk that carries it.
 */
export function createSummerGrassGeometry({ far = false, seed = 1 } = {}) {
    const rng = plantRandom(seed + (far ? 500 : 0));
    const positions = [];
    const uvs = [];
    const paint = [];
    const indices = [];
    const blades = far ? 6 : 12;
    // A seed head is a thread of stalk with a spindle at its top: where along it, how wide, how ripe.
    const SPINDLE = [[0, 0.0022, 0], [0.4, 0.002, 0], [0.74, 0.0016, 0], [0.82, 0.0062, 1], [0.92, 0.005, 1],
        [1, 0.0004, 1]];
    for (let blade = 0; blade < blades; blade += 1) {
        const head = !far && blade === blades - 1;
        const angle = rng() * TAU;
        const spread = rng() * (far ? 0.2 : 0.13);
        const lean = head ? 0.03 + rng() * 0.05 : 0.07 + rng() * 0.22;
        const height = head ? 0.52 + rng() * 0.14 : 0.3 + rng() * 0.26;
        const width = (far ? 0.016 : 0.0052) + rng() * (far ? 0.008 : 0.0034);
        const id = rng();
        const across = [Math.cos(angle + 1.57), Math.sin(angle + 1.57)];
        const base = positions.length / 3;
        const steps = far ? 2 : 3;
        const rungs = head ? SPINDLE : Array.from({ length: steps + 1 }, (_, step) => {
            const t = step / steps;
            return [t, width * (1 - t * 0.94), 0];
        });
        rungs.forEach(([t, half, mark], step) => {
            const out = spread + lean * t * t;
            const cx = Math.cos(angle) * out;
            const cz = Math.sin(angle) * out;
            positions.push(
                cx - across[0] * half,
                height * t,
                cz - across[1] * half,
                cx + across[0] * half,
                height * t,
                cz + across[1] * half,
            );
            uvs.push(id, t, id, t);
            paint.push(height * t, mark, id, head ? 1 : 0, height * t, mark, id, head ? 1 : 0);
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
    geometry.name = `SummerGrass${far ? ' far' : ''}`;
    return geometry;
}
