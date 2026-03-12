import * as THREE from 'three';

const HERO_PARTICLE_BUDGETS = Object.freeze({
    High: Object.freeze({ ribbons: 168, beads: 224 }),
    Ultra: Object.freeze({ ribbons: 256, beads: 336 }),
    Extreme: Object.freeze({ ribbons: 352, beads: 448 }),
});

function getHeroBudgets(qualityName) {
    return HERO_PARTICLE_BUDGETS[qualityName] || HERO_PARTICLE_BUDGETS.High;
}

function hideInstance(mesh, index, matrix) {
    matrix.identity();
    matrix.setPosition(0, -9999, 0);
    mesh.setMatrixAt(index, matrix);
}

export class ElectricDreamsHeroParticles {
    constructor({
        scene,
        camera,
        qualityName = 'High',
        webgpuMaterials = null,
        applyMrtPatch = null,
    } = {}) {
        this.scene = scene;
        this.camera = camera;
        this.qualityName = qualityName;
        this.webgpuMaterials = webgpuMaterials;
        this.applyMrtPatch = typeof applyMrtPatch === 'function' ? applyMrtPatch : null;

        const budgets = getHeroBudgets(qualityName);
        this.ribbonCapacity = budgets.ribbons;
        this.beadCapacity = budgets.beads;

        this.ribbonMesh = null;
        this.beadMesh = null;
        this.ribbonUniforms = null;
        this.beadUniforms = null;
        this.ribbonStates = [];
        this.beadStates = [];
        this.activity = 0;

        this.tempMatrix = new THREE.Matrix4();
        this.tempMatrix2 = new THREE.Matrix4();
        this.tempVec3A = new THREE.Vector3();
        this.tempVec3B = new THREE.Vector3();
        this.tempVec3C = new THREE.Vector3();
        this.tempVec3D = new THREE.Vector3();
        this.tempVec3E = new THREE.Vector3();
        this.tempQuat = new THREE.Quaternion();
        this.tempScale = new THREE.Vector3();

        this.createResources();
    }

    createResources() {
        if (!this.scene || !this.camera || !this.webgpuMaterials) return;

        const ribbonPlane = new THREE.PlaneGeometry(1, 1);
        const beadPlane = new THREE.PlaneGeometry(1, 1);
        const ribbonMaterialResult = this.webgpuMaterials.createHeroRibbonNodeMaterial({ intensity: 1 });
        const beadMaterialResult = this.webgpuMaterials.createHeroBeadNodeMaterial({ intensity: 1 });

        this.applyMrtPatch?.(ribbonMaterialResult.material);
        this.applyMrtPatch?.(beadMaterialResult.material);

        this.ribbonUniforms = ribbonMaterialResult.uniforms;
        this.beadUniforms = beadMaterialResult.uniforms;

        this.ribbonMesh = new THREE.InstancedMesh(ribbonPlane, ribbonMaterialResult.material, this.ribbonCapacity);
        this.ribbonMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.ribbonMesh.instanceColor = new THREE.InstancedBufferAttribute(
            new Float32Array(this.ribbonCapacity * 3),
            3,
        );
        this.ribbonMesh.frustumCulled = false;
        this.ribbonMesh.renderOrder = 5;
        this.scene.add(this.ribbonMesh);

        this.beadMesh = new THREE.InstancedMesh(beadPlane, beadMaterialResult.material, this.beadCapacity);
        this.beadMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.beadMesh.instanceColor = new THREE.InstancedBufferAttribute(
            new Float32Array(this.beadCapacity * 3),
            3,
        );
        this.beadMesh.frustumCulled = false;
        this.beadMesh.renderOrder = 6;
        this.scene.add(this.beadMesh);

        for (let i = 0; i < this.ribbonCapacity; i += 1) {
            this.ribbonStates.push(this.createState('ribbon'));
            hideInstance(this.ribbonMesh, i, this.tempMatrix);
        }
        for (let i = 0; i < this.beadCapacity; i += 1) {
            this.beadStates.push(this.createState('bead'));
            hideInstance(this.beadMesh, i, this.tempMatrix);
        }

        this.ribbonMesh.instanceMatrix.needsUpdate = true;
        this.beadMesh.instanceMatrix.needsUpdate = true;
        this.ribbonMesh.instanceColor.needsUpdate = true;
        this.beadMesh.instanceColor.needsUpdate = true;
    }

