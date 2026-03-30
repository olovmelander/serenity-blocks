import * as THREE from 'three';
import { createMoonlitAmbientFireflyNodeMaterial } from './moonlit-forest-materials.js';
import { MoonlitAmbientFireflyCompute } from './moonlit-forest-compute.js';
import { clamp01 } from '@utils/helpers.js';

export class MoonlitForestParticles {
    constructor({
        scene,
        qualityConfig = {},
        random = Math.random,
        renderer = null,
        isWebGPU = false,
        useCompute = false,
    }) {
        this.scene = scene;
        this.qualityConfig = qualityConfig;
        this.randomFn = random;
        this.renderer = renderer;
        this.isWebGPU = isWebGPU === true;
        this.useCompute = useCompute === true
            && this.isWebGPU
            && typeof this.renderer?.compute === 'function';
        this.time = 0;

        this.pools = {};
        this.aurora = null;
        this.ambientField = null;

        this.sporeColors = [
            new THREE.Color(0x00d9ff),
            new THREE.Color(0xa78bfa),
            new THREE.Color(0x6ee7b7),
        ];
        this.sparkleColors = [
            new THREE.Color(0xc0d8f0),
            new THREE.Color(0xa0d8ff),
            new THREE.Color(0xd5b8ff),
            new THREE.Color(0xb6ffe7),
        ];
        this.wispColors = [
            new THREE.Color(0xc5dcf0),
            new THREE.Color(0xa7c9ef),
            new THREE.Color(0xc4b3ff),
        ];
        this.runeColors = [
            new THREE.Color(0xc0d8f0),
            new THREE.Color(0xb9d4ff),
            new THREE.Color(0xb6f2e6),
        ];
        this.leafColors = [
            new THREE.Color(0x6ee7b7),
            new THREE.Color(0x4fd1a4),
            new THREE.Color(0xc49a4e),
        ];

        this.createPools();
    }

    rand(min = 0, max = 1) {
        return this.randomFn() * (max - min) + min;
    }

    buildBudgets() {
        const fireflies = Math.max(4, this.qualityConfig.fireflies || 8);
        const moonbeams = Math.max(2, this.qualityConfig.moonbeams || 5);
        const leaves = Math.max(10, this.qualityConfig.leaves || 24);
        const eyes = Math.max(1, this.qualityConfig.eyes || 3);

        return {
            fireflies: Math.min(80, fireflies * 6),
            spores: Math.min(60, fireflies * 4),
            sparkles: Math.min(50, fireflies * 3),
            wisps: Math.min(30, moonbeams * 5),
            mist: Math.min(24, moonbeams * 4),
            enchantedLeaves: Math.min(60, Math.floor(leaves * 0.7)),
            runes: Math.min(24, eyes * 4),
            shootingStars: Math.min(14, Math.max(4, moonbeams * 2)),
        };
    }

    createSpritePool(name, count, {
        color,
        blending = THREE.AdditiveBlending,
        renderOrder = 12,
    }) {
        const entries = [];

        for (let i = 0; i < count; i++) {
            const material = new THREE.SpriteMaterial({
                color,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                blending,
            });
            const sprite = new THREE.Sprite(material);
            sprite.visible = false;
            sprite.renderOrder = renderOrder;
            sprite.position.set(0, -9999, 0);
            this.scene.add(sprite);

            entries.push({
                sprite,
                active: false,
                life: 0,
                maxLife: 1,
                vx: 0,
                vy: 0,
                vz: 0,
                drag: 0.985,
                gravity: 0,
                baseOpacity: 0.8,
                scaleX: 10,
                scaleY: 10,
                scaleGrowthX: 0,
                scaleGrowthY: 0,
                fadeIn: 0.1,
                fadeOut: 0.25,
                spin: 0,
                phase: this.rand(0, Math.PI * 2),
                swayAmplitude: 0,
                swaySpeed: 0,
            });
        }

        this.pools[name] = {
            entries,
            cursor: 0,
        };
    }

