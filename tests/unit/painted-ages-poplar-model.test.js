/**
 * Painted Ages' poplar: the tree grown in Blender (scripts/blender/painted_ages_poplar.py), as the
 * generated module stores it and as the theme draws it.
 *
 * The module is numbers only, so everything the script held the tree to can be measured again
 * here from the arrays: the unit tree every level must be (the instance matrix scales it by
 * radius, height, radius, and the trees' shadow caster shares the geometry), the flame's profile,
 * the bare bole, the lumpy outline, the winding, the triangle budget per tier. Then the theme's
 * side: a level for every props tier (a leaner tree, never none), and the poplars' material and
 * their shadow caster built for both backends at the default tier and the leanest.
 */
import { readFileSync } from 'node:fs';
import {
    afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { PAINTED_AGES_POPLAR } from '../../src/themes/painted-ages/painted-ages-poplar-model.js';
import {
    POPLAR_COUNT, POPLAR_FORM, POPLAR_LEVEL, poplarGeometry, poplarModel,
} from '../../src/themes/painted-ages/painted-ages-life.js';
import { PaintedAgesWorld } from '../../src/themes/painted-ages/painted-ages-world.js';
import { FIELDS, FIELD_ORDER } from '../../src/themes/painted-ages/painted-ages-core.js';
import { decodeField } from '../../src/themes/painted-ages/painted-ages-field.js';
import { QUALITY } from '../../src/themes/painted-ages/painted-ages-quality.js';
import { decodePng } from '../../scripts/painted-ages/png.mjs';
import { build, unassignedReads } from './helpers/tsl-node-build.js';

const decode = (text, Type) => new Type(Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0)).buffer);

/** A stored level as plain arrays (decoded here, not by the theme's own reader). */
function arrays(level) {
    const q = PAINTED_AGES_POPLAR.quant;
    return {
        p: Array.from(decode(level.positions, Int16Array), (v) => v * q),
        n: Array.from(decode(level.normals, Int16Array), (v) => v / 32767),
        crown: decode(level.crown, Uint8Array),
        index: decode(level.index, Uint16Array),
    };
}

const reach = (p, i) => Math.hypot(p[i * 3], p[i * 3 + 2]);

/** The crown's reach in each tenth of the tree's height (the script's `profile`). */
function profile(p, count) {
    const bands = new Array(10).fill(0);
    for (let i = 0; i < count; i++) {
        const y = p[i * 3 + 1];
        for (let b = 0; b < 10; b++) {
            if (y >= b / 10 && y <= (b + 1) / 10) bands[b] = Math.max(bands[b], reach(p, i));
        }
    }
    return bands;
}

