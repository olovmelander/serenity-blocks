/**
 * Shifting Sands — dust devils.
 *
 * A whirl of wind on hot sand raises a column of dust a couple of hundred units tall: narrow at
 * its foot, opening upward, turning, leaning downwind and walking slowly over the dunes. One
 * walks the erg by the clock now and then; a twist raises one close by (the twist of the piece is
 * the twist of the air).
 *
 * One tall quad a devil, turned to face the eye about the vertical, in rows so it can lean and
 * snake. The fragment reads the quad as the column seen from the side: across it, the chord
 * through a hollow tube (the dust is in the wall, the eye of it is clear); on it, streaks wound
 * round the tube, read once for the wall facing the eye and once for the wall behind, which
 * crosses the quad the other way: that is what makes it turn. It rises from the sand, holds and
 * thins away from the top. Premultiplied "over" like every dust here: it hides what is behind it
 * and takes the light of whatever stands in the sky.
 *
 * The world owns where a devil is (it walks a line over the real dunes, so its foot is seated on
 * them each frame) and writes it as two uniform rows; nothing is created at event time.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    asin,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cross,
    dot,
    exp,
    float,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    sqrt,
    uniformArray,
    uv,
    vec2,
    vec3,
    vec4,
    vertexStage,
} from 'three/tsl';
import { dustRadiance, fxMaterial } from './shifting-sands-fx.js';
import { ssTexNoise } from './shifting-sands-tsl.js';

/** Devils standing at once. */
export const DEVIL_SLOTS = 3;
/** Seconds a devil takes to rise, and to thin away at its end. */
export const DEVIL = Object.freeze({ rise: 1.6, fade: 3.2 });
/** Rows up the column (it leans and snakes row by row). */
const ROWS = 20;
/** The quad is this much wider than the column at its top (room for the soft edge). */
const MARGIN = 1.25;
/** The column's half-width at its top, in foot radii. */
const TOP = 2.5;

/** Half-width at height share v (0 the foot … 1 the top), in foot radii: a flared skirt, a waist, an opening top. */
const widthAt = (v) => pow(v, 0.9).mul(TOP - 0.75).add(0.75).add(exp(v.mul(-14.0)).mul(1.5));

/**
 * @param {object} shared world uniforms + atmosphere + noise texture
 */
