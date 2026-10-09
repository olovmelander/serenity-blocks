/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Waves — shared TSL: the sky, the wave's shape on the GPU, the optics of its water.
 *
 * The wave is shaded as glass, not as paint. Three pieces make that work and are shared by
 * every part that draws water or is lit by it:
 *
 *   wavesSky      the golden-hour sky as a function of direction (and, below the horizon, the
 *                 far sea that mirrors it). The dome draws it; the water refracts and reflects
 *                 it; spray and mist take their light from it.
 *   tubeTrace     one ray inside the tube, closed form: where a reflection leaves a point of
 *                 the wall, does it meet the wall again, the trough, or the opening?
 *   tubeEnvironment   what that ray sees: the sky through the opening, the trough, or the wall
 *                 in its broad colour: the sky behind it where it is thin (`skyBehind`), dimmed
 *                 and turned emerald by how much water the light crossed (`sheetThickness`,
 *                 `transmit`), and the water's own scattered green where it is thick.
 *
 * Laid-out functions here are pure (every value comes in as a parameter): the builder emits each
 * once and reuses it in every material.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, atan, clamp, cos, dot, exp, float, max, min, mix, normalize, pow, select, sin, smoothstep, sqrt, vec2,
    vec3, vec4,
} from 'three/tsl';
import {
    DEG, FLOW, FLOW_SPEED, TAU, WAVE, bakeWaterNoise,
} from './waves-core.js';

/** The sun: degrees to the left of the line the eye looks down, and above the horizon. */
export const SUN = Object.freeze({ azimuth: 15, elevation: 8.5 });

