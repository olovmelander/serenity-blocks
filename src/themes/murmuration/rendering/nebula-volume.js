/* eslint-disable import/no-unresolved */
/**
 * Murmuration — the night the swarm flies in.
 *
 * A dark sky, on purpose. The swarm is the light source of this theme; it only reads as
 * light against something that is nearly black. What the dome draws, back to front:
 *
 *   1. A deep indigo ground, a shade warmer toward the bottom of the frame.
 *   2. Emission nebula: domain-warped value-noise FBM gathered into a diagonal band
 *      behind the swarm, tinted by the two hues the swarm is currently wearing, and cut
 *      by dark dust lanes. It answers play: a combo pulse lights the cloud from within.
 *   3. Two layers of stars with their own colour temperature and twinkle. The layers
 *      shift by different amounts as the camera moves, so the sky has depth of its own.
 *   4. The swarm's own light scattered in the dust: a wide, faint halo at the centre.
 *
 * The camera of this theme only ever looks one way through a 38° lens, so the dome is
 * composed in tangent-plane coordinates (s = dir.xy / -dir.z), like a matte painting.
 *
 * Every noise helper has a layout, so the builder emits real WGSL functions instead of
 * inlining an FBM at each call site.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    cameraPosition,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    mat3,
    max,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    uniform,
    vec2,
    vec3,
} from 'three/tsl';

const hash21 = /* @__PURE__ */ Fn(([p]) => {
    const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'murm_hash21', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

const hash31 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(pIn.mul(0.1031)).toVar();
    p.addAssign(dot(p, p.zyx.add(31.32)));
    return fract(p.x.add(p.y).mul(p.z));
}).setLayout({ name: 'murm_hash31', type: 'float', inputs: [{ name: 'pIn', type: 'vec3' }] });

const noise3 = /* @__PURE__ */ Fn(([pIn]) => {
    const i = floor(pIn).toVar();
    const f = fract(pIn).toVar();
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
    const a = hash31(i);
    const b = hash31(i.add(vec3(1.0, 0.0, 0.0)));
    const c = hash31(i.add(vec3(0.0, 1.0, 0.0)));
    const d = hash31(i.add(vec3(1.0, 1.0, 0.0)));
    const e = hash31(i.add(vec3(0.0, 0.0, 1.0)));
    const g = hash31(i.add(vec3(1.0, 0.0, 1.0)));
    const h = hash31(i.add(vec3(0.0, 1.0, 1.0)));
    const k = hash31(i.add(vec3(1.0, 1.0, 1.0)));
    return mix(
        mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
        mix(mix(e, g, u.x), mix(h, k, u.x), u.y),
        u.z,
    );
}).setLayout({ name: 'murm_noise3', type: 'float', inputs: [{ name: 'pIn', type: 'vec3' }] });

const OCTAVE_TURN = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);

function makeFbm(octaves, name) {
    return Fn(([pIn]) => {
        const p = vec3(pIn).toVar();
        const total = float(0.0).toVar();
        const amp = float(0.5).toVar();
        for (let i = 0; i < octaves; i += 1) {
            total.addAssign(noise3(p).mul(amp));
            // Each octave is turned as well as scaled: value noise is built on a cubic
            // lattice, and octaves that share its axes add up to straight-edged shapes.
            p.assign(OCTAVE_TURN.mul(p).mul(2.03).add(vec3(17.1, 9.2, 4.7)));
            amp.mulAssign(0.5);
        }
        return total;
    }).setLayout({ name, type: 'float', inputs: [{ name: 'pIn', type: 'vec3' }] });
}

/**
 * One layer of stars on a jittered grid. Returns rgb.
 * `cells` = grid cells per unit of tangent-plane coordinate; `density` = share of cells
 * that hold a star; `radius` in cell units.
 */
const starLayer = /* @__PURE__ */ Fn(([s, cells, density, radius, time]) => {
    const g = s.mul(cells).toVar();
    const id = floor(g).toVar();
    const f = fract(g).sub(0.5).toVar();
    const h = hash21(id).toVar();
    const h2 = hash21(id.add(vec2(37.0, 91.0))).toVar();
    const h3 = hash21(id.add(vec2(113.0, 7.0))).toVar();
    const offset = vec2(h2, h3).sub(0.5).mul(0.7);
    const d = length(f.sub(offset));
    const present = smoothstep(float(1.0).sub(density), float(1.0).sub(density.mul(0.5)), h);
    // A few bright stars, many faint: brightness is a steep power of the cell hash.
    const magnitude = h3.mul(h3).mul(h3).mul(0.9).add(0.1);
    const twinkle = float(0.78).add(sin(time.mul(h2.mul(2.2).add(0.6)).add(h.mul(90.0))).mul(0.22));
    const core = smoothstep(radius, radius.mul(0.15), d);
    const temperature = mix(vec3(0.62, 0.74, 1.0), vec3(1.0, 0.86, 0.74), smoothstep(0.55, 1.0, h2));
    return temperature.mul(core.mul(present).mul(magnitude).mul(twinkle));
}).setLayout({
    name: 'murm_stars',
    type: 'vec3',
    inputs: [
        { name: 's', type: 'vec2' },
        { name: 'cells', type: 'float' },
        { name: 'density', type: 'float' },
        { name: 'radius', type: 'float' },
        { name: 'time', type: 'float' },
    ],
});

