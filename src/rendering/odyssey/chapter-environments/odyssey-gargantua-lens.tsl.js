/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview ODYSSEY'S BLACK HOLE, TRACED (2026-10-31, the space masterpiece pass).
 *
 * Olov: "I guess the black hole in the black hole theme looks like the gargantua in interstellar."
 * Odyssey's hole (chapter 6's omen, chapter 7's Gargantua) was painted: a black sphere, a thin
 * ring mesh, two torus arcs standing in for the disk's far side, a flat band for the disk. Read
 * from up close it was a target of glowing hoops. The Black Hole theme's hole is one material that
 * traces every view ray through Schwarzschild spacetime, and everything that makes Gargantua read
 * falls out of the bend: the far side of the disk arching over the shadow and tucked under it, the
 * thin photon ring, the brighter approaching side, the glowing gas round it.
 *
 * Re-derived from `src/themes/black-hole/black-hole-lens.js` (theme code is never imported into
 * Odyssey; the same physics, constants and look): the photon path x'' = -(3/2) h^2 x / |x|^5 in
 * Schwarzschild radii (exact for null geodesics), stepped symplectically inside a bounding sphere,
 * the closed-form bend outside it; the disk sheared Keplerian over a baked gas texture
 * (odyssey-gargantua-gas.js), lit by a blackbody ramp with relativistic beaming; the corona's
 * Gaussian sheet integrated in closed form along each step.
 *
 * WHAT IS DIFFERENT HERE: the theme's material IS the sky (it lenses its own galaxy). Odyssey's
 * sky is already there and the board's post lens bends it round the hole, so this draws only the
 * hole's light, on a sphere round the hole, premultiplied: its light is added and what is behind
 * is covered by what the gas in front of it takes. Where a ray falls in, it lets the chapter's own
 * black shadow sphere (and chapter 7's window into the singularity on it) show through what the
 * gas on the near side leaves. The shadow edge is the same circle: Rs = shadow radius / (3√3/2).
 */
import * as THREE from 'three/webgpu';
import {
    Break, Fn, If, Loop, abs, atan, cameraPosition, clamp, cross, dot, exp, float, fwidth, length, log2,
    max, min, mix, normalize, positionWorld, pow, select, sign, sin, cos, smoothstep, sqrt, texture,
    uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { GARGANTUA_GAS, bakeGargantuaGasSteps } from './odyssey-gargantua-gas.js';

const TAU = Math.PI * 2;

/** Lengths in Schwarzschild radii (the theme's HOLE). */
export const GARGANTUA_HOLE = Object.freeze({
    /** 3√3/2: the impact parameter of the shadow's edge. */
    CRITICAL: 2.598076,
    /** Innermost stable orbit: where the disk proper ends. */
    DISK_INNER: 3.0,
    DISK_OUTER: 10.5,
    /** Inside the stable orbit the gas only falls; it glows faintly down to here. */
    PLUNGE: 1.75,
    /** The sphere the march starts from (the mesh), and where a ray is let go again. */
    BOUND: 11.6,
    ESCAPE: 12.4,
});

/** The corona: hot gas puffed up round the disk (the theme's CORONA). */
const CORONA = Object.freeze({
    BASE: 0.16,
    FLARE: 0.085,
    FALL: 0.42,
    ABSORB: 0.08,
    GAIN: 0.055,
});

/** March budgets by the board's quality tier (the theme's Ultra / Medium). */
export const GARGANTUA_LENS_QUALITY = Object.freeze({
    high: Object.freeze({ steps: 72, stepScale: 0.125, detail: true }),
    low: Object.freeze({ steps: 44, stepScale: 0.19, detail: false }),
});

/** Seconds for the gas at the inner edge to circle the hole, and the shear phases' reset period. */
const INNER_ORBIT_SECONDS = 13;
const FLOW_PERIOD = 2.2;
const RIGID_RATE = 0.42;
const HALF_ROOT_PI = 0.8862269;

/** erf, after Winitzki (within ~2e-4). */
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
    const a = mix(vec3(0.42, 0.03, 0.006), vec3(1.0, 0.27, 0.035), smoothstep(0.2, 0.5, heat));
    const b = mix(a, vec3(1.0, 0.6, 0.2), smoothstep(0.46, 0.82, heat));
    const c = mix(b, vec3(1.0, 0.9, 0.74), smoothstep(0.8, 1.2, heat));
    return mix(c, vec3(0.68, 0.82, 1.0), smoothstep(1.25, 1.9, heat));
};

/**
 * Build the traced hole, in steps (the gas bake yields between rows).
 * @param {object} options
 * @param {number} options.shadowRadius the chapter's shadow sphere radius (group-local units)
 * @param {*} [options.uReveal] 0..1 uniform: the hole's light arriving (premultiplied fade)
 * @param {'high'|'low'} [options.quality]
 */
export function* createGargantuaLensSteps({ shadowRadius, uReveal = uniform(1), quality = 'high' }) {
    const H = GARGANTUA_HOLE;
    const Q = GARGANTUA_LENS_QUALITY[quality] ?? GARGANTUA_LENS_QUALITY.high;
    const gas = yield* bakeGargantuaGasSteps();
    const gasTex = new THREE.DataTexture(gas, GARGANTUA_GAS.width, GARGANTUA_GAS.height, THREE.RGBAFormat);
    gasTex.wrapS = THREE.RepeatWrapping;
    gasTex.wrapT = THREE.RepeatWrapping;
    gasTex.magFilter = THREE.LinearFilter;
    gasTex.minFilter = THREE.LinearMipmapLinearFilter;
    gasTex.generateMipmaps = true;
    gasTex.colorSpace = THREE.NoColorSpace;
    gasTex.needsUpdate = true;
    yield 'gas';

    const u = {
        hole: uniform(new THREE.Vector3()),
        rs: uniform(1),
        /** World -> the disk's frame (+Y is the disk normal). */
        worldToDisk: uniform(new THREE.Matrix3()),
        diskRigid: uniform(0),
        flowA: uniform(0),
        flowB: uniform(0),
        flowMix: uniform(0),
        diskGain: uniform(1),
        diskHeat: uniform(1),
        doppler: uniform(0.8),
        ringGain: uniform(1),
        // 0.55 of the theme's: its haze filled a frame round a hole that IS the frame; here the hole
        // shares the sky (the galaxy, the giant), and the full haze spread a wide orange wash past
        // the disk's own edge.
        coronaGain: uniform(0.55),
        reveal: uReveal,
    };
    const rowsPerRadius = GARGANTUA_GAS.height / (H.DISK_OUTER - H.DISK_INNER);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'Odyssey Gargantua — lens';
    material.transparent = true;
    material.premultipliedAlpha = true;
    material.depthWrite = false;
    material.side = THREE.FrontSide;
    material.fog = false;
    material.userData.emitsBloom = true;

    /** Emission and opacity of the disk where a ray crosses its plane (the theme's shadeDisk). */
    const shadeDisk = (p, radius, towardCamera, order, travelled, pixelAngle) => {
        const turn = atan(p.z, p.x).div(TAU);
        const orbit = pow(float(H.DISK_INNER).div(radius), 1.5);
        const shear = orbit.sub(RIGID_RATE);
        const v = radius.sub(H.DISK_INNER).div(H.DISK_OUTER - H.DISK_INNER);
        const base = turn.sub(u.diskRigid);
        const uvA = vec2(base.sub(shear.mul(u.flowA)), v);
        const uvB = vec2(base.sub(shear.mul(u.flowB)).add(0.37), v.add(0.21));
        const grazing = max(abs(towardCamera.y), 0.045);
        const texels = pixelAngle.mul(travelled).mul(rowsPerRadius).div(grazing);
        const lod = max(log2(max(texels, 1)).sub(0.6).add(order.mul(1.2)), 0).toVar();
        const g0 = mix(texture(gasTex, uvA).level(lod), texture(gasTex, uvB).level(lod), u.flowMix).toVar();
        const fine = Q.detail
            ? mix(
                texture(gasTex, uvA.mul(vec2(4, 3))).level(lod.add(1.6)),
                texture(gasTex, uvB.mul(vec2(4, 3))).level(lod.add(1.6)),
                u.flowMix,
            ).toVar()
            : g0;
        const lanes = g0.r;
        const streaks = mix(g0.g, fine.g, 0.35);
        const gaps = smoothstep(0.2, 0.62, g0.a.mul(0.7).add(fine.a.mul(0.3)));
        const clumps = pow(g0.b, 4).mul(0.55).add(pow(fine.b, 5).mul(0.3));
        const weave = lanes.mul(0.74).add(streaks.mul(0.26));
        const density = pow(smoothstep(0.2, 0.84, weave), 1.35)
            .mul(gaps.mul(0.72).add(0.28))
            .add(clumps)
            .add(0.04)
            .toVar();
        const innerEdge = smoothstep(H.DISK_INNER * 0.975, H.DISK_INNER * 1.12, radius);
        const plunge = smoothstep(H.PLUNGE, H.DISK_INNER, radius).mul(innerEdge.oneMinus()).mul(0.3);
        const rim = radius.div(H.DISK_OUTER).add(lanes.sub(0.5).mul(0.3)).add(streaks.sub(0.5).mul(0.08));
        const envelope = innerEdge.add(plunge).mul(pow(smoothstep(0.52, 1.0, rim).oneMinus(), 1.4)).toVar();
        // Relativistic beaming: gas on a circular orbit, seen along the ray's local direction.
        const speed = sqrt(float(0.5).div(max(radius.sub(1), 0.4)));
        const tangent = vec3(p.z.negate(), 0, p.x).div(max(radius, 0.001));
        const shift = sqrt(speed.mul(speed).oneMinus())
            .div(speed.mul(dot(tangent, towardCamera)).oneMinus())
            .mul(sqrt(max(float(1).sub(float(1).div(radius)), 0.02)));
        const beaming = mix(float(1), shift.div(0.84), u.doppler);
        const warmth = pow(float(H.DISK_INNER).div(radius), 0.9);
        const heat = warmth.mul(pow(beaming, 0.9)).mul(u.diskHeat).mul(density.mul(0.42).add(0.74));
        const power = pow(warmth, 2.4).mul(pow(beaming, 1.7)).mul(density.mul(density.add(0.35)));
        const raw = blackbody(heat).mul(power).mul(u.diskGain).mul(2.7);
        // A shoulder on the brightest channel: filaments stay filaments instead of one white plate.
        const peak = max(max(raw.r, raw.g), raw.b);
        const emission = raw.mul(float(1.25).div(peak.div(2.6).add(1)));
        const alpha = float(1).sub(exp(density.mul(envelope).mul(-3.4).div(grazing.add(0.1))));
        return vec4(emission.mul(envelope), alpha);
    };

    material.outputNode = Fn(() => {
        const rayWorld = normalize(positionWorld.sub(cameraPosition)).toVar();
        // Radians one pixel subtends, from the ray's own screen derivative (no viewport plumbing).
        const pixelAngle = max(length(fwidth(rayWorld)), 1e-5).toVar();
        const origin = u.worldToDisk.mul(cameraPosition.sub(u.hole).div(u.rs)).toVar();
        const direction = u.worldToDisk.mul(rayWorld).toVar();
        const along = dot(origin, direction).toVar();
        const closest = origin.sub(direction.mul(along)).toVar();
        const impact = max(length(closest), 1e-4).toVar();
        const away = closest.div(impact).toVar();
        const cameraDistance = length(origin).toVar();

        const colour = vec3(0).toVar();
        const through = float(1).toVar();
        const front = float(1).toVar();
        const haze = float(0).toVar();
        const hazeHeat = float(0).toVar();

        If(impact.lessThan(H.BOUND).and(along.lessThan(0)), () => {
            const entry = sqrt(float(H.BOUND * H.BOUND).sub(impact.mul(impact))).negate().toVar();
            const start = max(along, entry);
            const position = origin.add(direction.mul(start.sub(along))).toVar();
            const velocity = bendToward(direction, away, bendTo(impact, start).sub(bendTo(impact, along))).toVar();
            const swept = cross(position, velocity);
            const h2 = dot(swept, swept).toVar();
            const order = float(0).toVar();
            const escaped = float(0).toVar();

            Loop(Q.steps, () => {
                const r2 = dot(position, position).toVar();
                const r = sqrt(r2).toVar();
                const outward = dot(position, velocity).toVar();
                If(r.greaterThan(H.ESCAPE).and(outward.greaterThan(0)), () => {
                    escaped.assign(1);
                    Break();
                });
                If(r.lessThan(1.02), () => {
                    through.assign(0);
                    Break();
                });
                const dt = r.mul(Q.stepScale).toVar();
                velocity.addAssign(position.mul(h2.mul(-1.5).div(r2.mul(r2).mul(r))).mul(dt));
                const next = position.add(velocity.mul(dt)).toVar();
                // The corona's column along this step, exact in height (a Gaussian sheet along a chord).
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
                const reach = smoothstep(H.PLUNGE * 0.9, H.DISK_INNER * 1.15, ring)
                    .mul(exp(ring.sub(H.DISK_INNER).mul(-CORONA.FALL)))
                    .mul(smoothstep(1.6, H.DISK_INNER * 1.05, length(mid)))
                    .mul(smoothstep(H.BOUND - 0.4, H.DISK_OUTER * 0.72, length(mid)));
                const column = sheet.mul(length(next.sub(position))).mul(reach).toVar();
                const cSpeed = sqrt(float(0.5).div(max(ring.sub(1), 0.62)));
                const cTangent = vec3(mid.z.negate(), 0, mid.x).div(max(ring, 0.05));
                const cShift = sqrt(cSpeed.mul(cSpeed).oneMinus())
                    .div(cSpeed.mul(dot(cTangent, normalize(velocity).negate())).oneMinus())
                    .mul(sqrt(max(float(1).sub(float(1).div(max(length(mid), 1.05))), 0.02)));
                const cBeaming = min(mix(float(1), cShift.div(0.84), u.doppler), 2.4).toVar();
                const light = column.mul(cBeaming).mul(through).toVar();
                haze.addAssign(light);
                const lightHeat = pow(float(H.DISK_INNER).div(max(ring, 1.2)), 0.9).mul(pow(cBeaming, 0.6));
                hazeHeat.addAssign(light.mul(lightHeat));
                through.mulAssign(exp(column.mul(-CORONA.ABSORB)));

                If(position.y.mul(next.y).lessThan(0), () => {
                    const hit = mix(position, next, position.y.div(position.y.sub(next.y))).toVar();
                    const radius = length(hit.xz).toVar();
                    If(radius.greaterThan(H.PLUNGE).and(radius.lessThan(H.DISK_OUTER * 1.08)), () => {
                        const toEye = normalize(velocity).negate();
                        const disk = shadeDisk(hit, radius, toEye, order, cameraDistance, pixelAngle).toVar();
                        colour.addAssign(disk.rgb.mul(through));
                        through.mulAssign(disk.a.oneMinus());
                        If(outward.lessThan(0), () => {
                            front.mulAssign(disk.a.oneMinus());
                        });
                    });
                    order.addAssign(1);
                });
                position.assign(next);
            });
            // A ray still circling when the budget ran out is on the photon ring, not the sky.
            through.mulAssign(escaped);
            // A swallowed ray keeps little of the corona it crossed on the way in.
            haze.mulAssign(mix(float(0.04), float(1), escaped));
        });

        // The corona: one colour for the column, from its light-weighted temperature.
        const warmth = min(hazeHeat.div(max(haze, 1e-4)).mul(0.72).add(0.16), 1.1).mul(u.diskHeat);
        const coronaGain = u.diskGain.mul(u.coronaGain).mul(CORONA.GAIN * 2.7);
        colour.addAssign(blackbody(warmth).mul(haze).mul(coronaGain));

        // The shadow's edge is exact: a ray from outside is captured iff b < 3√3/2.
        const pixel = pixelAngle.mul(cameraDistance);
        const inbound = along.lessThan(0);
        const outside = smoothstep(pixel.negate(), pixel, impact.sub(H.CRITICAL)).toVar();
        // Light that circled the hole piles up just outside the shadow: the photon ring.
        const beyond = max(impact.sub(H.CRITICAL), 0);
        const ring = exp(beyond.div(0.035).negate()).mul(0.9).add(exp(beyond.div(0.22).negate()).mul(0.12))
            .mul(select(inbound, outside, float(0)))
            .mul(front);
        const side = dot(away, vec3(direction.z, 0, direction.x.negate())).mul(0.5).mul(u.doppler).add(1);
        const ringGain = u.ringGain.mul(u.diskGain).mul(2.4);
        colour.addAssign(blackbody(u.diskHeat.mul(1.02)).mul(ring.mul(side)).mul(ringGain));

        // What is behind still shows: past the hole, what the gas leaves of the sky (`through`);
        // in the shadow, what the gas on the near side leaves of the chapter's own shadow sphere.
        const leaves = select(inbound, mix(front, through, outside), through);
        const alpha = clamp(float(1).sub(leaves), 0, 1).mul(u.reveal);
        return vec4(colour.mul(u.reveal), alpha);
    })();

    const geometry = new THREE.SphereGeometry(shadowRadius * (H.BOUND / H.CRITICAL), 64, 40);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'gargantua-lens';
    mesh.frustumCulled = false;

    let turns = 0;
    const _pos = new THREE.Vector3();
    const _scale = new THREE.Vector3();
    const _quat = new THREE.Quaternion();
    const _x = new THREE.Vector3();
    const _n = new THREE.Vector3();
    const _z = new THREE.Vector3();

    return {
        mesh,
        material,
        uniforms: u,
        /**
         * Per frame: the hole's place and size from the mesh's world matrix, the disk's frame from
         * `diskPivot` (its local XY plane is the disk, +Z its normal), and the gas's motion.
         * @param {THREE.Object3D} diskPivot
         * @param {number} dt seconds
         * @param {number} [shadowScale] the shadow sphere's own scale (it grows out of a point as
         *   the hole arrives): the traced shadow follows it, so the two stay one circle
         */
        update(diskPivot, dt = 0, shadowScale = 1) {
            mesh.updateWorldMatrix(true, false);
            mesh.matrixWorld.decompose(_pos, _quat, _scale);
            u.hole.value.copy(_pos);
            const grown = Number.isFinite(shadowScale) ? Math.max(shadowScale, 1e-3) : 1;
            u.rs.value = Math.max((shadowRadius * _scale.x * grown) / H.CRITICAL, 1e-6);
            if (diskPivot) {
                diskPivot.updateWorldMatrix(true, false);
                const e = diskPivot.matrixWorld.elements;
                _x.set(e[0], e[1], e[2]).normalize();
                _n.set(e[8], e[9], e[10]).normalize();
                _z.crossVectors(_x, _n).normalize();
                // Rows: the disk's X, its normal (Y) and Z, in world space.
                u.worldToDisk.value.set(_x.x, _x.y, _x.z, _n.x, _n.y, _n.z, _z.x, _z.y, _z.z);
            }
            turns += Math.max(0, Number.isFinite(dt) ? dt : 0) / INNER_ORBIT_SECONDS;
            if (turns > 1e4) turns -= 1e4;
            const cycle = turns / FLOW_PERIOD;
            const a = cycle - Math.floor(cycle);
            const b = (cycle + 0.5) - Math.floor(cycle + 0.5);
            u.diskRigid.value = (turns * RIGID_RATE) % 1;
            u.flowA.value = (a - 0.5) * FLOW_PERIOD;
            u.flowB.value = (b - 0.5) * FLOW_PERIOD;
            u.flowMix.value = Math.abs((2 * a) - 1);
        },
        dispose() {
            geometry.dispose();
            material.dispose();
            gasTex.dispose();
        },
    };
}
