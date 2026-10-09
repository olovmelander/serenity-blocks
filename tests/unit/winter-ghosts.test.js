/**
 * Winter — the snow ghosts' meshes (winter-ghosts.js): the committed bake decodes to what its
 * manifest says, the stand-ins match it kind for kind, and every mesh faces outward.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import {
    GHOSTS_MAGIC, GHOSTS_MANIFEST, GHOSTS_URL, GHOST_KINDS, GHOST_LODS, decodeGhosts, ghostMesh, loadGhosts, planGhosts,
} from '../../src/themes/winter/winter-ghosts.js';

/** 0 = the full ghost ... the last = the far one. */
const LODS = Array.from({ length: GHOST_LODS }, (_, lod) => lod);
const FAR = GHOST_LODS - 1;
const assetUrl = new URL('../../src/themes/winter/assets/snow-ghosts.bin', import.meta.url);

/** The committed file as an ArrayBuffer of its own. */
function readAsset() {
    const file = readFileSync(assetUrl);
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

/**
 * How a mesh's triangles are wound: the share whose geometric normal (the cross product of two
 * edges) agrees with the normals stored at their corners, and the share that has no area.
 */
function facing(mesh) {
    const { positions, normals, indices } = mesh;
    let outward = 0;
    let inward = 0;
    let flat = 0;
    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t] * 3;
        const b = indices[t + 1] * 3;
        const c = indices[t + 2] * 3;
        const ux = positions[b] - positions[a];
        const uy = positions[b + 1] - positions[a + 1];
        const uz = positions[b + 2] - positions[a + 2];
        const vx = positions[c] - positions[a];
        const vy = positions[c + 1] - positions[a + 1];
        const vz = positions[c + 2] - positions[a + 2];
        const gx = uy * vz - uz * vy;
        const gy = uz * vx - ux * vz;
        const gz = ux * vy - uy * vx;
        if (Math.hypot(gx, gy, gz) < 1e-10) {
            flat += 1;
        } else {
            let dot = 0;
            for (const corner of [indices[t], indices[t + 1], indices[t + 2]]) {
                dot += gx * normals[corner * 4] + gy * normals[corner * 4 + 1] + gz * normals[corner * 4 + 2];
            }
            if (dot > 0) outward += 1;
            else inward += 1;
        }
    }
    const triangles = indices.length / 3;
    return { outward: outward / triangles, inward: inward / triangles, flat: flat / triangles };
}

/**
 * The volume a mesh encloses, signed: positive when its triangles are wound outward. (Measured
 * from a point at its foot, so the open underside the drift hides adds next to nothing.)
 */
function volume(mesh) {
    const { positions: p, indices } = mesh;
    let sum = 0;
    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t] * 3;
        const b = indices[t + 1] * 3;
        const c = indices[t + 2] * 3;
        const ay = p[a + 1] + 0.15;
        const by = p[b + 1] + 0.15;
        const cy = p[c + 1] + 0.15;
        sum += p[a] * (by * p[c + 2] - p[b + 2] * cy) + ay * (p[b + 2] * p[c] - p[b] * p[c + 2])
            + p[a + 2] * (p[b] * cy - by * p[c]);
    }
    return sum / 6;
}

/** What every mesh must be, baked or generated. */
function expectSound(mesh, label) {
    const count = mesh.positions.length / 3;
    expect(mesh.positions, label).toBeInstanceOf(Float32Array);
    expect(mesh.normals, label).toBeInstanceOf(Int8Array);
    expect(mesh.shade, label).toBeInstanceOf(Uint8Array);
    expect(Number.isInteger(count), label).toBe(true);
    expect(count, label).toBeGreaterThan(8);
    expect(mesh.normals, label).toHaveLength(count * 4);
    expect(mesh.shade, label).toHaveLength(count * 4);
    expect(mesh.indices.length % 3, label).toBe(0);
    expect(mesh.indices.length, label).toBeGreaterThan(0);
    // A sixteen-bit index can only name so many vertices.
    if (mesh.indices instanceof Uint16Array) expect(count, label).toBeLessThanOrEqual(65536);
    else expect(mesh.indices, label).toBeInstanceOf(Uint32Array);
    let highest = 0;
    for (let i = 0; i < mesh.indices.length; i++) highest = Math.max(highest, mesh.indices[i]);
    expect(highest, label).toBeLessThan(count);
    let lowest = Infinity;
    let top = -Infinity;
    let reach = 0;
    for (let v = 0; v < count; v++) {
        const x = mesh.positions[v * 3];
        const y = mesh.positions[v * 3 + 1];
        const z = mesh.positions[v * 3 + 2];
        if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) throw new Error(`${label}: vertex ${v}`);
        lowest = Math.min(lowest, y);
        top = Math.max(top, y);
        reach = Math.max(reach, Math.hypot(x, z));
        // A normal the shader can normalise: about unit once the bytes are read as −1..1.
        const length = Math.hypot(mesh.normals[v * 4], mesh.normals[v * 4 + 1], mesh.normals[v * 4 + 2]) / 127;
        if (!(length > 0.85 && length < 1.15)) throw new Error(`${label}: normal ${v} has length ${length}`);
    }
    // It stands on the snow (a little of its foot is sunk in the drift) and is as tall as it says.
    expect(lowest, label).toBeGreaterThanOrEqual(-0.25);
    expect(lowest, label).toBeLessThan(mesh.height * 0.1);
    // (The coarser levels lose some of a bowed top: only the full ghost is held to its height.)
    expect(top, label).toBeGreaterThan(mesh.height * (mesh.lod === 0 ? 0.9 : 0.7));
    expect(top, label).toBeLessThan(mesh.height * 1.12);
    // A tree, not a pancake: no wider than it is tall.
    expect(reach, label).toBeLessThan(mesh.height);
    expect(reach, label).toBeGreaterThan(mesh.height * 0.05);
}

