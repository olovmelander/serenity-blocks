/**
 * Rainbark — the light (step A4): the canopy's gobo (its CPU mirror fleckAt, the wind and the
 * gusts, the per-storey calibration) and the shafts' records. Relations, not tuning numbers:
 * coverage follows each zone's spec share, flecks shrink as the walkway climbs, the wind is closed
 * form and never makes a point flicker, the shafts stand where §2.1 puts them.
 */
import { describe, expect, it } from 'vitest';
import { bakeGapMask } from '../../src/themes/rainbark/rainbark-bake.js';
import {
    AMBIENT_SHAFTS,
    CANOPY_WIND,
    CANOPY_Y,
    EVENT_SLOTS,
    FLECK,
    GAP_MASK,
    ZONES,
    canopyWind,
    climbHeight,
    fleckAt,
    fleckCalibration,
    fleckCut,
    fleckLodAt,
    gustTime,
    projectRest,
    restLens,
    sampleGapMask,
    storeyFleck,
    sunDirection,
    windScaleAt,
    zoneIndex,
} from '../../src/themes/rainbark/rainbark-core.js';

const mask = bakeGapMask();
/** The light a world stands in at a level and time (as RainbarkWorld.writeFlecks writes it). */
const lightAt = (level, t = 0) => {
    const zone = ZONES[zoneIndex(level)];
    const sunDir = sunDirection(zone.sunElevation);
    return {
        sunDir,
        wind: canopyWind(t, [0, 0], windScaleAt(climbHeight(level), sunDir[1])),
        thr: storeyFleck(mask, level).thr,
    };
};

