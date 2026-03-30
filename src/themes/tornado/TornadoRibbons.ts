import * as THREE from 'three/webgpu';
import {
    attribute,
    clamp,
    cos,
    float,
    mix,
    mx_noise_float,
    positionLocal,
    pow,
    sin,
    smoothstep,
    time,
    uniform,
    uv,
    vec2,
    vec3,
    TWO_PI,
} from 'three/tsl';

type TornadoRibbonParams = {
    emissiveColor: string;
    timeScale: number;
    ribbonWidth: number;
    parabolaStrength: number;
    parabolaOffset: number;
    parabolaAmplitude: number;
};

type TornadoRibbonConfig = {
    count: number;
    segments: number;
    height: number;
    width: number;
    radiusBottom: number;
    radiusTop: number;
    turns: number;
    spinSpeed: number;
    noiseAmplitude: number;
    twistAmount: number;
    twistFrequency: number;
    params: TornadoRibbonParams;
};

export class TornadoRibbons {
    group: THREE.Group;
    private mesh: THREE.InstancedMesh;
    private uTimeScale: ReturnType<typeof uniform>;
    private uRibbonWidth: ReturnType<typeof uniform>;
    private uParabolaStrength: ReturnType<typeof uniform>;
    private uParabolaOffset: ReturnType<typeof uniform>;
    private uParabolaAmplitude: ReturnType<typeof uniform>;
    private uEmissiveColor: ReturnType<typeof uniform>;

    constructor(config: TornadoRibbonConfig) {
        this.group = new THREE.Group();

        this.uTimeScale = uniform(config.params.timeScale);
        this.uRibbonWidth = uniform(config.params.ribbonWidth);
        this.uParabolaStrength = uniform(config.params.parabolaStrength);
        this.uParabolaOffset = uniform(config.params.parabolaOffset);
        this.uParabolaAmplitude = uniform(config.params.parabolaAmplitude);
        this.uEmissiveColor = uniform(new THREE.Color(config.params.emissiveColor));

        this.mesh = this.createMesh(config);
        this.group.add(this.mesh);
    }

    addToScene(scene: THREE.Scene) {
        scene.add(this.group);
    }

    updateParams(params: Partial<TornadoRibbonParams>) {
        if (params.timeScale !== undefined) this.uTimeScale.value = params.timeScale;
        if (params.ribbonWidth !== undefined) this.uRibbonWidth.value = params.ribbonWidth;
        if (params.parabolaStrength !== undefined) this.uParabolaStrength.value = params.parabolaStrength;
        if (params.parabolaOffset !== undefined) this.uParabolaOffset.value = params.parabolaOffset;
        if (params.parabolaAmplitude !== undefined) this.uParabolaAmplitude.value = params.parabolaAmplitude;
        if (params.emissiveColor !== undefined) {
            this.uEmissiveColor.value = new THREE.Color(params.emissiveColor);
        }
    }

