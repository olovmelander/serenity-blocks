/**
 * Crystal resonance lives in the scenery, outside the quiet board corridor.
 * All GPU resources are created once; events rewrite fixed particle, ribbon and
 * water-ring pools. The owner supplies simulation seconds and owns rendering.
 */
import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    length,
    modelWorldMatrix,
    normalLocal,
    positionGeometry,
    sin,
    smoothstep,
    uniform,
    uv,
    vec3,
    vec4,
} from 'three/tsl';

const TAU = Math.PI * 2;
const POOL_Y = -6.95;
const ARC_SEGMENTS = 32;
const WAVE_DURATION = 2.5;
const WAVE_SPEED = 40;
const ENERGY_DECAY = 1.8;
const RESONANCE_DECAY = 0.85;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function count(value, maximum) {
    if (typeof value !== 'number' && typeof value !== 'string') return 0;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0
        ? Math.min(maximum, Math.floor(numeric)) : 0;
}

function capacity(value, fallback, maximum) {
    return value === 0 ? 0 : count(value, maximum) || fallback;
}

function dynamicAttribute(geometry, name, size, number) {
    const result = new THREE.InstancedBufferAttribute(new Float32Array(number * size), size);
    result.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, result);
    return result;
}

function glowMaterial() {
    return new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
    });
}

function makeParticleSlot(index) {
    return {
        index,
        active: false,
        age: 0,
        duration: 1,
        strength: 0,
        size: 0,
        phase: 0,
        spin: 0,
        origin: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        position: new THREE.Vector3(),
        tint: new THREE.Color(),
    };
}

export class CrystalCaveReactions {
    constructor({
        scene, anchors = [], quality = {}, uniforms = {},
    } = {}) {
        if (!scene?.add) throw new TypeError('CrystalCaveReactions requires a Three.js scene');
        this.scene = scene;
        this.uniforms = uniforms;
        this.uniforms.time ??= uniform(0);
        this.uniforms.energy ??= uniform(0);
        this.uniforms.resonance ??= uniform(0);
        this.uniforms.waveRadius ??= uniform(-100);
        this.uniforms.waveIntensity ??= uniform(0);
        this.uniforms.waveOrigin ??= uniform(new THREE.Vector3(0, -7, -8));
        this.maxParticles = capacity(quality.eventParticles, 140, 220);
        this.maxArcs = capacity(quality.maxArcs, 4, 7);
        this.maxRipples = capacity(quality.maxRipples, 4, 7);
        this.shardCapacity = Math.floor(this.maxParticles * 0.25);
        this.moteCapacity = this.maxParticles - this.shardCapacity;
        this.anchors = anchors.map((anchor) => {
            const position = anchor.position ?? anchor;
            if (![position.x, position.y, position.z].every(Number.isFinite)) return null;
            return {
                position: new THREE.Vector3(position.x, position.y, position.z),
                tint: new THREE.Color(anchor.color ?? anchor.tint ?? (position.x < 0 ? 0x87e7ef : 0xc695ff)),
            };
        }).filter((anchor) => anchor && Math.abs(anchor.position.x) >= 6);
        if (this.anchors.length === 0) {
            this.anchors.push(
                { position: new THREE.Vector3(-12, -2, -8), tint: new THREE.Color(0xa880ff) },
                { position: new THREE.Vector3(-17, 3, -14), tint: new THREE.Color(0x6fe3e7) },
                { position: new THREE.Vector3(12, 1, -9), tint: new THREE.Color(0x7aebdc) },
                { position: new THREE.Vector3(17, -1, -16), tint: new THREE.Color(0xf1b46e) },
            );
        }
        // Authoring groups each geode's tips together. Interleave the two walls
        // once so a first tetris or combo answers from both sides of the grotto.
        const leftAnchors = this.anchors.filter((anchor) => anchor.position.x < 0);
        const rightAnchors = this.anchors.filter((anchor) => anchor.position.x > 0);
        this.anchors.length = 0;
        for (let index = 0; index < Math.max(leftAnchors.length, rightAnchors.length); index++) {
            if (leftAnchors[index]) this.anchors.push(leftAnchors[index]);
            if (rightAnchors[index]) this.anchors.push(rightAnchors[index]);
        }
        this.palette = [0x74f0e5, 0xa99afa, 0xf0b771, 0xeb91cd].map((hex) => new THREE.Color(hex));
        this.group = new THREE.Group();
        this.group.name = 'crystal-cave-bounded-reactions';
        this.group.renderOrder = 5;
        scene.add(this.group);
        this.geometries = new Set();
        this.materials = new Set();
        this.tmpObject = new THREE.Object3D();
        this.hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
        this.shards = [];
        this.motes = [];
        this.arcs = [];
        this.ripples = [];
        this.createParticlePools();
        this.createRipplePool();
        this.createArcPool();
        this.reset();
    }

