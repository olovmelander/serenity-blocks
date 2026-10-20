/**
 * Crystal Cave — the light in the air.
 *
 * The cave's air is damp: every cluster of crystals is a lamp in it, and the haze round
 * each one glows in its mineral's colour. Each lamp is a soft point light (its light
 * falls as 1 / (d² + r²)), and the light a straight view ray gathers from it has a closed
 * form, so the pass integrates every lamp exactly along each pixel's ray, up to the depth
 * the scene pass wrote (a crystal in front of a lamp cuts its halo; the rock behind it
 * ends it), with no march. A mist hangs over the pool, denser at the water; the lamps'
 * light is gathered at the density where each ray passes nearest them.
 *
 * Lamps are fed by the families' live levels, so a lock that flares a family flares the
 * air round its crystals too.
 *
 * The skylight's shaft is the same kind of light: the air lit round the chimney's axis with
 * a Gaussian profile that widens down its cone, integrated along the ray in closed form
 * (√(2π)·σ / sin θ at the ray's closest approach to the axis), only in front of what the ray
 * hits, streaked by the light the chimney lets through and brightest near its mouth.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, atan, clamp, cross, dot, exp, float, getViewPosition, int, length, max, min, normalize, screenUV,
    smoothstep,
    sqrt, texture, uniform, uniformArray, vec2, vec3, vec4,
} from 'three/tsl';

/** At most this many lamps (cluster centres). */
export const ATMOSPHERE_LAMPS = 16;

/** The air (tuned against playground captures). */
export const CRYSTAL_CAVE_AIR = Object.freeze({
    haze: 0.010, // per metre everywhere in the hall
    mist: 0.032, // per metre at the water, falling off upward
    mistHeight: 2.6, // metres
    lampGain: 20, // art gain on the lamps' light in the air
    reach: 140, // metres: the farthest a ray gathers (the hall's length)
    halo: 13, // metres: how far to the side of its ray a lamp still lights the air
    shaft: 0.032, // art gain on the skylight's shaft
});

/**
 * The lamps: big crystals grouped by family into clusters, each a weighted centre and a
 * spread. Larger clusters come first; at most `limit` are kept.
 * @param {Array<object>} crystals world crystals ({ x, y, z, radius, height, family, group })
 * @param {(crystal: object, fraction: number) => THREE.Vector3} along a point along a crystal
 */
export function planAtmosphereLamps(crystals, along, limit = ATMOSPHERE_LAMPS) {
    const clusters = [];
    const candidates = crystals
        .map((crystal, index) => ({ crystal, index }))
        .filter(({ crystal }) => crystal.group === 0 && crystal.height >= 2.4)
        .sort((first, second) => second.crystal.radius * second.crystal.height
            - first.crystal.radius * first.crystal.height);
    for (const { crystal } of candidates) {
        const centre = along(crystal, 0.45);
        const weight = crystal.radius * crystal.radius * crystal.height;
        let home = null;
        for (const cluster of clusters) {
            if (cluster.family !== crystal.family) continue;
            const dx = cluster.x / cluster.weight - centre.x;
            const dy = cluster.y / cluster.weight - centre.y;
            const dz = cluster.z / cluster.weight - centre.z;
            if (dx * dx + dy * dy + dz * dz < 11 * 11) {
                home = cluster;
                break;
            }
        }
        if (!home) {
            home = {
                family: crystal.family, x: 0, y: 0, z: 0, weight: 0, spread: 0, members: 0,
            };
            clusters.push(home);
        }
        home.x += centre.x * weight;
        home.y += centre.y * weight;
        home.z += centre.z * weight;
        home.weight += weight;
        home.spread = Math.max(home.spread, crystal.height * 0.5);
        home.members += 1;
    }
    return clusters
        .sort((first, second) => second.weight - first.weight)
        .slice(0, limit)
        .map((cluster) => ({
            x: cluster.x / cluster.weight,
            y: cluster.y / cluster.weight,
            z: cluster.z / cluster.weight,
            radius: THREE.MathUtils.clamp(cluster.spread, 1.5, 6),
            family: cluster.family,
            // Light grows with the cluster's mass, gently (a geode is not a hundred lamps).
            gain: Math.sqrt(cluster.weight) / 6,
        }));
}

