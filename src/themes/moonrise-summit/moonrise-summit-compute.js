/**
 * Moonrise Summit Theme - CPU-pooled effect systems
 *
 * Shooting-star pool: an InstancedMesh of streak quads recycled from a fixed
 * pool. Cheap, runs on both WebGPU and WebGL2 backends. The pool size scales
 * with the active quality preset.
 *
 * Lake ripple impulse: tracks a damped scalar driven by PIECE_LOCK / LINE_CLEAR
 * events. The water shader's uRippleAmp uniform reads it each frame so the
 * surface reacts without per-frame CPU geometry updates.
 */

import * as THREE from 'three/webgpu';

// ────────────────────────────────────────────────────────────────────────────
// Shooting star pool
// ────────────────────────────────────────────────────────────────────────────

export class ShootingStarPool {
    /**
     * @param {THREE.Object3D} parent - scene group to add the mesh into
     * @param {THREE.Material} material - shared streak material (theme-owned)
     * @param {number} maxCount - max simultaneous streaks
     */
    constructor(parent, material, maxCount = 16) {
        this.parent = parent;
        this.material = material;
        this.max = Math.max(1, Math.floor(maxCount));

        // Streak quad: 1 wide × 1 tall, anchored at left edge (head)
        const geometry = new THREE.PlaneGeometry(1, 1);
        geometry.translate(0.5, 0, 0); // shift so x=0 is head

        this.mesh = new THREE.InstancedMesh(geometry, material, this.max);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 6;
        this.mesh.count = 0; // start hidden — grow as we activate
        parent.add(this.mesh);

        this.geometry = geometry;
        this.state = new Array(this.max);
        for (let i = 0; i < this.max; i++) {
            this.state[i] = {
                active: false,
                life: 0,
                lifeMax: 1.0,
                px: 0,
                py: 0,
                pz: 0,
                vx: 0,
                vy: 0,
                length: 1,
                width: 0.1,
                angle: 0,
            };
        }
        this.dummy = new THREE.Object3D();
        this.activeCount = 0;
    }

    /**
     * Spawn a single streak inside the upper region of the visible frame.
     * @param {Object} opts
     * @param {THREE.Vector3} opts.origin - rough world-space spawn anchor
     * @param {number} opts.spreadX - horizontal spread radius
     * @param {number} opts.spreadY - vertical spread radius
     */
    spawn({ origin, spreadX = 70, spreadY = 30 } = {}) {
        const slot = this._findFreeSlot();
        if (slot === -1) return false;
        const s = this.state[slot];
        const angle = -0.85 + (Math.random() - 0.5) * 0.5; // mostly down-left
        const speed = 90 + Math.random() * 60;
        s.active = true;
        s.life = 0;
        s.lifeMax = 1.6 + Math.random() * 0.9;
        s.px = (origin?.x ?? 0) + (Math.random() - 0.5) * spreadX * 2;
        s.py = (origin?.y ?? 40) + (Math.random() - 0.2) * spreadY;
        s.pz = (origin?.z ?? -120) + (Math.random() - 0.5) * 60;
        s.vx = Math.cos(angle) * speed * -1; // travel left
        s.vy = Math.sin(angle) * speed; // and down
        s.length = 22 + Math.random() * 18;
        s.width = 0.35 + Math.random() * 0.4;
        s.angle = angle;
        if (slot >= this.mesh.count) {
            this.mesh.count = slot + 1;
        }
        return true;
    }

    _findFreeSlot() {
        for (let i = 0; i < this.max; i++) {
            if (!this.state[i].active) return i;
        }
        return -1;
    }

