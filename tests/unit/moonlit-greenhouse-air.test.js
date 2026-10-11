/**
 * Moonlit Greenhouse — what moves in the air (moonlit-greenhouse-air.js).
 *
 * The fireflies, the moths, the motes and the dew are closed forms in the world clock, drawn from
 * static instance data baked on the CPU. These tests pin what a screenshot cannot: that the
 * shader's flash is the core's fireflyFlash() (the formula is written once for both arithmetics,
 * so the CPU twin is the shader's own expression), that the instance data keeps every creature
 * inside the house where the art direction puts it, that the tiers scale the pools, that a
 * curtain's drops start under the glass and reach the floor in about TIMING.dewFall, that the
 * quads face the eye, and that each part disposes what it built.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';

import {
    DEW, FIREFLY, JS_MATH, MOTE, MOTH, TSL_MATH, airQuads, createDew, createFireflies, createMoths, createMotes,
    curtainDrop, dewPlan, dripsFor, dropFall, fireflyPlan, flashWith, mothPlan, motePlan, trailDotsFor,
} from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-air.js';
import {
    FLOOR, HOUSE, TIMING, fireflyFlash, groundAt, mulberry32, vaultHeightAt,
} from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-core.js';
import { planGarden } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-plan.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-quality.js';
import { MoonlitGreenhouseWorld } from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-world.js';

function ctxFor(quality) {
    const tier = QUALITY[quality];
    const world = new MoonlitGreenhouseWorld({ scene: new THREE.Scene(), quality });
    return {
        tier, U: world.U, plan: planGarden(tier, 1861), seed: 1861, noise: null,
    };
}

/** Rows of a plan's interleaved data, `stride` floats each. */
function rows(data, stride) {
    const out = [];
    for (let i = 0; i < data.length; i += stride) out.push(Array.from(data.subarray(i, i + stride)));
    return out;
}

describe('the flash', () => {
    it('is fireflyFlash() in plain numbers', () => {
        const rand = mulberry32(7);
        for (let i = 0; i < 4000; i += 1) {
            const t = rand() * 600;
            const seed = rand();
            const z = 2 - rand() * 42;
            const sync = i % 5 === 0 ? Math.round(rand()) : rand();
            const twin = flashWith(JS_MATH, t, seed, z, sync).flash;
            expect(twin).toBeCloseTo(fireflyFlash(t, seed, z, sync), 6);
        }
    });

    it('hands the shader TSL nodes for the same formula', () => {
        const f = flashWith(TSL_MATH, 1.25, 0.4, -6, 0.5);
        ['flash', 'fOwn', 'fSync', 'own', 'w'].forEach((key) => expect(f[key].isNode).toBe(true));
    });

    it('rolls down the house in step and is one flash at full sync', () => {
        // Mid-chain the beat lags by FLASH.lag a metre; at full sync every firefly flashes together.
        const near = flashWith(JS_MATH, 0.15, 0.3, 0, 0.5).fSync;
        const far = flashWith(JS_MATH, 0.15, 0.3, -20, 0.5).fSync;
        expect(near).not.toBeCloseTo(far, 3);
        const a = flashWith(JS_MATH, 19.15, 0.1, 0, 1).flash;
        const b = flashWith(JS_MATH, 19.15, 0.9, -35, 1).flash;
        expect(a).toBeCloseTo(b, 9);
        expect(a).toBeGreaterThan(0.9);
    });
});

describe('the quads', () => {
    it('face +z (front-facing on screen) and carry the instance data in one buffer', () => {
        const g = airQuads(3, new Float32Array(3 * 8), ['aOne', 'aTwo']);
        const p = g.getAttribute('position').array;
        const idx = g.getIndex().array;
        for (let t = 0; t < idx.length; t += 3) {
            const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
            const ux = p[b] - p[a];
            const uy = p[b + 1] - p[a + 1];
            const vx = p[c] - p[a];
            const vy = p[c + 1] - p[a + 1];
            expect(ux * vy - uy * vx).toBeGreaterThan(0);
        }
        expect(g.instanceCount).toBe(3);
        expect(g.getAttribute('aOne').data).toBe(g.getAttribute('aTwo').data);
        expect(g.getAttribute('aTwo').offset).toBe(4);
        g.dispose();
    });
});