/**
 * The light in the air as a function of a ray: what a ray from `O` along `D` gathers from the
 * lamps and the skylight's shaft over its first `T` metres. Shared by the post (along each
 * pixel's view ray, up to the scene depth) and the pool (along its mirrored ray), so the water
 * mirrors the halos and the shaft. `gather` is inline TSL: call it inside a `Fn`.
 * @param {object} options
 * @param {object} options.light the shared cave light (`createCaveLight`)
 * @param {Array<object>} options.lamps from `planAtmosphereLamps`
 * @param {number} options.poolLevel
 * @param {object} [options.skylight] `{ position, target, angle }` of the chimney's light
 * @param {object} [options.shaft] a float uniform: the shaft's live strength (events)
 */
export function createCaveAirLight({
    light, lamps, poolLevel, skylight = null, shaft = null,
}) {
    const u = light.uniforms;
    const count = Math.min(ATMOSPHERE_LAMPS, lamps.length);
    const place = Array.from({ length: ATMOSPHERE_LAMPS }, (_, index) => {
        const lamp = lamps[index];
        return lamp ? new THREE.Vector4(lamp.x, lamp.y, lamp.z, lamp.radius) : new THREE.Vector4(0, -1000, 0, 1);
    });
    const look = Array.from({ length: ATMOSPHERE_LAMPS }, (_, index) => {
        const lamp = lamps[index];
        return lamp ? new THREE.Vector4(lamp.family, lamp.gain, 0, 0) : new THREE.Vector4(0, 0, 0, 0);
    });
    const uniforms = {
        place: uniformArray(place, 'vec4'),
        look: uniformArray(look, 'vec4'),
        count: uniform(count, 'int'),
        gain: uniform(CRYSTAL_CAVE_AIR.lampGain),
    };

    // ---- the skylight's shaft ---------------------------------------------------------------
    const top = skylight ? new THREE.Vector3(...skylight.position) : new THREE.Vector3();
    const axis = skylight ? new THREE.Vector3(...skylight.target).sub(top) : new THREE.Vector3(0, -1, 0);
    const span = axis.length();
    axis.normalize();
    const spread = skylight ? Math.tan(skylight.angle * 0.5) : 0;
    const shaftGain = shaft ?? uniform(1);
    /** The shaft's light gathered along the ray (O, D) up to distance T (a vec3). */
    const shaftLight = (O, D, T) => {
        const A = vec3(top.x, top.y, top.z);
        const S = vec3(axis.x, axis.y, axis.z);
        const w0 = O.sub(A);
        const b = dot(D, S);
        const sinT = sqrt(max(float(1).sub(b.mul(b)), 0.0225)).toVar();
        const d = dot(D, w0);
        const e = dot(S, w0);
        // Closest approach of the ray to the axis: where on the ray, where on the axis.
        const tc = b.mul(e).sub(d).div(sinT.mul(sinT)).toVar();
        const sc = clamp(e.sub(b.mul(d)).div(sinT.mul(sinT)), 0.0, span).toVar();
        const nearest = O.add(D.mul(max(tc, 0.0))).sub(A.add(S.mul(sc))).toVar();
        const h = length(nearest);
        // The cone: about 1.7 m at the chimney's mouth, wider toward the floor.
        const sigma = sc.mul(spread).add(1.7).mul(0.46).toVar();
        const profile = exp(h.mul(h).div(sigma.mul(sigma).mul(-2.0)));
        const width = sigma.div(sinT);
        const visible = smoothstep(-1.4, 1.4, T.sub(tc).div(width)).mul(smoothstep(-1.4, 1.4, tc.div(width)));
        // Streaks: the light the chimney's ragged throat lets through, by angle round the axis.
        const side = normalize(cross(S, vec3(0.31, 0.0, 0.95)));
        const turn = atan(dot(nearest, cross(S, side)), dot(nearest, side));
        const streak = texture(light.noise, vec2(turn.mul(0.48), sc.mul(0.004).sub(u.time.mul(0.004)))).level(1).r
            .mul(1.9).sub(0.25).max(0.05);
        // Brightest near the mouth, fading where it reaches the floor.
        const along = smoothstep(0.0, 0.08, sc.div(span)).mul(smoothstep(1.0, 0.55, sc.div(span)))
            .mul(exp(sc.div(span).mul(-1.1)).mul(0.7).add(0.3));
        const amount = profile.mul(width).mul(2.5066).mul(visible).mul(streak)
            .mul(along);
        return vec3(0.6, 0.8, 1.0).mul(amount).mul(CRYSTAL_CAVE_AIR.haze * 40 * CRYSTAL_CAVE_AIR.shaft)
            .mul(shaftGain);
    };

    /** What the ray (O, D) gathers over its first T metres (vec3). Inline: call inside a Fn. */
    const gather = (O, D, T) => {
        const excite = u.energy.mul(0.6).add(1.0).toVar();
        const glow = vec3(0.0).toVar();
        // The mist lies in drifting banks: read once where the ray crosses the mist's middle.
        const crossing = float(poolLevel + 1.2).sub(O.y).div(min(D.y, -1e-3));
        const bank = O.xz.add(D.xz.mul(clamp(crossing, 0.0, T)));
        const drift = vec2(u.time.mul(0.011), u.time.mul(-0.007));
        const banks = texture(light.noise, bank.mul(0.018).add(drift)).level(1).a
            .mul(texture(light.noise, bank.mul(0.047).sub(drift.mul(1.7))).level(1).r)
            .mul(2.6).max(0.18).toVar();
        Loop({
            start: int(0), end: uniforms.count, type: 'int', condition: '<', name: 'lamp',
        }, ({ lamp }) => {
            const at = uniforms.place.element(lamp).toVar();
            const info = uniforms.look.element(lamp).toVar();
            const family = int(info.x.add(0.5));
            const toLamp = at.xyz.sub(O).toVar();
            const b = dot(toLamp, D).toVar();
            const h2 = max(dot(toLamp, toLamp).sub(b.mul(b)), 0.0).add(at.w.mul(at.w)).toVar();
            const h = sqrt(h2).toVar();
            // ∫₀ᵀ dt / (h² + (t − b)²): the light of a soft point lamp gathered along the ray.
            // A halo, not a veil: rays that pass far to the side of a lamp gather little of it.
            const gathered = atan(T.sub(b).div(h)).sub(atan(b.negate().div(h))).div(h)
                .mul(exp(h.div(-CRYSTAL_CAVE_AIR.halo)));
            // The air's density where the ray passes nearest the lamp, and what it loses on the way.
            const nearest = clamp(b, 0.0, T);
            const y = O.y.add(D.y.mul(nearest));
            const mist = exp(max(y.sub(poolLevel), 0.0).div(-CRYSTAL_CAVE_AIR.mistHeight));
            const density = float(CRYSTAL_CAVE_AIR.haze).add(mist.mul(banks).mul(CRYSTAL_CAVE_AIR.mist));
            const lost = exp(nearest.mul(CRYSTAL_CAVE_AIR.haze * -1.2));
            // Each lamp breathes slowly, out of step with the others.
            const breath = float(lamp).mul(1.7).add(u.time.mul(0.37)).sin()
                .mul(0.12)
                .add(0.88);
            const tint = vec3(u.familyColor.element(family)).mul(u.familyLevel.element(family)).mul(breath);
            glow.addAssign(tint.mul(info.y).mul(gathered).mul(density).mul(lost));
        });
        if (skylight) {
            glow.addAssign(shaftLight(O, D, T).mul(excite));
        }
        return glow.mul(uniforms.gain).mul(excite);
    };

    return {
        uniforms, count, gather, hasShaft: Boolean(skylight),
    };
}

