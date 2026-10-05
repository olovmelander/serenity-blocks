/**
 * Crystal Cave — the light that play throws.
 *
 * Three fixed pools, three draw calls, nothing allocated after construction:
 *   sparks  points of light simulated on the CPU (so a replay is exact): motes that
 *           cross from the board to a crystal, bursts, falling glitter, brief flares;
 *   fans    the prismatic rays that burst from the board's edge on a line clear;
 *   beams   the lattice that links crystal tips while a chain is alive.
 */
import * as THREE from 'three/webgpu';
import {
    abs, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cameraWorldMatrix, clamp, cos, cross, exp,
    float, fract, int, length, max, mix, normalize, positionGeometry, pow, sin, smoothstep, step, uniformArray, uv,
    varying, vec2, vec3, vec4,
} from 'three/tsl';

const TAU = Math.PI * 2;
export const SPARK_KIND = Object.freeze({
    homing: 0, burst: 1, fall: 2, flare: 3,
});
const RAYS_PER_FAN = 13;
const FAN_SECONDS = 1.7;

function additive(name) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false,
    });
    material.name = name;
    return material;
}

function quadGeometry(count, attributes) {
    const geometry = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute('position', plane.getAttribute('position'));
    geometry.setAttribute('uv', plane.getAttribute('uv'));
    geometry.setIndex(plane.getIndex());
    const made = {};
    Object.entries(attributes).forEach(([name, { array, size, dynamic }]) => {
        const instanced = new THREE.InstancedBufferAttribute(array, size);
        if (dynamic) instanced.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute(name, instanced);
        made[name] = instanced;
    });
    geometry.instanceCount = count;
    return { geometry, attributes: made };
}

/** A rainbow that stays bright: used wherever light is split. */
const spectrum = (phase) => cos(vec3(0, 0.33, 0.67).add(phase).mul(TAU)).mul(0.5).add(0.5);

function makeSpark(index) {
    return {
        index,
        active: false,
        kind: SPARK_KIND.burst,
        age: 0,
        life: 1,
        size: 0.2,
        strength: 1,
        star: 0,
        drag: 1,
        gravity: 0,
        phase: 0,
        payload: -1,
        shed: 0,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        from: new THREE.Vector3(),
        bend: new THREE.Vector3(),
        to: new THREE.Vector3(),
        tint: new THREE.Color(),
    };
}

/**
 * @param {object} options
 * @param {object} options.light shared cave light
 * @param {number} options.poolLevel
 * @param {object} options.quality `{ sparks, fans, beams }` pool sizes
 */