describe('the fireflies', () => {
    it('scale with the tier and leave trails only on the richer ones', () => {
        QUALITY_NAMES.forEach((name) => {
            const tier = QUALITY[name];
            const plan = fireflyPlan(tier);
            expect(plan.count).toBe(tier.fireflies);
            expect(plan.dots).toBe(trailDotsFor(tier));
            expect(plan.instances).toBe(tier.fireflies * (1 + plan.dots));
            expect(plan.data.length).toBe(plan.instances * 12);
        });
        expect(trailDotsFor(QUALITY.Medium)).toBe(0);
        expect(trailDotsFor(QUALITY.High)).toBeGreaterThan(3);
    });

    it('live round the beds, the bed fronts and over the canal, denser near the eye', () => {
        const { homes } = fireflyPlan(QUALITY.Extreme);
        homes.forEach((h) => {
            expect(Math.abs(h.x) + h.reach).toBeLessThanOrEqual(6.5 + 1e-9);
            expect(h.y).toBeGreaterThanOrEqual(0.4);
            expect(h.y).toBeLessThanOrEqual(4.0);
            expect(h.z).toBeLessThanOrEqual(2.0);
            expect(h.z).toBeGreaterThanOrEqual(-40);
        });
        const near = homes.filter((h) => h.z > -12).length;
        const far = homes.filter((h) => h.z < -28).length;
        expect(near).toBeGreaterThan(far * 2);
        const overCanal = homes.filter((h) => Math.abs(h.x) < FLOOR.canal.half && h.y < 1.2).length;
        expect(overCanal / homes.length).toBeGreaterThan(0.12);
        // The swarm calls them out by an even share: about 42 % at rest...
        const out = homes.filter((h) => h.out < 0.42);
        expect(out.length / homes.length).toBeGreaterThan(0.38);
        expect(out.length / homes.length).toBeLessThan(0.46);
        // ...the ones the eye sees first (near, beside the card), the far and hidden ones with a chain.
        const meanZ = (list) => list.reduce((a, h) => a + h.z, 0) / list.length;
        const rest = homes.filter((h) => h.out >= 0.42);
        expect(meanZ(out)).toBeGreaterThan(meanZ(rest) + 3);
        const hidden = (h) => Math.abs(h.x) < 2.6 && h.z < 0.5;
        expect(out.filter(hidden).length / out.length).toBeLessThan(rest.filter(hidden).length / rest.length);
    });

    it('repeat the firefly in every trail dot, numbering the dots', () => {
        const plan = fireflyPlan(QUALITY.High);
        const r = rows(plan.data, 12);
        for (let j = 0; j <= plan.dots; j += 1) {
            const dot = r[j * plan.count + 5];
            expect(dot[7]).toBe(j);
            expect(dot.slice(0, 3)).toEqual(r[5].slice(0, 3));
        }
        expect(FIREFLY.least).toBeGreaterThanOrEqual(2);
    });
});

describe('the moths', () => {
    it('are two wings each, given the nearest lanterns most', () => {
        const tier = QUALITY.High;
        const plan = planGarden(tier);
        const mp = mothPlan(tier, plan);
        expect(mp.count).toBe(tier.moths);
        expect(mp.instances).toBe(tier.moths * 2);
        const sides = rows(mp.data, 12).map((r) => r[3]);
        expect(sides.filter((s) => s === -1).length).toBe(tier.moths);
        expect(sides.filter((s) => s === 1).length).toBe(tier.moths);
        const nearestZ = Math.max(...plan.lanterns.map((l) => l.z));
        const atNearest = mp.moths.filter((m) => Math.abs(m.flame[2] - nearestZ) < 1e-6).length;
        expect(atNearest / mp.count).toBeGreaterThanOrEqual(0.4);
        mp.moths.forEach((m) => {
            expect(m.orbit).toBeGreaterThanOrEqual(MOTH.orbit[0]);
            expect(m.orbit).toBeLessThanOrEqual(MOTH.orbit[1]);
            // The flame the world lights the house from: 0.18 under the plan's lantern point.
            const lamp = plan.lanterns.find((l) => l.x === m.flame[0] && l.z === m.flame[2]);
            expect(lamp.y - 0.18).toBeCloseTo(m.flame[1], 9);
        });
    });
});

describe('the motes', () => {
    it('fill the nave and scale with the tier', () => {
        const { box } = MOTE;
        QUALITY_NAMES.forEach((name) => {
            const mp = motePlan(QUALITY[name]);
            expect(mp.count).toBe(QUALITY[name].motes);
            rows(mp.data, 8).forEach(([x, y, z, , rise, reach, px, glint]) => {
                expect(Math.abs(x)).toBeLessThanOrEqual(box.x);
                expect(y).toBeGreaterThanOrEqual(box.from);
                expect(y).toBeLessThanOrEqual(box.to);
                expect(z).toBeLessThanOrEqual(box.near);
                expect(z).toBeGreaterThanOrEqual(box.far);
                expect(Math.abs(rise)).toBeLessThan(0.05);
                expect(reach).toBeLessThan(1);
                expect(px).toBeGreaterThanOrEqual(MOTE.pixels[0]);
                expect([0, 1]).toContain(glint);
            });
        });
    });
});

