/**
 * The black hole itself: one material that traces every view ray through Schwarzschild
 * spacetime. Nothing here is painted on — the far side of the disk arching over the shadow,
 * its second image tucked underneath, the Einstein ring of smeared stars and the shadow's
 * exact edge all fall out of bending the ray.
 *
 * Lengths inside the shader are in Schwarzschild radii, in the disk's own frame (+Y is the
 * disk normal). A photon's path in that geometry obeys
 *     x'' = -(3/2) h^2 x / |x|^5,   h = |x × x'|
 * which is exact for null geodesics, so a plain symplectic step integrates it. Rays that
 * never come near the disk skip the march and take the closed-form bend of the same force
 * law along a straight line; the two agree where they meet, so there is no seam.
 */
import * as THREE from 'three/webgpu';
import {
    Break, Fn, If, Loop, abs, acos, atan, cameraPosition, clamp, cos, cross, dot, exp, float, floor, fract,
    hash, length, log2, max, min, mix, normalize, positionWorld, pow, select, sign, sin, smoothstep, sqrt,
    texture, uniform, uniformArray, vec2, vec3, vec4,
} from 'three/tsl';
import { DISK_COS_TILT, DISK_SIN_TILT } from './black-hole-disk-basis.js';
import { LATTICE_SIZE, LATTICE_SLICE } from './black-hole-noise.js';

const TAU = Math.PI * 2;

export const HOLE = Object.freeze({
    /** World units per Schwarzschild radius: the shadow keeps the old scene's 120-unit radius. */
    RS_WORLD: 46.2,
    /** 3√3/2 — the impact parameter of the shadow's edge. */
    CRITICAL: 2.598076,
    /** Innermost stable orbit: where the disk proper ends. */
    DISK_INNER: 3.0,
    DISK_OUTER: 10.5,
    /** Inside the stable orbit the gas only falls; it glows faintly down to here. */
    PLUNGE: 1.75,
    /** Rays that miss this sphere are bent in closed form instead of marched. */
    BOUND: 11.6,
    /** A marched ray is released to the closed form once it is outbound past this. */
    ESCAPE: 12.4,
});

/** Slots the disk shader evaluates for matter the player has fed it. */
export const HOTSPOT_SLOTS = 6;
/** Pressure waves crossing the disk at once. */
export const WAVE_SLOTS = 2;

/** The disk's pattern speed, as a fraction of the inner edge's orbital rate. */
const RIGID_RATE = 0.42;
const TEX_ROWS = 128;

/**
 * The corona: thin, hot gas puffed up round the disk, a Gaussian sheet whose scale height
 * flares with radius. It is what gives the disk a body — a glow that stands above and below
 * the sheet, softens its filaments and, bent with everything else, wraps the shadow in a
 * lensed halo. Lengths in Schwarzschild radii.
 */
const CORONA = Object.freeze({
    /** Scale height at the hole and its growth per unit radius. */
    BASE: 0.16,
    FLARE: 0.085,
    /** Radial fall-off of its brightness, per unit radius beyond the inner edge. */
    FALL: 0.42,
    /** Extinction per unit column: enough to veil, never enough to hide the far arch. */
    ABSORB: 0.08,
    GAIN: 0.055,
});
/** The baked galaxy is authored dim; this is the lift that makes the band read across a frame. */
const SKY_LIFT = 1.55;
/** √π / 2 — the column of a unit Gaussian is √π, half of it is the erf's normalisation. */
const HALF_ROOT_PI = 0.8862269;

/** erf, after Winitzki: odd, smooth and within about 2e-4 of the real thing everywhere. */
const erf = (x) => {
    const x2 = x.mul(x);
    const inner = x2.mul(x2.mul(0.147).add(4 / Math.PI)).div(x2.mul(0.147).add(1));
    return sqrt(float(1).sub(exp(inner.negate()))).mul(sign(x));
};