/** Every kind at every level of detail, the full ghost the heaviest. */
function expectComplete(ghosts) {
    expect(ghosts.meshes).toHaveLength(GHOST_KINDS.length * LODS.length);
    GHOST_KINDS.forEach((kind) => {
        const mine = ghosts.meshes.filter((mesh) => mesh.kind === kind);
        expect(mine.map((mesh) => mesh.lod).sort(), kind).toEqual(LODS);
        // Each level lighter than the one before it.
        const triangles = LODS.map((lod) => mine.find((mesh) => mesh.lod === lod).indices.length / 3);
        for (let lod = 1; lod < LODS.length; lod++) {
            expect(triangles[lod], `${kind} lod ${lod}`).toBeLessThan(triangles[lod - 1]);
        }
        // One kind is modelled at one height, whatever the detail.
        expect(new Set(mine.map((mesh) => mesh.height)).size, kind).toBe(1);
        expect(mine[0].height, kind).toBeGreaterThan(0);
    });
}

describe('winter snow ghosts: the baked asset', () => {
    let buffer;
    let ghosts;
    beforeAll(() => {
        buffer = readAsset();
        ghosts = decodeGhosts(buffer);
    });

    it('is the file its manifest describes, byte for byte', () => {
        expect(GHOSTS_MANIFEST.asset).toBe('snow-ghosts.bin');
        expect(GHOSTS_URL.endsWith('/assets/snow-ghosts.bin')).toBe(true);
        expect(buffer.byteLength).toBe(GHOSTS_MANIFEST.bytes);
        expect(createHash('sha256').update(new Uint8Array(buffer)).digest('hex')).toBe(GHOSTS_MANIFEST.sha256);
        expect(String.fromCharCode(...new Uint8Array(buffer, 0, 4))).toBe(GHOSTS_MAGIC);
    });

    it('decodes one mesh for each entry of the manifest, with its counts', () => {
        expect(ghosts.source).toBe('asset');
        expect(ghosts.meshes).toHaveLength(GHOSTS_MANIFEST.meshes.length);
        GHOSTS_MANIFEST.meshes.forEach((entry, i) => {
            const mesh = ghosts.meshes[i];
            const label = `${entry.kind} lod ${entry.lod}`;
            expect(mesh.kind, label).toBe(entry.kind);
            expect(mesh.lod, label).toBe(entry.lod);
            expect(mesh.height, label).toBe(entry.height);
            expect(mesh.positions.length / 3, label).toBe(entry.vertices);
            expect(mesh.indices.length / 3, label).toBe(entry.triangles);
            expectSound(mesh, label);
        });
        // The arrays are the decoder's own: nothing aliases the file's buffer.
        ghosts.meshes.forEach((mesh) => {
            for (const array of [mesh.positions, mesh.normals, mesh.shade, mesh.indices]) {
                expect(array.buffer).not.toBe(buffer);
            }
        });
    });

    it('holds every kind at every level of detail', () => {
        expect(GHOST_LODS).toBeGreaterThan(1);
        expect([...new Set(ghosts.meshes.map((mesh) => mesh.kind))].sort()).toEqual([...GHOST_KINDS].sort());
        expectComplete(ghosts);
    });

    it('bakes what the shader reads into every vertex', () => {
        ghosts.meshes.forEach((mesh) => {
            const label = `${mesh.kind} lod ${mesh.lod}`;
            const count = mesh.positions.length / 3;
            let open = 0;
            let needles = 0;
            let footed = 0;
            let crowned = 0;
            let heightOff = 0;
            for (let v = 0; v < count; v++) {
                open += mesh.shade[v * 4] / 255;
                if (mesh.shade[v * 4 + 1] > 128) needles += 1;
                if (mesh.shade[v * 4 + 3] < 26) footed += 1;
                if (mesh.shade[v * 4 + 3] > 150) crowned += 1;
                const expected = Math.max(0, Math.min(1, mesh.positions[v * 3 + 1] / mesh.height));
                heightOff = Math.max(heightOff, Math.abs(mesh.shade[v * 4 + 3] / 255 - expected));
            }
            // The height channel is the vertex's own height over the kind's.
            expect(heightOff, label).toBeLessThan(0.01);
            // Mostly open snow, with cavities; a foot and a top.
            expect(open / count, label).toBeGreaterThan(0.25);
            expect(open / count, label).toBeLessThan(0.999);
            expect(footed, label).toBeGreaterThan(0);
            expect(crowned, label).toBeGreaterThan(0);
            // The full ghosts show dark boughs under their pillows.
            if (mesh.lod === 0) expect(needles / count, label).toBeGreaterThan(0.005);
            expect(needles / count, label).toBeLessThan(0.5);
        });
    });

    it('winds its triangles outward: the face normal agrees with the stored normals', () => {
        ghosts.meshes.forEach((mesh) => {
            const { outward, flat } = facing(mesh);
            const label = `${mesh.kind} lod ${mesh.lod}`;
            expect(flat, label).toBeLessThan(0.02);
            // Outward as a whole: the surface encloses a positive volume...
            expect(volume(mesh), label).toBeGreaterThan(0);
            // ...and triangle by triangle, all but a few of them.
            expect(outward, label).toBeGreaterThan(0.9);
            if (mesh.lod < FAR) expect(outward, label).toBeGreaterThan(0.95);
        });
    });

    // (A regression: with normals read from the field's slope, about one triangle in twenty of
    // the sentinel's far mesh was shaded from behind; a mesh that coarse bridges the hollows
    // between pillows. The two coarsest meshes now take their normals from their own faces.)
    it('stores normals that agree with the faces on 95 % of the far meshes\' triangles too', () => {
        ghosts.meshes.filter((mesh) => mesh.lod === FAR).forEach((mesh) => {
            expect(facing(mesh).outward, `${mesh.kind} lod ${mesh.lod}`).toBeGreaterThan(0.95);
        });
    });

    it('refuses a file that is not one, or not all of one', () => {
        const bad = buffer.slice(0);
        new Uint8Array(bad)[0] = 0x58;
        expect(() => decodeGhosts(bad)).toThrow(/not a snow-ghost file/);
        expect(() => decodeGhosts(new ArrayBuffer(64))).toThrow();
        expect(() => decodeGhosts(new ArrayBuffer(0))).toThrow();
        // Cut short anywhere: in the body, in the header, in the first twelve bytes.
        [buffer.byteLength - 1, buffer.byteLength >> 1, 600, 12, 7].forEach((length) => {
            const short = buffer.slice(0, length);
            expect(() => decodeGhosts(short), `${length} bytes`).toThrow();
        });
        // A version this reader does not know.
        const view = new DataView(buffer);
        const headerLength = view.getUint32(4, true);
        const header = new TextDecoder().decode(new Uint8Array(buffer, 12, headerLength));
        expect(header).toContain('"version":1');
        const newer = buffer.slice(0);
        new Uint8Array(newer).set(new TextEncoder().encode(header.replace('"version":1', '"version":7')), 12);
        expect(() => decodeGhosts(newer)).toThrow(/version 7/);
        // The file itself is untouched by all that.
        expect(decodeGhosts(buffer).meshes).toHaveLength(ghosts.meshes.length);
    });
});

