/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Vegetation wind — procedural TSL vertex displacement (NOT bones / not a rig).
// The reusable recipe for "nice" foliage sway:
//   1. height mask  — saturate(localY / height)^stiffness  → base stays planted, tips move most
//   2. layered sway — slow trunk sway + a slower gust envelope so the field surges together
//   3. leaf flutter — high-freq, tiny amplitude, only near the top
//   4. per-plant phase from WORLD position → neighbours move out of sync (free, instance-friendly)
// Every plant species shares the same positionNode logic via makeWindMat(); only amp/stiff/freq differ.
import * as THREE from 'three/webgpu';
import { positionLocal, positionWorld, uniform, vec3, clamp } from 'three/tsl';

export const meta = {
    id: 'wind-sway',
    title: 'Wind Sway (vegetation)',
    description: 'Procedural TSL vertex-wind on low-poly trees, flowers & grass — height-masked sway + gusts + flutter.',
};

export function create({ scene }) {
    const uTime = uniform(0);
    const uWind = uniform(new THREE.Vector2(1, 0.32).normalize()); // wind direction on the XZ plane
    const uStrength = uniform(1.0);                                 // global tuning knob

    // --- shared wind vertex-displacement material factory ---
    function makeWindMat({ color, height, amp, stiff, flutter, freq = 1.0, rough = 0.92, flat = true }) {
        const m = new THREE.MeshStandardNodeMaterial({
            color: new THREE.Color(color), roughness: rough, metalness: 0, flatShading: flat,
        });
        const yN = clamp(positionLocal.y.div(height), 0, 1);   // 0 at base → 1 at top (object space)
        const mask = yN.pow(stiff);                            // stiffer near the ground
        const phase = positionWorld.x.mul(0.6).add(positionWorld.z.mul(0.45)); // per-plant offset

        const t = uTime;
        const sway = t.mul(1.1 * freq).add(phase).sin()
            .add(t.mul(0.47 * freq).add(phase.mul(1.6)).sin().mul(0.5));   // two octaves
        const gust = t.mul(0.22).add(phase.mul(0.2)).sin().mul(0.35).add(0.78); // slow surge 0.43..1.13
        const bend = sway.mul(gust).mul(amp).mul(uStrength).mul(mask);

        const flut = t.mul(7.0 * freq).add(positionLocal.x.mul(9.0)).add(positionLocal.z.mul(9.0)).sin()
            .mul(flutter).mul(uStrength).mul(yN);

        const dx = uWind.x.mul(bend).add(flut);
        const dz = uWind.y.mul(bend).add(flut.mul(0.5));
        const dy = bend.abs().mul(-0.12);   // settle slightly as it leans (fake foreshorten)
        m.positionNode = positionLocal.add(vec3(dx, dy, dz));
        return m;
    }

    const TREE_H = 4.6, FLOWER_H = 1.3, GRASS_H = 0.7;
    const tiers = [0x2f6b34, 0x3a7d3f, 0x6f7d2f].map((c) =>
        makeWindMat({ color: c, height: TREE_H, amp: 0.42, stiff: 1.7, flutter: 0.05 }));
    const matTrunk = makeWindMat({ color: 0x5a3a22, height: TREE_H, amp: 0.42, stiff: 2.6, flutter: 0 });
    const matStem  = makeWindMat({ color: 0x3f7a28, height: FLOWER_H, amp: 0.18, stiff: 1.25, flutter: 0.03 });
    const blooms = { white: 0xf2f2ec, yellow: 0xf3b81e, purple: 0x7a2bd8, pink: 0xd62a78 };
    const matBloom = Object.fromEntries(Object.entries(blooms).map(([k, c]) =>
        [k, makeWindMat({ color: c, height: FLOWER_H, amp: 0.18, stiff: 1.25, flutter: 0.05, rough: 0.5 })]));
    const matGrass = [0x4a8f2a, 0x2f6b22].map((c) =>
        makeWindMat({ color: c, height: GRASS_H, amp: 0.12, stiff: 1.0, flutter: 0.06 }));

    const geos = [];            // geometries to dispose
    const roots = [];           // top-level scene objects to remove
    const mats = [...tiers, matTrunk, matStem, ...Object.values(matBloom), ...matGrass];
    const G = (g) => { geos.push(g); return g; };

    // ground
    const groundMat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0x33502a), roughness: 1 });
    mats.push(groundMat);
    const ground = new THREE.Mesh(G(new THREE.PlaneGeometry(80, 80)), groundMat);
    ground.rotation.x = -Math.PI / 2; scene.add(ground); roots.push(ground);

    // pseudo-random but deterministic
    let s = 1234; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

    // spruce = trunk + 3 stacked cones (one Group; local Y carries true height for the mask)
    function spruce(x, z, h, rad, tierMat) {
        const g = new THREE.Group(); g.position.set(x, 0, z);
        const tg = G(new THREE.CylinderGeometry(0.10, 0.16, 0.9, 6)); tg.translate(0, 0.45, 0);
        g.add(new THREE.Mesh(tg, matTrunk));
        for (let i = 0; i < 3; i++) {
            const z0 = 0.5 + i * (h - 0.8) / 3 * 0.85;
            const th = (h - z0) * 0.92;
            const r = rad * (1 - i / 3 * 0.66);
            const cg = G(new THREE.ConeGeometry(r, th, 7)); cg.translate(0, z0 + th / 2, 0);
            g.add(new THREE.Mesh(cg, tierMat));
        }
        scene.add(g); roots.push(g);
    }
    for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        spruce(Math.cos(a) * (5 + rnd() * 3), -3 - rnd() * 4 + Math.sin(a) * 2,
            4.2 + rnd() * 1.0, 0.9 + rnd() * 0.4, tiers[i % 3]);
    }

    // flower = stem + head (disc head, or a tall thin cone for spikes)
    function flower(x, z, h, kind, mat) {
        const g = new THREE.Group(); g.position.set(x, 0, z);
        const sg = G(new THREE.CylinderGeometry(0.018, 0.03, h, 4)); sg.translate(0, h / 2, 0);
        g.add(new THREE.Mesh(sg, matStem));
        let hg;
        if (kind === 'spike') { hg = G(new THREE.ConeGeometry(0.13, 0.6, 6)); hg.translate(0, h + 0.24, 0); }
        else { hg = G(new THREE.IcosahedronGeometry(0.22, 0)); hg.scale(1, 0.62, 1); hg.translate(0, h + 0.05, 0); }
        g.add(new THREE.Mesh(hg, mat));
        scene.add(g); roots.push(g);
    }
    const fkinds = [['disc', matBloom.white], ['disc', matBloom.yellow], ['spike', matBloom.purple], ['spike', matBloom.pink]];
    for (let i = 0; i < 30; i++) {
        const [k, m] = fkinds[i % fkinds.length];
        flower((rnd() - 0.5) * 16, 0.5 + rnd() * 5.5, 0.95 + rnd() * 0.45, k, m);
    }

    // grass tufts — several short thin blades each, slightly splayed
    for (let t = 0; t < 46; t++) {
        const cx = (rnd() - 0.5) * 18, cz = 0.5 + rnd() * 6.5;
        const n = 3 + Math.floor(rnd() * 3);
        for (let b = 0; b < n; b++) {
            const bg = G(new THREE.ConeGeometry(0.045, 0.32 + rnd() * 0.28, 3));
            const hh = bg.parameters.height; bg.translate(0, hh / 2, 0);
            const mh = new THREE.Mesh(bg, matGrass[(t + b) % 2]);
            mh.position.set(cx + (rnd() - 0.5) * 0.5, 0, cz + (rnd() - 0.5) * 0.5);
            mh.rotation.set((rnd() - 0.5) * 0.3, rnd() * Math.PI, (rnd() - 0.5) * 0.3);
            scene.add(mh); roots.push(mh);
        }
    }

    // lighting + sky
    scene.background = new THREE.Color(0xbfe0f2);
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x33502a, 1.1);
    const key = new THREE.DirectionalLight(0xfff2dd, 2.4); key.position.set(6, 9, 4);
    scene.add(hemi); scene.add(key); roots.push(hemi); roots.push(key);

    return {
        cameraRadius: 16,
        camera(time, camera) {
            camera.position.set(9, 4.2, 11);
            camera.lookAt(0, 1.6, 0);
        },
        update(time) { uTime.value = time; },
        dispose() {
            roots.forEach((o) => scene.remove(o));
            geos.forEach((g) => g.dispose());
            mats.forEach((m) => m.dispose());
        },
    };
}
