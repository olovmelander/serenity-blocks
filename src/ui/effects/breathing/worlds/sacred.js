/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sacred Geometry — nested solids of light inside a square.
 * Box breathing: light climbs one side of the square for each phase, and the solids open
 * on the in-breath and close on the out-breath.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, exp, float, length, max, mix, positionWorld, select, smoothstep, vec2, vec3,
} from 'three/tsl';
import { backdropPoint, fadeOut, starfield } from '../stage/breath-tsl.js';
import { edgeTubes } from '../stage/breath-geometry.js';
import { MOTE_MOTION } from '../stage/breath-motes.js';

const HALF = 0.74;
const GOLD = vec3(1.0, 0.76, 0.34);
const VIOLET = vec3(0.52, 0.36, 1.0);
const ROSE = vec3(1.0, 0.6, 0.72);

function wireMaterial(tint, gain) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    // Nearer edges burn brighter, so the cage reads as a solid and not a flat drawing.
    material.colorNode = tint.mul(smoothstep(-0.7, 0.7, positionWorld.z).mul(0.75).add(0.25)).mul(gain);
    return material;
}

export function createSacredWorld({ u }) {
    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const r = length(p).toVar();
        const col = mix(vec3(0.03, 0.016, 0.07), vec3(0.004, 0.004, 0.018), smoothstep(0.0, 1.7, r)).toVar();
        col.addAssign(GOLD.mul(exp(r.mul(-2.6))).mul(0.1).mul(u.breath.add(0.4)));
        col.addAssign(VIOLET.mul(exp(r.mul(-1.1))).mul(0.06));
        col.addAssign(starfield(p, u, 0.6).mul(0.7));

        // The flower of life, faint behind everything: seven circles that widen with the breath.
        const a = u.breath.mul(0.07).add(0.4).toVar();
        const stroke = (distance) => exp(distance.abs().mul(-150));
        const flower = stroke(r.sub(a)).add(stroke(r.sub(a.mul(2))).mul(0.6)).toVar();
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const centre = vec2(Math.cos(angle), Math.sin(angle)).mul(a);
            flower.addAssign(stroke(length(p.sub(centre)).sub(a)).mul(fadeOut(a.mul(1.9), a.mul(2.05), r)));
        }
        col.addAssign(VIOLET.mul(flower).mul(0.13));

        // The square. Inhale climbs the left side, the hold crosses the top, the exhale
        // descends the right side, and the empty hold returns along the bottom.
        const q = abs(p).sub(HALF);
        const box = length(max(q, 0)).add(max(q.x, q.y).min(0));
        const span = HALF * 8;
        const s = select(
            p.x.negate().greaterThanEqual(p.y.abs()),
            p.y.add(HALF).div(span),
            select(
                p.y.greaterThanEqual(p.x.abs()),
                p.x.add(HALF).div(span).add(0.25),
                select(
                    p.x.greaterThanEqual(p.y.abs()),
                    float(HALF).sub(p.y).div(span).add(0.5),
                    float(HALF).sub(p.x).div(span).add(0.75),
                ),
            ),
        ).toVar();
        const progress = u.phase.add(u.phaseT).div(4).toVar();
        const line = exp(box.abs().mul(-170)).add(exp(box.abs().mul(-26)).mul(0.16));
        const done = fadeOut(progress.sub(0.004), progress, s);
        const head = exp(s.sub(progress).mul(span).mul(s.sub(progress).mul(span)).div(0.012)
            .negate());
        col.addAssign(GOLD.mul(line).mul(done.mul(0.75).add(0.14)));
        col.addAssign(vec3(1.0, 0.93, 0.74).mul(exp(box.abs().mul(-40))).mul(head).mul(1.6));
        return col;
    })();

    // Three solids, each the dual or the kernel of the next, turning at their own pace.
    const outer = new THREE.Mesh(edgeTubes(new THREE.DodecahedronGeometry(0.6, 0), 0.0055), wireMaterial(VIOLET, 1.3));
    const middle = new THREE.Mesh(edgeTubes(new THREE.IcosahedronGeometry(0.5, 0), 0.0065), wireMaterial(GOLD, 1.9));
    const star = new THREE.Group();
    const tetra = edgeTubes(new THREE.TetrahedronGeometry(0.3, 0), 0.005);
    const starMaterial = wireMaterial(ROSE, 2.1);
    const up = new THREE.Mesh(tetra, starMaterial);
    const down = new THREE.Mesh(tetra, starMaterial);
    down.rotation.set(Math.PI, 0, Math.PI / 2);
    star.add(up, down);
    const solids = new THREE.Group();
    solids.add(outer, middle, star);
    [outer, middle, up, down].forEach((mesh) => { mesh.frustumCulled = false; });

    return {
        backdrop,
        objects: [solids],
        motes: {
            motion: MOTE_MOTION.halo,
            count: 110,
            size: 0.022,
            speed: 1,
            spread: 0.8,
            depth: 1.6,
            colorA: [1.0, 0.78, 0.4],
            colorB: [0.72, 0.56, 1.0],
            gain: 0.5,
        },
        bloom: { strength: 0.75, radius: 0.7, threshold: 0.42 },
        exposure: 1.0,
        update({ time, breath }) {
            const open = 0.8 + breath * 0.3;
            solids.scale.setScalar(open);
            outer.rotation.set(time * 0.05, time * 0.08, 0);
            middle.rotation.set(-time * 0.07, time * 0.045, time * 0.03);
            star.rotation.set(time * 0.09, -time * 0.12, 0);
            star.scale.setScalar(0.85 + breath * 0.35);
        },
    };
}