    createParticlePools() {
        if (this.shardCapacity > 0) {
            const geometry = new THREE.OctahedronGeometry(1, 0);
            geometry.scale(0.22, 0.85, 0.22);
            const alpha = dynamicAttribute(geometry, 'fxAlpha', 1, this.shardCapacity);
            const tint = dynamicAttribute(geometry, 'fxTint', 3, this.shardCapacity);
            const material = glowMaterial();
            material.colorNode = attribute('fxTint', 'vec3')
                .mul(abs(normalLocal.x).mul(0.75).add(abs(normalLocal.z).mul(0.35)).add(1.35));
            material.opacityNode = attribute('fxAlpha', 'float');
            this.shardMesh = new THREE.InstancedMesh(geometry, material, this.shardCapacity);
            this.shardMesh.name = 'crystal-cave-prismatic-shards';
            this.shardMesh.frustumCulled = false;
            this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.shardAlpha = alpha;
            this.shardTint = tint;
            this.shards = Array.from({ length: this.shardCapacity }, (_, index) => makeParticleSlot(index));
            this.geometries.add(geometry);
            this.materials.add(material);
            this.group.add(this.shardMesh);
        }
        if (this.moteCapacity > 0) {
            const geometry = new THREE.PlaneGeometry(1, 1);
            this.motePosition = dynamicAttribute(geometry, 'fxPosition', 3, this.moteCapacity);
            this.moteSize = dynamicAttribute(geometry, 'fxSize', 1, this.moteCapacity);
            this.moteAlpha = dynamicAttribute(geometry, 'fxAlpha', 1, this.moteCapacity);
            this.moteTint = dynamicAttribute(geometry, 'fxTint', 3, this.moteCapacity);
            const material = glowMaterial();
            // Explicit view-space quad expansion avoids pointCoord and preserves
            // the same UV star shape on WebGPU and the WebGL2 node backend.
            const center = cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(attribute('fxPosition', 'vec3'), 1)));
            const quad = vec3(positionGeometry.xy.mul(attribute('fxSize', 'float')), 0);
            material.vertexNode = cameraProjectionMatrix.mul(vec4(center.xyz.add(quad), 1));
            const local = uv().sub(0.5);
            const core = smoothstep(0.035, 0.21, length(local)).oneMinus().pow(2);
            const horizontal = smoothstep(0.008, 0.045, abs(local.y)).oneMinus()
                .mul(smoothstep(0.06, 0.45, abs(local.x)).oneMinus());
            const vertical = smoothstep(0.008, 0.045, abs(local.x)).oneMinus()
                .mul(smoothstep(0.06, 0.45, abs(local.y)).oneMinus());
            const petals = horizontal.add(vertical).mul(0.25).add(core).clamp(0, 1);
            material.colorNode = attribute('fxTint', 'vec3').mul(2.8);
            material.opacityNode = petals.mul(attribute('fxAlpha', 'float'));
            this.moteMesh = new THREE.InstancedMesh(geometry, material, this.moteCapacity);
            this.moteMesh.name = 'crystal-cave-chime-motes';
            this.moteMesh.frustumCulled = false;
            this.motes = Array.from({ length: this.moteCapacity }, (_, index) => makeParticleSlot(index));
            this.geometries.add(geometry);
            this.materials.add(material);
            this.group.add(this.moteMesh);
        }
    }

    createRipplePool() {
        if (this.maxRipples === 0) return;
        const geometry = new THREE.PlaneGeometry(2, 2);
        this.geometries.add(geometry);
        const radius = length(uv().mul(2).sub(1));
        const ring = smoothstep(0.022, 0.063, abs(radius.sub(0.82))).oneMinus();
        const echo = smoothstep(0.014, 0.045, abs(radius.sub(0.63))).oneMinus().mul(0.28);
        for (let index = 0; index < this.maxRipples; index++) {
            const opacity = uniform(0);
            const tint = uniform(new THREE.Color());
            const material = glowMaterial();
            material.colorNode = tint.mul(1.8);
            material.opacityNode = ring.add(echo).mul(opacity);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `crystal-cave-water-echo-${index}`;
            mesh.rotation.x = -Math.PI / 2;
            mesh.visible = false;
            this.ripples.push({
                mesh, opacity, tint, active: false, age: 0, duration: 1, strength: 0, growth: 1,
            });
            this.materials.add(material);
            this.group.add(mesh);
        }
    }

    createArcPool() {
        for (let index = 0; index < this.maxArcs; index++) {
            const geometry = new THREE.BufferGeometry();
            const positions = new THREE.BufferAttribute(new Float32Array((ARC_SEGMENTS + 1) * 6), 3);
            positions.setUsage(THREE.DynamicDrawUsage);
            geometry.setAttribute('position', positions);
            const coords = new Float32Array((ARC_SEGMENTS + 1) * 4);
            const indices = [];
            for (let step = 0; step <= ARC_SEGMENTS; step++) {
                coords.set([step / ARC_SEGMENTS, 0, step / ARC_SEGMENTS, 1], step * 4);
                if (step < ARC_SEGMENTS) {
                    const first = step * 2;
                    indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
                }
            }
            geometry.setAttribute('uv', new THREE.BufferAttribute(coords, 2));
            geometry.setIndex(indices);
            const opacity = uniform(0);
            const tint = uniform(new THREE.Color());
            const material = glowMaterial();
            const filament = smoothstep(0.07, 0.49, abs(uv().y.sub(0.5))).oneMinus();
            const chimes = sin(uv().x.mul(24).sub(this.uniforms.time.mul(7))).mul(0.5).add(0.5).pow(10);
            material.colorNode = tint.mul(chimes.mul(3.0).add(1.0));
            material.opacityNode = filament.mul(opacity).mul(uv().x.mul(Math.PI).sin().mul(0.7).add(0.3));
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `crystal-cave-resonance-filament-${index}`;
            mesh.frustumCulled = false;
            mesh.visible = false;
            this.arcs.push({
                mesh, positions, opacity, tint, active: false, age: 0, duration: 1, strength: 0,
            });
            this.geometries.add(geometry);
            this.materials.add(material);
            this.group.add(mesh);
        }
    }

    random() {
        this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
        return this.seed / 4294967296;
    }

    acquire(slots, cursorKey) {
        if (slots.length === 0) return null;
        let selected = this[cursorKey] % slots.length;
        let progress = -1;
        for (let offset = 0; offset < slots.length; offset++) {
            const candidate = (this[cursorKey] + offset) % slots.length;
            const slot = slots[candidate];
            if (!slot.active) {
                selected = candidate;
                break;
            }
            if (slot.age / slot.duration > progress) {
                progress = slot.age / slot.duration;
                selected = candidate;
            }
        }
        this[cursorKey] = (selected + 1) % slots.length;
        return slots[selected];
    }

    nextAnchor() {
        const anchor = this.anchors[this.anchorCursor % this.anchors.length];
        this.anchorCursor += 1;
        return anchor;
    }

    excite(energy, resonance) {
        this.uniforms.energy.value = Math.max(this.uniforms.energy.value, clamp(energy, 0, 1));
        this.uniforms.resonance.value = Math.max(this.uniforms.resonance.value, clamp(resonance, 0, 1));
    }

    startWave(strength, anchor) {
        if (this.waveActive) {
            this.pendingWave = Math.max(this.pendingWave, strength);
            return;
        }
        this.waveActive = true;
        this.waveAge = 0;
        this.waveStrength = clamp(strength, 0, 1);
        this.uniforms.waveOrigin.value.copy(anchor.position);
        this.uniforms.waveRadius.value = 0;
        this.uniforms.waveIntensity.value = this.waveStrength;
    }

    emitParticles(anchor, number, strength, large) {
        for (let index = 0; index < Math.min(number, this.maxParticles); index++) {
            const shard = large && index % 4 === 0;
            const slot = this.acquire(shard ? this.shards : this.motes, shard ? 'shardCursor' : 'moteCursor');
            if (!slot) continue;
            const angle = this.random() * TAU;
            const drift = 0.3 + this.random() * (large ? 2.6 : 0.7);
            slot.active = true;
            slot.age = 0;
            slot.duration = shard ? 2.4 + this.random() * 1.2 : 1.3 + this.random() * 1.9;
            slot.strength = strength;
            slot.phase = this.random() * TAU;
            slot.spin = (this.random() - 0.5) * 2.4;
            slot.size = 0.12 + this.random() * (large ? 0.29 : 0.09);
            slot.origin.copy(anchor.position);
            slot.origin.x += Math.cos(angle) * 0.45;
            slot.origin.y += (this.random() - 0.5) * 0.8;
            slot.velocity.set(
                Math.cos(angle) * drift,
                0.9 + this.random() * (large ? 2.4 : 0.7),
                Math.sin(angle) * drift * 0.5,
            );
            slot.tint.copy(this.palette[(index + this.anchorCursor) % this.palette.length]);
            slot.tint.lerp(anchor.tint, 0.32);
        }
    }

    emitRipple(anchor, strength, tiny = false) {
        const slot = this.acquire(this.ripples, 'rippleCursor');
        if (!slot) return;
        slot.active = true;
        slot.age = 0;
        slot.duration = tiny ? 1.2 : 3.2;
        slot.strength = strength;
        slot.growth = tiny ? 1.3 : 6.0;
        slot.tint.value.copy(anchor.tint).lerp(this.palette[0], 0.35);
        const waterX = Math.sign(anchor.position.x) * clamp(Math.abs(anchor.position.x) * 0.35, 5.8, 7.8);
        slot.mesh.position.set(waterX, POOL_Y, Math.min(-5, anchor.position.z));
        slot.mesh.visible = true;
    }

    emitArc(first, second, strength) {
        const slot = this.acquire(this.arcs, 'arcCursor');
        if (!slot) return;
        slot.active = true;
        slot.age = 0;
        slot.duration = 2.8;
        slot.strength = strength;
        slot.tint.value.copy(first.tint).lerp(second.tint, 0.5);
        slot.mesh.visible = true;
        const start = first.position;
        const end = second.position;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const dz = end.z - start.z;
        const side = Math.sign(start.x);
        const bulgeX = side * (1.6 + Math.abs(dx) * 0.12);
        const bulgeY = 1.3 + start.distanceTo(end) * 0.09;
        const width = 0.028 + strength * 0.035;
        for (let step = 0; step <= ARC_SEGMENTS; step++) {
            const fraction = step / ARC_SEGMENTS;
            const arch = Math.sin(fraction * Math.PI);
            const tangentX = dx + Math.cos(fraction * Math.PI) * Math.PI * bulgeX;
            const tangentY = dy + Math.cos(fraction * Math.PI) * Math.PI * bulgeY;
            const tangentLength = Math.hypot(tangentX, tangentY) || 1;
            const normalX = (-tangentY / tangentLength) * width;
            const normalY = (tangentX / tangentLength) * width;
            const x = start.x + dx * fraction + arch * bulgeX;
            const y = start.y + dy * fraction + arch * bulgeY;
            const z = start.z + dz * fraction - arch * 1.2;
            slot.positions.setXYZ(step * 2, x - normalX, y - normalY, z);
            slot.positions.setXYZ(step * 2 + 1, x + normalX, y + normalY, z);
        }
        slot.positions.needsUpdate = true;
    }

    pieceLock() {
        if (this.disposed) return false;
        const anchor = this.nextAnchor();
        this.excite(0.05, 0.035);
        this.emitParticles(anchor, 4, 0.38, false);
        this.emitRipple(anchor, 0.08, true);
        this.refreshParticles();
        return true;
    }

    lineClear(value = 1) {
        const lines = count(value, 4);
        if (this.disposed || lines === 0) return false;
        const anchor = this.nextAnchor();
        const strength = 0.24 + lines * 0.15;
        this.excite(0.16 + lines * 0.14, 0.12 + lines * 0.16);
        this.startWave(strength, anchor);
        this.emitParticles(anchor, 9 + lines * 8, 0.46 + lines * 0.1, lines >= 3);
        this.emitRipple(anchor, strength * 0.65);
        if (lines === 4) {
            const echoAnchor = this.nextAnchor();
            this.emitParticles(echoAnchor, 24, 0.64, true);
            this.emitRipple(echoAnchor, 0.4);
        }
        this.refreshParticles();
        return true;
    }

    combo(value) {
        const combos = count(value, 60);
        if (this.disposed || combos < 2) return false;
        const growth = 1 - Math.exp(-(combos - 1) * 0.18);
        const strength = 0.35 + growth * 0.55;
        this.excite(0.22 + growth * 0.62, 0.3 + growth * 0.65);
        const first = this.nextAnchor();
        this.startWave(strength, first);
        const connectionCount = Math.min(this.maxArcs, 1 + Math.floor(growth * 4));
        for (let index = 0; index < connectionCount; index++) {
            const anchor = this.nextAnchor();
            let second = null;
            // Connections remain on the outer walls instead of drawing bright
            // filaments across the board. No per-event filtered arrays needed.
            for (let offset = 1; offset < this.anchors.length; offset++) {
                const candidate = this.anchors[(this.anchorCursor - 1 + offset) % this.anchors.length];
                if (Math.sign(candidate.position.x) === Math.sign(anchor.position.x)) {
                    second = candidate;
                    break;
                }
            }
            if (second) this.emitArc(anchor, second, strength);
            this.emitParticles(anchor, 13 + Math.floor(growth * 12), strength, true);
            if (index < 2) this.emitRipple(anchor, strength * 0.55);
        }
        this.refreshParticles();
        return true;
    }

    refreshParticles() {
        for (const slots of [this.shards, this.motes]) {
            const shard = slots === this.shards;
            for (const slot of slots) {
                const { index } = slot;
                if (!slot.active) {
                    if (shard) {
                        this.shardMesh.setMatrixAt(index, this.hiddenMatrix);
                        this.shardAlpha.setX(index, 0);
                    } else {
                        this.moteSize.setX(index, 0);
                        this.moteAlpha.setX(index, 0);
                    }
                    continue;
                }
                const { age } = slot;
                const progress = age / slot.duration;
                const drift = 1 - Math.exp(-age * 0.85);
                slot.position.copy(slot.origin).addScaledVector(slot.velocity, drift / 0.85);
                slot.position.y += Math.sin(age * 2 + slot.phase) * Math.min(age, 0.6) * 0.24;
                // The board corridor is always quiet even as fragments drift.
                slot.position.x = Math.sign(slot.origin.x) * Math.max(6, Math.abs(slot.position.x));
                const fade = (1 - progress) ** 1.45;
                if (shard) {
                    this.tmpObject.position.copy(slot.position);
                    this.tmpObject.rotation.set(slot.phase + age * slot.spin, age * slot.spin * 0.6, slot.phase * 0.3);
                    this.tmpObject.scale.setScalar(slot.size * (0.65 + fade * 0.35));
                    this.tmpObject.updateMatrix();
                    this.shardMesh.setMatrixAt(index, this.tmpObject.matrix);
                    this.shardAlpha.setX(index, fade * slot.strength * 0.74);
                    this.shardTint.setXYZ(index, slot.tint.r, slot.tint.g, slot.tint.b);
                } else {
                    this.motePosition.setXYZ(index, slot.position.x, slot.position.y, slot.position.z);
                    this.moteSize.setX(index, slot.size * (0.8 + fade * 0.8));
                    this.moteAlpha.setX(index, fade * slot.strength * (0.7 + Math.sin(age * 7 + slot.phase) * 0.14));
                    this.moteTint.setXYZ(index, slot.tint.r, slot.tint.g, slot.tint.b);
                }
            }
        }
        if (this.shardMesh) {
            this.shardMesh.instanceMatrix.needsUpdate = true;
            this.shardAlpha.needsUpdate = true;
            this.shardTint.needsUpdate = true;
        }
        if (this.moteMesh) {
            this.motePosition.needsUpdate = true;
            this.moteSize.needsUpdate = true;
            this.moteAlpha.needsUpdate = true;
            this.moteTint.needsUpdate = true;
        }
    }

    update(dt, time) {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
        this.time += dt;
        this.uniforms.time.value = Number.isFinite(time) ? time : this.time;
        this.uniforms.energy.value *= Math.exp(-ENERGY_DECAY * dt);
        this.uniforms.resonance.value *= Math.exp(-RESONANCE_DECAY * dt);
        if (this.waveActive) {
            this.waveAge += dt;
            if (this.waveAge >= WAVE_DURATION) {
                if (this.pendingWave > 0) {
                    this.waveAge -= WAVE_DURATION;
                    this.waveStrength = this.pendingWave;
                    this.pendingWave = 0;
                } else {
                    this.waveActive = false;
                }
                if (this.waveAge >= WAVE_DURATION) this.waveActive = false;
            }
            this.uniforms.waveRadius.value = this.waveActive ? this.waveAge * WAVE_SPEED : -100;
            const tail = 1 - THREE.MathUtils.smoothstep(this.waveAge / WAVE_DURATION, 0.55, 1);
            this.uniforms.waveIntensity.value = this.waveActive ? this.waveStrength * tail : 0;
        }
        for (const slots of [this.shards, this.motes, this.arcs, this.ripples]) {
            for (const slot of slots) {
                if (!slot.active) continue;
                slot.age += dt;
                if (slot.age >= slot.duration) {
                    slot.active = false;
                    if (slot.mesh) slot.mesh.visible = false;
                    if (slot.opacity) slot.opacity.value = 0;
                }
            }
        }
        for (const slot of this.ripples) {
            if (!slot.active) continue;
            const progress = slot.age / slot.duration;
            const radius = 0.24 + progress * slot.growth;
            slot.mesh.scale.set(radius, radius, 1);
            slot.opacity.value = Math.sin(Math.min(progress * 3, 1) * Math.PI * 0.5)
                * (1 - progress) ** 1.8 * slot.strength;
        }
        for (const slot of this.arcs) {
            if (!slot.active) continue;
            const progress = slot.age / slot.duration;
            slot.opacity.value = Math.sin(Math.min(progress * 5, 1) * Math.PI * 0.5)
                * (1 - progress) ** 1.3 * slot.strength * 0.7;
        }
        this.refreshParticles();
    }

    reset() {
        if (this.disposed) return;
        this.time = 0;
        this.seed = 187311;
        this.anchorCursor = 0;
        this.shardCursor = 0;
        this.moteCursor = 0;
        this.arcCursor = 0;
        this.rippleCursor = 0;
        this.waveActive = false;
        this.waveAge = 0;
        this.waveStrength = 0;
        this.pendingWave = 0;
        this.uniforms.time.value = 0;
        this.uniforms.energy.value = 0;
        this.uniforms.resonance.value = 0;
        this.uniforms.waveRadius.value = -100;
        this.uniforms.waveIntensity.value = 0;
        for (const slots of [this.shards, this.motes, this.arcs, this.ripples]) {
            for (const slot of slots) {
                slot.active = false;
                slot.age = 0;
                if (slot.mesh) slot.mesh.visible = false;
                if (slot.opacity) slot.opacity.value = 0;
            }
        }
        this.refreshParticles();
    }

    get debug() {
        return {
            particles: this.maxParticles,
            arcs: this.maxArcs,
            ripples: this.maxRipples,
            geometries: this.geometries.size,
            materials: this.materials.size,
            activeShards: this.shards.filter((slot) => slot.active).length,
            activeMotes: this.motes.filter((slot) => slot.active).length,
            activeArcs: this.arcs.filter((slot) => slot.active).length,
            activeRipples: this.ripples.filter((slot) => slot.active).length,
            pendingWave: this.pendingWave,
            disposed: Boolean(this.disposed),
        };
    }

    dispose() {
        if (this.disposed) return;
        this.reset();
        this.disposed = true;
        this.group.removeFromParent();
        for (const object of this.group.children) object.dispose();
        for (const geometry of this.geometries) geometry.dispose();
        for (const material of this.materials) material.dispose();
        this.group.clear();
        this.geometries.clear();
        this.materials.clear();
    }
}
