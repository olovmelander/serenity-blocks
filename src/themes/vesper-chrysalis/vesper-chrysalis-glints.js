/**
 * Vesper Chrysalis — glints: the stars that flash on cut stone.
 *
 * A facet that turns one of the evening's lamps to the eye flashes for a moment, and the flash
 * has arms: that is most of what makes cut stone look cut. One small star stands ready on every
 * larger facet of the chrysalis and on the points and faces of the crystal stands. The vertex
 * stage finds how nearly the facet mirrors a lamp to this camera (the last light on the horizon,
 * the ringed world, the evening star, and one light of the facet's own that wanders the sky so a
 * standing crystal twinkles too) and opens the star by that much; a facet that mirrors nothing is
 * a degenerate quad. The chrysalis's stars ride its pose, so they run over it as it turns on its
 * thread. They are drawn on the scene's layer: the lake mirrors them through its own camera, and
 * so flashes on other facets than the sky does, as water would.
 *
 * A chime (u.chime) runs a flare up every crystal from the waterline.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    reflect,
    sin,
    smoothstep,
    sqrt,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    GLOW_DIR,
    PLANET_DIR,
    VESPER_DIR,
    vcPart,
    vcPow2n,
} from './vesper-chrysalis-tsl.js';

/** Seconds a chime takes to climb a crystal a hundred metres tall. */
export const CHIME_CLIMB = 3.2;

/**
 * @param {object} u
 * @param {object} opts
 * @param {{ at: number[], normal: number[], seed: number }[]} opts.relic   facets of the chrysalis, in its own frame
 * @param {{ at: number[], normal: number[], seed: number, side?: number }[]} opts.fixed  points that stand in the world
 */