/** Half of a straight-line pass's bend accumulated from closest approach out to `s`. */
const bendTo = (b, s) => {
    const b2 = b.mul(b);
    const s2 = s.mul(s);
    return s.mul(b2.mul(3).add(s2.mul(2))).div(b.mul(2).mul(pow(b2.add(s2), 1.5)));
};

/** Turn `dir` toward the hole by `angle`; `away` is the unit vector from hole to closest approach. */
const bendToward = (dir, away, angle) => normalize(dir.mul(cos(angle)).sub(away.mul(sin(angle))));

/** Blackbody-like ramp over a normalised temperature: ember, flame, gold, white, blue-white. */
const blackbody = (heat) => {
    const ember = vec3(0.42, 0.03, 0.006);
    const flame = vec3(1.0, 0.27, 0.035);
    const gold = vec3(1.0, 0.6, 0.2);
    const white = vec3(1.0, 0.9, 0.74);
    const blue = vec3(0.68, 0.82, 1.0);
    const a = mix(ember, flame, smoothstep(0.2, 0.5, heat));
    const b = mix(a, gold, smoothstep(0.46, 0.82, heat));
    const c = mix(b, white, smoothstep(0.8, 1.2, heat));
    return mix(c, blue, smoothstep(1.25, 1.9, heat));
};

export function createLensUniforms() {
    // Rows are the disk's own axes in world space: U, the normal N, and -V.
    const tilt = new THREE.Matrix3().set(
        1,
        0,
        0,
        0,
        DISK_SIN_TILT,
        DISK_COS_TILT,
        0,
        -DISK_COS_TILT,
        DISK_SIN_TILT,
    );
    return {
        holePosition: uniform(new THREE.Vector3()),
        rs: uniform(HOLE.RS_WORLD),
        /** World → disk frame (+Y is the disk normal). */
        worldToDisk: uniform(tilt),
        /** Disk frame → the galaxy texture's frame. */
        diskToSky: uniform(new THREE.Matrix3()),
        /** Radians one pixel subtends: sizes stars and picks the gas texture's mip. */
        pixelAngle: uniform(0.001),
        /** Turns the pattern has made (rigid part) and the two shear phases riding on it. */
        diskRigid: uniform(0),
        flowA: uniform(0),
        flowB: uniform(0),
        flowMix: uniform(0),
        diskGain: uniform(1),
        diskHeat: uniform(1),
        doppler: uniform(0.8),
        ringGain: uniform(1),
        skyGain: uniform(1),
        starGain: uniform(1),
        /** The thick glowing gas round the disk, and the emission nebulae of the far sky. */
        coronaGain: uniform(1),
        nebulaGain: uniform(1),
        /** x: radius, y: strength, z: width — pressure waves a line clear sends out through the disk. */
        wave: uniformArray(Array.from({ length: WAVE_SLOTS }, () => new THREE.Vector4(0, 0, 1, 0)), 'vec4'),
        /** xyz: tint of fed matter, w: unused. One per hot-spot slot. */
        hotspotTint: uniformArray(
            Array.from({ length: HOTSPOT_SLOTS }, () => new THREE.Vector4(1, 1, 1, 0)),
            'vec4',
        ),
        /** x: azimuth (radians), y: radius, z: arc half-width (radians), w: strength. */
        hotspot: uniformArray(
            Array.from({ length: HOTSPOT_SLOTS }, () => new THREE.Vector4(0, 5, 0.3, 0)),
            'vec4',
        ),
    };
}

/**
 * @param {object} options
 * @param {object} options.uniforms from createLensUniforms()
 * @param {THREE.Texture} options.diskTexture accretion gas (bakeDiskTexture)
 * @param {THREE.Texture} options.skyTexture galaxy panorama (bakeSkyTexture)
 * @param {THREE.Texture} options.latticeTexture white-noise lattice for 3D sky noise (bakeLattice)
 * @param {number} options.steps march budget per ray
 * @param {number} options.stepScale step length as a fraction of the distance to the hole
 * @param {number} options.starLayers 1 or 2 layers of resolved stars
 * @param {boolean} options.detail read a second, finer octave of the gas texture
 * @param {boolean} options.shadowAlpha write the bare shadow into alpha for a post chain to read
 */