    createState(type) {
        return {
            type,
            behavior: 'streamer',
            active: false,
            age: 0,
            life: 0.4,
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            color: new THREE.Color(0xffffff),
            normal: new THREE.Vector3(0, 0, 1),
            width: 0.4,
            length: 2.5,
            brightness: 1,
            drag: 0.94,
            phase: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.3,
        };
    }

    acquireState(type) {
        const states = type === 'bead' ? this.beadStates : this.ribbonStates;
        const inactiveIndex = states.findIndex((state) => state.active !== true);
        if (inactiveIndex >= 0) return { state: states[inactiveIndex], index: inactiveIndex };

        let oldestIndex = 0;
        let oldestRatio = -1;
        for (let i = 0; i < states.length; i += 1) {
            const state = states[i];
            const ratio = state.age / Math.max(state.life, 0.0001);
            if (ratio > oldestRatio) {
                oldestRatio = ratio;
                oldestIndex = i;
            }
        }
        return { state: states[oldestIndex], index: oldestIndex };
    }

    emitStreamers(options = {}) {
        if (!this.ribbonMesh) return;

        const {
            origin = new THREE.Vector3(),
            count = 24,
            palette = [new THREE.Color(0x00ffcc)],
            direction = new THREE.Vector3(0, 0, 1),
            sourcePositions = [],
            sourceAnchors = [],
            spread = 0.8,
            speedMin = 10,
            speedMax = 18,
            lifeMin = 0.3,
            lifeMax = 0.65,
            widthMin = 0.18,
            widthMax = 0.45,
            lengthMin = 2.2,
            lengthMax = 6.2,
            towardCamera = 0.65,
            lateralBias = 0.55,
            sheetAxis = null,
            normalBias = 0,
            behavior = 'streamer',
        } = options;

        for (let i = 0; i < count; i += 1) {
            const { state } = this.acquireState('ribbon');
            const anchor = sourceAnchors.length > 0
                ? sourceAnchors[i % sourceAnchors.length]
                : null;
            const emitter = anchor?.position || (sourcePositions.length > 0
                ? sourcePositions[i % sourcePositions.length]
                : origin);
            const emitterDirection = anchor?.direction || direction;
            const emitterNormal = anchor?.normal || null;
            state.active = true;
            state.behavior = anchor?.behavior || behavior;
            state.age = 0;
            state.life = THREE.MathUtils.lerp(lifeMin, lifeMax, Math.random());
            state.position.copy(emitter).lerp(origin, sourcePositions.length > 0 ? 0.22 + Math.random() * 0.12 : 0);

            this.tempVec3A.copy(emitterDirection).normalize();
            this.tempVec3B.set(Math.random() - 0.5, Math.random() - 0.5, 0);
            if (sheetAxis) {
                this.tempVec3B.add(sheetAxis);
            }
            this.tempVec3B.normalize();

            this.tempVec3C.copy(this.tempVec3A)
                .multiplyScalar(0.8)
                .add(this.tempVec3B.multiplyScalar(spread))
                .add(this.tempVec3D.set((Math.random() - 0.5) * lateralBias, (Math.random() - 0.5) * lateralBias, towardCamera))
                .add(emitterNormal ? this.tempVec3E.copy(emitterNormal).multiplyScalar(normalBias) : this.tempVec3E.set(0, 0, 0))
                .normalize();

            const speed = THREE.MathUtils.lerp(speedMin, speedMax, Math.random());
            state.velocity.copy(this.tempVec3C).multiplyScalar(speed);
            if (emitterNormal) {
                state.normal.copy(emitterNormal);
            } else {
                state.normal.set(0, 0, 1);
            }
            state.color.copy(palette[i % palette.length]);
            state.color.offsetHSL((Math.random() - 0.5) * 0.02, 0.04, 0.04);
            state.width = THREE.MathUtils.lerp(widthMin, widthMax, Math.random());
            state.length = THREE.MathUtils.lerp(lengthMin, lengthMax, Math.random());
            state.brightness = 0.8 + Math.random() * 0.4;
            state.drag = 0.92 + Math.random() * 0.03;
            state.phase = Math.random() * Math.PI * 2;
            state.spin = (Math.random() - 0.5) * 0.25;
        }
    }

