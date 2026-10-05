/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/** Pooled cyberpunk reactions, proven in the isolated Neon District event playground. */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, atan, attribute, cos, exp, float, mix,
    positionGeometry, sin, smoothstep, uniform, uv, vec3,
} from 'three/tsl';

const TAU = Math.PI * 2;
const LOCK = 0;
const CLEAR = 1;
const COMBO = 2;
const DURATIONS = [0.9, 2.8, 3.7];
export const NEON_DISTRICT_EVENT_BUDGETS = Object.freeze({
    Minimal: Object.freeze({ slots: 1, particles: 20 }),
    Low: Object.freeze({ slots: 1, particles: 32 }),
    Medium: Object.freeze({ slots: 2, particles: 56 }),
    High: Object.freeze({ slots: 2, particles: 96 }),
    Ultra: Object.freeze({ slots: 3, particles: 128 }),
    Extreme: Object.freeze({ slots: 3, particles: 160 }),
});

function bounded(value, fallback, low, high) {
    return Math.min(high, Math.max(low, Number.isFinite(value) ? value : fallback));
}

function particleGeometry(count) {
    const geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geometry.index = quad.index.clone();
    geometry.setAttribute('position', quad.attributes.position.clone());
    geometry.setAttribute('uv', quad.attributes.uv.clone());
    quad.dispose();
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        const offset = i * 4;
        // Low-discrepancy fields retain both road edges even in Minimal quality.
        seed[offset] = (i * 0.754877666 + 0.17) % 1;
        seed[offset + 1] = (i * 0.569840291 + 0.31) % 1;
        seed[offset + 2] = (i * 0.438579021 + 0.43) % 1;
        seed[offset + 3] = i % 2 ? 1 : -1;
    }
    geometry.setAttribute('aDistrictFlight', new THREE.InstancedBufferAttribute(seed, 4));
    geometry.instanceCount = count;
    return geometry;
}

function additiveMaterial(name) {
    const material = new THREE.MeshBasicNodeMaterial({
        name,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        forceSinglePass: true,
    });
    return material;
}

