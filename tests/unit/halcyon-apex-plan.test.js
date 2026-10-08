import { describe, expect, it } from 'vitest';
import {
    APEX_Y, CAMERA_OFFSET, CAMERA_REACH, HALCYON_PALETTES, LEY_A, LEY_B, PALETTE_KEYS, PYRAMID_TOP, SITE, STAIR,
    SUNFIRE, compositionFor, leyAAtDeck, leyBAtStone, linRGB, mulberry32, pieceColor, siteToWorld, stairPoint,
    tierHalf, worldToSite,
} from '../../src/themes/halcyon-apex/halcyon-apex-core.js';
import { GEM, STONE, buildPlan } from '../../src/themes/halcyon-apex/halcyon-apex-plan.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/halcyon-apex/halcyon-apex-quality.js';

const plan = buildPlan();

/** The darkest a baked corner gets: AO_FLOOR in the plan, which does not export it. */
const OCCLUSION_FLOOR = 0.3;

const finite = (array) => array.every((v) => Number.isFinite(v));
const gemsOf = (kind, from = plan) => from.gems.filter((gem) => gem.kind === kind);

/** The three corners of triangle `t` of a soup of flat triangles. */
function corners(positions, t) {
    const at = (k) => [positions[(t * 3 + k) * 3], positions[(t * 3 + k) * 3 + 1], positions[(t * 3 + k) * 3 + 2]];
    return [at(0), at(1), at(2)];
}

/** The (unnormalised) geometric normal of a triangle: its winding's own. */
function windingNormal([a, b, c]) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
}

