/**
 * First Light — the veils: long sheets of silk light that billow with the breath.
 *
 * Four ribbons, merged into ONE draw:
 *   - the hero veil, broad, passing under the title and climbing out past its right shoulder;
 *   - a thread of silk above the title, thin and bright;
 *   - a far, faint veil high in the sky;
 *   - a near veil across the foot of the frame, soft as if out of focus.
 * Each is a strip built on the CPU along a curve (its side turned toward the reference eye,
 * with a twist so it folds), then billowed in the vertex stage by two travelling waves whose
 * amplitude follows the breath; the waves' derivatives give the bent normal, so a fold turned
 * edge-on to the eye glows brightest, as a sheet of light does (light ∝ path length through
 * it). The silk's fibres run along it; its body is a deep jewel tone, and razor-thin cyan
 * filaments run down its middle and along its hem.
 *
 * Additive and premultiplied (`outputNode = vec4(rgb, 0)`): it adds light and leaves the
 * target's alpha alone. The opening draws each veil out along its length (`u.unfurl`) with a
 * bright front.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { REF_CAMERA, srgbToLinear } from './intro-world-core.js';

/**
 * The ribbons. `points` are the centreline's control points (world units, the reference eye at
 * z = 34), `width` the half width, `twist` [amplitude, cycles, phase] in radians, `wave`
 * [amplitude 1, amplitude 2, waves along 1, waves along 2], `colors` the hue along it,
 * `gain` its light, `soft` how out of focus it is (0 sharp silk, 1 a soft glow).
 */
export const VEILS = Object.freeze([
    {
        name: 'hero',
        points: [[-50, -17, -32], [-26, -11.8, -21], [-7, -12.6, -16], [9, -9.4, -16], [21, 1.5, -20],
            [29, 16, -26], [38, 33, -35]],
        width: 5.6,
        twist: [1.05, 1.15, 0.4],
        wave: [1.15, 0.55, 3.2, 7.5],
        colors: ['#2a1e6e', '#007a8c', '#035563'],
        gain: 1.0,
        soft: 0.0,
    },
    {
        name: 'thread',
        points: [[-44, 5, -38], [-22, 9.6, -31], [-2, 12.8, -28], [15, 14.2, -30], [33, 22, -38], [46, 31, -46]],
        width: 0.75,
        twist: [0.6, 0.8, 1.7],
        wave: [0.7, 0.25, 2.4, 6.0],
        colors: ['#3b2a8f', '#007a8c', '#007a8c'],
        gain: 1.0,
        soft: 0.0,
    },
    {
        name: 'far',
        points: [[-82, 28, -74], [-40, 21, -64], [0, 25.5, -61], [38, 19.5, -64], [84, 27, -74]],
        width: 9.0,
        twist: [0.9, 0.7, 2.6],
        wave: [2.2, 0.9, 2.0, 5.0],
        colors: ['#2a1e66', '#3b2a8f', '#0a4a5e'],
        gain: 0.15,
        soft: 0.35,
    },
    {
        name: 'near',
        points: [[-28, -9.6, 2], [-15, -7.4, 6.6], [-4, -8.8, 8.6], [8, -11.8, 8]],
        width: 2.6,
        twist: [0.8, 0.9, 0.9],
        wave: [0.45, 0.2, 2.2, 5.0],
        colors: ['#007a8c', '#2a1e66', '#2a1e66'],
        gain: 0.22,
        soft: 1.0,
    },
]);

const ALONG = 150;
const ACROSS = 10;

