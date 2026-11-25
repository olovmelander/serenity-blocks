/**
 * Chapter 8, the 2026-11-25 rebuild of its walls: the facade's bays, the forms a tower takes and
 * the parts that carry its top, the walls' kit (clear of the signs, on the facade's own bays), the
 * wall glow map, and the wheel by the end of the line (where the rail can see it). Pure plans; the
 * materials are built to WGSL by urban-neon-shaders.test.js, which walks every material.
 */
import { describe, expect, it } from 'vitest';
import {
    NEON_FACADE_MODULE, NEON_GEAR_KIND, NEON_PART, NEON_PART_PAD, NEON_PART_TOP, facadeBays, neonPartKind,
    planNeonArchitecture,
} from './shared/odyssey-neon-architecture.js';
import {
    NEON_WALL_GLOW, STREET_Y, bakeNeonWallGlow, dealCityTowers, planNeonSigns,
} from './shared/odyssey-neon-city-plan.js';
import { NEON_KIT_KIND, NEON_WALL_KIT, planNeonWallKit } from './shared/odyssey-neon-wall-kit.js';
import { seatNeonSkybridges } from './shared/odyssey-neon-skybridges.tsl.js';
import { NEON_WHEEL } from './shared/odyssey-neon-wheel.tsl.js';
import { NEON_GEAR } from './shared/odyssey-neon-rooftops.tsl.js';
import { CH8_WET_STREET_SETTINGS } from './urban-dreams.tsl.js';
import { getOdysseyPathCurve } from '../path-utils.js';
import { createUrbanDreamsEnvironment } from './urban-dreams.js';

const towers = dealCityTowers(6);
const { signs } = planNeonSigns(towers);
const plan = planNeonArchitecture(towers, signs);
const bridges = seatNeonSkybridges(towers);
const kit = planNeonWallKit(plan.bases, signs, bridges);

describe("chapter 8: a wall's bays", () => {
    it('fits a whole number of bays between two solid corners, on every style and width', () => {
        for (let style = 0; style < 4; style += 1) {
            for (let faceW = 4; faceW <= 40; faceW += 0.7) {
                const {
                    corner, bays, bayW, storey,
                } = facadeBays(style, faceW);
                expect(Number.isInteger(bays)).toBe(true);
                expect(bays).toBeGreaterThanOrEqual(1);
                expect((2 * corner) + (bays * bayW)).toBeCloseTo(faceW, 9);
                // A bay never strays far from the width its style aims for.
                if (bays > 1) expect(Math.abs(bayW - NEON_FACADE_MODULE.bay[style])).toBeLessThan(NEON_FACADE_MODULE.bay[style] * 0.35);
                expect(storey).toBe(NEON_FACADE_MODULE.storey[style]);
            }
        }
        // The glass sits back in every wall, deepest behind the stone piers.
        NEON_FACADE_MODULE.recess.forEach((depth) => expect(depth).toBeGreaterThan(0.05));
        expect(Math.max(...NEON_FACADE_MODULE.recess)).toBe(NEON_FACADE_MODULE.recess[3]);
    });
});

