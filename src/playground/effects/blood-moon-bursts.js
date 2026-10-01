/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/** Three reusable showers: a luminous lunar shell, fast ejecta, and distant embers. */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cos, dot, exp, float, max, mix, normalize,
    positionGeometry, sin, smoothstep, step, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';

const SLOT_COUNT = 3;
const LIFETIME = 6.8;
const TAU = Math.PI * 2;

function createGeometry(count, random) {
    const geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(2, 2);
    geometry.index = quad.index.clone();
    geometry.setAttribute('position', quad.attributes.position.clone());
    geometry.setAttribute('uv', quad.attributes.uv.clone());
    quad.dispose();
    const flight = new Float32Array(count * 4);
    const scatter = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        const o = i * 4;
        // Stratification guarantees all emission angles, including at Minimal quality.
        flight[o] = ((i + random()) / count) * TAU;
        flight[o + 1] = random();
        flight[o + 2] = random();
        flight[o + 3] = random() * TAU;
        // A low-discrepancy screen field avoids clumps and covers all four corners.
        scatter[o] = (i * 0.754877666 + random() * 0.08) % 1;
        scatter[o + 1] = (i * 0.569840291 + random() * 0.08) % 1;
        scatter[o + 2] = random();
        // Interleave all populations so even low tiers retain a complete corona.
        const population = i % 10;
        scatter[o + 3] = Number(population >= 5) + Number(population >= 8);
    }
    geometry.setAttribute('aBurstFlight', new THREE.InstancedBufferAttribute(flight, 4));
    geometry.setAttribute('aBurstScatter', new THREE.InstancedBufferAttribute(scatter, 4));
    geometry.instanceCount = count;
    return geometry;
}

function createSlot(scene, geometry, shared, index) {
    const state = {
        age: LIFETIME,
        serial: -1,
        ageNode: uniform(LIFETIME),
        strength: uniform(0),
        origin: uniform(new THREE.Vector2()),
        radius: uniform(0),
        phase: uniform(0),
    };
    const flight = attribute('aBurstFlight', 'vec4');
    const scatter = attribute('aBurstScatter', 'vec4');
    const glitter = step(1.5, scatter.w);
    const fast = step(0.5, scatter.w).mul(float(1).sub(glitter));
    const delay = mix(scatter.z.mul(0.04), scatter.z.mul(0.36).add(0.065), glitter);
    const localAge = max(state.ageNode.sub(delay), 0);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
    });
    material.name = `blood-moon-fullscreen-burst-${index}`;
    material.vertexNode = Fn(() => {
        const age = localAge.toVar();
        const bend = sin(flight.w).mul(0.13);
        const angle = flight.x.add(state.phase).add(age.mul(bend)).toVar();
        const direction = vec2(cos(angle), sin(angle)).toVar();
        const tangent = vec2(direction.y.negate(), direction.x);
        // Half the embers form a dense, bright shell before peeling away. The
        // launch slows into orbiting embers instead of accelerating off-screen.
        // Fast ejecta still carry the bloom across the surrounding space.
        const settled = smoothstep(0.3, 1.8, age).toVar();
        const shellTime = age.div(age.mul(0.48).add(1)).toVar();
        const shellTravel = shellTime.mul(flight.y.mul(0.1).add(0.035))
            .add(shellTime.mul(shellTime).mul(0.032));
        const fastTravel = age.mul(flight.y.pow(1.5).mul(1.5).add(0.28))
            .div(age.mul(0.48).add(1));
        const travel = mix(shellTravel, fastTravel, fast);
        const launchRadius = state.radius.mul(flight.y.mul(0.13).add(1.035));
        // Bounded eddies use the existing per-particle phase. They build after
        // the initial flash and keep the fading cloud moving without a solver.
        const eddy = vec2(
            sin(age.mul(0.83).add(flight.w)).sub(sin(flight.w)),
            cos(age.mul(0.67).add(flight.w)).sub(cos(flight.w)),
        ).mul(settled).mul(flight.y.mul(0.012).add(0.018)).toVar();
        const ejecta = state.origin.add(direction.mul(launchRadius.add(travel))
            .add(tangent.mul(eddy.x)).add(direction.mul(eddy.y.mul(0.5)))
            .div(vec2(shared.aspect, 1)));
        const seedPosition = scatter.xy.add(vec2(state.phase.mul(0.137), state.phase.mul(0.219))).fract();
        const screenDirection = normalize(seedPosition.sub(state.origin).mul(vec2(shared.aspect, 1))
            .add(vec2(0.0001, 0.0002)));
        const drift = screenDirection.mul(shellTime.mul(flight.y.mul(0.024).add(0.008)))
            .add(vec2(screenDirection.y.negate(), screenDirection.x)
                .mul(eddy.x)).add(vec2(eddy.y.mul(0.45), eddy.y));
        const distant = seedPosition.add(drift.div(vec2(shared.aspect, 1)));
        const center = mix(ejecta, distant, glitter);
        const axis = normalize(mix(direction.add(tangent.mul(age.mul(bend))), screenDirection, glitter));
        const normal = vec2(axis.y.negate(), axis.x);
        // Round incandescent embers retain broad red halos. Only fast ejecta
        // stretch, and no sprite exceeds a 12 CSS-pixel radius.
        const shortRadius = mix(flight.z.mul(5.5).add(3.5), flight.z.mul(4).add(2.5), glitter)
            .mul(float(1).sub(settled.mul(0.16)));
        const longRadius = shortRadius.add(fast.mul(flight.z.mul(2).add(1)));
        const offset = axis.mul(positionGeometry.x.mul(longRadius))
            .add(normal.mul(positionGeometry.y.mul(shortRadius)));
        return vec4(center.mul(2).sub(1).add(offset.mul(2).div(shared.viewport)), 0.72, 1);
    })();
    material.colorNode = Fn(() => {
        const p = uv().sub(0.5).mul(2).toVar();
        const distanceSquared = dot(p, p).toVar();
        const core = exp(distanceSquared.mul(-68)).toVar();
        const ember = exp(distanceSquared.mul(-15));
        const halo = exp(distanceSquared.mul(-4.8))
            .mul(float(1).sub(smoothstep(0.65, 1, distanceSquared)));
        const appear = smoothstep(delay, delay.add(0.065), state.ageNode);
        const fade = appear.mul(exp(localAge.mul(mix(float(-0.42), float(-0.27), glitter))))
            .mul(float(1).sub(smoothstep(4.7, LIFETIME, state.ageNode)));
        const twinkle = sin(localAge.mul(8).add(flight.w)).mul(0.15).add(0.85);
        const crimson = mix(vec3(3.2, 0.003, 0.018), vec3(5, 0.025, 0.055), flight.z);
        const roseGlint = vec3(5.5, 2.3, 2.7).mul(core)
            .mul(mix(float(0.24), float(1.3), smoothstep(0.65, 0.95, flight.z)));
        return crimson.mul(ember.mul(0.68).add(halo.mul(0.34)))
            .add(roseGlint).mul(fade).mul(twinkle)
            .mul(state.strength);
    })();
    material.opacityNode = float(1);
    const object = new THREE.Mesh(geometry, material);
    object.name = `blood-moon-burst-${index}`;
    object.frustumCulled = false;
    object.renderOrder = 5;
    object.visible = false;
    object.matrixAutoUpdate = false;
    object.updateMatrix();
    scene.add(object);
    state.object = object;
    return state;
}