function makeSlot(owner, kind, index) {
    const state = {
        kind,
        age: DURATIONS[kind],
        duration: DURATIONS[kind],
        serial: -1,
        progress: uniform(1),
        strength: uniform(0),
        tint: uniform(new THREE.Color()),
        group: new THREE.Group(),
        materials: [],
    };
    state.group.name = `neon-district-event-${kind}-${index}`;
    state.group.visible = false;
    const { motion } = owner;
    const fade = float(1).sub(smoothstep(0.12, 1, state.progress));
    const attack = smoothstep(0, 0.045, state.progress);
    const envelope = attack.mul(fade).mul(state.strength);

    const pavementMaterial = additiveMaterial(`${state.group.name}-pavement`);
    pavementMaterial.colorNode = state.tint.mul(1.55);
    pavementMaterial.opacityNode = Fn(() => {
        const p = uv().sub(0.5).mul(2);
        const radius = mix(float(0.3), state.progress.mul(0.66).add(0.08), motion);
        const rim = exp(abs(p.length().sub(radius)).mul(-86));
        const inner = exp(abs(p.length().sub(radius.sub(0.06))).mul(-42)).mul(0.15);
        return rim.add(inner).mul(envelope).mul(kind === LOCK ? 0.26 : 0.58);
    })();
    const pavement = new THREE.Mesh(owner.planeGeometry, pavementMaterial);
    pavement.name = `${state.group.name}-pavement`;
    pavement.rotation.x = -Math.PI / 2;
    pavement.position.set(0, owner.groundY + index * 0.02, owner.originZ);
    const groundRadius = owner.streetWidth * (kind === LOCK ? 0.52 : 1.35);
    pavement.scale.set(groundRadius, groundRadius, 1);
    state.group.add(pavement);
    state.materials.push(pavementMaterial);

    if (kind !== LOCK) {
        const wallMaterial = additiveMaterial(`${state.group.name}-canyon-scan`);
        wallMaterial.colorNode = state.tint.mul(1.75);
        wallMaterial.opacityNode = Fn(() => {
            const { y } = uv();
            const travel = mix(float(0.16), state.progress.mul(0.85), motion);
            const band = exp(abs(y.sub(travel)).mul(-72));
            const wake = exp(abs(y.sub(travel.sub(0.055))).mul(-26)).mul(0.12);
            const depthFade = float(1).sub(smoothstep(0.55, 1, abs(uv().x.sub(0.5)).mul(2)));
            const scan = sin(uv().x.mul(190)).mul(0.14).add(0.86);
            return band.add(wake).mul(depthFade).mul(scan).mul(envelope)
                .mul(0.24);
        })();
        // Actual instance matrices remain intact: these materials never override positionNode.
        const walls = new THREE.InstancedMesh(owner.planeGeometry, wallMaterial, 2);
        walls.name = `${state.group.name}-canyon-scan`;
        const transform = new THREE.Object3D();
        for (let side = 0; side < 2; side++) {
            transform.position.set(
                (side ? 1 : -1) * owner.streetWidth * 0.58,
                owner.groundY + owner.towerHeight * 0.5,
                owner.originZ - owner.streetWidth * 2.3,
            );
            transform.rotation.set(0, Math.PI / 2, 0);
            // The shared plane is two units wide: this is a 486-unit depth
            // at the authored tier, whose nearest edge stays behind z=-290.
            // Near-camera quads can cover signs and explode composite bloom.
            transform.scale.set(owner.streetWidth * 1.35, owner.towerHeight * 0.5, 1);
            transform.updateMatrix();
            walls.setMatrixAt(side, transform.matrix);
        }
        walls.instanceMatrix.needsUpdate = true;
        walls.frustumCulled = false;
        state.group.add(walls);
        state.materials.push(wallMaterial);

        const dataMaterial = additiveMaterial(`${state.group.name}-data-sparks`);
        const seed = attribute('aDistrictFlight', 'vec4');
        dataMaterial.positionNode = Fn(() => {
            const age = state.progress;
            const travel = age.mul(motion);
            const arc = seed.x.mul(TAU).add(travel.mul(kind === COMBO ? 5 : 1.4));
            const sideX = seed.w.mul(owner.streetWidth * 0.72)
                .add(sin(arc).mul(owner.streetWidth * 0.17).mul(travel));
            const climb = owner.groundY + 6;
            const y = float(climb).add(seed.y.mul(owner.towerHeight * 0.1))
                .add(travel.mul(seed.z.mul(0.55).add(0.18)).mul(owner.towerHeight * 0.67));
            const z = float(owner.originZ).sub(seed.x.mul(owner.streetWidth * 2.7))
                .add(cos(arc).mul(owner.streetWidth * 0.24).mul(travel));
            const height = seed.y.mul(3).add(1.5).add(travel.mul(7));
            return vec3(sideX, y, z).add(vec3(
                positionGeometry.x.mul(seed.z.mul(1.2).add(0.65)),
                positionGeometry.y.mul(height),
                0,
            ));
        })();
        dataMaterial.colorNode = mix(state.tint, vec3(1.8, 2.3, 2.5), seed.z.mul(0.55)).mul(1.65);
        dataMaterial.opacityNode = Fn(() => {
            const p = uv().sub(0.5).mul(2);
            const shape = exp(p.x.mul(p.x).mul(-8)).mul(float(1).sub(smoothstep(0.25, 1, abs(p.y))));
            const blink = sin(state.progress.mul(28).add(seed.x.mul(TAU))).mul(0.2).add(0.8);
            return shape.mul(envelope).mul(blink).mul(motion)
                .mul(0.72);
        })();
        const sparks = new THREE.Mesh(owner.particleGeometry, dataMaterial);
        sparks.name = `${state.group.name}-data-sparks`;
        sparks.frustumCulled = false;
        state.group.add(sparks);
        state.materials.push(dataMaterial);
        state.sparks = sparks;
    }

    if (kind === COMBO) {
        const orbitalMaterial = additiveMaterial(`${state.group.name}-holographic-orbit`);
        orbitalMaterial.colorNode = state.tint.mul(1.75);
        orbitalMaterial.opacityNode = Fn(() => {
            const p = uv().sub(0.5).mul(2);
            const angle = atan(p.y, p.x);
            const radius = mix(float(0.68), state.progress.mul(0.27).add(0.58), motion);
            const rim = exp(abs(p.length().sub(radius)).mul(-160));
            const tracks = exp(abs(p.length().sub(radius.mul(0.88))).mul(-160)).mul(0.34);
            const sector = angle.mul(3).add(state.progress.mul(-6).mul(motion));
            const segment = smoothstep(-0.3, 0.52, sin(sector));
            const etched = sin(angle.mul(90)).mul(0.16).add(0.84);
            return rim.add(tracks).mul(segment).mul(etched).mul(envelope)
                .mul(0.52);
        })();
        const orbit = new THREE.Mesh(owner.planeGeometry, orbitalMaterial);
        orbit.name = `${state.group.name}-holographic-orbit`;
        orbit.position.set(0, owner.towerHeight * 0.18, owner.originZ - owner.streetWidth * 1.3);
        const radius = owner.streetWidth * 1.38;
        orbit.scale.set(radius, radius, 1);
        state.group.add(orbit);
        state.materials.push(orbitalMaterial);
    }
    // MRT bloom must follow the procedural band/ring mask as well as the
    // visible color alpha. Unmasked emissive attachments paint whole quads.
    for (const material of state.materials) material.emissiveNode = material.colorNode.mul(material.opacityNode);
    owner.group.add(state.group);
    return state;
}

