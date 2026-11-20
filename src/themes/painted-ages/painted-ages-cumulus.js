/**
 * Painted Ages — the cumulus banks on the horizon.
 *
 * A flat deck seen at a grazing angle is a row of dashes; real cumulus on the horizon are heaps
 * with height. Each bank is one camera-facing card far beyond the snow peaks, drawn as a heap of
 * billows: a floor of flattened billows along a flat base and one or two towers rising off it.
 *
 *  - The OUTLINE is a distance field: the billows' soft union, dilated by two octaves of small
 *    sphere caps (a lattice of them, the highest over a point wins), so the edge is lumped into
 *    cauliflower at three scales instead of drawing one circle per billow. Nothing outside the
 *    union is drawn (an earlier version let its edge noise fill the whole card).
 *  - The LIGHT is a solid's: the heap's own normal (its billows' blended sphere normals) for the
 *    form, each small cap's normal for the lumps, darker in the creases between caps, the base and
 *    the shadowed side in the hour's shade, the sky's light on the tops, and a silver lining where
 *    the heap is thin and the sun stands behind it.
 *  - The AIR between (thirty kilometres of it) takes more of the lower heap than of the tops.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    attribute,
    cos,
    positionWorld,
    sin,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    int,
    length,
    log,
    max,
    mix,
    normalize,
    smoothstep,
    sqrt,
    texture,
    uniformArray,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { DEG, EYE, mulberry32 } from './painted-ages-core.js';
import {
    columnU, noise3, paHash21, paHash22, paLuma,
} from './painted-ages-tsl.js';
import { skyColour } from './painted-ages-light.js';

/** Billows per bank. */
export const BILLOWS = 26;
/** The soft union's width (in bank widths): billows flow into each other instead of creasing. */
const SOFT = 0.022;
/** How softly the billows' own normals blend (wider than the outline's union). */
const SOFT_NORMAL = 0.05;
/** The rounding of the heap's rim (widths): a billow's radius. */
const PILLOW = 0.075;
/** Lump lattices: cells per bank width for the two octaves, and how far each dilates the edge. */
const LUMP = Object.freeze([
    { cells: 26, reach: 0.034 },
    { cells: 64, reach: 0.0135 },
]);
/** How sharply the light's blend of caps picks the highest (per cell unit² of cap height). */
const LUMP_BLEND = 9;
/** The card reaches this far past the heap on every side (bank widths), so no lump is clipped. */
const MARGIN = 0.09;

/**
 * The banks, most telling first (a lower tier draws the first few): bearing (degrees right of the
 * view axis), distance, width and height (metres), towers. A 16:9 frame shows ±33° and the board
 * covers the middle ±11°, so the first four stand in the side thirds — a tall tower each side
 * near the board, a raft and a second heap further out — every one clear of the sun's bearings
 * at first light (+27°) and sunset (−27°), so the disc stays in view and the heaps beside it take
 * its silver lining. Then two behind the board (narrow screens show them) and the wide flanks.
 */
const BANK_PLAN = Object.freeze([
    [-16.5, 38000, 8600, 5400, 1],
    [17.5, 41000, 10500, 4600, 1],
    [-39, 40000, 12500, 2500, 1],
    [40, 36000, 9200, 4200, 1],
    [-5, 44000, 12500, 3400, 2],
    [6, 39000, 9000, 3600, 1],
    [-55, 37000, 12000, 3200, 2],
    [57, 43000, 11500, 2600, 1],
    [-72, 41000, 10000, 3800, 1],
    [73, 38000, 12000, 3000, 2],
]);

export function cumulusBanks(count = 9, seed = 0xc0b5) {
    const random = mulberry32(seed);
    return BANK_PLAN.slice(0, count).map(([bearing, distance, width, height, towers]) => ({
        bearing: bearing + (random() - 0.5) * 2,
        distance: distance * (0.97 + random() * 0.06),
        base: 2600 + random() * 500,
        width: width * (0.92 + random() * 0.16),
        height: height * (0.9 + random() * 0.2),
        towers,
        seed: random(),
    }));
}

/** How a bank's billows are shared out: the floor, the mound under the towers, the two towers. */
const FLOOR_BILLOWS = 7;
const MOUND_BILLOWS = 6;
const MAIN_BILLOWS = 8;
const SIDE_BILLOWS = BILLOWS - FLOOR_BILLOWS - MOUND_BILLOWS - MAIN_BILLOWS;