describe('Rainbark light: the canopy\'s gobo', () => {
    it('reads the mask coarser the farther a point stands below the canopy (bounded both ways)', () => {
        const sunY = Math.sin(55 * (Math.PI / 180));
        let last = Infinity;
        for (let y = 0; y <= CANOPY_Y; y += 8) {
            const lod = fleckLodAt(y, sunY);
            expect(lod).toBeGreaterThanOrEqual(0);
            expect(lod).toBeLessThanOrEqual(FLECK.maxLod);
            expect(lod).toBeLessThanOrEqual(last + 1e-9);
            last = lod;
        }
        // At the Bole's storey the pinhole image is about 1.3 m (§4.5): its level's texel spans it.
        const texel = GAP_MASK.tile / GAP_MASK.size;
        const image = texel * 2 ** fleckLodAt(56, sunY);
        expect(image).toBeGreaterThan(1.1);
        expect(image).toBeLessThan(1.5);
        expect(fleckLodAt(CANOPY_Y + 10, sunY)).toBe(0);
    });

    it('covers each zone\'s share of the bark with flecks at its storeys (§3.2; as much as the mask opens)', () => {
        for (let level = 1; level <= 12; level++) {
            const zone = ZONES[zoneIndex(level)];
            const light = lightAt(level);
            const cal = storeyFleck(mask, level);
            const y = climbHeight(level);
            let lit = 0;
            let n = 0;
            for (let i = 0; i < 4096; i++) {
                const x = (i % 64) * 0.731 + 0.13;
                const z = Math.floor(i / 64) * 0.677 + 0.29;
                if (fleckAt(mask, x, y, z, light) > 0.5) lit += 1;
                n += 1;
            }
            // Where the cut stands above the floor it lights the zone's share; where the zone wants
            // more than the openings give (the Limb Storey and Crown Light), the floor holds and the
            // storey takes what its real openings light (never their skirts), still a fifth or so.
            const floored = cal.thr <= FLECK.floor * cal.peak + 1e-6;
            const want = floored ? cal.coverage : zone.fleck;
            expect(Math.abs(lit / n - want), `level ${level}`).toBeLessThan(0.05);
            if (floored) {
                expect(cal.coverage, `level ${level}`).toBeLessThan(zone.fleck);
                expect(cal.coverage, `level ${level}`).toBeGreaterThan(0.18);
            }
        }
    });

    it('never cuts below the openings: the threshold stands at a quarter of the brightest or more', () => {
        // (Cut lower, the gobo lights the soft skirts of whole clusters of openings: long diagonal
        // bars across a trunk, the A4 review's camouflage.)
        for (let level = 1; level <= 12; level++) {
            const cal = storeyFleck(mask, level);
            expect(cal.thr / cal.peak, `level ${level}`).toBeGreaterThanOrEqual(0.25);
            expect(cal.thr / cal.peak, `level ${level}`).toBeGreaterThanOrEqual(FLECK.floor - 1e-6);
        }
        // From the Bole the flecks are a dozen or so discrete images a tile (§2.1: several crawl over
        // the Elder's right half), not one merged pool: count the lit runs along a line.
        const light = lightAt(4);
        let runs = 0;
        let prev = false;
        for (let s = 0; s < 4 * 9; s += 0.02) {
            const on = fleckAt(mask, s, climbHeight(4), s * 0.37, light) > 0.5;
            if (on && !prev) runs += 1;
            prev = on;
        }
        expect(runs).toBeGreaterThanOrEqual(6);
    });

    it('calibrates a threshold and a mean light that agree with the cut', () => {
        const cal = fleckCalibration(mask, 0.18, 5);
        expect(cal.thr).toBeGreaterThan(FLECK.least);
        expect(cal.mean).toBeGreaterThan(0.1);
        expect(cal.mean).toBeLessThan(0.5);
        // The cut: nothing at no light, a fleck's heart at its full rim, the dapple between.
        expect(fleckCut(0, cal.thr)).toBe(0);
        expect(fleckCut(cal.thr * (1 + FLECK.soft), cal.thr)).toBeCloseTo(1, 6);
        expect(fleckCut(cal.thr * 0.5, cal.thr)).toBeCloseTo(FLECK.dapple * 0.5, 6);
        // More coverage, a lower threshold; never under the floor (the shader's edges never meet).
        expect(fleckCalibration(mask, 0.4, 5).thr).toBeLessThan(cal.thr);
        expect(fleckCalibration(mask, 1, 2).thr).toBeGreaterThanOrEqual(FLECK.least);
    });

    it('shrinks and sharpens its flecks as the walkway climbs (§4.5: about 1.3 m at the Bole)', () => {
        // The mean run of a fleck across bark facing the sun's azimuth (along its horizontal
        // tangent, where the image is not drawn out by the slant), metres, low and high.
        const run = (level) => {
            const light = lightAt(level);
            const y = climbHeight(level);
            const [lx, , lz] = light.sunDir;
            const h = Math.hypot(lx, lz);
            let runs = 0;
            let litLen = 0;
            let prev = false;
            const step = 0.02;
            for (let s = 0; s < 200; s += step) {
                const on = fleckAt(mask, (-lz / h) * s, y, (lx / h) * s, light) > 0.5;
                if (on) litLen += step;
                if (on && !prev) runs += 1;
                prev = on;
            }
            return litLen / Math.max(runs, 1);
        };
        const bole = run(4);
        const crown = run(12);
        expect(bole).toBeGreaterThan(0.5);
        expect(bole).toBeLessThan(2.0);
        expect(crown).toBeLessThan(bole);
    });

    it('mirrors a LinearMipmapLinear read of the mask (bilinear on each level, blended between them)', () => {
        const at = (lvl, u, v) => {
            const level = mask.mipmaps[lvl];
            const x = Math.floor(u * level.width);
            const y = Math.floor(v * level.height);
            return level.data[y * level.width + x] / 255;
        };
        // At a texel's centre a level reads back that texel.
        for (const lvl of [0, 3, 5]) {
            const w = mask.mipmaps[lvl].width;
            const u = (5 + 0.5) / w;
            const v = (2 + 0.5) / w;
            expect(sampleGapMask(mask, u, v, lvl)).toBeCloseTo(at(lvl, u, v), 6);
        }
        // Wraps: one tile along reads the same.
        expect(sampleGapMask(mask, 0.3, 0.7, 3.4)).toBeCloseTo(sampleGapMask(mask, 1.3, -0.3, 3.4), 6);
    });
});

