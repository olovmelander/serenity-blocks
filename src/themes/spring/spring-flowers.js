/**
 * Spring — the flowers of the knoll, as geometry.
 *
 * Seven kinds open on a Norrland riverbank at the end of May, one for each of the seven pieces:
 * globeflower (I), marsh marigold (O), wood anemone (T), hepatica (S), red campion (Z), lady's
 * smock (J) and dog violet (L). Every plant is real geometry, built here from a seed: petals are
 * kites and fans, not alpha cards, so they stay sharp against a low sun and need no blending.
 * An instance of the small kinds is a little clump of stems, so the anemones can lie in carpets.
 *
 * Vertex data the meadow's shader reads (spring-meadow.js):
 *   color   linear albedo
 *   paint   x = height above the root in metres (how far the wind may carry the vertex),
 *           y = part (0 stem and leaf, 0.5 the eye of a flower, 1 petal),
 *           z = position along the part (0 base, 1 tip), w = spare
 *   head    xyz = offset from the middle of the vertex's flower head (zero on stems), so a head
 *           can swell when a breath from the board passes; w = the plant's flower kind
 */
import * as THREE from 'three/webgpu';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Flower kinds, in the order of their glow slots. `share` how common, `patch` [frequency,
 * threshold] of the drifts they grow in, `wet` how much they keep to the water's edge, `petal`
 * the colour the land's far flecks and the lock's light use.
 */
export const SPRING_FLOWERS = Object.freeze([
    Object.freeze({
        id: 'globeflower', slot: 0, piece: 'I', petal: 0xf7e15a, share: 0.1, patch: [0.05, 0.42], wet: 0.25,
    }),
    Object.freeze({
        id: 'marigold', slot: 1, piece: 'O', petal: 0xffc414, share: 0.12, patch: [0.06, 0.36], wet: 1,
    }),
    Object.freeze({
        id: 'anemone', slot: 2, piece: 'T', petal: 0xfffcf8, share: 0.36, patch: [0.03, 0.24], wet: 0,
    }),
    Object.freeze({
        id: 'hepatica', slot: 3, piece: 'S', petal: 0x7c8cf2, share: 0.11, patch: [0.07, 0.44], wet: 0,
    }),
    Object.freeze({
        id: 'campion', slot: 4, piece: 'Z', petal: 0xe8588f, share: 0.1, patch: [0.05, 0.46], wet: 0.1,
    }),
    Object.freeze({
        id: 'ladysmock', slot: 5, piece: 'J', petal: 0xead5f7, share: 0.11, patch: [0.045, 0.4], wet: 0.6,
    }),
    Object.freeze({
        id: 'violet', slot: 6, piece: 'L', petal: 0x6a47d8, share: 0.1, patch: [0.08, 0.46], wet: 0,
    }),
]);

/** Flower kind for a piece letter, or -1. */
export function springFlowerSlotForPiece(piece) {
    if (typeof piece !== 'string') return -1;
    const kind = SPRING_FLOWERS.find((flower) => flower.piece === piece.toUpperCase());
    return kind ? kind.slot : -1;
}

const tint = (hex) => new THREE.Color(hex);
const STEM = tint(0x4c7a26);
const STEM_PALE = tint(0x8aa64a);
const STEM_RED = tint(0x6e3a2c);
const LEAF = tint(0x4f8a2a);
const LEAF_YOUNG = tint(0x78a83a);
const LEAF_DARK = tint(0x2f6420);
const LEAF_GLOSS = tint(0x2c5e1c);

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

