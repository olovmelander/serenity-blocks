/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sunset — the sea.
 *
 * One fan of rings round the eye's foot, out to the horizon. The swell (SWELL in sunset-core.js)
 * moves it in the vertex stage as Gerstner waves, each train fading out where the mesh is too
 * coarse to carry it. The fragment rebuilds the slope from the same trains plus up to three
 * layers of ripples read from the water's noise, and keeps count of the slope it can no longer
 * resolve (the variance), because that is what draws the roads of light: the sun's (and the
 * moon's) image is the share of facets that mirror it, a few sharp sparks near the eye that
 * widen into a broad shimmering road toward the horizon.
 *
 * What it mirrors is the sky function itself (skyColour, along the mirror ray), with fewer
 * layers; the lanterns are mirrored by the same facet statistics as the sun, so each one stands
 * on a streak of its own light. A ring runs out from where a lantern is set down.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, cameraPosition, clamp, cos, dot, exp, float, int, length, max, min, mix, normalize, positionGeometry,
    positionWorld, sin, smoothstep, texture, varying, vec2, vec3, vec4,
} from 'three/tsl';
import {
    CHOP_ROWS, SEA_FAN, SEA_TIME, SWELL_CHOP, SWELL_ROWS, ringRadius,
} from './sunset-core.js';
import {
    TUNE, glintLobe, horizonHaze, skyColour,
} from './sunset-tsl.js';

/** The fan of rings round the eye's foot (positions, a normal that faces up, the indices). */
export function buildSeaFan(rings, spokes) {
    const half = SEA_FAN.halfAngle * (Math.PI / 180);
    const positions = new Float32Array(rings * spokes * 3);
    for (let i = 0; i < rings; i += 1) {
        const r = ringRadius(i, rings);
        for (let j = 0; j < spokes; j += 1) {
            const a = -half + (2 * half * j) / (spokes - 1);
            const at = (i * spokes + j) * 3;
            positions[at] = r * Math.sin(a);
            positions[at + 1] = 0;
            positions[at + 2] = -r * Math.cos(a);
        }
    }
    const indices = new Uint32Array((rings - 1) * (spokes - 1) * 6);
    let k = 0;
    for (let i = 0; i < rings - 1; i += 1) {
        for (let j = 0; j < spokes - 1; j += 1) {
            const a = i * spokes + j;
            const b = a + spokes;
            // Wound so the face looks up (+y).
            indices[k++] = a;
            indices[k++] = a + 1;
            indices[k++] = b;
            indices[k++] = a + 1;
            indices[k++] = b + 1;
            indices[k++] = b;
        }
    }
    return { positions, indices };
}

/** How far apart the fan's rings are at a distance (metres). */
const ringStep = (rings) => (SEA_FAN.far / SEA_FAN.near) ** (1 / Math.max(1, rings - 1)) - 1;

