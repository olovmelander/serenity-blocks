/**
 * What the perch rocks looked like when the ibex's perch check failed: a CI-only flake (2026-11-04
 * onward, `odyssey-ibex.test.js > stands on the perch rocks`: topAt(...) - H(...) = -Infinity) that
 * never reproduces on a dev machine. Built only on failure, into the assertion's message, so the
 * next CI failure names the field that went wrong: the Node and CPU, each seated rock's own fields,
 * the ground under it, and its near mesh laid out as buildPerchTops lays it (bounds, grid, finite
 * cells).
 */
import os from 'node:os';
import * as THREE from 'three/webgpu';
import {
    ODYSSEY_BOULDERS, ODYSSEY_PERCH_ROCKS, boulderMatrix, buildBoulderGeometry,
} from '../../../src/rendering/odyssey/world/odyssey-boulders.js';

const num = (v) => {
    if (typeof v !== 'number') return `${typeof v}:${String(v)}`;
    return Number.isFinite(v) ? Number(v.toFixed(4)) : String(v);
};

/**
 * @param {{ rocks: object[], topAt: (x: number, z: number) => number }} perch buildPerchTops' result
 * @param {(x: number, z: number) => number} heightAt the ground the test seated them on
 * @param {[number, number]} at the perch spot that failed
 * @returns {string}
 */
export function describePerchFailure(perch, heightAt, at) {
    const lines = [
        `node ${process.version} ${process.arch} ${os.cpus()?.[0]?.model ?? '?'}`,
        `at (${at[0]}, ${at[1]}): topAt ${num(perch.topAt(at[0], at[1]))} H ${num(heightAt(at[0], at[1]))}`,
        `source rocks ${ODYSSEY_PERCH_ROCKS.length}, seated ${perch.rocks.length}`,
    ];
    perch.rocks.forEach((rock, i) => {
        const fields = Object.keys(rock).map((k) => `${k}=${num(rock[k])}`).join(' ');
        lines.push(`rock ${i}: ${fields}`);
        lines.push(`  H(centre) ${num(heightAt(rock.x, rock.z))} topAt(centre) ${num(perch.topAt(rock.x, rock.z))}`);
        try {
            const geo = buildBoulderGeometry(rock.shape, ODYSSEY_BOULDERS.lod.near);
            const pos = geo.attributes.position;
            const m = boulderMatrix(rock);
            const p = new THREE.Vector3();
            let minX = Infinity;
            let maxX = -Infinity;
            let minZ = Infinity;
            let maxZ = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            let bad = 0;
            for (let k = 0; k < pos.count; k += 1) {
                p.set(pos.getX(k), pos.getY(k), pos.getZ(k)).applyMatrix4(m);
                if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) bad += 1;
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            }
            const e = m.elements.map(num).join(',');
            lines.push(`  mesh verts ${pos.count} non-finite ${bad} x[${num(minX)},${num(maxX)}] y[${num(minY)},${num(maxY)}] z[${num(minZ)},${num(maxZ)}]`);
            lines.push(`  grid ${num(Math.ceil((maxX - minX) / 0.2) + 1)} x ${num(Math.ceil((maxZ - minZ) / 0.2) + 1)}; matrix ${e}`);
            geo.dispose();
        } catch (error) {
            lines.push(`  mesh threw: ${error?.message ?? error}`);
        }
    });
    return `\n${lines.join('\n')}`;
}
