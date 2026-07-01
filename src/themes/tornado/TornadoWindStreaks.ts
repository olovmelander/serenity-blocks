import * as THREE from 'three/webgpu';
import {
    attribute,
    cos,
    float,
    mx_noise_float,
    sin,
    smoothstep,
    time,
    uniform,
    vec3,
} from 'three/tsl';

type WindStreakParams = {
    emissiveColor: string;
    timeScale: number;
};

type WindStreakConfig = {
    count: number;
    pointsPerStreak?: number;
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

        this.createWindStreaksMerged(config);
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

    private createWindStreaksMerged(config: WindStreakConfig) {
        // Tier-scaled point density along each streak (was a hard-coded 50 that
        // escaped QUALITY_PRESETS). Streaks are soft overlapping additive sprites
        // (edgeFade + sizeAttenuation) so lowering density is sub-perceptual while
        // cutting the wind-streak fill that dominates the tornado column.
        const pointsPerStreak = config.pointsPerStreak ?? 50;
        const totalPoints = config.count * pointsPerStreak;

        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(totalPoints * 3);
        const streakOffsets = new Float32Array(totalPoints);
        const streakProgress = new Float32Array(totalPoints);
        const sizes = new Float32Array(totalPoints);
        const brightness = new Float32Array(totalPoints);
        const streakParams = new Float32Array(totalPoints * 4); // radius, height, speed, spiral

        let ptr = 0;

        for (let i = 0; i < config.count; i++) {
            // Per-streak configuration
            const angleStart = (i / config.count) * Math.PI * 2;
            const height = config.heightMin + Math.random() * (config.heightMax - config.heightMin);
            const radius = config.baseRadius + (Math.random() - 0.5) * config.radiusVariation;
            const speedMultiplier = 1.5 + Math.random() * 1.5;
            const spiralTightness = 2.0 + Math.random() * 3.0;

            // Generate points for this streak
            for (let j = 0; j < pointsPerStreak; j++) {
                // Dummy positions - will be set by shader
                positions[ptr * 3] = 0;
                positions[ptr * 3 + 1] = 0;
                positions[ptr * 3 + 2] = 0;

                const progress = j / (pointsPerStreak - 1);

                streakOffsets[ptr] = angleStart;
                streakProgress[ptr] = progress;

                // Size taper
                const sizeFactor = Math.sin(progress * Math.PI);
                sizes[ptr] = config.thickness * sizeFactor * (0.8 + Math.random() * 0.4);

                brightness[ptr] = 0.6 + Math.random() * 0.4;

                // Pack params
                streakParams[ptr * 4] = radius;
                streakParams[ptr * 4 + 1] = height;
                streakParams[ptr * 4 + 2] = speedMultiplier;
                streakParams[ptr * 4 + 3] = spiralTightness;

                ptr++;
            }
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aStreakOffset', new THREE.BufferAttribute(streakOffsets, 1));
        geometry.setAttribute('aProgress', new THREE.BufferAttribute(streakProgress, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));
        geometry.setAttribute('aStreakParams', new THREE.BufferAttribute(streakParams, 4));

        const material = new THREE.PointsNodeMaterial({
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
        });

        const aStreakOffset = attribute('aStreakOffset', 'float');
        const aProgress = attribute('aProgress', 'float');
        const aSize = attribute('aSize', 'float');
        const aBrightness = attribute('aBrightness', 'float');
        const aStreakParams = attribute('aStreakParams', 'vec4'); // vec4(radius, height, speed, spiral)

        // Unpack params from attribute
        const streakRadius = aStreakParams.x;
        const streakHeight = aStreakParams.y;
        const streakSpeed = aStreakParams.z;
        const streakSpiral = aStreakParams.w;

        // Animate the streak spiraling around the tornado
        const animatedAngle = time.mul(this.uTimeScale).mul(float(2.0)).mul(streakSpeed).add(aStreakOffset);
        const spiralAngle = animatedAngle.add(aProgress.mul(streakSpiral));

        // Position along spiral path
        const x = cos(spiralAngle).mul(streakRadius);
        const z = sin(spiralAngle).mul(streakRadius);
        const y = streakHeight.sub(aProgress.mul(float(3.0))); // Slight downward curve

        // Add some noise for turbulence (using baked-in seed from offset + progress)
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

        material.sizeNode = aSize.mul(float(200.0)); // Adjusted scalar for visibility

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

        // Add single points object
        this.ribbons.push(points);
        this.group.add(points);
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
        this.ribbons = [];
    }
}