    update(dt) {
        let anyActive = false;
        let lastActive = -1;
        for (let i = 0; i < this.mesh.count; i++) {
            const s = this.state[i];
            if (!s.active) {
                this.dummy.position.set(0, -10000, 0);
                this.dummy.scale.set(0.0001, 0.0001, 0.0001);
                this.dummy.rotation.set(0, 0, 0);
                this.dummy.updateMatrix();
                this.mesh.setMatrixAt(i, this.dummy.matrix);
                continue;
            }
            s.life += dt;
            if (s.life >= s.lifeMax) {
                s.active = false;
                this.dummy.position.set(0, -10000, 0);
                this.dummy.scale.set(0.0001, 0.0001, 0.0001);
                this.dummy.updateMatrix();
                this.mesh.setMatrixAt(i, this.dummy.matrix);
                continue;
            }
            s.px += s.vx * dt;
            s.py += s.vy * dt;
            // gravity-ish acceleration on Y
            s.vy -= 18 * dt;

            // Fade envelope (0 → 1 → 0 across life)
            const t = s.life / s.lifeMax;
            const fade = Math.sin(Math.min(t * Math.PI, Math.PI));

            this.dummy.position.set(s.px, s.py, s.pz);
            this.dummy.rotation.set(0, 0, s.angle);
            this.dummy.scale.set(s.length * fade, s.width * fade, 1);
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(i, this.dummy.matrix);
            anyActive = true;
            lastActive = i;
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        // Trim mesh.count to the highest active slot for efficiency
        this.mesh.count = anyActive ? lastActive + 1 : 0;
    }

    setMax(newMax) {
        const clamped = Math.max(1, Math.min(64, Math.floor(newMax)));
        if (clamped === this.max) return;
        // Stop all current animations and rebuild
        const wasParent = this.mesh.parent;
        if (wasParent) wasParent.remove(this.mesh);
        this.mesh.dispose?.();
        this.max = clamped;
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.max);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 6;
        this.mesh.count = 0;
        this.state = new Array(this.max);
        for (let i = 0; i < this.max; i++) {
            this.state[i] = {
                active: false,
                life: 0,
                lifeMax: 1.0,
                px: 0,
                py: 0,
                pz: 0,
                vx: 0,
                vy: 0,
                length: 1,
                width: 0.1,
                angle: 0,
            };
        }
        if (wasParent) wasParent.add(this.mesh);
    }

    dispose() {
        if (this.mesh) {
            if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
            this.mesh.dispose?.();
            this.mesh = null;
        }
        if (this.geometry) {
            this.geometry.dispose();
            this.geometry = null;
        }
        this.state = null;
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Lake ripple impulse: damped scalar driven by piece-lock events
// ────────────────────────────────────────────────────────────────────────────

export class LakeRippleDriver {
    constructor({ damping = 2.4, maxAmp = 0.65 } = {}) {
        this.amp = 0;
        this.target = 0;
        this.damping = damping;
        this.maxAmp = maxAmp;
    }

    impulse(strength = 0.4) {
        this.target = Math.min(this.maxAmp, this.target + strength);
    }

    update(dt) {
        // Spring-damper toward 0 with target injection
        this.amp += (this.target - this.amp) * Math.min(dt * 8.0, 1.0);
        this.target = Math.max(0, this.target - this.damping * dt);
        return this.amp;
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Moon pulse driver: ramped scalar for LINE_CLEAR events
// ────────────────────────────────────────────────────────────────────────────

export class MoonPulseDriver {
    constructor({ rampUp = 2.5, rampDown = 0.9, maxAmp = 1.0 } = {}) {
        this.amp = 0;
        this.target = 0;
        this.rampUp = rampUp;
        this.rampDown = rampDown;
        this.maxAmp = maxAmp;
    }

    impulse(strength = 0.5) {
        this.target = Math.min(this.maxAmp, this.target + strength);
    }

    update(dt) {
        const isRising = this.target > this.amp;
        const rate = isRising ? this.rampUp : this.rampDown;
        this.amp += (this.target - this.amp) * Math.min(dt * rate, 1.0);
        // Bleed the target back to zero gradually
        this.target = Math.max(0, this.target - this.rampDown * dt * 0.6);
        return this.amp;
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Generic envelope: aurora intensity / horizon warm shift (combo events)
// ────────────────────────────────────────────────────────────────────────────

export class EnvelopeDriver {
    constructor({ attack = 1.8, release = 0.5, maxAmp = 1.0 } = {}) {
        this.amp = 0;
        this.target = 0;
        this.attack = attack;
        this.release = release;
        this.maxAmp = maxAmp;
    }

    impulse(strength = 0.5) {
        this.target = Math.min(this.maxAmp, this.target + strength);
    }

    update(dt) {
        const rising = this.target > this.amp;
        const rate = rising ? this.attack : this.release;
        this.amp += (this.target - this.amp) * Math.min(dt * rate, 1.0);
        this.target = Math.max(0, this.target - this.release * dt * 0.7);
        return this.amp;
    }
}
