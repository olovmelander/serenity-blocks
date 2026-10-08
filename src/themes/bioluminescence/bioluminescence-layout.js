/**
 * Bioluminescence — the grotto's plan. Three-free, seeded and deterministic.
 *
 * Everything that has a place is decided here once: the floor and the vault (two height fields;
 * where they meet there is rock, so the walls fall out of the same data), the pool, the islets,
 * every mushroom (the elder, the heroes of the two courts, the fill, the fairy-ring sprouts a
 * chain raises), the crystals, the stalactites and columns, the glow-worm colonies, the hanging
 * vines, the jellies' homes, the drips and the floating pads, and the lights the mist and the
 * rock evaluate.
 *
 * The gameplay card covers the middle of a landscape screen, so the picture is planned for the
 * two side thirds: a court of mushrooms each side, crystals in the water lower right, islets in
 * the foreground shallows, vines and the vault above.
 */

import {
    ELDER,
    EMITTER_MAX,
    JELLY_MAX,
    TAU,
    TERRAIN,
    mulberry32,
    sampleNoise,
    smooth,
} from './bioluminescence-core.js';

/** Mushroom species. */
export const PARASOL = 0;
export const BELL = 1;
export const GLOBE = 2;

export const MAX_MUSHROOMS = 260;
export const MAX_SPROUTS = 110;
export const MAX_CRYSTALS = 46;
export const MAX_SPIKES = 150;
export const MAX_WORMS = 5200;
export const MAX_VINES = 44;
export const MAX_PADS = 30;

/** The vault's own, coarser grid over the terrain's extent. */
export const VAULT = Object.freeze({ nx: 81, nz: 111 });

/** Rock outcrops in the shallows: (x, z, radius, height). The first two frame the foreground. */
export const ISLETS = Object.freeze([
    [-4.5, -7.8, 1.9, 0.5],
    [5.0, -8.8, 2.1, 0.55],
    [-2.4, -31, 2.6, 0.6],
    [7.6, -39, 2.4, 0.5],
    [-9.5, -52, 3.0, 0.7],
]);

/**
 * The mushrooms someone placed by hand: (x, z, stem height, cap radius, species, family).
 * Left court, right court, then the flanks that stand back in the mist.
 */
const HEROES = Object.freeze([
    [-9.6, -15.5, 8.6, 4.7, PARASOL, 0],
    [12.6, -19.0, 9.9, 4.3, PARASOL, 1],
    [-14.8, -22.5, 5.8, 3.2, PARASOL, 1],
    [17.8, -27.5, 7.0, 3.4, PARASOL, 0],
    [-6.3, -21.5, 4.2, 2.1, PARASOL, 0],
    [8.3, -27.0, 5.0, 2.4, PARASOL, 0],
    [-19.5, -31.0, 9.6, 4.3, PARASOL, 0],
    [21.5, -38.5, 10.2, 4.6, PARASOL, 0],
    [-12.0, -41.0, 7.2, 3.6, PARASOL, 2],
    [13.2, -47.0, 8.0, 3.8, PARASOL, 2],
    [-25.5, -57.0, 12.0, 5.6, PARASOL, 0],
    [24.5, -63.0, 13.0, 6.0, PARASOL, 1],
    [-17.0, -80.0, 10.5, 5.0, PARASOL, 1],
    [18.5, -86.0, 11.5, 5.4, PARASOL, 0],
]);

/** Crystal clusters: (x, z, count, tallest, spread, hue). The first stands lower right. */
const CRYSTAL_CLUSTERS = Object.freeze([
    [6.7, -11.4, 12, 4.6, 1.5, 0.1],
    [-11.4, -27.5, 10, 3.6, 1.4, 0.55],
    [9.5, -51.0, 9, 4.0, 1.6, 0.3],
    [-5.0, -60.5, 8, 3.2, 1.3, 0.8],
    [-3.2, -12.6, 7, 2.5, 0.9, 0.4],
]);

/** Columns that join floor and vault: (x, z, radius). */
const COLUMNS = Object.freeze([
    [-25, -44, 2.4],
    [27, -51, 2.8],
    [-31, -79, 3.2],
    [33, -92, 3.4],
]);