describe("chapter 8: a tower's form", () => {
    it('gives the towers many forms: slabs side by side, shafts off their base, drums', () => {
        const bodies = plan.tiers.filter((tier) => neonPartKind(tier.part) === NEON_PART.body);
        const tiersOf = (base) => bodies.filter((tier) => tier.seed === base.seed && tier.base >= base.height - 1e-6
            && tier.base < base.height + 1e-6);
        const stepped = plan.bases.filter((base) => base.height < base.fullHeight - 1);
        // Twins: two bodies stand on one base.
        expect(stepped.filter((base) => tiersOf(base).length === 2).length).toBeGreaterThan(8);
        // Offsets and slender shafts: the body that stands on the base is not centred on it.
        const off = stepped.filter((base) => {
            const on = tiersOf(base);
            return on.length === 1 && (Math.abs(on[0].x - base.x) > 0.5 || Math.abs(on[0].z - base.z) > 0.5);
        });
        expect(off.length).toBeGreaterThan(20);
        // Drums: round parts, each inside the base it stands on, none hanging in the air.
        expect(plan.rounds.length).toBeGreaterThan(12);
        plan.rounds.forEach((drum) => {
            expect(neonPartKind(drum.part)).toBe(NEON_PART.round);
            expect(drum.width).toBeCloseTo(drum.depth, 9);
            const host = plan.bases.find((base) => base.seed === drum.seed
                && Math.abs(base.x - drum.x) < base.width && Math.abs(base.z - drum.z) < base.depth);
            expect(host).toBeTruthy();
            expect(Math.abs(drum.x - host.x) + (drum.width * 0.5)).toBeLessThanOrEqual((host.width * 0.5) + 1e-6);
            expect(Math.abs(drum.z - host.z) + (drum.depth * 0.5)).toBeLessThanOrEqual((host.depth * 0.5) + 1e-6);
            expect(drum.base).toBeGreaterThanOrEqual(host.height - 1e-6);
            expect(drum.height).toBeGreaterThan(3);
        });
    });

    it('marks the part that carries each top, and keeps a helipad clear', () => {
        const parts = [...plan.bases, ...plan.tiers, ...plan.rounds];
        const isTop = (part) => Math.floor(part.part / NEON_PART_TOP) % 2 === 1;
        // Every tower has a top; a tower of two slabs has two.
        plan.bases.forEach((base) => {
            const mine = parts.filter((part) => part.seed === base.seed && isTop(part)
                && Math.abs(part.x - base.x) < base.width && Math.abs(part.z - base.z) < base.depth);
            expect(mine.length).toBeGreaterThanOrEqual(1);
            expect(mine.length).toBeLessThanOrEqual(2);
            // A top reaches the tower's full height (the lower of two slabs comes within 18 u of it).
            mine.forEach((part) => {
                const top = part.base + part.height;
                expect(top).toBeLessThanOrEqual(base.fullHeight + 1e-6);
                expect(top).toBeGreaterThan(base.fullHeight - 18.5);
            });
        });
        // Ledges never carry a top.
        plan.tiers.filter((tier) => neonPartKind(tier.part) === NEON_PART.ledge)
            .forEach((ledge) => expect(ledge.part).toBe(NEON_PART.ledge));
        // A helipad: on a tall flat top, with no mast, fin or cap standing on it.
        const pads = parts.filter((part) => part.part >= NEON_PART_PAD);
        expect(pads.length).toBeGreaterThanOrEqual(1);
        pads.forEach((pad) => {
            expect(isTop(pad)).toBe(true);
            expect(pad.base + pad.height).toBeGreaterThan(110);
            const onIt = (item) => Math.abs(item.x - pad.x) < (pad.width * 0.5) - 0.5 && Math.abs(item.z - pad.z) < (pad.depth * 0.5) - 0.5
                && item.y > STREET_Y + pad.base + pad.height - 1;
            expect([...plan.gear.boxes, ...plan.gear.pyramids, ...plan.gear.tanks].filter(onIt)).toHaveLength(0);
        });
        // The roofs carry ducts and the tall crowns fins, beside the masts and air handlers.
        const kinds = new Set(plan.gear.boxes.map((box) => box.kind));
        [NEON_GEAR_KIND.leg, NEON_GEAR_KIND.mast, NEON_GEAR_KIND.unit, NEON_GEAR_KIND.duct, NEON_GEAR_KIND.fin]
            .forEach((kind) => expect(kinds.has(kind)).toBe(true));
    });
});

