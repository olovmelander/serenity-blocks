/**
 * Nimbus Veil — towering cumulus rising from the cloud sea.
 *
 * Each tower is a column of "puffs": instanced camera-facing sprites. Lighting follows the TOWER's
 * form first (outward from its axis, domed toward the crown) and the puff's own sprite-space
 * sphere only second, so a tower reads as one billowing mass instead of a stack of shaded balls:
 * wrap-lit from the low sun, darker toward the base (the mass above shades it), and, when the view
 * looks toward the sun, a forward-scattered glow strongest on the tower's thin silhouette.
 * Value-noise erosion frays every puff's edge. One draw for all towers; the puffs are sorted
 * back-to-front once at build (the camera only rotates about a fixed point, so the order holds).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    dot,
    float,
    length,
    max,
    mix,
    normalize,
    pow,
    smoothstep,
    sqrt,
    uv,
    vec2,
    vec3,
} from 'three/tsl';
import {
    RIG,
    nvApplyHaze,
    nvNoise2,
    rgb,
} from './nimbus-veil-tsl.js';
import { SEA_HAZE } from './nimbus-veil-cloudsea.js';

const DEG = Math.PI / 180;

/**
 * Towers in world polar coordinates (azimuth° with the sun at 0°, distance from the rest
 * camera, height). Placed for both the game view (camera yawed ~30° right, sun in the left zone)
 * and the centred menu view; the first ones matter most (lower tiers take a prefix).
 */
const TOWERS = [
    { az: 16, d: 700, h: 270 }, // beside the sun
    { az: 62, d: 470, h: 240 }, // right zone (game view)
    { az: -36, d: 560, h: 210 }, // left of the sun (menu view)
    { az: 80, d: 390, h: 160 },
    { az: -12, d: 980, h: 150 }, // far, behind the sun's left
    { az: 38, d: 860, h: 190 },
    { az: -60, d: 640, h: 170 },
];

function buildPuffs(tierTowers, puffsPerTower, rand) {
    const puffs = [];
    TOWERS.slice(0, tierTowers).forEach((tower, ti) => {
        const cx = RIG.x + Math.sin(tower.az * DEG) * tower.d;
        const cz = RIG.z - Math.cos(tower.az * DEG) * tower.d;
        const H = tower.h;
        const W = H * 0.62;
        // Offset from the tower axis in tower widths (the tower-scale lighting normal).
        const axis = (x, z) => ({ ox: (x - cx) / W, oz: (z - cz) / W });
        for (let i = 0; i < puffsPerTower; i += 1) {
            const t = (i / Math.max(1, puffsPerTower - 1)) ** 0.9;
            const narrow = 1 - t * 0.6;
            const radius = H * (0.15 - t * 0.065) * (0.7 + rand() * 0.5);
            const x = cx + (rand() - 0.5) * W * narrow;
            const z = cz + (rand() - 0.5) * W * 0.6 * narrow;
            puffs.push({
                x,
                y: -8 + t * H * 0.92,
                z,
                r: radius,
                heightFrac: t,
                seed: rand() * 100 + ti * 13.7,
                ...axis(x, z),
            });
        }
        // A cauliflower crown: a few smaller puffs clustered around the top.
        const crown = Math.max(3, Math.round(puffsPerTower * 0.25));
        for (let i = 0; i < crown; i += 1) {
            const a = rand() * Math.PI * 2;
            const spread = H * 0.12;
            const x = cx + Math.cos(a) * spread * rand();
            const z = cz + Math.sin(a) * spread * 0.6 * rand();
            puffs.push({
                x,
                y: H * (0.82 + rand() * 0.14),
                z,
                r: H * (0.07 + rand() * 0.05),
                heightFrac: 1,
                seed: rand() * 100 + ti * 13.7,
                ...axis(x, z),
            });
        }
    });
    // Back-to-front from the rest camera.
    puffs.sort((a, b) => (
        Math.hypot(b.x - RIG.x, b.y - RIG.height, b.z - RIG.z)
        - Math.hypot(a.x - RIG.x, a.y - RIG.height, a.z - RIG.z)
    ));
    return puffs;
}

/**
 * @param {object} u  shared world uniforms (camRight / camUp / camBack for the sphere normals)
 * @param {object} opts
 * @param {() => number} opts.rand
 * @param {number} opts.towers         how many towers (prefix of TOWERS)
 * @param {number} opts.puffsPerTower
 * @returns {THREE.Sprite|null}
 */