function sampleColors(colors, s) {
    const lin = colors.map(srgbToLinear);
    const x = Math.min(0.9999, Math.max(0, s)) * (lin.length - 1);
    const i = Math.floor(x);
    const t = x - i;
    const a = lin[i];
    const b = lin[Math.min(lin.length - 1, i + 1)];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Build the merged strip geometry (CPU). Exported for tests. */
export function buildVeilGeometry(veils = VEILS, { along = ALONG, across = ACROSS } = {}) {
    const eye = new THREE.Vector3(0, 0, REF_CAMERA.z);
    const verts = (along + 1) * (across + 1);
    const total = verts * veils.length;
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const tan = new Float32Array(total * 4);
    const side = new Float32Array(total * 4);
    const sv = new Float32Array(total * 4);
    const wave = new Float32Array(total * 4);
    const col = new Float32Array(total * 4);
    const index = [];
    const T = new THREE.Vector3();
    const S = new THREE.Vector3();
    const N = new THREE.Vector3();
    const C = new THREE.Vector3();
    const toEye = new THREE.Vector3();
    let base = 0;
    veils.forEach((veil, vi) => {
        const curve = new THREE.CatmullRomCurve3(veil.points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
        const length = curve.getLength();
        for (let i = 0; i <= along; i++) {
            const s = i / along;
            curve.getPointAt(s, C);
            curve.getTangentAt(s, T).normalize();
            toEye.copy(eye).sub(C).normalize();
            S.crossVectors(T, toEye).normalize();
            N.crossVectors(S, T).normalize();
            const [ta, tc, tp] = veil.twist;
            const tw = ta * Math.sin(Math.PI * s * tc * 2 + tp);
            const cs = Math.cos(tw);
            const sn = Math.sin(tw);
            const Sx = S.x * cs + N.x * sn;
            const Sy = S.y * cs + N.y * sn;
            const Sz = S.z * cs + N.z * sn;
            const Nx = -S.x * sn + N.x * cs;
            const Ny = -S.y * sn + N.y * cs;
            const Nz = -S.z * sn + N.z * cs;
            // Tapered toward both ends (a soft lens shape along it).
            const taper = Math.sin(Math.PI * Math.min(1, Math.max(0, s))) ** 0.6;
            const w = veil.width * (0.25 + 0.75 * taper);
            const c = sampleColors(veil.colors, s);
            for (let j = 0; j <= across; j++) {
                const v = (j / across) * 2 - 1;
                const k = base + i * (across + 1) + j;
                pos[k * 3] = C.x + Sx * v * w;
                pos[k * 3 + 1] = C.y + Sy * v * w;
                pos[k * 3 + 2] = C.z + Sz * v * w;
                nrm[k * 3] = Nx;
                nrm[k * 3 + 1] = Ny;
                nrm[k * 3 + 2] = Nz;
                tan[k * 4] = T.x;
                tan[k * 4 + 1] = T.y;
                tan[k * 4 + 2] = T.z;
                tan[k * 4 + 3] = length;
                side[k * 4] = Sx;
                side[k * 4 + 1] = Sy;
                side[k * 4 + 2] = Sz;
                side[k * 4 + 3] = w;
                sv[k * 4] = s;
                sv[k * 4 + 1] = v;
                sv[k * 4 + 2] = vi;
                sv[k * 4 + 3] = veil.soft;
                wave[k * 4] = veil.wave[0];
                wave[k * 4 + 1] = veil.wave[1];
                wave[k * 4 + 2] = veil.wave[2];
                wave[k * 4 + 3] = veil.wave[3];
                col[k * 4] = c[0];
                col[k * 4 + 1] = c[1];
                col[k * 4 + 2] = c[2];
                col[k * 4 + 3] = veil.gain;
            }
        }
        for (let i = 0; i < along; i++) {
            for (let j = 0; j < across; j++) {
                const a = base + i * (across + 1) + j;
                const b = a + across + 1;
                index.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
        base += verts;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(index);
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geometry.setAttribute('aTan', new THREE.BufferAttribute(tan, 4));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 4));
    geometry.setAttribute('aSV', new THREE.BufferAttribute(sv, 4));
    geometry.setAttribute('aWave', new THREE.BufferAttribute(wave, 4));
    geometry.setAttribute('aCol', new THREE.BufferAttribute(col, 4));
    geometry.computeBoundingSphere();
    return geometry;
}

/**
 * @param {object} u shared uniforms: time, breath, unfurl, veilGain
 * @param {THREE.Texture} grainTex
 */
export function createVeils(u, grainTex) {
    const geometry = buildVeilGeometry();
    const aTan = attribute('aTan', 'vec4');
    const aSide = attribute('aSide', 'vec4');
    const aSV = attribute('aSV', 'vec4');
    const aWave = attribute('aWave', 'vec4');
    const aCol = attribute('aCol', 'vec4');
    const N0 = attribute('normal', 'vec3');

    // ── Vertex: two travelling waves across the sheet, larger on the inhale ──
    const s = aSV.x;
    const v = aSV.y;
    const id = aSV.z;
    const L = aTan.w;
    const W = aSide.w;
    const ph1 = s.mul(aWave.z).mul(6.2832).add(v.mul(0.9)).sub(u.time.mul(0.23))
        .add(id.mul(1.7));
    const ph2 = s.mul(aWave.w).mul(6.2832).sub(v.mul(1.6)).add(u.time.mul(0.37))
        .add(id.mul(4.1));
    const swell = u.breath.mul(0.5).add(0.75);
    const hemLift = v.mul(0.3).add(0.7);
    const a1 = aWave.x.mul(swell).mul(hemLift);
    const a2 = aWave.y.mul(swell);
    const disp = a1.mul(sin(ph1)).add(a2.mul(sin(ph2)));
    // ∂/∂s and ∂/∂v of the displacement, per unit length along and across the sheet.
    const dS = a1.mul(cos(ph1)).mul(aWave.z.mul(6.2832)).add(a2.mul(cos(ph2)).mul(aWave.w.mul(6.2832))).div(L);
    const dV = a1.mul(cos(ph1)).mul(0.9).sub(a2.mul(cos(ph2)).mul(1.6)).div(W);
    const bent = normalize(N0.sub(aTan.xyz.mul(dS)).sub(aSide.xyz.mul(dV)));
    // A slow sway of the whole sheet.
    const sway = vec3(sin(u.time.mul(0.051).add(id)).mul(0.8), sin(u.time.mul(0.043).add(id.mul(2.0))).mul(0.5), 0.0);
    const world = positionGeometry.add(N0.mul(disp)).add(sway);

    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
    });
    material.name = 'FirstLightVeils';
    material.fog = false;
    material.positionNode = world;

    const vWorld = varying(world, 'flVeilWorld');
    const vN = varying(bent, 'flVeilNormal');
    const vSV = varying(aSV, 'flVeilSV');
    const vCol = varying(aCol, 'flVeilCol');
    const vLen = varying(L, 'flVeilLen');
    const vHalf = varying(W, 'flVeilHalf');

    const lightFn = Fn(() => {
        const sv = vSV;
        const ss = clamp(sv.x, 0.0, 1.0).toVar();
        const vv = clamp(sv.y, -1.0, 1.0).toVar();
        const soft = sv.w;
        const V = normalize(cameraPosition.sub(vWorld));
        const facing = abs(dot(normalize(vN), V));
        // Light ∝ the path through the sheet: brightest where a fold turns edge-on (capped, so
        // folds stacked on the glow stay a deep tone).
        const graze = min(float(0.32).div(max(facing, 0.1)), 2.0);
        // The profile across: a body that falls off fast (across⁴; the soft veils keep the wider
        // across²) with a fine hem along one edge in its own tone, and the razor-thin core: one
        // filament down the middle, 0.15 units wide in the world (so the thread is all core).
        const across = float(1.0).sub(vv.mul(vv));
        const core = across.mul(across);
        const profile = mix(core.mul(core), core, soft);
        const hem = exp(vv.sub(0.8).div(0.045).pow2().negate()).mul(0.9)
            .add(exp(vv.add(0.88).div(0.035).pow2().negate()).mul(0.3));
        const filament = exp(vv.mul(vHalf).div(0.15).pow2().negate());
        // Silk: fibres run along the sheet; a slow cloud of density over them.
        const fibreUv = vec2(
            vv.mul(1.1).add(sin(ss.mul(9.0).add(sv.z)).mul(0.06)),
            ss.mul(vLen.div(300.0)).add(u.time.mul(0.004)),
        );
        const fibres = texture(grainTex, fibreUv).level(0.5).g;
        const cloudUv = vec2(ss.mul(vLen.div(90.0)).sub(u.time.mul(0.006)), vv.mul(0.35).add(sv.z.mul(0.21)));
        const cloud = texture(grainTex, cloudUv).level(1.0).r;
        const silk = mix(fibres.mul(0.45).add(0.68), float(0.85), soft);
        const density = mix(smoothstep(0.2, 0.85, cloud).mul(0.9).add(0.25), float(0.75), soft);
        const body = profile.mul(silk).mul(density).add(hem.mul(float(1.0).sub(soft.mul(0.8))).mul(0.6))
            .mul(graze)
            .toVar();
        // A soft knee on the body: where folds stack, the sheet deepens instead of washing out.
        body.assign(body.div(body.mul(0.5).add(1.0)));
        // Its ends fade; the opening draws it out along its length with a bright front.
        const ends = smoothstep(0.0, 0.14, ss).mul(float(1.0).sub(smoothstep(0.82, 1.0, ss)));
        const front = u.unfurl.mul(1.25).sub(0.1);
        const drawn = float(1.0).sub(smoothstep(front.sub(0.09), front.add(0.02), ss));
        // The front being drawn: a thin line of light across the sheet, not a blob.
        const edge = exp(ss.sub(front).div(0.014).pow2().negate()).mul(float(1.0).sub(smoothstep(0.7, 1.0, u.unfurl)));
        const breath = u.breath.mul(0.5).add(0.72);
        // The body is the veil's own deep tone; the cores are cyan (#6CEBFF) to aqua (#8FFFE0)
        // along it, at 0.85, sharp veils only.
        const cores = mix(vec3(0.15, 0.831, 1.0), vec3(0.275, 1.0, 0.745), ss);
        const crisp = float(1.0).sub(soft);
        const sharp = crisp.mul(crisp).mul(crisp);
        const threads = filament.mul(sharp).mul(0.85).mul(drawn).add(edge.mul(profile.mul(0.5).add(filament)).mul(0.7));
        const rgb = vCol.rgb.mul(body.mul(drawn)).add(cores.mul(threads))
            .mul(ends).mul(vCol.w)
            .mul(breath)
            .mul(u.veilGain);
        return vec4(max(rgb, vec3(0.0)), 0.0);
    });
    material.outputNode = lightFn();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'FirstLightVeils';
    mesh.frustumCulled = false;
    mesh.renderOrder = 60;
    return {
        mesh,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