export function createSea({
    tier, U, skyNoise, seaNoise, seaVariance, rows,
}) {
    const fan = buildSeaFan(tier.seaRings, tier.seaSpokes);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(fan.positions, 3));
    const normals = new Float32Array(fan.positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(fan.indices, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), SEA_FAN.far);

    const step = ringStep(tier.seaRings);
    const n = SWELL_ROWS.length;
    const qOf = (row) => SWELL_CHOP / (row[2] * row[4] * n);

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide, fog: false });
    material.name = 'sunset-sea';

    // ── The swell, in the vertex stage (from the fan's rest position) ──
    const rest = positionGeometry.xz;
    const swell = (withShift) => {
        const t = U.time.mul(SEA_TIME);
        const spacing = length(rest).mul(step);
        let lift = float(0.0);
        let shift = vec2(0.0);
        for (let i = 0; i < n; i += 1) {
            const row = SWELL_ROWS[i];
            const L = (2 * Math.PI) / row[2];
            const keep = float(1.0).sub(smoothstep(L * 0.18, L * 0.42, spacing));
            const theta = dot(rest, vec2(row[0], row[1])).mul(row[2]).sub(t.mul(row[3])).add(row[5]);
            lift = lift.add(sin(theta).mul(row[4]).mul(keep));
            if (withShift) shift = shift.add(vec2(row[0], row[1]).mul(cos(theta).mul(row[4] * qOf(row))).mul(keep));
        }
        return { lift, shift };
    };
    const vCrest = varying(swell(false).lift, 'sunsetSeaCrest');
    material.positionNode = Fn(() => {
        const { lift, shift } = swell(true);
        return vec3(rest.x.add(shift.x), lift, rest.y.add(shift.y));
    })();

    // ── The fragment ──
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const toEye = cameraPosition.sub(P);
        const dist = max(length(toEye), 1e-3).toVar();
        const V = toEye.div(dist).toVar();
        const grazing = max(V.y, 0.012);
        // A pixel's footprint along the view, metres: what the slope can still be resolved at.
        const foot = dist.mul(U.pixelAngle).div(grazing).toVar();
        const xz = P.xz.toVar();
        const t = U.time.mul(SEA_TIME);

        // The swell's slope, train by train; what a pixel cannot resolve goes into the variance.
        const slope = vec2(0.0).toVar();
        const variance = float(TUNE.glintFloor).toVar();
        for (let i = 0; i < n; i += 1) {
            const row = SWELL_ROWS[i];
            const L = (2 * Math.PI) / row[2];
            const seen = float(1.0).sub(smoothstep(L * 0.12, L * 0.45, foot));
            const theta = dot(xz, vec2(row[0], row[1])).mul(row[2]).sub(t.mul(row[3])).add(row[5]);
            const ak = row[4] * row[2];
            slope.addAssign(vec2(row[0], row[1]).mul(cos(theta).mul(ak).mul(seen)));
            variance.addAssign(float(0.5 * ak * ak).mul(float(1.0).sub(seen)));
        }

        // The wind's chop: short directional trains in the light only, their phases bent by a
        // slow warp (two smooth fields of the water's noise, read once) so they run in long,
        // broken crests and never lock into a lattice.
        const chopRows = CHOP_ROWS.slice(0, Math.max(0, tier.chop ?? 12));
        if (chopRows.length) {
            const warp = texture(seaNoise, xz.div(TUNE.chopWarpTile).add(vec2(0.31, 0.77))).ba.sub(0.5).mul(2.0)
                .toVar();
            chopRows.forEach((row) => {
                const L = (2 * Math.PI) / row[2];
                const seen = float(1.0).sub(smoothstep(L * 0.12, L * 0.45, foot));
                const theta = dot(xz, vec2(row[0], row[1])).mul(row[2]).sub(t.mul(row[3])).add(row[5])
                    .add(warp.x.mul(row[6]))
                    .add(warp.y.mul(row[7]));
                const s = row[4] * TUNE.chop;
                slope.addAssign(vec2(row[0], row[1]).mul(cos(theta).mul(s).mul(seen)));
                variance.addAssign(float(0.5 * s * s).mul(float(1.0).sub(seen)));
            });
        }

        // Ripples from the noise: three scales, drifting with the breeze.
        const layers = Math.min(3, Math.max(1, tier.ripples));
        const drifts = [vec2(0.011, -0.017), vec2(-0.023, -0.031), vec2(0.043, -0.052)];
        for (let i = 0; i < layers; i += 1) {
            const tile = TUNE.rippleTile[i];
            const strength = TUNE.ripple[i];
            const at = xz.div(tile).add(drifts[i].mul(U.time)).add(vec2(i * 0.37, i * 0.71));
            const s = texture(seaNoise, at).rg.sub(0.5).mul(2.0 * strength);
            const seen = float(1.0).sub(smoothstep(tile / 90, tile / 6, foot));
            slope.addAssign(s.mul(seen));
            variance.addAssign(float(seaVariance * strength * strength * 0.5).mul(float(1.0).sub(seen)));
        }

        // Rings where lanterns were set down: a few crests running out, in the lantern's colour.
        const ringLight = vec3(0.0).toVar();
        Loop({
            start: int(0), end: int(U.counts.x), type: 'int', condition: '<', name: 'ring',
        }, ({ ring }) => {
            const a = rows.rings.element(ring.mul(2));
            const b = rows.rings.element(ring.mul(2).add(1));
            const age = max(U.time.sub(a.z), 0.0);
            const offset = xz.sub(a.xy);
            const d = length(offset);
            const radius = age.mul(1.35).add(0.2);
            const x = d.sub(radius);
            const fade = exp(age.mul(-0.55)).mul(a.w).mul(smoothstep(0.0, 0.15, age));
            const env = exp(x.mul(x).mul(-1.6)).mul(fade);
            const wave = cos(x.mul(7.0));
            const dh = env.mul(sin(x.mul(7.0))).mul(-0.11);
            slope.addAssign(offset.div(max(d, 0.05)).mul(clamp(dh, -0.18, 0.18)));
            ringLight.addAssign(b.xyz.mul(env.mul(max(wave, 0.0)).mul(b.w)).div(max(d.mul(0.4).add(1.0), 1.0)));
        });

        const N = normalize(vec3(slope.x.negate(), 1.0, slope.y.negate())).toVar();
        const cosV = clamp(dot(V, N), 0.0, 1.0);
        const m = float(1.0).sub(cosV);
        const m2 = m.mul(m);
        const fresnel = float(0.02).add(m2.mul(m2).mul(m).mul(0.98)).toVar();

        // What the sea mirrors.
        const R0 = V.negate().reflect(N);
        const R = normalize(vec3(R0.x, max(R0.y, 0.004), R0.z)).toVar();
        const mirrored = skyColour(R, U, skyNoise, {
            slices: tier.mirror,
            fine: false,
            cirrus: tier.cirrus && tier.mirror > 0,
            bars: tier.mirror > 0,
            discs: false,
            stars: true,
            milky: false,
        });

        // The water's own colour: dark looked down into, the backs of the swell lit through
        // where they stand between the eye and a low light.
        const { light } = U;
        const keyDir = normalize(mix(U.sun, U.moon, U.moonKey));
        const forward = max(dot(V.negate(), normalize(vec3(keyDir.x, 0.0, keyDir.z))), 0.0);
        const f2 = forward.mul(forward);
        const crest = smoothstep(-0.05, 0.35, vCrest);
        const body = light.seaDeep.add(light.seaScatter.mul(crest.mul(f2.mul(f2)).mul(1.4).add(0.35))).toVar();

        const water = body.mul(float(1.0).sub(fresnel)).add(mirrored.mul(fresnel)).toVar();

        // The roads: the share of facets that mirror the sun, and the moon.
        const roadBoost = U.glint.add(1.0);
        const sunRoad = glintLobe(slope, variance, V, U.sun).x.mul(U.sunUp).mul(roadBoost);
        water.addAssign(light.sunGlint.mul(sunRoad).mul(TUNE.glint));
        const moonRoad = glintLobe(slope, variance.mul(1.4), V, U.moon).x.mul(U.moonUp);
        water.addAssign(light.moonGlint.mul(moonRoad).mul(TUNE.glint * 0.4));

        // The lanterns: each mirrored on a streak of its own light, and a pool of it on the water.
        const lit = vec3(0.0).toVar();
        Loop({
            start: int(0), end: int(U.counts.z), type: 'int', condition: '<', name: 'lamp',
        }, ({ lamp }) => {
            const a = rows.lamps.element(lamp.mul(2));
            const b = rows.lamps.element(lamp.mul(2).add(1));
            const toLamp = a.xyz.sub(P);
            const d2 = max(dot(toLamp, toLamp), 0.04);
            const Ld = toLamp.div(d2.sqrt());
            const streak = glintLobe(slope, variance.add(0.002), V, Ld).x;
            const pool = max(dot(N, Ld), 0.0).mul(0.014);
            lit.addAssign(b.xyz.mul(a.w).mul(streak.mul(0.06).add(pool)).div(d2));
        });
        water.addAssign(lit);
        water.addAssign(ringLight.mul(0.2));

        // The air over the far sea.
        const haze = float(1.0).sub(exp(dist.div(-TUNE.hazeReach))).toVar();
        const far = horizonHaze(V.negate(), U);
        const out = mix(water, far, haze.mul(min(haze.mul(1.4), 1.0)));
        return vec4(out, 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sunset-sea';
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    return {
        mesh,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