/**
 * The billows of a bank in its own frame: `[x, y, r, share]`, x across 0..1 of its width, y up
 * and r in widths, `share` how much of the bank's GROWTH the billow takes (0 on the floor, 1 at
 * a tower's crown: as the weather builds the banks up, a tower climbs off a base that stays).
 *
 * A heap, not a chimney: a floor of flattened billows along a flat base, a broad mound on it (the
 * heap's shoulders), the main tower rising off the mound in zigzag pairs that narrow to a
 * rounded crown, and a lower turret beside it (or, for a bank of two towers, a second tower
 * across the mound).
 */
export function billowsFor(bank, random) {
    const out = [];
    const aspect = bank.height / bank.width;
    // A low raft's billows are smaller (in widths), or they would stand taller than the bank.
    const size = Math.min(1, aspect / 0.42);
    const push = (x, y, r, share) => out.push([x, Math.max(Math.min(y, aspect - r * 0.9), r * 0.55), r, share]);
    // The floor: overlapping billows along a flat base, flattened (their centres low).
    for (let k = 0; k < FLOOR_BILLOWS; k++) {
        const r = 0.055 + random() * 0.03;
        push(0.09 + (0.82 * k) / (FLOOR_BILLOWS - 1) + (random() - 0.5) * 0.05, r * 0.55, r, 0);
    }
    const towers = Math.max(1, bank.towers || 1);
    const main = towers === 1 ? 0.36 + random() * 0.28 : 0.3 + random() * 0.1;
    // The mound: a broad hump under the towers, highest under the main one.
    for (let k = 0; k < MOUND_BILLOWS; k++) {
        const s = (k / (MOUND_BILLOWS - 1)) * 2 - 1;
        const r = (0.088 + random() * 0.03) * size;
        const reach = towers === 1 ? 0.25 : 0.33;
        const x = main + (towers === 1 ? 0 : 0.14) + s * reach + (random() - 0.5) * 0.04;
        push(x, aspect * (0.1 + 0.2 * (1 - s * s)) + r * 0.3, r, 0.28 * (1 - s * s));
    }
    // A tower: billows in zigzag pairs about an axis that leans a little with the wind shear.
    const tower = (count, centre, crown, girth) => {
        const lean = (random() - 0.5) * 0.11;
        for (let k = 0; k < count; k++) {
            const t = (k + random() * 0.5) / count;
            const r = (girth - girth * 0.46 * t) * (0.88 + random() * 0.24) * size;
            const side = k % 2 === 0 ? -1 : 1;
            const x = centre + lean * t + side * girth * 0.45 * (1 - 0.6 * t) * (0.4 + random() * 0.6);
            push(x, aspect * (0.28 + (crown - 0.28) * t ** 0.9), r, 0.32 + 0.68 * t);
        }
    };
    tower(MAIN_BILLOWS, main, 0.97, 0.108);
    // The lower turret stands beside the main tower; a second tower stands across the mound.
    const sideOf = main > 0.5 ? -1 : 1;
    const second = towers === 1 ? main + sideOf * (0.19 + random() * 0.07) : main + 0.34 + random() * 0.06;
    tower(SIDE_BILLOWS, Math.min(0.86, Math.max(0.14, second)), towers === 1 ? 0.56 : 0.76, 0.086);
    return out;
}

/**
 * Cauliflower lumps: a lattice of sphere caps (one per cell, jittered, each its own radius).
 * Returns (rise, normal x, normal y, soft rise): `rise` is the highest cap's height over p as a
 * share of its radius (the outline's lumps: crisp), the rest blend the caps near the top softly
 * (the light's: a crease between two caps is a soft shadow, not a crack).
 */
export const paLumpCells = /* @__PURE__ */ Fn(([p]) => {
    const ip = floor(p);
    const fp = fract(p);
    const rise = float(0.0).toVar();
    const acc = vec3(0.0).toVar();
    const wsum = float(1e-6).toVar();
    for (let j = -1; j <= 1; j += 1) {
        for (let i = -1; i <= 1; i += 1) {
            const o = vec2(i, j);
            const cell = ip.add(o);
            const r = paHash21(cell.add(19.7)).mul(0.32).add(0.62);
            const d = fp.sub(o).sub(paHash22(cell).mul(0.6).add(0.2));
            const z2 = r.mul(r).sub(dot(d, d));
            const h = sqrt(z2.max(0.0)).div(r);
            rise.assign(max(rise, h));
            const w = exp(z2.mul(LUMP_BLEND).min(30.0));
            acc.addAssign(vec3(d.div(r), h).mul(w));
            wsum.addAssign(w);
        }
    }
    const soft = acc.div(wsum);
    return vec4(rise, soft);
}).setLayout({ name: 'pa_lumpCells', type: 'vec4', inputs: [{ name: 'p', type: 'vec2' }] });

