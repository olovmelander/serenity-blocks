/**
 * Sunfall — the doline's authored geometry, from scripts/blender/sunfall_assets.py.
 *
 * Three compact GLBs (KHR_mesh_quantization) and a manifest:
 * - `sunfall-shell.glb`: the chamber in chunks small enough for 16-bit indices. Each vertex
 *   carries Cycles bakes: `color` = (ambient occlusion, sky light, sun station 0, sun station 1)
 *   and `_bake` = (sun station 2, 3, 4, flowstone mask). Light is stored as log2 over
 *   `manifest.light.stops` stops below a ceiling, 0 meaning none (`decodeSunfallLight`).
 * - `sunfall-ledge.glb`: the rimstone terrace the eye stands on, the same layout with the
 *   spikemoss mask in place of flowstone.
 * - `sunfall-crowns.glb`: six unit crowns (top at y = 0, `color` = (occlusion, height in the
 *   crown)) and the canopy plan as points: crown top position and `_crown` = (radius,
 *   tree height, variant + tone, kind: 1 for an emergent).
 *
 * Positions are dequantised to metres once at load; normals and bakes stay in their compact
 * normalised encodings, which the node materials read as they are.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './assets/asset-manifest.json';
// Reads a (possibly normalised integer) attribute as floats, bit-identical to the getters.
import { attributeFloats as floats } from '../shared/attribute-floats.js';
import { freshGeometry } from '../shared/fresh-geometry.js';
import { breathe, drainSteps, stepClock } from '../shared/build-steps.js';

export const SUNFALL_ASSET_SCHEMA = 1;
/** How long one slice of the parse and the weld runs before it yields to the page (ms). */
const PARSE_SLICE_MS = 8;
/** Vertices between two looks at the slice's clock, and weld candidates (each 27 cell lookups). */
const CHECK_EVERY = 1024;
const CHECK_CANDIDATES = 64;
export const SUNFALL_ASSET_MANIFEST = manifest;
export const SUNFALL_ASSET_URLS = Object.freeze({
    shell: new URL('./assets/sunfall-shell.glb', import.meta.url).href,
    ledge: new URL('./assets/sunfall-ledge.glb', import.meta.url).href,
    crowns: new URL('./assets/sunfall-crowns.glb', import.meta.url).href,
});

/** Decode one baked light byte (0..1 normalised) the way the shaders do. */
export function decodeSunfallLight(q, ceiling, stops = manifest.light.stops) {
    if (!(q > 0.5 / 255)) return 0;
    return ceiling * 2 ** (q * stops - stops);
}

function worldPositions(object) {
    const out = floats(object.geometry.attributes.position, 3);
    const { position, scale } = object;
    for (let i = 0; i < out.length; i += 3) {
        out[i] = out[i] * scale.x + position.x;
        out[i + 1] = out[i + 1] * scale.y + position.y;
        out[i + 2] = out[i + 2] * scale.z + position.z;
    }
    return out;
}

function meshGeometry(object) {
    const source = object.geometry;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(worldPositions(object), 3));
    ['normal', 'color', '_bake'].forEach((name) => {
        if (source.attributes[name]) geometry.setAttribute(name, source.attributes[name]);
    });
    if (source.index) geometry.setIndex(source.index);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    geometry.name = object.name;
    return geometry;
}

/**
 * Close the slits between a mesh's chunks. Each chunk is quantised on a grid of its own (its
 * bounds over 32767 steps: 12 to 15 mm for the shell), so a vertex two chunks share lands up to
 * about 14 mm apart in them, and the sky showed through the slit as white pixels flickering
 * down the far wall as the eye drifted. Each vertex within `tolerance` of another chunk's
 * vertices moves to its group's mean, the same float in every chunk, so the seam is watertight.
 * Only a vertex inside another chunk's bounds can be on a seam. Returns the vertices welded.
 */
export function weldChunkSeams(geometries, tolerance = 0.05) {
    return drainSteps(weldChunkSeamsSteps(geometries, tolerance));
}

/**
 * `weldChunkSeams` as steps (the load breathes between them): the same weld in the same order,
 * yielding between vertices, candidates and groups once a slice has run `clock`'s budget. In one
 * task the parse and weld held a first Sunfall switch ~30 ms (2026-10-31).
 * @returns {Generator<string, number>} the vertices welded
 */