describe("chapter 8: the walls' kit", () => {
    const K = NEON_KIT_KIND;
    const inner = plan.bases.filter((base) => base.bank === 0 && base.z <= NEON_WALL_KIT.zNear && base.z >= NEON_WALL_KIT.zFar);
    /** The inner tower whose boulevard wall a box hangs on. */
    const hostOf = (box) => inner.find((base) => Math.sign(base.x) === Math.sign(box.x)
        && Math.abs(box.z - base.z) <= (base.depth * 0.5) + 0.01);

    it('hangs balconies, air units, pipes, fire escapes and awnings on the boulevard walls', () => {
        const count = (kind) => kit.boxes.filter((box) => box.kind === kind).length;
        expect(count(K.slab)).toBeGreaterThan(150);
        expect(count(K.front)).toBe(count(K.slab));
        expect(count(K.wallUnit)).toBeGreaterThan(120);
        expect(count(K.pipe)).toBeGreaterThan(25);
        expect(count(K.landing)).toBeGreaterThan(40);
        expect(count(K.awning)).toBeGreaterThan(50);
        expect(count(K.post)).toBeGreaterThan(60);
        // The gear shader knows every kind the kit and the roofs use.
        const known = new Set(Object.values(NEON_GEAR));
        kit.boxes.forEach((box) => expect(known.has(box.kind)).toBe(true));
        expect(planNeonWallKit(plan.bases, signs, bridges)).toEqual(kit);
        kit.boxes.forEach((box) => {
            [box.x, box.y, box.z, box.width, box.height, box.depth].forEach((v) => expect(Number.isFinite(v)).toBe(true));
            expect(box.width).toBeGreaterThan(0);
            expect(box.height).toBeGreaterThan(0);
            expect(box.depth).toBeGreaterThan(0);
            expect(box.y - (box.height * 0.5)).toBeGreaterThanOrEqual(STREET_Y - 1e-6);
        });
    });

    it('stands what it hangs on a wall against that wall, under its parapet, off the rail', () => {
        const hung = kit.boxes.filter((box) => [K.slab, K.front, K.wallUnit, K.pipe, K.landing, K.awning, K.bracket].includes(box.kind));
        hung.forEach((box) => {
            const host = hostOf(box);
            expect(host, `${box.kind} at z ${box.z}`).toBeTruthy();
            const wall = Math.abs(host.x) - (host.width * 0.5);
            // From the wall's face out toward the lane, never as far as the kerb lamps.
            expect(Math.abs(box.x) + (box.width * 0.5)).toBeLessThanOrEqual(wall + 0.01);
            expect(Math.abs(box.x) - (box.width * 0.5)).toBeGreaterThan(wall - 1.7);
            expect(box.y + (box.height * 0.5)).toBeLessThan(STREET_Y + host.height);
            // The rail and its orbs ride the middle of the lane (|x| under ~12).
            expect(Math.abs(box.x) - (box.width * 0.5)).toBeGreaterThan(20);
        });
    });

    it('keeps balconies, air units and fire escapes clear of the signs and the skybridges', () => {
        const solid = kit.boxes.filter((box) => [K.slab, K.wallUnit, K.landing].includes(box.kind));
        const overlaps = (box, zLo, zHi, yLo, yHi) => box.z - (box.depth * 0.5) < zHi && box.z + (box.depth * 0.5) > zLo
            && box.y - (box.height * 0.5) < yHi && box.y + (box.height * 0.5) > yLo;
        solid.forEach((box) => {
            signs.filter((sign) => !sign.roof && Math.sign(sign.x) === Math.sign(box.x) && sign.kind !== 3).forEach((sign) => {
                const blade = (sign.facing ?? 0) === 0;
                const halfZ = blade ? 0.6 : sign.w * 0.5;
                expect(overlaps(box, sign.z - halfZ, sign.z + halfZ, sign.y - (sign.h * 0.5), sign.y + (sign.h * 0.5)), `kind ${box.kind} over ${sign.text}`)
                    .toBe(false);
            });
            bridges.forEach((bridge) => expect(overlaps(box, bridge.z - 4, bridge.z + 4, bridge.y - 3, bridge.y + 3)).toBe(false));
        });
        // Every blade sign hangs from two arms that reach its wall.
        const blades = signs.filter((sign) => !sign.roof && sign.vertical && (sign.facing ?? 0) === 0
            && sign.z <= NEON_WALL_KIT.zNear - 12 && sign.z >= NEON_WALL_KIT.zFar + 12);
        expect(blades.length).toBeGreaterThan(20);
        blades.forEach((sign) => {
            const arms = kit.boxes.filter((box) => box.kind === K.bracket && Math.abs(box.z - sign.z) < 0.5
                && Math.sign(box.x) === Math.sign(sign.x) && Math.abs(box.y - sign.y) < sign.h * 0.5);
            expect(arms.length, sign.text ?? 'glyphs').toBe(2);
        });
    });

    it('stands a balcony on a storey and a bay of its own wall', () => {
        kit.boxes.filter((box) => box.kind === K.slab).forEach((slab) => {
            const host = hostOf(slab);
            const {
                corner, bays, bayW, storey,
            } = facadeBays(host.style, host.depth);
            const floors = (slab.y - 0.06 - STREET_Y) / storey;
            expect(floors).toBeCloseTo(Math.round(floors), 6);
            // It spans one bay or two, between two bay lines.
            const from = (slab.z - (slab.depth * 0.5) - (host.z - (host.depth * 0.5) + corner)) / bayW;
            expect(from - Math.floor(from)).toBeCloseTo(0.12 / bayW, 6);
            expect([1, 2]).toContain(Math.round((slab.depth + 0.24) / bayW));
            expect(Math.floor(from) + Math.round((slab.depth + 0.24) / bayW)).toBeLessThanOrEqual(bays);
        });
    });

    it('lights the kerbs where the street paints the lamps\' pools, on the pavement', () => {
        const lamps = kit.boxes.filter((box) => box.kind === K.lamp && box.y < STREET_Y + NEON_WALL_KIT.lampHeight + 0.1 && box.y > STREET_Y + 5);
        expect(lamps.length).toBeGreaterThan(40);
        lamps.forEach((lamp) => {
            expect(Math.abs(lamp.x)).toBeCloseTo(NEON_WALL_KIT.lampX - NEON_WALL_KIT.lampReach, 6);
            // Over the road's edge: past the last traffic lane, short of the walk's far side.
            expect(Math.abs(lamp.x)).toBeGreaterThan(CH8_WET_STREET_SETTINGS.lanes[2] + 2);
            expect(Math.abs(lamp.x)).toBeLessThan(CH8_WET_STREET_SETTINGS.walkHalf);
            const phase = (lamp.z - (Math.sign(lamp.x) * NEON_WALL_KIT.lampStagger) - NEON_WALL_KIT.zNear) / NEON_WALL_KIT.lampEvery;
            expect(phase).toBeCloseTo(Math.round(phase), 6);
        });
    });
});