export function createCumulus(u, t, tier, count = 9) {
    const banks = cumulusBanks(count);
    const random = mulberry32(0xb111);
    const rows = [];
    const positions = [];
    const uvs = [];
    const cards = [];
    const index = [];
    banks.forEach((bank, b) => {
        const a = bank.bearing * DEG;
        // A bank's first row carries its bearing (the bank's frame for lighting) in w; every
        // other row its share of the bank's growth (the first is a floor billow: no share).
        billowsFor(bank, random).forEach(([x, y, r, share], k) => rows.push(new THREE.Vector4(x, y, r, k === 0 ? a : share)));
        const cx = EYE.x + Math.sin(a) * bank.distance;
        const cz = EYE.z - Math.cos(a) * bank.distance;
        // The card faces the eye: its right is the horizontal tangent of the bearing.
        const rx = Math.cos(a);
        const rz = Math.sin(a);
        const w = bank.width;
        const h = bank.height;
        const top = 1 + (MARGIN * w) / h;
        const base = positions.length / 3;
        // uv = the bank frame's x (widths) and y (heights): the card reaches past the heap.
        const corners = [[-MARGIN, 0], [1 + MARGIN, 0], [1 + MARGIN, top], [-MARGIN, top]];
        for (const [sx, sy] of corners) {
            positions.push(cx + rx * w * (sx - 0.5), bank.base + h * sy, cz + rz * w * (sx - 0.5));
            uvs.push(sx, sy);
            cards.push(b, w, h, bank.seed);
        }
        index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aCard', new THREE.Float32BufferAttribute(cards, 4));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();

    const billows = uniformArray(rows, 'vec4');
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PaintedAgesCumulus';
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.fog = false;
    const card = attribute('aCard', 'vec4');
    const st = attribute('uv', 'vec2');
    const lumpOctaves = tier.clouds > 1 ? 2 : 1;
    material.colorNode = Fn(() => {
        const id = int(floor(card.x.add(0.5)));
        const aspect = card.z.div(card.y);
        // The bank's frame: x across 0..1, y up in widths.
        const p = vec2(st.x, st.y.mul(aspect)).toVar();
        // One pass over the billows: the union's distance (a log-sum-exp of each billow's) and its
        // gradient, and the blend of each billow's sphere normal (weighted softly toward the
        // billow standing highest out of the card there).
        const dSum = float(0.0).toVar();
        const gSum = vec2(0.0).toVar();
        const nSum = vec3(0.0).toVar();
        // The heap LIVES: the weather grows its towers off the base (towerGrow), every billow
        // breathes on its own clock, and a swell travels up each tower (the boil of a growing
        // cloud), so the outline is never the same for long.
        const grow = u.towerGrow.mul(0.42).add(0.58).toVar();
        const clock = u.boil.add(card.w.mul(50.0)).toVar();
        for (let k = 0; k < BILLOWS; k++) {
            const b = billows.element(id.mul(BILLOWS).add(k));
            const share = k === 0 ? float(0.0) : b.w;
            const own = ((k * 0.618034) % 1) * 6.2832;
            const breath = sin(clock.mul(0.17).add(own));
            const swell = sin(clock.mul(0.26).sub(share.mul(5.0)));
            const centre = vec2(b.x.add(breath.mul(0.008)), b.y.mul(mix(float(1.0), grow, share)));
            const radius = b.z.mul(mix(float(1.0), grow.mul(0.3).add(0.7), share))
                .mul(breath.mul(0.07).add(1.0).add(swell.mul(share).mul(0.13))).toVar();
            const d = p.sub(centre);
            const dd = dot(d, d);
            const len = sqrt(dd).max(1e-5);
            const wd = exp(len.sub(radius).div(-SOFT).min(40.0));
            dSum.addAssign(wd);
            gSum.addAssign(d.div(len).mul(wd));
            const z = sqrt(max(radius.mul(radius).sub(dd), 0.0));
            const wz = exp(z.div(SOFT_NORMAL).min(40.0)).mul(z.greaterThan(0.0).select(1.0, 0.0));
            nSum.addAssign(vec3(d, z.max(0.004)).div(radius).mul(wz));
        }
        const union = log(dSum.max(1e-30)).mul(-SOFT).toVar();
        // How deep inside the heap (widths), and the pillow it makes: rounded like a billow at its
        // rim, facing the eye deep inside. One smooth form, no ring where one billow meets the next.
        const depth = union.negate().max(0.0).toVar();
        const outward = gSum.div(dSum.max(1e-30));
        const rimSlope = clamp(float(1.0).sub(depth.div(PILLOW)), 0.0, 0.995);
        const pillow = vec3(
            outward.div(length(outward).max(1e-4)).mul(rimSlope),
            sqrt(float(1.0).sub(rimSlope.mul(rimSlope))),
        );
        const heap = normalize(mix(pillow, normalize(nSum.add(vec3(0.0, 0.0, 1e-4))), 0.12)).toVar();
        // The lumps tell most at the rim, where they stand against the sky.
        const rim = float(1.0).sub(smoothstep(0.0, 0.07, depth));

        // The lumps: each octave dilates the outline where its caps stand high and bends the
        // normal to its cap's; the creases between caps take less light.
        const seedShift = vec2(card.w.mul(91.0), card.w.mul(57.0));
        const bump = vec2(0.0).toVar();
        const lumpLight = float(1.0).toVar();
        const edge = union.toVar();
        LUMP.slice(0, lumpOctaves).forEach((oct, o) => {
            // The lumps well up the heap (a cell every forty seconds or so): its skin boils.
            const rising = vec2(0.0, u.boil.mul(o === 0 ? 0.04 : 0.07));
            const c = paLumpCells(p.mul(oct.cells).add(seedShift.mul(o + 1)).sub(rising));
            edge.subAssign(c.x.sub(0.45).mul(oct.reach));
            bump.addAssign(c.yz.mul(o === 0 ? 0.6 : 0.35));
            lumpLight.mulAssign(mix(float(o === 0 ? 0.52 : 0.78), float(1.0), smoothstep(0.1, 0.8, c.w)));
        });
        const lumpStrength = mix(float(0.4), float(1.0), rim);
        bump.mulAssign(lumpStrength);
        lumpLight.assign(mix(float(1.0), lumpLight, lumpStrength));
        // Frayed a little at the finest scale, drifting slowly.
        const fray = noise3(t.lattice, vec3(p.mul(150.0), card.w.mul(37.0).add(u.time.mul(0.02)))).x;
        edge.addAssign(fray.sub(0.5).mul(0.006));
        // The flat base: the heap is cut a little above its floor's centres.
        const baseY = float(0.032);
        const below = baseY.sub(p.y);
        // Coverage, antialiased over a pixel (the card's own footprint: the edge's derivative
        // spikes in the creases between lumps); the base is softer (it melts into the air under it).
        const aa = fwidth(p.x).max(1e-5).toVar();
        const body = float(1.0).sub(smoothstep(aa.negate(), aa, edge));
        // How deep inside the lumped outline (widths): where the light runs thin.
        const skin = edge.negate().max(0.0);
        const floorCut = float(1.0).sub(smoothstep(-0.018, 0.0, below));
        const alpha = body.mul(floorCut).toVar();

        // ── Light, in the bank's frame: right, up, and out toward the eye ──
        const nrm = normalize(heap.add(vec3(bump, 0.0))).toVar();
        const bearing = billows.element(id.mul(BILLOWS)).w;
        const right = vec3(cos(bearing), 0.0, sin(bearing));
        const out = vec3(sin(bearing).negate(), 0.0, cos(bearing));
        const sunCard = normalize(vec3(dot(u.sunDir, right), u.sunDir.y, dot(u.sunDir, out)));
        // The form: which side of the heap faces the sun (broad), then each lump (wrapped:
        // light passes through a cloud's skin).
        const form = smoothstep(-0.5, 0.65, dot(heap, sunCard));
        const lump = clamp(dot(nrm, sunCard).mul(0.55).add(0.45), 0.0, 1.0);
        const sunAmount = lump.mul(mix(float(0.18), float(1.0), form)).mul(lumpLight).toVar();
        // The base and the lower heap stand in the heap's own shadow.
        const height = clamp(p.y.sub(baseY).div(aspect.sub(baseY).max(0.05)), 0.0, 1.0);
        const under = float(1.0).sub(smoothstep(0.0, 0.4, height));
        sunAmount.mulAssign(float(1.0).sub(under.mul(0.68)));
        const sunUp = u.sunUp.mul(0.85).add(0.15);
        const shade = u.cloudShade.mul(mix(float(0.8), float(1.25), nrm.y.mul(0.5).add(0.5)))
            .add(u.fill.mul(nrm.y.max(0.0).mul(0.6)))
            .mul(mix(float(0.75), float(1.0), lumpLight));
        const col = mix(shade, u.cloudLit.mul(sunUp), sunAmount).toVar();
        // Silver lining: where the heap is thin and the sun stands behind it.
        // A bright thread on the very edge (a pixel or two) over a fainter glow through the
        // thinner rim, strongest for the heaps nearest the sun.
        const along = normalize(positionWorld.sub(u.eye));
        const behind = clamp(sunCard.z.negate(), 0.0, 1.0);
        const nearSun = smoothstep(0.55, 0.97, dot(along, u.sunDir));
        // ...and on the side of the heap that faces the sun across the sky.
        const sunSide = normalize(sunCard.xy.add(vec2(1e-4, 0.0)));
        const facing = smoothstep(-0.4, 0.8, dot(outward.div(length(outward).max(1e-4)), sunSide));
        const lining = behind.mul(behind).mul(nearSun.mul(0.7).add(0.3)).mul(facing.mul(0.8).add(0.2));
        const thread = exp(skin.div(aa.mul(2.0)).negate());
        const glowRim = exp(skin.mul(-90.0)).mul(0.3);
        // Backlit, the body is the heap's shadowed side; its rim burns.
        col.mulAssign(float(1.0).sub(behind.mul(nearSun.mul(0.6).add(0.15)).mul(float(1.0).sub(thread))));
        col.addAssign(u.glow.mul(thread.add(glowRim)).mul(lining).mul(mix(float(0.6), float(1.0), lumpLight))
            .mul(3.2));
        // By night the moon silvers the side that faces it.
        const moonCard = normalize(vec3(dot(u.moonDir, right), u.moonDir.y, dot(u.moonDir, out)));
        col.addAssign(u.moon.mul(clamp(dot(nrm, moonCard).mul(0.6).add(0.4), 0.0, 1.0)).mul(lumpLight).mul(1.5));
        // Lightning far inside a bank: a glow behind its lumps, the creases dark against it.
        If(u.flicker.y.greaterThan(0.002).and(abs(u.flicker.x.sub(card.x)).lessThan(0.5)), () => {
            const at = vec2(u.flicker.z.mul(0.5).add(0.25), aspect.mul(u.flicker.z.mul(0.37).fract().mul(0.4).add(0.25)));
            const blob = exp(dot(p.sub(at), p.sub(at)).div(-0.012));
            col.addAssign(vec3(0.74, 0.8, 1.0).mul(blob.mul(u.flicker.y).mul(lumpLight.mul(0.7).add(0.3)).mul(2.6)));
        });
        // Perfect clear: the heaps take the LAND'S OWN strata, bed over bed up their height (the
        // column of beds the hills are cut from, read up the cloud: oxblood, ochre, cream, sage),
        // their light and shade kept. (Bands of pure spectrum read as candy stripes.)
        If(u.paint.greaterThan(0.01), () => {
            const g = p.y.mul(110.0).add(p.x.mul(14.0)).add(card.w.mul(260.0)).sub(160.0);
            const bed = texture(t.column, vec2(columnU(g), 0.5)).level(3.0).rgb;
            const rich = mix(vec3(paLuma(bed)), bed, 1.45).max(0.0);
            col.assign(mix(col, rich.mul(paLuma(col).mul(2.3).add(0.12)), u.paint.mul(0.8)));
        });
        // The air: thirty kilometres of it along this line, taking more of the lower heap (and
        // less toward the sun, where the heaps stand dark against the glow).
        const air = skyColour(u, along, { withSun: false });
        const veil = float(0.4).sub(height.mul(0.18)).mul(float(1.0).sub(nearSun.mul(behind).mul(0.35)));
        return vec4(mix(col, air, veil), alpha.mul(0.97));
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PaintedAgesCumulus';
    mesh.frustumCulled = false;
    mesh.renderOrder = 11;
    return {
        mesh,
        meshes: [mesh],
        banks,
        update() {},
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