    private createMesh(config: TornadoRibbonConfig) {
        const geometry = new THREE.PlaneGeometry(
            config.width,
            config.height,
            1,
            config.segments,
        );

        const phases = new Float32Array(config.count);
        const radiusOffsets = new Float32Array(config.count);
        const widthScales = new Float32Array(config.count);
        const streakOffsets = new Float32Array(config.count);
        const brightness = new Float32Array(config.count);

        for (let i = 0; i < config.count; i += 1) {
            phases[i] = Math.random() * Math.PI * 2;
            radiusOffsets[i] = (Math.random() - 0.5) * 0.6;
            widthScales[i] = 0.9 + Math.random() * 1.0;
            streakOffsets[i] = Math.random() * 6.0;
            brightness[i] = 0.7 + Math.random() * 0.7;
        }

        geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
        geometry.setAttribute('aRadiusOffset', new THREE.InstancedBufferAttribute(radiusOffsets, 1));
        geometry.setAttribute('aWidthScale', new THREE.InstancedBufferAttribute(widthScales, 1));
        geometry.setAttribute('aStreakOffset', new THREE.InstancedBufferAttribute(streakOffsets, 1));
        geometry.setAttribute('aBrightness', new THREE.InstancedBufferAttribute(brightness, 1));

        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.FrontSide, // Performance: Cull back faces (not visible in tornado)
        });

        const aPhase = attribute('aPhase');
        const aRadiusOffset = attribute('aRadiusOffset');
        const aWidthScale = attribute('aWidthScale');
        const aStreakOffset = attribute('aStreakOffset');
        const aBrightness = attribute('aBrightness');

        const height = float(config.height);
        const halfHeight = float(config.height * 0.5);
        // u = normalized height along the ribbon (0 = base, 1 = top).
        const u = clamp(positionLocal.y.add(halfHeight).div(height), float(0.0), float(1.0));

        // angle winds around the core; timeScale + spinSpeed control rotation rate.
        const angle = u.mul(float(config.turns)).mul(TWO_PI)
            .add(time.mul(this.uTimeScale).mul(float(config.spinSpeed)))
            .add(aPhase);

        // radius blends from tight base to wide top, then bowed via parabola params.
        const baseRadius = mix(float(config.radiusBottom), float(config.radiusTop), u);
        const parabola = pow(u.sub(this.uParabolaOffset), float(2.0))
            .mul(this.uParabolaAmplitude)
            .mul(this.uParabolaStrength);

        // Noise adds turbulent wobble so ribbons feel broken and fast.
        const noiseCoord = vec3(
            u.mul(float(3.0)),
            aPhase.mul(float(0.5)),
            time.mul(this.uTimeScale).mul(float(0.25)),
        );
        const noiseValue = mx_noise_float(noiseCoord).mul(float(2.0)).sub(float(1.0));
        const radius = baseRadius
            .add(parabola)
            .add(noiseValue.mul(float(config.noiseAmplitude)))
            .add(aRadiusOffset);

        const sinAngle = sin(angle);
        const cosAngle = cos(angle);
        const center = vec3(cosAngle.mul(radius), positionLocal.y, sinAngle.mul(radius));

        const widthOffset = positionLocal.x.mul(aWidthScale).mul(this.uRibbonWidth);
        const tangent = vec3(sinAngle.mul(float(-1.0)), float(0.0), cosAngle);
        const twist = sin(
            u.mul(float(config.twistFrequency))
                .add(time.mul(this.uTimeScale).mul(float(0.35)))
                .add(aPhase),
        ).mul(float(config.twistAmount));

        // Width offset rides along the swirl tangent with a subtle twist to avoid flat cards.
        const ribbonPosition = center
            .add(tangent.mul(widthOffset))
            .add(vec3(cosAngle, float(0.0), sinAngle).mul(widthOffset.mul(twist)));

        material.positionNode = ribbonPosition;

        const uvNode = uv();
        const edgeSoft = float(0.12);
        const edgeFade = smoothstep(float(0.0), edgeSoft, uvNode.x)
            .mul(smoothstep(float(0.0), edgeSoft, float(1.0).sub(uvNode.x)));

        const verticalFade = smoothstep(float(0.0), float(0.08), uvNode.y)
            .mul(smoothstep(float(0.0), float(0.2), float(1.0).sub(uvNode.y)));

        // Streaky emission from animated UV noise for broken, fast ribbons.
        const streakUv = uvNode.mul(vec2(float(6.0), float(20.0)))
            .add(vec2(float(0.0), aStreakOffset));
        const streakNoise = mx_noise_float(
            vec3(streakUv, time.mul(this.uTimeScale).mul(float(1.4)).add(aStreakOffset)),
        );
        const streakMask = smoothstep(float(0.3), float(0.7), streakNoise);

        // Performance optimization: Removed second noise layer (breakupNoise)
        // Ribbons still maintain dynamic broken appearance with single noise layer
        const mask = streakMask.mul(edgeFade).mul(verticalFade);
        const intensity = mask.mul(aBrightness).mul(float(2.4));

        const emissive = this.uEmissiveColor.mul(intensity);
        material.colorNode = emissive.mul(float(0.25));
        material.emissiveNode = emissive;
        material.opacityNode = clamp(mask.mul(aBrightness), float(0.0), float(1.0));

        const mesh = new THREE.InstancedMesh(geometry, material, config.count);
        mesh.frustumCulled = true; // Performance: Enable automatic culling when off-screen

        const dummy = new THREE.Object3D();
        for (let i = 0; i < config.count; i += 1) {
            dummy.position.set(0, 0, 0);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;

        return mesh;
    }

    dispose() {
        this.group.traverse((object) => {
            if ((object as THREE.Mesh).geometry) {
                (object as THREE.Mesh).geometry.dispose();
            }
            const material = (object as THREE.Mesh).material;
            if (material) {
                if (Array.isArray(material)) {
                    material.forEach((mat) => mat.dispose());
                } else {
                    material.dispose();
                }
            }
        });
    }
}
