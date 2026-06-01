/* eslint-disable import/no-unresolved */
/**
 * Pyrestorm V2 — Volcano
 *
 * The central cone (welded LatheGeometry — carries the seam fix from the WebGL
 * theme: drop uv/normal, mergeVertices, recompute normals so the per-vertex
 * shading doesn't tear open along +Z), a molten crater lake, and a ring of
 * jagged rim peaks. Cone + peaks share one lit rock material; the lake is a
 * dedicated emissive lava disc. All three share one time/intensity/pulse
 * uniform set so the orchestrator updates them in one place.
 */
import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    clamp, float, positionWorld, uniform, vec3,
} from 'three/tsl';
import { createRockMaterial } from '../materials/rock-material.js';
import { warpedFbm3, heatRamp } from '../materials/tsl-fire-lib.js';

const BASE_Y = -150; // cone base sits on the molten plain
const CRATER_FLOOR_WORLD = 150; // profile floor (300) + base offset (-150)

function buildConeGeometry(segments) {
    const points = [
        new THREE.Vector2(0, 300),
        new THREE.Vector2(75, 300),
        new THREE.Vector2(150, 305),
        new THREE.Vector2(250, 310),
        new THREE.Vector2(300, 350), // rim
        new THREE.Vector2(450, 175),
        new THREE.Vector2(675, 88),
        new THREE.Vector2(900, 0),
    ];
    let geo = new THREE.LatheGeometry(points, segments);

    const pos = geo.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i];
        const z = pos[i + 2];
        const dist = Math.hypot(x, z);
        if (dist > 250 * 0.8) {
            const noise = Math.sin(x * 0.015) * Math.cos(z * 0.015) * 15;
            const fine = Math.sin(x * 0.04 + z * 0.04) * 8;
            pos[i + 1] += noise + fine;
        }
    }
    // Weld the lathe seam before recomputing normals (see WebGL theme fix).
    geo.deleteAttribute('uv');
    geo.deleteAttribute('normal');
    geo = mergeVertices(geo);
    geo.computeVertexNormals();
    return geo;
}

function buildCraterLake(uniforms) {
    const geo = new THREE.CircleGeometry(240, 64);
    geo.rotateX(-Math.PI / 2);

    const lp = positionWorld;
    const flow = warpedFbm3(
        vec3(lp.x.mul(0.01), lp.z.mul(0.01), uniforms.uTime.mul(0.1)),
        float(0.9),
    );
    const heat = clamp(flow.mul(0.7).add(0.45).add(uniforms.uLavaPulse.mul(0.3)), 0.0, 1.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = heatRamp(heat);
    material.fog = true;

    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = CRATER_FLOOR_WORLD + 2;
    mesh.frustumCulled = false;
    return { mesh, geo, material };
}

function buildRimPeaks(uniforms) {
    const peakCount = 18;
    const geo = new THREE.ConeGeometry(60, 1, 5); // unit height; scaled per instance
    geo.translate(0, 0.5, 0); // pivot at base

    const { material } = createRockMaterial({
        baseColor: vec3(0.07, 0.045, 0.045),
        uniforms,
    });

    const peaks = new THREE.InstancedMesh(geo, material, peakCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < peakCount; i += 1) {
        const angle = (i / peakCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
        const r = 320 + Math.random() * 120;
        dummy.position.set(Math.cos(angle) * r, 125, Math.sin(angle) * r);
        const w = 0.8 + Math.random() * 0.8;
        const hgt = 150 + Math.random() * 220;
        dummy.scale.set(w, hgt, w);
        dummy.rotation.y = Math.random() * Math.PI * 2;
        dummy.rotation.x = (Math.random() - 0.5) * 0.3;
        dummy.rotation.z = (Math.random() - 0.5) * 0.3;
        dummy.updateMatrix();
        peaks.setMatrixAt(i, dummy.matrix);
    }
    peaks.instanceMatrix.needsUpdate = true;
    peaks.frustumCulled = false;
    return { peaks, geo, material };
}

export function createVolcano({ segments = 128 } = {}) {
    const uniforms = {
        uTime: uniform(0),
        uIntensity: uniform(0),
        uLavaPulse: uniform(0),
    };

    const group = new THREE.Group();

    // Cone
    const coneGeo = buildConeGeometry(segments);
    const { material: coneMat } = createRockMaterial({
        baseColor: vec3(0.06, 0.04, 0.04),
        lavaChannels: true,
        channelStrength: 1.1,
        uniforms,
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.y = BASE_Y;
    cone.frustumCulled = false;
    group.add(cone);

    // Crater lava lake
    const lake = buildCraterLake(uniforms);
    group.add(lake.mesh);

    // Rim peaks
    const rim = buildRimPeaks(uniforms);
    group.add(rim.peaks);

    return {
        group,
        uniforms,
        dispose() {
            coneGeo.dispose();
            coneMat.dispose();
            lake.geo.dispose();
            lake.material.dispose();
            rim.geo.dispose();
            rim.material.dispose();
        },
    };
}