    emitBeads(options = {}) {
        if (!this.beadMesh) return;

        const {
            origin = new THREE.Vector3(),
            count = 16,
            palette = [new THREE.Color(0xffffff)],
            direction = new THREE.Vector3(0, 0, 1),
            sourcePositions = [],
            sourceAnchors = [],
            spread = 0.8,
            speedMin = 8,
            speedMax = 16,
            lifeMin = 0.24,
            lifeMax = 0.52,
            sizeMin = 0.34,
            sizeMax = 0.9,
            normalBias = 0,
            behavior = 'bead',
        } = options;

        for (let i = 0; i < count; i += 1) {
            const { state } = this.acquireState('bead');
            const anchor = sourceAnchors.length > 0
                ? sourceAnchors[i % sourceAnchors.length]
                : null;
            const emitter = anchor?.position || (sourcePositions.length > 0
                ? sourcePositions[i % sourcePositions.length]
                : origin);
            const emitterDirection = anchor?.direction || direction;
            const emitterNormal = anchor?.normal || null;
            state.active = true;
            state.behavior = anchor?.behavior || behavior;
            state.age = 0;
            state.life = THREE.MathUtils.lerp(lifeMin, lifeMax, Math.random());
            state.position.copy(emitter).lerp(origin, sourcePositions.length > 0 ? 0.14 + Math.random() * 0.1 : 0);

            this.tempVec3A.copy(emitterDirection).normalize();
            this.tempVec3B.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            this.tempVec3C.copy(this.tempVec3A)
                .multiplyScalar(0.72)
                .add(this.tempVec3B.multiplyScalar(spread))
                .add(emitterNormal ? this.tempVec3D.copy(emitterNormal).multiplyScalar(normalBias) : this.tempVec3D.set(0, 0, 0))
                .normalize();

            const speed = THREE.MathUtils.lerp(speedMin, speedMax, Math.random());
            state.velocity.copy(this.tempVec3C).multiplyScalar(speed);
            if (emitterNormal) {
                state.normal.copy(emitterNormal);
            } else {
                state.normal.set(0, 0, 1);
            }
            state.color.copy(palette[i % palette.length]);
            state.color.offsetHSL((Math.random() - 0.5) * 0.03, 0.05, 0.06);
            state.width = THREE.MathUtils.lerp(sizeMin, sizeMax, Math.random());
            state.length = state.width;
            state.brightness = 0.9 + Math.random() * 0.5;
            state.drag = 0.93 + Math.random() * 0.03;
            state.phase = Math.random() * Math.PI * 2;
        }
    }

    prewarm(time = 0) {
        if (!this.ribbonMesh || !this.beadMesh) return;
        this.ribbonUniforms.uTime.value = time;
        this.beadUniforms.uTime.value = time;
        this.ribbonUniforms.uIntensity.value = 0.04;
        this.beadUniforms.uIntensity.value = 0.04;

        this.emitStreamers({
            origin: new THREE.Vector3(0, 0, -4),
            count: 6,
            palette: [new THREE.Color(0x00ffcc), new THREE.Color(0xff00ff)],
            direction: new THREE.Vector3(0.1, 0.08, 1),
            spread: 0.3,
            speedMin: 4,
            speedMax: 8,
            lifeMin: 0.16,
            lifeMax: 0.22,
            widthMin: 0.1,
            widthMax: 0.18,
            lengthMin: 0.8,
            lengthMax: 1.6,
        });
        this.emitBeads({
            origin: new THREE.Vector3(0, 0, -4),
            count: 4,
            palette: [new THREE.Color(0x00ffcc)],
            direction: new THREE.Vector3(0.05, 0.02, 1),
            speedMin: 3,
            speedMax: 5,
            lifeMin: 0.14,
            lifeMax: 0.18,
            sizeMin: 0.18,
            sizeMax: 0.32,
        });
    }

    emitSurfaceShears(options = {}) {
        this.emitStreamers({
            behavior: 'surface',
            normalBias: 0.16,
            spread: 0.18,
            speedMin: 5.5,
            speedMax: 9.5,
            lifeMin: 0.14,
            lifeMax: 0.24,
            widthMin: 0.08,
            widthMax: 0.16,
            lengthMin: 0.9,
            lengthMax: 2.1,
            towardCamera: 0.16,
            lateralBias: 0.22,
            ...options,
        });
    }

    emitBridgeRibbons(options = {}) {
        this.emitStreamers({
            behavior: 'bridge',
            normalBias: 0.06,
            spread: 0.22,
            speedMin: 6.5,
            speedMax: 11.5,
            lifeMin: 0.18,
            lifeMax: 0.34,
            widthMin: 0.09,
            widthMax: 0.18,
            lengthMin: 1.2,
            lengthMax: 3.1,
            towardCamera: 0.2,
            lateralBias: 0.14,
            ...options,
        });
    }