describe('halcyon apex core: the site', () => {
    it('steps the pyramid in, tier by tier, from its base to its top platform', () => {
        const p = SITE.pyramid;
        expect(tierHalf(0).foot).toBe(p.half);
        let previous = tierHalf(0);
        expect(previous.top).toBeLessThan(previous.foot);
        for (let i = 1; i < p.tiers; i++) {
            const tier = tierHalf(i);
            // Every wall leans in by the batter, and every tier stands inside the one below.
            expect(tier.foot - tier.top, `tier ${i}`).toBeCloseTo(p.batter, 9);
            expect(tier.foot, `tier ${i}`).toBeLessThan(previous.top);
            previous = tier;
        }
        // The last wall ends at the top platform.
        expect(previous.top).toBeCloseTo(p.topHalf, 9);
        expect(PYRAMID_TOP).toBeCloseTo(p.plinth + p.tiers * p.tierHeight, 9);
        expect(APEX_Y).toBeCloseTo(PYRAMID_TOP + SITE.apex.hover, 9);
    });

    it('runs the stair in one line from the landing to the top platform', () => {
        const p = SITE.pyramid;
        expect(STAIR.zFoot - STAIR.run).toBeCloseTo(STAIR.zTop, 9);
        expect(STAIR.rise).toBeCloseTo(PYRAMID_TOP - p.plinth, 9);
        expect(STAIR.zTop).toBeCloseTo(tierHalf(p.tiers - 1).top, 9);
        expect(STAIR.length).toBeCloseTo(Math.hypot(STAIR.run, STAIR.rise), 9);
        expect(STAIR.slope).toBeCloseTo(STAIR.rise / STAIR.run, 9);
        expect(stairPoint(0)).toEqual([STAIR.zFoot, p.plinth]);
        const [zTop, yTop] = stairPoint(1);
        expect(zTop).toBeCloseTo(STAIR.zTop, 9);
        expect(yTop).toBeCloseTo(PYRAMID_TOP, 9);
        // It climbs toward the pyramid's axis, and its foot stands outside the base.
        const [zMid, yMid] = stairPoint(0.5);
        expect(zMid).toBeCloseTo((STAIR.zFoot + STAIR.zTop) / 2, 9);
        expect(yMid).toBeCloseTo((p.plinth + PYRAMID_TOP) / 2, 9);
        expect(STAIR.zFoot).toBeGreaterThan(p.half);
        expect(STAIR.zFoot).toBeLessThan(SITE.causeway.near);
    });

    it('measures ley line A from the first shards, along the deck, up the stair and into the Apex', () => {
        expect(LEY_A.length).toBeCloseTo(LEY_A.foot + LEY_A.stair + SITE.apex.hover, 9);
        expect(LEY_A.stair).toBe(STAIR.length);
        // Arc length is zero at the line's head and grows as the deck runs in to the pyramid.
        expect(leyAAtDeck(LEY_A.head)).toBe(0);
        expect(leyAAtDeck(STAIR.zFoot)).toBeCloseTo(LEY_A.foot, 9);
        let previous = -Infinity;
        for (let z = SITE.causeway.far; z >= SITE.causeway.near; z -= SITE.causeway.pitch) {
            const s = leyAAtDeck(z);
            expect(s).toBeGreaterThan(previous);
            previous = s;
        }
        // The head lies on the deck, beside the viewer.
        expect(LEY_A.head).toBeGreaterThan(SITE.causeway.near);
        expect(LEY_A.head).toBeLessThan(SITE.causeway.far);
        expect(LEY_A.foot).toBeGreaterThan(0);
    });

    it('measures ley line B both ways round the dial from the stone nearest the viewer', () => {
        const n = SITE.dial.stones;
        expect(leyBAtStone(0)).toBe(0);
        expect(LEY_B.arc).toBeCloseTo((Math.PI * 2 * SITE.dial.radius) / n, 9);
        let farthest = 0;
        for (let k = 1; k < n; k++) {
            // The same way round either side of the ring.
            expect(leyBAtStone(k), `stone ${k}`).toBeCloseTo(leyBAtStone(n - k), 9);
            expect(leyBAtStone(k), `stone ${k}`).toBeGreaterThan(0);
            farthest = Math.max(farthest, leyBAtStone(k));
        }
        for (let k = 1; k <= Math.floor(n / 2); k++) expect(leyBAtStone(k)).toBeGreaterThan(leyBAtStone(k - 1));
        // The ring ends at the far stones; from there the line rises into the Halcyon.
        expect(farthest).toBeCloseTo(LEY_B.ring, 9);
        expect(LEY_B.rise).toBeCloseTo(SITE.halcyon.height - SITE.halcyon.half, 9);
        expect(LEY_B.length).toBeGreaterThanOrEqual(LEY_B.ring + LEY_B.rise);
        // It wraps: stone n is stone 0 again, and so is stone −n.
        expect(leyBAtStone(n)).toBe(0);
        expect(leyBAtStone(-n)).toBe(0);
        expect(leyBAtStone(n + 2)).toBeCloseTo(leyBAtStone(2), 9);
        expect(leyBAtStone(-1)).toBeCloseTo(leyBAtStone(1), 9);
    });

    it('turns the pyramid\'s frame into the world and back, with the viewer standing beside the causeway', () => {
        for (const [xs, zs] of [[0, 0], [12, 40], [-30, 200], [5.5, -17]]) {
            const [x, z] = siteToWorld(xs, zs);
            const back = worldToSite(x, z);
            expect(back[0]).toBeCloseTo(xs, 9);
            expect(back[1]).toBeCloseTo(zs, 9);
            // A turn, never a stretch: distances from the pyramid's centre survive it.
            expect(Math.hypot(x - SITE.pyramid.x, z - SITE.pyramid.z)).toBeCloseTo(Math.hypot(xs, zs), 9);
        }
        expect(siteToWorld(0, 0)).toEqual([SITE.pyramid.x, SITE.pyramid.z]);
        // Both write into what they are given.
        const out = [0, 0];
        expect(siteToWorld(1, 2, out)).toBe(out);
        expect(worldToSite(1, 2, out)).toBe(out);
        // The frame's axes are unit and square.
        expect(Math.hypot(...SITE.front)).toBeCloseTo(1, 12);
        expect(Math.hypot(...SITE.right)).toBeCloseTo(1, 12);
        expect(SITE.front[0] * SITE.right[0] + SITE.front[1] * SITE.right[1]).toBeCloseTo(0, 12);
        // The camera (the world's origin) stands at (CAMERA_OFFSET, CAMERA_REACH) in that frame...
        const camera = worldToSite(0, 0);
        expect(camera[0]).toBeCloseTo(CAMERA_OFFSET, 9);
        expect(camera[1]).toBeCloseTo(CAMERA_REACH, 9);
        // ...in the lagoon beside the deck, between its two ends, the pyramid ahead and to the left.
        expect(Math.abs(CAMERA_OFFSET)).toBeGreaterThan(SITE.causeway.half);
        expect(CAMERA_REACH).toBeGreaterThan(SITE.causeway.near);
        expect(CAMERA_REACH).toBeLessThan(SITE.causeway.far);
        expect(SITE.pyramid.z).toBeLessThan(0);
        expect(SITE.pyramid.x).toBeLessThan(0);
    });

    it('composes for any frame without a jump, the sun always right of the board', () => {
        const fields = (c) => [c.sun.x, c.sun.y, c.yaw, c.pitch, c.wide];
        const step = 0.002;
        const lo = fields(compositionFor(0.3));
        const hi = fields(compositionFor(3));
        let previous = lo;
        let wide = 0;
        for (let aspect = 0.3; aspect <= 3; aspect += step) {
            const c = compositionFor(aspect);
            const now = fields(c);
            expect(now.every((v) => Number.isFinite(v)), `aspect ${aspect}`).toBe(true);
            // No field moves by more than a sliver of its whole range between neighbouring frames.
            for (let k = 0; k < now.length; k++) {
                const sliver = Math.abs(hi[k] - lo[k]) * 0.02 + 1e-12;
                expect(Math.abs(now[k] - previous[k]), `aspect ${aspect}, field ${k}`).toBeLessThanOrEqual(sliver);
            }
            expect(c.sun.x, `aspect ${aspect}`).toBeGreaterThan(0.5);
            expect(c.sun.x).toBeLessThan(1);
            expect(c.sun.y).toBeGreaterThan(0);
            expect(c.sun.y).toBeLessThan(1);
            // `wide` runs from an upright frame (0) to a landscape one (1) and never back.
            expect(c.wide).toBeGreaterThanOrEqual(wide);
            expect(c.wide).toBeLessThanOrEqual(1);
            ({ wide } = c);
            previous = now;
        }
        expect(compositionFor(0.3).wide).toBe(0);
        expect(compositionFor(3).wide).toBe(1);
        // An upright frame turns the rig toward the pyramid (left of −Z) and tips it another way
        // than a landscape one, which looks a little up at the sky.
        const upright = compositionFor(9 / 19.5);
        const landscape = compositionFor(16 / 9);
        expect(landscape.yaw).toBeGreaterThanOrEqual(0);
        expect(upright.yaw).toBeGreaterThan(landscape.yaw);
        expect(upright.yaw).toBeLessThan(Math.PI / 2);
        expect(upright.pitch).not.toBe(landscape.pitch);
        expect(Math.abs(upright.pitch)).toBeLessThan(Math.PI / 4);
        expect(landscape.pitch).toBeGreaterThan(0);
        // Nonsense falls back to a 16:9 frame.
        for (const bad of [NaN, undefined, 0, -2, Infinity]) expect(compositionFor(bad)).toEqual(landscape);
    });
});

