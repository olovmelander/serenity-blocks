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
 *   3. Stars in layers with their own colour temperature and twinkle, a few bright ones
 *      with a soft glow and a glint. The layers shift by different amounts as the camera
 *      moves, so the sky has depth of its own. No star is drawn under about a pixel.
 *   4. The swarm's own light scattered in the dust: a wide, faint halo at the centre.
 *   5. What happens by itself (composition/swarm-moods.js schedules it): shooting stars, one
 *      now and then, a shower of them for a perfect clear.
 *
 * The flock's moods turn the sky too (`uMood`): how much gas shows, how bright the stars
 * stand, a dusk glow low in the frame, and how far the wisps lean to violet.
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
    Loop,
    abs,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    mat3,
    max,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    uniform,
    uniformArray,
    vec2,
    vec3,
} from 'three/tsl';

/** Shooting stars the sky can draw at once (a perfect clear's shower fills them all). */
export const MAX_METEORS = 6;
/** A shooting star: how fast it falls and how long its streak is (tangent-plane units), and its life (s). */
export const METEOR_SPEED = 0.5;
export const METEOR_LENGTH = 0.13;
export const METEOR_LIFE = 1.15;

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

/** 1 where x is positive. */
const step01 = (x) => smoothstep(0.0, 1e-5, x);

const OCTAVE_TURN = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
/** The direction the nebula's band runs across the sky (unit length, folded in JS). */
const BAND_AXIS = vec3(0.94 / Math.hypot(0.94, 0.34), 0.34 / Math.hypot(0.94, 0.34), 0.0);

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
const starLayer = /* @__PURE__ */ Fn(([s, cells, density, radiusIn, time, pixel]) => {
    // Never under about a pixel: a smaller star keeps its light and stops shimmering.
    const floorR = pixel.mul(cells).mul(0.8).toVar();
    const radius = max(radiusIn, floorR).toVar();
    const spread = radiusIn.div(radius).toVar();
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
    return temperature.mul(core.mul(present).mul(magnitude).mul(twinkle).mul(spread.mul(spread)));
}).setLayout({
    name: 'murm_stars',
    type: 'vec3',
    inputs: [
        { name: 's', type: 'vec2' },
        { name: 'cells', type: 'float' },
        { name: 'density', type: 'float' },
        { name: 'radiusIn', type: 'float' },
        { name: 'time', type: 'float' },
        { name: 'pixel', type: 'float' },
    ],
});

/**
 * The few bright stars: a hard core, a soft glow, and (with `glint` 1) a thin four-point
 * cross. One to a cell of a coarse grid, most cells empty. Returns rgb.
 */
