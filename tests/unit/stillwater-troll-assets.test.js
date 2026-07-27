import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const LODS = [
    { file: 'troll-lod0.glb', minimum: 30_000, maximum: 35_000 },
    { file: 'troll-lod1.glb', minimum: 15_000, maximum: 20_000 },
    { file: 'troll-lod2.glb', minimum: 8_000, maximum: 12_000 },
    { file: 'troll-lod3.glb', minimum: 3_000, maximum: 5_000 },
];

function readGlbJson(file) {
    const buffer = readFileSync(
        new URL(`../../src/themes/stillwater/assets/${file}`, import.meta.url),
    );
    expect(buffer.toString('utf8', 0, 4)).toBe('glTF');
    const jsonLength = buffer.readUInt32LE(12);
    const jsonType = buffer.toString('utf8', 16, 20);
    expect(jsonType).toBe('JSON');
    return JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).trim());
}

function countTriangles(gltf) {
    return gltf.meshes.reduce((total, mesh) => total + mesh.primitives.reduce(
        (meshTotal, primitive) => {
            const indexCount = gltf.accessors[primitive.indices].count;
            return meshTotal + indexCount / 3;
        },
        0,
    ), 0);
}

describe('Stillwater quantized troll LOD assets', () => {
    it.each(LODS)('$file stays inside its authored triangle band', (entry) => {
        const gltf = readGlbJson(entry.file);
        const triangles = countTriangles(gltf);
        expect(triangles).toBeGreaterThanOrEqual(entry.minimum);
        expect(triangles).toBeLessThanOrEqual(entry.maximum);
        expect(gltf.extensionsUsed).toContain('KHR_mesh_quantization');
        expect(gltf.extensionsUsed || []).not.toContain('EXT_meshopt_compression');
        expect(gltf.animations).toHaveLength(1);
        // gltfpack removes constant bone tracks while retaining the authored clip.
        expect(gltf.animations[0].channels).toHaveLength(14);
    });

    it('keeps every shipping LOD smaller than the retained source asset', () => {
        const sourceSize = statSync(
            new URL('../../src/themes/stillwater/assets/troll.glb', import.meta.url),
        ).size;
        LODS.forEach(({ file }) => {
            const lodSize = statSync(
                new URL(`../../src/themes/stillwater/assets/${file}`, import.meta.url),
            ).size;
            expect(lodSize).toBeLessThan(sourceSize * 0.06);
        });
    });
});