describe('Rainbark light: the canopy\'s wind', () => {
    it('scales its reach with the flecks\' size: full at the Bole, less as they shrink toward the canopy', () => {
        const sunY = Math.sin(55 * (Math.PI / 180));
        expect(windScaleAt(56, sunY)).toBe(1);
        expect(windScaleAt(20, sunY)).toBe(1);
        expect(windScaleAt(152, sunY)).toBeLessThan(0.5);
        expect(windScaleAt(171, sunY)).toBeLessThanOrEqual(windScaleAt(152, sunY));
        expect(windScaleAt(171, sunY)).toBeGreaterThanOrEqual(CANOPY_WIND.least);
        const w = canopyWind(33.3);
        const half = canopyWind(33.3, [0, 0], 0.5);
        expect(half[0]).toBeCloseTo(w[0] / 2, 9);
        expect(half[1]).toBeCloseTo(w[1] / 2, 9);
    });

    it('is closed form in the clock (a seek lands on the same canopy) and stays within its reach', () => {
        const reach = CANOPY_WIND.x.reduce((s, [a]) => s + a, 0) + CANOPY_WIND.z.reduce((s, [a]) => s + a, 0)
            + CANOPY_WIND.gust.reach * 2;
        for (let t = 0; t < 600; t += 1.7) {
            const w = canopyWind(t);
            expect(canopyWind(t)).toEqual(w);
            expect(Math.hypot(w[0], w[1])).toBeLessThanOrEqual(reach);
        }
        expect(canopyWind(-5)).toEqual(canopyWind(0));
        expect(canopyWind(Number.NaN)).toEqual(canopyWind(0));
    });

    it('gusts every 15–25 s, each moving the canopy within 1.2 s and never jumping', () => {
        for (let n = 1; n < 60; n++) {
            const gap = gustTime(n + 1) - gustTime(n);
            expect(gap).toBeGreaterThanOrEqual(15);
            expect(gap).toBeLessThanOrEqual(25);
        }
        // Continuous: one frame at 120 Hz moves the canopy only a little, even mid-gust.
        let worst = 0;
        for (let t = 0; t < 300; t += 1 / 120) {
            const a = canopyWind(t);
            const b = canopyWind(t + 1 / 120);
            worst = Math.max(worst, Math.hypot(b[0] - a[0], b[1] - a[1]));
        }
        expect(worst).toBeLessThan(0.006);
        // A gust does move it: across one, the canopy stands somewhere new.
        const t1 = gustTime(3);
        const before = canopyWind(t1 - 0.05);
        const after = canopyWind(t1 + CANOPY_WIND.gust.length + 0.05);
        const waves = canopyWind(t1 + CANOPY_WIND.gust.length + 0.05);
        expect(Math.hypot(after[0] - before[0], after[1] - before[1])).toBeGreaterThan(0);
        expect(waves).toEqual(after);
    });

    it('never makes a point of bark flicker: under two fleck edges a second, gusts, pools and all (WCAG 2.3.1)', () => {
        /** The times a point's light swings from under `lo` to over `hi` or back (hysteresis). */
        const swings = (series, lo, hi) => {
            const out = [];
            let state = null;
            series.forEach(([t, v]) => {
                let now = state;
                if (v > hi) now = true;
                else if (v < lo) now = false;
                if (state !== null && now !== null && now !== state) out.push(t);
                if (now !== null) state = now;
            });
            return out;
        };
        /** At most `n` swings in any one-second window. */
        const atMost = (times, n, label) => {
            for (let i = n; i < times.length; i++) expect(times[i] - times[i - n], label).toBeGreaterThan(1);
        };
        for (const level of [1, 3, 4, 7, 9, 10, 12]) {
            const y = climbHeight(level);
            const { sunDir, thr } = lightAt(level);
            const scale = windScaleAt(y, sunDir[1]);
            // One open combo gap row (§6.6) over the first points: its pool drifts with the canopy.
            const dC = (CANOPY_Y - y) / sunDir[1];
            const gaps = [[0.2 + sunDir[0] * dC, -3 + sunDir[2] * dC, 1.2, 1]];
            for (let p = 0; p < 48; p++) {
                const x = p * 1.37 + 0.2;
                const z = -3 - p * 0.91;
                const series = [];
                for (let t = 0; t < 70; t += 1 / 60) {
                    const wind = canopyWind(t, [0, 0], scale);
                    series.push([t, fleckAt(mask, x, y, z, {
                        sunDir, wind, thr, gaps: p < 6 ? gaps : null,
                    })]);
                }
                // A full swing of the point's light (from under a fifth of a fleck's to over four
                // fifths, or back) at most twice a second; and a half swing (a point grazing a soft
                // rim, 0.35 ↔ 0.65) at most three times.
                atMost(swings(series, 0.2, 0.8), 2, `level ${level} point ${p} (full)`);
                atMost(swings(series, 0.35, 0.65), 3, `level ${level} point ${p} (half)`);
            }
        }
    });

    it('pools a combo gap\'s light where its pinhole image falls, max-combined with the flecks', () => {
        const level = 4;
        const y = climbHeight(level);
        const { sunDir, thr } = lightAt(level);
        const dC = (CANOPY_Y - y) / sunDir[1];
        const wind = [0, 0];
        const gap = [5 + sunDir[0] * dC, -7 + sunDir[2] * dC, 1.5, 1];
        const inPool = fleckAt(mask, 5, y, -7, {
            sunDir, wind, thr, gaps: [gap],
        });
        expect(inPool).toBeCloseTo(FLECK.pools, 6);
        // Far from it the gap changes nothing; shut, it changes nothing anywhere.
        const off = fleckAt(mask, 25, y, -30, { sunDir, wind, thr });
        expect(fleckAt(mask, 25, y, -30, {
            sunDir, wind, thr, gaps: [gap],
        })).toBe(off);
        expect(fleckAt(mask, 5, y, -7, {
            sunDir, wind, thr, gaps: [[gap[0], gap[1], 1.5, 0]],
        }))
            .toBe(fleckAt(mask, 5, y, -7, { sunDir, wind, thr }));
    });
});