describe('winter snow ghosts: the stand-ins', () => {
    it('are generated for the same kinds and levels of detail, and are sound meshes', () => {
        const plan = planGhosts();
        expect(plan.source).toBe('plan');
        expectComplete(plan);
        plan.meshes.forEach((mesh) => expectSound(mesh, `stand-in ${mesh.kind} lod ${mesh.lod}`));
        // The same every time, and each call's arrays are its own.
        const again = planGhosts();
        const bytes = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
        again.meshes.forEach((mesh, i) => {
            const first = plan.meshes[i];
            expect([mesh.kind, mesh.lod, mesh.height]).toEqual([first.kind, first.lod, first.height]);
            for (const name of ['positions', 'normals', 'shade', 'indices']) {
                expect(mesh[name]).not.toBe(first[name]);
                expect(bytes(mesh[name]).equals(bytes(first[name])), `${mesh.kind} ${name}`).toBe(true);
            }
        });
    });

    it('stand as tall as the baked ghosts they stand in for', () => {
        const plan = planGhosts();
        const baked = decodeGhosts(readAsset());
        GHOST_KINDS.forEach((kind) => {
            const real = ghostMesh(baked, kind, 0);
            const stand = ghostMesh(plan, kind, 0);
            // Instances are scaled by tree height over the mesh's height: both must mean the same.
            expect(stand.height / real.height, kind).toBeGreaterThan(0.75);
            expect(stand.height / real.height, kind).toBeLessThan(1.3);
        });
    });

    it('wind their triangles outward as well', () => {
        planGhosts().meshes.forEach((mesh) => {
            const { outward, flat } = facing(mesh);
            const label = `stand-in ${mesh.kind} lod ${mesh.lod}`;
            expect(outward, label).toBeGreaterThan(0.95);
            expect(flat, label).toBeLessThan(0.02);
        });
    });
});