describe('halcyon apex core: light and numbers', () => {
    it('defines every palette key for every level\'s palette, in scene-linear light', () => {
        expect(HALCYON_PALETTES.length).toBeGreaterThan(1);
        expect(new Set(HALCYON_PALETTES.map((p) => p.name)).size).toBe(HALCYON_PALETTES.length);
        for (const palette of HALCYON_PALETTES) {
            for (const key of PALETTE_KEYS) {
                expect(palette[key], `${palette.name}.${key}`).toHaveLength(3);
                for (const channel of palette[key]) {
                    expect(Number.isFinite(channel), `${palette.name}.${key}`).toBe(true);
                    expect(channel, `${palette.name}.${key}`).toBeGreaterThanOrEqual(0);
                }
            }
            // Nothing in a palette is unnamed in the key list (the world eases key by key).
            expect(Object.keys(palette).filter((key) => key !== 'name').sort()).toEqual([...PALETTE_KEYS].sort());
        }
        expect(SUNFIRE).toHaveLength(3);
        expect(SUNFIRE.every((c) => c > 0 && c <= 1)).toBe(true);
    });

    it('gives a lock the piece\'s colour, peak-normalised, with a floor in every channel', () => {
        const rose = pieceColor('#ffa8d0');
        expect(Math.max(...rose)).toBeCloseTo(1, 9);
        expect(Math.min(...rose)).toBeGreaterThan(0);
        // The hue's order survives.
        expect(rose[0]).toBeGreaterThan(rose[2]);
        expect(rose[2]).toBeGreaterThan(rose[1]);
        // A pastel is pushed toward its own hue: the weakest channel falls further than it would
        // by normalising alone.
        const plain = linRGB(0xffa8d0);
        expect(rose[1]).toBeLessThan(plain[1] / Math.max(...plain));
        // A pure primary still reaches all three channels, and every colour peaks at one.
        for (const hex of [0xff0000, 0x00ff00, 0x0000ff, 0x123456, 0xffffff, 0x8ff5ee]) {
            const rgb = pieceColor(hex);
            expect(Math.max(...rgb), hex.toString(16)).toBeCloseTo(1, 9);
            expect(Math.min(...rgb), hex.toString(16)).toBeGreaterThan(0);
            expect(rgb.every((c) => Number.isFinite(c) && c <= 1 + 1e-12)).toBe(true);
        }
        const floor = Math.min(...pieceColor(0x0000ff));
        expect(pieceColor(0xff0000)[1]).toBeCloseTo(floor, 12);
        // A string and a number are the same colour, with or without the hash, in any case.
        expect(pieceColor('a8ffe8')).toEqual(pieceColor('#A8FFE8'));
        expect(pieceColor('#a8ffe8')).toEqual(pieceColor(0xa8ffe8));
        // Nonsense falls back to the given colour, or to the sanctuary's own.
        expect(pieceColor('teal', 0x00ff00)[1]).toBeCloseTo(1, 9);
        expect(pieceColor(null)).toEqual(pieceColor(undefined));
        expect(pieceColor(NaN, 0x123456)).toEqual(pieceColor(0x123456));
        expect(pieceColor('#12345')).toEqual(pieceColor(null));
    });

    it('converts sRGB hex to scene-linear and seeds a repeatable generator', () => {
        expect(linRGB(0x000000)).toEqual([0, 0, 0]);
        expect(linRGB(0xffffff).every((c) => Math.abs(c - 1) < 1e-9)).toBe(true);
        expect(linRGB(0x808080)[0]).toBeCloseTo(0.2158, 3);
        expect(linRGB(0xff0000)).toEqual([1, 0, 0]);
        const a = mulberry32(7);
        const b = mulberry32(7);
        const other = mulberry32(8);
        let differs = false;
        for (let i = 0; i < 200; i++) {
            const v = a();
            expect(v).toBe(b());
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
            if (other() !== v) differs = true;
        }
        expect(differs).toBe(true);
        // A zero seed still runs (it is taken as one).
        expect(mulberry32(0)()).toBe(mulberry32(1)());
    });
});