describe('Rainbark light: the shafts', () => {
    it('stand their ambient shafts in the open air on the right of the 16:9 rest frame, slanting down-left', () => {
        const lens = restLens(16 / 9);
        const eye = 56;
        const sun = sunDirection(55);
        AMBIENT_SHAFTS.forEach((s) => {
            const at = projectRest(lens, s.x, eye + s.rise, s.z, eye);
            expect(at[0]).toBeGreaterThan(0.6);
            expect(at[0]).toBeLessThan(1.05);
            // Down the ray (away from the sun) the shaft runs left on screen and down.
            const d = 20;
            const below = projectRest(lens, s.x - sun[0] * d, eye + s.rise - sun[1] * d, s.z - sun[2] * d, eye);
            expect(below[0]).toBeLessThan(at[0]);
            expect(below[1]).toBeGreaterThan(at[1]);
            expect(s.width).toBeGreaterThan(1);
        });
        expect(AMBIENT_SHAFTS).toHaveLength(3);
        expect(EVENT_SLOTS.gaps).toBe(7);
    });
});

describe('Rainbark light: in the world', () => {
    it('builds the shafts for the tiers that have them, and writes the gobo\'s light every frame', async () => {
        const THREE = await import('three/webgpu');
        const { RainbarkWorld } = await import('../../src/themes/rainbark/rainbark-world.js');
        const { QUALITY } = await import('../../src/themes/rainbark/rainbark-quality.js');
        const { shaftRecords } = await import('../../src/themes/rainbark/rainbark-fx.js');
        for (const quality of ['Minimal', 'Low', 'Medium', 'High']) {
            const tier = QUALITY[quality];
            const scene = new THREE.Scene();
            const world = new RainbarkWorld({ scene, quality, capture: true }).build();
            const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 3000);
            world.setViewport(1920, 1080, 16 / 9, 1920, 1080);
            world.levelUp(4, { silent: true });
            const sim = {
                time: 55, delta: 0, pointerX: 0, pointerY: 0,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
            const { fx } = world.parts;
            const wanted = tier.shaftsAmbient + tier.shaftsCombo;
            // (Every tier has the drops: the Sunshower's rain; a tier without shafts builds none.)
            expect(fx.drops.count).toBe(tier.drops);
            if (wanted === 0) {
                expect(fx.shafts).toBeNull();
            } else {
                expect(fx.shafts.ambient).toBe(tier.shaftsAmbient);
                expect(fx.shafts.combo).toBe(tier.shaftsCombo);
                expect(fx.shafts.geometry.instanceCount).toBe(wanted);
                expect(fx.shafts.mesh.renderOrder).toBeGreaterThan(65);
            }
            const records = shaftRecords(tier.shaftsAmbient, tier.shaftsCombo);
            expect(records.data).toHaveLength(wanted * 8);
            // The gobo's light: the wind of the clock, the storey's calibration, the tide's gain.
            const { u } = world;
            const sunY = u.sunDir.value.y;
            const wind = canopyWind(55, [0, 0], windScaleAt(56, sunY));
            expect(u.wind.value.x).toBeCloseTo(wind[0], 6);
            expect(u.wind.value.y).toBeCloseTo(wind[1], 6);
            expect(u.fleckThr.value).toBeCloseTo(storeyFleck(mask, 4).thr, 6);
            expect(u.fleckMean.value).toBeCloseTo(storeyFleck(mask, 4).mean, 6);
            expect(u.fleckLight.value).toBeGreaterThan(0.5);
            expect(u.fleckLod.value).toBeCloseTo(fleckLodAt(56, sunY), 6);
            world.dispose();
        }
    });
});

