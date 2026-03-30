import * as THREE from 'three/webgpu';
import {
    attribute,
    clamp,
    cos,
    float,
    length,
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

type TornadoBurstConfig = {
    count: number;
    duration: number; // seconds
    radiusMin: number;
    radiusMax: number;
    heightMin: number;
    heightMax: number;
    sizeMin: number;
    sizeMax: number;
    emissiveColor: string;
    intensity: number;
};

/**
 * TornadoBurst creates a temporary burst of particles that spawn from the center
 * and spiral outward/upward, then fade away. Used for combo effects.
 */
export class TornadoBurst {
    group: THREE.Group;
    points: THREE.Points;
    private startTime: number;
    private duration: number;
    private uEmissiveColor: ReturnType<typeof uniform>;
    private uStartTime: ReturnType<typeof uniform>;
    private uDuration: ReturnType<typeof uniform>;
    private uIntensity: ReturnType<typeof uniform>;
    private isComplete: boolean;

    constructor(config: TornadoBurstConfig) {
        this.group = new THREE.Group();
        this.startTime = performance.now() / 1000; // Convert to seconds
        this.duration = config.duration;
        this.isComplete = false;

        this.uEmissiveColor = uniform(new THREE.Color(config.emissiveColor));
        this.uStartTime = uniform(this.startTime);
        this.uDuration = uniform(config.duration);
        this.uIntensity = uniform(config.intensity);

        this.points = this.createPoints(config);
        this.group.add(this.points);
    }

    addToScene(scene: THREE.Scene) {
        scene.add(this.group);
    }

    removeFromScene(scene: THREE.Scene) {
        scene.remove(this.group);
    }

    /**
     * Check if the burst animation is complete
     */
    checkComplete(): boolean {
        const currentTime = performance.now() / 1000;
        this.isComplete = (currentTime - this.startTime) >= this.duration;
        return this.isComplete;
    }

    private createPoints(config: TornadoBurstConfig) {
        const geometry = new THREE.BufferGeometry();

        // Create arrays for per-particle attributes
        const positions = new Float32Array(config.count * 3);
        const phases = new Float32Array(config.count);
        const radiusOffsets = new Float32Array(config.count);
        const heightOffsets = new Float32Array(config.count);
        const speeds = new Float32Array(config.count);
        const sizes = new Float32Array(config.count);
        const brightness = new Float32Array(config.count);
        const spiralSpeeds = new Float32Array(config.count);

        for (let i = 0; i < config.count; i += 1) {
            // Dummy positions at origin
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = 0;

            phases[i] = Math.random() * Math.PI * 2;
            radiusOffsets[i] = config.radiusMin + Math.random() * (config.radiusMax - config.radiusMin);
            heightOffsets[i] = config.heightMin + Math.random() * (config.heightMax - config.heightMin);
            speeds[i] = 0.5 + Math.random() * 1.5;
            sizes[i] = config.sizeMin + Math.random() * (config.sizeMax - config.sizeMin);
            brightness[i] = 0.8 + Math.random() * 0.8;
            spiralSpeeds[i] = 1.0 + Math.random() * 2.0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aRadiusOffset', new THREE.BufferAttribute(radiusOffsets, 1));
        geometry.setAttribute('aHeightOffset', new THREE.BufferAttribute(heightOffsets, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));
        geometry.setAttribute('aSpiralSpeed', new THREE.BufferAttribute(spiralSpeeds, 1));

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
        const aSpiralSpeed = attribute('aSpiralSpeed');

        // Calculate progress (0 to 1) based on time elapsed since burst creation
        const elapsed = time.sub(this.uStartTime);
        const progress = clamp(elapsed.div(this.uDuration), float(0.0), float(1.0));

        // Particles spiral outward and upward
        const expandRadius = progress.mul(aRadiusOffset).mul(aSpeed);
        const angle = progress.mul(TWO_PI).mul(float(3.0)).mul(aSpiralSpeed).add(aPhase);

        const sinAngle = sin(angle);
        const cosAngle = cos(angle);

        // Add some noise to the motion
        const noiseCoord = vec3(
            progress.mul(float(2.0)),
            aPhase.mul(float(0.8)),
            time.mul(float(0.5)),
        );
        const wobble = mx_noise_float(noiseCoord).mul(float(2.0)).sub(float(1.0)).mul(float(2.0));

        const x = cosAngle.mul(expandRadius).add(wobble);
        const z = sinAngle.mul(expandRadius).add(wobble);
        const y = progress.mul(aHeightOffset).mul(aSpeed).add(float(-2.0));

        material.positionNode = vec3(x, y, z);
        material.sizeNode = aSize.mul(float(100.0));

        // Fade in at start, fade out at end
        const fadeIn = smoothstep(float(0.0), float(0.15), progress);
        const fadeOut = smoothstep(float(1.0), float(0.7), progress);
        const lifeFade = fadeIn.mul(fadeOut);

        // Flicker effect
        const flickerNoise = mx_noise_float(
            vec3(aPhase.mul(float(3.0)), time.mul(float(3.0)), progress.mul(float(5.0))),
        );
        const flicker = flickerNoise.mul(float(0.5)).add(float(0.5));

        const intensity = lifeFade.mul(flicker).mul(aBrightness).mul(this.uIntensity).mul(float(3.0));

        material.colorNode = this.uEmissiveColor.mul(intensity);
        material.opacityNode = clamp(lifeFade.mul(aBrightness).mul(float(0.8)), float(0.0), float(1.0));

        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        points.renderOrder = 10; // Render on top

        return points;
    }

    dispose() {
        if (this.points.geometry) {
            this.points.geometry.dispose();
        }
        const material = this.points.material;
        if (material) {
            if (Array.isArray(material)) {
                material.forEach((mat) => mat.dispose());
            } else {
                (material as THREE.Material).dispose();
            }
        }
    }
}