export function createCaveEffects({ light, poolLevel, quality }) {
    const u = light.uniforms;
    const group = new THREE.Group();
    group.name = 'Crystal Cave — event light';
    group.renderOrder = 6;
    const owned = [];
    const right = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz;
    const up = cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz;
    const forward = cameraWorldMatrix.mul(vec4(0, 0, -1, 0)).xyz;

    // ---- sparks ---------------------------------------------------------------------
    const sparkCount = Math.max(0, Math.floor(quality.sparks ?? 0));
    const sparks = Array.from({ length: sparkCount }, (_, index) => makeSpark(index));
    let sparkMesh = null;
    let sparkPlace = null;
    let sparkTrail = null;
    let sparkTint = null;
    if (sparkCount > 0) {
        const made = quadGeometry(0, {
            iPlace: { array: new Float32Array(sparkCount * 4), size: 4, dynamic: true }, // centre, size
            iTrail: { array: new Float32Array(sparkCount * 4), size: 4, dynamic: true }, // tail vector, alpha
            iTint: { array: new Float32Array(sparkCount * 4), size: 4, dynamic: true }, // colour, star
        });
        sparkPlace = made.attributes.iPlace;
        sparkTrail = made.attributes.iTrail;
        sparkTint = made.attributes.iTint;
        const place = attribute('iPlace', 'vec4');
        const trail = attribute('iTrail', 'vec4');
        const tint = attribute('iTint', 'vec4');
        const material = additive('Crystal Cave — sparks');
        // The quad is stretched back along the spark's tail in view space.
        const centre = cameraViewMatrix.mul(vec4(place.xyz, 1));
        const tail = cameraViewMatrix.mul(vec4(trail.xyz, 0)).xy;
        const reach = length(tail);
        const along = mix(vec2(1, 0), tail.div(max(reach, 0.0001)), step(0.0001, reach));
        const across = vec2(along.y.negate(), along.x);
        const distance = centre.z.negate();
        const size = max(place.w, distance.mul(0.0022));
        const offset = along.mul(positionGeometry.x.mul(size.add(reach)).sub(reach.mul(0.5)))
            .add(across.mul(positionGeometry.y.mul(size)));
        material.vertexNode = cameraProjectionMatrix.mul(vec4(centre.xyz.add(vec3(offset, 0)), 1));
        const local = uv().sub(0.5).mul(2);
        const stretch = varying(reach.div(size));
        // Head at +x: a round core there, a tapering tail behind it.
        const headX = local.x.mul(stretch.add(1)).sub(stretch);
        const head = exp(headX.mul(headX).add(local.y.mul(local.y)).mul(-5.5));
        const streak = exp(local.y.mul(local.y).mul(-9)).mul(smoothstep(-1, 0.6, local.x)).mul(step(0.05, stretch)).mul(0.5);
        const ray = (axis, other) => exp(abs(other).mul(-26)).mul(exp(abs(axis).mul(-3.2)));
        const starry = ray(local.x, local.y).add(ray(local.y, local.x)).mul(tint.w);
        material.colorNode = mix(tint.rgb, vec3(1), head.mul(0.45)).mul(2.6);
        material.opacityNode = head.add(streak).add(starry).mul(trail.w)
            .mul(exp(distance.mul(u.hazeDensity).mul(-0.6)));
        sparkMesh = new THREE.Mesh(made.geometry, material);
        sparkMesh.name = 'Crystal Cave — sparks';
        sparkMesh.frustumCulled = false;
        owned.push(sparkMesh);
        group.add(sparkMesh);
    }

    // ---- fans -------------------------------------------------------------------------
    const fanCount = Math.max(0, Math.floor(quality.fans ?? 0));
    const fanPlace = Array.from({ length: Math.max(1, fanCount) }, () => new THREE.Vector4(0, 0, 0, -1000));
    const fanShape = Array.from({ length: Math.max(1, fanCount) }, () => new THREE.Vector4(1, 0, 1, 0));
    if (fanCount > 0) {
        const rays = new Float32Array(fanCount * RAYS_PER_FAN * 4);
        let state = 7717;
        const random = () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 4294967296;
        };
        for (let fan = 0; fan < fanCount; fan += 1) {
            for (let ray = 0; ray < RAYS_PER_FAN; ray += 1) {
                const spreadAt = (ray / (RAYS_PER_FAN - 1)) * 2 - 1;
                rays.set([fan, spreadAt + (random() - 0.5) * 0.1, random(), random()], (fan * RAYS_PER_FAN + ray) * 4);
            }
        }
        const made = quadGeometry(fanCount * RAYS_PER_FAN, { iRay: { array: rays, size: 4 } });
        const ray = attribute('iRay', 'vec4'); // fan, place in the fan (-1..1), two seeds
        const placeNode = uniformArray(fanPlace, 'vec4');
        const shapeNode = uniformArray(fanShape, 'vec4');
        const place = placeNode.element(int(ray.x.add(0.5)));
        const shape = shapeNode.element(int(ray.x.add(0.5))); // side, strength, lines, seed
        const elapsed = u.time.sub(place.w);
        const alive = step(0, elapsed).mul(step(elapsed, FAN_SECONDS));
        // A fan that is not burning collapses to nothing rather than being drawn clear.
        const age = clamp(elapsed, 0, FAN_SECONDS);
        const shoot = float(1).sub(exp(age.mul(-7.5))).mul(alive);
        const fade = exp(age.mul(-2.6)).mul(alive);
        const angle = ray.y.mul(shape.z.mul(0.07).add(0.42)).add(sin(age.mul(2.2).add(ray.z.mul(TAU))).mul(0.03));
        const heading = normalize(right.mul(shape.x.mul(cos(angle))).add(up.mul(sin(angle))).add(forward.mul(0.42)));
        const reach = shape.z.mul(4).add(17).mul(ray.w.mul(0.7).add(0.3)).mul(shoot);
        const root = place.xyz;
        const along = positionGeometry.x.add(0.5);
        const centre = root.add(heading.mul(along.mul(reach)));
        const sideways = normalize(cross(heading, cameraPosition.sub(centre)));
        const width = ray.z.pow2().mul(0.34).add(0.07).mul(shape.z.mul(0.1).add(1))
            .mul(along.mul(2.2).add(0.25));
        const world = centre.add(sideways.mul(positionGeometry.y.mul(width)));
        const material = additive('Crystal Cave — prismatic fan');
        material.side = THREE.DoubleSide;
        material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1)));
        const vFade = varying(fade.mul(shape.y));
        const vHue = varying(ray.y.mul(0.42).add(0.5).add(shape.w));
        const vGlint = varying(fract(age.mul(0.9).add(ray.w)));
        const local = uv();
        const body = exp(local.y.sub(0.5).mul(2).pow2().mul(-7));
        const taper = pow(float(1).sub(local.x), 1.3).mul(smoothstep(0, 0.04, local.x));
        const glint = exp(abs(local.x.sub(vGlint)).mul(-26)).mul(0.9);
        material.colorNode = mix(spectrum(vHue), vec3(1), 0.3).mul(1.7);
        material.opacityNode = body.mul(taper.add(glint.mul(taper.add(0.15)))).mul(vFade);
        const mesh = new THREE.Mesh(made.geometry, material);
        mesh.name = 'Crystal Cave — prismatic fans';
        mesh.frustumCulled = false;
        owned.push(mesh);
        group.add(mesh);
    }

    // ---- beams ------------------------------------------------------------------------
    const beamCount = Math.max(0, Math.floor(quality.beams ?? 0));
    const beamFrom = Array.from({ length: Math.max(1, beamCount) }, () => new THREE.Vector4(0, 0, 0, 0));
    const beamTo = Array.from({ length: Math.max(1, beamCount) }, () => new THREE.Vector4(0, 0, 0, 0));
    const beamTintA = Array.from({ length: Math.max(1, beamCount) }, () => new THREE.Color(0xffffff));
    const beamTintB = Array.from({ length: Math.max(1, beamCount) }, () => new THREE.Color(0xffffff));
    const beamLevel = new Float32Array(Math.max(1, beamCount));
    const beamTarget = new Float32Array(Math.max(1, beamCount));
    if (beamCount > 0) {
        const ids = Float32Array.from({ length: beamCount }, (_, index) => index);
        const made = quadGeometry(beamCount, { iBeam: { array: ids, size: 1 } });
        const id = attribute('iBeam', 'float');
        const from = uniformArray(beamFrom, 'vec4').element(int(id.add(0.5))); // xyz, level
        const to = uniformArray(beamTo, 'vec4').element(int(id.add(0.5))); // xyz, seed
        const tintA = uniformArray(beamTintA, 'color').element(int(id.add(0.5)));
        const tintB = uniformArray(beamTintB, 'color').element(int(id.add(0.5)));
        const along = positionGeometry.x.add(0.5);
        const centre = mix(from.xyz, to.xyz, along);
        const sideways = normalize(cross(to.xyz.sub(from.xyz), cameraPosition.sub(centre)));
        const width = from.w.mul(0.9).add(0.7).mul(step(0.002, from.w));
        const world = centre.add(sideways.mul(positionGeometry.y.mul(width)));
        const material = additive('Crystal Cave — lattice beam');
        material.side = THREE.DoubleSide;
        material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1)));
        const vLevel = varying(from.w);
        const vSeed = varying(to.w);
        const vTint = varying(mix(vec3(tintA), vec3(tintB), along));
        const vSpan = varying(length(to.xyz.sub(from.xyz)));
        const local = uv();
        const offAxis = local.y.sub(0.5).mul(2);
        const core = exp(offAxis.mul(offAxis).mul(-46));
        const halo = exp(offAxis.mul(offAxis).mul(-4.5)).mul(0.34);
        const packets = pow(sin(local.x.mul(vSpan).mul(0.55).sub(u.time.mul(9)).add(vSeed.mul(TAU))).mul(0.5).add(0.5), 5);
        const ends = smoothstep(0, 0.03, local.x).mul(smoothstep(1, 0.97, local.x));
        material.colorNode = mix(vTint, vec3(1), core.mul(0.55)).mul(packets.mul(1.8).add(1.6));
        material.opacityNode = core.mul(packets.mul(0.6).add(0.7)).add(halo.mul(packets.add(0.6))).mul(ends).mul(vLevel);
        const mesh = new THREE.Mesh(made.geometry, material);
        mesh.name = 'Crystal Cave — lattice beams';
        mesh.frustumCulled = false;
        owned.push(mesh);
        group.add(mesh);
    }

    let sparkCursor = 0;
    let fanCursor = 0;
    let onArrive = null;
    let onSplash = null;
    let disposed = false;

    /** Claim a free spark, or the one furthest through its life. */
    function claim() {
        if (sparkCount === 0) return null;
        let selected = sparkCursor % sparkCount;
        let furthest = -1;
        for (let offset = 0; offset < sparkCount; offset += 1) {
            const index = (sparkCursor + offset) % sparkCount;
            const spark = sparks[index];
            if (!spark.active) {
                selected = index;
                break;
            }
            // Motes in flight carry a pulse to deliver; never steal them.
            const progress = spark.kind === SPARK_KIND.homing ? -1 : spark.age / spark.life;
            if (progress > furthest) {
                furthest = progress;
                selected = index;
            }
        }
        sparkCursor = (selected + 1) % sparkCount;
        const spark = sparks[selected];
        spark.active = true;
        spark.age = 0;
        spark.star = 0;
        spark.payload = -1;
        spark.phase = 0;
        spark.shed = 0;
        return spark;
    }

    function writeSparks() {
        if (!sparkMesh) return 0;
        let live = 0;
        for (const spark of sparks) {
            if (!spark.active) continue;
            const progress = spark.age / spark.life;
            let alpha = spark.strength;
            let { size } = spark;
            let tailScale = 0.045;
            if (spark.kind === SPARK_KIND.homing) {
                alpha *= Math.min(1, progress * 8) * (0.7 + 0.3 * Math.sin(spark.age * 30 + spark.phase));
                tailScale = 0.07;
            } else if (spark.kind === SPARK_KIND.flare) {
                const swell = Math.sin(Math.min(1, progress * 3.2) * Math.PI * 0.5);
                alpha *= swell * (1 - progress) ** 1.6;
                size *= 0.4 + swell * 0.6;
                tailScale = 0;
            } else {
                alpha *= Math.min(1, progress * 10) * (1 - progress) ** 1.5
                    * (0.72 + 0.28 * Math.sin(spark.age * 17 + spark.phase));
                if (spark.kind === SPARK_KIND.fall) tailScale = 0.02;
            }
            sparkPlace.setXYZW(live, spark.position.x, spark.position.y, spark.position.z, size);
            sparkTrail.setXYZW(
                live,
                spark.velocity.x * tailScale,
                spark.velocity.y * tailScale,
                spark.velocity.z * tailScale,
                Math.max(0, alpha),
            );
            sparkTint.setXYZW(live, spark.tint.r, spark.tint.g, spark.tint.b, spark.star);
            live += 1;
        }
        // Always draw one (possibly invisible) spark so the pipeline exists before play.
        if (live === 0) {
            sparkPlace.setXYZW(0, 0, -1000, 0, 0);
            sparkTrail.setXYZW(0, 0, 0, 0, 0);
            sparkTint.setXYZW(0, 0, 0, 0, 0);
        }
        sparkMesh.geometry.instanceCount = Math.max(1, live);
        sparkPlace.needsUpdate = true;
        sparkTrail.needsUpdate = true;
        sparkTint.needsUpdate = true;
        return live;
    }

    const scratch = new THREE.Vector3();
    return {
        group,
        counts: { sparks: sparkCount, fans: fanCount, beams: beamCount },
        /** `arrive(payload, spark)` when a mote reaches its crystal; `splash(x, z, strength, tint)` at the pool. */
        setHandlers({ arrive = null, splash = null } = {}) {
            onArrive = arrive;
            onSplash = splash;
        },
        /** A mote that flies from `from` to `to` along a bowed path and delivers `payload`. */
        mote(from, to, seconds, tint, size, payload, bow) {
            const spark = claim();
            if (!spark) return false;
            spark.kind = SPARK_KIND.homing;
            spark.life = seconds;
            spark.size = size;
            spark.strength = 1;
            spark.payload = payload;
            spark.from.copy(from);
            spark.to.copy(to);
            spark.bend.copy(from).lerp(to, 0.45).add(bow);
            spark.position.copy(from);
            spark.velocity.set(0, 0, 0);
            spark.tint.copy(tint);
            spark.phase = payload * 1.7;
            return true;
        },
        /** A free spark: `gravity` > 0 falls, `drag` slows it. */
        spark(kind, origin, velocity, tint, {
            life = 1.2, size = 0.16, strength = 1, gravity = 2.4, drag = 1.1, star = 0, phase = 0,
        } = {}) {
            const spark = claim();
            if (!spark) return false;
            spark.kind = kind;
            spark.life = life;
            spark.size = size;
            spark.strength = strength;
            spark.gravity = gravity;
            spark.drag = drag;
            spark.star = star;
            spark.phase = phase;
            spark.position.copy(origin);
            spark.velocity.copy(velocity);
            spark.tint.copy(tint);
            return true;
        },
        /** Fire a prismatic fan from a point beside the board. */
        fan(origin, side, strength, lines, time, seed = 0) {
            if (fanCount === 0) return false;
            const index = fanCursor;
            fanCursor = (fanCursor + 1) % fanCount;
            fanPlace[index].set(origin.x, origin.y, origin.z, time);
            fanShape[index].set(side < 0 ? -1 : 1, strength, lines, seed);
            return true;
        },
        /** Aim a lattice beam; its brightness then follows `setBeamTarget`. */
        aimBeam(index, from, to, tintA, tintB, seed = 0) {
            if (!(index >= 0 && index < beamCount)) return false;
            beamFrom[index].set(from.x, from.y, from.z, beamLevel[index]);
            beamTo[index].set(to.x, to.y, to.z, seed);
            beamTintA[index].copy(tintA);
            beamTintB[index].copy(tintB);
            return true;
        },
        setBeamTarget(index, level) {
            if (index >= 0 && index < beamCount) beamTarget[index] = Math.max(0, Math.min(1, level));
        },
        beamLevelOf(index) {
            return index >= 0 && index < beamCount ? beamLevel[index] : 0;
        },
        update(dt) {
            if (disposed || !(dt > 0)) return writeSparks();
            for (const spark of sparks) {
                if (!spark.active) continue;
                spark.age += dt;
                if (spark.kind === SPARK_KIND.homing) {
                    const t = Math.min(1, spark.age / spark.life);
                    const eased = t * t * (3 - 2 * t);
                    const inverse = 1 - eased;
                    scratch.copy(spark.position);
                    spark.position.copy(spark.from).multiplyScalar(inverse * inverse)
                        .addScaledVector(spark.bend, 2 * inverse * eased)
                        .addScaledVector(spark.to, eased * eased);
                    spark.velocity.copy(spark.position).sub(scratch).divideScalar(dt);
                    // A mote sheds glitter as it flies: a comet, not a dot.
                    spark.shed += dt;
                    if (spark.shed >= 0.028 && t < 0.97) {
                        spark.shed = 0;
                        const dust = claim();
                        if (dust && dust !== spark) {
                            dust.kind = SPARK_KIND.burst;
                            dust.life = 0.42 + ((spark.age * 37) % 1) * 0.3;
                            dust.size = spark.size * 0.34;
                            dust.strength = 0.8;
                            dust.gravity = 1.6;
                            dust.drag = 2.4;
                            dust.phase = spark.age * 91;
                            dust.position.copy(spark.position);
                            dust.velocity.copy(spark.velocity).multiplyScalar(0.12);
                            dust.velocity.y += 0.6;
                            dust.tint.copy(spark.tint);
                        }
                    }
                    if (t >= 1) {
                        spark.active = false;
                        onArrive?.(spark.payload, spark);
                    }
                    continue;
                }
                if (spark.age >= spark.life) {
                    spark.active = false;
                    continue;
                }
                if (spark.kind === SPARK_KIND.flare) continue;
                const slow = Math.exp(-spark.drag * dt);
                spark.velocity.multiplyScalar(slow);
                spark.velocity.y -= spark.gravity * dt;
                if (spark.kind === SPARK_KIND.fall) {
                    spark.velocity.x += Math.sin(spark.age * 2.1 + spark.phase) * 0.9 * dt;
                    spark.velocity.z += Math.cos(spark.age * 1.7 + spark.phase) * 0.9 * dt;
                }
                spark.position.addScaledVector(spark.velocity, dt);
                if (spark.position.y < poolLevel) {
                    spark.active = false;
                    onSplash?.(spark.position.x, spark.position.z, spark.strength * spark.size, spark.tint);
                }
            }
            for (let index = 0; index < beamCount; index += 1) {
                const rate = beamTarget[index] > beamLevel[index] ? 7 : 1.6;
                beamLevel[index] += (beamTarget[index] - beamLevel[index]) * (1 - Math.exp(-rate * dt));
                if (beamLevel[index] < 0.002 && beamTarget[index] === 0) beamLevel[index] = 0;
                beamFrom[index].w = beamLevel[index];
            }
            return writeSparks();
        },
        activeSparks() {
            let live = 0;
            for (const spark of sparks) if (spark.active) live += 1;
            return live;
        },
        reset() {
            sparkCursor = 0;
            fanCursor = 0;
            for (const spark of sparks) spark.active = false;
            fanPlace.forEach((place) => place.set(0, 0, 0, -1000));
            beamLevel.fill(0);
            beamTarget.fill(0);
            beamFrom.forEach((from) => { from.w = 0; });
            writeSparks();
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            group.removeFromParent();
            owned.forEach((mesh) => {
                mesh.geometry.dispose();
                mesh.material.dispose();
            });
            group.clear();
        },
    };
}
