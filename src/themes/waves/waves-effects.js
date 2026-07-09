/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ WAVES EFFECTS ✧
 *  Effect pools for lock / line-clear / combo feedback in the surf-barrel theme.
 *
 *  Every pool uses idle-slot-first cycling (same approach as the Blood Moon
 *  blood-spark pool) so overlapping bursts never stomp still-active particles.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import {
    RippleRingShader,
    DropletBurstShader,
    BubbleStreamShader,
    GodRayShader,
    PlanktonStreakShader,
    FoamCurtainShader,
} from './waves-shaders.js';

// ─────────────────────────────────────────────────────────────────────────────
// Ripple Ring Pool — expanding foam disc on the barrel wall
// ─────────────────────────────────────────────────────────────────────────────
export class RippleRingPool {
    constructor(scene, poolSize) {
        this.scene = scene;
        this.slots = [];

        for (let i = 0; i < poolSize; i++) {
            const geometry = new THREE.PlaneGeometry(1, 1);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uAge: { value: 1.0 },
                    uStrength: { value: 0.0 },
                    uInnerColor: { value: new THREE.Color(0xddffff) },
                    uOuterColor: { value: new THREE.Color(0x44ddcc) },
                },
                vertexShader: RippleRingShader.vertexShader,
                fragmentShader: RippleRingShader.fragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.visible = false;
            mesh.frustumCulled = false;
            scene.add(mesh);

            this.slots.push({
                mesh,
                material,
                active: false,
                age: 0,
                duration: 0,
                strength: 0,
            });
        }
    }

    trigger(origin, wallNormal, strength = 1.0, maxRadius = 4.0, duration = 0.6) {
        const slot = this.slots.find((s) => !s.active) || this.slots[0];
        slot.active = true;
        slot.age = 0;
        slot.duration = duration;
        slot.strength = strength;
        slot.mesh.visible = true;

        // Scale the ring mesh to maxRadius
        slot.mesh.scale.set(maxRadius * 2, maxRadius * 2, 1);
        slot.mesh.position.copy(origin);

        // Orient the ring tangent to the wall (normal faces inward to camera)
        const target = new THREE.Vector3().copy(origin).add(wallNormal);
        slot.mesh.lookAt(target);

        slot.material.uniforms.uAge.value = 0;
        slot.material.uniforms.uStrength.value = strength;
    }

    update(delta) {
        for (const slot of this.slots) {
            if (!slot.active) continue;
            slot.age += delta;
            const t = slot.age / slot.duration;
            if (t >= 1.0) {
                slot.active = false;
                slot.mesh.visible = false;
                slot.material.uniforms.uStrength.value = 0;
                continue;
            }
            slot.material.uniforms.uAge.value = t;
        }
    }

    dispose() {
        for (const slot of this.slots) {
            this.scene.remove(slot.mesh);
            slot.mesh.geometry.dispose();
            slot.material.dispose();
        }
        this.slots = [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Droplet Burst Pool — splash particles ejected from an impact point
// ─────────────────────────────────────────────────────────────────────────────
export class DropletBurstPool {
    constructor(scene, poolSize, particlesPerBurst) {
        this.scene = scene;
        this.slots = [];
        this.particlesPerBurst = particlesPerBurst;

        for (let i = 0; i < poolSize; i++) {
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(particlesPerBurst * 3);
            const velocities = new Float32Array(particlesPerBurst * 3);
            const randoms = new Float32Array(particlesPerBurst);

            for (let j = 0; j < particlesPerBurst; j++) {
                randoms[j] = Math.random();
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
            geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uAge: { value: 1.0 },
                    uStrength: { value: 0.0 },
                    uGravity: { value: new THREE.Vector3(0, 0, 0) },
                    uSize: { value: 8.0 },
                    uColor: { value: new THREE.Color(0xddffff) },
                },
                vertexShader: DropletBurstShader.vertexShader,
                fragmentShader: DropletBurstShader.fragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            const points = new THREE.Points(geometry, material);
            points.visible = false;
            points.frustumCulled = false;
            scene.add(points);

            this.slots.push({
                points,
                geometry,
                material,
                active: false,
                age: 0,
                duration: 0,
            });
        }
    }

    /**
     * @param {THREE.Vector3} origin  — impact point
     * @param {THREE.Vector3} wallNormal — normalised inward direction
     * @param {object} opts — { strength, size, duration, speed }
     */
    trigger(origin, wallNormal, opts = {}) {
        const strength = opts.strength ?? 1.0;
        const size = opts.size ?? 8.0;
        const duration = opts.duration ?? 0.8;
        const speed = opts.speed ?? 6.0;

        const slot = this.slots.find((s) => !s.active) || this.slots[0];
        slot.active = true;
        slot.age = 0;
        slot.duration = duration;
        slot.points.visible = true;

        // Regenerate velocities: launched inward + tangential + upward splash
        const pos = slot.geometry.attributes.position.array;
        const vel = slot.geometry.attributes.aVelocity.array;

        // Build tangent basis from wallNormal
        const up = Math.abs(wallNormal.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
        const tangent1 = new THREE.Vector3().crossVectors(wallNormal, up).normalize();
        const tangent2 = new THREE.Vector3().crossVectors(wallNormal, tangent1).normalize();

        for (let i = 0; i < this.particlesPerBurst; i++) {
            const i3 = i * 3;
            pos[i3] = origin.x;
            pos[i3 + 1] = origin.y;
            pos[i3 + 2] = origin.z;

            // Cone spread around wallNormal
            const spread1 = (Math.random() - 0.5) * 1.4;
            const spread2 = (Math.random() - 0.5) * 1.4;
            const forward = 0.6 + Math.random() * 0.7;
            const magnitude = speed * (0.6 + Math.random() * 0.7);

            const vx = wallNormal.x * forward + tangent1.x * spread1 + tangent2.x * spread2;
            const vy = wallNormal.y * forward + tangent1.y * spread1 + tangent2.y * spread2 + 0.4; // upward kick
            const vz = wallNormal.z * forward + tangent1.z * spread1 + tangent2.z * spread2;

            vel[i3] = vx * magnitude;
            vel[i3 + 1] = vy * magnitude;
            vel[i3 + 2] = vz * magnitude;
        }
        slot.geometry.attributes.position.needsUpdate = true;
        slot.geometry.attributes.aVelocity.needsUpdate = true;

        // Gravity pulls droplets back along the wall's inward normal (so they "stick")
        slot.material.uniforms.uGravity.value.copy(wallNormal).multiplyScalar(-4.0 * speed);
        slot.material.uniforms.uStrength.value = strength;
        slot.material.uniforms.uSize.value = size;
        slot.material.uniforms.uAge.value = 0;
    }

    update(delta) {
        for (const slot of this.slots) {
            if (!slot.active) continue;
            slot.age += delta;
            const t = slot.age / slot.duration;
            if (t >= 1.0) {
                slot.active = false;
                slot.points.visible = false;
                slot.material.uniforms.uStrength.value = 0;
                continue;
            }
            slot.material.uniforms.uAge.value = t;
        }
    }

    dispose() {
        for (const slot of this.slots) {
            this.scene.remove(slot.points);
            slot.geometry.dispose();
            slot.material.dispose();
        }
        this.slots = [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bubble Stream Pool — small rising bubbles (optional flavour for lock)
// ─────────────────────────────────────────────────────────────────────────────
export class BubbleStreamPool {
    constructor(scene, poolSize, bubblesPerStream) {
        this.scene = scene;
        this.slots = [];

        for (let i = 0; i < poolSize; i++) {
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(bubblesPerStream * 3);
            const seeds = new Float32Array(bubblesPerStream);
            const drifts = new Float32Array(bubblesPerStream * 3);
            for (let j = 0; j < bubblesPerStream; j++) {
                seeds[j] = j / bubblesPerStream;
            }
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
            geometry.setAttribute('aDrift', new THREE.BufferAttribute(drifts, 3));

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uAge: { value: 1.0 },
                    uStrength: { value: 0.0 },
                    uOrigin: { value: new THREE.Vector3() },
                },
                vertexShader: BubbleStreamShader.vertexShader,
                fragmentShader: BubbleStreamShader.fragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.NormalBlending,
            });

            const points = new THREE.Points(geometry, material);
            points.visible = false;
            points.frustumCulled = false;
            scene.add(points);

            this.slots.push({
                points, geometry, material, active: false, age: 0, duration: 0,
            });
        }
    }

    trigger(origin, wallNormal, opts = {}) {
        const strength = opts.strength ?? 0.8;
        const duration = opts.duration ?? 1.5;
        const slot = this.slots.find((s) => !s.active) || this.slots[0];
        slot.active = true;
        slot.age = 0;
        slot.duration = duration;
        slot.points.visible = true;

        // Randomise per-bubble drift direction around wallNormal
        const drifts = slot.geometry.attributes.aDrift.array;
        const bubbleCount = drifts.length / 3;
        const up = Math.abs(wallNormal.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
        const tangent1 = new THREE.Vector3().crossVectors(wallNormal, up).normalize();
        const tangent2 = new THREE.Vector3().crossVectors(wallNormal, tangent1).normalize();

        for (let i = 0; i < bubbleCount; i++) {
            const s1 = (Math.random() - 0.5) * 0.6;
            const s2 = (Math.random() - 0.5) * 0.6;
            drifts[i * 3] = wallNormal.x * 0.6 + tangent1.x * s1 + tangent2.x * s2;
            drifts[i * 3 + 1] = wallNormal.y * 0.6 + tangent1.y * s1 + tangent2.y * s2;
            drifts[i * 3 + 2] = wallNormal.z * 0.6 + tangent1.z * s1 + tangent2.z * s2;
        }
        slot.geometry.attributes.aDrift.needsUpdate = true;

        slot.material.uniforms.uOrigin.value.copy(origin);
        slot.material.uniforms.uStrength.value = strength;
        slot.material.uniforms.uAge.value = 0;
    }

    update(delta) {
        for (const slot of this.slots) {
            if (!slot.active) continue;
            slot.age += delta;
            const t = slot.age / slot.duration;
            if (t >= 1.0) {
                slot.active = false;
                slot.points.visible = false;
                slot.material.uniforms.uStrength.value = 0;
                continue;
            }
            slot.material.uniforms.uAge.value = t;
        }
    }

    dispose() {
        for (const slot of this.slots) {
            this.scene.remove(slot.points);
            slot.geometry.dispose();
            slot.material.dispose();
        }
        this.slots = [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// God-Ray Array — volumetric shafts from the barrel mouth
// ─────────────────────────────────────────────────────────────────────────────
export class GodRayArray {
    constructor(scene, rayCount, anchorPos) {
        this.scene = scene;
        this.rayCount = rayCount;
        this.rays = [];
        this.active = false;
        this.age = 0;
        this.duration = 1.5;
        this.strength = 0.0;

        // Base direction: from the exit anchor back through the barrel toward the camera.
        // Anchor ≈ (5, 2, 45); camera sits near (0,0,-25). Shoot roughly along -Z with
        // slight downward/leftward bias toward the barrel interior.
        const baseDir = new THREE.Vector3(
            -anchorPos.x * 0.3,
            -anchorPos.y * 0.5,
            -1,
        ).normalize();
        const yAxis = new THREE.Vector3(0, 1, 0);

        for (let i = 0; i < rayCount; i++) {
            // Each ray: narrow plane, length along +Y, width along X, normal +Z.
            const width = 3.0 + Math.random() * 2.5;
            const length = 55 + Math.random() * 25;
            const geometry = new THREE.PlaneGeometry(width, length);
            // Anchor sits at local (0,0,0), tip at (0, length, 0) — matches the shader
            // convention "vUv.y = 0 at anchor, 1 at tip" after the translate.
            geometry.translate(0, length / 2, 0);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uAge: { value: 0 },
                    uStrength: { value: 0 },
                    uTime: { value: 0 },
                    uWarmColor: { value: new THREE.Color(0xfff2cc) },
                    uCoolColor: { value: new THREE.Color(0x99eeff) },
                },
                vertexShader: GodRayShader.vertexShader,
                fragmentShader: GodRayShader.fragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.frustumCulled = false;
            mesh.visible = false;
            mesh.position.copy(anchorPos);

            // Scatter each ray's shoot direction around the base direction (cone fan)
            const yaw = (Math.random() - 0.5) * 0.7;
            const pitch = (Math.random() - 0.5) * 0.6;
            const dir = baseDir.clone()
                .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
                .applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch)
                .normalize();

            // Align the plane's +Y (length) axis to `dir`
            const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);
            mesh.quaternion.copy(quat);

            // Roll the plane around its own length so the flat face isn't always
            // coincident with the world, giving the fan a volumetric look
            const roll = Math.random() * Math.PI * 2;
            const rollQuat = new THREE.Quaternion().setFromAxisAngle(dir, roll);
            mesh.quaternion.premultiply(rollQuat);

            scene.add(mesh);
            this.rays.push({ mesh, material });
        }
    }

    trigger(strength = 1.0, duration = 1.5) {
        this.active = true;
        this.age = 0;
        this.strength = strength;
        this.duration = duration;
        for (const { mesh, material } of this.rays) {
            mesh.visible = true;
            material.uniforms.uStrength.value = strength;
            material.uniforms.uAge.value = 0;
        }
    }

    update(delta, time) {
        if (!this.active) return;
        this.age += delta;
        const t = this.age / this.duration;
        if (t >= 1.0) {
            this.active = false;
            for (const { mesh, material } of this.rays) {
                mesh.visible = false;
                material.uniforms.uStrength.value = 0;
            }
            return;
        }
        for (const { material } of this.rays) {
            material.uniforms.uAge.value = t;
            material.uniforms.uTime.value = time;
        }
    }

    dispose() {
        for (const { mesh, material } of this.rays) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            material.dispose();
        }
        this.rays = [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plankton Streak Pool — bioluminescent trails sweeping along the barrel wall
// ─────────────────────────────────────────────────────────────────────────────
export class PlanktonStreakPool {
    constructor(scene, maxStreaks, barrelRadius = 9.7) {
        this.scene = scene;
        this.barrelRadius = barrelRadius;
        this.geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(maxStreaks * 3);
        const angleStart = new Float32Array(maxStreaks);
        const angleSpeed = new Float32Array(maxStreaks);
        const zs = new Float32Array(maxStreaks);
        const radii = new Float32Array(maxStreaks);
        const seeds = new Float32Array(maxStreaks);
        for (let i = 0; i < maxStreaks; i++) {
            seeds[i] = Math.random();
        }

        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute('aAngleStart', new THREE.BufferAttribute(angleStart, 1));
        this.geometry.setAttribute('aAngleSpeed', new THREE.BufferAttribute(angleSpeed, 1));
        this.geometry.setAttribute('aZ', new THREE.BufferAttribute(zs, 1));
        this.geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
        this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uAge: { value: 1.0 },
                uStrength: { value: 0.0 },
                uColor: { value: new THREE.Color(0x88ffee) },
            },
            vertexShader: PlanktonStreakShader.vertexShader,
            fragmentShader: PlanktonStreakShader.fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.points = new THREE.Points(this.geometry, this.material);
        this.points.visible = false;
        this.points.frustumCulled = false;
        scene.add(this.points);

        this.maxStreaks = maxStreaks;
        this.active = false;
        this.age = 0;
        this.duration = 1.2;
    }

    trigger(streakCount, originZ, strength = 1.0, duration = 1.2) {
        const count = Math.min(streakCount, this.maxStreaks);
        const angleStart = this.geometry.attributes.aAngleStart.array;
        const angleSpeed = this.geometry.attributes.aAngleSpeed.array;
        const zs = this.geometry.attributes.aZ.array;
        const radii = this.geometry.attributes.aRadius.array;

        for (let i = 0; i < this.maxStreaks; i++) {
            if (i < count) {
                angleStart[i] = Math.random() * Math.PI * 2;
                angleSpeed[i] = (Math.random() * 2 + 1) * (Math.random() < 0.5 ? 1 : -1);
                zs[i] = originZ + (Math.random() - 0.5) * 30;
                radii[i] = this.barrelRadius * (0.92 + Math.random() * 0.06);
            } else {
                // Park unused slots offscreen
                radii[i] = 0;
                zs[i] = -500;
                angleStart[i] = 0;
                angleSpeed[i] = 0;
            }
        }
        this.geometry.attributes.aAngleStart.needsUpdate = true;
        this.geometry.attributes.aAngleSpeed.needsUpdate = true;
        this.geometry.attributes.aZ.needsUpdate = true;
        this.geometry.attributes.aRadius.needsUpdate = true;

        this.active = true;
        this.age = 0;
        this.duration = duration;
        this.points.visible = true;
        this.material.uniforms.uStrength.value = strength;
        this.material.uniforms.uAge.value = 0;
    }

    update(delta) {
        if (!this.active) return;
        this.age += delta;
        const t = this.age / this.duration;
        if (t >= 1.0) {
            this.active = false;
            this.points.visible = false;
            this.material.uniforms.uStrength.value = 0;
            return;
        }
        this.material.uniforms.uAge.value = t;
    }

    dispose() {
        this.scene.remove(this.points);
        this.geometry.dispose();
        this.material.dispose();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Foam Curtain — breaking-lip cascade along the top arc of the barrel
// ─────────────────────────────────────────────────────────────────────────────
export class FoamCurtain {
    constructor(scene, particleCount, barrelRadius = 9.8) {
        this.scene = scene;
        this.particleCount = particleCount;
        this.geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(particleCount * 3);
        const angles = new Float32Array(particleCount);
        const zs = new Float32Array(particleCount);
        const seeds = new Float32Array(particleCount);
        const speeds = new Float32Array(particleCount);

        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
        this.geometry.setAttribute('aZ', new THREE.BufferAttribute(zs, 1));
        this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
        this.geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uAge: { value: 1.0 },
                uStrength: { value: 0.0 },
                uBarrelRadius: { value: barrelRadius },
            },
            vertexShader: FoamCurtainShader.vertexShader,
            fragmentShader: FoamCurtainShader.fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.points = new THREE.Points(this.geometry, this.material);
        this.points.visible = false;
        this.points.frustumCulled = false;
        scene.add(this.points);

        this.active = false;
        this.age = 0;
        this.duration = 2.0;
    }

    trigger(centerZ, strength = 1.0, duration = 2.0) {
        const angles = this.geometry.attributes.aAngle.array;
        const zs = this.geometry.attributes.aZ.array;
        const seeds = this.geometry.attributes.aSeed.array;
        const speeds = this.geometry.attributes.aSpeed.array;

        for (let i = 0; i < this.particleCount; i++) {
            // Emit from top arc: angle between π/4 and 3π/4 around barrel axis
            angles[i] = Math.PI * 0.25 + Math.random() * Math.PI * 0.5;
            zs[i] = centerZ + (Math.random() - 0.3) * 45;
            seeds[i] = Math.random();
            speeds[i] = 0.7 + Math.random() * 0.6;
        }
        this.geometry.attributes.aAngle.needsUpdate = true;
        this.geometry.attributes.aZ.needsUpdate = true;
        this.geometry.attributes.aSeed.needsUpdate = true;
        this.geometry.attributes.aSpeed.needsUpdate = true;

        this.active = true;
        this.age = 0;
        this.duration = duration;
        this.points.visible = true;
        this.material.uniforms.uStrength.value = strength;
        this.material.uniforms.uAge.value = 0;
    }

    update(delta) {
        if (!this.active) return;
        this.age += delta;
        const t = this.age / this.duration;
        if (t >= 1.0) {
            this.active = false;
            this.points.visible = false;
            this.material.uniforms.uStrength.value = 0;
            return;
        }
        this.material.uniforms.uAge.value = t;
    }

    dispose() {
        this.scene.remove(this.points);
        this.geometry.dispose();
        this.material.dispose();
    }
}