/** A round leaf (a marigold's kidney, a violet's heart): a fan of `sides` kites from its stalk. */
function roundLeaf(b, base, direction, radius, colour, rim, sides = 7, notch = 0.5) {
    const flat = new THREE.Vector3(direction.x, 0, direction.z).normalize();
    const across = new THREE.Vector3(-flat.z, 0, flat.x);
    const centre = at(base, flat, radius * 0.9, UP, radius * 0.18);
    const hub = b.vertex(base, colour, 0, 0);
    const middle = b.vertex(centre, colour, 0, 0.5);
    const ring = [];
    for (let i = 0; i <= sides; i += 1) {
        // The leaf's notch faces its stalk: the fan runs round from one side of it to the other.
        const angle = -Math.PI + notch + (i / sides) * (TAU - notch * 2);
        const out = flat.clone().multiplyScalar(-Math.cos(angle)).addScaledVector(across, Math.sin(angle));
        const droop = -radius * 0.12 * (1 - Math.cos(angle)) * 0.5;
        ring.push(b.vertex(at(centre, out, radius, UP, droop), rim, 0, 1));
    }
    for (let i = 0; i < sides; i += 1) b.tri(middle, ring[i + 1], ring[i]);
    b.tri(hub, ring[0], middle);
    b.tri(hub, middle, ring[sides]);
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
/** A root a little way from the clump's middle. */
const offset = (rng, spread) => {
    const a = rng() * TAU;
    const r = spread * Math.sqrt(rng());
    return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
};

// ── The seven ──────────────────────────────────────────────────────────────────────────

/** Wood anemone: a little clump of white stars, each nodding over a whorl of three cut leaves. */
function anemone(rng, far) {
    const b = new PlantBuilder(2);
    const white = tint(0xfffcf8);
    const blush = tint(0xf2dde6);
    const stems = far ? 2 : 3 + Math.floor(rng() * 2);
    for (let s = 0; s < stems; s += 1) {
        const root = offset(rng, 0.09);
        const height = 0.12 + rng() * 0.07;
        const lean = outward(UP, rng() * TAU);
        const top = at(root, UP, height, lean, 0.02 + rng() * 0.02);
        const axis = tilted(rng, 0.9).add(lean.clone().multiplyScalar(0.25)).normalize();
        if (far) {
            wisp(b, root, top, 0.006, STEM_RED);
            rosette(b, top, axis, 0.017, white, tint(0xf0d84a), 6, 0.1);
            continue;
        }
        stalk(b, curve(root, top, 0.008, 3), 0.0022, 0.0016, STEM_RED, STEM);
        // The whorl: three leaves, each cut into three lobes, two thirds of the way up.
        const whorl = root.clone().lerp(top, 0.62);
        for (let l = 0; l < 3; l += 1) {
            const out = outward(UP, (l / 3) * TAU + rng() * 0.5);
            for (let lobe = -1; lobe <= 1; lobe += 1) {
                const dir = outward(UP, Math.atan2(out.z, out.x) + lobe * 0.42)
                    .add(new THREE.Vector3(0, -0.05, 0)).normalize();
                leaf(b, whorl, dir, 0.032 + (lobe === 0 ? 0.008 : 0), 0.011, LEAF, LEAF_YOUNG);
            }
        }
        eye(b, top, axis, 0.0042, 0.0032, tint(0xf2cf3c), tint(0xe2b42a), 6);
        const count = rng() < 0.3 ? 7 : 6;
        for (let i = 0; i < count; i += 1) {
            petal(b, top, outward(axis, (i / count) * TAU + rng() * 0.15), axis, {
                start: 0.003, length: 0.016 + rng() * 0.003, width: 0.011, lift: 0.0055, base: blush, tip: white,
            });
        }
    }
    return b;
}

/** Marsh marigold: glossy round leaves at the water's edge, golden cups on stout stalks. */
function marigold(rng, far) {
    const b = new PlantBuilder(1);
    const gold = tint(0xffbe0a);
    const bright = tint(0xffde3c);
    const height = 0.2 + rng() * 0.1;
    const fork = new THREE.Vector3((rng() - 0.5) * 0.04, height * 0.55, (rng() - 0.5) * 0.04);
    if (far) wisp(b, new THREE.Vector3(), fork, 0.012);
    else stalk(b, curve(new THREE.Vector3(), fork, 0.01), 0.0055, 0.004, STEM, STEM);
    const heads = far ? 2 : 3;
    for (let h = 0; h < heads; h += 1) {
        const angle = (h / heads) * TAU + rng();
        const top = new THREE.Vector3(
            fork.x + Math.cos(angle) * (0.05 + rng() * 0.04),
            height - h * 0.04,
            fork.z + Math.sin(angle) * (0.05 + rng() * 0.04),
        );
        const axis = tilted(rng, 0.6);
        if (far) {
            wisp(b, fork, top, 0.009);
            rosette(b, top, axis, 0.024, bright, gold, 5, -0.3);
            continue;
        }
        stalk(b, curve(fork, top, 0.01, 2), 0.0038, 0.003, STEM, STEM_PALE);
        eye(b, top, axis, 0.007, 0.004, tint(0xc8a414), tint(0xe8c62a), 6);
        for (let i = 0; i < 5; i += 1) {
            petal(b, top, outward(axis, (i / 5) * TAU + h), axis, {
                start: 0.003, length: 0.018, width: 0.022, lift: 0.011, base: gold, tip: bright,
            });
        }
    }
    const leaves = far ? 2 : 4;
    for (let l = 0; l < leaves; l += 1) {
        const out = outward(UP, (l / leaves) * TAU + rng());
        const foot = at(new THREE.Vector3(), out, 0.02, UP, 0.03 + rng() * 0.04);
        roundLeaf(b, foot, out, far ? 0.05 : 0.04 + rng() * 0.015, LEAF_GLOSS, LEAF_DARK, far ? 4 : 8, 0.45);
    }
    return b;
}

/** Globeflower: a lemon ball of incurved petals on a tall stem over deeply cut leaves. */
function globeflower(rng, far) {
    const b = new PlantBuilder(0);
    const lemon = tint(0xf2d63c);
    const pale = tint(0xfff27c);
    const deep = tint(0xd9b51e);
    const height = 0.36 + rng() * 0.16;
    const top = new THREE.Vector3((rng() - 0.5) * 0.08, height, (rng() - 0.5) * 0.08);
    const radius = 0.016 + rng() * 0.004;
    if (far) {
        wisp(b, new THREE.Vector3(), top, 0.01);
        eye(b, top, UP, radius * 1.15, radius * 1.1, lemon, pale, 5, 1);
        eye(b, top, new THREE.Vector3(0, -1, 0), radius * 1.15, radius * 0.7, lemon, deep, 5, 1);
        return b;
    }
    stalk(b, curve(new THREE.Vector3(), top, 0.02, 4), 0.0042, 0.0028);
    // The ball: two shallow cones, and a ring of incurved petals over their seam.
    eye(b, top, UP, radius, radius * 0.95, lemon, pale, 8, 1);
    eye(b, top, new THREE.Vector3(0, -1, 0), radius, radius * 0.75, lemon, deep, 8, 1);
    for (let i = 0; i < 9; i += 1) {
        const out = outward(UP, (i / 9) * TAU + rng() * 0.2);
        petal(b, at(top, UP, -radius * 0.35), out, UP, {
            start: radius * 0.55,
            length: radius * 0.85,
            width: radius * 1.05,
            lift: radius * 1.05,
            base: lemon,
            tip: pale,
        });
    }
    // Leaves: a few palmate, deeply cut, up the stem and at the foot.
    for (let l = 0; l < 3; l += 1) {
        const y = l === 0 ? 0.05 : 0.12 + l * 0.08;
        const hub = new THREE.Vector3(top.x * (y / height), y, top.z * (y / height));
        const out = outward(UP, l * 2.3 + rng());
        for (let f = -2; f <= 2; f += 1) {
            const dir = outward(UP, Math.atan2(out.z, out.x) + f * 0.38).add(new THREE.Vector3(0, 0.12, 0)).normalize();
            leaf(b, hub, dir, (0.05 - Math.abs(f) * 0.008) * (l === 0 ? 1.3 : 1), 0.012, LEAF_DARK, LEAF);
        }
    }
    return b;
}

/** Hepatica: low blue stars with white stamens over three-lobed leaves. */
function hepatica(rng, far) {
    const b = new PlantBuilder(3);
    const blue = tint(0x6577ea);
    const pale = tint(0x96a6ff);
    const stems = far ? 2 : 3;
    for (let s = 0; s < stems; s += 1) {
        const root = offset(rng, 0.05);
        const height = 0.06 + rng() * 0.04;
        const top = at(root, UP, height, outward(UP, rng() * TAU), 0.015);
        const axis = tilted(rng, 0.7);
        if (far) {
            wisp(b, root, top, 0.005, STEM_RED);
            rosette(b, top, axis, 0.014, pale, blue, 6, 0.05);
            continue;
        }
        stalk(b, [root, root.clone().lerp(top, 0.5), top], 0.0016, 0.0012, STEM_RED, STEM_RED);
        eye(b, top, axis, 0.0032, 0.0028, tint(0xf6f3ff), tint(0xe4defa), 6);
        for (let i = 0; i < 7; i += 1) {
            petal(b, top, outward(axis, (i / 7) * TAU + rng() * 0.2), axis, {
                start: 0.0025, length: 0.011, width: 0.0075, lift: 0.0035, base: blue, tip: pale,
            });
        }
    }
    if (!far) {
        for (let l = 0; l < 3; l += 1) {
            const out = outward(UP, (l / 3) * TAU + rng());
            const hub = at(new THREE.Vector3(), out, 0.02, UP, 0.012);
            for (let lobe = -1; lobe <= 1; lobe += 1) {
                const dir = outward(UP, Math.atan2(out.z, out.x) + lobe * 0.7)
                    .add(new THREE.Vector3(0, 0.05, 0)).normalize();
                leaf(b, hub, dir, 0.026, 0.02, tint(0x2e4c1e), tint(0x4a3a40));
            }
        }
    }
    return b;
}

/** Red campion: magenta stars of notched petals in dark calyxes, on forked hairy stems. */
function campion(rng, far) {
    const b = new PlantBuilder(4);
    const pink = tint(0xe0508a);
    const bright = tint(0xf47aa8);
    const calyx = tint(0x6a1f3c);
    const height = 0.32 + rng() * 0.14;
    const fork = new THREE.Vector3((rng() - 0.5) * 0.05, height * 0.66, (rng() - 0.5) * 0.05);
    if (far) wisp(b, new THREE.Vector3(), fork, 0.011, STEM_RED);
    else stalk(b, curve(new THREE.Vector3(), fork, 0.015), 0.0036, 0.0026, STEM_RED, STEM);
    const heads = far ? 2 : 3;
    for (let h = 0; h < heads; h += 1) {
        const angle = (h / heads) * TAU + rng() * 2;
        const top = new THREE.Vector3(
            fork.x + Math.cos(angle) * 0.05,
            height - h * 0.05,
            fork.z + Math.sin(angle) * 0.05,
        );
        const axis = tilted(rng, 1.1);
        if (far) {
            wisp(b, fork, top, 0.007, STEM_RED);
            rosette(b, top, axis, 0.018, bright, calyx, 5, 0.3);
            continue;
        }
        stalk(b, curve(fork, top, 0.01, 2), 0.0024, 0.002, STEM_RED, calyx);
        eye(b, top, axis.clone().negate(), 0.0045, 0.012, calyx, calyx, 5, 0);
        for (let i = 0; i < 5; i += 1) {
            const base = (i / 5) * TAU + h;
            // Each petal is cut in two lobes at its tip.
            for (let lobe = -1; lobe <= 1; lobe += 2) {
                petal(b, top, outward(axis, base + lobe * 0.17), axis, {
                    start: 0.003, length: 0.013, width: 0.0075, lift: 0.002, base: pink, tip: bright,
                });
            }
        }
    }
    if (!far) {
        for (let l = 0; l < 2; l += 1) {
            const y = 0.08 + l * 0.1;
            const hub = new THREE.Vector3(fork.x * (y / fork.y), y, fork.z * (y / fork.y));
            const out = outward(UP, l * 1.57 + rng());
            leaf(b, hub, out.clone().add(new THREE.Vector3(0, 0.3, 0)).normalize(), 0.06, 0.022, LEAF_DARK, LEAF);
            const back = out.clone().negate().add(new THREE.Vector3(0, 0.3, 0)).normalize();
            leaf(b, hub, back, 0.06, 0.022, LEAF_DARK, LEAF);
        }
    }
    return b;
}

/** Lady's smock: a loose head of pale lilac crosses over a rosette of small round leaflets. */
function ladysmock(rng, far) {
    const b = new PlantBuilder(5);
    const lilac = tint(0xe2c8f4);
    const pale = tint(0xf6ecfc);
    const height = 0.24 + rng() * 0.1;
    const top = new THREE.Vector3((rng() - 0.5) * 0.05, height, (rng() - 0.5) * 0.05);
    if (far) {
        wisp(b, new THREE.Vector3(), top, 0.008);
        rosette(b, top, UP, 0.022, pale, lilac, 5, -0.4);
        return b;
    }
    stalk(b, curve(new THREE.Vector3(), top, 0.012, 3), 0.0026, 0.0018);
    const flowers = 4 + Math.floor(rng() * 3);
    for (let f = 0; f < flowers; f += 1) {
        const out = outward(UP, (f / flowers) * TAU + rng() * 0.4);
        const head = at(top, out, f === 0 ? 0 : 0.012 + rng() * 0.008, UP, -f * 0.006);
        if (f > 0) stalk(b, [at(top, UP, -f * 0.006 - 0.008), head], 0.0012, 0.001);
        const axis = out.clone().multiplyScalar(f === 0 ? 0 : 0.5).add(UP).normalize();
        eye(b, head, axis, 0.0018, 0.002, tint(0xf3e7a8), tint(0xe8d070), 4);
        for (let i = 0; i < 4; i += 1) {
            petal(b, head, outward(axis, (i / 4) * TAU + 0.4), axis, {
                start: 0.002, length: 0.009, width: 0.008, lift: 0.004, base: lilac, tip: pale,
            });
        }
    }
    // The basal rosette: leaflets along short stalks.
    for (let l = 0; l < 5; l += 1) {
        const out = outward(UP, (l / 5) * TAU + rng());
        for (let k = 1; k <= 3; k += 1) {
            const dir = outward(UP, Math.atan2(out.z, out.x) + (k % 2 ? 0.6 : -0.6))
                .add(new THREE.Vector3(0, 0.1, 0)).normalize();
            leaf(b, at(new THREE.Vector3(), out, k * 0.014, UP, 0.004), dir, 0.011, 0.009, LEAF);
        }
    }
    return b;
}

/** Dog violet: low violet flowers nodding over heart-shaped leaves. */
function violet(rng, far) {
    const b = new PlantBuilder(6);
    const deep = tint(0x5636c8);
    const bright = tint(0x7c5cf0);
    const throat = tint(0xf2f0ff);
    const stems = far ? 1 : 2;
    for (let s = 0; s < stems; s += 1) {
        const root = offset(rng, 0.04);
        const height = 0.07 + rng() * 0.04;
        const lean = outward(UP, rng() * TAU);
        const top = at(root, UP, height, lean, 0.02);
        const axis = lean.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.6, 0)).normalize();
        if (far) {
            wisp(b, root, top, 0.005);
            rosette(b, top, axis, 0.012, bright, deep, 5, 0.1);
            continue;
        }
        stalk(b, [root, at(root, UP, height * 0.8), top], 0.0016, 0.0012);
        eye(b, top, axis, 0.0025, 0.002, throat, tint(0xf2d64a), 5);
        // Two petals up, two to the sides, one broad lip below.
        const { u, v } = frame(axis);
        const petals = [
            [1.4, 0.012, 0.008], [1.75, 0.012, 0.008], [0.4, 0.011, 0.007], [2.75, 0.011, 0.007], [-1.57, 0.013, 0.011],
        ];
        petals.forEach(([angle, length, width]) => {
            const out = u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(v, Math.sin(angle));
            petal(b, top, out, axis, {
                start: 0.002, length, width, lift: 0.002, base: angle < 0 ? throat : deep, tip: bright,
            });
        });
    }
    if (!far) {
        for (let l = 0; l < 4; l += 1) {
            const out = outward(UP, (l / 4) * TAU + rng());
            const foot = at(new THREE.Vector3(), out, 0.006, UP, 0.02 + rng() * 0.015);
            roundLeaf(b, foot, out, 0.017, LEAF, LEAF_DARK, 6, 0.65);
        }
    }
    return b;
}