    emitHeroCurtain(options = {}) {
        this.emitStreamers({
            behavior: 'curtain',
            normalBias: 0.02,
            spread: 0.48,
            speedMin: 9.5,
            speedMax: 16.5,
            lifeMin: 0.24,
            lifeMax: 0.58,
            widthMin: 0.1,
            widthMax: 0.26,
            lengthMin: 2.4,
            lengthMax: 6.8,
            towardCamera: 0.52,
            lateralBias: 0.24,
            ...options,
        });
    }

    emitShockBeads(options = {}) {
        this.emitBeads({
            behavior: 'shock',
            normalBias: 0.08,
            spread: 0.4,
            speedMin: 7.5,
            speedMax: 14.5,
            lifeMin: 0.16,
            lifeMax: 0.42,
            sizeMin: 0.18,
            sizeMax: 0.42,
            ...options,
        });
    }

    update(delta, time, stageHeat = 0) {
        if (!this.ribbonMesh || !this.beadMesh) return;

        this.activity = 0;
        this.updateRibbons(delta, time, stageHeat);
        this.updateBeads(delta, time, stageHeat);
    }

    updateRibbons(delta, time, stageHeat) {
        const colorArray = this.ribbonMesh.instanceColor.array;

        for (let i = 0; i < this.ribbonStates.length; i += 1) {
            const state = this.ribbonStates[i];
            if (!state.active) {
                hideInstance(this.ribbonMesh, i, this.tempMatrix);
                colorArray[i * 3] = 0;
                colorArray[i * 3 + 1] = 0;
                colorArray[i * 3 + 2] = 0;
                continue;
            }

            state.age += delta;
            const lifeT = state.age / Math.max(state.life, 0.0001);
            if (lifeT >= 1) {
                state.active = false;
                hideInstance(this.ribbonMesh, i, this.tempMatrix);
                colorArray[i * 3] = 0;
                colorArray[i * 3 + 1] = 0;
                colorArray[i * 3 + 2] = 0;
                continue;
            }

            const fade = 1 - lifeT;
            state.velocity.multiplyScalar(state.drag ** (delta * 60));
            if (state.behavior === 'surface') {
                state.velocity.addScaledVector(state.normal, (0.45 + stageHeat * 0.35) * delta);
                state.velocity.x += Math.sin(time * 2.6 + state.phase) * delta * 0.34;
                state.velocity.y += Math.cos(time * 2.2 + state.phase * 1.15) * delta * 0.28;
                state.velocity.z += (0.8 + stageHeat * 1.2) * delta;
            } else if (state.behavior === 'bridge') {
                state.velocity.addScaledVector(state.normal, (0.18 + stageHeat * 0.12) * delta);
                state.velocity.x += Math.sin(time * 2.4 + state.phase * 0.8) * delta * 0.48;
                state.velocity.y += Math.cos(time * 2.1 + state.phase) * delta * 0.36;
                state.velocity.z += (1.2 + stageHeat * 1.6) * delta;
            } else {
                state.velocity.z += (2.2 + stageHeat * 2.6) * delta;
                state.velocity.x += Math.sin(time * 3.2 + state.phase) * delta * 0.8;
                state.velocity.y += Math.cos(time * 2.8 + state.phase * 1.2) * delta * 0.55;
            }
            state.position.addScaledVector(state.velocity, delta);

            this.tempVec3A.copy(this.camera.position).sub(state.position).normalize();
            this.tempVec3B.copy(state.velocity);
            this.tempVec3B.sub(this.tempVec3A.multiplyScalar(this.tempVec3B.dot(this.tempVec3A)));
            if (this.tempVec3B.lengthSq() < 0.0001) {
                this.tempVec3B.set(0, 1, 0);
            }
            this.tempVec3B.normalize();
            this.tempVec3C.crossVectors(this.tempVec3A, this.tempVec3B).normalize();
            this.tempVec3D.copy(this.tempVec3C).multiplyScalar(state.width * (0.9 + fade * 0.2));
            this.tempVec3E.copy(this.tempVec3B).multiplyScalar(state.length * (0.65 + fade * 0.8));
            this.tempMatrix.makeBasis(this.tempVec3D, this.tempVec3E, this.tempVec3A);
            this.tempMatrix.setPosition(state.position);
            this.ribbonMesh.setMatrixAt(i, this.tempMatrix);

            const brightness = fade * fade * state.brightness;
            colorArray[i * 3] = state.color.r * brightness;
            colorArray[i * 3 + 1] = state.color.g * brightness;
            colorArray[i * 3 + 2] = state.color.b * brightness;
            this.activity = Math.max(this.activity, brightness);
        }

        this.ribbonUniforms.uTime.value = time;
        this.ribbonUniforms.uIntensity.value = 0.92 + stageHeat * 0.3;
        this.ribbonMesh.instanceMatrix.needsUpdate = true;
        this.ribbonMesh.instanceColor.needsUpdate = true;
    }