export function createDustDevils(shared) {
    const plane = new THREE.PlaneGeometry(2, 1, 1, ROWS);
    plane.translate(0, 0.5, 0);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(plane.getIndex());
    geometry.setAttribute('position', plane.getAttribute('position'));
    geometry.setAttribute('uv', plane.getAttribute('uv'));
    geometry.setAttribute('aSlot', new THREE.InstancedBufferAttribute(
        Float32Array.from({ length: DEVIL_SLOTS }, (_, i) => i),
        1,
    ));
    geometry.instanceCount = 1;

    const {
        uTime, uWindDir, uSunA, uSunB, uSunLightA, uSunLightB, uMoonDir, uMoonLight, atmosphere, noiseTex,
    } = shared;
    const rows = (x, y, z, w) => Array.from({ length: DEVIL_SLOTS }, () => new THREE.Vector4(x, y, z, w));
    // Where its foot stands (xyz) and how much of it there is (w: 0 none … 1 standing).
    const uDevils = uniformArray(rows(0, -1000, 0, 0), 'vec4');
    // Its height, its foot radius, how far up it has risen (0..1), its own seed.
    const uDevilShape = uniformArray(rows(200, 10, 0, 0), 'vec4');

    const slot = attribute('aSlot', 'float').toInt();
    const D0 = uDevils.element(slot);
    const D1 = uDevilShape.element(slot);
    const foot = D0.xyz;
    const height = D1.x;
    const radius = D1.y;
    const risen = D1.z;
    const seed = D1.w;

    const material = fxMaterial('shifting-sands-dust-devils');

    // ── Vertex: a quad about the vertical, turned to the eye, leaning downwind and snaking ──
    const v = positionGeometry.y;
    const across = positionGeometry.x;
    const toEye = cameraPosition.sub(foot);
    const side = normalize(cross(vec3(0.0, 1.0, 0.0), vec3(toEye.x, 0.0, toEye.z).add(vec3(1e-3, 0.0, 0.0))));
    const W = vec3(uWindDir.x, 0.0, uWindDir.y);
    const sway = sin(v.mul(4.6).add(uTime.mul(1.1)).add(seed.mul(17.0))).mul(v).mul(radius.mul(1.3))
        .add(sin(v.mul(9.7).sub(uTime.mul(1.7)).add(seed.mul(5.0))).mul(v.mul(v)).mul(radius.mul(0.5)));
    const lean = W.mul(v.mul(v).mul(height.mul(0.2)));
    const halfW = radius.mul(TOP * MARGIN);
    const worldPos = foot.add(vec3(0.0, v.mul(height), 0.0)).add(lean)
        .add(side.mul(across.mul(halfW).add(sway)));
    // Collapsed to nothing while its slot is empty.
    const shown = smoothstep(0.0, 0.004, D0.w);
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(mix(foot, worldPos, shown), 1.0)));

    material.colorNode = Fn(() => {
        const st = uv();
        const h = st.y;
        const vP = vertexStage(worldPos);
        const vSeed = vertexStage(seed);
        const vAmount = vertexStage(D0.w);
        const vRisen = vertexStage(risen);
        // Where the sight line crosses the tube at this height.
        const x = st.x.mul(2.0).sub(1.0).mul(TOP * MARGIN).div(widthAt(h))
            .toVar();
        // Its outline is torn by the dust it sheds (a clean edge is a glass tube, not a whirl).
        const tornAt = ssTexNoise(noiseTex, vec2(st.x.mul(3.0).add(vSeed.mul(9.0)), h.mul(13.0).sub(uTime.mul(1.3))));
        const inTube = float(1.0).sub(smoothstep(0.4, 1.0, abs(x).add(tornAt.x.sub(0.5).mul(0.42))));
        const xs = clamp(x, -0.999, 0.999);
        const near = asin(xs).div(6.2832);
        const turn = uTime.mul(0.42).add(vSeed);
        const climb = uTime.mul(0.55);
        // The wall facing the eye, and the wall behind it (it crosses the other way).
        const wound = h.mul(2.4);
        const front = ssTexNoise(noiseTex, vec2(near.add(wound).sub(turn).mul(19.0), h.mul(9.0).sub(climb.mul(2.0)))
            .add(vSeed.mul(31.0)));
        const back = ssTexNoise(noiseTex, vec2(float(0.5).sub(near).add(wound).sub(turn)
            .mul(19.0), h.mul(9.0).sub(climb.mul(2.0)))
            .add(vSeed.mul(31.0)));
        const streaks = smoothstep(0.25, 0.85, front.x.mul(0.6).add(front.y.mul(0.4))).mul(0.6)
            .add(smoothstep(0.25, 0.85, back.x.mul(0.6).add(back.y.mul(0.4))).mul(0.4));
        // A hollow tube: the dust is in the wall, so the chord is longest near the rim.
        const rim = mix(0.62, 1.0, xs.mul(xs));
        // It rises from the sand, frays at whatever height it has reached, and its skirt of
        // thrown sand is thick at the foot.
        const reached = vRisen.mul(1.08);
        const topFray = float(1.0).sub(smoothstep(reached.sub(0.3), reached, h.add(front.z.sub(0.5).mul(0.2))));
        const skirt = exp(h.mul(-16.0)).mul(0.9);
        const seat = smoothstep(0.0, 0.035, h);
        const dens = streaks.mul(0.82).add(0.18).add(skirt).mul(rim)
            .mul(inTube)
            .mul(topFray)
            .mul(seat)
            .mul(mix(1.0, 0.6, smoothstep(0.45, 1.0, h)));
        const a = clamp(dens.mul(vAmount).mul(1.9), 0.0, 0.92);
        // Lit as a round column: brighter on the side the brightest light stands.
        const wA = uSunLightA.r;
        const wB = uSunLightB.r.mul(0.8);
        const wM = uMoonLight.b.mul(1.6);
        const lightDir = cameraViewMatrix.mul(vec4(uSunA.mul(wA).add(uSunB.mul(wB)).add(uMoonDir.mul(wM))
            .add(vec3(0.0, 0.02, 0.0)), 0.0)).xyz;
        const L = lightDir.div(max(length(lightDir), 1e-3));
        const n = vec3(xs, 0.0, sqrt(float(1.0).sub(xs.mul(xs))));
        const round = dot(n, L).mul(0.4).add(0.86);
        // (the wall facing the eye carries its own streaks of shade: that is what turns)
        const lit = dustRadiance(shared, vec3(0.6, 0.38, 0.21), vP, 1.0, 0.2)
            .mul(round).mul(mix(0.62, 1.2, smoothstep(0.25, 0.8, front.x)));
        const col = atmosphere.applyAerial(lit, vP, 0.75);
        return vec4(col.mul(a), a);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'shifting-sands-dust-devils';
    mesh.frustumCulled = false;
    mesh.renderOrder = 28;
    return {
        mesh,
        uDevils,
        uDevilShape,
        /** Dormant while no devil stands: one collapsed instance keeps the pipeline compiled. */
        setActive(active) {
            geometry.instanceCount = active ? DEVIL_SLOTS : 1;
        },
        dispose() {
            geometry.dispose();
            plane.dispose();
            material.dispose();
        },
    };
}