export function createLensMaterial({
    uniforms: u, diskTexture, skyTexture, latticeTexture, steps = 64, stepScale = 0.14, starLayers = 2,
    detail = true, shadowAlpha = true, corona = true,
}) {
    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide,
        depthTest: false,
        depthWrite: false,
        fog: false,
    });
    material.name = 'Black Hole — lens';

    /** One layer of resolved stars: a jittered star per lattice cell on the unit sphere. */
    const starLayer = (direction, scale, density, seedOffset) => {
        const p = direction.mul(scale);
        const cell = floor(p);
        const local = p.sub(cell).sub(0.5);
        // Lattice coordinates stay within ±62, so the id — eight hash seeds to a cell — is an
        // exact float below 2^24.
        const id = cell.x.add(64).add(cell.y.add(64).mul(128)).add(cell.z.add(64).mul(16384))
            .mul(8)
            .add(seedOffset);
        const jitter = vec3(hash(id), hash(id.add(1)), hash(id.add(2))).sub(0.5).mul(0.7);
        const roll = hash(id.add(3));
        const offset = local.sub(jitter);
        // Never thinner than a pixel, or a slow orbit makes the field shimmer.
        const sigma = max(u.pixelAngle.mul(scale).mul(0.95), 0.012);
        const core = exp(dot(offset, offset).negate().div(sigma.mul(sigma)));
        // A steep magnitude curve: a few bright stars, a great many faint ones.
        const magnitude = pow(roll, 7).mul(5.5).add(pow(roll, 2).mul(0.42)).add(0.05);
        const present = smoothstep(0.0, 0.25, density.sub(hash(id.add(4)).mul(0.55)));
        const temperature = hash(id.add(5));
        const tint = mix(
            mix(vec3(1.0, 0.72, 0.5), vec3(1.0, 0.92, 0.8), smoothstep(0.0, 0.55, temperature)),
            vec3(0.7, 0.82, 1.0),
            smoothstep(0.62, 1.0, temperature),
        );
        return tint.mul(core.mul(magnitude).mul(present));
    };

    /** 3D value noise, two independent fields in [0, 1], in one fetch; one unit of `at` is one lattice cell. */
    const noise3 = (at) => {
        const cell = floor(at);
        const f0 = fract(at);
        const f = f0.mul(f0).mul(float(3).sub(f0.mul(2)));
        const st = cell.xy.add(vec2(LATTICE_SLICE[0], LATTICE_SLICE[1]).mul(cell.z)).add(f.xy).add(0.5)
            .div(LATTICE_SIZE);
        const t = texture(latticeTexture, st).level(0);
        return mix(t.xz, t.yw, f.z);
    };

    /** @param calm 0 where the lens stretches the sky hardest, 1 where it barely bends it */
    const sky = (direction, calm = float(1)) => {
        const d = u.diskToSky.mul(direction).toVar();
        const longitude = atan(d.z, d.x);
        const polar = acos(clamp(d.y, -1, 1));
        const panorama = vec2(longitude.div(TAU).add(0.5), polar.div(Math.PI)).toVar();
        const galaxy = texture(skyTexture, panorama).level(0).toVar();
        // Grain and clouds are read in 3D along the ray's own direction: no poles, no seam, and
        // nothing that fans out into rings where the lens wraps the sky round the shadow (the
        // gas tile used to be read here, and its long lanes drew concentric ribs).
        const broad = noise3(d.mul(2.3).add(vec3(3.1, -1.7, 5.3))).toVar();
        const middle = noise3(d.mul(5.1).add(vec3(-4.2, 2.9, 0.7))).toVar();
        const fine = noise3(d.mul(11.3).add(vec3(1.3, 7.7, -2.1))).toVar();
        const grain = noise3(d.mul(27).add(vec3(-6.1, 0.4, 3.3))).toVar();
        // Three octaves: mean 0.48, sd 0.11 (sampleLattice over the whole sphere).
        const cloudA = broad.x.mul(0.55).add(middle.x.mul(0.3)).add(fine.x.mul(0.15)).toVar();
        const cloudB = broad.y.mul(0.55).add(middle.y.mul(0.3)).add(fine.y.mul(0.15)).toVar();
        // Dust: dark threads where a mid-scale field crosses its middle, cubed so they stay thin,
        // and only where there is cloud for them to cut.
        const thread = float(1).sub(abs(fine.y.mul(0.65).add(grain.y.mul(0.35)).mul(2).sub(1)));
        const dust = pow(thread, 3).mul(smoothstep(0.4, 0.62, cloudA)).toVar();
        // The panorama is coarse and the lens magnifies it: mottle its glow so the star clouds
        // keep their grain right up to the Einstein ring.
        const speck = fine.x.mul(0.6).add(grain.x.mul(0.4));
        const mottle = mix(
            float(0.85),
            speck.mul(speck).mul(2.6).add(0.3).mul(dust.mul(-0.55).add(1)),
            calm.mul(0.75).add(0.25),
        );
        // Emission nebulae — hydrogen rose and oxygen teal, a bright heart on a wide ramp —
        // gathering toward the band but strewn over the whole sky, so no side of the frame is
        // an empty black.
        const rose = pow(smoothstep(0.5, 0.72, cloudA), 2);
        const teal = pow(smoothstep(0.53, 0.74, cloudB), 2);
        const gather = mix(float(0.4), float(1), smoothstep(0.3, 0.9, galaxy.a));
        const nebula = vec3(1.0, 0.16, 0.3).mul(rose).add(vec3(0.1, 0.5, 0.62).mul(teal))
            .mul(gather)
            .mul(dust.mul(-0.8).add(1))
            .mul(calm.mul(0.6).add(0.4))
            .mul(0.035);
        // Deep space is not one flat black: a faint indigo that swells and fades with the clouds.
        const depth = vec3(0.0025, 0.003, 0.008).mul(cloudA.mul(1.2).add(0.4));
        const stars = starLayer(d, 57, galaxy.a, 0).toVar();
        if (starLayers > 1) stars.addAssign(starLayer(d.zxy, 23, galaxy.a.mul(0.8).add(0.2), 6).mul(1.6));
        const glow = galaxy.rgb.mul(mottle).mul(SKY_LIFT).add(depth).add(nebula.mul(u.nebulaGain));
        return glow.mul(u.skyGain).add(stars.mul(dust.mul(-0.6).add(1)).mul(u.starGain));
    };

    /** Emission and opacity of the disk where a ray crosses its plane. */
    const shadeDisk = (p, radius, towardCamera, order, travelled) => {
        const turn = atan(p.z, p.x).div(TAU);
        const orbit = pow(float(HOLE.DISK_INNER).div(radius), 1.5);
        const shear = orbit.sub(RIGID_RATE);
        const v = radius.sub(HOLE.DISK_INNER).div(HOLE.DISK_OUTER - HOLE.DISK_INNER);
        const base = turn.sub(u.diskRigid);
        const uvA = vec2(base.sub(shear.mul(u.flowA)), v);
        const uvB = vec2(base.sub(shear.mul(u.flowB)).add(0.37), v.add(0.21));
        // Texels a pixel covers along the disk's radius; grazing rays cover many.
        const grazing = max(abs(towardCamera.y), 0.045);
        const texels = u.pixelAngle.mul(travelled).mul(TEX_ROWS / (HOLE.DISK_OUTER - HOLE.DISK_INNER)).div(grazing);
        const lod = max(log2(max(texels, 1)).sub(0.6).add(order.mul(1.2)), 0).toVar();
        const gas = mix(texture(diskTexture, uvA).level(lod), texture(diskTexture, uvB).level(lod), u.flowMix).toVar();
        const fine = gas.toVar();
        if (detail) {
            const scale = vec2(4, 3);
            fine.assign(mix(
                texture(diskTexture, uvA.mul(scale)).level(lod.add(1.6)),
                texture(diskTexture, uvB.mul(scale)).level(lod.add(1.6)),
                u.flowMix,
            ));
        }

        const lanes = gas.r;
        const streaks = mix(gas.g, fine.g, 0.35);
        const gaps = smoothstep(0.2, 0.62, gas.a.mul(0.7).add(fine.a.mul(0.3)));
        const clumps = pow(gas.b, 4).mul(0.55).add(pow(fine.b, 5).mul(0.3));
        // Filaments: the octaves pushed through a knee so bright threads stand on darker gaps.
        // The broad lanes carry most of it and the ramp is wide: with the fine streaks in charge
        // and a narrow knee the gas read as brushed hair rather than glowing plasma.
        const weave = lanes.mul(0.74).add(streaks.mul(0.26));
        const density = pow(smoothstep(0.2, 0.84, weave), 1.35)
            .mul(gaps.mul(0.72).add(0.28))
            .add(clumps)
            .add(0.04)
            .toVar();

        const innerEdge = smoothstep(HOLE.DISK_INNER * 0.975, HOLE.DISK_INNER * 1.12, radius);
        const plunge = smoothstep(HOLE.PLUNGE, HOLE.DISK_INNER, radius).mul(innerEdge.oneMinus()).mul(0.3);
        // The rim frays: lanes reach further out than the gaps between them.
        const rim = radius.div(HOLE.DISK_OUTER).add(lanes.sub(0.5).mul(0.3)).add(streaks.sub(0.5).mul(0.08));
        const envelope = innerEdge.add(plunge).mul(pow(smoothstep(0.52, 1.0, rim).oneMinus(), 1.4)).toVar();

        // Matter the player fed in: arcs of hot gas riding their orbit and shearing out.
        const fed = vec3(0).toVar();
        const fedGain = float(0).toVar();
        Loop(HOTSPOT_SLOTS, ({ i }) => {
            const spot = u.hotspot.element(i);
            If(spot.w.greaterThan(0.002), () => {
                const away = turn.mul(TAU).sub(spot.x);
                // Wrapped angular distance, leaning with the shear so the arc trails.
                const lean = radius.sub(spot.y).mul(0.55);
                const arc = atan(sin(away.add(lean)), cos(away.add(lean)));
                const along = exp(arc.mul(arc).negate().div(spot.z.mul(spot.z)));
                // The arc lengthens along its orbit but stays a thin thread across it.
                const across = radius.sub(spot.y).div(spot.z.mul(0.16).add(0.42));
                const glow = along.mul(exp(across.mul(across).negate())).mul(spot.w);
                fed.addAssign(u.hotspotTint.element(i).xyz.mul(glow));
                fedGain.addAssign(glow);
            });
        });

        // Pressure waves from a line clear: bright fronts running out through the gas.
        const shock = float(0).toVar();
        for (let slot = 0; slot < WAVE_SLOTS; slot += 1) {
            const wave = u.wave.element(slot);
            const front = radius.sub(wave.x).div(wave.z.add(0.001));
            shock.addAssign(exp(front.mul(front).negate()).mul(wave.y));
        }

        // Relativistic beaming: gas on a circular orbit, seen along the ray's local direction.
        const speed = sqrt(float(0.5).div(max(radius.sub(1), 0.4)));
        const tangent = vec3(p.z.negate(), 0, p.x).div(max(radius, 0.001));
        const shift = sqrt(speed.mul(speed).oneMinus())
            .div(speed.mul(dot(tangent, towardCamera)).oneMinus())
            .mul(sqrt(max(float(1).sub(float(1).div(radius)), 0.02)));
        const beaming = mix(float(1), shift.div(0.84), u.doppler);

        const warmth = pow(float(HOLE.DISK_INNER).div(radius), 0.9);
        const heat = warmth.mul(pow(beaming, 0.9)).mul(u.diskHeat)
            .mul(density.mul(0.42).add(0.74))
            .add(shock.mul(0.22))
            .add(fedGain.mul(0.2));
        const power = pow(warmth, 2.4).mul(pow(beaming, 1.7)).mul(density.mul(density.add(0.35)))
            .mul(shock.mul(0.95).add(1));
        const raw = blackbody(heat).mul(power).mul(u.diskGain).mul(2.7);
        // A shoulder on the brightest channel: an excited disk runs hotter and bluer, but its
        // filaments stay filaments instead of clipping into one white plate.
        const peak = max(max(raw.r, raw.g), raw.b);
        const shoulder = float(1.25).div(peak.div(2.6).add(1));
        // Fed matter keeps the colour of the piece it was: it re-tints the gas it joins and
        // glows on top, rather than adding itself to white.
        const fedTint = fed.div(max(fedGain, 0.001));
        const fedShare = clamp(fedGain.mul(0.9), 0, 0.88);
        const emission = mix(
            raw.mul(shoulder),
            fedTint.mul(peak.mul(shoulder).mul(1.1).add(fedGain.mul(density.mul(0.9).add(0.5)).mul(1.5))),
            fedShare,
        );
        const alpha = float(1).sub(exp(density.add(fedGain.mul(0.4)).mul(envelope).mul(-3.4).div(grazing.add(0.1))));
        return vec4(emission.mul(envelope), alpha);
    };

    material.fragmentNode = Fn(() => {
        const origin = u.worldToDisk.mul(cameraPosition.sub(u.holePosition).div(u.rs)).toVar();
        const direction = u.worldToDisk.mul(normalize(positionWorld.sub(cameraPosition))).toVar();
        // Along the straight line: s = 0 at closest approach, the camera sits at `along`.
        const along = dot(origin, direction).toVar();
        const closest = origin.sub(direction.mul(along)).toVar();
        const impact = max(length(closest), 1e-4).toVar();
        const away = closest.div(impact).toVar();
        const cameraDistance = length(origin).toVar();

        const colour = vec3(0).toVar();
        const through = float(1).toVar();
        // What is left of the light after the gas on our side of the hole alone.
        const front = float(1).toVar();
        const asymptote = direction.toVar();
        // The corona's light along the ray, and that light weighted by its temperature.
        const haze = float(0).toVar();
        const hazeHeat = float(0).toVar();

        If(impact.lessThan(HOLE.BOUND).and(along.lessThan(0)), () => {
            // Jump straight to the bounding sphere, taking the bend of the skipped stretch.
            const entry = sqrt(float(HOLE.BOUND * HOLE.BOUND).sub(impact.mul(impact))).negate().toVar();
            const start = max(along, entry);
            const position = origin.add(direction.mul(start.sub(along))).toVar();
            // The path's shape depends only on where a ray is and where it points, so the
            // speed is left at one and h follows from it.
            const velocity = bendToward(direction, away, bendTo(impact, start).sub(bendTo(impact, along))).toVar();
            const swept = cross(position, velocity);
            const h2 = dot(swept, swept).toVar();
            const order = float(0).toVar();
            const escaped = float(0).toVar();

            Loop(steps, () => {
                const r2 = dot(position, position).toVar();
                const r = sqrt(r2).toVar();
                const outward = dot(position, velocity);
                If(r.greaterThan(HOLE.ESCAPE).and(outward.greaterThan(0)), () => {
                    escaped.assign(1);
                    Break();
                });
                If(r.lessThan(1.02), () => {
                    through.assign(0);
                    Break();
                });
                const dt = r.mul(stepScale).toVar();
                velocity.addAssign(position.mul(h2.mul(-1.5).div(r2.mul(r2).mul(r))).mul(dt));
                const next = position.add(velocity.mul(dt)).toVar();
                if (corona) {
                    // The corona's column along this step, exact in height: the step is a straight
                    // chord, and a Gaussian sheet integrates in closed form along a line. Sampled
                    // instead, a step of half a radius would draw the sheet as contour bands.
                    const mid = position.add(next).mul(0.5).toVar();
                    const ring = length(mid.xz).toVar();
                    const height = ring.mul(CORONA.FLARE).add(CORONA.BASE).toVar();
                    const low = position.y.div(height);
                    const high = next.y.div(height);
                    const rise = high.sub(low).toVar();
                    const steep = abs(rise).greaterThan(0.02);
                    const level = mid.y.div(height);
                    const sheet = select(
                        steep,
                        erf(high).sub(erf(low)).div(select(steep, rise, float(1))).mul(HALF_ROOT_PI),
                        exp(level.mul(level).negate()),
                    );
                    const reach = smoothstep(HOLE.PLUNGE * 0.9, HOLE.DISK_INNER * 1.15, ring)
                        .mul(exp(ring.sub(HOLE.DISK_INNER).mul(-CORONA.FALL)))
                        // Near the horizon the gas only falls, and thins as it goes.
                        .mul(smoothstep(1.6, HOLE.DISK_INNER * 1.05, length(mid)))
                        // Gone well inside the sphere the march starts from, so it leaves no seam.
                        .mul(smoothstep(HOLE.BOUND - 0.4, HOLE.DISK_OUTER * 0.72, length(mid)));
                    const column = sheet.mul(length(next.sub(position))).mul(reach).toVar();
                    // Gas on its orbit is beamed like the disk's, a little more gently. The speed
                    // is held under 0.9 c even where the step passes over the hole's axis.
                    const speed = sqrt(float(0.5).div(max(ring.sub(1), 0.62)));
                    const tangent = vec3(mid.z.negate(), 0, mid.x).div(max(ring, 0.05));
                    const shift = sqrt(speed.mul(speed).oneMinus())
                        .div(speed.mul(dot(tangent, normalize(velocity).negate())).oneMinus())
                        .mul(sqrt(max(float(1).sub(float(1).div(max(length(mid), 1.05))), 0.02)));
                    const beaming = min(mix(float(1), shift.div(0.84), u.doppler), 2.4).toVar();
                    const light = column.mul(beaming).mul(through).toVar();
                    haze.addAssign(light);
                    hazeHeat.addAssign(light.mul(pow(float(HOLE.DISK_INNER).div(max(ring, 1.2)), 0.9))
                        .mul(pow(beaming, 0.6)));
                    through.mulAssign(exp(column.mul(-CORONA.ABSORB)));
                }
                If(position.y.mul(next.y).lessThan(0), () => {
                    const hit = mix(position, next, position.y.div(position.y.sub(next.y))).toVar();
                    const radius = length(hit.xz).toVar();
                    If(radius.greaterThan(HOLE.PLUNGE).and(radius.lessThan(HOLE.DISK_OUTER * 1.08)), () => {
                        const gas = shadeDisk(
                            hit,
                            radius,
                            normalize(velocity).negate(),
                            order,
                            cameraDistance,
                        ).toVar();
                        colour.addAssign(gas.rgb.mul(through));
                        through.mulAssign(gas.a.oneMinus());
                        If(outward.lessThan(0), () => {
                            front.mulAssign(gas.a.oneMinus());
                        });
                    });
                    order.addAssign(1);
                });
                position.assign(next);
            });

            // Out past the disk the rest of the bend is closed-form again.
            const heading2 = normalize(velocity).toVar();
            const along2 = dot(position, heading2);
            const closest2 = position.sub(heading2.mul(along2)).toVar();
            const impact2 = max(length(closest2), 1e-3);
            const marched = bendToward(
                heading2,
                closest2.div(impact2),
                float(1).div(impact2).sub(bendTo(impact2, along2)),
            );
            // The closed form is first-order and the march is exact, so they part company by
            // a fraction of a degree at the bound. Ease one into the other across a band.
            const handover = smoothstep(HOLE.BOUND - 2.4, HOLE.BOUND - 0.05, impact);
            asymptote.assign(normalize(mix(
                marched,
                bendToward(direction, away, float(1).div(impact).sub(bendTo(impact, along))),
                handover,
            )));
            // A ray still circling when the budget ran out is on the photon ring, not the sky.
            through.mulAssign(escaped);
            // A ray the hole swallows keeps little of the corona it crossed on the way in: the gas
            // glows round the shadow and sharpens its edge instead of filling it with a haze.
            haze.mulAssign(mix(float(0.04), float(1), escaped));
        }).Else(() => {
            asymptote.assign(bendToward(
                direction,
                away,
                float(1).div(impact).sub(bendTo(impact, along)),
            ));
        });

        if (corona) {
            // One colour for the whole column, from its light-weighted temperature: cooler than
            // the sheet, so the body of the disk glows ember to gold round a white-hot heart.
            // The floor keeps the outer haze flame-orange: ember red over the blue sky reads magenta.
            // Capped short of the blue end: a blue-white veil is the one thing the haze must not be.
            const warmth = min(hazeHeat.div(max(haze, 1e-4)).mul(0.72).add(0.16), 1.1).mul(u.diskHeat);
            colour.addAssign(blackbody(warmth).mul(haze).mul(u.diskGain).mul(u.coronaGain)
                .mul(CORONA.GAIN * 2.7));
        }

        // The shadow's edge is exact: a ray from outside is captured iff b < 3√3/2.
        const pixel = u.pixelAngle.mul(cameraDistance);
        const inbound = along.lessThan(0);
        const outside = smoothstep(pixel.negate(), pixel, impact.sub(HOLE.CRITICAL));
        const visible = through.mul(inbound.select(outside, 1)).toVar();

        // Light that circled the hole piles up just outside the shadow: the photon ring.
        const beyond = max(impact.sub(HOLE.CRITICAL), 0);
        const ring = exp(beyond.div(0.035).negate()).mul(0.9).add(exp(beyond.div(0.22).negate()).mul(0.12))
            .mul(inbound.select(outside, 0))
            .mul(front);
        // Brighter where the disk's approaching side feeds it.
        const side = dot(away, vec3(direction.z, 0, direction.x.negate())).mul(0.5).mul(u.doppler).add(1);
        colour.addAssign(blackbody(u.diskHeat.mul(1.02)).mul(ring).mul(side).mul(u.ringGain)
            .mul(u.diskGain)
            .mul(2.4));

        If(visible.greaterThan(0.002), () => {
            // Inside the Einstein ring (about 6.7 radii out from here) the lens smears every
            // feature of the sky into an arc; past a point that is grooves, not sky, so the fine
            // grain and the nebulae's contrast ease off toward the shadow.
            colour.addAssign(sky(asymptote, smoothstep(3.4, 9.5, impact)).mul(visible));
        });
        // Alpha tells the post chain where the bare shadow is, so glare stays out of it.
        if (!shadowAlpha) return vec4(colour, 1);
        return vec4(colour, inbound.select(outside.oneMinus(), 0).mul(front).mul(0.82).oneMinus());
    })();

    return material;
}

/** The lens is drawn on a shell around the camera; its owner keeps it centred there. */
export function createLensMesh(material) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), material);
    mesh.name = 'Black Hole — lens shell';
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    mesh.scale.setScalar(4000);
    return mesh;
}