export function createGlints(u, { relic = [], fixed = [] } = {}) {
    const n = Math.max(1, relic.length + fixed.length);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const at = new Float32Array(n * 4); // xyz, parent (0 = the chrysalis, 1 = the world)
    const nrm = new Float32Array(n * 4); // normal, seed
    relic.forEach((g, i) => {
        at.set([g.at[0], g.at[1], g.at[2], 0], i * 4);
        nrm.set([g.normal[0], g.normal[1], g.normal[2], g.seed], i * 4);
    });
    fixed.forEach((g, k) => {
        const i = relic.length + k;
        at.set([g.at[0], g.at[1], g.at[2], 1], i * 4);
        nrm.set([g.normal[0], g.normal[1], g.normal[2], g.seed], i * 4);
    });
    geometry.setAttribute('aGlintAt', new THREE.InstancedBufferAttribute(at, 4));
    geometry.setAttribute('aGlintN', new THREE.InstancedBufferAttribute(nrm, 4));
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.count = relic.length + fixed.length;
    mesh.frustumCulled = false;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'VesperChrysalisGlints';
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = false;
    material.side = THREE.DoubleSide;
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);

    const aAt = attribute('aGlintAt', 'vec4');
    const aN = attribute('aGlintN', 'vec4');
    const vTint = varying(vec3(0.0), 'vGlintTint');
    const vOpen = varying(float(0.0), 'vGlintOpen');
    const lit = (a) => vec3(a[0], a[1], a[2]);
    const toWorld = (d) => u.relicX.mul(d.x).add(u.relicY.mul(d.y)).add(u.relicZ.mul(d.z));

    material.vertexNode = Fn(() => {
        const onRelic = float(1.0).sub(step(0.5, aAt.w)).toVar();
        const seed = aN.w;
        const pW = mix(aAt.xyz, u.relicAt.add(toWorld(aAt.xyz)), onRelic).toVar();
        const nW = normalize(mix(aN.xyz, toWorld(aN.xyz), onRelic)).toVar();
        const V = normalize(cameraPosition.sub(pW)).toVar();
        const R = reflect(V.negate(), nW).toVar();
        const facing = smoothstep(0.03, 0.3, dot(nW, V));
        // How nearly the facet mirrors each lamp to this eye.
        const glow = vcPow2n(clamp(dot(R, lit(GLOW_DIR)), 0.0, 1.0), 5);
        const star = vcPow2n(clamp(dot(R, lit(VESPER_DIR)), 0.0, 1.0), 7).mul(u.heat.w.mul(0.5).add(1.0));
        const world = vcPow2n(clamp(dot(R, lit(PLANET_DIR)), 0.0, 1.0), 6);
        // A light of the facet's own, wandering the sky: what makes a standing crystal twinkle.
        const turn = u.drift.mul(0.13).add(seed.mul(6.283));
        const roam = normalize(vec3(sin(turn), sin(u.drift.mul(0.09).add(seed.mul(17.0))).mul(0.3).add(0.3), cos(turn).negate()));
        const wander = vcPow2n(clamp(dot(R, roam), 0.0, 1.0), 6).mul(mix(float(0.8), float(0.45), onRelic));
        // A chime climbs every crystal from the waterline (the chrysalis rings all at once).
        const chimeAge = u.time.sub(u.chime.x).sub(pW.y.mul(CHIME_CLIMB / 100).mul(float(1.0).sub(onRelic)));
        const chime = exp(max(chimeAge, 0.0).mul(-3.2)).mul(step(0.0, chimeAge)).mul(u.chime.y)
            .mul(sin(seed.mul(91.0)).mul(0.35).add(0.65));
        const open = glow.add(star.mul(1.7)).add(world.mul(0.55)).add(wander).mul(facing)
            .add(chime.mul(facing.mul(0.6).add(0.4)))
            .mul(u.breath)
            .toVar();
        vOpen.assign(min(open, 2.4));
        const lampTint = u.glow.mul(glow).add(vec3(1.0, 0.95, 0.88).mul(star.mul(1.7))).add(vec3(0.95, 0.85, 0.78).mul(world.mul(0.55)))
            .add(mix(u.crystal, vec3(1.0), 0.5).mul(wander))
            .add(u.chimeTint.mul(chime));
        vTint.assign(lampTint.div(max(open, 1e-3)).mul(facing.mul(0.6).add(0.4)));
        // A star some pixels across, whatever its distance; nothing at all when the facet is dark.
        const lift = pW.add(V.mul(0.45));
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(lift, 1.0)).toVar();
        const px = sqrt(min(open, 2.4)).mul(26.0).add(5.0).mul(u.viewport.y.div(1080.0))
            .mul(step(0.02, open));
        const off = positionGeometry.xy.mul(px).mul(2.0).div(u.viewport).mul(clip.w);
        return vec4(clip.xy.add(off), clip.z, clip.w);
    })();
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0).toVar();
        const d = length(q);
        const core = exp(d.mul(d).mul(-42.0));
        const arms = exp(abs(q.x).mul(-36.0)).mul(exp(abs(q.y).mul(-3.4)))
            .add(exp(abs(q.y).mul(-36.0)).mul(exp(abs(q.x).mul(-3.4))));
        const k = Math.SQRT1_2;
        const dq = vec2(q.x.add(q.y).mul(k), q.y.sub(q.x).mul(k));
        const diagonal = exp(abs(dq.x).mul(-40.0)).mul(exp(abs(dq.y).mul(-5.5)))
            .add(exp(abs(dq.y).mul(-40.0)).mul(exp(abs(dq.x).mul(-5.5))));
        const shape = core.mul(2.4).add(arms.mul(1.0)).add(diagonal.mul(0.28))
            .mul(float(1.0).sub(smoothstep(0.72, 1.0, d)));
        // The arms split a little into colours toward their ends.
        const fringe = cos(vec3(0.0, 2.1, 4.2).add(d.mul(9.0))).mul(0.5).add(0.5);
        const hue = mix(vTint, vTint.mul(fringe.mul(1.6)), smoothstep(0.25, 0.8, d).mul(0.5));
        return vec4(hue.mul(shape).mul(vOpen).mul(1.6), 0.0);
    })();
    mesh.material = material;

    const part = vcPart('VesperChrysalisGlints', geometry, material, 72, { mesh });
    part.count = mesh.count;
    return part;
}