describe('Painted Ages poplar model (grown in Blender)', () => {
    const {
        levels, budget, clumps, quant,
    } = PAINTED_AGES_POPLAR;
    const byName = levels.map((l) => [l.name, l]);

    it('is three levels of detail, the finest first, each inside its triangle budget', () => {
        expect(levels.map((l) => l.name)).toEqual(['fine', 'mid', 'lean']);
        for (const level of levels) {
            expect(level.triangleCount, level.name).toBeLessThanOrEqual(budget[level.name]);
            expect(level.vertexCount, level.name).toBeLessThan(65536);
        }
        // About 300 to 600 triangles a tree where the most trees stand, and fewer each level down.
        expect(levels[0].triangleCount).toBeGreaterThanOrEqual(300);
        expect(levels[0].triangleCount).toBeLessThanOrEqual(600);
        expect(levels[1].triangleCount).toBeLessThan(levels[0].triangleCount * 0.7);
        expect(levels[2].triangleCount).toBeLessThan(levels[1].triangleCount * 0.7);
        expect(levels[2].triangleCount).toBeGreaterThan(80);
    });

    it.each(byName)('%s: finite numbers, whole arrays, the unit tree', (name, level) => {
        const {
            p, n, crown, index,
        } = arrays(level);
        expect(p.length).toBe(level.vertexCount * 3);
        expect(n.length).toBe(level.vertexCount * 3);
        expect(crown.length).toBe(level.vertexCount * 4);
        expect(index.length).toBe(level.triangleCount * 3);
        expect(Math.max(...index)).toBe(level.vertexCount - 1);
        let widest = 0;
        let top = -Infinity;
        let foot = Infinity;
        for (let i = 0; i < level.vertexCount; i++) {
            for (let c = 0; c < 3; c++) {
                expect(Number.isFinite(p[i * 3 + c]) && Number.isFinite(n[i * 3 + c])).toBe(true);
            }
            widest = Math.max(widest, reach(p, i));
            top = Math.max(top, p[i * 3 + 1]);
            foot = Math.min(foot, p[i * 3 + 1]);
            expect(Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]), `normal ${i}`).toBeGreaterThan(0.999);
            expect(Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2])).toBeLessThan(1.001);
        }
        // What the instance matrix scales by (radius, height, radius): its foot on the ground, its
        // top one unit up, its widest point one unit from the axis (to the stored step).
        expect(foot).toBe(0);
        expect(Math.abs(top - 1)).toBeLessThanOrEqual(quant);
        expect(Math.abs(widest - 1)).toBeLessThanOrEqual(quant * 1.5);
    });

    it.each(byName)('%s: a flame on a bare pale bole, widest about a third up, lumpy', (name, level) => {
        const { p, crown } = arrays(level);
        const { facts } = level;
        const shape = profile(p, level.vertexCount);
        // What the script measured is what the arrays hold.
        shape.forEach((r, b) => expect(r, `band ${b}`).toBeCloseTo(facts.profile[b], 3));
        expect(facts.vertices).toBe(level.vertexCount);
        expect(facts.triangles).toBe(level.triangleCount);
        // Widest about a third of the way up, tapering to its tip, narrow at its foot.
        expect(Math.max(shape[2], shape[3])).toBeGreaterThan(0.92);
        expect(facts.widestAt).toBeGreaterThan(0.2);
        expect(facts.widestAt).toBeLessThan(0.6);
        expect(shape[8]).toBeLessThan(0.62);
        expect(shape[9]).toBeLessThan(0.42);
        expect(shape[0]).toBeLessThan(0.5);
        // The bole: bark only, low, slim; the leaves begin about a tenth of the way up.
        let leavesFrom = Infinity;
        let barkTop = 0;
        let barkReach = 0;
        let bark = 0;
        const plumes = new Set();
        let inner = [];
        let outer = [];
        for (let b = 0; b < 10; b++) {
            inner[b] = Infinity;
            outer[b] = 0;
        }
        for (let i = 0; i < level.vertexCount; i++) {
            const [out, open, clump, isBark] = crown.subarray(i * 4, i * 4 + 4);
            const y = p[i * 3 + 1];
            expect(isBark === 0 || isBark === 255, `bark ${i}`).toBe(true);
            expect(clump).toBeLessThan(clumps);
            if (isBark) {
                bark++;
                barkTop = Math.max(barkTop, y);
                barkReach = Math.max(barkReach, reach(p, i));
                expect(out).toBe(0);
                continue;
            }
            leavesFrom = Math.min(leavesFrom, y);
            plumes.add(clump);
            expect(open).toBeGreaterThanOrEqual(0);
            const b = Math.min(9, Math.floor(y * 10));
            inner[b] = Math.min(inner[b], reach(p, i));
            outer[b] = Math.max(outer[b], reach(p, i));
        }
        expect(bark).toBeGreaterThanOrEqual(8);
        expect(barkReach).toBeLessThan(0.2);
        expect(barkTop).toBeGreaterThan(leavesFrom); // it runs up into the leaves: no gap under the crown
        expect(leavesFrom).toBeCloseTo(facts.crownBase, 3);
        expect(leavesFrom).toBeGreaterThan(0.07);
        expect(leavesFrom).toBeLessThan(0.14);
        // Plumes, not a spindle: through the crown's middle the innermost leaf stands well inside
        // the outermost, and nearly every plume has kept vertices of its own.
        inner = inner.slice(2, 8);
        outer = outer.slice(2, 8);
        const lumps = inner.reduce((sum, r, b) => sum + (1 - r / outer[b]), 0) / inner.length;
        expect(lumps).toBeGreaterThan(0.3);
        expect(plumes.size).toBe(facts.clumps);
        expect(plumes.size).toBeGreaterThanOrEqual(clumps - 3);
        // Every share is used: clefts and plume skin, shade and open sky.
        const outs = [];
        const opens = [];
        for (let i = 0; i < level.vertexCount; i++) {
            if (crown[i * 4 + 3]) continue;
            outs.push(crown[i * 4]);
            opens.push(crown[i * 4 + 1]);
        }
        expect(Math.min(...outs)).toBeLessThan(60);
        expect(Math.max(...outs)).toBe(255);
        expect(Math.min(...opens)).toBeLessThan(150);
        expect(Math.max(...opens)).toBeGreaterThan(235);
    });

    it.each(byName)('%s: wound outward (a rotation out of Blender, no mirror)', (name, level) => {
        const {
            p, n, crown, index,
        } = arrays(level);
        const at = (i) => new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
        let volume = 0;
        let agree = 0;
        for (let k = 0; k < index.length; k += 3) {
            const [a, b, c] = [index[k], index[k + 1], index[k + 2]];
            const [A, B, C] = [at(a), at(b), at(c)];
            // The leaves are one closed skin: the volume its faces enclose is positive only if they
            // look outward (the bole is an open tube and is left out).
            if (!crown[a * 4 + 3]) volume += A.dot(new THREE.Vector3().crossVectors(B, C)) / 6;
            const face = new THREE.Vector3().crossVectors(B.clone().sub(A), C.clone().sub(A));
            const sum = (axis) => n[a * 3 + axis] + n[b * 3 + axis] + n[c * 3 + axis];
            const mean = new THREE.Vector3(sum(0), sum(1), sum(2));
            if (face.dot(mean) > 0) agree++;
        }
        expect(volume).toBeGreaterThan(0.4);
        expect(volume).toBeCloseTo(level.facts.volume, 2);
        // The stored normals lean toward the whole flame's (a tree lit as one shape), so a cleft's
        // faces disagree with them; an inside-out mesh would agree almost nowhere.
        expect(agree / level.triangleCount).toBeGreaterThan(0.8);
        expect(agree / level.triangleCount).toBeCloseTo(level.facts.facingOut, 3);
    });
});