    createAurora() {
        const geometry = new THREE.PlaneGeometry(2200, 760, 1, 1);
        const material = new THREE.MeshBasicMaterial({
            color: 0x7dcff4,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(0, 330, -1180);
        mesh.renderOrder = 3;
        mesh.visible = false;
        this.scene.add(mesh);

        this.aurora = {
            mesh,
            material,
            active: false,
            life: 0,
            duration: 1,
            strength: 0,
            phase: this.rand(0, Math.PI * 2),
        };
    }

    createAmbientFireflyField(budgets) {
        if (!this.useCompute || !this.renderer?.compute || !this.scene) return;

        const count = Math.min(1400, Math.max(220, budgets.fireflies * 16));
        const positions = new Float32Array(count * 3);
        const randoms = new Float32Array(count);
        const twinkles = new Float32Array(count);
        const sizeSeeds = new Float32Array(count);

        for (let i = 0; i < count; i += 1) {
            const i3 = i * 3;
            positions[i3] = this.rand(-900, 900);
            positions[i3 + 1] = this.rand(-80, 180);
            positions[i3 + 2] = this.rand(-1100, -380);
            randoms[i] = this.rand();
            twinkles[i] = 0.45 + this.rand(0, 1.25);
            sizeSeeds[i] = this.rand();
        }

        try {
            const compute = new MoonlitAmbientFireflyCompute(count, {
                xSpan: 920,
                yMin: -90,
                yMax: 220,
                zMin: -1120,
                zMax: -360,
            }, () => this.rand());
            compute.setInitialState(positions, randoms, twinkles, sizeSeeds);
            compute.createComputeNode();

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
            geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));
            geometry.setAttribute('aSizeSeed', new THREE.BufferAttribute(sizeSeeds, 1));
            geometry.setDrawRange(0, count);

            const { material, uniforms } = createMoonlitAmbientFireflyNodeMaterial({
                time: 0,
                size: 7.2,
                pulse: 0,
                color: new THREE.Color(0xffeb7a),
                fireflyCompute: compute,
            });

            const points = new THREE.Points(geometry, material);
            points.frustumCulled = false;
            points.renderOrder = 13;
            this.scene.add(points);

            this.ambientField = {
                compute,
                points,
                uniforms,
                pulse: 0,
            };
        } catch (error) {
            console.warn('[MoonlitForestParticles] Ambient firefly compute init failed; using CPU-only pools.', error);
            this.useCompute = false;
            this.disposeAmbientFireflyField();
        }
    }

    disposeAmbientFireflyField() {
        if (!this.ambientField) return;

        if (this.ambientField.points) {
            this.scene.remove(this.ambientField.points);
            this.ambientField.points.geometry?.dispose?.();
            this.ambientField.points.material?.dispose?.();
        }
        this.ambientField.compute?.dispose?.();
        this.ambientField = null;
    }

    createPools() {
        const budgets = this.buildBudgets();
        const fireflySprites = this.useCompute
            ? Math.max(24, Math.floor(budgets.fireflies * 0.35))
            : budgets.fireflies;

        this.createSpritePool('fireflies', fireflySprites, {
            color: 0xffeb7a,
            blending: THREE.AdditiveBlending,
            renderOrder: 13,
        });
        this.createSpritePool('spores', budgets.spores, {
            color: 0x8cecf7,
            blending: THREE.AdditiveBlending,
            renderOrder: 11,
        });
        this.createSpritePool('sparkles', budgets.sparkles, {
            color: 0xd0ebff,
            blending: THREE.AdditiveBlending,
            renderOrder: 14,
        });
        this.createSpritePool('wisps', budgets.wisps, {
            color: 0xbbd7f0,
            blending: THREE.AdditiveBlending,
            renderOrder: 10,
        });
        this.createSpritePool('mist', budgets.mist, {
            color: 0xb6d0e4,
            blending: THREE.NormalBlending,
            renderOrder: 9,
        });
        this.createSpritePool('enchantedLeaves', budgets.enchantedLeaves, {
            color: 0x5ad39a,
            blending: THREE.AdditiveBlending,
            renderOrder: 12,
        });
        this.createSpritePool('runes', budgets.runes, {
            color: 0xc0d8f0,
            blending: THREE.AdditiveBlending,
            renderOrder: 15,
        });
        this.createSpritePool('shootingStars', budgets.shootingStars, {
            color: 0xe8f3ff,
            blending: THREE.AdditiveBlending,
            renderOrder: 8,
        });

        this.createAurora();
        this.createAmbientFireflyField(budgets);
    }

