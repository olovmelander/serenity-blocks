import * as THREE from 'three';
import { uniform, float, vec3, mix, saturate, pow, smoothstep, dot, positionLocal, timerLocal, uv, fbm2D } from 'three/tsl';

export class SkyComboEffectsManager {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;

        this.time = 0;
        this.activeCombos = [];

        this.initFlockSystem();
        this.initStarfallSystem();
        this.initAurora();
    }

    initFlockSystem() {
        this.flockCount = 400; // enlarged pool so consecutive combos accumulate
        const geometry = new THREE.CylinderGeometry(0.5, 0.05, 8, 3);
        geometry.rotateX(Math.PI / 2); // point +Z
        geometry.scale(1, 0.2, 1); // flatten

        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.flockMesh = new THREE.InstancedMesh(geometry, material, this.flockCount);
        this.flockMesh.frustumCulled = false;
        this.flockMesh.renderOrder = 30;

        // x, y, z, phase (0→1 = alive, 999 = inactive), speed
        this.flockData = new Float32Array(this.flockCount * 5);
        for (let i = 0; i < this.flockCount; i++) {
            this.flockData[i * 5 + 3] = 999; // inactive
        }

        this.scene.add(this.flockMesh);
    }

    initStarfallSystem() {
        this.starCount = 200; // enlarged pool for accumulation
        const geometry = new THREE.SphereGeometry(1.5, 8, 8);
        geometry.scale(0.1, 0.1, 8.0); // stretch into streaks

        const material = new THREE.MeshBasicMaterial({
            color: 0xfff0c2,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.starMesh = new THREE.InstancedMesh(geometry, material, this.starCount);
        this.starMesh.frustumCulled = false;
        this.starMesh.renderOrder = 28;

        // x, y, z, phase (0→1 = alive, 999 = inactive), speed
        this.starData = new Float32Array(this.starCount * 5);
        for (let i = 0; i < this.starCount; i++) {
            this.starData[i * 5 + 3] = 999;
        }

        this.scene.add(this.starMesh);
    }

    initAurora() {
        const geometry = new THREE.CylinderGeometry(600, 600, 250, 64, 1, true);
        const material = new THREE.MeshBasicNodeMaterial();

        this.uAuroraIntensity = uniform(0.0);

        // Node-based aurora shader
        const baseUv = uv();
        const t = timerLocal(0.05);

        const distort = fbm2D(baseUv.mul(vec3(8.0, 1.0, 0.0)).add(vec3(t, 0, 0)));
        const auroraEdge = smoothstep(0.0, 0.5, baseUv.y).mul(smoothstep(1.0, 0.5, baseUv.y));
        const auroraWisp = pow(fbm2D(baseUv.mul(vec3(15.0, 2.0, 0.0)).add(vec3(t.mul(-1.5), distort.mul(0.5), 0))), 2.0);

        const auroraColor = mix(vec3(0.1, 0.8, 0.6), vec3(0.8, 0.2, 0.7), baseUv.x.add(t));

        material.colorNode = auroraColor.add(vec3(0.5));
        material.opacityNode = auroraEdge.mul(auroraWisp).mul(this.uAuroraIntensity).mul(2.5);
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.side = THREE.DoubleSide;

        this.auroraMesh = new THREE.Mesh(geometry, material);
        this.auroraMesh.position.y = 200;
        this.auroraMesh.renderOrder = 5;
        this.scene.add(this.auroraMesh);
    }

    triggerCombo(level, originPos) {
        this.activeCombos.push({ age: 0, level, origin: originPos.clone() });

        // Boost Aurora — accumulates across combos
        this.auroraGoal = Math.min((this.auroraGoal || 0) + level * 0.4, 1.2);

        // Spawn Flock — more per combo, finds any truly inactive slot (phase > 1.0)
        const spawnFlock = level * 30;
        let spawnedF = 0;
        for (let i = 0; i < this.flockCount && spawnedF < spawnFlock; i++) {
            if (this.flockData[i * 5 + 3] > 1.0) { // inactive: phase past alive range or 999
                this.flockData[i * 5]     = originPos.x + (Math.random() - 0.5) * 40;
                this.flockData[i * 5 + 1] = originPos.y + Math.random() * 20;
                this.flockData[i * 5 + 2] = originPos.z + (Math.random() - 0.5) * 40;
                this.flockData[i * 5 + 3] = 0;                       // reset phase
                this.flockData[i * 5 + 4] = 60 + Math.random() * 80; // fast upward speed
                spawnedF++;
            }
        }

        // Spawn Starfall — higher, faster, wider for deep-space feel
        if (level > 1) {
            const spawnStars = level * 15;
            let spawnedS = 0;
            for (let i = 0; i < this.starCount && spawnedS < spawnStars; i++) {
                if (this.starData[i * 5 + 3] > 1.0) { // inactive
                    this.starData[i * 5]     = originPos.x + (Math.random() - 0.5) * 600;
                    this.starData[i * 5 + 1] = originPos.y + 600 + Math.random() * 300; // high up
                    this.starData[i * 5 + 2] = originPos.z + (Math.random() - 0.5) * 600;
                    this.starData[i * 5 + 3] = 0;                        // reset phase
                    this.starData[i * 5 + 4] = 200 + Math.random() * 150; // fast fall
                    spawnedS++;
                }
            }
        }
    }

    update(delta, time) {
        this.time += delta;
        const dummy = new THREE.Object3D();

        // Aurora Update
        this.auroraGoal = Math.max(0, (this.auroraGoal || 0) - delta * 0.15);
        this.uAuroraIntensity.value += (this.auroraGoal - this.uAuroraIntensity.value) * delta * 2.0;
        if (this.camera) {
            this.auroraMesh.position.x = this.camera.position.x;
            this.auroraMesh.position.z = this.camera.position.z;
        }

        // Flock Update
        // Phase 0→1 over ~5 seconds (delta * 0.2). Scale is a sin bell curve peaking at 0.5.
        // When phase exceeds 1.0 the slot is freed immediately (999) so new combos can reuse it.
        let fIdx = 0;
        for (let i = 0; i < this.flockCount; i++) {
            let phase = this.flockData[fIdx + 3];
            if (phase <= 1.0) {
                let x = this.flockData[fIdx];
                let y = this.flockData[fIdx + 1];
                let z = this.flockData[fIdx + 2];
                let speed = this.flockData[fIdx + 4];

                // Spiral outward into space — radius grows to ~300 units
                const angle = phase * 4.0 + i;
                const radius = 5 + phase * 300;
                const targetX = (this.camera?.position.x || 0) + Math.cos(angle) * radius;
                const targetZ = (this.camera?.position.z || 0) + Math.sin(angle) * radius;

                x += (targetX - x) * delta * 2.0;
                y += speed * delta;
                z += (targetZ - z) * delta * 2.0;

                phase += delta * 0.2; // 5-second lifetime

                this.flockData[fIdx]     = x;
                this.flockData[fIdx + 1] = y;
                this.flockData[fIdx + 2] = z;
                this.flockData[fIdx + 3] = phase;

                dummy.position.set(x, y, z);
                dummy.lookAt(targetX, y + speed, targetZ);

                // Smooth bell-curve fade: peaks at phase=0.5, zero at 0 and 1
                const scale = Math.sin(phase * Math.PI);
                dummy.scale.set(scale, scale, scale);
                dummy.updateMatrix();
                this.flockMesh.setMatrixAt(i, dummy.matrix);
            } else {
                // Free the slot immediately so the next combo can accumulate here
                if (phase !== 999) this.flockData[fIdx + 3] = 999;
                dummy.scale.set(0, 0, 0);
                dummy.updateMatrix();
                this.flockMesh.setMatrixAt(i, dummy.matrix);
            }
            fIdx += 5;
        }
        this.flockMesh.instanceMatrix.needsUpdate = true;

        // Starfall Update
        // Phase 0→1 over ~5 seconds (delta * 0.2). Scale is a sin bell curve.
        // Particles shoot diagonally at high speed so they vanish into deep space.
        let sIdx = 0;
        for (let i = 0; i < this.starCount; i++) {
            let phase = this.starData[sIdx + 3];
            if (phase <= 1.0) {
                let x = this.starData[sIdx];
                let y = this.starData[sIdx + 1];
                let z = this.starData[sIdx + 2];
                let speed = this.starData[sIdx + 4];

                // Fast diagonal plunge into deep space
                x += speed * 0.7 * delta;
                y -= speed * delta;
                z += speed * 0.5 * delta;

                phase += delta * 0.2; // 5-second lifetime

                this.starData[sIdx]     = x;
                this.starData[sIdx + 1] = y;
                this.starData[sIdx + 2] = z;
                this.starData[sIdx + 3] = phase;

                dummy.position.set(x, y, z);
                dummy.lookAt(x + speed * 0.7, y - speed, z + speed * 0.5);

                // Smooth bell-curve: quick fade in, travels long, fades out
                const scale = Math.sin(phase * Math.PI);
                dummy.scale.set(scale, scale, scale);
                dummy.updateMatrix();
                this.starMesh.setMatrixAt(i, dummy.matrix);
            } else {
                // Free the slot immediately for accumulation
                if (phase !== 999) this.starData[sIdx + 3] = 999;
                dummy.scale.set(0, 0, 0);
                dummy.updateMatrix();
                this.starMesh.setMatrixAt(i, dummy.matrix);
            }
            sIdx += 5;
        }
        this.starMesh.instanceMatrix.needsUpdate = true;
    }

    dispose() {
        this.scene.remove(this.flockMesh);
        this.scene.remove(this.starMesh);
        this.scene.remove(this.auroraMesh);
        this.flockMesh.geometry.dispose();
        this.flockMesh.material.dispose();
        this.starMesh.geometry.dispose();
        this.starMesh.material.dispose();
        this.auroraMesh.geometry.dispose();
        this.auroraMesh.material.dispose();
    }
}