export function* weldChunkSeamsSteps(geometries, tolerance = 0.05, clock = stepClock(PARSE_SLICE_MS)) {
    if (geometries.length < 2) return 0;
    const boxes = geometries.map((g) => g.boundingBox.clone().expandByScalar(tolerance));
    const at = new THREE.Vector3();
    const pos = ([gi, i]) => geometries[gi].attributes.position.array.subarray(i, i + 3);
    const cellOf = (p) => [0, 1, 2].map((c) => Math.floor(p[c] / tolerance));
    const cand = []; // [chunk, offset of its x in the position array]
    const cells = new Map();
    for (let gi = 0; gi < geometries.length; gi += 1) {
        const p = geometries[gi].attributes.position.array;
        for (let i = 0; i < p.length; i += 3) {
            if (i % (3 * CHECK_EVERY) === 0 && clock.due()) {
                yield 'weld';
                clock.restart();
            }
            at.fromArray(p, i);
            if (!boxes.some((box, bi) => bi !== gi && box.containsPoint(at))) continue;
            const key = cellOf(p.subarray(i, i + 3)).join();
            if (!cells.has(key)) cells.set(key, []);
            cells.get(key).push(cand.length);
            cand.push([gi, i]);
        }
    }
    // Union-find over the candidates of different chunks that lie within the tolerance.
    const parent = cand.map((_, k) => k);
    const root = (k) => {
        let r = k;
        while (parent[r] !== r) r = parent[r];
        return r;
    };
    for (let k = 0; k < cand.length; k += 1) {
        if (k % CHECK_CANDIDATES === 0 && clock.due()) {
            yield 'weld';
            clock.restart();
        }
        const c = cand[k];
        const p = pos(c);
        const [cx, cy, cz] = cellOf(p);
        for (let dx = -1; dx <= 1; dx += 1) {
            for (let dy = -1; dy <= 1; dy += 1) {
                for (let dz = -1; dz <= 1; dz += 1) {
                    for (const j of cells.get([cx + dx, cy + dy, cz + dz].join()) || []) {
                        if (j <= k || cand[j][0] === c[0]) continue;
                        const q = pos(cand[j]);
                        if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) <= tolerance) parent[root(j)] = root(k);
                    }
                }
            }
        }
    }
    const groups = new Map();
    for (let k = 0; k < cand.length; k += 1) {
        if (k % CHECK_EVERY === 0 && clock.due()) {
            yield 'weld';
            clock.restart();
        }
        const r = root(k);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(k);
    }
    let welded = 0;
    let seen = 0;
    for (const members of groups.values()) {
        seen += 1;
        if (seen % CHECK_EVERY === 0 && clock.due()) {
            yield 'weld';
            clock.restart();
        }
        if (members.length < 2) continue;
        const mean = [0, 0, 0];
        members.forEach((k) => pos(cand[k]).forEach((v, c) => { mean[c] += v / members.length; }));
        members.forEach((k) => pos(cand[k]).set(mean));
        welded += members.length;
    }
    for (let gi = 0; gi < geometries.length; gi += 1) {
        if (clock.due()) {
            yield 'weld';
            clock.restart();
        }
        geometries[gi].computeBoundingSphere();
        geometries[gi].computeBoundingBox();
    }
    return welded;
}

function checkSchema(gltf, kind) {
    const extras = gltf.scene.userData || {};
    if (extras.schemaVersion !== SUNFALL_ASSET_SCHEMA || extras.kind !== kind) {
        throw new Error(`[Sunfall] ${kind} asset has schema ${extras.schemaVersion}/${extras.kind}; `
            + `expected ${SUNFALL_ASSET_SCHEMA}/${kind}.`);
    }
}

/** The named meshes' geometries in name order, yielding between meshes once a slice has run. */
function* meshesNamedSteps(gltf, prefix, clock) {
    const out = [];
    gltf.scene.traverse((object) => {
        if (object.isMesh && object.name.startsWith(prefix)) out.push(object);
    });
    out.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    const geometries = [];
    for (let i = 0; i < out.length; i += 1) {
        if (clock.due()) {
            yield 'meshes';
            clock.restart();
        }
        geometries.push(meshGeometry(out[i]));
    }
    return geometries;
}

/** Turn the three parsed GLBs into geometries and the canopy plan. */
export function parseSunfallAssets(gltfs) {
    return drainSteps(parseSunfallAssetsSteps(gltfs));
}

/**
 * `parseSunfallAssets` as steps (loadSunfallAssets breathes between them): the same geometries,
 * welded the same, made in the same order, yielding once a slice has run PARSE_SLICE_MS.
 * @returns {Generator<string, object>}
 */