    usesComputeAmbientField() {
        return this.ambientField?.compute?.computeNode != null;
    }

    deactivate(entry) {
        entry.active = false;
        entry.life = 0;
        entry.maxLife = 1;
        entry.sprite.visible = false;
        entry.sprite.material.opacity = 0;
    }

    acquire(name) {
        const pool = this.pools[name];
        if (!pool || pool.entries.length === 0) return null;

        for (let i = 0; i < pool.entries.length; i++) {
            const index = (pool.cursor + i) % pool.entries.length;
            const entry = pool.entries[index];
            if (!entry.active) {
                pool.cursor = (index + 1) % pool.entries.length;
                return entry;
            }
        }

        const recycled = pool.entries[pool.cursor];
        pool.cursor = (pool.cursor + 1) % pool.entries.length;
        this.deactivate(recycled);
        return recycled;
    }

    activate(entry, {
        x,
        y,
        z,
        vx,
        vy,
        vz,
        opacity,
        life,
        scaleX,
        scaleY = scaleX,
        scaleGrowthX = 0,
        scaleGrowthY = 0,
        fadeIn = 0.1,
        fadeOut = 0.25,
        drag = 0.985,
        gravity = 0,
        spin = 0,
        swayAmplitude = 0,
        swaySpeed = 0,
        color = null,
        rotation = null,
    }) {
        entry.active = true;
        entry.life = 0;
        entry.maxLife = life;
        entry.vx = vx;
        entry.vy = vy;
        entry.vz = vz;
        entry.drag = drag;
        entry.gravity = gravity;
        entry.baseOpacity = opacity;
        entry.scaleX = scaleX;
        entry.scaleY = scaleY;
        entry.scaleGrowthX = scaleGrowthX;
        entry.scaleGrowthY = scaleGrowthY;
        entry.fadeIn = fadeIn;
        entry.fadeOut = fadeOut;
        entry.spin = spin;
        entry.phase = this.rand(0, Math.PI * 2);
        entry.swayAmplitude = swayAmplitude;
        entry.swaySpeed = swaySpeed;

        entry.sprite.visible = true;
        entry.sprite.position.set(x, y, z);
        entry.sprite.scale.set(scaleX, scaleY, 1);
        entry.sprite.material.opacity = 0;
        if (color) {
            entry.sprite.material.color.copy(color);
        }
        if (rotation !== null) {
            entry.sprite.material.rotation = rotation;
        }
    }

    emitAmbientFirefly() {
        if (this.ambientField) {
            this.ambientField.pulse = Math.min(2.4, this.ambientField.pulse + 0.1);
            return;
        }
        this.emitFireflies(1, { ambient: true });
    }

    emitFireflies(count, options = {}) {
        const ambient = options.ambient === true;
        if (ambient && this.ambientField) {
            this.ambientField.pulse = Math.min(2.4, this.ambientField.pulse + (count * 0.05));
            return;
        }
        for (let i = 0; i < count; i++) {
            const entry = this.acquire('fireflies');
            if (!entry) break;

            this.activate(entry, {
                x: this.rand(-860, 860),
                y: ambient ? this.rand(-40, 140) : this.rand(-60, 160),
                z: this.rand(-980, -420),
                vx: this.rand(-8, 8),
                vy: ambient ? this.rand(4, 10) : this.rand(8, 20),
                vz: this.rand(-4, 4),
                opacity: ambient ? this.rand(0.45, 0.8) : this.rand(0.65, 1),
                life: ambient ? this.rand(7, 13) : this.rand(1.4, 2.6),
                scaleX: ambient ? this.rand(2.2, 4.5) : this.rand(2.4, 5.2),
                fadeIn: ambient ? 0.08 : 0.12,
                fadeOut: ambient ? 0.26 : 0.34,
                drag: ambient ? 0.995 : 0.988,
                spin: this.rand(-0.4, 0.4),
                swayAmplitude: ambient ? this.rand(2.5, 8) : this.rand(1.5, 4),
                swaySpeed: ambient ? this.rand(0.5, 1.2) : this.rand(0.8, 1.6),
            });
        }
    }