/**
 * The post's light in the air: `air.gather` along each pixel's view ray, up to the scene depth.
 * @param {object} options
 * @param {object} options.air from `createCaveAirLight`
 * @param {THREE.Camera} options.camera the scene camera
 * @param {object} options.depthNode the scene pass's depth texture node
 * @returns {{ node: object, uniforms: object, count: number, update: Function }}
 */
export function createCaveAtmosphere({ air, camera, depthNode }) {
    const uniforms = {
        ...air.uniforms,
        // The pass's own camera nodes belong to its full-screen quad: read the scene camera's.
        projInv: uniform(camera.projectionMatrixInverse),
        camWorld: uniform(camera.matrixWorld),
        eye: uniform(new THREE.Vector3()),
    };
    const node = Fn(() => {
        const depth = depthNode.sample(screenUV).x;
        const viewPos = getViewPosition(screenUV, depth, uniforms.projInv);
        const P = uniforms.camWorld.mul(vec4(viewPos, 1.0)).xyz.toVar();
        const O = vec3(uniforms.eye).toVar();
        const toP = P.sub(O);
        const T = min(max(length(toP), 0.1), CRYSTAL_CAVE_AIR.reach).toVar();
        const D = toP.div(max(length(toP), 1e-4)).toVar();
        return air.gather(O, D, T);
    });
    return {
        node,
        uniforms,
        count: air.count,
        /** Call before the pipeline renders: the eye the ray starts from. */
        update() {
            uniforms.eye.value.setFromMatrixPosition(camera.matrixWorld);
        },
    };
}
