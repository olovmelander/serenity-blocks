/**
 * Rainbark — the trunks: the unit tube, the two instanced draws and their records, on the CPU
 * (the node graphs are built, never compiled). Relations, not tuning numbers: the tube's
 * triangles face out of the bark, every slot is drawn and the unused ones have no size, a draw
 * binds two vertex buffers, and the hero trunks stand where the composition puts them.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    NEAR_SLOTS, TRUNK_STRIDE, createTrunks, createTubeGeometry, trunkSurface,
} from '../../src/themes/rainbark/rainbark-trunks.js';
import {
    ATLAS_RIBBONS, BARK_TILE, GROVE_CARD_MARGIN, HERO_TRUNKS, trunkRecord, wrapsPerSecond,
} from '../../src/themes/rainbark/rainbark-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/rainbark/rainbark-quality.js';
import {
    RAINBARK_PARTS, REST_RIG, RainbarkWorld, fovForAspect,
} from '../../src/themes/rainbark/rainbark-world.js';
import { fallbackLayout } from '../../src/themes/rainbark/rainbark-composition.js';
import { createRainbarkUniforms } from '../../src/themes/rainbark/rainbark-tsl.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('Rainbark trunks: the unit tube', () => {
    it('lays (θ/2π, h) on a grid with the seam column duplicated, indexes every cell twice, and caps the foot', () => {
        const geometry = createTubeGeometry(12, 5);
        const position = geometry.getAttribute('position');
        // The wall's grid, then one cap ring.
        expect(position.count).toBe(13 * 6 + 13);
        expect(geometry.index.count).toBe(12 * 5 * 6 + 12 * 3);
        const a = [];
        let cap = 0;
        for (let i = 0; i < position.count; i++) {
            a.push(position.getX(i));
            expect(position.getY(i)).toBeGreaterThanOrEqual(0);
            expect(position.getY(i)).toBeLessThanOrEqual(1);
            if (position.getZ(i) === 1) {
                cap += 1;
                // The cap ring sits at the foot.
                expect(position.getY(i)).toBe(0);
            } else {
                expect(position.getZ(i)).toBe(0);
            }
        }
        expect(cap).toBe(13);
        expect(Math.min(...a)).toBe(0);
        expect(Math.max(...a)).toBe(1);
        geometry.dispose();
    });

    it('winds every wall triangle counter-clockwise seen from outside the bark, and the foot facing down', () => {
        const geometry = createTubeGeometry(16, 8);
        const position = geometry.getAttribute('position');
        const record = trunkRecord(HERO_TRUNKS[0], 101);
        const index = geometry.index.array;
        let outward = 0;
        let down = 0;
        for (let t = 0; t < index.length; t += 3) {
            const at = (k) => {
                const v = index[t + k];
                return trunkSurface(record, position.getX(v), position.getY(v), 0, position.getZ(v));
            };
            const [p0, p1, p2] = [at(0), at(1), at(2)];
            const n = cross(sub(p1.position, p0.position), sub(p2.position, p0.position));
            const isCap = [0, 1, 2].some((k) => position.getZ(index[t + k]) === 1);
            if (isCap) {
                if (n[1] < 0) down += 1;
                continue;
            }
            const centroid = [0, 1, 2].map((c) => (p0.position[c] + p1.position[c] + p2.position[c]) / 3);
            const axis = [p0.spine[0], centroid[1], p0.spine[1]];
            if (dot(n, sub(centroid, axis)) > 0) outward += 1;
        }
        expect(outward).toBe(16 * 8 * 2);
        expect(down).toBe(16);
        geometry.dispose();
    });
});

describe('Rainbark trunks: the two draws', () => {
    it('draws every slot of both pools on every tier, the unused ones collapsed to nothing', () => {
        for (const quality of QUALITY_NAMES) {
            const tier = QUALITY[quality];
            const u = createRainbarkUniforms();
            const farSlots = 9 + tier.limbs;
            const trunks = createTrunks(u, tier, { atlasSize: tier.atlas, farSlots });
            const { near, far } = trunks;
            expect(near.slots).toBe(NEAR_SLOTS);
            expect(far.slots).toBe(farSlots);
            expect(near.geometry.instanceCount).toBe(near.slots);
            expect(far.geometry.instanceCount).toBe(far.slots);
            // A near and a far grid of the tier's size (and the foot's cap ring).
            const vertices = ([around, up]) => (around + 1) * (up + 2);
            expect(near.geometry.getAttribute('position').count).toBe(vertices(tier.grids.near));
            expect(far.geometry.getAttribute('position').count).toBe(vertices(tier.grids.far));
            // Heroes by code in the near draw, the rest in order in the far one; a hidden hero
            // (here Sister Two) is a collapsed slot that keeps its place.
            let farSlot = 0;
            HERO_TRUNKS.forEach((trunk, i) => {
                const shown = trunk.name === 'Sister Two' ? null : trunk;
                if (trunk.code > 0) trunks.stand(near, trunk.code - 1, shown, 10 + i);
                else trunks.stand(far, farSlot++, trunk, 10 + i);
            });
            trunks.commit();
            const heroes = HERO_TRUNKS.filter((t) => t.code > 0).length;
            expect(near.used).toBe(heroes);
            expect(near.live(2)).toBe(false);
            expect(near.live(0) && near.live(1) && near.live(3)).toBe(true);
            expect(far.used).toBe(farSlot);
            for (const draw of [near, far]) {
                for (let slot = 0; slot < draw.slots; slot++) {
                    if (draw.live(slot)) continue;
                    const record = draw.data.subarray(slot * TRUNK_STRIDE, (slot + 1) * TRUNK_STRIDE);
                    expect(record.every((v) => v === 0), `${quality} dormant slot ${slot}`).toBe(true);
                }
            }
            // Slots out of range are ignored; a limb with no live parent collapses its slot.
            trunks.stand(near, NEAR_SLOTS, HERO_TRUNKS[0], 1);
            trunks.standLimb(far.slots - 1, { y: 140 }, near, 2);
            trunks.commit();
            expect(far.live(far.slots - 1)).toBe(false);
            trunks.dispose();
        }
    });

    it('reads each record from ONE interleaved instance buffer, so a draw binds two vertex buffers', () => {
        const trunks = createTrunks(createRainbarkUniforms(), QUALITY.High);
        for (const draw of [trunks.near, trunks.far]) {
            const names = Object.keys(draw.geometry.attributes).sort();
            expect(names).toEqual(['aBase', 'aCode', 'aLean', 'aSpan', 'position']);
            const buffers = new Set(names.map((name) => {
                const attribute = draw.geometry.getAttribute(name);
                return attribute.isInterleavedBufferAttribute ? attribute.data : attribute;
            }));
            expect(buffers.size).toBe(2);
            expect(draw.buffer.stride).toBe(TRUNK_STRIDE);
            expect(draw.buffer.isInstancedInterleavedBuffer).toBe(true);
            ['aBase', 'aSpan', 'aLean', 'aCode'].forEach((name, i) => {
                expect(draw.geometry.getAttribute(name).offset).toBe(i * 4);
                expect(draw.geometry.getAttribute(name).itemSize).toBe(4);
            });
            // Opaque bark: a node material, front faces, writing depth, drawn before the backdrop.
            expect(draw.material.isNodeMaterial).toBe(true);
            expect(draw.material.side).toBe(THREE.FrontSide);
            expect(draw.material.depthWrite).toBe(true);
            expect(draw.mesh.renderOrder).toBeLessThan(50);
            expect(draw.mesh.frustumCulled).toBe(false);
        }
        expect(trunks.near.mesh.renderOrder).toBeLessThan(trunks.far.mesh.renderOrder);
        trunks.dispose();
    });
});

describe('Rainbark trunks: in the world', () => {
    /** A world at the 16:9 reference (level 4, t = 55) and its rest camera. */
    const reference = (quality = 'Low', [width, height] = [1920, 1080]) => {
        const scene = new THREE.Scene();
        const aspect = width / height;
        const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
        const world = new RainbarkWorld({ scene, quality, capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(width, height, aspect);
        world.setLayout(fallbackLayout(width, height), aspect);
        world.seek(55);
        world.levelUp(4, { silent: true });
        return { world, rest: world.restCamera() };
    };
    /** Screen x (0 left … 1 right) a record covers at the camera's height. */
    const spanOf = (draw, slot, rest) => {
        const record = draw.data.subarray(slot * TRUNK_STRIDE, (slot + 1) * TRUNK_STRIDE);
        const h = (rest.position.y - record[4]) / (record[5] - record[4]);
        const xs = [];
        for (let i = 0; i < 360; i++) {
            const p = trunkSurface(record, i / 360, h).position;
            const v = new THREE.Vector3(p[0], p[1], p[2]).project(rest);
            xs.push((v.x + 1) / 2);
        }
        return [Math.min(...xs), Math.max(...xs)];
    };

    it('stands the hero trunks where the 16:9 composition puts them, and the grove round the card', () => {
        const { world, rest } = reference('High');
        expect(RAINBARK_PARTS).toContain('trunks');
        const { near, far } = world.parts.trunks;
        const slotOf = (name) => HERO_TRUNKS.find((t) => t.name === name).code - 1;
        // The Elder: a cropped wall on the left, its right silhouette at about 0.27.
        const elder = spanOf(near, slotOf('Elder'), rest);
        expect(elder[0]).toBeLessThan(0);
        expect(elder[1]).toBeGreaterThan(0.24);
        expect(elder[1]).toBeLessThan(0.31);
        // Sister One just right of the HUD (0.78–0.88), Sister Two beyond her, R1a in the left lane.
        const one = spanOf(near, slotOf('Sister One'), rest);
        expect(one[0]).toBeGreaterThan(0.76);
        expect(one[1]).toBeLessThan(0.9);
        const two = spanOf(near, slotOf('Sister Two'), rest);
        expect(two[0]).toBeGreaterThan(one[0]);
        expect(two[1]).toBeLessThan(0.95);
        const r1a = spanOf(near, slotOf('R1a'), rest);
        expect(r1a[0]).toBeGreaterThan(0.29);
        expect(r1a[1]).toBeLessThan(0.37);
        // Nothing near stands in the card's band (the 16:9 fallback card is x 0.407–0.593); of the
        // far grove, R1 and R2 keep out of it (and its margin), at most two R3 stand behind it,
        // and the deeper ranks are ghosts, free to.
        const card = fallbackLayout(1920, 1080).cards[0];
        const inBand = ([x0, x1]) => x1 > card.x0 - GROVE_CARD_MARGIN && x0 < card.x1 + GROVE_CARD_MARGIN;
        for (let slot = 0; slot < near.used; slot++) {
            if (near.live(slot)) expect(inBand(spanOf(near, slot, rest)), `near slot ${slot}`).toBe(false);
        }
        const { trunks: grove } = world.plan;
        let behind = 0;
        grove.forEach((trunk, slot) => {
            const s = spanOf(far, slot, rest);
            if (trunk.rank <= 2) expect(inBand(s), trunk.name).toBe(false);
            if (trunk.rank === 3 && inBand(s)) behind += 1;
        });
        expect(behind).toBeLessThanOrEqual(2);
        expect(grove.some((trunk) => trunk.rank >= 3)).toBe(true);
        world.dispose();
    });

    it('wraps one patch among the composition\'s trunks every 6–10 s (§5), the far grove rarely', () => {
        const { world, rest } = reference('Extreme');
        // The bark each trunk shows the camera: facing it and inside the frame (an estimate: it
        // ignores one trunk hiding another, so it errs toward more wraps).
        const near = [];
        const grove = [];
        const P = new THREE.Vector3();
        const toEye = new THREE.Vector3();
        const { near: nearDraw, far: farDraw } = world.parts.trunks;
        const names = new Set(HERO_TRUNKS.map((t) => t.name));
        const sample = (draw, slot) => {
            const record = draw.data.subarray(slot * TRUNK_STRIDE, (slot + 1) * TRUNK_STRIDE);
            const around = 80;
            const up = 160;
            const span = record[5] - record[4];
            let area = 0;
            for (let j = 0; j < up; j++) {
                for (let i = 0; i < around; i++) {
                    const s = trunkSurface(record, (i + 0.5) / around, (j + 0.5) / up);
                    P.set(s.position[0], s.position[1], s.position[2]);
                    toEye.copy(rest.position).sub(P);
                    if (toEye.x * s.normal[0] + toEye.z * s.normal[2] <= 0) continue;
                    P.project(rest);
                    if (Math.abs(P.x) > 1 || Math.abs(P.y) > 1 || P.z > 1) continue;
                    area += ((Math.PI * 2 * s.radius) / around) * (span / up);
                }
            }
            return { group: Math.round(record[13]) % 4, area };
        };
        for (let slot = 0; slot < nearDraw.slots; slot++) if (nearDraw.live(slot)) near.push(sample(nearDraw, slot));
        world.plan.trunks.forEach((trunk, slot) => (names.has(trunk.name) ? near : grove).push(sample(farDraw, slot)));
        // Every hero but R1b (the open air right of the HUD keeps her out of a 16:9 frame).
        expect(near.length).toBe(HERO_TRUNKS.length - 1);
        const density = ATLAS_RIBBONS / (BARK_TILE.around * BARK_TILE.up);
        const rate = wrapsPerSecond(near, density);
        expect(rate).toBeGreaterThanOrEqual(1 / 10);
        expect(rate).toBeLessThanOrEqual(1 / 6);
        // Were every patch cycling at the Elder's pace, it would wrap more than three times as often.
        const eager = wrapsPerSecond(near.map(({ area }) => ({ group: 0, area })), density);
        expect(eager).toBeGreaterThan(rate * 3);
        // The far grove shows the most bark by far, small and hazed: it adds at most one wrap in five seconds.
        const far = grove.reduce((sum, { area }) => sum + area, 0);
        expect(far).toBeGreaterThan(near.reduce((sum, { area }) => sum + area, 0));
        expect(wrapsPerSecond(grove, density)).toBeLessThanOrEqual(1 / 5);
        world.dispose();
    });
});