    emitSpores(count) {
        for (let i = 0; i < count; i++) {
            const entry = this.acquire('spores');
            if (!entry) break;

            this.activate(entry, {
                x: this.rand(-740, 740),
                y: this.rand(-95, -20),
                z: this.rand(-980, -420),
                vx: this.rand(-10, 10),
                vy: this.rand(18, 36),
                vz: this.rand(-8, 8),
                opacity: this.rand(0.45, 0.95),
                life: this.rand(2.2, 3.8),
                scaleX: this.rand(3.5, 7.5),
                scaleGrowthX: this.rand(0.35, 0.75),
                scaleGrowthY: this.rand(0.35, 0.75),
                fadeIn: 0.08,
                fadeOut: 0.28,
                drag: 0.992,
                gravity: -3.5,
                spin: this.rand(-0.9, 0.9),
                color: this.sporeColors[Math.floor(this.rand(0, this.sporeColors.length))],
            });
        }
    }

    emitSparkles(count) {
        for (let i = 0; i < count; i++) {
            const entry = this.acquire('sparkles');
            if (!entry) break;

            this.activate(entry, {
                x: this.rand(-780, 780),
                y: this.rand(-20, 260),
                z: this.rand(-930, -440),
                vx: this.rand(-20, 20),
                vy: this.rand(6, 26),
                vz: this.rand(-8, 8),
                opacity: this.rand(0.55, 1),
                life: this.rand(0.8, 1.6),
                scaleX: this.rand(2.5, 6.5),
                scaleGrowthX: this.rand(0.25, 0.55),
                scaleGrowthY: this.rand(0.25, 0.55),
                fadeIn: 0.1,
                fadeOut: 0.5,
                drag: 0.986,
                gravity: 4,
                spin: this.rand(-2.2, 2.2),
                color: this.sparkleColors[Math.floor(this.rand(0, this.sparkleColors.length))],
            });
        }
    }

    emitWisps(count) {
        for (let i = 0; i < count; i++) {
            const entry = this.acquire('wisps');
            if (!entry) break;

            const fromLeft = this.rand() < 0.5;
            const speed = this.rand(28, 54) * (fromLeft ? 1 : -1);
            this.activate(entry, {
                x: fromLeft ? -920 : 920,
                y: this.rand(-30, 170),
                z: this.rand(-1030, -520),
                vx: speed,
                vy: this.rand(-4, 6),
                vz: this.rand(-4, 4),
                opacity: this.rand(0.18, 0.4),
                life: this.rand(3.5, 6),
                scaleX: this.rand(34, 78),
                scaleY: this.rand(14, 34),
                scaleGrowthX: this.rand(0.08, 0.18),
                scaleGrowthY: this.rand(0.08, 0.18),
                fadeIn: 0.14,
                fadeOut: 0.24,
                drag: 0.996,
                spin: this.rand(-0.3, 0.3),
                color: this.wispColors[Math.floor(this.rand(0, this.wispColors.length))],
            });
        }
    }

    emitMist(count) {
        for (let i = 0; i < count; i++) {
            const entry = this.acquire('mist');
            if (!entry) break;

            const fromLeft = this.rand() < 0.5;
            const speed = this.rand(12, 28) * (fromLeft ? 1 : -1);
            this.activate(entry, {
                x: fromLeft ? -960 : 960,
                y: this.rand(-70, 80),
                z: this.rand(-1080, -560),
                vx: speed,
                vy: this.rand(-2, 4),
                vz: this.rand(-3, 3),
                opacity: this.rand(0.1, 0.26),
                life: this.rand(5, 9),
                scaleX: this.rand(80, 190),
                scaleY: this.rand(30, 74),
                scaleGrowthX: this.rand(0.08, 0.2),
                scaleGrowthY: this.rand(0.08, 0.2),
                fadeIn: 0.2,
                fadeOut: 0.2,
                drag: 0.998,
                spin: this.rand(-0.08, 0.08),
                color: new THREE.Color(0xb8cce0),
            });
        }
    }