describe('halcyon apex plan', () => {
    it('is deterministic for a seed and different for another', () => {
        const again = buildPlan();
        expect(again.seed).toBe(plan.seed);
        expect(JSON.stringify(again.gems)).toBe(JSON.stringify(plan.gems));
        for (const part of ['stone', 'ley', 'dialStone', 'dialLey']) {
            for (const key of Object.keys(plan[part])) {
                if (key === 'count') expect(again[part].count, part).toBe(plan[part].count);
                else expect(Array.from(again[part][key]), `${part}.${key}`).toEqual(Array.from(plan[part][key]));
            }
        }
        expect(again.apex).toEqual(plan.apex);
        expect(again.gate).toEqual(plan.gate);
        expect(again.pairs).toBe(plan.pairs);
        expect(buildPlan(plan.seed).gems).toEqual(plan.gems);

        const other = buildPlan(1234);
        expect(other.seed).toBe(1234);
        // The same sanctuary, cut differently: other crystals, other stones on the dial, another
        // face on every block.
        expect(JSON.stringify(other.gems)).not.toBe(JSON.stringify(plan.gems));
        expect(Array.from(other.dialStone.positions)).not.toEqual(Array.from(plan.dialStone.positions));
        expect(Array.from(other.stone.data)).not.toEqual(Array.from(plan.stone.data));
        // What is laid out, not rolled, stays put.
        expect(other.pairs).toBe(plan.pairs);
        expect(other.apex).toEqual(plan.apex);
        expect(other.gate).toEqual(plan.gate);
        expect(other.gems.map((gem) => gem.kind)).toEqual(plan.gems.map((gem) => gem.kind));
        expect(Array.from(other.stone.positions)).toEqual(Array.from(plan.stone.positions));
    });

    it('lists the masonry as whole, finite, flat-shaded triangles', () => {
        for (const part of ['stone', 'dialStone']) {
            const {
                positions, normals, uvs, data, count,
            } = plan[part];
            expect(count % 3, part).toBe(0);
            expect(count / 3, part).toBeGreaterThan(200);
            expect(positions, part).toHaveLength(count * 3);
            expect(normals, part).toHaveLength(count * 3);
            expect(uvs, part).toHaveLength(count * 2);
            expect(data, part).toHaveLength(count * 4);
            for (const array of [positions, normals, uvs, data]) expect(finite(array), part).toBe(true);
            let flipped = 0;
            let slivers = 0;
            for (let t = 0; t < count / 3; t++) {
                const n = [normals[t * 9], normals[t * 9 + 1], normals[t * 9 + 2]];
                // One unit normal for all three corners.
                if (Math.abs(Math.hypot(...n) - 1) > 1e-4) flipped += 1;
                for (let k = 1; k < 3; k++) {
                    for (let c = 0; c < 3; c++) {
                        if (normals[(t * 3 + k) * 3 + c] !== n[c]) flipped += 1;
                    }
                }
                // And it is the triangle's own: the way its winding faces.
                const g = windingNormal(corners(positions, t));
                const area = Math.hypot(...g);
                if (area < 1e-6) slivers += 1;
                else if ((g[0] * n[0] + g[1] * n[1] + g[2] * n[2]) / area < 0.99) flipped += 1;
            }
            expect(flipped, `${part}: triangles whose normal is not their own`).toBe(0);
            expect(slivers, `${part}: degenerate triangles`).toBe(0);
        }
        // The site: footings under the water, the pylons over the top platform, the deck out to
        // the causeway's far end.
        const { positions, count } = plan.stone;
        let yMin = Infinity;
        let yMax = -Infinity;
        let zFar = -Infinity;
        const at = [0, 0];
        for (let i = 0; i < count; i++) {
            yMin = Math.min(yMin, positions[i * 3 + 1]);
            yMax = Math.max(yMax, positions[i * 3 + 1]);
            zFar = Math.max(zFar, worldToSite(positions[i * 3], positions[i * 3 + 2], at)[1]);
        }
        expect(yMin).toBeLessThan(0);
        expect(yMax).toBeGreaterThan(PYRAMID_TOP);
        expect(zFar).toBeCloseTo(SITE.causeway.far, 3);
    });

    it('bakes occlusion that stays in range and actually varies, on stone of a known kind', () => {
        const kinds = new Set(Object.values(STONE));
        expect(kinds.size).toBe(Object.keys(STONE).length);
        for (const part of ['stone', 'dialStone']) {
            const { data, count } = plan[part];
            let lo = Infinity;
            let hi = -Infinity;
            const seen = new Set();
            const shades = new Set();
            let strayHashes = 0;
            for (let i = 0; i < count; i++) {
                const ao = data[i * 4];
                lo = Math.min(lo, ao);
                hi = Math.max(hi, ao);
                shades.add(Math.round(ao * 100));
                seen.add(data[i * 4 + 1]);
                // The face's own hash, a fraction.
                if (!(data[i * 4 + 2] >= 0 && data[i * 4 + 2] < 1)) strayHashes += 1;
            }
            expect(strayHashes, `${part}: hashes outside [0, 1)`).toBe(0);
            expect(lo, part).toBeGreaterThanOrEqual(OCCLUSION_FLOOR - 1e-6);
            expect(hi, part).toBeLessThanOrEqual(1);
            // Open faces are fully lit and corners are not: the bake did something.
            expect(hi, part).toBe(1);
            expect(lo, part).toBeLessThan(hi);
            expect(shades.size, `${part}: distinct shades`).toBeGreaterThan(10);
            for (const kind of seen) expect(kinds.has(kind), `${part} kind ${kind}`).toBe(true);
            expect(seen.size, part).toBeGreaterThan(1);
        }
        // Each corner of a triangle carries its own occlusion (it shades across a face), but a
        // triangle is of one kind of stone.
        const { data, count } = plan.stone;
        let shaded = 0;
        let mixed = 0;
        for (let t = 0; t < count / 3; t++) {
            const kind = data[t * 12 + 1];
            if (data[(t * 3 + 1) * 4 + 1] !== kind || data[(t * 3 + 2) * 4 + 1] !== kind) mixed += 1;
            if (data[t * 12] !== data[(t * 3 + 1) * 4] || data[t * 12] !== data[(t * 3 + 2) * 4]) shaded += 1;
        }
        expect(mixed, 'triangles of two kinds of stone').toBe(0);
        expect(shaded).toBeGreaterThan(0);
    });

    it('stands the ley shards in pairs along the causeway, the nearest pair first', () => {
        expect(plan.pairs).toBeGreaterThan(1);
        expect(plan.shards).toHaveLength(plan.pairs * 2);
        expect(plan.shards).toEqual(gemsOf(GEM.shard));
        const at = [0, 0];
        let previous = -Infinity;
        for (let k = 0; k < plan.pairs; k++) {
            const pair = plan.shards.filter((gem) => gem.index === k);
            expect(pair, `pair ${k}`).toHaveLength(2);
            // Listed pair after pair.
            expect(plan.shards.indexOf(pair[0]), `pair ${k}`).toBe(k * 2);
            const sites = pair.map((gem) => [...worldToSite(gem.x, gem.z, at)]);
            // One either side of the deck's axis, at the same step along it.
            expect(sites[0][0] * sites[1][0], `pair ${k}`).toBeLessThan(0);
            expect(Math.abs(sites[0][0]), `pair ${k}`).toBeCloseTo(SITE.causeway.shardAt, 6);
            expect(Math.abs(sites[1][0]), `pair ${k}`).toBeCloseTo(SITE.causeway.shardAt, 6);
            expect(sites[0][1], `pair ${k}`).toBeCloseTo(sites[1][1], 6);
            expect(sites[0][1]).toBeGreaterThanOrEqual(SITE.causeway.near);
            expect(sites[0][1]).toBeLessThanOrEqual(SITE.causeway.far);
            for (const [i, gem] of pair.entries()) {
                // Each knows how far along the line it stands.
                expect(gem.s, `pair ${k}`).toBeCloseTo(leyAAtDeck(sites[i][1]), 6);
                expect(gem.line).toBe(0);
                expect(gem.y).toBeGreaterThan(SITE.causeway.deck);
            }
            // The pulse reaches them in the order they are listed, and the wisps the nearest first.
            expect(pair[0].s, `pair ${k}`).toBeGreaterThan(previous);
            previous = pair[0].s;
        }
        expect(plan.shards[0].s).toBeCloseTo(0, 6);
        // Pair 0 is the one beside the viewer; they step away toward the pyramid from there.
        const away = (k) => Math.hypot(...siteToWorld(0, LEY_A.head - plan.shards[k * 2].s));
        for (let k = 1; k < plan.pairs; k++) expect(away(k), `pair ${k}`).toBeGreaterThan(away(k - 1));
        expect(plan.shards[plan.pairs * 2 - 1].s).toBeLessThan(LEY_A.foot);
    });

    it('floats one Apex over the pyramid and one Halcyon, a crystal on every stone of the dial', () => {
        const [apex, ...moreApexes] = gemsOf(GEM.apex);
        const [halcyon, ...moreHalcyons] = gemsOf(GEM.halcyon);
        expect(apex).toBeTruthy();
        expect(halcyon).toBeTruthy();
        expect(moreApexes).toHaveLength(0);
        expect(moreHalcyons).toHaveLength(0);
        // The Apex: at the end of line A, over the middle of the top platform.
        expect(apex.s).toBe(LEY_A.length);
        expect(apex.line).toBe(0);
        expect([apex.x, apex.y, apex.z]).toEqual(plan.apex);
        expect(plan.apex[0]).toBeCloseTo(SITE.pyramid.x, 9);
        expect(plan.apex[1]).toBeCloseTo(APEX_Y, 9);
        expect(plan.apex[2]).toBeCloseTo(SITE.pyramid.z, 9);
        expect(apex.half).toBe(SITE.apex.half);
        expect(apex.girth).toBe(SITE.apex.girth);
        expect(apex.y - apex.half).toBeGreaterThan(PYRAMID_TOP);
        // The Halcyon: at the end of line B (the world hangs it before the sun).
        expect(halcyon.s).toBe(LEY_B.length);
        expect(halcyon.line).toBe(1);
        expect(halcyon.half).toBe(SITE.halcyon.half);
        expect(halcyon.girth).toBe(SITE.halcyon.girth);

        // The dial, in its own frame: its centre at the origin, stone 0 toward the viewer (+z).
        const dial = gemsOf(GEM.dial);
        expect(dial).toHaveLength(SITE.dial.stones);
        dial.forEach((gem, k) => {
            expect(Math.hypot(gem.x, gem.z), `stone ${k}`).toBeCloseTo(SITE.dial.radius, 9);
            expect(gem.s, `stone ${k}`).toBeCloseTo(leyBAtStone(k), 9);
            expect(gem.index, `stone ${k}`).toBe(Math.min(k, SITE.dial.stones - k));
            expect(gem.line).toBe(1);
            expect(gem.y).toBeGreaterThan(0);
        });
        expect(dial[0].x).toBeCloseTo(0, 9);
        expect(dial[0].z).toBeCloseTo(SITE.dial.radius, 9);
        // The splinters that circle the two great crystals belong to their lines' ends.
        expect(gemsOf(GEM.apexOrbit).length).toBeGreaterThan(0);
        expect(gemsOf(GEM.halcyonOrbit).length).toBeGreaterThan(0);
        for (const gem of gemsOf(GEM.apexOrbit)) expect([gem.line, gem.s]).toEqual([0, LEY_A.length]);
        for (const gem of gemsOf(GEM.halcyonOrbit)) expect([gem.line, gem.s]).toEqual([1, LEY_B.length]);
    });

    it('describes every crystal with finite numbers, a known kind and a line', () => {
        const kinds = new Set(Object.values(GEM));
        expect(kinds.size).toBe(Object.keys(GEM).length);
        expect(plan.gems.length).toBeGreaterThan(plan.pairs * 2 + SITE.dial.stones);
        plan.gems.forEach((gem, i) => {
            const label = `gem ${i}`;
            for (const key of ['x', 'y', 'z', 'half', 'girth', 'yaw', 's', 'hash']) {
                expect(Number.isFinite(gem[key]), `${label}.${key}`).toBe(true);
            }
            expect(kinds.has(gem.kind), label).toBe(true);
            expect([0, 1], label).toContain(gem.line);
            expect(Number.isInteger(gem.index), label).toBe(true);
            expect(gem.index, label).toBeGreaterThanOrEqual(0);
            expect(gem.half, label).toBeGreaterThan(0);
            expect(gem.girth, label).toBeGreaterThan(0);
            expect(gem.hash, label).toBeGreaterThanOrEqual(0);
            expect(gem.hash, label).toBeLessThan(1);
            expect(gem.s, label).toBeGreaterThanOrEqual(0);
            expect(gem.s, label).toBeLessThanOrEqual(gem.line === 0 ? LEY_A.length : LEY_B.length);
        });
        // Every kind is in the sanctuary.
        expect(new Set(plan.gems.map((gem) => gem.kind))).toEqual(kinds);
    });

    it('inlays the ley lines as strips that know their line, their kind and how far along they lie', () => {
        for (const [part, line, length] of [['ley', 0, LEY_A.length], ['dialLey', 1, LEY_B.ring]]) {
            const {
                positions, uvs, ley, count,
            } = plan[part];
            expect(count % 6, part).toBe(0); // two triangles a strip
            expect(count, part).toBeGreaterThan(0);
            expect(positions, part).toHaveLength(count * 3);
            expect(uvs, part).toHaveLength(count * 2);
            expect(ley, part).toHaveLength(count * 4);
            for (const array of [positions, uvs, ley]) expect(finite(array), part).toBe(true);
            const stray = [];
            for (let i = 0; i < count; i++) {
                const [s, onLine, kind, own] = [ley[i * 4], ley[i * 4 + 1], ley[i * 4 + 2], ley[i * 4 + 3]];
                // Its line, a known kind, an arc length on the line, the strip's own length.
                if (onLine !== line || ![0, 1, 2].includes(kind) || s > length + 1e-3 || !(own > 0)) stray.push(i);
                if (!(uvs[i * 2] >= 0 && uvs[i * 2] <= 1 && uvs[i * 2 + 1] >= 0 && uvs[i * 2 + 1] <= 1)) stray.push(i);
                // A strip is of one kind and one length from end to end.
                const first = Math.floor(i / 6) * 6;
                if (kind !== ley[first * 4 + 2] || own !== ley[first * 4 + 3]) stray.push(i);
            }
            expect(stray, `${part}: vertices that break the strip's contract`).toEqual([]);
        }
        const { ley, count } = plan.ley;
        const strips = [];
        for (let strip = 0; strip < count / 6; strip++) {
            const s = [0, 1, 2, 3, 4, 5].map((k) => ley[(strip * 6 + k) * 4]);
            strips.push({ kind: ley[strip * 24 + 2], from: Math.min(...s), to: Math.max(...s) });
        }
        // Line A: the line itself reaches from the head to the stair's top...
        const lines = strips.filter((strip) => strip.kind === 0);
        expect(Math.min(...lines.map((strip) => strip.from))).toBeLessThanOrEqual(0);
        expect(Math.max(...lines.map((strip) => strip.to))).toBeCloseTo(LEY_A.foot + LEY_A.stair, 3);
        // ...one veil of light stands in the heart gate, at the gate's place on the line...
        const veils = strips.filter((strip) => strip.kind === 1);
        expect(veils).toHaveLength(1);
        expect(veils[0].from).toBeCloseTo(plan.gate[3], 3);
        expect(veils[0].to).toBeCloseTo(plan.gate[3], 3);
        // ...and a rune crosses the deck between each pair of shards, where that pair stands.
        const runes = strips.filter((strip) => strip.kind === 2);
        expect(runes).toHaveLength(plan.pairs);
        runes.forEach((rune, k) => {
            expect(rune.from, `rune ${k}`).toBeCloseTo(plan.shards[k * 2].s, 3);
            expect(rune.to, `rune ${k}`).toBeCloseTo(plan.shards[k * 2].s, 3);
        });
        // Line B: every stone's arc length is on the ring, from stone 0 to the far ones.
        const dial = [];
        for (let i = 0; i < plan.dialLey.count; i++) dial.push(plan.dialLey.ley[i * 4]);
        expect(Math.min(...dial)).toBe(0);
        expect(Math.max(...dial)).toBeCloseTo(LEY_B.ring, 3);
    });

    it('stands the heart gate on the stair\'s line, part of the way up', () => {
        expect(plan.gate).toHaveLength(4);
        expect(finite(plan.gate)).toBe(true);
        const [x, y, z, s] = plan.gate;
        const [across, along] = worldToSite(x, z);
        // On the stair's axis, between its foot and its top...
        expect(across).toBeCloseTo(0, 9);
        expect(along).toBeGreaterThan(STAIR.zTop);
        expect(along).toBeLessThan(STAIR.zFoot);
        // ...at an arc length that is on the stair, in the tier the site names...
        expect(s).toBeGreaterThan(LEY_A.foot);
        expect(s).toBeLessThan(LEY_A.foot + LEY_A.stair);
        const t = (s - LEY_A.foot) / LEY_A.stair;
        const [, stairY] = stairPoint(t);
        const tier = (stairY - SITE.pyramid.plinth) / SITE.pyramid.tierHeight;
        expect(Math.floor(tier)).toBe(SITE.pyramid.gateTier);
        // ...and its light stands in the doorway, over the steps there, under the Apex.
        expect(y).toBeGreaterThan(stairY);
        expect(y).toBeLessThan(PYRAMID_TOP);
    });
});