describe('Rainbark light: the pearly zones and the canopy\'s reads', () => {
    it('marks only the Fog Line (and the Mistfall look) pearly, and writes it into the shade row', async () => {
        const { MISTFALL, PALETTE_ROWS, ZONE_COLOR_KEYS } = await import('../../src/themes/rainbark/rainbark-core.js');
        const { writeZoneColors } = await import('../../src/themes/rainbark/rainbark-tsl.js');
        expect(ZONES.map((zone) => zone.pearl)).toEqual([0, 0, 1, 0, 0]);
        expect(ZONES[2].name).toBe('Fog Line');
        expect(MISTFALL.pearl).toBe(1);
        const table = Array.from({ length: PALETTE_ROWS.total }, () => ({
            v: [0, 0, 0, 0],
            set(x, y, z, w) { this.v = [x, y, z, w]; },
        }));
        writeZoneColors(table, ZONES[2].colors, ZONES[2].pearl);
        ZONE_COLOR_KEYS.forEach((key) => {
            expect(table[PALETTE_ROWS[key]].v[3], key).toBe(1);
        });
        writeZoneColors(table, ZONES[1].colors, ZONES[1].pearl);
        expect(table[PALETTE_ROWS.hazeShade].v[3]).toBe(0);
        expect(table[PALETTE_ROWS.sky].v[3]).toBe(1);
    });

    it('crossfades the pearl over the Climb and lays the Mistfall look over it', async () => {
        const THREE = await import('three/webgpu');
        const { RainbarkWorld } = await import('../../src/themes/rainbark/rainbark-world.js');
        const { PALETTE_ROWS } = await import('../../src/themes/rainbark/rainbark-core.js');
        const world = new RainbarkWorld({ scene: new THREE.Scene(), quality: 'Low', capture: true }).build();
        const pearl = () => world.u.tables.palette[PALETTE_ROWS.hazeShade].w;
        world.writePalette({ a: 1, b: 2, mix: 0 }, 0);
        expect(pearl()).toBe(0);
        world.writePalette({ a: 1, b: 2, mix: 0.25 }, 0);
        expect(pearl()).toBeCloseTo(0.25, 6);
        world.writePalette({ a: 2, b: 3, mix: 0 }, 0);
        expect(pearl()).toBe(1);
        world.writePalette({ a: 3, b: 4, mix: 0.5 }, 0.5);
        expect(pearl()).toBeCloseTo(0.5, 6);
        // Every other zone row keeps w = 1.
        expect(world.u.tables.palette[PALETTE_ROWS.sky].w).toBe(1);
        world.dispose();
    });

    it('reads the canopy on the lite path on Low and Minimal only (fewer taps, the whole picture)', async () => {
        const { QUALITY, QUALITY_NAMES } = await import('../../src/themes/rainbark/rainbark-quality.js');
        QUALITY_NAMES.forEach((name) => {
            expect(QUALITY[name].canopy, name).toBe(name === 'Minimal' || name === 'Low' ? 'lite' : 'full');
        });
    });
});
