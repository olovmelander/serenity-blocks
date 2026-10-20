/**
 * Synthwave Sunset — a field of static light bulbs: one instanced additive draw of camera-facing
 * quads (railing strings, garlands, lamp globes, the arch's sunburst, the domes' ribs).
 *
 * Each bulb is sized in metres with a floor of ~1.4 buffer pixels, and dimmed by the area the
 * floor added, so far bulbs keep their true average light instead of growing brighter or
 * vanishing. It writes premultiplied light with alpha 0, so it adds to the frame and leaves the
 * reflection pass's alpha alone (the sea lays that pass over its mirrored sky by alpha).
 *
 * Per bulb: position and size, colour and programme, an index in its string (for chases) and its
 * place along the pier (for the evening's power-up, `u.pierPower`: the pier lights come on from
 * the land end outward).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    modelViewMatrix,
    positionGeometry,
    pow,
    screenSize,
    select,
    sin,
    smoothstep,
    step,
    uv,
    vec3,
    vec4,
} from 'three/tsl';
import { rgb, swHash11 } from './synthwave-sunset-tsl.js';

const linearLemon = rgb(0xffe46a);

/** Bulb programmes (the iColor.w channel). */
export const BULB = Object.freeze({
    steady: 0,
    chase: 1,
    globe: 2,
    sparkle: 3,
    /** The coaster's track: `along` is the track parameter; lit as the lift meter, races on a ride. */
    track: 4,
});

/**
 * @param {object} u  world uniforms (time, pierPower, pierGlow)
 * @param {Array<{p: THREE.Vector3, size: number, color: THREE.Color, program?: number,
 *   index?: number, count?: number, along?: number, level?: number}>} rows
 * @param {object} [opts]
 * @param {string} [opts.name]
 * @param {number} [opts.mirrorLayer]
 */
export function createBulbField(u, rows, opts = {}) {
    const count = Math.max(1, rows.length);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const P = new Float32Array(count * 4);
    const C = new Float32Array(count * 4);
    const I = new Float32Array(count * 4);
    rows.forEach((b, i) => {
        P.set([b.p.x, b.p.y, b.p.z, b.size], i * 4);
        C.set([b.color.r, b.color.g, b.color.b, b.program ?? BULB.steady], i * 4);
        I.set([b.index ?? i, b.count ?? 1, b.along ?? 1, b.level ?? 1], i * 4);
    });
    geometry.setAttribute('iBulbP', new THREE.InstancedBufferAttribute(P, 4));
    geometry.setAttribute('iBulbC', new THREE.InstancedBufferAttribute(C, 4));
    geometry.setAttribute('iBulbI', new THREE.InstancedBufferAttribute(I, 4));

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = opts.name ?? 'SynthwaveBulbs';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.fog = false;

    const pAttr = attribute('iBulbP', 'vec4');
    const cAttr = attribute('iBulbC', 'vec4');
    const iAttr = attribute('iBulbI', 'vec4');

    const mv = modelViewMatrix.mul(vec4(pAttr.xyz, 1.0));
    const depth = max(mv.z.negate(), 0.1);
    const pxWorld = depth.mul(2.0).div(cameraProjectionMatrix.element(1).element(1).mul(screenSize.y));
    const size = max(pAttr.w, pxWorld.mul(1.4));
    material.vertexNode = cameraProjectionMatrix.mul(vec4(mv.xyz.add(vec3(positionGeometry.xy.mul(size), 0.0)), 1.0));
    const dim = pow(pAttr.w.div(size), 2.0);

    material.colorNode = Fn(() => {
        const d = length(uv().sub(0.5)).mul(2.0);
        const program = cAttr.w;
        const isGlobe = program.greaterThan(1.5).and(program.lessThan(2.5));
        // A globe is a soft frosted ball; a bulb a hot point with a little halo.
        const shape = select(isGlobe, exp(d.mul(d).mul(-3.2)), exp(d.mul(d).mul(-6.0))).sub(0.004).max(0.0);
        const idx = iAttr.x;
        const n = max(iAttr.y, 1.0);
        const t = u.time;
        const seed = swHash11(idx.add(cAttr.x.mul(97.0)).add(pAttr.x.mul(0.37)));
        const twinkle = sin(t.mul(float(1.8).add(seed.mul(1.6))).add(seed.mul(60.0))).mul(0.1).add(0.9);
        const chase = smoothstep(0.7, 1.0, fract(idx.div(n).mul(5.0).sub(t.mul(0.35)))).mul(0.9).add(0.55);
        const sparkle = smoothstep(0.93, 1.0, fract(t.mul(0.6).add(seed.mul(17.0)))).mul(1.6).add(0.75);
        const level = select(program.lessThan(0.5), twinkle, select(
            program.lessThan(1.5),
            chase,
            select(program.lessThan(2.5), float(1.0), sparkle),
        ));
        // The evening powers the pier from the land end outward.
        const powered = smoothstep(float(1.0).sub(u.pierPower), float(1.0).sub(u.pierPower).add(0.04), iAttr.z);
        const col = cAttr.xyz.mul(level).mul(powered).toVar();
        if (u.coasterMeter) {
            // The coaster: bulbs from the lift's foot up to the train burn lemon (the chain's
            // meter); on a ride a fast chase races round the track.
            const isTrack = step(3.5, program);
            const tt = iAttr.z;
            const lifted = step(u.coasterFoot, tt).mul(step(tt, u.coasterMeter)).mul(step(0.01, u.coasterMeter));
            const race = smoothstep(0.75, 1.0, fract(idx.div(n).mul(9.0).sub(t.mul(2.6)))).mul(u.coasterRide);
            const trackCol = mix(cAttr.xyz.mul(chase), linearLemon.mul(4.0), lifted).add(cAttr.xyz.mul(race.mul(3.0)));
            col.assign(mix(col, trackCol, isTrack));
        }
        return col.mul(shape).mul(dim).mul(iAttr.w).mul(u.pierGlow)
            .mul(4.5);
    })();
    material.outputNode = vec4(material.colorNode, 0.0);

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = opts.name ?? 'SynthwaveBulbs';
    mesh.frustumCulled = false;
    mesh.renderOrder = 21;
    if (Number.isInteger(opts.mirrorLayer)) mesh.layers.enable(opts.mirrorLayer);
    return mesh;
}
