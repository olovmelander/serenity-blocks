import * as THREE from 'three/webgpu';
import {
    attribute,
    clamp,
    cos,
    float,
    fract,
    mix,
    mx_noise_float,
    pow,
    sin,
    smoothstep,
    time,
    uniform,
    vec3,
    TWO_PI,
} from 'three/tsl';

type TornadoParticleParams = {
    emissiveColor: string;
    timeScale: number;
    parabolaStrength: number;
    parabolaOffset: number;
    parabolaAmplitude: number;
};

type TornadoParticleConfig = {
    count: number;
    height: number;
    radiusBottom: number;
    radiusTop: number;
    turns: number;
    spinSpeed: number;
    noiseAmplitude: number;
    liftSpeed: number;
    sizeMin: number;
    sizeMax: number;
    params: TornadoParticleParams;
};

export class TornadoParticles {
    group: THREE.Group;
    points: THREE.Points;
    private uTimeScale: ReturnType<typeof uniform>;
    private uParabolaStrength: ReturnType<typeof uniform>;
    private uParabolaOffset: ReturnType<typeof uniform>;
    private uParabolaAmplitude: ReturnType<typeof uniform>;
    private uEmissiveColor: ReturnType<typeof uniform>;

    constructor(config: TornadoParticleConfig) {
        this.group = new THREE.Group();

        this.uTimeScale = uniform(config.params.timeScale);
        this.uParabolaStrength = uniform(config.params.parabolaStrength);
        this.uParabolaOffset = uniform(config.params.parabolaOffset);
        this.uParabolaAmplitude = uniform(config.params.parabolaAmplitude);
        this.uEmissiveColor = uniform(new THREE.Color(config.params.emissiveColor));

        this.points = this.createPoints(config);
        this.group.add(this.points);
    }

    addToScene(scene: THREE.Scene) {
        scene.add(this.group);
    }

    updateParams(params: Partial<TornadoParticleParams>) {
        if (params.timeScale !== undefined) this.uTimeScale.value = params.timeScale;
        if (params.parabolaStrength !== undefined) this.uParabolaStrength.value = params.parabolaStrength;
        if (params.parabolaOffset !== undefined) this.uParabolaOffset.value = params.parabolaOffset;
        if (params.parabolaAmplitude !== undefined) this.uParabolaAmplitude.value = params.parabolaAmplitude;
        if (params.emissiveColor !== undefined) {
            this.uEmissiveColor.value = new THREE.Color(params.emissiveColor);
        }
    }

    private createPoints(config: TornadoParticleConfig) {
        // Use BufferGeometry for points
        const geometry = new THREE.BufferGeometry();

        // Create position array (dummy, positions come from shader)
        const positions = new Float32Array(config.count * 3);
        const phases = new Float32Array(config.count);
        const radiusOffsets = new Float32Array(config.count);
        const heightOffsets = new Float32Array(config.count);
        const speeds = new Float32Array(config.count);
        const sizes = new Float32Array(config.count);
        const brightness = new Float32Array(config.count);

        for (let i = 0; i < config.count; i += 1) {
            // Dummy positions at origin
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = 0;

            phases[i] = Math.random() * Math.PI * 2;
            radiusOffsets[i] = (Math.random() - 0.5) * 6.0;
            heightOffsets[i] = Math.random();
            speeds[i] = 0.4 + Math.random() * 1.2;
            sizes[i] = config.sizeMin + Math.random() * (config.sizeMax - config.sizeMin);
            brightness[i] = 1.1 + Math.random() * 1.2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aRadiusOffset', new THREE.BufferAttribute(radiusOffsets, 1));
        geometry.setAttribute('aHeightOffset', new THREE.BufferAttribute(heightOffsets, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

        // Use PointsNodeMaterial for GPU-driven points
        const material = new THREE.PointsNodeMaterial({
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
        });

        const aPhase = attribute('aPhase');
        const aRadiusOffset = attribute('aRadiusOffset');
        const aHeightOffset = attribute('aHeightOffset');
        const aSpeed = attribute('aSpeed');
        const aSize = attribute('aSize');
        const aBrightness = attribute('aBrightness');

        const height = float(config.height);
        const halfHeight = float(config.height * 0.5);

        // Particles loop upward through the funnel
        const flow = time.mul(this.uTimeScale).mul(float(config.liftSpeed)).mul(aSpeed).add(aHeightOffset);
        const y = fract(flow).mul(height).sub(halfHeight);
        const u = clamp(y.add(halfHeight).div(height), float(0.0), float(1.0));

        const angle = u.mul(float(config.turns)).mul(TWO_PI)
            .add(time.mul(this.uTimeScale).mul(float(config.spinSpeed)))
            .add(aPhase);

        const baseRadius = mix(float(config.radiusBottom), float(config.radiusTop), u);
        const parabola = pow(u.sub(this.uParabolaOffset), float(2.0))
            .mul(this.uParabolaAmplitude)
            .mul(this.uParabolaStrength);

        const noiseCoord = vec3(
            u.mul(float(2.6)),
            aPhase.mul(float(0.7)),
            time.mul(this.uTimeScale).mul(float(0.35)),
        );
        const wobble = mx_noise_float(noiseCoord).mul(float(2.0)).sub(float(1.0))
            .mul(float(config.noiseAmplitude));

        const radius = baseRadius.add(parabola).add(wobble).add(aRadiusOffset);
        const sinAngle = sin(angle);
        const cosAngle = cos(angle);
        const center = vec3(cosAngle.mul(radius), y, sinAngle.mul(radius));

        const driftNoise = mx_noise_float(
            vec3(aPhase.mul(float(0.6)), u.mul(float(2.0)), time.mul(this.uTimeScale).mul(float(0.6))),
        );
        const drift = driftNoise.mul(float(0.35)).sub(float(0.175));
        const tangent = vec3(sinAngle.mul(float(-1.0)), float(0.0), cosAngle);
        const swirlCenter = center.add(tangent.mul(drift));

        // Set position and size
        material.positionNode = swirlCenter;
        material.sizeNode = aSize.mul(float(80.0)); // Scale up for visibility

        // Height fade for smooth appearance/disappearance
        const heightFade = smoothstep(float(0.0), float(0.15), u)
            .mul(smoothstep(float(1.0), float(0.4), u));

        // Flicker effect
        const flickerNoise = mx_noise_float(
            vec3(aPhase.mul(float(2.0)), time.mul(this.uTimeScale).mul(float(2.0)), u.mul(float(3.0))),
        );
        const flicker = flickerNoise.mul(float(0.4)).add(float(0.6));

        const intensity = heightFade.mul(flicker).mul(aBrightness).mul(float(4.0));

        material.colorNode = this.uEmissiveColor.mul(intensity);
        material.opacityNode = clamp(heightFade.mul(aBrightness).mul(float(0.9)), float(0.0), float(1.0));

        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        points.renderOrder = 5;

        return points;
    }

    dispose() {
        this.group.traverse((object: THREE.Object3D) => {
            if ((object as THREE.Points).geometry) {
                (object as THREE.Points).geometry.dispose();
            }
            const material = (object as THREE.Points).material;
            if (material) {
                if (Array.isArray(material)) {
                    material.forEach((mat) => mat.dispose());
                } else {
                    (material as THREE.Material).dispose();
                }
            }
        });
    }
}
