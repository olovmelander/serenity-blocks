import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    float, sin, uniform, vec4,
} from 'three/tsl';

import { build, unassignedReads } from '../../../../tests/unit/helpers/tsl-node-build.js';
import {
    FOREST_ATLAS, FOREST_FAR, FOREST_PULL_WIDTH, FOREST_SPECIMENS, buildForestPull, decodeForestTier, forestBarkTile,
    forestFarIndex, forestSkirt, forestSpecimenIndex,
} from './odyssey-forest-models-decode.js';
import { FOREST_INSTANCE, buildForestSlots, createForestMaterials } from './odyssey-forest-material.js';
import { buildForestMesh, createForestTextures } from './odyssey-forest-mesh.js';
import {
    ODYSSEY_FOREST_SPECIES, forestColours, forestTier, getForestSpecies, shadeColourFor,
} from './odyssey-forest-species.js';
import { FOREST_COMMUNITIES, FOREST_HEROES } from './odyssey-forest-composition.js';

/**
 * THE TREES (2026-11-24): the specimens grown in Blender, the texture the vertex shader pulls them from,
 * the meshes and the two materials. (Where they stand: odyssey-forest-scatter.test.js.)
 */

const luma = (c) => (0.2126 * c[0]) + (0.7152 * c[1]) + (0.0722 * c[2]);
const pngSize = (rel) => {
    const b = readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
    return [b.readUInt32BE(16), b.readUInt32BE(20), b[25]];
};
const item = (index, extra = {}) => ({
    specimen: index,
    x: 0,
    y: 300,
    z: 0,
    scale: 1,
    scaleY: 1,
    rot: 0.4,
    leanX: 0.01,
    leanZ: 0,
    phase: 1,
    shadeTop: 0.2,
    open: 0.7,
    ...forestColours(FOREST_SPECIMENS[index].species),
    ...extra,
});

