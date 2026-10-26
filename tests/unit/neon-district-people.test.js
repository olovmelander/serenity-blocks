/**
 * Neon District's shop people: the tables the shop shader reads (neon-district-people.js) agree
 * with the baked sprite sheet (neon-district-people-atlas.js, written by
 * scripts/blender/neon_district_people.py), and every walk is paired with its turn clip.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import path from 'path';
import { SHOP_ARCHETYPES } from '../../src/themes/neon-district/neon-district-campaigns.js';
import { PEOPLE_CLIPS, PEOPLE_SHEET, PEOPLE_VIEWS } from '../../src/themes/neon-district/neon-district-people-atlas.js';
import {
    ARCH_ROLES, PEOPLE_TABLE, PEOPLE_TIMING, ROLE, ROLE_CLIPS, SPOT, STAFF_ROLES, WORK_STEP,
} from '../../src/themes/neon-district/neon-district-people.js';

const CLIP_NAMES = Object.keys(PEOPLE_CLIPS);
const VIEW_NAMES = Object.keys(PEOPLE_VIEWS);
const MAX_SHEET_SIDE = 4096;

describe('neon-district people sheet', () => {
    it('ships both sprite sheets, within every GPU\'s texture size', () => {
        for (const url of [PEOPLE_SHEET.url, PEOPLE_SHEET.maskUrl]) {
            expect(existsSync(path.join('public', url.replace(/^\.\//, '')))).toBe(true);
        }
        expect(PEOPLE_SHEET.columns * PEOPLE_SHEET.cellPixels[0]).toBeLessThanOrEqual(MAX_SHEET_SIDE);
        expect(PEOPLE_SHEET.rows * PEOPLE_SHEET.cellPixels[1]).toBeLessThanOrEqual(MAX_SHEET_SIDE);
        expect(PEOPLE_SHEET.rows % 2).toBe(0);
    });

    it('lays every clip out inside the sheet without overlaps', () => {
        const used = new Set();
        for (const name of CLIP_NAMES) {
            const clip = PEOPLE_CLIPS[name];
            const views = PEOPLE_VIEWS[clip.views];
            expect(views, name).toBeDefined();
            for (let cell = clip.base; cell < clip.base + clip.frames * views.angles.length; cell++) {
                expect(used.has(cell), `${name} cell ${cell}`).toBe(false);
                used.add(cell);
            }
        }
        expect(used.size).toBe(PEOPLE_SHEET.cells);
        expect(Math.max(...used)).toBeLessThan(PEOPLE_SHEET.columns * PEOPLE_SHEET.rows);
    });

    it('draws every view set in order, the turns from both sides', () => {
        for (const name of VIEW_NAMES) {
            const { angles, signed } = PEOPLE_VIEWS[name];
            expect(angles.length).toBeGreaterThanOrEqual(2);
            expect(angles.length).toBeLessThanOrEqual(5);
            angles.slice(1).forEach((a, k) => expect(a, name).toBeGreaterThan(angles[k]));
            if (signed) expect(angles[0] * angles[angles.length - 1]).toBeLessThan(0);
            else angles.forEach((a) => expect(a).toBeGreaterThanOrEqual(0));
        }
    });

    it('times every clip', () => {
        for (const name of CLIP_NAMES) {
            const clip = PEOPLE_CLIPS[name];
            if (clip.timing === 'distance') expect(clip.metres, name).toBeGreaterThan(0.5);
            else if (clip.timing === 'loop') expect(clip.seconds, name).toBeGreaterThan(0.3);
            else if (clip.timing === 'turn') {
                const {
                    nIn, nHold, nOut, tIn, tOut, tBrake,
                } = clip.turn;
                expect(nIn + nHold + nOut, name).toBe(clip.frames);
                expect(tBrake).toBeLessThan(tIn);
                expect(tBrake).toBeLessThan(tOut);
                // Braking over half a step at the walk's speed: the shader's travel law.
                const speed = clip.metres / clip.seconds;
                expect(speed * tBrake * 0.5).toBeCloseTo(clip.metres / 4, 3);
            } else expect(clip.timing, name).toBe('level');
        }
    });

    it('pairs every walk with its turn, at the same stride and speed', () => {
        const walks = ROLE_CLIPS[ROLE.walker];
        expect(walks.length).toBeGreaterThanOrEqual(4);
        for (const walk of walks) {
            const turn = CLIP_NAMES[CLIP_NAMES.indexOf(walk) + 1];
            expect(turn, walk).toBe(walk.replace(/^walk/, 'turn'));
            expect(PEOPLE_CLIPS[turn].metres).toBe(PEOPLE_CLIPS[walk].metres);
            expect(PEOPLE_CLIPS[turn].seconds).toBe(PEOPLE_CLIPS[walk].seconds);
            expect(PEOPLE_CLIPS[walk].views).toBe('side');
            expect(PEOPLE_VIEWS[PEOPLE_CLIPS[turn].views].signed).toBe(true);
        }
    });
});

describe('neon-district people roles', () => {
    const { rows, at } = PEOPLE_TABLE;

    it('gives every trade its four slots', () => {
        expect(ARCH_ROLES.back).toHaveLength(SHOP_ARCHETYPES.length);
        expect(ARCH_ROLES.front).toHaveLength(SHOP_ARCHETYPES.length);
        SHOP_ARCHETYPES.forEach((_, i) => {
            expect(rows[at.arch + i]).toEqual([...ARCH_ROLES.back[i], ...ARCH_ROLES.front[i]]);
        });
    });

    it('maps every role a trade uses to its characters, depth and spot', () => {
        const roles = new Set([...ARCH_ROLES.back.flat(), ...ARCH_ROLES.front.flat()]);
        roles.delete(ROLE.none);
        for (const role of roles) {
            const [first, depth, back, spot] = rows[at.role + role * 2];
            const [count, stride, staff] = rows[at.role + role * 2 + 1];
            expect(count, `role ${role}`).toBe(ROLE_CLIPS[role].length);
            expect(staff).toBe(STAFF_ROLES.includes(role) ? 1 : 0);
            expect(depth).toBeGreaterThan(0.1);
            expect(depth).toBeLessThan(0.95);
            expect([0, 1]).toContain(back);
            expect(Object.values(SPOT)).toContain(spot);
            for (let k = 0; k < count; k++) {
                const name = CLIP_NAMES[first + k * stride];
                expect(name, `role ${role}`).toBe(ROLE_CLIPS[role][k]);
                // A role facing the back wall plays clips drawn from behind, and the other way round.
                if (role !== ROLE.walker) expect(PEOPLE_CLIPS[name].views, name).toBe(back ? 'back' : 'front');
            }
        }
        expect(CLIP_NAMES[WORK_STEP]).toBe('workStep');
    });

    it('casts more than one character in the roles seen most', () => {
        for (const role of [ROLE.walker, ROLE.waiting, ROLE.shopper, ROLE.player, ROLE.diner, ROLE.patron, ROLE.looker]) {
            expect(ROLE_CLIPS[role].length, `role ${role}`).toBeGreaterThan(1);
        }
    });

    it('stands the people at the back behind the counter and the rest in front of it', () => {
        const counter = 0.42;
        ARCH_ROLES.back.flat().filter((r) => r !== ROLE.none).forEach((role) => {
            expect(rows[at.role + role * 2][1], `role ${role}`).toBeGreaterThan(counter);
        });
        ARCH_ROLES.front.flat().filter((r) => r !== ROLE.none).forEach((role) => {
            expect(rows[at.role + role * 2][1], `role ${role}`).toBeLessThan(counter);
        });
    });

    it('copies each view set and clip into its table rows', () => {
        VIEW_NAMES.forEach((name, v) => {
            const { angles, signed } = PEOPLE_VIEWS[name];
            const flat = [...rows[at.views + v * 2], ...rows[at.views + v * 2 + 1]];
            expect(flat.slice(0, angles.length)).toEqual(angles);
            expect(flat[5]).toBe(angles.length);
            expect(flat[6]).toBe(signed ? 1 : 0);
        });
        CLIP_NAMES.forEach((name, c) => {
            const clip = PEOPLE_CLIPS[name];
            expect(rows[at.clip + c * 3]).toEqual([clip.base, clip.frames, VIEW_NAMES.indexOf(clip.views),
                PEOPLE_TIMING[clip.timing]]);
            if (clip.turn) {
                expect(rows[at.clip + c * 3 + 1].slice(2)).toEqual([clip.turn.nIn, clip.turn.nHold]);
                expect(rows[at.clip + c * 3 + 2]).toEqual([clip.turn.nOut, clip.turn.tIn, clip.turn.tOut,
                    clip.turn.tBrake]);
            }
        });
    });

    it('keeps every palette colour in range', () => {
        Object.values(at.palette).forEach(({ base, count }) => {
            for (let i = base; i < base + count; i++) {
                rows[i].slice(0, 3).forEach((v) => {
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(1);
                });
            }
        });
    });

    it('fits the table in one uniform buffer', () => {
        expect(rows.length * 16).toBeLessThan(16 * 1024);
    });
});
