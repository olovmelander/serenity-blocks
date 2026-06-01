/* eslint-disable import/no-unresolved */
/**
 * Himalayan Peak AAA — Prayer Flags (lung ta)
 *
 * A delicate string of small fluttering prayer flags arcing across the upper-left
 * as foreground framing, in the traditional 5-color order (blue / white / red /
 * green / yellow). The flags hang from a thin catenary CORD (a real line) so it
 * reads as a strung lung-ta line, not floating cards. Each flag is one small grid
 * whose vertices carry a color, an "attach→free" weight, and a phase; the vertex
 * shader ripples them in the shared wind (more flutter toward the free bottom
 * edge). Brightens slightly with `ignite` so it catches the alpenglow.
 *
 * See docs/HIMALAYAN_PEAK_AAA_PLAN.md §3.5.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial, LineBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    float,
    positionLocal,
    sin,
    uniform,
    vec3,
} from 'three/tsl';

// Traditional lung-ta order: blue (sky), white (air/wind), red (fire),
// green (water), yellow (earth).
const LUNG_TA = [
    [0.16, 0.45, 0.88],
    [0.92, 0.94, 1.0],
    [0.86, 0.22, 0.16],
    [0.20, 0.66, 0.28],
    [0.95, 0.76, 0.18],
];

// Catenary line of the strand at parameter t∈[0,1].
function strandPoint(t, c) {
    const tc = Math.min(Math.max(t, 0), 1);
    return {
        x: c.xStart + (c.xEnd - c.xStart) * t,
        y: c.yLeft + (c.yRight - c.yLeft) * t - c.sag * Math.sin(tc * Math.PI),
    };
}

export function createPrayerFlags(opts = {}) {
    // Strung from a planted pole in the foreground-left, rising diagonally up and
    // OUT of the top of the frame toward the peaks — so it's anchored to the
    // ground (the pole) and has no floating end hanging in the sky.
    const c = {
        xStart: -85, // pole/anchor end (in frame, left third)
        xEnd: -8, // upper end — high enough to exit the top of the frame
        yLeft: 56, // near the foreground valley floor (pole base plants below)
        yRight: 150, // above the visible top → the strand exits frame, no loose end
        sag: 13, // catenary droop
    };
    const N = opts.count ?? 11;
    const zStrand = 25; // mid-foreground depth
    const fw = 6.5; // small flag — slightly taller than wide, like real lung ta
    const fh = 8.0;
    const GX = 2; // width segments (small flags need few)
    const GY = 3; // height segments

    const positions = [];
    const colors = [];
    const frees = [];
    const phases = [];
    const indices = [];
    let vBase = 0;

    for (let i = 0; i < N; i += 1) {
        const t = N > 1 ? i / (N - 1) : 0;
        const p = strandPoint(t, c);
        const col = LUNG_TA[i % LUNG_TA.length];
        const phase = p.x * 0.05 + i * 0.8;

        for (let gy = 0; gy <= GY; gy += 1) {
            for (let gx = 0; gx <= GX; gx += 1) {
                const fx = (gx / GX - 0.5) * fw;
                const fy = gy / GY; // 0 top (attached to cord) → 1 bottom (free)
                positions.push(p.x + fx, p.y - fy * fh, zStrand);
                colors.push(col[0], col[1], col[2]);
                frees.push(fy);
                phases.push(phase);
            }
        }

        const cols = GX + 1;
        for (let gy = 0; gy < GY; gy += 1) {
            for (let gx = 0; gx < GX; gx += 1) {
                const a = vBase + gy * cols + gx;
                const b = a + 1;
                const cc = a + cols;
                const d = cc + 1;
                indices.push(a, cc, b, b, cc, d);
            }
        }
        vBase += (GX + 1) * (GY + 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aFree', new THREE.Float32BufferAttribute(frees, 1));
    geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
    geometry.setIndex(indices);

    const uTime = uniform(0);
    const uGust = uniform(0);
    const uIgnite = uniform(0);
    const WIND_SPEED = 2.2;

    const material = new MeshBasicNodeMaterial({ side: THREE.DoubleSide });

    // Plain JS helper that inlines nodes (returns a JS struct of nodes → not an Fn).
    const rippleTerms = () => {
        const free = attribute('aFree').toVar();
        const phase = attribute('aPhase').toVar();
        // Amplitude scaled to the small flag size so they flutter, not whip.
        const windAmp = float(1.1).add(uGust.mul(3.6));
        const wave = sin(uTime.mul(WIND_SPEED).add(phase).add(positionLocal.x.mul(0.05)));
        const wave2 = sin(uTime.mul(WIND_SPEED * 1.7).add(phase.mul(1.3)).add(positionLocal.y.mul(0.08)));
        const rip = wave.mul(0.7).add(wave2.mul(0.3)).mul(free).mul(windAmp);
        return { rip, wave, free };
    };

    material.positionNode = Fn(() => {
        const { rip } = rippleTerms();
        return vec3(
            positionLocal.x.add(rip.mul(0.3)),
            positionLocal.y.sub(abs(rip).mul(0.12)),
            positionLocal.z.add(rip),
        );
    })();

    material.colorNode = Fn(() => {
        const { wave, free } = rippleTerms();
        const col = attribute('aColor');
        const fold = float(0.8).add(wave.mul(0.2).mul(free)); // self-shadow folds
        return col.mul(fold);
    })();

    // Faint bloom only when the alpenglow ignites.
    material.emissiveNode = Fn(() => attribute('aColor').mul(uIgnite.mul(0.4)))();
    material.userData.emitsBloom = true;

    const flagMesh = new THREE.Mesh(geometry, material);
    flagMesh.frustumCulled = false;

    // ── The cord the flags hang from (thin dark catenary line). ──
    const cordPts = [];
    const STEPS = Math.max(28, N * 3);
    for (let s = 0; s <= STEPS; s += 1) {
        const t = -0.05 + 1.1 * (s / STEPS); // extend a little past both ends
        const p = strandPoint(t, c);
        cordPts.push(p.x, p.y, zStrand);
    }
    const cordGeo = new THREE.BufferGeometry();
    cordGeo.setAttribute('position', new THREE.Float32BufferAttribute(cordPts, 3));
    const cordMat = new LineBasicNodeMaterial();
    cordMat.colorNode = vec3(0.07, 0.06, 0.05);
    cordMat.emissiveNode = vec3(0.0);
    cordMat.userData.emitsBloom = false;
    const cord = new THREE.Line(cordGeo, cordMat);
    cord.frustumCulled = false;

    // ── Anchor pole at the near end (planted in the valley floor). It extends
    // well below the endpoint so the terrain occludes its base → reads as "stuck
    // in the ground," grounding the whole strand. ──
    const anchor = strandPoint(0, c);
    const poleH = 170;
    const poleGeo = new THREE.CylinderGeometry(0.5, 1.1, poleH, 6);
    const poleMat = new MeshBasicNodeMaterial();
    poleMat.colorNode = vec3(0.14, 0.10, 0.07); // dark weathered wood
    poleMat.emissiveNode = vec3(0.0);
    poleMat.userData.emitsBloom = false;
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(anchor.x, anchor.y - poleH / 2, zStrand); // top at the cord end
    pole.frustumCulled = false;

    const group = new THREE.Group();
    group.frustumCulled = false;
    group.add(pole);
    group.add(cord);
    group.add(flagMesh);

    return {
        mesh: group,
        update(time, gust = 0, ignite = 0) {
            uTime.value = time;
            uGust.value = gust;
            uIgnite.value = ignite;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
            cordGeo.dispose();
            cordMat.dispose();
            poleGeo.dispose();
            poleMat.dispose();
        },
    };
}