export function* parseSunfallAssetsSteps({ shell, ledge, crowns }) {
    const clock = stepClock(PARSE_SLICE_MS);
    checkSchema(shell, 'shell');
    checkSchema(ledge, 'ledge');
    checkSchema(crowns, 'crowns');
    let planObject = null;
    crowns.scene.traverse((object) => {
        if (object.isPoints && object.name === 'CanopyPlan') planObject = object;
    });
    if (!planObject) throw new Error('[Sunfall] The crowns asset has no canopy plan.');
    const position = worldPositions(planObject);
    const crown = floats(planObject.geometry.attributes._crown, 4);
    const shellChunks = yield* meshesNamedSteps(shell, 'Shell', clock);
    const ledgeChunks = yield* meshesNamedSteps(ledge, 'Ledge', clock);
    yield* weldChunkSeamsSteps(shellChunks, undefined, clock);
    yield* weldChunkSeamsSteps(ledgeChunks, undefined, clock);
    const crownChunks = yield* meshesNamedSteps(crowns, 'Crown', clock);
    return {
        manifest,
        shell: shellChunks,
        ledge: ledgeChunks,
        crowns: crownChunks,
        plan: { count: position.length / 3, position, crown },
    };
}

/** GLTFLoader's own materials are never drawn; its attributes live on in our geometries. */
function releaseGltf(gltf) {
    gltf?.scene?.traverse((object) => {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material?.dispose?.());
    });
}

/**
 * The game's own load (the default loader), kept for the session: parsing and welding the
 * doline's GLBs cost 97-132 ms of main thread on every Sunfall start, a frame-long hitch in the
 * outgoing theme and the board during an in-play switch (docs/THEME_FLEET_240_2026-10.md §7).
 * The world only references the geometry (meshes and instances), and `disposeSunfallAssets`
 * only releases its GPU copies, which a later renderer uploads again. Loads with an injected
 * loader (tests) are never cached.
 * @type {?Promise<object>}
 */
let sessionAssets = null;

/**
 * Load every authored asset. `isCurrent` lets a superseded theme start abandon the work: a stale
 * load resolves to null (an uncached one disposes what it made).
 */
export async function loadSunfallAssets({ loader, isCurrent = () => true } = {}) {
    const cacheable = loader === undefined;
    if (cacheable && sessionAssets) {
        const assets = await sessionAssets;
        return isCurrent() ? startView(assets) : null;
    }
    const work = loadSunfallAssetsFresh(loader ?? new GLTFLoader());
    if (cacheable) {
        sessionAssets = work;
        work.catch(() => { if (sessionAssets === work) sessionAssets = null; });
    }
    const assets = await work;
    if (!isCurrent()) {
        if (!cacheable) disposeSunfallAssets(assets);
        return null;
    }
    return cacheable ? startView(assets) : assets;
}

/**
 * What one start draws from the session's assets: geometry objects of its own over the kept arrays
 * (shared/fresh-geometry.js), so its dispose() never reaches the next start's buffers. The kept
 * originals are never drawn; the canopy plan is plain data, shared.
 */
function startView(assets) {
    return {
        ...assets,
        shell: assets.shell.map(freshGeometry),
        ledge: assets.ledge.map(freshGeometry),
        crowns: assets.crowns.map(freshGeometry),
    };
}

async function loadSunfallAssetsFresh(loader) {
    const [shell, ledge, crowns] = await Promise.all([
        loader.loadAsync(SUNFALL_ASSET_URLS.shell),
        loader.loadAsync(SUNFALL_ASSET_URLS.ledge),
        loader.loadAsync(SUNFALL_ASSET_URLS.crowns),
    ]);
    // Parsed and welded in slices, a breath before each (shared/build-steps.js), so the theme
    // still playing keeps its frames; the session keeps the result, so it always runs to the end.
    const steps = parseSunfallAssetsSteps({ shell, ledge, crowns });
    let next;
    do {
        // eslint-disable-next-line no-await-in-loop
        await breathe();
        next = steps.next();
    } while (!next.done);
    const assets = next.value;
    [shell, ledge, crowns].forEach(releaseGltf);
    return assets;
}

export function disposeSunfallAssets(assets) {
    if (!assets) return;
    [...(assets.shell || []), ...(assets.ledge || []), ...(assets.crowns || [])].forEach((g) => g.dispose());
}