    emitEnchantedLeaves(count) {
        for (let i = 0; i < count; i++) {
            const entry = this.acquire('enchantedLeaves');
            if (!entry) break;

            this.activate(entry, {
                x: this.rand(-900, 900),
                y: this.rand(180, 440),
                z: this.rand(-1010, -460),
                vx: this.rand(-12, 12),
                vy: -this.rand(24, 42),
                vz: this.rand(-6, 6),
                opacity: this.rand(0.4, 0.76),
                life: this.rand(3.2, 5.8),
                scaleX: this.rand(7, 13),
                scaleY: this.rand(9, 16),
                fadeIn: 0.08,
                fadeOut: 0.22,
                drag: 0.992,
                gravity: 5.8,
                spin: this.rand(-1.8, 1.8),
                swayAmplitude: this.rand(8, 24),
                swaySpeed: this.rand(0.6, 1.4),
                color: this.leafColors[Math.floor(this.rand(0, this.leafColors.length))],
            });
        }
    }

    emitRunes(count) {
        for (let i = 0; i < count; i++) {
            const entry = this.acquire('runes');
            if (!entry) break;

            this.activate(entry, {
                x: this.rand(-560, 560),
                y: this.rand(10, 260),
                z: this.rand(-940, -520),
                vx: this.rand(-12, 12),
                vy: this.rand(3, 18),
                vz: this.rand(-4, 4),
                opacity: this.rand(0.5, 0.88),
                life: this.rand(1.4, 2.8),
                scaleX: this.rand(9, 18),
                scaleY: this.rand(9, 18),
                scaleGrowthX: this.rand(0.08, 0.22),
                scaleGrowthY: this.rand(0.08, 0.22),
                fadeIn: 0.1,
                fadeOut: 0.4,
                drag: 0.986,
                gravity: 2,
                spin: this.rand(-0.9, 0.9),
                color: this.runeColors[Math.floor(this.rand(0, this.runeColors.length))],
            });
        }
    }

    emitShootingStars(count) {
        for (let i = 0; i < count; i++) {
            const entry = this.acquire('shootingStars');
            if (!entry) break;

            const leftToRight = this.rand() < 0.5;
            const vx = this.rand(190, 330) * (leftToRight ? 1 : -1);
            const vy = -this.rand(28, 72);
            this.activate(entry, {
                x: leftToRight ? -980 : 980,
                y: this.rand(220, 360),
                z: this.rand(-1160, -760),
                vx,
                vy,
                vz: this.rand(20, 55),
                opacity: this.rand(0.65, 0.95),
                life: this.rand(0.7, 1.3),
                scaleX: this.rand(90, 180),
                scaleY: this.rand(2.2, 4.4),
                fadeIn: 0.05,
                fadeOut: 0.45,
                drag: 0.995,
                gravity: 1.6,
                spin: 0,
                rotation: Math.atan2(vy, vx),
                color: new THREE.Color(0xe8f4ff),
            });
        }
    }

    triggerAurora(comboCount = 1) {
        if (!this.aurora) return;

        const strength = Math.min(2.4, 0.75 + (comboCount * 0.22));
        const duration = 1.8 + (comboCount * 0.25);

        this.aurora.active = true;
        this.aurora.life = 0;
        this.aurora.duration = Math.max(this.aurora.duration, duration);
        this.aurora.strength = Math.max(this.aurora.strength, strength);
        this.aurora.phase = this.rand(0, Math.PI * 2);
        this.aurora.mesh.visible = true;
        this.aurora.material.opacity = 0;
    }

