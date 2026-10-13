/**
 * Thermal Bloom — the near snags: two or three dead lodgepole pines standing in the runoff close
 * under the overlook, in the corner on the Iris's side (the frame's scale: a trunk a metre thick
 * a few dozen metres off, against the basin a kilometre deep). Real meshes, not cards: each a
 * tapering, leaning trunk snapped off at its top, with broken branch stubs angled up and out,
 * bone-grey weathered wood with its grain running up the trunk and darker checks in it, and a
 * white sinter sock where it stands in the warm water (wet at its foot). Lit by the low sun with a
 * wrap and the sky above; frost feathers the stubs in First Frost and snow caps them in Deep Cold.
 * Still: they are dead.
 *
 * Built once on the CPU (trunk and stubs merged into one geometry a tree, the trees into one),
 * placed by the world from screen anchors (`place(points)`, world [x, y, z, height, lean,
 * heading] each), mirrored with the layout. Not drawn upright (the margins there are slivers).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    dot,
    float,
    length,
    max,
    mix,
    normalize,
    normalWorld,
    positionWorld,
    smoothstep,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { mulberry32, tbAerial, tbBounce } from './thermal-bloom-tsl.js';

/** A tree's geometry in its own frame (y up from its foot), unit height; `seed` shapes it. */
function snagGeometry(seed, rings = 18, segments = 10) {
    const rand = mulberry32(seed);
    const positions = [];
    const normals = [];
    const ups = [];
    const index = [];
    /** A tapering tube from p0 (radius r0) to p1 (r1) along a straight axis. */
    const tube = (p0, p1, r0, r1, nRings, snap = false) => {
        const axis = new THREE.Vector3().subVectors(p1, p0);
        const len = axis.length();
        axis.normalize();
        const side = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const b1 = new THREE.Vector3().crossVectors(axis, side).normalize();
        const b2 = new THREE.Vector3().crossVectors(axis, b1).normalize();
        const first = positions.length / 3;
        for (let j = 0; j <= nRings; j++) {
            const f = j / nRings;
            // A snapped top: the last ring is torn at a slant and splintered.
            const tear = snap && j === nRings ? 1 : 0;
            const r = r0 + (r1 - r0) * f;
            for (let i = 0; i <= segments; i++) {
                const a = (i / segments) * Math.PI * 2;
                const ca = Math.cos(a);
                const sa = Math.sin(a);
                const splinter = tear ? (0.5 + 0.5 * Math.sin(a * 3 + seed)) * len * 0.06 * (rand() * 0.6 + 0.4) : 0;
                const c = p0.clone().addScaledVector(axis, len * f - (tear ? len * 0.03 * ca : 0) + splinter);
                const n = b1.clone().multiplyScalar(ca).addScaledVector(b2, sa);
                positions.push(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r);
                normals.push(n.x, n.y, n.z);
                ups.push(p0.y + (c.y - p0.y));
            }
        }
        for (let j = 0; j < nRings; j++) {
            for (let i = 0; i < segments; i++) {
                const a = first + j * (segments + 1) + i;
                const b = a + segments + 1;
                index.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
    };
    // The trunk: a slight bow, tapering from about 2.2 % of its height to a third of that.
    const lean = (rand() - 0.5) * 0.16;
    const base = new THREE.Vector3(0, -0.02, 0);
    const mid = new THREE.Vector3(lean * 0.4, 0.5, lean * 0.25);
    const top = new THREE.Vector3(lean, 1.0, lean * 0.5);
    const r0 = 0.03 + rand() * 0.008;
    const flare = new THREE.Vector3(lean * 0.03, 0.05, lean * 0.015);
    tube(base, flare, r0 * 1.7, r0, 2);
    tube(flare, mid, r0, r0 * 0.68, Math.round(rings / 2));
    tube(mid, top, r0 * 0.68, r0 * 0.3, Math.round(rings / 2), true);
    // Broken branch stubs, up the upper two thirds, angled up and out, short and snapped.
    const stubs = 13 + Math.floor(rand() * 6);
    for (let k = 0; k < stubs; k++) {
        const h = 0.28 + 0.66 * (k / stubs) + (rand() - 0.5) * 0.05;
        const at = new THREE.Vector3(lean * h, h, lean * 0.5 * h);
        const az = rand() * Math.PI * 2;
        const up = -0.15 + rand() * 0.75;
        const len = (0.08 + rand() * 0.22) * (1.25 - h * 0.85);
        const dir = new THREE.Vector3(Math.cos(az), up, Math.sin(az)).normalize();
        const rr = r0 * (0.22 + rand() * 0.12) * (1.1 - h * 0.5);
        tube(at, at.clone().addScaledVector(dir, len), rr, rr * 0.35, 2, true);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('aUp', new THREE.Float32BufferAttribute(ups, 1));
    geometry.setIndex(index);
    return geometry;
}

/**
 * The snags: up to `count` trees, each its own mesh under one group (placed and scaled by
 * `place`), sharing one material.
 * @param {object} u     the shared uniforms
 * @param {object} tex   the world's baked textures (the noise atlas)
 * @param {number} count trees
 */
export function createSnags(u, tex, count = 3) {
    const aUp = attribute('aUp', 'float');
    const snagFn = Fn(() => {
        const P = positionWorld.toVar();
        const toCam = u.camPos.sub(P);
        const dist = length(toCam).toVar();
        const V = toCam.div(max(dist, 1e-3));
        const N = normalize(normalWorld).toVar();
        // Height up the tree (0 at the foot … 1 at the snapped top), from the mesh.
        const h = clamp(aUp, 0.0, 1.0);
        // Weathered wood: grain up the trunk (stretched noise), darker checks, bone-grey.
        const grainUV = vec2(P.x.add(P.z).mul(1.6), P.y.mul(0.12));
        const grain = texture(tex.noise, grainUV.div(4.0)).z;
        const checks = smoothstep(0.62, 0.8, texture(tex.noise, vec2(P.x.add(P.z).mul(3.2), P.y.mul(0.5)).div(8.0)).w);
        // (darker than the floor: the corner's silhouettes, silvered only where the sun catches)
        const wood = mix(vec3(0.19, 0.18, 0.16), vec3(0.38, 0.36, 0.33), grain).mul(float(1.0).sub(checks.mul(0.4)));
        // The sinter sock: white silica up the first metre and a half, ragged, wet at the foot.
        const sockTop = float(1.4).add(texture(tex.noise, vec2(P.x.add(P.z).mul(0.7), 0.37)).x.mul(0.6));
        // (metres above the ground it stands on: the trees stand on the near floor, near y = 0)
        const footY = P.y;
        const sock = float(1.0).sub(smoothstep(sockTop.sub(0.15), sockTop, footY));
        const albedo = mix(wood, vec3(0.86, 0.84, 0.78), sock).toVar();
        // Frost on the stubs and the trunk's sun side in First Frost; snow caps in Deep Cold.
        const upFacing = smoothstep(0.2, 0.7, N.y);
        albedo.assign(mix(albedo, vec3(0.86, 0.88, 0.9), u.frost.mul(0.45).mul(smoothstep(0.3, 0.8, h))));
        albedo.assign(mix(albedo, vec3(0.9, 0.92, 0.95), u.snow.mul(upFacing).mul(0.9)));
        // Light: the low sun with a wrap (a trunk is round), the sky above, the warm ground below.
        const ndl = dot(N, u.sunDir);
        const lit = clamp(ndl.add(0.2).div(1.2), 0.0, 1.0);
        const sky = mix(u.haze, u.zenith, 0.55).mul(N.y.mul(0.2).add(0.2));
        // (silvered where the low sun catches the weathered grain: a warm, bright flank)
        const sheen = smoothstep(0.35, 0.9, ndl).mul(0.35);
        const col = albedo.mul(u.sunColor.mul(lit.mul(1.15).add(sheen)))
            .add(albedo.mul(sky.add(tbBounce(u, N))))
            .toVar();
        // A wet sheen at the foot (it stands in the runoff).
        const wetFoot = float(1.0).sub(smoothstep(0.1, 0.6, footY));
        col.mulAssign(float(1.0).sub(wetFoot.mul(0.3)));
        col.addAssign(mix(u.haze, u.zenith, 0.5).mul(wetFoot.mul(abs(dot(N, V)).oneMinus().mul(0.4))));
        const out = tbAerial(u, col, dist, V.negate());
        return vec4(max(out, vec3(0.0)), 1.0);
    });
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: true });
    material.name = 'ThermalBloomSnags';
    material.fog = false;
    material.colorNode = snagFn();
    const group = new THREE.Group();
    group.name = 'ThermalBloomSnags';
    const meshes = [];
    for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(snagGeometry(0x5a9 + i * 977), material);
        mesh.name = `ThermalBloomSnag${i}`;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 12;
        mesh.visible = false;
        group.add(mesh);
        meshes.push(mesh);
    }
    const part = {
        mesh: group,
        material,
        geometry: { dispose: () => meshes.forEach((m) => m.geometry.dispose()) },
    };
    /**
     * Stand the trees: `points` [x, y, z, height, heading] (world metres, radians), at most
     * `count`; an empty list hides them.
     */
    part.place = (points = []) => {
        meshes.forEach((mesh, i) => {
            const p = points[i];
            mesh.visible = Boolean(p);
            if (!p) return;
            mesh.position.set(p[0], p[1], p[2]);
            mesh.rotation.set(0, p[4] || 0, 0);
            mesh.scale.setScalar(p[3]);
            mesh.updateMatrix();
            mesh.updateMatrixWorld(true);
        });
    };
    return part;
}