describe('Painted Ages poplars in the theme', () => {
    it('draws a level of the tree at every props tier: leaner, never none', () => {
        expect(POPLAR_LEVEL).toEqual({ 0: 'lean', 1: 'mid', 2: 'fine' });
        let before = 0;
        for (const props of [0, 1, 2]) {
            const model = poplarModel(POPLAR_LEVEL[props]);
            expect(model.name).toBe(POPLAR_LEVEL[props]);
            expect(model.triangleCount).toBeGreaterThan(before);
            before = model.triangleCount;
            const geometry = poplarGeometry(POPLAR_LEVEL[props]);
            expect(geometry.getIndex().count).toBe(model.triangleCount * 3);
            for (const name of ['position', 'normal', 'aCrown']) {
                expect(geometry.getAttribute(name).count, name).toBe(model.vertexCount);
            }
            expect(geometry.getAttribute('aCrown').itemSize).toBe(4);
            // The clump is an exact integer (the vertex stage hashes it), the shares 0..1.
            const crown = geometry.getAttribute('aCrown');
            for (let i = 0; i < crown.count; i++) {
                expect(Number.isInteger(crown.getZ(i))).toBe(true);
                expect(crown.getX(i)).toBeLessThanOrEqual(1);
                expect(crown.getY(i)).toBeLessThanOrEqual(1);
                expect([0, 1]).toContain(crown.getW(i));
            }
            geometry.dispose();
        }
        // The same arrays, decoded once, behind every geometry.
        expect(poplarModel('fine')).toBe(poplarModel('fine'));
        // The valley's trees at the richest tier stay a small draw.
        expect(POPLAR_COUNT[2] * poplarModel('fine').triangleCount).toBeLessThan(140_000);
        expect(POPLAR_COUNT[0] * poplarModel('lean').triangleCount).toBeLessThan(16_000);
    });

    it('varies and moves a tree gently: what the vertex stage does stays near the grown tree', () => {
        const F = POPLAR_FORM;
        // No plume stands more than half its reach beyond the grown tree the shadow caster draws
        // (and that only at the foot of a broad crown), and none is drawn in to nothing.
        expect(F.girth[1] * F.plume[1] * (1 + 0.5 * F.carry * 0.35)).toBeLessThan(1.55);
        expect(F.girth[0] * F.plume[0]).toBeGreaterThan(0.6);
        // A ragged top is cut, not a stump; a lean and the wind's bend are a few per cent of the height.
        expect(F.cutFrom).toBeGreaterThan(0.75);
        expect(F.lean).toBeLessThanOrEqual(0.06);
        expect(F.bendRest + F.bendGust + F.tremble).toBeLessThan(0.08);
        expect(F.bendGust).toBeGreaterThan(F.bendRest);
    });
});