/**
 * Integration contract: attach once after city creation, call update(deltaSeconds)
 * once before rendering, and dispose before scene/renderer teardown. Events use
 * triggerLock(strength), triggerClear(lineCount), triggerCombo(comboCount). All
 * meshes/materials/typed arrays are allocated at construction; each event only
 * coalesces one number. `objects` is available for the owner's compile lifecycle.
 * `frame` is a reused light-response envelope (lock, clear, combo, pulse in 0..1).
 * Node materials and instanced attributes run identically on WebGPU and WebGL2.
 */
export class NeonDistrictEvents {
    constructor(scene, {
        quality = 'High', reducedMotion = false,
        streetWidth = 180, groundY = 0.25, originZ = -120, towerHeight = 1000,
    } = {}) {
        this.scene = scene;
        this.budget = NEON_DISTRICT_EVENT_BUDGETS[quality] || NEON_DISTRICT_EVENT_BUDGETS.High;
        this.streetWidth = bounded(streetWidth, 180, 10, 1000);
        this.groundY = bounded(groundY, 0.25, -1000, 1000);
        this.originZ = bounded(originZ, -120, -10000, 10000);
        this.towerHeight = bounded(towerHeight, 1000, 20, 5000);
        this.motion = uniform(reducedMotion ? 0 : 1);
        this.reducedMotion = Boolean(reducedMotion);
        this.group = new THREE.Group();
        this.group.name = 'neon-district-event-director';
        this.planeGeometry = new THREE.PlaneGeometry(2, 2);
        this.particleGeometry = particleGeometry(this.budget.particles);
        this.slots = [];
        this.pending = new Float32Array(3);
        this.frame = {
            lock: 0, clear: 0, combo: 0, pulse: 0,
        };
        this.serial = 0;
        this.disposed = false;
        for (let kind = LOCK; kind <= COMBO; kind++) {
            for (let index = 0; index < this.budget.slots; index++) {
                this.slots.push(makeSlot(this, kind, index));
            }
        }
        this.objects = [];
        this.group.traverse((object) => { if (object.isMesh) this.objects.push(object); });
        scene.add(this.group);
        this.setReducedMotion(reducedMotion);
    }

    triggerLock(strength = 1) {
        if (this.disposed || !Number.isFinite(strength) || strength <= 0) return;
        this.pending[LOCK] = Math.max(this.pending[LOCK], Math.min(1, strength) * 0.38);
    }

    triggerClear(lineCount = 1) {
        if (this.disposed || !Number.isFinite(lineCount) || lineCount <= 0) return;
        this.pending[CLEAR] = Math.max(this.pending[CLEAR], Math.min(1, 0.35 + lineCount * 0.16));
    }

    triggerCombo(comboCount = 2) {
        if (this.disposed || !Number.isFinite(comboCount) || comboCount <= 0) return;
        this.pending[COMBO] = Math.max(this.pending[COMBO], Math.min(1, 0.36 + Math.log2(comboCount + 1) * 0.18));
    }

    setReducedMotion(enabled) {
        if (this.disposed) return;
        this.reducedMotion = Boolean(enabled);
        this.motion.value = this.reducedMotion ? 0 : 1;
        for (const slot of this.slots) {
            if (slot.sparks) slot.sparks.visible = !this.reducedMotion;
        }
    }

