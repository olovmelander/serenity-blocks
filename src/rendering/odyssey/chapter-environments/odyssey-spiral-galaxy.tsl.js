/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview CHAPTER 6'S GALAXY, AS THE GALAXY THEME DRAWS ONE (2026-10-31, the space
 * masterpiece pass). Olov: "how can we make the galaxy more impressive? can we be inspired from the
 * galaxy theme?"
 *
 * It was one flat quad painted with a 2D spiral: thin rings of blue with pink dots, a toy. The
 * Galaxy theme's galaxy is a disc of gas, dust and a bulge seen through its own frame, and this is
 * that disc re-derived (`src/themes/galaxy/galaxy-disc.js`, `galaxy-tsl.js`, `galaxy-core.js`;
 * theme code is never imported into Odyssey), in its thin-disc form (the `march: 1` solution: one
 * sample where the view ray meets the midplane, the layers' thicknesses as closed-form paths):
 *   old disc    the warm light of the old stars, an exponential, a little brighter in the arms;
 *   arms        two logarithmic arms of young blue light whose phase is torn by noise read in the
 *               spiral's own coordinates, so its clumps run along them, forking toward the rim;
 *   nurseries   pink knots strung along each arm's trailing edge, hot hearts in soft halos;
 *   dust        feathered lanes on each arm's inner edge that take the blue first;
 *   bar, bulge  the short bar the arms leave from; the bulge's light in closed form, split at the
 *               midplane so the lanes cross its near side and hide behind it on the far side.
 * The gameplay light (ripples, waves, rings) is the theme's alone and is not carried.
 *
 * Drawn on a box round the disc in the galaxy's own frame (the camera is always outside it), as a
 * premultiplied "over": its light is added and the dust takes from the sky behind it.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, atan, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, dot, exp,
    float, floor, fract, fwidth, length, log, log2, materialOpacity, max, min, mix, modelWorldMatrix,
    modelWorldMatrixInverse, normalize, positionGeometry, positionLocal, screenSize, sin, smoothstep, sqrt,
    step, texture, uniform, uv, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import { SPIRAL_GALAXY_NOISE, bakeSpiralGalaxyNoiseSteps } from './odyssey-spiral-galaxy-noise.js';
import { SPIRAL_GALAXY_SUNS, planSpiralGalaxySuns } from './odyssey-spiral-galaxy-suns.js';

const TAU = Math.PI * 2;

/** The galaxy's frame (the theme's GALAXY): radius where the arms end, the slab, the anatomy. */
export const SPIRAL_GALAXY = Object.freeze({
    radius: 100,
    bound: 114,
    halfHeight: 9,
    scaleLength: 27,
    bulge: 6.2,
    bulgeFlat: 0.74,
    arms: 2,
    winding: 2.4,
    armStart: 8.5,
});

/** The theme's "andromeda" palette (scene-linear). */
export const SPIRAL_GALAXY_PALETTE = Object.freeze({
    core: Object.freeze([1.0, 0.78, 0.58]),
    nucleus: Object.freeze([1.0, 0.9, 0.95]),
    armInner: Object.freeze([0.56, 0.17, 1.0]),
    armOuter: Object.freeze([0.1, 0.32, 1.0]),
    nursery: Object.freeze([1.0, 0.22, 0.6]),
});

const H_GAS = 2.3;
const H_DUST = 1.25;
const FEATHER_REPEAT = 5;
const FINE_SCALE = 1 / 17;
const OLD_GAIN = 0.05;
const YOUNG_GAIN = 0.15;
const KNOT_GAIN = 0.42;
const BAR_GAIN = 0.06;
const DUST_GAIN = 1.0;
const DUST_RGB = [0.72, 1.0, 1.34];
const BULGE_PEAK = 1.5;
const CLUSTER_PEAK = 2.6;
const CLUSTER_RADIUS = 1.35;
const SQRT_PI = Math.sqrt(Math.PI);

/** vec3 -> vec3 in [0,1) (the theme's gxHash33). */
const hash33 = Fn(([pIn]) => {
    const p3 = fract(pIn.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
}).setLayout({ name: 'sg_hash33', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec3' }] });

/** The arm's ridge angle at a radius. */
const armAngle = (radius, winding) => winding
    .mul(log(max(radius, SPIRAL_GALAXY.armStart * 0.5).div(SPIRAL_GALAXY.armStart)));

/** Draw order: after the star shells (-0.95), the disc then its suns, before the giant (-0.8). */
export const SPIRAL_GALAXY_DRAW_ORDER = Object.freeze({ disc: -0.9, suns: -0.89 });
/** The suns' streaming (the theme's STREAM_RATE / PATTERN_RATE, per second of the chapter clock). */
const STREAM_RATE = 0.022;
const PATTERN_RATE = 0.0085;

/**
 * The galaxy, in steps (the noise bake yields between octaves). Its disc FACES +Z in the returned
 * mesh's frame (a quad's way, so a caller turns it as it would a billboard), `radius` local units
 * across; inside the shader the disc's own frame has +Y as its axis. Its suns ride as a child.
 * @param {object} [options]
 * @param {number} [options.gain] light gain
 * @param {*} [options.uTime] time uniform (the arms' slow drift, the suns' streaming and twinkle)
 * @param {'high'|'low'} [options.quality]
 */
export function* createSpiralGalaxySteps({ gain = 1, uTime = null, quality = 'high' } = {}) {
    const G = SPIRAL_GALAXY;
    const P = SPIRAL_GALAXY_PALETTE;
    const { mips } = yield* bakeSpiralGalaxyNoiseSteps();
    const { size } = SPIRAL_GALAXY_NOISE;
    const halfMips = mips.map(({ data, width }) => {
        const half = new Uint16Array(data.length);
        for (let i = 0; i < data.length; i += 1) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
        return { data: half, width, height: width };
    });
    const noiseTex = new THREE.DataTexture(halfMips[0].data, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
    noiseTex.mipmaps = halfMips;
    noiseTex.wrapS = THREE.RepeatWrapping;
    noiseTex.wrapT = THREE.RepeatWrapping;
    noiseTex.magFilter = THREE.LinearFilter;
    noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
    noiseTex.generateMipmaps = false;
    noiseTex.colorSpace = THREE.NoColorSpace;
    noiseTex.needsUpdate = true;
    yield 'galaxy';

    const u = {
        time: uTime ?? uniform(0),
        winding: uniform(G.winding),
        gain: uniform(gain),
        core: uniform(new THREE.Vector3(...P.core)),
        nucleus: uniform(new THREE.Vector3(...P.nucleus)),
        armInner: uniform(new THREE.Vector3(...P.armInner)),
        armOuter: uniform(new THREE.Vector3(...P.armOuter)),
        nursery: uniform(new THREE.Vector3(...P.nursery)),
    };
    const noiseLod = (st, lod) => texture(noiseTex, st).level(lod);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'Odyssey spiral galaxy';
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.FrontSide;
    material.fog = false;
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    material.forceSinglePass = true;
    material.userData.emitsBloom = true;

    /** The grain where the ray meets the midplane (the theme's grainAt, detail 2). */
    const grainAt = (pm, footprint) => {
        const r = length(pm.xz).toVar();
        const theta = atan(pm.z, pm.x);
        const lodS = clamp(log2(footprint.mul(FEATHER_REPEAT * size).div(max(r, 5.0).mul(TAU))), 0.0, 7.0);
        const uvS = vec2(
            theta.sub(armAngle(r, u.winding)).mul(FEATHER_REPEAT / TAU).sub(u.time.mul(0.0014)),
            log(max(r, 1.0)).mul(0.86).sub(u.time.mul(0.0009)),
        );
        const coarse = noiseLod(uvS, lodS).toVar();
        const lodF = clamp(log2(footprint.mul(size * FINE_SCALE)).sub(0.5), 0.0, 7.0);
        const fine = noiseLod(pm.xz.mul(FINE_SCALE).add(vec2(0.37, 0.11)), lodF).toVar();
        const swell = smoothstep(0.18, 0.86, coarse.b.mul(0.55).add(fine.r.mul(0.45)));
        const glow = smoothstep(0.5, 0.94, fine.b.mul(0.62).add(coarse.g.mul(0.38)));
        const thread = float(1.0).sub(abs(fine.a.mul(2.0).sub(1.0)));
        const knotLattice = (scale, salt, share) => {
            const g = pm.xz.div(scale);
            const id = floor(g);
            const h = hash33(vec3(id, salt)).toVar();
            const d = length(g.sub(id.add(h.xy.mul(0.5).add(0.25)))).mul(scale);
            const rad = h.z.mul(0.5).add(0.3).mul(scale * 0.11).toVar();
            const q = d.div(rad);
            const heart = exp(q.mul(q).negate());
            const haloQ = q.div(2.6);
            const f = abs(g.sub(id).sub(0.5));
            const inCell = float(1.0).sub(smoothstep(0.3, 0.48, max(f.x, f.y)));
            const halo = exp(haloQ.mul(haloQ).negate()).mul(0.34).mul(inCell);
            const present = step(1.0 - share, h.x).mul(h.y.mul(h.y).mul(0.8).add(0.2));
            const sharp = smoothstep(0.5, 1.6, rad.div(max(footprint, 1e-4)));
            const mean = float(Math.PI * 0.0045 * (1 + (0.34 * 2.6 * 2.6)) * 0.44 * share);
            return {
                heart: mix(mean.mul(0.2), heart.mul(present), sharp),
                all: mix(mean, heart.add(halo).mul(present), sharp),
            };
        };
        const big = knotLattice(4.6, 3.0, 0.42);
        const small = knotLattice(2.3, 11.0, 0.32);
        const gather = coarse.g.mul(0.9).add(fine.b.mul(0.5)).add(0.1);
        return {
            warp: coarse.r.sub(0.5).mul(1.7).add(fine.g.sub(0.5).mul(0.22)).toVar(),
            clump: swell.mul(swell).toVar(),
            knots: glow.mul(glow).mul(0.3).add(big.all.add(small.all.mul(0.7)).mul(gather)).toVar(),
            hearts: big.heart.add(small.heart.mul(0.7)).mul(gather).toVar(),
            threads: thread.mul(thread).mul(thread).toVar(),
            patches: smoothstep(0.28, 0.74, coarse.a).toVar(),
        };
    };

    /** Light and dust on the midplane (the theme's sampleAt, unlayered). */
    const sampleAt = (p, grain) => {
        const R = G.radius;
        const RD = G.scaleLength;
        const r = length(p.xz).toVar();
        const phase = atan(p.z, p.x).sub(armAngle(r, u.winding)).mul(G.arms).add(grain.warp)
            .toVar();
        const fork = smoothstep(R * 0.3, R * 0.62, r).mul(0.3);
        const a = cos(phase).mul(0.5).add(0.5).add(cos(phase.mul(2.0).add(1.4)).mul(0.5).add(0.5).mul(fork))
            .toVar();
        const a2 = a.mul(a).toVar();
        const lane = cos(phase.sub(0.86)).mul(0.5).add(0.5).toVar();
        const knot = cos(phase.add(0.5)).mul(0.5).add(0.5).toVar();
        const armOn = smoothstep(G.armStart * 0.55, G.armStart * 1.7, r).toVar();
        const rim = float(1.0).sub(smoothstep(R * 0.8, R * 1.07, r)).toVar();
        const oldTone = mix(u.core, mix(u.core, u.armInner, 0.6), smoothstep(R * 0.1, R * 0.55, r));
        const old = oldTone.mul(exp(r.div(-RD)).mul(a2.mul(0.5).add(0.42)).mul(grain.clump.mul(0.5).add(0.75))
            .mul(OLD_GAIN));
        const young = mix(u.armInner, u.armOuter, smoothstep(R * 0.14, R * 0.8, r))
            .mul(a2.mul(a2).mul(armOn).mul(grain.clump.mul(1.6).add(0.2)).mul(exp(r.div(-RD * 2.4)))
                .mul(YOUNG_GAIN));
        const edge = knot.mul(knot).mul(knot).mul(a).mul(armOn)
            .mul(exp(r.div(-RD * 2.8)))
            .toVar();
        const knots = u.nursery.mul(grain.knots.mul(edge).mul(KNOT_GAIN))
            .add(mix(u.nursery, vec3(1.0, 0.92, 0.96), 0.6).mul(grain.hearts.mul(edge).mul(KNOT_GAIN * 1.6)));
        const bar = u.core.mul(exp(p.z.mul(p.z).div(-9.0)).mul(exp(r.mul(r).div(-150.0))).mul(BAR_GAIN));
        const emission = old.add(young).add(knots).add(bar).mul(rim);
        const window = smoothstep(4.0, 13.0, r).mul(float(1.0).sub(smoothstep(R * 0.7, R, r)));
        const lane2 = lane.mul(lane);
        const sigma = lane2.mul(lane2).mul(1.35).mul(grain.threads.mul(grain.patches.add(0.35)).mul(1.9).add(0.3))
            .add(grain.threads.mul(grain.patches).mul(a).mul(0.55))
            .mul(window)
            .mul(DUST_GAIN);
        return { emission, sigma };
    };

    /** The light of a spheroid of core radius `a` along the ray: (in front of the midplane, behind it). */
    const spheroid = (o, d, tMid, a, flat) => {
        const os = vec3(o.x, o.y.div(flat), o.z);
        const ds = vec3(d.x, d.y.div(flat), d.z);
        const m2 = ds.dot(ds);
        const m = sqrt(m2);
        const od = os.dot(ds);
        const c2 = os.dot(os).sub(od.mul(od).div(m2)).add(a * a).toVar();
        const c = sqrt(c2).toVar();
        const s = tMid.add(od.div(m2)).toVar();
        const F = s.div(c2.mul(2.0).mul(c2.add(m2.mul(s).mul(s))))
            .add(atan(m.mul(s).div(c)).div(c2.mul(c).mul(m).mul(2.0)));
        const half = float(Math.PI * 0.25).div(c2.mul(c).mul(m));
        const norm = m.mul((2 * a * a * a) / Math.PI);
        return vec2(F.add(half).mul(norm), half.sub(F).mul(norm));
    };

    const B = G.bound;
    const H = G.halfHeight;
    const out = Fn(() => {
        // The mesh's frame -> the disc's (the box geometry was turned +90 deg about X: (x, y, z) ->
        // (x, -z, y), so back is (x, y, z) -> (x, z, -y)).
        const toDisc = (v) => vec3(v.x, v.z, v.y.negate());
        const camLocal = toDisc(modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz).toVar();
        const ro = toDisc(positionLocal).toVar();
        const rd = normalize(ro.sub(camLocal)).toVar();
        // Radians one pixel subtends, from the ray's own screen derivative.
        const pixelAngle = max(length(fwidth(rd)), 1e-6).toVar();
        const sgn = step(0.0, rd).mul(2.0).sub(1.0).toVar();
        const rs = sgn.mul(max(abs(rd), 1e-4)).toVar();
        const tx = sgn.mul(vec3(B, H, B)).sub(ro).div(rs).toVar();
        const tExit = max(min(tx.x, min(tx.y, tx.z)), 0.0).toVar();
        const tMid = clamp(ro.y.negate().div(rs.y), 0.0, tExit).toVar();
        const pm = ro.add(rd.mul(tMid)).toVar();
        const slope = max(abs(rd.y), 0.1).toVar();
        const footprint = length(pm.sub(camLocal)).mul(pixelAngle).toVar();

        const grain = grainAt(pm, footprint);
        const dustRgb = vec3(DUST_RGB[0], DUST_RGB[1], DUST_RGB[2]);
        const s = sampleAt(pm, grain);
        const tau = s.sigma.mul(H_DUST * SQRT_PI).div(slope).toVar();
        // Light born evenly through the dust escapes as (1 - e^-tau)/tau: a lane is a shadow, not a crack.
        const tauRgb = max(tau.mul(dustRgb), vec3(1e-3)).toVar();
        const through = float(1.0).sub(exp(tauRgb.negate())).div(tauRgb);
        const acc = s.emission.mul(float(H_GAS * SQRT_PI).div(slope)).mul(through).toVar();
        const T = exp(tau.negate().mul(dustRgb)).toVar();

        const bulge = spheroid(ro, rd, tMid, G.bulge, G.bulgeFlat).toVar();
        const cluster = spheroid(ro, rd, tMid, CLUSTER_RADIUS, 1.0).toVar();
        const near = u.core.mul(bulge.x.mul(BULGE_PEAK)).add(u.nucleus.mul(cluster.x.mul(CLUSTER_PEAK)));
        const far = u.core.mul(bulge.y.mul(BULGE_PEAK)).add(u.nucleus.mul(cluster.y.mul(CLUSTER_PEAK)));
        const col = near.add(acc).add(far.mul(T)).mul(u.gain);
        const veil = T.x.add(T.y).add(T.z).div(3.0);
        // The chapter's staging fades it (materialOpacity), light and dust together.
        return vec4(col.mul(materialOpacity), float(1.0).sub(veil).mul(materialOpacity));
    })();
    material.colorNode = out.xyz;
    material.opacityNode = out.w;

    const geometry = new THREE.BoxGeometry(B * 2, H * 2, B * 2);
    geometry.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'spiral-galaxy';
    mesh.userData.discRadius = G.radius;
    mesh.frustumCulled = false;
    mesh.renderOrder = SPIRAL_GALAXY_DRAW_ORDER.disc;
    yield 'galaxy';

    const suns = createSuns(u, SPIRAL_GALAXY_SUNS.count[quality] ?? SPIRAL_GALAXY_SUNS.count.high);
    mesh.add(suns.mesh);
    return {
        mesh,
        material,
        uniforms: u,
        dispose() {
            geometry.dispose();
            material.dispose();
            noiseTex.dispose();
            suns.dispose();
        },
    };
}

/**
 * THE SUNS (odyssey-spiral-galaxy-suns.js; the theme's createStars): one instanced draw of
 * camera-facing quads, each sun a closed form of the clock. Arm suns keep their place on the ridge
 * (a small epicycle keeps them alive); old suns orbit, faster inside (a flat rotation curve), and
 * brighten as they cross an arm; the bulge's and the halo's few bright ones stand out of their
 * unresolved light. A sun is never under a pixel (a sub-pixel point shimmers as the eye drifts);
 * what the clamp adds in area it takes back in light. Added light, faded with the chapter.
 * Child of the galaxy's mesh: its frame faces +Z, the disc's (x, y, z) is the mesh's (x, -z, y).
 */
function createSuns(u, count) {
    const G = SPIRAL_GALAXY;
    const plan = planSpiralGalaxySuns(count);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(plan.orbit, 4));
    geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(plan.look, 4));
    geometry.instanceCount = plan.count;
    const orbit = attribute('aOrbit', 'vec4');
    const look = attribute('aLook', 'vec4');

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'Odyssey spiral galaxy suns';
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.forceSinglePass = true;
    material.userData.emitsBloom = true;

    const vLight = varyingProperty('vec3', 'sgSun');
    material.vertexNode = Fn(() => {
        const radius = orbit.x;
        const pop = look.z;
        const mag = look.y;
        const isArm = float(1.0).sub(step(0.5, pop));
        const isDisc = step(0.5, pop).mul(float(1.0).sub(step(1.5, pop)));
        const ridge = armAngle(radius, u.winding);
        const flow = u.time;
        const rate = float(STREAM_RATE * 30).div(max(radius, 6.0)).sub(PATTERN_RATE);
        const epicycle = sin(flow.mul(0.37).add(look.w.mul(TAU))).mul(0.014);
        const angle = mix(orbit.y.sub(rate.mul(flow)), ridge.add(orbit.y).add(epicycle), isArm).toVar();
        const disc = vec3(cos(angle).mul(radius), orbit.z, sin(angle).mul(radius)).toVar();
        // An old sun brightens as it crosses an arm.
        const inArm = cos(angle.sub(ridge).mul(G.arms)).mul(0.5).add(0.5);
        const crossing = mix(float(1.0), inArm.mul(inArm).mul(inArm).mul(1.25).add(0.42), isDisc);
        const temp = look.x;
        const warm = mix(vec3(1.0, 0.5, 0.26), u.core, smoothstep(0.0, 0.42, temp));
        const young = mix(u.armInner, u.armOuter, smoothstep(14.0, 80.0, radius)).mul(0.55)
            .add(vec3(0.5, 0.56, 0.7));
        const hot = mix(vec3(1.0, 0.97, 0.94), young, smoothstep(0.6, 1.0, temp));
        const tint = mix(warm, hot, smoothstep(0.36, 0.64, temp));
        const twinkle = sin(u.time.mul(look.w.mul(2.6).add(0.7)).add(orbit.w.mul(40.0))).mul(0.2).add(0.8);
        const bright = smoothstep(0.6, 1.0, mag);
        const isOld = step(1.5, pop);
        const resolved = mix(float(1.0), mix(float(0.6), float(0.25), isOld), step(0.5, pop))
            .add(bright.mul(0.75)).min(1.0);
        const light = tint.mul(mag.mul(1.2).add(0.16).add(bright.mul(bright).mul(3.0))).mul(crossing)
            .mul(twinkle)
            .mul(resolved);

        const world = modelWorldMatrix.mul(vec4(disc.x, disc.z.negate(), disc.y, 1.0)).xyz;
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0)).toVar();
        // Radians per pixel (vertically) and the mesh's world scale: the theme's sizes are in the
        // galaxy's own units.
        const pixelAngle = float(2.0).div(cameraProjectionMatrix.element(1).y.mul(screenSize.y));
        const worldScale = length(modelWorldMatrix.element(0).xyz);
        const raw = mag.mul(0.16).add(bright.mul(0.12)).add(0.1).mul(worldScale)
            .div(max(clip.w, 1.0).mul(pixelAngle));
        const px = clamp(raw, 1.05, screenSize.y.mul(0.012));
        const paid = clamp(raw.div(px), 0.42, 1.0);
        vLight.assign(light.mul(paid.mul(paid)).mul(u.gain).mul(SPIRAL_GALAXY_SUNS.gain));
        const half = screenSize.mul(0.5);
        return vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    })();
    // Added light, written as the whole output (premultiplied: a colorNode would be multiplied by an
    // alpha of 0 and draw nothing).
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d2 = q.dot(q);
        const core = exp(d2.mul(-6.0)).mul(float(1.0).sub(smoothstep(0.7, 1.0, length(q))));
        return vec4(vLight.mul(core).mul(materialOpacity), 0.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'spiral-galaxy-suns';
    mesh.frustumCulled = false;
    mesh.renderOrder = SPIRAL_GALAXY_DRAW_ORDER.suns;
    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