/**
 * @param {{ detail?: 'low'|'high' }} [options] low = three octaves and one warp (Minimal/Low)
 */
export function createNebulaSky(options = {}) {
    const high = options.detail !== 'low';
    // The shader does the work; the sphere only has to cover the view.
    const geometry = new THREE.SphereGeometry(180, 12, 8);

    const uTime = uniform(0);
    const uHeat = uniform(0); // a long combo warms the cloud
    const uActProgress = uniform(0); // kept for callers; unused by the dome
    const uPulse = uniform(0); // combo-driven light inside the cloud
    const uFlash = uniform(0); // a big clear lights the whole sky for a moment
    // The two hues the swarm is wearing now; the nebula is lit in them.
    const uTintA = uniform(new THREE.Color(0.26, 0.10, 0.72));
    const uTintB = uniform(new THREE.Color(0.02, 0.42, 0.62));
    // Camera offset from rest (world units): star layers shift against each other.
    const uParallax = uniform(new THREE.Vector2(0, 0));

    const fbmCloud = makeFbm(high ? 5 : 3, high ? 'murm_fbm5' : 'murm_fbm3');
    const fbmWarp = makeFbm(high ? 3 : 2, high ? 'murm_fbm3w' : 'murm_fbm2w');

    const fragmentNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        // Tangent-plane coordinates: the frame is about ±0.61 × ±0.34 at 16:9.
        const s = dir.xy.div(max(dir.z.negate(), float(0.05))).toVar();

        // 1. Ground
        const ground = mix(
            vec3(0.012, 0.006, 0.028),
            vec3(0.004, 0.008, 0.026),
            smoothstep(-0.4, 0.4, s.y),
        ).toVar();

        // 2. Nebula
        const drift = vec3(uTime.mul(0.006), uTime.mul(-0.004), uTime.mul(0.005));
        const p = dir.mul(2.6).add(drift).toVar();
        const warp = vec3(
            fbmWarp(p.add(vec3(1.7, 9.2, 0.0))),
            fbmWarp(p.add(vec3(8.3, 2.8, 5.1))),
            high ? fbmWarp(p.add(vec3(3.1, 6.6, 9.4))) : float(0.5),
        ).sub(0.48).toVar();
        const cloud = fbmCloud(p.add(warp.mul(1.9))).toVar();
        const lanes = fbmWarp(p.mul(1.7).add(warp.mul(2.6)).add(vec3(40.0, 0.0, 0.0))).toVar();

        // A diagonal band behind the swarm, wider at the centre.
        const across = s.x.mul(0.34).sub(s.y.mul(0.94));
        const band = exp(across.mul(across).mul(-7.0)).mul(0.75).add(0.25).toVar();
        const density = smoothstep(0.42, 0.78, cloud.mul(band.mul(0.5).add(0.72))).toVar();
        const dust = float(1.0).sub(smoothstep(0.5, 0.74, lanes).mul(0.82));
        const wisps = smoothstep(0.55, 0.95, cloud).mul(density);

        const hueMix = smoothstep(0.3, 0.7, fbmWarp(p.mul(0.6).add(vec3(0.0, 21.0, 3.0))));
        const tint = mix(uTintA, uTintB, hueMix).toVar();
        const inner = float(1.0).add(uPulse.mul(1.2)).add(uFlash.mul(1.4));
        const nebula = tint.mul(density.mul(0.11))
            .add(mix(tint, vec3(1.0, 0.82, 0.9), 0.35).mul(wisps.mul(0.13)))
            .mul(dust).mul(inner);
        const warmed = mix(nebula, nebula.mul(vec3(1.55, 0.9, 0.55)), uHeat.mul(0.5));

        // 3. Stars. Dust hides the faint layer.
        const far = starLayer(s.add(uParallax.mul(0.004)), float(96.0), float(0.5), float(0.085), uTime);
        const nearAt = s.add(uParallax.mul(0.012)).add(vec2(3.7, 1.9));
        const near = starLayer(nearAt, float(38.0), float(0.2), float(0.07), uTime);
        const stars = far.mul(dust.mul(0.55)).mul(float(1.0).sub(density.mul(0.7))).add(near.mul(1.5)).toVar();

        // 4. The swarm's light in the dust.
        const halo = exp(s.x.mul(s.x).mul(-2.2).sub(s.y.mul(s.y).mul(6.5)));
        const scatterGain = float(0.012).add(uPulse.mul(0.03)).add(uFlash.mul(0.07));
        const scatter = mix(uTintA, uTintB, 0.5).mul(halo.mul(scatterGain));

        return ground.add(warmed).add(scatter).add(stars);
    })();

    const material = new MeshBasicNodeMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
    });
    material.colorNode = fragmentNode;
    material.emissiveNode = vec3(0.0); // the sky is not a bloom source
    material.userData.emitsBloom = false;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;

    return {
        mesh,
        uniforms: {
            uTime, uHeat, uActProgress, uPulse, uFlash, uTintA, uTintB, uParallax,
        },
        dispose: () => {
            geometry.dispose();
            material.dispose();
        },
    };
}