describe('the roster', () => {
    it('is a real forest: many kinds, each in several ages or habits', () => {
        expect(FOREST_SPECIMENS.length).toBeGreaterThanOrEqual(44);
        expect(new Set(FOREST_SPECIMENS.map((s) => s.id)).size).toBe(FOREST_SPECIMENS.length);
        expect(new Set(FOREST_SPECIMENS.map((s) => s.species)).size).toBeGreaterThanOrEqual(18);
        ['oak', 'beech', 'birch', 'aspen', 'cherry', 'stone-pine', 'spruce', 'scots-pine'].forEach((sp) => {
            expect(FOREST_SPECIMENS.filter((s) => s.species === sp).length, sp).toBeGreaterThanOrEqual(3);
        });
        FOREST_SPECIMENS.forEach((s) => expect(getForestSpecies(s.species), s.id).toBeTruthy());
    });

    it('holds its budgets: the near tier rich, the middle one a fraction of it', () => {
        FOREST_SPECIMENS.forEach((s) => {
            const hero = (s.hero.cards * 2) + (s.hero.barkIndices / 3);
            const mid = (s.mid.cards * 2) + (s.mid.barkIndices / 3);
            expect(s.hero.cards, s.id).toBeLessThanOrEqual(335);
            expect(hero, s.id).toBeLessThanOrEqual(1000);
            expect(mid, s.id).toBeLessThanOrEqual(260);
            expect(mid, s.id).toBeLessThan(hero);
        });
    });

    it('decodes sound foliage: finite, unit axes and normals, sizes and tiles in range', () => {
        FOREST_SPECIMENS.forEach((s, i) => {
            ['hero', 'mid'].forEach((lod) => {
                const { cards } = decodeForestTier(i, lod);
                expect(cards.count).toBe(s[lod].cards);
                let worst = 0;
                for (let k = 0; k < cards.count; k += 1) {
                    const len = (a) => Math.hypot(a[k * 3], a[(k * 3) + 1], a[(k * 3) + 2]);
                    worst = Math.max(worst, Math.abs(len(cards.axis) - 1), Math.abs(len(cards.normal) - 1));
                    if (!(cards.half[k * 2] > 0.05 && cards.half[(k * 2) + 1] > 0.05)) {
                        throw new Error(`${s.id} ${lod} card ${k} size`);
                    }
                    if (cards.tile[k] >= 61 && cards.tile[k] <= 63) throw new Error(`${s.id} ${lod} card ${k} wears bark`);
                    if (cards.tile[k] >= FOREST_ATLAS.cols * FOREST_ATLAS.rows) throw new Error(`${s.id} ${lod} card ${k} off the atlas`);
                }
                expect(worst, `${s.id} ${lod}`).toBeLessThan(0.02);
                cards.centre.forEach((v) => { if (!Number.isFinite(v)) throw new Error(s.id); });
            });
        });
    });

    it('orders the cards so any first half of them still covers the crown', () => {
        FOREST_SPECIMENS.forEach((s, i) => {
            const { cards } = decodeForestTier(i, 'hero');
            if (cards.count < 60) return;
            const span = (n, ax) => {
                let lo = Infinity;
                let hi = -Infinity;
                for (let k = 0; k < n; k += 1) {
                    lo = Math.min(lo, cards.centre[(k * 3) + ax]);
                    hi = Math.max(hi, cards.centre[(k * 3) + ax]);
                }
                return hi - lo;
            };
            [0, 1, 2].forEach((ax) => {
                expect(span(Math.ceil(cards.count / 2), ax), `${s.id} axis ${ax}`)
                    .toBeGreaterThan(span(cards.count, ax) * 0.8);
            });
        });
    });

    it('winds the wood outward and roots it below the ground', () => {
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const c = new THREE.Vector3();
        const n = new THREE.Vector3();
        FOREST_SPECIMENS.forEach((s, i) => {
            ['hero', 'mid'].forEach((lod) => {
                const { bark } = decodeForestTier(i, lod);
                let inward = 0;
                for (let t = 0; t < bark.index.length; t += 3) {
                    a.fromArray(bark.position, bark.index[t] * 3);
                    b.fromArray(bark.position, bark.index[t + 1] * 3).sub(a);
                    c.fromArray(bark.position, bark.index[t + 2] * 3).sub(a);
                    b.cross(c);
                    n.set(0, 0, 0);
                    for (let k = 0; k < 3; k += 1) {
                        n.x += bark.normal[bark.index[t + k] * 3];
                        n.y += bark.normal[(bark.index[t + k] * 3) + 1];
                        n.z += bark.normal[(bark.index[t + k] * 3) + 2];
                    }
                    if (b.length() > 1e-6 && b.dot(n) < 0) inward += 1;
                }
                expect(inward, `${s.id} ${lod}`).toBeLessThanOrEqual(Math.ceil(bark.index.length / 3 / 40));
                let foot = Infinity;
                for (let v = 0; v < bark.verts; v += 1) foot = Math.min(foot, bark.position[(v * 3) + 1]);
                expect(foot, `${s.id} ${lod} foot`).toBeLessThan(-0.5);
            });
            expect(forestBarkTile(s), s.id).toBeGreaterThanOrEqual(61);
            expect(forestSkirt(i), s.id).toBeGreaterThan(0);
        });
        // A stone pine's crown is overhead; a thicket is all skirt.
        const skirt = (id) => forestSkirt(forestSpecimenIndex(id));
        expect(skirt('stone-pine-old')).toBeLessThan(1.5);
        expect(skirt('thicket')).toBeGreaterThan(1.5);
    });
});