const BUILDERS = {
    anemone, marigold, globeflower, hepatica, campion, ladysmock, violet,
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
 * Geometry for one flower kind. `far` asks for the handful-of-triangles version drawn beyond
 * the near ground; `variant` picks one of the shapes a kind comes in.
 */
export function createSpringFlowerGeometry(id, { far = false, variant = 0 } = {}) {
    const build = Object.prototype.hasOwnProperty.call(BUILDERS, id) ? BUILDERS[id] : null;
    if (!build) throw new Error(`[Spring] Unknown flower "${id}".`);
    const index = SPRING_FLOWERS.findIndex((flower) => flower.id === id);
    const rng = plantRandom(131 + index * 37 + variant * 7 + (far ? 1000 : 0));
    return build(rng, far).geometry(`SpringFlower ${id}${far ? ' far' : ''} ${variant}`);
}

/**
 * A clump of spring grass: new blades coming up through last year's, which lie bleached and
 * bent over. uv.x is a per-blade id, uv.y runs from root to tip; paint.x is height in metres,
 * paint.y marks a dead blade.
 */
export function createSpringGrassGeometry({ far = false, seed = 1 } = {}) {
    const rng = plantRandom(seed + (far ? 500 : 0));
    const positions = [];
    const uvs = [];
    const paint = [];
    const indices = [];
    const blades = far ? 7 : 13;
    for (let blade = 0; blade < blades; blade += 1) {
        const dead = rng() < 0.32;
        const angle = rng() * TAU;
        const spread = rng() * (far ? 0.2 : 0.12);
        // Last year's blades lie over; the new ones stand.
        const lean = dead ? 0.16 + rng() * 0.22 : 0.04 + rng() * 0.14;
        const height = dead ? 0.1 + rng() * 0.14 : 0.13 + rng() * 0.17;
        const width = (far ? 0.014 : 0.0046) + rng() * (far ? 0.007 : 0.0028);
        const id = rng();
        const across = [Math.cos(angle + 1.57), Math.sin(angle + 1.57)];
        const base = positions.length / 3;
        const steps = far ? 2 : 3;
        for (let step = 0; step <= steps; step += 1) {
            const t = step / steps;
            const half = width * (1 - t * 0.94);
            const out = spread + lean * t * t;
            const cx = Math.cos(angle) * out;
            const cz = Math.sin(angle) * out;
            const y = height * t * (1 - (dead ? 0.35 * t : 0));
            positions.push(cx - across[0] * half, y, cz - across[1] * half);
            positions.push(cx + across[0] * half, y, cz + across[1] * half);
            uvs.push(id, t, id, t);
            const mark = dead ? 1 : 0;
            paint.push(y, mark, id, 0, y, mark, id, 0);
            if (step < steps) {
                const a = base + step * 2;
                indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('paint', new THREE.Float32BufferAttribute(paint, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.name = `SpringGrass${far ? ' far' : ''}`;
    return geometry;
}