    reset() {
        if (this.disposed) return;
        this.pending.fill(0);
        this.serial = 0;
        for (const slot of this.slots) {
            slot.age = slot.duration;
            slot.serial = -1;
            slot.progress.value = 1;
            slot.strength.value = 0;
            slot.group.visible = false;
        }
        this.frame.lock = 0;
        this.frame.clear = 0;
        this.frame.combo = 0;
        this.frame.pulse = 0;
    }

    /** Invoke only while the owner's render loop is paused during scene loading. */
    async prewarm(renderer, camera, targetScene = this.scene) {
        if (this.disposed || typeof renderer?.compileAsync !== 'function') return;
        // r186 compileAsync yields while building each object: preserve visibility
        // for the entire await, and never restore an object after its owner dies.
        const states = [];
        this.group.traverse((object) => {
            states.push({ object, visible: object.visible });
            object.visible = true;
        });
        try {
            await renderer.compileAsync(this.group, camera, targetScene);
        } finally {
            for (const state of states) {
                state.object.visible = this.disposed ? false : state.visible;
            }
            // Gameplay may resume, expire a cue, reset, or change its motion
            // preference while compileAsync yields. Slot age is the live
            // authority; a loading-time visibility snapshot is only temporary.
            for (const slot of this.slots) {
                slot.group.visible = !this.disposed && slot.age < slot.duration;
                if (slot.sparks) slot.sparks.visible = !this.disposed && !this.reducedMotion;
            }
        }
    }

    update(deltaSeconds = 0) {
        if (this.disposed) return;
        const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
        for (let kind = LOCK; kind <= COMBO; kind++) {
            if (this.pending[kind] <= 0) continue;
            let selected = null;
            for (const slot of this.slots) {
                if (slot.kind !== kind) continue;
                if (slot.age >= slot.duration) { selected = slot; break; }
                if (!selected || slot.serial < selected.serial) selected = slot;
            }
            selected.age = 0;
            selected.serial = this.serial++;
            selected.strength.value = this.pending[kind] * (this.reducedMotion ? 0.42 : 1);
            selected.tint.value.setRGB(
                kind === COMBO ? 1.55 : 0.1,
                kind === COMBO ? 0.18 : 1.55,
                kind === LOCK ? 1.7 : 1.45,
            );
            selected.group.visible = true;
            this.pending[kind] = 0;
        }
        this.frame.lock = 0;
        this.frame.clear = 0;
        this.frame.combo = 0;
        for (const slot of this.slots) {
            if (slot.age >= slot.duration) {
                slot.group.visible = false;
                continue;
            }
            slot.age = Math.min(slot.duration, slot.age + dt);
            const t = slot.age / slot.duration;
            slot.progress.value = t;
            slot.group.visible = t < 1;
            const value = slot.strength.value * Math.sin(Math.min(t * 8, Math.PI / 2)) * (1 - t) ** 2;
            if (slot.kind === LOCK) this.frame.lock = Math.max(this.frame.lock, value);
            else if (slot.kind === CLEAR) this.frame.clear = Math.max(this.frame.clear, value);
            else this.frame.combo = Math.max(this.frame.combo, value);
        }
        this.frame.pulse = Math.max(this.frame.lock, this.frame.clear, this.frame.combo);
    }

    getDiagnostics() {
        let activeSlots = 0;
        let activeDraws = 0;
        let activeParticles = 0;
        for (const slot of this.slots) {
            if (!slot.group.visible || slot.age >= slot.duration) continue;
            activeSlots++;
            for (const object of slot.group.children) {
                if (object.visible) activeDraws++;
            }
            if (slot.sparks?.visible) activeParticles += this.budget.particles;
        }
        return {
            activeSlots,
            activeDraws,
            activeParticles,
            slotCapacity: this.slots.length,
            particleCapacity: this.budget.particles * this.budget.slots * 2,
            reducedMotion: this.reducedMotion,
            disposed: this.disposed,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.group.visible = false;
        this.scene.remove(this.group);
        for (const object of this.objects) {
            object.visible = false;
            object.dispose();
        }
        for (const slot of this.slots) {
            slot.group.visible = false;
            for (const material of slot.materials) material.dispose();
        }
        this.planeGeometry.dispose();
        this.particleGeometry.dispose();
        this.pending.fill(0);
        this.frame.lock = 0;
        this.frame.clear = 0;
        this.frame.combo = 0;
        this.frame.pulse = 0;
    }
}