    updateEntry(entry, delta, time) {
        entry.life += delta;
        if (entry.life >= entry.maxLife) {
            this.deactivate(entry);
            return;
        }

        const progress = clamp01(entry.life / entry.maxLife);
        const dragStep = entry.drag ** Math.max(1, delta * 60);
        entry.vx *= dragStep;
        entry.vy *= dragStep;
        entry.vz *= dragStep;
        entry.vy -= entry.gravity * delta;

        entry.sprite.position.x += (entry.vx * delta)
            + (Math.sin((time * entry.swaySpeed) + entry.phase) * entry.swayAmplitude * delta);
        entry.sprite.position.y += entry.vy * delta;
        entry.sprite.position.z += entry.vz * delta;

        entry.sprite.material.rotation += entry.spin * delta;

        entry.sprite.scale.x = entry.scaleX * (1 + (entry.scaleGrowthX * progress));
        entry.sprite.scale.y = entry.scaleY * (1 + (entry.scaleGrowthY * progress));

        let alpha = 1;
        if (progress < entry.fadeIn) {
            alpha = progress / Math.max(0.001, entry.fadeIn);
        }
        if (progress > (1 - entry.fadeOut)) {
            const fade = (1 - progress) / Math.max(0.001, entry.fadeOut);
            alpha = Math.min(alpha, fade);
        }
        entry.sprite.material.opacity = entry.baseOpacity * clamp01(alpha);
    }

    updateAurora(delta, time) {
        if (!this.aurora || !this.aurora.active) return;

        this.aurora.life += delta;
        const progress = clamp01(this.aurora.life / this.aurora.duration);
        if (progress >= 1) {
            this.aurora.active = false;
            this.aurora.strength = 0;
            this.aurora.mesh.visible = false;
            this.aurora.material.opacity = 0;
            return;
        }

        const envelope = Math.sin(Math.PI * progress);
        const shimmer = 0.84 + (Math.sin((time * 1.35) + this.aurora.phase) * 0.16);
        const opacity = envelope * (0.12 + (this.aurora.strength * 0.07)) * shimmer;

        this.aurora.material.opacity = opacity;
        this.aurora.mesh.position.x = Math.sin((time * 0.22) + this.aurora.phase) * 85;
        this.aurora.mesh.scale.y = 1 + (Math.sin((time * 0.5) + (this.aurora.phase * 0.35)) * 0.05);
    }

    updateAmbientComputeField(delta, time) {
        if (!this.ambientField?.compute?.computeNode || !this.renderer?.compute) return;

        this.ambientField.pulse = Math.max(0, this.ambientField.pulse - (delta * 0.65));
        this.ambientField.uniforms.uTime.value = time;
        this.ambientField.uniforms.uPulse.value = this.ambientField.pulse;

        this.ambientField.compute.update(delta, time, {
            flowStrength: 1.0 + (this.ambientField.pulse * 0.75),
            pulse: this.ambientField.pulse,
        });

        try {
            this.renderer.compute(this.ambientField.compute.computeNode);
        } catch (error) {
            console.warn('[MoonlitForestParticles] Ambient firefly compute update failed; disabling compute field.', error);
            this.disposeAmbientFireflyField();
            this.useCompute = false;
        }
    }

    update(delta, time) {
        this.time = time;
        this.updateAmbientComputeField(delta, time);

        Object.values(this.pools).forEach((pool) => {
            pool.entries.forEach((entry) => {
                if (!entry.active) return;
                this.updateEntry(entry, delta, time);
            });
        });

        this.updateAurora(delta, time);
    }

    dispose() {
        this.disposeAmbientFireflyField();

        Object.values(this.pools).forEach((pool) => {
            pool.entries.forEach((entry) => {
                this.scene.remove(entry.sprite);
                entry.sprite.material.dispose();
            });
            pool.entries = [];
        });
        this.pools = {};

        if (this.aurora) {
            this.scene.remove(this.aurora.mesh);
            this.aurora.mesh.geometry.dispose();
            this.aurora.material.dispose();
            this.aurora = null;
        }
    }
}