/** Metres outside the pool's edge at (x, z); negative inside the water. */
export function shoreDistance(x, z, noise, size) {
    const n = (sx, sz, c) => sampleNoise(noise, size, sx, sz, c);
    const cx = 1.6 * Math.sin(z * 0.045 + 0.6);
    let w = 9.5 + 3.5 * smooth(6, -24, z) - 3.5 * smooth(-36, -66, z);
    w *= 1 - smooth(-72, -88, z); // the pool closes behind the elder
    w *= 1 - smooth(10, 22, z); // and behind the viewer
    const wobble = (n(x * 0.021, z * 0.021, 0) - 0.5) * 7 + (n(x * 0.083, z * 0.083, 1) - 0.5) * 1.6;
    return Math.abs(x - cx) - w + wobble;
}

/**
 * The floor's height at (x, z): the pool's bed, the wet shelf, the banks, the walls, and (unless
 * `islets` is false) the outcrops in the shallows.
 */
export function floorHeight(x, z, noise, size, islets = true) {
    const n = (sx, sz, c) => sampleNoise(noise, size, sx, sz, c);
    const s = shoreDistance(x, z, noise, size);
    const rough = n(x * 0.06, z * 0.06, 2) - 0.5;
    const fine = n(x * 0.23, z * 0.23, 3) - 0.5;
    let h;
    if (s < 0) {
        h = -Math.min(1.6, -s * 0.2) + rough * 0.3 * smooth(0, -3, s);
    } else {
        const shelf = Math.min(s, 3) * 0.22;
        const bank = Math.max(0, s - 3) * 0.42;
        const wall = Math.max(0, s - 13) ** 2 * 0.075;
        h = shelf + bank + wall + (rough * 2.2 + fine * 0.5) * smooth(0, 2.5, s);
    }
    // The gallery behind the elder climbs away into the dark.
    h += smooth(-90, -145, z) * 7;
    // The elder's island, and the outcrops in the shallows.
    const d = Math.hypot(x - ELDER.x, z - ELDER.z);
    if (d < 9.5) h = Math.max(h, 1.15 * (1 - (d / 9.5) ** 2) - 0.12 + fine * 0.2);
    if (!islets) return h;
    for (let i = 0; i < ISLETS.length; i++) {
        const [ix, iz, r, top] = ISLETS[i];
        // An outcrop is not round: its edge wanders.
        const edge = r * (0.86 + 0.34 * n(x * 0.19 + i * 0.37, z * 0.19, 1));
        const di = Math.hypot(x - ix, z - iz);
        if (di < edge) {
            const k = 1 - (di / edge) ** 2;
            h = Math.max(h, top * Math.sqrt(k) * (0.75 + fine * 1.1 + rough * 0.6) - 0.12);
        }
    }
    return h;
}

/** The vault's height at (x, z): domes and hollows, a great dome over the elder, down to the walls. */
export function vaultHeight(x, z, noise, size) {
    const n = (sx, sz, c) => sampleNoise(noise, size, sx, sz, c);
    const s = shoreDistance(x, z, noise, size);
    const d2 = (x - ELDER.x) ** 2 + (z - ELDER.z) ** 2;
    const base = 21 + (n(x * 0.011 + 0.3, z * 0.011, 1) - 0.5) * 13 + (n(x * 0.05, z * 0.05 + 0.4, 3) - 0.5) * 3.2;
    return base + 17 * Math.exp(-d2 / 900) + 5 * smooth(-20, -70, z) - 0.02 * Math.max(0, s - 4) ** 2;
}

/**
 * @param {Float32Array} noise  the baked noise field (bakeNoise)
 * @param {number} size         its edge length
 * @param {number} [seed]
 */
