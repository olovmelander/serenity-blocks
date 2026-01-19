import * as THREE from 'three/webgpu';
import {
    attribute,
    cos,
    float,
    length,
    mix,
    mx_noise_float,
    positionLocal,
    sin,
    smoothstep,
    time,
    uniform,
    vec2,
    vec3,
} from 'three/tsl';

type WindStreakParams = {
    emissiveColor: string;
    timeScale: number;
};

type WindStreakConfig = {
    count: number;
    length: number;
    thickness: number;
    baseRadius: number;
    radiusVariation: number;
    heightMin: number;
    heightMax: number;
    params: WindStreakParams;
};

/**
 * TornadoWindStreaks creates horizontal flowing ribbons that spiral around
 * the tornado to give a sense of wind movement and turbulence.
 */
export class TornadoWindStreaks {
    group: THREE.Group;
    private ribbons: THREE.Points[];
    private uEmissiveColor: ReturnType<typeof uniform>;
    private uTimeScale: ReturnType<typeof uniform>;

    constructor(config: WindStreakConfig) {
        this.group = new THREE.Group();
        this.ribbons = [];
        this.uEmissiveColor = uniform(new THREE.Color(config.params.emissiveColor));
        this.uTimeScale = uniform(config.params.timeScale);

        this.createWindStreaks(config);
    }

    addToScene(scene: THREE.Scene) {
        scene.add(this.group);
    }

    update() {
        // No per-frame updates needed - animation handled by shaders
    }

    updateParams(params: Partial<WindStreakParams>) {
        if (params.emissiveColor !== undefined) {
            this.uEmissiveColor.value = new THREE.Color(params.emissiveColor);
        }
        if (params.timeScale !== undefined) {
            this.uTimeScale.value = params.timeScale;
        }
    }

    private createWindStreaks(config: WindStreakConfig) {
        for (let i = 0; i < config.count; i += 1) {
            const ribbon = this.createSingleStreak(config, i);
            this.ribbons.push(ribbon);
            this.group.add(ribbon);
        }
    }

    private createSingleStreak(config: WindStreakConfig, index: number) {
        // Create a curved ribbon as a series of points
        const pointsPerStreak = 50;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(pointsPerStreak * 3);
        const streakOffsets = new Float32Array(pointsPerStreak);
        const streakProgress = new Float32Array(pointsPerStreak);
        const sizes = new Float32Array(pointsPerStreak);
        const brightness = new Float32Array(pointsPerStreak);

        // Per-streak configuration
        const angleStart = (index / config.count) * Math.PI * 2;
        const height = config.heightMin + Math.random() * (config.heightMax - config.heightMin);
        const radius = config.baseRadius + (Math.random() - 0.5) * config.radiusVariation;
        const speedMultiplier = 1.5 + Math.random() * 1.5;
        const spiralTightness = 2.0 + Math.random() * 3.0;

        for (let i = 0; i < pointsPerStreak; i += 1) {
            // Dummy positions - will be set by shader
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = 0;

            const progress = i / (pointsPerStreak - 1);
            streakOffsets[i] = angleStart;
            streakProgress[i] = progress;

            // Size taper - larger in middle, smaller at ends
            const sizeFactor = Math.sin(progress * Math.PI);
            sizes[i] = config.thickness * sizeFactor * (0.8 + Math.random() * 0.4);

            brightness[i] = 0.6 + Math.random() * 0.4;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aStreakOffset', new THREE.BufferAttribute(streakOffsets, 1));
        geometry.setAttribute('aProgress', new THREE.BufferAttribute(streakProgress, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

        const material = new THREE.PointsNodeMaterial({
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
        });

        const aStreakOffset = attribute('aStreakOffset');
        const aProgress = attribute('aProgress');
        const aSize = attribute('aSize');
        const aBrightness = attribute('aBrightness');

        // Spiral parameters
        const streakSpeed = float(speedMultiplier);
        const streakRadius = float(radius);
        const streakHeight = float(height);
        const streakSpiral = float(spiralTightness);

        // Animate the streak spiraling around the tornado
        const animatedAngle = time.mul(this.uTimeScale).mul(float(2.0)).mul(streakSpeed).add(aStreakOffset);
        const spiralAngle = animatedAngle.add(aProgress.mul(streakSpiral));

        // Position along spiral path
        const x = cos(spiralAngle).mul(streakRadius);
        const z = sin(spiralAngle).mul(streakRadius);
        const y = float(streakHeight).sub(aProgress.mul(float(3.0))); // Slight downward curve

        // Add some noise for turbulence
        const noiseCoord = vec3(
            aProgress.mul(float(3.0)),
            time.mul(this.uTimeScale).mul(float(0.8)),
            aStreakOffset.mul(float(0.5)),
        );
        const turbulence = mx_noise_float(noiseCoord).mul(float(0.4));

        material.positionNode = vec3(
            x.add(turbulence),
            y,
            z.add(turbulence),
        );

        material.sizeNode = aSize.mul(float(200.0));

        // Fade at both ends of the streak
        const edgeFade = smoothstep(float(0.0), float(0.1), aProgress)
            .mul(smoothstep(float(1.0), float(0.9), aProgress));

        // Flickering effect
        const flicker = sin(time.mul(this.uTimeScale).mul(float(5.0)).add(aStreakOffset.mul(float(3.0))))
            .mul(float(0.2))
            .add(float(0.8));

        const intensity = edgeFade.mul(flicker).mul(aBrightness).mul(float(1.2));

        material.colorNode = this.uEmissiveColor.mul(intensity);
        material.opacityNode = intensity;

        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        points.renderOrder = 5;

        return points;
    }

    dispose() {
        this.ribbons.forEach((ribbon) => {
            if (ribbon.geometry) {
                ribbon.geometry.dispose();
            }
            const material = ribbon.material;
            if (material) {
                if (Array.isArray(material)) {
                    material.forEach((mat) => mat.dispose());
                } else {
                    material.dispose();
                }
            }
        });
        this.meshes = [];
    }
}
