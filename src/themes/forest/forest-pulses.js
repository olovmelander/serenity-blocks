/**
 * Forest — the waves of light.
 *
 * When a piece lands or a line clears, light runs out across the forest floor: a ring that
 * widens from where it happened, climbs the trunks it passes, and sets every firefly it
 * crosses flashing. A fixed pool of such rings, each two vec4s the shaders read (centre and
 * radius; strength, width, reach and heat). Pure data: the game adds waves, time carries
 * them outward, and nothing is allocated while it runs.
 */
import * as THREE from 'three/webgpu';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);

export class ForestPulses {
    constructor(count = 5) {
        this.count = Math.max(1, Math.floor(count));
        // centre x, y, z and the ring's radius
        this.place = Array.from({ length: this.count }, () => new THREE.Vector4(0, 0, 0, 0));
        // strength now, width of the front, how high it reaches, heat (0 firefly green, 1 white gold)
        this.shape = Array.from({ length: this.count }, () => new THREE.Vector4(0, 1, 1, 0));
        this.state = Array.from({ length: this.count }, () => ({
            active: false, age: 0, life: 1, speed: 0, strength: 0,
        }));
        this.cursor = 0;
    }

    reset() {
        for (let i = 0; i < this.count; i += 1) {
            this.place[i].set(0, 0, 0, 0);
            this.shape[i].set(0, 1, 1, 0);
            Object.assign(this.state[i], {
                active: false, age: 0, life: 1, speed: 0, strength: 0,
            });
        }
        this.cursor = 0;
    }

    /** Start a wave; takes a free slot, or the wave nearest the end of its life. */
    add(x, y, z, {
        strength = 1, speed = 10, width = 2, reach = 3, heat = 0, life = 3,
    } = {}) {
        if (![x, y, z].every(Number.isFinite) || !(strength > 0)) return -1;
        let selected = -1;
        let furthest = -1;
        for (let step = 0; step < this.count; step += 1) {
            const index = (this.cursor + step) % this.count;
            const state = this.state[index];
            if (!state.active) {
                selected = index;
                break;
            }
            const progress = state.age / state.life;
            if (progress > furthest) {
                furthest = progress;
                selected = index;
            }
        }
        this.cursor = (selected + 1) % this.count;
        Object.assign(this.state[selected], {
            active: true,
            age: 0,
            life: clamp(finite(life, 3), 0.2, 12),
            speed: clamp(finite(speed, 10), 0.5, 80),
            strength: clamp(strength, 0, 4),
        });
        this.place[selected].set(x, y, z, 0);
        this.shape[selected].set(
            0,
            clamp(finite(width, 2), 0.2, 20),
            clamp(finite(reach, 3), 0.2, 60),
            clamp(finite(heat, 0), 0, 1),
        );
        return selected;
    }

    update(dt) {
        if (!(dt > 0)) return;
        for (let i = 0; i < this.count; i += 1) {
            const state = this.state[i];
            if (!state.active) continue;
            state.age += dt;
            if (state.age >= state.life) {
                state.active = false;
                this.place[i].w = 0;
                this.shape[i].x = 0;
                continue;
            }
            const progress = state.age / state.life;
            // The front slows a little as it spreads and thins as its circle grows.
            this.place[i].w = state.speed * state.age * (1 - 0.22 * progress);
            this.shape[i].x = state.strength * (1 - progress) ** 1.4 * Math.min(1, state.age / 0.06);
        }
    }

    active() {
        return this.state.reduce((total, state) => total + (state.active ? 1 : 0), 0);
    }
}
