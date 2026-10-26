/**
 * Neon District's shop people: the tables the shop shader reads (neon-district-people.js) agree
 * with the baked sprite sheet (neon-district-people-atlas.js, written by
 * scripts/blender/neon_district_people.py).
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import path from 'path';
import { SHOP_ARCHETYPES } from '../../src/themes/neon-district/neon-district-campaigns.js';
import { PEOPLE_CLIPS, PEOPLE_SHEET, PEOPLE_VIEWS } from '../../src/themes/neon-district/neon-district-people-atlas.js';
import {
    ARCH_ROLES, PEOPLE_TABLE, ROLE, SPOT, WALK_B,
} from '../../src/themes/neon-district/neon-district-people.js';

const CLIP_NAMES = Object.keys(PEOPLE_CLIPS);

describe('neon-district people sheet', () => {
    it('ships both sprite sheets', () => {
        for (const url of [PEOPLE_SHEET.url, PEOPLE_SHEET.maskUrl]) {
            expect(existsSync(path.join('public', url.replace(/^\.\//, '')))).toBe(true);
        }
    });

    it('lays every clip out inside the sheet without overlaps', () => {
        const used = new Set();
        for (const name of CLIP_NAMES) {
            const clip = PEOPLE_CLIPS[name];
            const views = PEOPLE_VIEWS[clip.views];
            expect(views, name).toBeDefined();
            for (let cell = clip.base; cell < clip.base + clip.frames * views.count; cell++) {
                expect(used.has(cell), `${name} cell ${cell}`).toBe(false);
                used.add(cell);
            }
        }
        expect(used.size).toBe(PEOPLE_SHEET.cells);
        expect(Math.max(...used)).toBeLessThan(PEOPLE_SHEET.columns * PEOPLE_SHEET.rows);
    });

    it('times every clip', () => {
        for (const name of CLIP_NAMES) {
            const clip = PEOPLE_CLIPS[name];
            if (clip.timing === 'distance') expect(clip.metres, name).toBeGreaterThan(0.5);
            else if (clip.timing === 'loop') expect(clip.seconds, name).toBeGreaterThan(0.3);
            else expect(clip.timing, name).toBe('level');
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

    it('maps every role a trade uses to a real clip, depth and spot', () => {
        const roles = new Set([...ARCH_ROLES.back.flat(), ...ARCH_ROLES.front.flat()]);
        roles.delete(ROLE.none);
        for (const role of roles) {
            const [clip, depth, back, spot] = rows[at.role + role];
            expect(CLIP_NAMES[clip], `role ${role}`).toBeDefined();
            expect(depth).toBeGreaterThan(0.1);
            expect(depth).toBeLessThan(0.95);
            expect([0, 1]).toContain(back);
            expect(Object.values(SPOT)).toContain(spot);
            // A role facing the back wall plays a clip drawn from behind, and the other way round.
            const { views } = PEOPLE_CLIPS[CLIP_NAMES[clip]];
            if (role !== ROLE.walker) expect(views).toBe(back ? 'back' : 'front');
        }
        expect(CLIP_NAMES[WALK_B]).toBe('walkB');
    });

    it('stands the people at the back behind the counter and the rest in front of it', () => {
        const counter = 0.42;
        ARCH_ROLES.back.flat().filter((r) => r !== ROLE.none).forEach((role) => {
            expect(rows[at.role + role][1], `role ${role}`).toBeGreaterThan(counter);
        });
        ARCH_ROLES.front.flat().filter((r) => r !== ROLE.none).forEach((role) => {
            expect(rows[at.role + role][1], `role ${role}`).toBeLessThan(counter);
        });
    });

    it('copies each clip into its two table rows', () => {
        CLIP_NAMES.forEach((name, c) => {
            const clip = PEOPLE_CLIPS[name];
            const views = PEOPLE_VIEWS[clip.views];
            expect(rows[at.clip + c * 2]).toEqual([clip.base, clip.frames, views.start, views.count]);
            expect(rows[at.clip + c * 2 + 1][3]).toBe(clip.timing === 'level' ? 1 : 0);
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
});