export function buildPlan(noise, size, seed = 20261008) {
    const rand = mulberry32(seed);
    const {
        nx, nz, x0, x1, z0, z1,
    } = TERRAIN;

    // ── The floor and the vault ──
    const heights = new Float32Array(nx * nz);
    /** The same floor without the outcrops: what the floor's own mesh is built from. */
    const ground = new Float32Array(nx * nz);
    const shore = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
        const z = z0 + ((z1 - z0) * j) / (nz - 1);
        for (let i = 0; i < nx; i++) {
            const x = x0 + ((x1 - x0) * i) / (nx - 1);
            heights[j * nx + i] = floorHeight(x, z, noise, size);
            ground[j * nx + i] = floorHeight(x, z, noise, size, false);
            shore[j * nx + i] = shoreDistance(x, z, noise, size);
        }
    }
    const vault = new Float32Array(VAULT.nx * VAULT.nz);
    for (let j = 0; j < VAULT.nz; j++) {
        const z = z0 + ((z1 - z0) * j) / (VAULT.nz - 1);
        for (let i = 0; i < VAULT.nx; i++) {
            const x = x0 + ((x1 - x0) * i) / (VAULT.nx - 1);
            vault[j * VAULT.nx + i] = vaultHeight(x, z, noise, size);
        }
    }
    const grid = (field, gx, gz) => (x, z) => {
        const fx = Math.max(0, Math.min(gx - 1.001, ((x - x0) / (x1 - x0)) * (gx - 1)));
        const fz = Math.max(0, Math.min(gz - 1.001, ((z - z0) / (z1 - z0)) * (gz - 1)));
        const i = Math.floor(fx);
        const j = Math.floor(fz);
        const tx = fx - i;
        const tz = fz - j;
        const a = field[j * gx + i];
        const b = field[j * gx + i + 1];
        const c = field[(j + 1) * gx + i];
        const d = field[(j + 1) * gx + i + 1];
        return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
    };
    /** The floor at a point: the exact function (the grid is too coarse for an outcrop's top). */
    const floorAt = (x, z) => floorHeight(x, z, noise, size);
    /** The grid's own reading: enough where a metre does not matter (and a thousand times asked). */
    const floorNear = grid(heights, nx, nz);
    const shoreAt = grid(shore, nx, nz);
    const vaultAt = grid(vault, VAULT.nx, VAULT.nz);

    // ── Mushrooms ──
    const mushrooms = [];
    const addMushroom = (x, z, height, capR, species, family, kind, extra = {}) => {
        const a = rand() * TAU;
        const tilt = (kind === 'elder' ? 0.02 : 0.05 + rand() * 0.1) * (species === BELL ? 1.8 : 1);
        const stemR = species === BELL ? capR * 0.11 : capR * (species === GLOBE ? 0.3 : 0.085 + rand() * 0.03);
        const m = {
            x,
            y: Math.max(floorAt(x, z), -0.9) - 0.12,
            z,
            height,
            capR,
            stemR: Math.max(stemR, 0.012 * height),
            species,
            family,
            lean: [Math.cos(a) * tilt, Math.sin(a) * tilt],
            yaw: rand() * TAU,
            seed: Math.floor(rand() * 4096),
            kind,
            rank: 0,
            /** A court moves as one on an upright screen: its heroes, their company, their rings. */
            court: false,
            ...extra,
        };
        mushrooms.push(m);
        return m;
    };
    addMushroom(ELDER.x, ELDER.z, ELDER.height, ELDER.radius, PARASOL, 0, 'elder');
    HEROES.forEach(([x, z, h, r, species, family]) => addMushroom(x, z, h, r, species, family, 'hero', { court: true }));
    const heroCount = mushrooms.length;

    // Company for every hero: a few lesser parasols at its foot.
    for (let i = 1; i < heroCount; i++) {
        const hero = mushrooms[i];
        const friends = 2 + Math.floor(rand() * 3);
        for (let k = 0; k < friends; k++) {
            const a = rand() * TAU;
            const d = hero.capR * (0.45 + rand() * 0.75);
            const x = hero.x + Math.cos(a) * d;
            const z = hero.z + Math.sin(a) * d;
            if (shoreAt(x, z) < -2.2) continue;
            const h = hero.height * (0.16 + rand() * 0.3);
            addMushroom(x, z, h, h * (0.34 + rand() * 0.2), PARASOL, rand() < 0.7 ? hero.family : 1, 'fill', { court: true });
        }
    }
    // Bells in tufts on the islets and along the shelf; globes in drifts between them.
    const tuft = (cx, cz, count, spread, species, family, hLo, hHi) => {
        for (let k = 0; k < count; k++) {
            const a = rand() * TAU;
            const d = spread * Math.sqrt(rand());
            const x = cx + Math.cos(a) * d;
            const z = cz + Math.sin(a) * d;
            if (floorAt(x, z) < -0.25) continue;
            const h = hLo + (hHi - hLo) * rand() ** 1.4;
            const capR = species === BELL ? h * (0.14 + rand() * 0.07) : h * (0.5 + rand() * 0.25);
            addMushroom(x, z, h, capR, species, family, 'fill');
        }
    };
    tuft(ISLETS[0][0], ISLETS[0][1], 9, 1.2, BELL, 0, 0.5, 1.9);
    tuft(ISLETS[1][0], ISLETS[1][1], 8, 1.3, BELL, 1, 0.5, 2.2);
    tuft(ISLETS[0][0] + 0.4, ISLETS[0][1] + 0.5, 5, 1.1, GLOBE, 2, 0.16, 0.42);
    tuft(ISLETS[1][0] - 0.5, ISLETS[1][1] + 0.6, 6, 1.2, GLOBE, 2, 0.16, 0.46);
    for (let i = 2; i < ISLETS.length; i++) {
        tuft(ISLETS[i][0], ISLETS[i][1], 8, ISLETS[i][2] * 0.7, BELL, i % 2, 0.6, 2.6);
        tuft(ISLETS[i][0], ISLETS[i][1], 4, ISLETS[i][2] * 0.6, GLOBE, 2, 0.2, 0.5);
    }
    // The banks: whatever finds a foothold on the wet shelf.
    let guard = 0;
    while (mushrooms.length < MAX_MUSHROOMS && guard++ < 4000) {
        const z = 6 - rand() ** 0.8 * 104;
        const x = (rand() * 2 - 1) * 46;
        const s = shoreAt(x, z);
        if (s < 0.2 || s > 15) continue;
        const pick = rand();
        const near = smooth(-70, -8, z);
        if (pick < 0.5) {
            const h = 0.5 + rand() ** 1.6 * (1.8 + near * 1.2);
            addMushroom(x, z, h, h * (0.14 + rand() * 0.07), BELL, rand() < 0.6 ? 0 : 1, 'fill');
        } else if (pick < 0.8) {
            const h = 0.18 + rand() * 0.4;
            addMushroom(x, z, h, h * (0.5 + rand() * 0.3), GLOBE, rand() < 0.75 ? 2 : 1, 'fill');
        } else {
            const h = 0.9 + rand() ** 1.5 * 3.4;
            addMushroom(x, z, h, h * (0.36 + rand() * 0.2), PARASOL, rand() < 0.65 ? 0 : 1, 'fill');
        }
    }
    // Heroes first, then the fill by how much of the picture it is (large and near).
    const fill = mushrooms.splice(heroCount);
    fill.sort((a, b) => (b.height * b.height) / (30 + Math.hypot(b.x, b.z)) - (a.height * a.height) / (30 + Math.hypot(a.x, a.z)));
    mushrooms.push(...fill);

    // Fairy rings a chain raises: round the feet of the near heroes and on the foreground islets.
    const sprouts = [];
    const ring = (cx, cz, radius, count, family, court = false) => {
        const turn = rand() * TAU;
        for (let k = 0; k < count; k++) {
            const a = turn + (k / count) * TAU + (rand() - 0.5) * 0.3;
            const d = radius * (0.86 + rand() * 0.28);
            const x = cx + Math.cos(a) * d;
            const z = cz + Math.sin(a) * d;
            if (floorAt(x, z) < -0.05) continue;
            const h = 0.45 + rand() * 0.9;
            const species = rand() < 0.75 ? BELL : GLOBE;
            sprouts.push({
                x,
                y: floorAt(x, z) - 0.05,
                z,
                height: species === GLOBE ? h * 0.4 : h,
                capR: species === GLOBE ? h * 0.26 : h * (0.17 + rand() * 0.08),
                stemR: species === GLOBE ? h * 0.07 : h * 0.022,
                species,
                family: rand() < 0.6 ? family : 2,
                lean: [(rand() - 0.5) * 0.24, (rand() - 0.5) * 0.24],
                yaw: rand() * TAU,
                seed: Math.floor(rand() * 4096),
                kind: 'sprout',
                court,
                rank: 0,
            });
        }
    };
    ring(ISLETS[0][0], ISLETS[0][1], 1.25, 9, 0);
    ring(ISLETS[1][0], ISLETS[1][1], 1.4, 10, 1);
    for (let i = 1; i <= 8; i++) ring(mushrooms[i].x, mushrooms[i].z, mushrooms[i].capR * 0.42 + 0.5, 10, mushrooms[i].family, true);
    // And the shoreline itself: small rings wherever the wet shelf has room, both sides of the pool.
    guard = 0;
    while (sprouts.length < MAX_SPROUTS + 20 && guard++ < 600) {
        const z = -5 - rand() * 44;
        const x = (rand() * 2 - 1) * 24;
        const s = shoreAt(x, z);
        if (s < 0.5 || s > 3.4) continue;
        ring(x, z, 0.5 + rand() * 0.5, 5, rand() < 0.5 ? 0 : 1);
    }
    // The order they rise in: nearest the viewer first.
    sprouts.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    sprouts.length = Math.min(sprouts.length, MAX_SPROUTS);
    sprouts.forEach((s, i) => {
        s.rank = 0.14 + 0.84 * (i / Math.max(1, sprouts.length - 1));
    });

    // ── Crystals ──
    const crystals = [];
    CRYSTAL_CLUSTERS.forEach(([cx, cz, count, tallest, spread, hue], ci) => {
        for (let k = 0; k < count; k++) {
            const a = rand() * TAU;
            const d = spread * rand() ** 0.8 * (k === 0 ? 0 : 1);
            const x = cx + Math.cos(a) * d;
            const z = cz + Math.sin(a) * d;
            // (Never so short that the point stays under the water.)
            const height = Math.max(1.5, tallest * (k === 0 ? 1 : 0.28 + 0.6 * rand() ** 1.3));
            // They fan outward from the middle of the cluster.
            const out = k === 0 ? 0.04 : 0.1 + rand() * 0.24;
            const ax = Math.cos(a) * out + (rand() - 0.5) * 0.06;
            const az = Math.sin(a) * out + (rand() - 0.5) * 0.06;
            const len = Math.hypot(ax, 1, az);
            const axis = [ax / len, 1 / len, az / len];
            const y = Math.max(floorAt(x, z), -0.55) - 0.25;
            crystals.push({
                x,
                y,
                z,
                height: height + 0.25,
                radius: (0.12 + 0.07 * rand()) * (0.6 + height * 0.42),
                axis,
                yaw: rand() * TAU,
                hue: (hue + (rand() - 0.5) * 0.25 + 1) % 1,
                seed: Math.floor(rand() * 997) + 1,
                cluster: ci,
                tip: [x + axis[0] * (height + 0.25), y + axis[1] * (height + 0.25), z + axis[2] * (height + 0.25)],
            });
        }
    });
    crystals.length = Math.min(crystals.length, MAX_CRYSTALS);

    // ── Stalactites, stalagmites and columns ──
    const spikes = [];
    COLUMNS.forEach(([x, z, radius]) => {
        const lo = floorAt(x, z) - 1;
        const hi = vaultAt(x, z) + 1;
        spikes.push({
            x, y: lo, z, length: hi - lo, radius, column: true, seed: Math.floor(rand() * 997),
        });
    });
    guard = 0;
    while (spikes.length < MAX_SPIKES && guard++ < 6000) {
        const z = -6 - rand() * 124;
        const x = (rand() * 2 - 1) * 44;
        const top = vaultAt(x, z);
        const bottom = floorNear(x, z);
        if (top - bottom < 5) continue;
        if (rand() < 0.72) {
            // A stalactite: longer where the vault is high, and near ones hang into the frame.
            const length = 1.2 + rand() ** 1.8 * Math.min(11, (top - bottom) * 0.45);
            if (Math.hypot(x - ELDER.x, z - ELDER.z) < ELDER.radius + 4 && top - length < ELDER.height + 9) continue;
            spikes.push({
                x, y: top + 0.6, z, length: -(length + 0.6), radius: 0.22 + length * 0.085, column: false, seed: Math.floor(rand() * 997),
            });
        } else {
            const s = shoreAt(x, z);
            if (s < 1.5) continue;
            const length = 0.6 + rand() ** 1.6 * 4.2;
            spikes.push({
                x, y: bottom - 0.4, z, length: length + 0.4, radius: 0.25 + length * 0.13, column: false, seed: Math.floor(rand() * 997),
            });
        }
    }

    // ── Glow-worms: colonies on the vault, rivers of them where the noise runs high ──
    const worms = [];
    guard = 0;
    while (worms.length < MAX_WORMS && guard++ < 90000) {
        const z = -16 - rand() * 128;
        const x = (rand() * 2 - 1) * 50;
        const density = sampleNoise(noise, size, x * 0.016 + 0.2, z * 0.016, 2);
        const rivers = 1 - Math.abs(sampleNoise(noise, size, x * 0.03, z * 0.03 + 0.5, 0) - 0.5) * 5;
        if (rand() > Math.max(density * density * 1.4 - 0.18, 0) + Math.max(rivers, 0) * 0.5) continue;
        const top = vaultAt(x, z);
        if (top - floorNear(x, z) < 6) continue;
        worms.push({
            x, y: top - 0.06, z, seed: rand(), rank: rand(), thread: 0.25 + rand() ** 2 * 1.5,
        });
    }
    // The nearest first: a tier that draws fewer keeps the ones that read as points, not haze.
    worms.forEach((w) => {
        w.order = Math.hypot(w.x, w.z + 30) * (0.6 + rand() * 0.8);
    });
    worms.sort((a, b) => a.order - b.order);

    // ── Hanging vines: mostly over the two courts, where the top of the frame is ──
    const vines = [];
    guard = 0;
    while (vines.length < MAX_VINES && guard++ < 3000) {
        const side = vines.length % 2 ? 1 : -1;
        const x = side * (3.5 + rand() ** 0.8 * 22);
        const z = -8 - rand() ** 1.2 * 44;
        const top = vaultAt(x, z);
        const bottom = Math.max(floorNear(x, z) + 3.5, 4.2 + rand() * 9 + Math.abs(z) * 0.12);
        if (top - bottom < 4) continue;
        const d = Math.min(...mushrooms.slice(0, heroCount).map((m) => Math.hypot(m.x - x, m.z - z) - m.capR));
        if (d < 0.6 && bottom < 12) continue;
        vines.push({
            x,
            y: top + 0.5,
            z,
            length: top + 0.5 - bottom,
            seed: rand(),
            pods: 2 + Math.floor(rand() * 4),
            family: [0, 0, 0, 0, 0, 1, 1, 2, 2][Math.floor(rand() * 9)],
        });
    }

    // ── Jellies: the first three drift at rest, a chain raises the others ──
    const jellies = [
        { x: -5.6, y: 4.3, z: -13.5 },
        { x: 7.8, y: 5.8, z: -17.5 },
        { x: -11.0, y: 7.0, z: -25.0 },
    ];
    while (jellies.length < JELLY_MAX) {
        const side = jellies.length % 2 ? 1 : -1;
        jellies.push({ x: side * (3.6 + rand() * 11.5), y: 2.4 + rand() * 7.2, z: -9 - rand() * 27 });
    }
    jellies.forEach((j, i) => {
        j.size = 0.42 + rand() * 0.5;
        j.seed = rand();
        j.family = i % 3 === 1 ? 0 : 2;
    });

    // ── Drips from the vault into the pool, and pads floating near the shores ──
    const drips = [
        [-3.3, -12.2], [4.3, -15.8], [-7.6, -24.5], [9.6, -30.5], [-1.0, -20.0], [1.8, -9.5],
    ].map(([x, z], i) => ({
        x, z, period: 4.6 + ((i * 1.37) % 1) * 4.5 + i * 0.6, phase: (i * 0.618) % 1,
    }));
    const pads = [];
    guard = 0;
    while (pads.length < MAX_PADS && guard++ < 3000) {
        const z = 2 - rand() ** 0.9 * 62;
        const x = (rand() * 2 - 1) * 22;
        const s = shoreAt(x, z);
        if (s > -0.7 || s < -4.5) continue;
        if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 0.7)) continue;
        pads.push({
            x, z, r: 0.22 + rand() ** 1.5 * 0.55, seed: rand(), family: rand() < 0.7 ? 1 : 0,
        });
    }

    // ── The lights the mist and the rock evaluate ──
    const emitters = [];
    const capLight = (m, gain) => ({
        x: m.x + m.lean[0] * m.height * 0.8,
        y: m.y + m.height * 0.94,
        z: m.z + m.lean[1] * m.height * 0.8,
        radius: m.capR * 0.62,
        gain: gain * m.capR * m.capR,
        family: m.family,
        source: mushrooms.indexOf(m),
        kind: 'cap',
    });
    emitters.push(capLight(mushrooms[0], 0.16));
    for (let i = 1; i < heroCount && emitters.length < EMITTER_MAX - 2; i++) emitters.push(capLight(mushrooms[i], 1));
    for (let c = 0; c < 2; c++) {
        const [cx, cz, , tallest] = CRYSTAL_CLUSTERS[c];
        emitters.push({
            x: cx, y: tallest * 0.35, z: cz, radius: 1.3, gain: tallest * 1.6, family: 3, source: c, kind: 'crystal',
        });
    }

    return {
        seed,
        heights,
        ground,
        shore,
        vault,
        floorAt,
        shoreAt,
        vaultAt,
        mushrooms,
        heroCount,
        sprouts,
        crystals,
        spikes,
        worms,
        vines,
        jellies,
        drips,
        pads,
        emitters,
    };
}

/** The cap's centre (where its gills hang) for a planned mushroom. */
export function capCentre(m, out = [0, 0, 0]) {
    out[0] = m.x + m.lean[0] * m.height;
    out[1] = m.y + m.height;
    out[2] = m.z + m.lean[1] * m.height;
    return out;
}