describe.each(['High', 'Minimal'])('Painted Ages poplar shaders at %s', (quality) => {
    let world;
    const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];

    beforeAll(() => {
        const fields = {};
        for (const name of FIELD_ORDER) {
            const file = new URL(`../../src/themes/painted-ages/assets/badlands-${name}.png`, import.meta.url);
            const { rgba } = decodePng(readFileSync(file));
            fields[name] = { ...decodeField(rgba, FIELDS[name]), size: FIELDS[name].size, source: 'asset' };
        }
        fields.source = 'asset';
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(40, 16 / 9, 1.5, 60000);
        world = new PaintedAgesWorld({
            scene, quality, capture: true, prepared: PaintedAgesWorld.prepareSync(quality, fields),
        }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, 16 / 9);
        world.updateCamera(camera, { time: 5, delta: 0 });
        world.update({ time: 5, delta: 0 }, camera);
    }, 60_000);

    afterAll(() => {
        world?.dispose();
    });

    it('stands the tier\'s trees as its level of the grown tree, one draw, within eight vertex buffers', () => {
        const { poplars } = world.parts;
        const tier = QUALITY[quality];
        expect(poplars.level).toBe(POPLAR_LEVEL[tier.props]);
        expect(poplars.mesh.count).toBe(POPLAR_COUNT[tier.props]);
        expect(poplars.meshes).toEqual([poplars.mesh]);
        const { geometry } = poplars.mesh;
        expect(geometry.getIndex().count).toBe(poplarModel(poplars.level).triangleCount * 3);
        // WebGPU binds eight vertex buffers a pipeline: every attribute is one, and the instance matrix.
        expect(Object.keys(geometry.attributes).length + 1).toBeLessThanOrEqual(8);
        // Per tree: how golden, its seed, its height and radius; and where its foot stands.
        const tree = geometry.getAttribute('aTree');
        const root = geometry.getAttribute('aRoot');
        expect(tree.isInstancedBufferAttribute && root.isInstancedBufferAttribute).toBe(true);
        const m = new THREE.Matrix4();
        const at = new THREE.Vector3();
        const scale = new THREE.Vector3();
        poplars.sites.forEach((site, i) => {
            poplars.mesh.getMatrixAt(i, m);
            m.decompose(at, new THREE.Quaternion(), scale);
            // The vertex stage measures a tree from its foot: the foot it is given is the matrix's own.
            expect(root.getX(i)).toBeCloseTo(at.x, 3);
            expect(root.getY(i)).toBeCloseTo(at.y, 3);
            expect(root.getZ(i)).toBeCloseTo(at.z, 3);
            expect(tree.getZ(i)).toBeCloseTo(scale.y, 4);
            expect(tree.getW(i)).toBeCloseTo(scale.x, 4);
            expect(tree.getX(i)).toBeCloseTo(site.golden, 6);
            expect(scale.z).toBeCloseTo(scale.x, 5);
        });
        // The shadow caster draws the same trees: the geometry and the matrices are shared.
        expect(poplars.shade.caster.geometry).toBe(geometry);
        expect(poplars.shade.caster.instanceMatrix).toBe(poplars.mesh.instanceMatrix);
        expect(poplars.shade.caster.material.positionNode ?? null).toBeNull();
    });

    it('builds the trees and their shadow caster for WebGPU and the WebGL2 fallback without a word', () => {
        const { poplars } = world.parts;
        for (const [name, mesh] of [['poplars', poplars.mesh], ['poplar-shade', poplars.shade.caster]]) {
            for (const [label, Builder] of BACKENDS) {
                const out = build(Builder, mesh);
                const threw = out.thrown?.stack?.split('\n').slice(0, 3).join(' | ');
                expect(out.thrown, `${name}, ${label}: ${threw}`).toBeUndefined();
                expect(out.heard, `${name}, ${label}`).toEqual([]);
                for (const stage of ['vertex', 'fragment']) {
                    expect(out[stage].length, `${name}, ${label} ${stage}`).toBeGreaterThan(200);
                    expect(out[stage], `${name}, ${label} ${stage}`).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                    expect(Buffer.byteLength(out[stage]), `${name}, ${label} ${stage}`).toBeLessThan(32 * 1024);
                }
                if (label === 'WGSL') {
                    expect(unassignedReads(out.vertex), `${name} vertex`).toEqual([]);
                    expect(unassignedReads(out.fragment), `${name} fragment`).toEqual([]);
                }
                if (name === 'poplars') {
                    // The wind and a plume's own tone are worked out per vertex and carried to the pixel.
                    for (const carried of ['vPoplarGust', 'vPoplarPlume', 'vPoplarFlutter']) {
                        expect(out.vertex, `${label} ${carried}`).toContain(carried);
                        expect(out.fragment, `${label} ${carried}`).toContain(carried);
                    }
                }
            }
        }
    });
});