describe('winter snow ghosts: choosing and loading', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('picks the mesh of a kind nearest the level of detail asked for', () => {
        const ghosts = planGhosts();
        GHOST_KINDS.forEach((kind) => {
            LODS.forEach((lod) => {
                const mesh = ghostMesh(ghosts, kind, lod);
                expect(mesh.kind).toBe(kind);
                expect(mesh.lod).toBe(lod);
            });
            expect(ghostMesh(ghosts, kind, 9).lod).toBe(FAR);
            expect(ghostMesh(ghosts, kind, -4).lod).toBe(0);
        });
        // Only some levels there: the nearest of what there is.
        const sparse = { meshes: ghosts.meshes.filter((mesh) => mesh.lod !== 1) };
        expect([0, 2]).toContain(ghostMesh(sparse, 'matron', 1).lod);
        const ends = { meshes: ghosts.meshes.filter((mesh) => mesh.lod === 0 || mesh.lod === FAR) };
        expect(ghostMesh(ends, 'leaner', FAR).lod).toBe(FAR);
        expect(ghostMesh(ends, 'leaner', 0).lod).toBe(0);
        if (FAR > 2) expect(ghostMesh(ends, 'leaner', FAR - 1).lod).toBe(FAR);
        const coarse = { meshes: ghosts.meshes.filter((mesh) => mesh.lod === FAR) };
        expect(ghostMesh(coarse, 'matron', 0).lod).toBe(FAR);
        expect(ghostMesh(coarse, 'matron', 0).kind).toBe('matron');
        // A kind nobody baked: nothing.
        expect(ghostMesh(ghosts, 'palm', 0)).toBeNull();
        expect(ghostMesh({ meshes: [] }, 'gnome', 0)).toBeNull();
    });

    it('loads the asset when it can be fetched whole', async () => {
        const buffer = readAsset();
        const fetched = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => buffer }));
        vi.stubGlobal('fetch', fetched);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ghosts = await loadGhosts();
        expect(fetched).toHaveBeenCalledWith(GHOSTS_URL);
        expect(ghosts.source).toBe('asset');
        expect(ghosts.meshes).toHaveLength(GHOSTS_MANIFEST.meshes.length);
        expect(warn).not.toHaveBeenCalled();
    });

    it('never rejects: a failed, short or damaged read gives the stand-ins, and says so', async () => {
        const buffer = readAsset();
        const damaged = buffer.slice(0);
        new Uint8Array(damaged)[1] = 0x21;
        const answers = [
            async () => { throw new Error('offline'); },
            async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }),
            async () => ({ ok: true, status: 200, arrayBuffer: async () => buffer.slice(0, buffer.byteLength - 16) }),
            async () => ({ ok: true, status: 200, arrayBuffer: async () => damaged }),
        ];
        for (const answer of answers) {
            vi.stubGlobal('fetch', vi.fn(answer));
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            // eslint-disable-next-line no-await-in-loop
            const ghosts = await loadGhosts();
            expect(ghosts.source).toBe('plan');
            expectComplete(ghosts);
            expect(warn).toHaveBeenCalledTimes(1);
            warn.mockRestore();
        }
        // Where there is no fetch at all there is nothing to report.
        vi.stubGlobal('fetch', undefined);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect((await loadGhosts()).source).toBe('plan');
        expect(warn).not.toHaveBeenCalled();
    });
});