const heroStars = /* @__PURE__ */ Fn(([s, time, pixel, glint]) => {
    const g = s.mul(6.5).toVar();
    const id = floor(g).toVar();
    const f = fract(g).sub(0.5).toVar();
    const h = hash21(id.add(vec2(5.0, 71.0))).toVar();
    const h2 = hash21(id.add(vec2(61.0, 13.0))).toVar();
    const h3 = hash21(id.add(vec2(19.0, 47.0))).toVar();
    const at = f.sub(vec2(h2, h3).sub(0.5).mul(0.72)).div(6.5).toVar(); // tangent-plane units
    const d = length(at).toVar();
    const present = smoothstep(0.52, 0.6, h);
    const size = h3.mul(0.6).add(0.55).toVar();
    const core = max(pixel.mul(1.15), float(0.0011).mul(size)).toVar();
    const body = exp(d.mul(d).div(core.mul(core)).negate()).mul(1.5)
        .add(float(1.0).div(d.div(core.mul(2.6)).mul(d.div(core.mul(2.6))).add(1.0)).mul(0.075)
            .mul(float(1.0).sub(smoothstep(0.012, 0.03, d))));
    const armW = max(pixel.mul(0.7), float(0.0005)).toVar();
    const reach = float(0.016).mul(size).toVar();
    const arms = exp(abs(at.y).div(armW).negate()).mul(exp(abs(at.x).div(reach).negate()))
        .add(exp(abs(at.x).div(armW).negate()).mul(exp(abs(at.y).div(reach).negate())))
        .mul(0.34)
        .mul(glint);
    const twinkle = float(0.8).add(sin(time.mul(h2.mul(1.3).add(0.5)).add(h.mul(70.0))).mul(0.2));
    const temperature = mix(vec3(0.66, 0.78, 1.0), vec3(1.0, 0.84, 0.7), smoothstep(0.6, 1.0, h2));
    return temperature.mul(body.add(arms).mul(present).mul(twinkle).mul(size));
}).setLayout({
    name: 'murm_heroStars',
    type: 'vec3',
    inputs: [
        { name: 's', type: 'vec2' },
        { name: 'time', type: 'float' },
        { name: 'pixel', type: 'float' },
        { name: 'glint', type: 'float' },
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
    // The colours of the swarm's left and right wings: its light on the dust round it.
    const uWingA = uniform(new THREE.Color(0.0, 0.7, 0.9));
    const uWingB = uniform(new THREE.Color(0.6, 0.2, 1.0));
    // Camera offset from rest (world units): star layers shift against each other.
    const uParallax = uniform(new THREE.Vector2(0, 0));
    // The flock's mood in the sky: (gas, star light, the dusk glow low in the frame, violet lean).
    const uMood = uniform(new THREE.Vector4(1, 1, 0.25, 0.35));
    // One buffer pixel in tangent-plane units (the frame is about 0.69 units tall).
    const uPixel = uniform(0.00096);
    // Shooting stars: (x, y, the angle it falls along, age in seconds), live ones packed first.
    const meteorRows = Array.from({ length: MAX_METEORS }, () => new THREE.Vector4(0, 0, 0, 0));
    const uMeteors = uniformArray(meteorRows, 'vec4');
    const uMeteorCount = uniform(0, 'int');
    // Without a post stack nothing sinks the gas into the night: the sky does it itself.
    const toe = Number(options.toe) > 0 ? Number(options.toe) : 0;

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
        // Dusk: a glow that stands low in the frame in some moods, as if the day had only just gone.
        const low = exp(max(s.y.add(0.42), float(0.0)).mul(-7.0));
        ground.addAssign(mix(vec3(0.34, 0.07, 0.44), uTintB, 0.3).mul(low.mul(uMood.z).mul(0.085)));

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

        // Threads. Read from the cloud squeezed along the band, so where the field crosses
        // its middle the crossings run on as long strands instead of closing into loops:
        // bright ones in the gas, dark ones in the dust. (High detail only.)
        let threads = float(0.0);
        let darkThreads = float(0.0);
        if (high) {
            const strand = p.sub(BAND_AXIS.mul(dot(p, BAND_AXIS).mul(0.55))).toVar();
            const nBright = fbmWarp(strand.mul(3.4).add(warp.mul(1.3)).add(vec3(7.0, 3.0, 11.0)));
            const rB = float(1.0).sub(abs(nBright.mul(2.0).sub(1.0))).toVar();
            const rB2 = rB.mul(rB);
            const rB4 = rB2.mul(rB2).toVar();
            threads = rB4.mul(rB4).mul(rB4).mul(smoothstep(0.1, 0.65, density)).toVar();
            const rD = float(1.0).sub(abs(lanes.mul(2.0).sub(1.0))).toVar();
            darkThreads = rD.mul(rD).mul(rD);
        }
        // Dust: extinction draws the edges, so they are soft however sharp the lanes are.
        const tau = smoothstep(0.46, 0.76, lanes).mul(1.7).add(darkThreads.mul(0.9));
        const dust = exp(tau.negate()).toVar();
        const wisps = smoothstep(0.55, 0.95, cloud).mul(density);

        const hueMix = smoothstep(0.3, 0.7, fbmWarp(p.mul(0.6).add(vec3(0.0, 21.0, 3.0))));
        // The wisps lean to violet (by the mood), whatever the swarm is wearing.
        const worn = mix(uTintA, uTintB, hueMix).toVar();
        const wornLevel = max(max(worn.r, worn.g), worn.b);
        const tint = mix(worn, vec3(0.42, 0.16, 0.86).mul(wornLevel), uMood.w.mul(0.55)).toVar();
        const inner = float(1.0).add(uPulse.mul(1.2)).add(uFlash.mul(1.4));
        // The light swells on a wide ramp, with a brighter heart where the cloud is thickest.
        const nebula = tint.mul(density.mul(0.085).add(density.mul(density).mul(0.06)))
            .add(mix(tint, vec3(1.0, 0.82, 0.9), 0.35).mul(wisps.mul(0.11)))
            .add(mix(tint, vec3(0.9, 0.95, 1.0), 0.5).mul(threads.mul(0.12)))
            .mul(dust)
            .mul(inner)
            .mul(uMood.x);
        // The tints already turn with the swarm's heat; this only warms the gas a touch more.
        const warmed = mix(nebula, nebula.mul(vec3(1.4, 0.92, 0.65)), uHeat.mul(0.25));

        // 3. Stars. Dust hides the faint layers; a dust of tiny stars thickens along the band.
        const far = starLayer(s.add(uParallax.mul(0.004)), float(96.0), float(0.5), float(0.085), uTime, uPixel);
        const nearAt = s.add(uParallax.mul(0.012)).add(vec2(3.7, 1.9));
        const near = starLayer(nearAt, float(38.0), float(0.2), float(0.07), uTime, uPixel);
        let stars = far.mul(dust.mul(0.55)).mul(float(1.0).sub(density.mul(0.7))).add(near.mul(1.5));
        if (high) {
            const fineAt = s.add(uParallax.mul(0.002)).add(vec2(11.3, 5.1));
            const fine = starLayer(fineAt, float(230.0), band.mul(0.55).sub(0.1), float(0.11), uTime, uPixel);
            stars = stars.add(fine.mul(dust).mul(0.32));
        }
        // The few bright ones, nearest of all (they move most as the camera does).
        const heroes = heroStars(s.add(uParallax.mul(0.02)).add(vec2(1.3, 7.7)), uTime, uPixel, float(high ? 1 : 0));
        stars = stars.add(heroes.mul(dust.mul(0.5).add(0.5))).mul(uMood.y);

        // 5. What happens by itself.
        const happenings = vec3(0.0).toVar();
        // Shooting stars: a head, and a streak behind it that thins to nothing.
        const streakW = max(uPixel.mul(0.9), float(0.0008)).toVar();
        Loop({
            start: int(0), end: uMeteorCount, type: 'int', condition: '<', name: 'm',
        }, ({ m }) => {
            const row = uMeteors.element(m).toVar();
            const dirM = vec2(cos(row.z), sin(row.z)).toVar();
            const head = row.xy.add(dirM.mul(row.w.mul(METEOR_SPEED))).toVar();
            const toHead = s.sub(head).toVar();
            const along = dot(toHead, dirM).toVar(); // negative behind the head
            const aside = dot(toHead, vec2(dirM.y.negate(), dirM.x)).toVar();
            const life = smoothstep(0.0, 0.12, row.w)
                .mul(float(1.0).sub(smoothstep(METEOR_LIFE * 0.62, METEOR_LIFE, row.w)));
            const tail = clamp(along.div(METEOR_LENGTH).add(1.0), 0.0, 1.0).mul(step01(along.negate()));
            const widthAt = streakW.mul(tail.mul(0.7).add(0.3));
            const streak = exp(aside.mul(aside).div(widthAt.mul(widthAt)).negate()).mul(tail.mul(tail));
            const glowR = streakW.mul(3.2);
            const headGlow = exp(dot(toHead, toHead).div(glowR.mul(glowR)).negate());
            happenings.addAssign(mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.96, 0.9), tail)
                .mul(streak.mul(0.9).add(headGlow.mul(0.8)).mul(life)));
        });

        // 4. The swarm's light in the dust: a faint glow round the swarm, each wing in its own
        // colour, brighter where there is gas to catch it. Play lifts it.
        const wingTint = mix(uWingA, uWingB, smoothstep(-0.5, 0.5, s.x));
        // Strongest over the swarm's ring, less in the hole the board stands in.
        const ring = length(vec2(s.x.div(0.66), s.y.div(0.31))).sub(0.62).div(0.42);
        const reach = exp(ring.mul(ring).negate());
        const catchLight = float(0.3).add(density.mul(1.1)).add(threads.mul(1.4)).mul(dust.mul(0.6).add(0.4));
        const scatterGain = float(0.022).add(uPulse.mul(0.04)).add(uFlash.mul(0.09));
        const scatter = wingTint.mul(reach.mul(catchLight).mul(scatterGain));

        const night = ground.add(warmed).add(scatter).toVar();
        // (Minimal has no post stack to sink the gas into the night: a toe of its own.)
        if (toe > 0) night.assign(max(night.sub(toe), vec3(0.0)).mul(1.0 + toe * 6.0));
        return night.add(stars).add(happenings);
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
            uTime,
            uHeat,
            uActProgress,
            uPulse,
            uFlash,
            uTintA,
            uTintB,
            uWingA,
            uWingB,
            uParallax,
            uMood,
            uPixel,
            uMeteorCount,
        },
        /** The shooting stars' rows (x, y, angle, age): the show writes them, live ones first. */
        meteorRows,
        dispose: () => {
            geometry.dispose();
            material.dispose();
        },
    };
}