    updateBeads(delta, time, stageHeat) {
        const colorArray = this.beadMesh.instanceColor.array;

        for (let i = 0; i < this.beadStates.length; i += 1) {
            const state = this.beadStates[i];
            if (!state.active) {
                hideInstance(this.beadMesh, i, this.tempMatrix2);
                colorArray[i * 3] = 0;
                colorArray[i * 3 + 1] = 0;
                colorArray[i * 3 + 2] = 0;
                continue;
            }

            state.age += delta;
            const lifeT = state.age / Math.max(state.life, 0.0001);
            if (lifeT >= 1) {
                state.active = false;
                hideInstance(this.beadMesh, i, this.tempMatrix2);
                colorArray[i * 3] = 0;
                colorArray[i * 3 + 1] = 0;
                colorArray[i * 3 + 2] = 0;
                continue;
            }

            const fade = 1 - lifeT;
            state.velocity.multiplyScalar(state.drag ** (delta * 60));
            if (state.behavior === 'shock') {
                state.velocity.addScaledVector(state.normal, (0.18 + stageHeat * 0.14) * delta);
                state.velocity.z += (1.4 + stageHeat * 1.4) * delta;
            } else {
                state.velocity.z += (1.8 + stageHeat * 1.6) * delta;
            }
            state.position.addScaledVector(state.velocity, delta);

            this.tempQuat.copy(this.camera.quaternion);
            this.tempScale.setScalar(state.width * (0.7 + fade * 0.7));
            this.tempMatrix2.compose(state.position, this.tempQuat, this.tempScale);
            this.beadMesh.setMatrixAt(i, this.tempMatrix2);

            const brightness = fade * fade * state.brightness;
            colorArray[i * 3] = state.color.r * brightness;
            colorArray[i * 3 + 1] = state.color.g * brightness;
            colorArray[i * 3 + 2] = state.color.b * brightness;
            this.activity = Math.max(this.activity, brightness * 0.9);
        }

        this.beadUniforms.uTime.value = time;
        this.beadUniforms.uIntensity.value = 0.96 + stageHeat * 0.22;
        this.beadMesh.instanceMatrix.needsUpdate = true;
        this.beadMesh.instanceColor.needsUpdate = true;
    }

    getActivity() {
        return this.activity;
    }

    reset() {
        for (let i = 0; i < this.ribbonStates.length; i += 1) {
            this.ribbonStates[i].active = false;
            hideInstance(this.ribbonMesh, i, this.tempMatrix);
        }
        for (let i = 0; i < this.beadStates.length; i += 1) {
            this.beadStates[i].active = false;
            hideInstance(this.beadMesh, i, this.tempMatrix2);
        }
        if (this.ribbonMesh) {
            this.ribbonMesh.instanceMatrix.needsUpdate = true;
            this.ribbonMesh.instanceColor.array.fill(0);
            this.ribbonMesh.instanceColor.needsUpdate = true;
        }
        if (this.beadMesh) {
            this.beadMesh.instanceMatrix.needsUpdate = true;
            this.beadMesh.instanceColor.array.fill(0);
            this.beadMesh.instanceColor.needsUpdate = true;
        }
        this.activity = 0;
    }

    dispose() {
        this.ribbonMesh?.geometry?.dispose?.();
        this.ribbonMesh?.material?.dispose?.();
        this.scene?.remove?.(this.ribbonMesh);
        this.ribbonMesh = null;

        this.beadMesh?.geometry?.dispose?.();
        this.beadMesh?.material?.dispose?.();
        this.scene?.remove?.(this.beadMesh);
        this.beadMesh = null;

        this.ribbonStates = [];
        this.beadStates = [];
        this.ribbonUniforms = null;
        this.beadUniforms = null;
        this.activity = 0;
    }
}