describe('the photographs', () => {
    it('are as large as the plan says, with an alpha channel', () => {
        expect(pngSize('../assets/forest/leaves.png'))
            .toEqual([FOREST_ATLAS.cols * FOREST_ATLAS.tile, FOREST_ATLAS.rows * FOREST_ATLAS.tile, 6]);
        expect(pngSize('../assets/forest/far.png'))
            .toEqual([FOREST_FAR.cols * FOREST_FAR.tile, FOREST_FAR.rows * FOREST_FAR.tile, 6]);
    });

    it('frame each far tree whole, inside its tile with a margin', () => {
        const views = FOREST_FAR.azimuths * FOREST_FAR.elevations.length;
        expect(FOREST_FAR.specimens.length * views).toBeLessThanOrEqual(FOREST_FAR.cols * FOREST_FAR.rows);
        FOREST_FAR.specimens.forEach((f) => {
            const s = FOREST_SPECIMENS[forestSpecimenIndex(f.name)];
            expect(forestFarIndex(f.name)).toBeGreaterThanOrEqual(0);
            f.frames.forEach(([wide, mid, half], k) => {
                const e = FOREST_FAR.elevations[k] * (Math.PI / 180);
                expect(wide, f.name).toBeGreaterThan(s.reach * 1.02);
                // Its top and its foot, as that view sees them, are inside the frame.
                expect(mid + half, f.name).toBeGreaterThan(s.height * Math.cos(e) * 1.01);
                expect(mid - half, f.name).toBeLessThan(0);
            });
        });
    });
});

describe('the pull texture', () => {
    const pull = buildForestPull();

    it('lays every tier out once, in a texture every backend can hold', () => {
        expect(Math.log2(FOREST_PULL_WIDTH) % 1).toBe(0);
        expect(pull.width).toBe(FOREST_PULL_WIDTH);
        expect(pull.height).toBeLessThanOrEqual(2048);
        FOREST_SPECIMENS.forEach((s, i) => {
            ['hero', 'mid'].forEach((lod) => {
                const r = pull.ranges[lod][i];
                expect(r.cards).toBe(s[lod].cards);
                expect(r.barkAt).toBe(r.cardAt + (r.cards * 4));
                expect((r.barkAt + (r.barkVerts * 2)) * 4).toBeLessThanOrEqual(pull.data.length);
                // A float holds its first texel exactly (the vertex shader reads it as one).
                expect(r.barkAt + (r.barkVerts * 2)).toBeLessThan(2 ** 24);
            });
        });
    });

    it('survives half floats: tiles, randoms and bark places come back whole', () => {
        const half = (v) => THREE.DataUtils.fromHalfFloat(THREE.DataUtils.toHalfFloat(v));
        FOREST_SPECIMENS.forEach((s, i) => {
            const r = pull.ranges.hero[i];
            for (let c = 0; c < r.cards; c += 1) {
                const v = pull.data[((r.cardAt + (c * 4) + 2) * 4) + 3];
                if (half(v) !== v) throw new Error(`${s.id} card ${c}: ${v}`);
                if (v - Math.floor(v) >= 0.5) throw new Error(`${s.id} card ${c}: random`);
            }
            for (let b = 0; b < r.barkVerts; b += 1) {
                const v = pull.data[((r.barkAt + (b * 2) + 1) * 4) + 3];
                if (half(v) !== v) throw new Error(`${s.id} bark ${b}: ${v}`);
            }
        });
    });
});

describe('the colours', () => {
    it('shade deeper and never greyer, at exactly the species\' ratio', () => {
        const sat = (c) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
        ODYSSEY_FOREST_SPECIES.forEach((sp) => {
            for (let h = 0; h <= 1; h += 0.25) {
                const { crown, shade } = forestColours(sp.id, { hue: h });
                expect(luma(shade) / luma(crown), sp.id).toBeCloseTo(sp.shade, 5);
                expect(sat(shade), sp.id).toBeGreaterThanOrEqual(sat(crown) - 1e-6);
            }
        });
        expect(shadeColourFor([0.2, 0.3, 0.1], getForestSpecies('oak'))).toHaveLength(3);
    });

    it('vary from tree to tree inside the species, not out of it', () => {
        ODYSSEY_FOREST_SPECIES.filter((s) => s.ramp.length > 1).forEach((sp) => {
            const a = forestColours(sp.id, { hue: 0 }).crown;
            const b = forestColours(sp.id, { hue: 1 }).crown;
            expect(Math.hypot(...a.map((v, i) => v - b[i])), sp.id).toBeGreaterThan(0.02);
        });
        ['oak', 'beech', 'birch', 'spruce', 'fir', 'larch', 'willow', 'stone-pine', 'scots-pine'].forEach((id) => {
            const { crown } = forestColours(id);
            expect(crown[1], id).toBeGreaterThan(Math.max(crown[0], crown[2]));
        });
        const gold = forestColours('aspen').crown;
        expect(gold[0]).toBeGreaterThan(gold[1]);
    });
});