export function createCumulus(u, { rand, towers, puffsPerTower }) {
    if (!towers || !puffsPerTower) return null;
    const puffs = buildPuffs(towers, puffsPerTower, rand);
    const count = puffs.length;

    const material = new THREE.PointsNodeMaterial();
    material.name = 'NimbusCumulus';
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;
    // World-sized puffs: sizeAttenuation divides by view depth (sprite size in world units).
    material.sizeAttenuation = true;

    const puff = attribute('iPuff', 'vec4'); // x, y, z, radius
    const tone = attribute('iTone', 'vec4'); // heightFrac, seed, axis offset x, z (tower widths)
    material.positionNode = puff.xyz;
    // Attenuated sprite size is (size · halfCanvasHeight / depth) CSS px; a sphere of world radius
    // R spans 2R · halfCanvasHeight / (depth · tan(vfov/2)), hence size = 2R / tan(vfov/2).
    material.sizeNode = puff.w.mul(2.0).mul(u.invTanHalfV);

    const local = uv().sub(0.5).mul(2.0);
    const r2 = dot(local, local);
    material.colorNode = Fn(() => {
        const nz = sqrt(max(float(1.0).sub(r2), 0.0));
        const heightFrac = tone.x;
        // Tower-scale normal: outward from the column's axis, turning up toward the crown (a small
        // lean toward the viewer keeps it defined for a puff sitting right on the axis).
        const towerN = normalize(vec3(tone.z.mul(2.4), heightFrac.mul(1.5).sub(0.4), tone.w.mul(2.4))
            .add(u.camBack.mul(0.15)));
        // Sprite-space sphere normal → world (camera basis): x right, y up, z toward the viewer.
        // Weighted under the tower's form, so the puffs add relief without each one becoming a ball.
        const puffN = u.camRight.mul(local.x).add(u.camUp.mul(local.y)).add(u.camBack.mul(nz));
        const n = normalize(towerN.add(puffN.mul(0.65)));
        const L = u.sunDir;
        const diff = clamp(dot(n, L).mul(0.5).add(0.5), 0.0, 1.0);
        const lit = mix(rgb(0xffeed6, 1.2), rgb(0xffd9a8, 1.35), heightFrac);
        // Cloud interiors scatter light: the shade side is luminous lavender, never grey.
        const shadow = mix(rgb(0x9890cc, 0.84), rgb(0xc0b0e2, 0.94), heightFrac);
        const col = mix(shadow, lit, pow(diff, 1.1)).toVar();
        // Toward the base the tower's own mass shades it.
        col.mulAssign(mix(float(0.68), float(1.0), smoothstep(0.0, 0.55, heightFrac)));
        // Each billow's underside sits in the shade of the one below it: the cauliflower relief.
        col.mulAssign(float(1.0).sub(float(1.0).sub(smoothstep(-0.85, 0.15, local.y)).mul(0.22)));
        // Looking toward the sun the whole tower glows (forward scattering), most on its thin
        // silhouette — where the tower's surface turns edge-on to the view — and a little on each
        // puff's rim.
        const V = normalize(puff.xyz.sub(cameraPosition));
        const toward = pow(max(dot(V, L), 0.0), 6.0);
        const silhouette = float(1.0).sub(abs(dot(towerN, V)));
        const thin = silhouette.mul(0.9).add(float(1.0).sub(nz).mul(0.35)).add(0.08);
        col.addAssign(rgb(0xffd9a6, 1.6).mul(toward.mul(thin)));
        col.mulAssign(float(1.0).add(u.seaGlow.mul(0.15)));
        return nvApplyHaze(col, puff.xyz.sub(cameraPosition), float(SEA_HAZE * 0.9));
    })();
    material.opacityNode = Fn(() => {
        // Frayed edge: value noise in sprite space (per puff seed), drifting slowly.
        const p = local.mul(2.3).add(vec2(tone.y, tone.y.mul(0.7))).add(vec2(u.time.mul(0.02), 0.0));
        const n = nvNoise2(p).mul(0.62).add(nvNoise2(p.mul(2.1)).mul(0.38));
        const edge = length(local).add(n.sub(0.5).mul(0.75));
        return float(1.0).sub(smoothstep(0.45, 0.95, edge)).mul(0.95);
    })();

    const sprite = new THREE.Sprite(material);
    sprite.name = 'NimbusCumulus';
    sprite.geometry = sprite.geometry.clone();
    const iPuff = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    const iTone = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    puffs.forEach((p, i) => {
        iPuff.array.set([p.x, p.y, p.z, p.r], i * 4);
        iTone.array.set([p.heightFrac, p.seed, p.ox, p.oz], i * 4);
    });
    sprite.geometry.setAttribute('iPuff', iPuff);
    sprite.geometry.setAttribute('iTone', iTone);
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 20;
    return sprite;
}