describe('chapter 8: the wall glow map', () => {
    const W = NEON_WALL_GLOW;
    const glow = bakeNeonWallGlow(signs);
    const at = (right, z, y) => {
        const i = Math.min(W.texels - 1, Math.max(0, Math.floor(((z - W.z0) / (W.z1 - W.z0)) * W.texels)));
        const j = Math.min(W.rows - 1, Math.max(0, Math.floor((y / W.height) * W.rows)));
        const o = ((((right * W.rows) + j) * W.texels) + i) * 4;
        return [glow[o], glow[o + 1], glow[o + 2]];
    };

    it('is finite, never negative, and bounded', () => {
        expect(glow).toHaveLength(W.texels * W.rows * 2 * 4);
        let peak = 0;
        for (let i = 0; i < glow.length; i += 1) {
            expect(Number.isFinite(glow[i])).toBe(true);
            expect(glow[i]).toBeGreaterThanOrEqual(0);
            if (i % 4 !== 3) peak = Math.max(peak, glow[i]);
        }
        expect(peak).toBeGreaterThan(0.4);
        expect(peak).toBeLessThan(4);
    });

    it("pools each blade's colour on its own wall, round it, and leaves the other wall and the far wall dark", () => {
        const blades = signs.filter((sign) => !sign.roof && sign.vertical && (sign.facing ?? 0) === 0);
        expect(blades.length).toBeGreaterThan(40);
        blades.forEach((sign) => {
            const right = sign.x > 0 ? 1 : 0;
            const here = at(right, sign.z, sign.y - STREET_Y);
            const lum = here[0] + here[1] + here[2];
            expect(lum).toBeGreaterThan(0.25);
            // Its strongest channel is the sign's own.
            const k = sign.rgb.indexOf(Math.max(...sign.rgb));
            expect(here[k]).toBeGreaterThan(0.12);
        });
        // High over the signs (they hang to about the eye's height) the walls are dark.
        for (let z = -500; z < 60; z += 13) {
            [0, 1].forEach((right) => {
                const high = at(right, z, W.height - 2);
                expect(high[0] + high[1] + high[2]).toBeLessThan(0.05);
            });
        }
        // Past the signs' span nothing is lit.
        const far = at(0, W.z0 + 20, 20);
        expect(far[0] + far[1] + far[2]).toBe(0);
    });
});