describe('halcyon apex tiers', () => {
    it('defines every quality tier, and falls back to High', () => {
        expect(QUALITY_NAMES).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        for (const name of QUALITY_NAMES) {
            expect(QUALITY[name]).toBeTruthy();
            expect(tierFor(name)).toBe(QUALITY[name]);
            expect(Object.keys(QUALITY[name]).sort(), name).toEqual(Object.keys(QUALITY.High).sort());
        }
        expect(tierFor('nope')).toBe(QUALITY.High);
        expect(tierFor(undefined)).toBe(QUALITY.High);
        expect(tierFor(null)).toBe(QUALITY.High);
    });

    it('scales every budget monotonically with the tier', () => {
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            const a = QUALITY[QUALITY_NAMES[i - 1]];
            const b = QUALITY[QUALITY_NAMES[i]];
            for (const key of Object.keys(b)) {
                const label = `${QUALITY_NAMES[i]}.${key}`;
                // `shadowEvery` is an interval, not a budget: it has its own rule below.
                if (typeof b[key] === 'number' && key !== 'shadowEvery') {
                    expect(b[key], label).toBeGreaterThanOrEqual(a[key]);
                } else if (typeof b[key] === 'boolean') {
                    // A switch that is on stays on in every tier above.
                    expect(a[key] && !b[key], label).toBe(false);
                }
            }
        }
        // Something really does grow from the bottom tier to the top one.
        const numeric = Object.keys(QUALITY.High)
            .filter((key) => typeof QUALITY.High[key] === 'number' && key !== 'shadowEvery');
        expect(numeric.length).toBeGreaterThan(4);
        const grown = numeric.filter((key) => QUALITY.Extreme[key] > QUALITY.Minimal[key]);
        expect(grown.length).toBeGreaterThan(numeric.length / 2);
    });

    it('redraws the shadow map only where there is one, and never less often on a higher tier', () => {
        let interval = Infinity;
        for (const name of QUALITY_NAMES) {
            const tier = QUALITY[name];
            expect(Number.isInteger(tier.shadowEvery), name).toBe(true);
            expect(tier.shadowEvery, name).toBeGreaterThanOrEqual(0);
            if (tier.shadowMap === 0) expect(tier.shadowEvery, name).toBe(0); // nothing to redraw
            if (tier.shadowEvery > 0) {
                expect(tier.shadowEvery, name).toBeLessThanOrEqual(interval);
                interval = tier.shadowEvery;
            } else {
                // Drawn once: no tier below it may already be redrawing.
                expect(interval, name).toBe(Infinity);
            }
        }
    });

    it('keeps the whole picture and every event on every tier', () => {
        for (const name of QUALITY_NAMES) {
            const tier = QUALITY[name];
            // Spray for a hard drop, drops for a chain to lift, water rising into the Halcyon,
            // a sky with clouds and ranges to close it.
            for (const key of ['sparks', 'beads', 'upfall', 'decks', 'ranges']) {
                expect(tier[key], `${name}.${key}`).toBeGreaterThan(0);
            }
            expect(tier.reflection, name).toBeGreaterThanOrEqual(0);
            expect(tier.reflection, name).toBeLessThanOrEqual(1);
        }
    });
});