/**
 * Three fixed slots preserve overlapping clears without allocating particles or
 * materials in gameplay. Calls between updates merge into one strongest shower.
 * `objects` exposes the dormant meshes for the owner's compile/warmup lifecycle.
 */
export function createBloodMoonBursts({
    scene, shared, count, random = Math.random,
}) {
    const particleCount = Math.max(0, Math.floor(Number.isFinite(count) ? count : 240));
    const geometry = createGeometry(particleCount, random);
    const slots = Array.from({ length: SLOT_COUNT }, (_, i) => createSlot(scene, geometry, shared, i));
    const objects = slots.map((slot) => slot.object);
    const pendingOrigin = new THREE.Vector2();
    let pendingRadius = 0;
    let pendingStrength = 0;
    let serial = 0;
    let disposed = false;

    const trigger = (strength = 1) => {
        if (disposed || particleCount === 0 || !Number.isFinite(strength) || strength <= 0) return;
        const bounded = Math.min(1.5, strength);
        if (bounded >= pendingStrength) {
            pendingStrength = bounded;
            pendingOrigin.copy(shared.center.value);
            pendingRadius = shared.radius.value;
        }
    };
    const update = (dt = 0) => {
        if (disposed) return;
        if (pendingStrength > 0) {
            let slot = slots.find((candidate) => candidate.age >= LIFETIME);
            if (!slot) {
                slot = slots.reduce((oldest, candidate) => (candidate.serial < oldest.serial ? candidate : oldest));
            }
            slot.age = 0;
            slot.serial = serial++;
            slot.strength.value = pendingStrength;
            slot.origin.value.copy(pendingOrigin);
            slot.radius.value = pendingRadius;
            slot.phase.value = (slot.serial * 2.39996323) % TAU;
            slot.object.visible = true;
            pendingStrength = 0;
        }
        const delta = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        for (const slot of slots) {
            if (slot.age >= LIFETIME) continue;
            slot.age = Math.min(LIFETIME, slot.age + delta);
            slot.ageNode.value = slot.age;
            slot.object.visible = slot.age < LIFETIME;
        }
    };
    const reset = () => {
        pendingStrength = 0;
        serial = 0;
        for (const slot of slots) {
            slot.age = LIFETIME;
            slot.serial = -1;
            slot.ageNode.value = LIFETIME;
            slot.strength.value = 0;
            slot.object.visible = false;
        }
    };
    return {
        objects,
        trigger,
        update,
        reset,
        seek(age, strength = 1) {
            reset();
            trigger(strength);
            update(Number.isFinite(age) ? Math.max(0, age) : LIFETIME);
        },
        getDiagnostics() {
            const activeSlots = slots.filter((slot) => slot.age < LIFETIME).length;
            return {
                activeSlots,
                activeParticles: activeSlots * particleCount,
                particlesPerSlot: particleCount,
                capacity: SLOT_COUNT,
                lifetime: LIFETIME,
                pendingStrength,
                slots: slots.map((slot) => ({
                    age: slot.age,
                    strength: slot.strength.value,
                    serial: slot.serial,
                    origin: { x: slot.origin.value.x, y: slot.origin.value.y },
                })),
            };
        },
        dispose() {
            if (disposed) return;
            reset();
            disposed = true;
            for (const object of objects) {
                scene.remove(object);
                object.material.dispose();
            }
            geometry.dispose();
        },
    };
}