/** A unit vector toward the sun for an azimuth and elevation (degrees). */
export function sunDirection(azimuth = SUN.azimuth, elevation = SUN.elevation, out = new THREE.Vector3()) {
    const az = azimuth * DEG;
    const el = elevation * DEG;
    return out.set(-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** What a metre of this water takes out of white light (per metre, r g b). */
export const ABSORB = Object.freeze([0.6, 0.07, 0.115]);
/** The colour the water itself scatters back when lit. */
export const SCATTER = Object.freeze([0.005, 0.125, 0.11]);
/** Thickness of water where there is wave behind the surface, not sky (metres). */
export const DEEP = 15;

/** The water's noise field as a texture (see bakeWaterNoise). */
export function createWaterNoise(size) {
    const map = new THREE.DataTexture(bakeWaterNoise(size), size, size, THREE.RGBAFormat);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.anisotropy = 8;
    map.colorSpace = THREE.NoColorSpace;
    map.needsUpdate = true;
    map.name = 'waves-water-noise';
    return map;
}

// ── Sky ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The sky in a direction, scene-linear. `sharp` (0..1) is how much of the sun's disc survives:
 * 1 for the dome, less for a reflection in moving water, which smears it into a lobe. `warm`
 * (0..1) leans the whole sky toward gold (a chain of clears). Below the horizon it returns the
 * far sea: the mirrored sky, darkened, over deep water.
 */
export const wavesSky = /* @__PURE__ */ Fn(([dir, sun, sharp, warm]) => {
    const below = dir.y.lessThan(0.0);
    const d = vec3(dir.x, abs(dir.y), dir.z);
    const up = d.y;
    const mu = dot(d, sun);
    const toward = clamp(mu.mul(0.5).add(0.5), 0.0, 1.0);
    const t2 = toward.mul(toward);
    const t4 = t2.mul(t2);
    // Three bands: the burning horizon, the pale belt over it, the blue overhead.
    const horizon = mix(vec3(0.27, 0.24, 0.3), vec3(0.82, 0.4, 0.15), t4);
    const belt = mix(vec3(0.11, 0.19, 0.34), vec3(0.36, 0.31, 0.33), t2);
    const zenith = mix(vec3(0.028, 0.085, 0.25), vec3(0.05, 0.115, 0.28), toward);
    const low = mix(horizon, belt, smoothstep(0.0, 0.2, up));
    const base = mix(low, zenith, smoothstep(0.1, 0.8, up)).toVar();
    base.mulAssign(mix(vec3(1.0), vec3(1.16, 1.0, 0.8), warm));
    // The sun: a wide warm bloom, a tight aureole, the disc.
    // Never above zero: a direction a hair longer than unit would put the sun's lobes past their
    // peak, and the disc's exponent turns that into infinity (black blocks where the sun's sparks
    // should be, on the backends that keep it).
    const away = min(mu.sub(1.0), 0.0);
    const bloom = exp(away.mul(26.0)).mul(vec3(0.5, 0.2, 0.05));
    const aureole = exp(away.mul(300.0)).mul(vec3(1.5, 0.8, 0.26));
    const disc = exp(away.mul(mix(700.0, 17000.0, sharp))).mul(mix(7.0, 70.0, sharp)).mul(vec3(1.0, 0.8, 0.5));
    const glare = exp(away.mul(1900.0)).mul(sharp).mul(vec3(2.6, 1.5, 0.5));
    const sky = base.add(bloom).add(aureole).add(glare).add(disc);
    // The far sea: the mirrored sky at a grazing angle, darkened, the disc drawn out into a road.
    const sea = base.mul(0.42).add(bloom.mul(0.5)).add(aureole.mul(0.22)).add(vec3(0.004, 0.03, 0.04));
    const haze = horizon.mul(mix(vec3(1.0), vec3(1.16, 1.0, 0.8), warm));
    const out = select(below, sea, sky);
    return mix(out, haze, exp(up.mul(-26.0)).mul(0.7));
}).setLayout({
    name: 'wavesSky',
    type: 'vec3',
    inputs: [
        { name: 'dir', type: 'vec3' }, { name: 'sun', type: 'vec3' },
        { name: 'sharp', type: 'float' }, { name: 'warm', type: 'float' },
    ],
});

// ── The wave's shape ────────────────────────────────────────────────────────────────────────

/** How far round the lip reaches at a distance ahead; `crest` is where it starts to feather. */
export const lipAngleAt = /* @__PURE__ */ Fn(([d, crest]) => {
    const t = clamp(crest.sub(d).div(WAVE.throwLength), 0.0, 1.0);
    return float(WAVE.lipCrest).add(pow(t, WAVE.lipPower).mul(WAVE.lipClosed - WAVE.lipCrest));
}).setLayout({
    name: 'wavesLipAngle',
    type: 'float',
    inputs: [{ name: 'd', type: 'float' }, { name: 'crest', type: 'float' }],
});

/**
 * The wave on the GPU, mirroring waves-core.js. `u` holds the uniforms that move it:
 *   open    0..1, how far the lip's touchdown has come back toward the eye
 *   time    seconds
 *   bulge   vec4(z, height, width, breath): a set wave running through the tube, and how far
 *           the whole tube has swelled
 * Returns inline builders (they read the uniforms, so they are not laid out).
 */
export function createWaveShape(u) {
    const landing = float(WAVE.landAhead).sub(u.open.mul(WAVE.openReach));
    const crest = landing.add(WAVE.throwLength);

    const lipAngle = (d) => lipAngleAt(d, crest);

    const floorX = (r) => {
        const t = clamp(r.negate(), 0.0, 1.0);
        return exp(t.mul(WAVE.floorCurve)).sub(1.0).mul(-WAVE.floorFar / (Math.exp(WAVE.floorCurve) - 1));
    };

    /** The living surface: a slow swell in the glass, plus a set wave passing through. */
    const wobble = (phi, z) => {
        const t = u.time;
        const slow = sin(phi.mul(2.1).add(z.mul(0.52)).sub(t.mul(0.62))).mul(0.015)
            .add(sin(phi.mul(3.3).sub(z.mul(0.83)).add(t.mul(0.94)).add(1.7)).mul(0.01))
            .add(sin(phi.mul(5.9).add(z.mul(1.9)).sub(t.mul(1.37))).mul(0.005));
        const dz = z.sub(u.bulge.x).div(max(u.bulge.z, 0.2));
        const set = exp(dz.mul(dz).negate()).mul(u.bulge.y);
        return slow.add(set).add(u.bulge.w);
    };

    /**
     * Position of row r (−1..1) at z, and the surface coordinates that go with it:
     * returns { position, u, lip } — `u` metres from the foot of the face, `lip` the lip's angle.
     */
    const point = (r, z) => {
        const d = z.negate();
        const lip = lipAngle(d);
        const rr = max(r, 0.0);
        const phi = rr.mul(lip);
        // The swell of the glass dies out at the foot of the face, so the wave meets the trough
        // without a crease (a crease there is a line down the mirror).
        const w = wobble(phi, z).mul(smoothstep(0.0, 0.45, phi));
        const swell = smoothstep(crest.sub(2.0), crest.sub(2.0).add(WAVE.shoulderBlend), d);
        const scale = float(1.0).sub(smoothstep(crest, crest.add(WAVE.taperLength), d).mul(1 - WAVE.taperFloor));
        const ahead = max(d.sub(6.0), 0.0);
        const xc = min(ahead.mul(ahead).mul(WAVE.bowl), WAVE.bowlMax).negate();
        // The tube: an arc of an ellipse, breathing with the wobble.
        const grow = w.add(1.0);
        const xt = sin(phi).mul(grow).mul(WAVE.a);
        const yt = float(WAVE.b).sub(cos(phi).mul(grow).mul(WAVE.b));
        // The unbroken shoulder: the plain hump of a swell.
        const xs = rr.mul(WAVE.swellWidth);
        const ys = float(1.0).sub(cos(rr.mul(Math.PI))).mul(WAVE.swellHeight * 0.5).mul(grow);
        const ax = mix(xt, xs, swell).mul(scale);
        const ay = mix(yt, ys, swell).mul(scale);
        // The trough: flat, joined to the foot of the face, with a long low swell far out.
        const fx = floorX(r);
        const reach = fx.mul(0.08);
        // Flat, and level, where it meets the face; the swell grows in with distance from it.
        const far = float(1.0).sub(exp(reach.mul(reach).negate()));
        const roll = sin(fx.mul(0.21).add(z.mul(0.035)).add(u.time.mul(0.35))).mul(0.22)
            .add(sin(fx.mul(0.083).sub(z.mul(0.021)).add(u.time.mul(0.21)).add(2.0)).mul(0.3));
        const fy = roll.mul(far);
        const onFloor = r.lessThan(0.0);
        const position = vec3(xc.add(select(onFloor, fx, ax)), select(onFloor, fy, ay), z);
        return { position, u: select(onFloor, fx, phi.mul(WAVE.rho)), lip };
    };

    return {
        landing, crest, lipAngle, floorX, wobble, point,
    };
}

// ── Optics ──────────────────────────────────────────────────────────────────────────────────

/** Metres of water behind the surface, `e` metres along it from the lip's edge. */
export const sheetThickness = (e) => {
    const x = max(e, 0.0);
    return x.mul(0.2).add(x.mul(x).mul(0.055)).add(0.05);
};

/** What is left of white light after `tau` metres of this water. */
export const transmit = (tau) => exp(vec3(...ABSORB).mul(tau.negate()));

/** 0 where there is wave behind the surface (the face), 1 where there is sky (roof and lip). */
export const skyBehind = (phi) => smoothstep(1.7, 3.25, phi);

/**
 * One ray inside the tube, closed form. From P along R it returns
 *   x  the angle round the section where it meets the wall
 *   y  the distance ahead of that point
 *   z  what it met: 0 the wall, 1 the opening (sky), 2 the trough
 *   w  the lip's angle at that distance
 * A point outside the tube (the sea in front of the curtain) sees the curtain's outer side.
 */
export const tubeTrace = /* @__PURE__ */ Fn(([P, R, crest]) => {
    const px = P.x.div(WAVE.a);
    const py = P.y.sub(WAVE.b).div(WAVE.b);
    const rx = R.x.div(WAVE.a);
    const ry = R.y.div(WAVE.b);
    const A = max(rx.mul(rx).add(ry.mul(ry)), 1e-6);
    const B = px.mul(rx).add(py.mul(ry)).mul(2.0);
    const C = px.mul(px).add(py.mul(py)).sub(1.0);
    const disc = B.mul(B).sub(A.mul(C).mul(4.0));
    const root = sqrt(max(disc, 0.0));
    const tFar = root.sub(B).div(A.mul(2.0));
    const tNear = root.negate().sub(B).div(A.mul(2.0));

    // Every value a select() below chooses between is a statement of its own first: the GLSL
    // builder cannot place a function call that first appears inside a nested conditional.
    const hitNear = P.add(R.mul(tNear)).toVar();
    const phiNear0 = atan(hitNear.x.div(WAVE.a), float(WAVE.b).sub(hitNear.y).div(WAVE.b)).toVar();
    const phiNear = phiNear0.add(phiNear0.lessThan(0.0).select(TAU, 0.0)).toVar();
    const lipNear = lipAngleAt(hitNear.z.negate(), crest).toVar();
    const fromOutside = C.greaterThan(0.03).and(tNear.greaterThan(0.01)).and(disc.greaterThan(0.0));
    const curtain = fromOutside.and(phiNear.lessThan(lipNear)).toVar();

    const hitFar = P.add(R.mul(tFar)).toVar();
    const phiFar0 = atan(hitFar.x.div(WAVE.a), float(WAVE.b).sub(hitFar.y).div(WAVE.b)).toVar();
    const phiFar = phiFar0.add(phiFar0.lessThan(0.0).select(TAU, 0.0)).toVar();
    const lipFar = lipAngleAt(hitFar.z.negate(), crest).toVar();

    const missed = disc.lessThanEqual(0.0).or(tFar.lessThanEqual(0.0));
    const tWall = select(curtain, tNear, tFar).toVar();
    const phi = select(curtain, phiNear, phiFar).toVar();
    const lip = select(curtain, lipNear, lipFar).toVar();
    const dist = select(curtain, hitNear.z, hitFar.z).negate().toVar();
    const open = missed.or(curtain.not().and(phiFar.greaterThan(lipFar))).toVar();

    const down = R.y.lessThan(-1e-4);
    const tFloor = select(down, P.y.max(0.0).div(R.y.min(-1e-4).negate()), float(1e6)).toVar();
    // The trough stops a ray that would otherwise meet the wall, or one that left by the opening.
    const floorFirst = down.and(tFloor.lessThan(tWall).or(open));
    const kind = select(floorFirst, float(2.0), select(open, float(1.0), float(0.0)));
    return vec4(phi, dist, kind, lip);
}).setLayout({
    name: 'wavesTubeTrace',
    type: 'vec4',
    inputs: [{ name: 'P', type: 'vec3' }, { name: 'R', type: 'vec3' }, { name: 'crest', type: 'float' }],
});

/**
 * What a ray that left the wall sees: `hit` is tubeTrace's answer for the ray along `dir`.
 * The wall is given its broad colour only (no ripples): the sky through it where it is thin,
 * the water's own green where it is thick.
 */
export const tubeEnvironment = /* @__PURE__ */ Fn(([hit, dir, sun, sharp, warm]) => {
    const phi = hit.x;
    const e = hit.w.sub(phi).mul(WAVE.rho);
    const thin = skyBehind(phi);
    const tau = mix(float(DEEP), sheetThickness(e), thin);
    const through = transmit(tau);
    const sky = wavesSky(dir, sun, sharp, warm).toVar();
    const soft = wavesSky(dir, sun, float(0.0), warm).toVar();
    // Higher on the wall there is less water overhead: more light in it.
    const lift = smoothstep(0.3, 2.6, phi).mul(0.75).add(0.25);
    const own = vec3(...SCATTER).mul(lift).mul(vec3(0.62, 0.6, 0.6));
    const wall = through.mul(soft).mul(thin).add(vec3(1.0).sub(through).mul(own)).toVar();
    const mirrored = wavesSky(normalize(vec3(dir.x, abs(dir.y).add(0.04), dir.z)), sun, float(0.0), warm);
    const trough = mirrored.mul(0.3).add(vec3(0.004, 0.035, 0.04)).toVar();
    // The lip's edge is torn: its mirror image ends softly, not on a line.
    const past = smoothstep(-0.2, 0.12, phi.sub(hit.w));
    const seen = mix(wall, sky, max(past, hit.z.greaterThan(0.5).select(1.0, 0.0)));
    return mix(seen, trough, hit.z.greaterThan(1.5).select(1.0, 0.0));
}).setLayout({
    name: 'wavesTubeEnvironment',
    type: 'vec3',
    inputs: [
        { name: 'hit', type: 'vec4' }, { name: 'dir', type: 'vec3' }, { name: 'sun', type: 'vec3' },
        { name: 'sharp', type: 'float' }, { name: 'warm', type: 'float' },
    ],
});

/** The flow's direction in surface coordinates (u, z) and the one across it. */
export const FLOW_ALONG = Object.freeze([FLOW.u / FLOW_SPEED, FLOW.z / FLOW_SPEED]);
export const FLOW_ACROSS = Object.freeze([-FLOW.z / FLOW_SPEED, FLOW.u / FLOW_SPEED]);

/** Surface coordinates carried back along the flow: what a texture is read at. */
export const flowCoords = (surface, time) => {
    const q = surface.sub(vec2(FLOW.u, FLOW.z).mul(time));
    return vec2(dot(q, vec2(...FLOW_ACROSS)), dot(q, vec2(...FLOW_ALONG)));
};