describe('chapter 8: the wheel by the end of the line', () => {
    const W = NEON_WHEEL;
    const [hx, hy, hz] = W.hub;

    it('stands on a low roof of the left wall, a block past the end of the rail', () => {
        const under = towers.filter((tower) => Math.abs(tower.x - hx) < tower.width * 0.5 && Math.abs(tower.z - hz) < tower.depth * 0.5);
        expect(under).toHaveLength(1);
        expect(under[0].bank).toBe(0);
        expect(under[0].side).toBe(-1);
        const roof = STREET_Y + under[0].height;
        // The rim clears the roof it stands over; the legs reach down to it.
        expect(hy - W.radius).toBeGreaterThan(roof);
        expect(hy - (W.under * W.radius)).toBeLessThanOrEqual(roof + 0.5);
        // Clear of the rail and its orbs, which ride the middle of the lane.
        expect(Math.abs(hx) - W.radius).toBeGreaterThan(20);
        const group = createUrbanDreamsEnvironment({ qualityTier: 'Low' });
        const { corridor, wheel } = group.userData;
        expect(wheel.name).toBe('neon-wheel');
        corridor.updateWorldMatrix(true, false);
        const railEnd = corridor.worldToLocal(getOdysseyPathCurve().getPointAt(1));
        expect(hz).toBeLessThan(railEnd.z - 40);
        expect(hz).toBeGreaterThan(railEnd.z - 120);
    });

    it('is seen from the rail\'s last stretch past the towers between', () => {
        const blocked = (eye, point) => {
            const d = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
            return towers.some((tower) => {
                const lo = [tower.x - (tower.width * 0.5), STREET_Y, tower.z - (tower.depth * 0.5)];
                const hi = [tower.x + (tower.width * 0.5), STREET_Y + tower.height, tower.z + (tower.depth * 0.5)];
                let t0 = 0;
                let t1 = 1;
                for (let k = 0; k < 3; k += 1) {
                    const a = (lo[k] - eye[k]) / d[k];
                    const b = (hi[k] - eye[k]) / d[k];
                    t0 = Math.max(t0, Math.min(a, b));
                    t1 = Math.min(t1, Math.max(a, b));
                    if (t0 > t1) return false;
                }
                return true;
            });
        };
        // The eye in the city's frame at p 0.995, on arriving at orb 60 and in its close-up
        // (probed in the game, 2026-11-25).
        [[1.9, 9.1, -55.6], [-0.8, 16.2, -83.7], [6.4, 1, -115.2]].forEach((eye) => {
            expect(blocked(eye, [hx, hy, hz])).toBe(false);
            let seen = 0;
            for (let a = 0; a < 64; a += 1) {
                const angle = (a / 64) * Math.PI * 2;
                if (!blocked(eye, [hx + (Math.cos(angle) * W.radius), hy + (Math.sin(angle) * W.radius), hz])) seen += 1;
            }
            // The upper half and more of the rim; the foot stands behind the wall's own roofs.
            expect(seen / 64).toBeGreaterThan(0.5);
        });
    });
});