describe('the meshes', () => {
    const materials = { near: new THREE.MeshBasicMaterial(), far: new THREE.MeshBasicMaterial() };

    it('are one draw whatever stands in them: position and one interleaved buffer', () => {
        const items = FOREST_SPECIMENS.map((_, i) => item(i, { x: i * 20 }));
        const mesh = buildForestMesh({ lod: 'hero', items }, materials);
        const buffers = new Set(Object.values(mesh.geometry.attributes).map((a) => a.data ?? a));
        expect(buffers.size).toBe(2);
        expect(mesh.geometry.instanceCount).toBe(FOREST_SPECIMENS.length);
        FOREST_INSTANCE.layout.forEach(([name]) => expect(mesh.geometry.attributes[name].itemSize).toBe(4));
        mesh.geometry.attributes.aFoot.data.array.forEach((v) => {
            if (!Number.isFinite(v)) throw new Error('instance data');
        });
    });

    it('name every card and bark slot once', () => {
        const { slots, index } = buildForestSlots(3, 6);
        expect(slots.length).toBe(((3 * 4) + 6) * 3);
        expect([slots[0], slots[9], slots[12], slots[33], slots[36]]).toEqual([0, 3, 8, 19, -1]);
        expect(slots[slots.length - 3]).toBe(-6);
        // Two triangles a card over its four corners, and the bark as it comes.
        expect([...index.slice(0, 12)]).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
        expect([...index.slice(18)]).toEqual([12, 13, 14, 15, 16, 17]);
    });

    it('draw fewer, larger cards on a lower tier, never a bare tree', () => {
        const i = forestSpecimenIndex('oak-great');
        const full = buildForestMesh({ lod: 'hero', items: [item(i)] }, materials);
        const low = buildForestMesh({ lod: 'hero', items: [item(i)] }, materials, { cardShare: 0.45 });
        const cards = (m) => m.geometry.attributes.aPull.getY(0);
        expect(cards(low)).toBeLessThan(cards(full) * 0.5);
        expect(low.geometry.attributes.aShade.getW(0)).toBeGreaterThan(1.2);
        expect(full.geometry.attributes.aShade.getW(0)).toBe(1);
        expect(low.geometry.attributes.position.count).toBeLessThan(full.geometry.attributes.position.count);
        expect(forestTier('Low').cards).toBeLessThan(forestTier('High').cards);
        expect(forestTier('no such tier')).toBe(forestTier('High'));
    });

    it('cull by a sphere that holds every crown', () => {
        const items = FOREST_SPECIMENS.map((_, i) => item(i, { x: (i * 37) % 260, z: (i * 61) % 300, y: 290 + (i * 2) }));
        const { center, radius } = buildForestMesh({ lod: 'mid', items }, materials).geometry.boundingSphere;
        items.forEach((t) => {
            const s = FOREST_SPECIMENS[t.specimen];
            [[s.reach, s.height], [-s.reach, s.height], [s.reach, 0]].forEach(([dx, dy]) => {
                expect(center.distanceTo(new THREE.Vector3(t.x + dx, t.y + dy, t.z)), s.id).toBeLessThan(radius);
            });
        });
    });

    it('draw a far tree as one picture, and leave out what has none', () => {
        const [oak, thicket] = ['oak-tall', 'thicket'].map((id) => item(forestSpecimenIndex(id)));
        const far = buildForestMesh({ lod: 'far', items: [oak, thicket] }, materials);
        expect(far.geometry.instanceCount).toBe(1);
        expect(far.geometry.attributes.position.count).toBe(4);
        expect(far.geometry.index.count).toBe(6);
        expect(buildForestMesh({ lod: 'far', items: [thicket] }, materials)).toBe(null);
    });

    it('fetch nothing where there is no browser', () => {
        const t = createForestTextures();
        expect(t.state.ready).toBe(false);
        expect(t.pullTex.image.width).toBe(FOREST_PULL_WIDTH);
        t.dispose();
    });
});