describe('the dew', () => {
    it('falls against drag from its start to the ground at the moment it lands', () => {
        [[12.6, -0.16, 9, 0], [8.0, 0.42, 7.5, 1.5], [10.4, 0, 11, 2.2]].forEach(([top, ground, vt, kick]) => {
            const f = dropFall(top, ground, vt, 0, kick);
            expect(f.y).toBeCloseTo(top, 9);
            expect(f.speed).toBeCloseTo(kick, 6);
            const landed = dropFall(top, ground, vt, f.lands, kick);
            expect(landed.y).toBeCloseTo(ground, 5);
            expect(landed.speed).toBeLessThan(vt);
            expect(landed.speed).toBeGreaterThan(kick);
        });
    });

    it('shakes its curtain from under the glass and the fronds, and lands in about TIMING.dewFall', () => {
        const tier = QUALITY.High;
        const dp = dewPlan(tier);
        expect(dp.curtain).toBe(tier.dew);
        expect(dp.drips).toBe(dripsFor(tier));
        expect(dp.drips).toBeGreaterThanOrEqual(DEW.fewest);
        const r = rows(dp.data, 8);
        const lands = [];
        let glass = 0;
        [0.37, 0.81, 0.05].forEach((hb) => {
            r.slice(0, dp.curtain).forEach(([u, v, share, source, kind, delay, vt, kick]) => {
                expect(kind).toBe(0);
                expect(share).toBeGreaterThanOrEqual(0);
                expect(share).toBeLessThan(1);
                expect(delay).toBeLessThanOrEqual(DEW.shake);
                const d = curtainDrop(u, v, source, hb);
                expect(Math.abs(d.x)).toBeLessThanOrEqual(6.4 + 1e-9);
                expect(d.top).toBeLessThan(vaultHeightAt(d.x));
                const ground = groundAt(d.x, d.z).y;
                expect(d.top).toBeGreaterThan(ground + 2);
                if (d.glass) {
                    glass += 1;
                    lands.push(dropFall(d.top, ground, vt, 0, kick).lands);
                } else {
                    expect(Math.abs(d.x)).toBeGreaterThan(3.2);
                }
            });
        });
        expect(glass / (dp.curtain * 3)).toBeCloseTo(DEW.glass, 1);
        const mean = lands.reduce((a, b) => a + b, 0) / lands.length;
        expect(Math.abs(mean - TIMING.dewFall)).toBeLessThan(0.35);
        // The drips keep their places on the glass, over the nave.
        dp.spots.forEach((s) => {
            expect(Math.abs(s.x)).toBeLessThan(HOUSE.halfSpan);
            expect(s.top).toBeCloseTo(vaultHeightAt(s.x), 9);
        });
    });
});

describe('the parts', () => {
    const makers = {
        fireflies: [createFireflies, (t) => t.fireflies * (1 + trailDotsFor(t))],
        moths: [createMoths, (t) => t.moths * 2],
        motes: [createMotes, (t) => t.motes],
        dew: [createDew, (t) => t.dew + dripsFor(t)],
    };

    ['Minimal', 'Medium', 'Extreme'].forEach((quality) => {
        it(`draw every instance of their pool at ${quality}, ordered on the mesh, and dispose`, () => {
            const ctx = ctxFor(quality);
            Object.entries(makers).forEach(([name, [make, instances]]) => {
                const part = make(ctx);
                const { mesh } = part;
                expect(mesh.isMesh).toBe(true);
                expect(mesh.name).toBe(`moonlit-greenhouse-${name}`);
                expect(mesh.frustumCulled).toBe(false);
                expect(mesh.renderOrder).toBeGreaterThan(0);
                expect(mesh.geometry.instanceCount).toBe(instances(ctx.tier));
                // Two vertex buffers: the quad's corners and the one interleaved instance buffer.
                const buffers = new Set(Object.values(mesh.geometry.attributes).map((a) => a.data || a));
                expect(buffers.size).toBeLessThanOrEqual(2);
                const parent = new THREE.Group();
                parent.add(mesh);
                let disposed = 0;
                mesh.geometry.addEventListener('dispose', () => { disposed += 1; });
                mesh.material.addEventListener('dispose', () => { disposed += 1; });
                part.dispose();
                expect(mesh.parent).toBe(null);
                expect(disposed).toBe(2);
            });
        });
    });

    it('draw the lights additively without touching alpha, and the moths as depth-writing cut-outs', () => {
        const ctx = ctxFor('Low');
        ['fireflies', 'motes', 'dew'].forEach((name) => {
            const part = makers[name][0](ctx);
            const m = part.mesh.material;
            expect(m.blending).toBe(THREE.AdditiveBlending);
            expect(m.premultipliedAlpha).toBe(true);
            expect(m.depthWrite).toBe(false);
            expect(m.outputNode).toBeTruthy();
            expect(part.mesh.renderOrder).toBeGreaterThanOrEqual(50);
            part.dispose();
        });
        const moths = createMoths(ctx);
        expect(moths.mesh.material.alphaTest).toBeGreaterThan(0);
        expect(moths.mesh.material.depthWrite).toBe(true);
        expect(moths.mesh.material.side).toBe(THREE.DoubleSide);
        expect(moths.mesh.renderOrder).toBeLessThan(40);
        moths.dispose();
    });
});
