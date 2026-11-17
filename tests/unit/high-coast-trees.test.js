/**
 * High Coast's authored trees and the hamlet's buildings: the pack on disk is what the manifest
 * pins and what the theme loads; the old pine parses to sane data, keeps its crown inside the
 * reach the framing rule assumes, sits its roots on the rock, and casts a shadow table that fits;
 * the forest draws one sprite per site from the sheets' tiles; the hamlet's buildings are one
 * finite mesh, and their shadow patch lies in the land's own mesh. CPU only.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    EYE, PINE_FRAME, PLACES,
} from '../../src/themes/high-coast/high-coast-core.js';
import { planCoast } from '../../src/themes/high-coast/high-coast-assets.js';
import { groundHeight } from '../../src/themes/high-coast/high-coast-field.js';
import { fanPositionSteps } from '../../src/themes/high-coast/high-coast-land.js';
import { tierFor } from '../../src/themes/high-coast/high-coast-quality.js';
import {
    HIGH_COAST_FOLIAGE_URL, HIGH_COAST_PINE_URL, HIGH_COAST_SPRITE_NORMAL_URL, HIGH_COAST_SPRITE_URL,
    HIGH_COAST_TREE_SCHEMA, disposeHighCoastTrees, highCoastSpriteLayout,
} from '../../src/themes/high-coast/high-coast-tree-assets.js';
import {
    OLD_PINE, OLD_PINE_BRUSH, crownCasters, keptSprays, oldPineYaw, seatOnRock,
} from '../../src/themes/high-coast/high-coast-old-pine.js';
import { PINE_SHADOW, bakeNeedleTexture, pineFrame } from '../../src/themes/high-coast/high-coast-pine.js';
import {
    FOREST_SPRITES, createForest, siteSprite, spriteTiles,
} from '../../src/themes/high-coast/high-coast-forest.js';
import {
    HOUSE_SHADOWS, PART, WALL, buildCottages, houseShadows, yardPatch,
} from '../../src/themes/high-coast/high-coast-cottages.js';
import { hamletSites } from '../../src/themes/high-coast/high-coast-hamlet.js';
import { HighCoastWorld } from '../../src/themes/high-coast/high-coast-world.js';
import { createNoiseTexture, createUniforms } from '../../src/themes/high-coast/high-coast-tsl.js';
import { HIGH_COAST_ASSETS, readHighCoastTrees } from './helpers/high-coast-trees.js';

vi.setConfig({ testTimeout: 120_000 });

const manifest = JSON.parse(readFileSync(new URL('trees-manifest.json', HIGH_COAST_ASSETS), 'utf8'));
const fileNameOf = (url) => decodeURIComponent(new URL(url).pathname.split('/').pop());
const TREE_FILES = ['high-coast-foliage.glb', 'high-coast-trees-normal.png', 'high-coast-trees.png', 'pine-old.glb'];
const COAST_FILES = ['coast-far.png', 'coast-mid.png', 'coast-near.png'];
const finite = (array) => array.every(Number.isFinite);

let fields;
let ground;
let trees;
beforeAll(async () => {
    fields = planCoast();
    ground = (x, z) => groundHeight(fields, x, z, true);
    trees = await readHighCoastTrees();
});

describe('High Coast tree pack on disk', () => {
    it('ships the files the manifest names, byte for byte, and nothing else', () => {
        expect(manifest.schemaVersion).toBe(HIGH_COAST_TREE_SCHEMA);
        expect(manifest.assets.map((entry) => entry.file).sort()).toEqual(TREE_FILES);
        for (const entry of manifest.assets) {
            const bytes = readFileSync(new URL(entry.file, HIGH_COAST_ASSETS));
            expect(bytes.length, entry.file).toBe(entry.bytes);
            expect(createHash('sha256').update(bytes).digest('hex'), entry.file).toBe(entry.sha256);
        }
        const shipped = readdirSync(HIGH_COAST_ASSETS).filter((file) => /\.(glb|gltf|png|jpe?g|webp|ktx2|bin)$/i.test(file)).sort();
        expect(shipped).toEqual([...COAST_FILES, ...TREE_FILES].sort());
        expect(readdirSync(HIGH_COAST_ASSETS).filter((file) => !shipped.includes(file)).sort())
            .toEqual(['ATTRIBUTION.md', 'coast-manifest.json', 'trees-manifest.json']);
    });

    it('is loaded by module-relative URLs that land in the pack', () => {
        const urls = [HIGH_COAST_PINE_URL, HIGH_COAST_FOLIAGE_URL, HIGH_COAST_SPRITE_URL, HIGH_COAST_SPRITE_NORMAL_URL];
        expect(urls.map(fileNameOf).sort()).toEqual(TREE_FILES);
        for (const url of urls) {
            if (new URL(url).protocol === 'file:') {
                expect(fileURLToPath(url)).toBe(fileURLToPath(new URL(fileNameOf(url), HIGH_COAST_ASSETS)));
            }
        }
    });

    it('keeps the old pine under 1.2 MB and each sprite sheet under 900 KB', () => {
        const size = (file) => statSync(new URL(file, HIGH_COAST_ASSETS)).size;
        expect(size('pine-old.glb')).toBeLessThan(1.2 * 1024 * 1024);
        expect(size('high-coast-foliage.glb')).toBeLessThan(40 * 1024);
        expect(size('high-coast-trees.png')).toBeLessThan(900 * 1024);
        expect(size('high-coast-trees-normal.png')).toBeLessThan(900 * 1024);
    });

    it('keeps its sources strict UTF-8 with Unix line endings, and says how every file was made', () => {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        const sources = [
            new URL('../../scripts/blender/high_coast_assets.py', import.meta.url),
            ...['species.py', 'needles.py', 'preview.py'].map((file) => new URL(`../../scripts/blender/high_coast/${file}`, import.meta.url)),
            new URL('ATTRIBUTION.md', HIGH_COAST_ASSETS),
            new URL('trees-manifest.json', HIGH_COAST_ASSETS),
        ];
        for (const source of sources) {
            const bytes = readFileSync(source);
            const text = decoder.decode(bytes);
            expect(text.includes('\r'), fileURLToPath(source)).toBe(false);
            expect([bytes[0], bytes[1], bytes[2]], fileURLToPath(source)).not.toEqual([0xef, 0xbb, 0xbf]);
        }
        const attribution = readFileSync(new URL('ATTRIBUTION.md', HIGH_COAST_ASSETS), 'utf8');
        for (const file of [...TREE_FILES, ...COAST_FILES]) expect(attribution, file).toContain(file);
        expect(attribution).toContain('scripts/blender/high_coast_assets.py');
        expect(attribution).toContain('scripts/high-coast/bake-coast.mjs');
    });

    it('owns its loader: it imports nothing from another theme', () => {
        const source = readFileSync(new URL('../../src/themes/high-coast/high-coast-tree-assets.js', import.meta.url), 'utf8');
        const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
        expect(imports.sort()).toEqual(['../shared/attribute-floats.js', '../shared/decoded-texture.js',
            './assets/trees-manifest.json', 'three/addons/loaders/GLTFLoader.js', 'three/webgpu'].sort());
    });
});

describe('High Coast old pine (authored)', () => {
    const foot = () => new THREE.Vector3(PLACES.pine.x, ground(PLACES.pine.x, PLACES.pine.z), PLACES.pine.z);
    const frameOf = () => {
        const f = foot();
        return pineFrame(f.x, f.y, f.z, oldPineYaw(f.x, f.z));
    };

    it('parses to finite sites with unit rotations and shares in range', () => {
        const { pine, foliage } = trees;
        const { sites } = pine;
        expect(sites.count).toBeGreaterThan(1500);
        expect(sites.count).toBeLessThan(2600);
        expect(finite(sites.position)).toBe(true);
        for (let i = 0; i < sites.count; i += 1) {
            const q = sites.rotation.subarray(i * 4, i * 4 + 4);
            expect(Math.abs(Math.hypot(...q) - 1)).toBeLessThan(2e-3);
            const bent = sites.bent.subarray(i * 3, i * 3 + 3);
            expect(Math.abs(Math.hypot(...bent) - 1)).toBeLessThan(0.05);
            expect(sites.scale[i]).toBeGreaterThan(0.8);
            expect(sites.scale[i]).toBeLessThan(1.8);
            for (const share of [sites.sky[i], sites.sway[i], sites.phase[i], sites.hue[i]]) {
                expect(share).toBeGreaterThanOrEqual(0);
                expect(share).toBeLessThanOrEqual(1);
            }
            expect(sites.variant[i]).toBeLessThan(foliage.variants);
        }
        // Its needles hang over the eye's head, not at its feet.
        let lowest = Infinity;
        for (let i = 0; i < sites.count; i += 1) lowest = Math.min(lowest, sites.position[i * 3 + 1]);
        expect(lowest).toBeGreaterThan(6.5);
        expect(pine.foliage).toBe('pine_shoots');
        for (let v = 0; v < foliage.variants; v += 1) {
            const spray = foliage.meshes[`${pine.foliage}_${v}`];
            expect(spray, `spray ${v}`).toBeTruthy();
            expect(spray.attributes.uv, `spray ${v} uv`).toBeTruthy();
            expect(spray.index.count / 3).toBeLessThan(220);
        }
    });

    it('carries the bark the material reads, the limbs after the bole and the twigs last', () => {
        const { bark, barkLevelIndices, trunkLine } = trees.pine;
        for (const name of ['position', 'normal', 'uv', 'color', '_wood']) expect(bark.attributes[name], name).toBeTruthy();
        expect(finite(bark.attributes.position.array)).toBe(true);
        expect(barkLevelIndices).toHaveLength(4);
        for (let i = 1; i < 4; i += 1) expect(barkLevelIndices[i]).toBeGreaterThan(barkLevelIndices[i - 1]);
        expect(barkLevelIndices[3]).toBe(bark.index.count);
        expect(barkLevelIndices.every((n) => n % 3 === 0)).toBe(true);
        expect(bark.index.count / 3).toBeLessThan(45000);
        // The bole's line climbs from the rock to the leader and thins as it goes.
        expect(trunkLine.length).toBeGreaterThan(8);
        for (let i = 1; i < trunkLine.length; i += 1) {
            expect(trunkLine[i][1]).toBeGreaterThan(trunkLine[i - 1][1]);
            expect(trunkLine[i][3]).toBeLessThanOrEqual(trunkLine[i - 1][3] + 1e-6);
        }
        expect(trunkLine[0][3]).toBeGreaterThan(0.35);
    });

    it('keeps the crown inside the reach the framing rule assumes', () => {
        const frame = frameOf();
        const { sites } = trees.pine;
        const v = new THREE.Vector3();
        let right = -Infinity;
        for (let i = 0; i < sites.count; i += 1) {
            v.fromArray(sites.position, i * 3).applyMatrix4(frame.matrix);
            // A spray reaches OLD_PINE.reach of its scale from its site: as an angle from the eye.
            const reach = (Math.atan2(sites.scale[i] * OLD_PINE.reach, Math.hypot(v.x - EYE.x, v.z - EYE.z)) * 180) / Math.PI;
            right = Math.max(right, (Math.atan2(v.x - EYE.x, -(v.z - EYE.z)) * 180) / Math.PI + reach);
        }
        expect(right).toBeLessThanOrEqual(PINE_FRAME.crown);
        // And it does hang over the view: well right of its own bole.
        expect(right).toBeGreaterThan(PINE_FRAME.trunk + 15);
    });

    it('turns its front to the eye', () => {
        const frame = frameOf();
        const front = new THREE.Vector3(0, 0, 1).transformDirection(frame.matrix);
        const toEye = new THREE.Vector3(EYE.x - frame.foot.x, 0, EYE.z - frame.foot.z).normalize();
        expect(front.dot(toEye)).toBeGreaterThan(0.9999);
    });

    it('keeps the same sprays every time, a tier\'s share of them', () => {
        const { count } = trees.pine.sites;
        expect(keptSprays(count, 1)).toHaveLength(count);
        for (const quality of ['Minimal', 'Low', 'Medium']) {
            const share = tierFor(quality).sprays;
            const kept = keptSprays(count, share);
            expect(kept).toEqual(keptSprays(count, share));
            expect(Math.abs(kept.length / count - share), quality).toBeLessThan(0.05);
        }
        expect(tierFor('High').sprays).toBe(1);
    });

    it('fits the shadow\'s casters in their table: plates flat, the bole round', () => {
        const frame = frameOf();
        const rows = crownCasters(trees.pine, frame);
        expect(rows.length).toBeLessThanOrEqual(PINE_SHADOW.rows);
        const plates = rows.filter((r) => r.w > 0);
        expect(plates.length).toBe(OLD_PINE.plates);
        expect(rows.filter((r) => r.w < 0).length).toBe(trees.pine.trunkLine.length);
        for (const r of rows) expect([r.x, r.y, r.z, r.w].every(Number.isFinite)).toBe(true);
        for (const p of plates) {
            expect(p.w).toBeGreaterThan(0.5);
            expect(p.w).toBeLessThan(4);
            // Plates are in the world: over the summit, above the foot.
            expect(p.y).toBeGreaterThan(frame.foot.y + 6);
        }
        // The same plates every time.
        const again = crownCasters(trees.pine, frame);
        rows.forEach((r, i) => expect(r.equals(again[i])).toBe(true));
    });

    it('lays its roots on the rock and leaves the rest where it was', async () => {
        const fresh = await readHighCoastTrees();
        const { pine } = fresh;
        const before = Float32Array.from(pine.bark.attributes.position.array);
        const frame = frameOf();
        // A summit that rises a metre for every four toward +x of the world.
        seatOnRock(pine, frame, (x) => frame.foot.y + (x - frame.foot.x) * 0.25);
        const after = pine.bark.attributes.position.array;
        const wood = pine.bark.attributes._wood;
        let moved = 0;
        const p = new THREE.Vector3();
        for (let i = 0; i < before.length / 3; i += 1) {
            const follows = wood.getY(i);
            const dy = after[i * 3 + 1] - before[i * 3 + 1];
            if (follows === 0) expect(dy).toBe(0);
            else {
                p.set(before[i * 3], before[i * 3 + 1], before[i * 3 + 2]).applyMatrix4(frame.matrix);
                expect(dy).toBeCloseTo((p.x - frame.foot.x) * 0.25 * follows, 4);
                if (Math.abs(dy) > 1e-4) moved += 1;
            }
            expect(after[i * 3]).toBe(before[i * 3]);
            expect(after[i * 3 + 2]).toBe(before[i * 3 + 2]);
        }
        expect(moved).toBeGreaterThan(200);
        disposeHighCoastTrees(fresh);
    });

    it('draws its small shoots bushier than the built pine\'s cards, down the mip chain', () => {
        const thin = bakeNeedleTexture(128);
        const bushy = bakeNeedleTexture(128, 0x5e1, OLD_PINE_BRUSH);
        expect(bushy.coverage[0]).toBeGreaterThan(thin.coverage[0] * 1.2);
        expect(bushy.coverage[0]).toBeLessThan(0.6);
        for (let k = 1; k <= 5; k += 1) {
            expect(Math.abs(bushy.coverage[k] - bushy.coverage[0]) / bushy.coverage[0]).toBeLessThan(0.5);
        }
        thin.texture.dispose();
        bushy.texture.dispose();
    });
});

describe('High Coast forest sprites', () => {
    it('lays every tile inside the sheet, clear of its neighbours', () => {
        const layout = highCoastSpriteLayout();
        expect(layout.atlasHeight).toBe(256);
        expect(layout.gutter).toBeGreaterThanOrEqual(8);
        const tiles = [...layout.tiles].sort((a, b) => a.x - b.x);
        expect(tiles.filter((tile) => tile.trees === 1 && tile.species === 'pine').length).toBeGreaterThanOrEqual(3);
        expect(tiles.filter((tile) => tile.trees === 1 && tile.species === 'spruce').length).toBeGreaterThanOrEqual(2);
        expect(tiles.filter((tile) => tile.trees > 1).length).toBeGreaterThanOrEqual(3);
        tiles.forEach((tile, i) => {
            expect(tile.x).toBeGreaterThanOrEqual(layout.gutter);
            expect(tile.x + tile.pixels + layout.gutter).toBeLessThanOrEqual(layout.atlasWidth);
            if (i) expect(tile.x - (tiles[i - 1].x + tiles[i - 1].pixels)).toBeGreaterThanOrEqual(layout.gutter * 2);
            // A tile's shape is its tree's: metres per pixel the same both ways.
            expect(tile.width / tile.pixels).toBeCloseTo(tile.height / layout.atlasHeight, 5);
            expect(tile.height).toBeGreaterThan(12);
            expect(tile.height).toBeLessThan(28);
            expect(Math.abs(tile.trunk)).toBeLessThan(0.5);
            expect(tile.coverage).toBeGreaterThan(0.08);
        });
    });

    it('gives a near site one tree of its kind at its own height, a far site a group', () => {
        const tiles = spriteTiles(highCoastSpriteLayout());
        const site = (o) => ({
            x: 0, y: 10, z: -600, kind: 0, height: 15, width: 9, seed: 0.37, lean: 0, d: 600, ...o,
        });
        for (const seed of [0.01, 0.37, 0.62, 0.99]) {
            const pine = siteSprite(site({ seed }), tiles);
            expect(tiles.pines).toContain(pine.tile);
            expect(pine.height).toBe(15);
            // Its own proportions.
            expect(pine.width / pine.height).toBeCloseTo(pine.tile.width / pine.tile.height, 6);
            expect([-1, 1]).toContain(pine.flip);
            const spruce = siteSprite(site({ seed, kind: 1 }), tiles);
            expect(tiles.spruces).toContain(spruce.tile);
            const far = siteSprite(site({
                seed, d: 2400, width: 9 * 2.67, height: 15 * 1.25,
            }), tiles);
            expect(tiles.pineGroups).toContain(far.tile);
            const own = far.tile.width * (far.height / far.tile.height);
            expect(far.width / own).toBeGreaterThanOrEqual(FOREST_SPRITES.stretch[0] - 1e-9);
            expect(far.width / own).toBeLessThanOrEqual(FOREST_SPRITES.stretch[1] + 1e-9);
        }
        // Both ways round, and more than one tile, over many seeds.
        const drawn = Array.from({ length: 200 }, (_, i) => siteSprite(site({ seed: (i * 0.6180339) % 1 }), tiles));
        expect(new Set(drawn.map((s) => s.flip)).size).toBe(2);
        expect(new Set(drawn.map((s) => s.tile.asset)).size).toBe(tiles.pines.length);
    });

    it('draws the forest as one mesh of sprites where the sheets were read, as built trees where not', () => {
        const u = createUniforms();
        const noise = createNoiseTexture();
        const t = { noise, shadow: { near: noise, mid: noise, far: noise } };
        const tier = { ...tierFor('Minimal'), trees: 600 };
        const sprites = createForest(u, t, tier, fields, { sprites: trees.sprites });
        expect(sprites.meshes).toHaveLength(1);
        expect(sprites.mesh.name).toBe('HighCoastForestSprites');
        expect(sprites.mesh.geometry.instanceCount).toBe(sprites.sites.length);
        expect(sprites.sites.length).toBeGreaterThan(100);
        for (const name of ['aTree', 'aTile', 'aLook']) {
            const attribute = sprites.mesh.geometry.attributes[name];
            expect(attribute.count, name).toBe(sprites.sites.length);
            expect(finite(attribute.array), name).toBe(true);
        }
        const built = createForest(u, t, tier, fields);
        expect(built.meshes).toHaveLength(4);
        // The same trees stand in the same places either way.
        expect(built.sites).toEqual(sprites.sites);
        sprites.dispose();
        built.dispose();
        noise.dispose();
    });
});

describe('High Coast hamlet buildings', () => {
    it('stands the same hamlet every time: cottages, boathouses, huts and boats on land', () => {
        const a = hamletSites(fields);
        const b = hamletSites(fields);
        expect(a).toEqual(b);
        expect(a.cottages.length).toBeGreaterThanOrEqual(3);
        expect(a.huts.length).toBeLessThanOrEqual(2);
        expect(a.boats.length).toBeLessThanOrEqual(3);
        for (const site of [...a.cottages, ...a.sheds, ...a.huts, ...a.boats]) {
            expect(ground(site.x, site.z)).toBeGreaterThan(0.3);
            expect(Number.isFinite(site.yaw)).toBe(true);
        }
        // Nothing stands in anything else.
        const solid = [...a.cottages, ...a.sheds, ...a.huts];
        solid.forEach((p, i) => solid.slice(i + 1).forEach((q) => {
            expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(5);
        }));
    });

    it('builds them as one finite mesh whose parts and walls are the ones the material reads', () => {
        const sites = hamletSites(fields);
        const { geometry, solids } = buildCottages(sites, ground);
        const {
            position, normal, aLocal, aWall,
        } = geometry.attributes;
        expect(position.count % 3).toBe(0);
        for (const attribute of [normal, aLocal, aWall]) expect(attribute.count).toBe(position.count);
        for (const attribute of [position, normal, aLocal, aWall]) expect(finite(attribute.array)).toBe(true);
        const parts = new Set();
        const walls = new Set();
        for (let i = 0; i < position.count; i += 1) {
            parts.add(aLocal.getZ(i));
            walls.add(aWall.getZ(i));
            const n = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
            expect(Math.abs(n - 1)).toBeLessThan(1e-4);
        }
        const known = [...Object.values(PART), PART.roof + 0.5];
        for (const part of parts) expect(known, `part ${part}`).toContain(part);
        for (const kind of walls) expect(Object.values(WALL), `wall ${kind}`).toContain(kind);
        for (const part of [PART.wall, PART.trim, PART.plinth, PART.chimney, PART.wood]) expect(parts.has(part)).toBe(true);
        expect(solids).toHaveLength(sites.cottages.length + sites.sheds.length + sites.huts.length);
        for (const s of solids) {
            expect(s.ridge).toBeGreaterThan(s.eaves);
            expect(s.eaves).toBeGreaterThan(ground(s.x, s.z));
            expect(s.floor).toBeLessThan(ground(s.x, s.z));
        }
        geometry.dispose();
    });

    it('lays the shadow patch in the land\'s own mesh', () => {
        const tier = tierFor('Minimal');
        const steps = fanPositionSteps(fields, tier.fanCols, tier.fanRows);
        let next = steps.next();
        while (!next.done) next = steps.next();
        const land = next.value;
        const patch = yardPatch(fields, tier.fanCols, tier.fanRows, PLACES.hamlet, 110);
        const [r0, r1] = patch.rows;
        const [c0, c1] = patch.cols;
        const nc = c1 - c0 + 1;
        const got = patch.geometry.attributes.position.array;
        expect(got.length).toBe((r1 - r0 + 1) * nc * 3);
        for (let r = r0; r <= r1; r += 1) {
            for (let c = c0; c <= c1; c += 1) {
                const o = ((r - r0) * nc + (c - c0)) * 3;
                const l = (r * tier.fanCols + c) * 3;
                expect(got[o]).toBe(land[l]);
                expect(got[o + 1]).toBe(land[l + 1]);
                expect(got[o + 2]).toBe(land[l + 2]);
            }
        }
        // It covers the yard: every corner of the disc's box lies inside its posts' span.
        const far = (i) => Math.hypot(got[i * 3] - EYE.x, got[i * 3 + 2] - EYE.z);
        const away = Math.hypot(PLACES.hamlet.x - EYE.x, PLACES.hamlet.z - EYE.z);
        expect(far(0)).toBeLessThanOrEqual(away - 110);
        expect(far(got.length / 3 - 1)).toBeGreaterThanOrEqual(away + 110);
        patch.geometry.dispose();
    });

    it('casts a shadow for every building, within its table', () => {
        const u = createUniforms();
        const noise = createNoiseTexture();
        const t = { noise, shadow: { near: noise, mid: noise, far: noise } };
        const sites = hamletSites(fields);
        const { geometry, solids } = buildCottages(sites, ground);
        const shade = houseShadows(u, t, fields, tierFor('High'), solids);
        expect(shade.count).toBe(Math.min(solids.length, HOUSE_SHADOWS.solids));
        expect(solids.length).toBeLessThanOrEqual(HOUSE_SHADOWS.solids);
        expect(shade.mesh.material.isNodeMaterial).toBe(true);
        expect(shade.mesh.material.depthWrite).toBe(false);
        shade.geometry.dispose();
        shade.material.dispose();
        geometry.dispose();
        noise.dispose();
    });
});

describe('High Coast world with its authored trees', () => {
    it('builds the old pine and the forest from them, and disposes them with itself', async () => {
        const mine = await readHighCoastTrees();
        const disposed = vi.spyOn(mine.pine.bark, 'dispose');
        const world = new HighCoastWorld({
            scene: new THREE.Scene(), quality: 'Low', capture: true, prepared: { ...HighCoastWorld.prepareSync('Low', fields), trees: mine },
        }).build();
        const names = [];
        world.root.traverse((object) => names.push(object.name));
        expect(names).toContain('HighCoastOldPineBark');
        expect(names).toContain('HighCoastOldPineNeedles0');
        expect(names).toContain('HighCoastOldPineNeedles1');
        expect(names).toContain('HighCoastForestSprites');
        expect(names).toContain('HighCoastPineShadow');
        expect(names).toContain('HighCoastHamletShadow');
        expect(names).not.toContain('HighCoastPineNeedles');
        expect(names).not.toContain('HighCoastPinesNear');
        const pine = world.parts.props.meshes[0];
        let sprays = 0;
        pine.traverse((object) => {
            if (object.isInstancedMesh) sprays += object.count;
        });
        expect(sprays).toBe(keptSprays(mine.pine.sites.count, tierFor('Low').sprays).length);
        world.dispose();
        expect(disposed).toHaveBeenCalled();
        expect(world.trees).toBeNull();
    });

    it('builds its own trees when none were read', () => {
        const world = new HighCoastWorld({
            scene: new THREE.Scene(), quality: 'Minimal', capture: true, prepared: HighCoastWorld.prepareSync('Minimal', fields),
        }).build();
        const names = [];
        world.root.traverse((object) => names.push(object.name));
        expect(names).toContain('HighCoastPineNeedles');
        expect(names).toContain('HighCoastPinesNear');
        expect(names).not.toContain('HighCoastForestSprites');
        // The lowest tier lays no shadows on the yard.
        expect(names).not.toContain('HighCoastHamletShadow');
        world.dispose();
    });
});