describe('the materials', () => {
    const textures = createForestTextures({ load: false });
    const uTime = uniform(0);
    const uSun = uniform(new THREE.Color(1, 0.95, 0.86));
    const make = () => createForestMaterials({
        pullTex: textures.pullTex,
        leafTex: textures.leafTex,
        farTex: textures.farTex,
        uOn: uniform(1),
        cameraPosition: uniform(new THREE.Vector3(0, 10, 50)),
        positionWorld: uniform(new THREE.Vector3(0, 0, 0)),
        uTime,
        uSunDir: uniform(new THREE.Vector3(0, 1, 0)),
        uSkyHorizon: uniform(new THREE.Color(0.7, 0.8, 0.9)),
        landSunOf: () => uSun.mul(1),
        landHourOf: () => vec4(0, 0, 0, 0),
        dayTurnOf: () => vec4(0, 0, 0, 0),
        gustFront: (xz) => sin(uTime.add(xz.x)),
        cloudLight: () => float(1),
        reachSink: () => float(0),
        hourGold: { gain: 1, tint: [1.2, 1.1, 0.8] },
        silver: 0,
        finish: (c) => c,
    });

    it('cover their edges with MSAA, write depth and opt out of the scene fog', () => {
        Object.values(make()).forEach((m) => {
            expect(m.alphaToCoverage).toBe(true);
            expect(m.transparent).toBe(false);
            expect(m.depthWrite).toBe(true);
            expect(m.fog).toBe(false);
        });
    });

    it('build to WGSL and GLSL without a word, every variable assigned before it is read', () => {
        const mats = make();
        ['hero', 'far'].forEach((lod) => {
            const items = [item(0), item(forestSpecimenIndex('spruce-great'))];
            const mesh = buildForestMesh({ lod, items }, mats);
            [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]].forEach(([name, Builder]) => {
                const r = build(Builder, mesh);
                expect(r.thrown, `${lod} ${name}`).toBeUndefined();
                expect(r.heard, `${lod} ${name}`).toEqual([]);
                expect(r.vertex.length, lod).toBeGreaterThan(500);
                // (A JS operator on a node prints NaN into the shader.)
                expect(r.vertex + r.fragment).not.toMatch(/NaN/);
                if (name === 'WGSL') expect(unassignedReads(r.fragment), `${lod} fragment`).toEqual([]);
            });
        });
    });
});

describe('the composition names only trees that exist', () => {
    it('in its communities and its heroes', () => {
        Object.entries(FOREST_COMMUNITIES).forEach(([name, c]) => {
            ['giant', 'canopy', 'edge', 'young', 'shrub', 'open'].forEach((role) => {
                expect(c[role].length, `${name} ${role}`).toBeGreaterThan(0);
                c[role].forEach(([id]) => {
                    expect(forestSpecimenIndex(id), `${name} ${role} ${id}`).toBeGreaterThanOrEqual(0);
                });
            });
        });
        FOREST_HEROES.forEach((h) => expect(forestSpecimenIndex(h.id), h.id).toBeGreaterThanOrEqual(0));
    });
});
