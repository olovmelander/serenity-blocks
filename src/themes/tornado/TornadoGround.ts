import * as THREE from 'three/webgpu';
import {
    atan,
    clamp,
    float,
    length,
    mx_noise_float,
    positionLocal,
    sin,
    smoothstep,
    time,
    uniform,
    vec2,
    vec3,
} from 'three/tsl';

type TornadoGroundParams = {
    emissiveColor: string;
    timeScale: number;
};

type TornadoGroundConfig = {
    innerRadius: number;
    outerRadius: number;
    segments: number;
    params: TornadoGroundParams;
};

export class TornadoGround {
    mesh: THREE.Mesh | null;
    private uEmissiveColor: ReturnType<typeof uniform>;
    private uTimeScale: ReturnType<typeof uniform>;

    constructor(config: TornadoGroundConfig) {
        this.mesh = null;
        this.uEmissiveColor = uniform(new THREE.Color(config.params.emissiveColor));
        this.uTimeScale = uniform(config.params.timeScale);

        this.mesh = this.createRing(config);
    }

    addToScene(scene: THREE.Scene) {
        if (this.mesh) {
            scene.add(this.mesh);
        }
    }

    updateParams(params: Partial<TornadoGroundParams>) {
        if (params.emissiveColor !== undefined) {
            this.uEmissiveColor.value = new THREE.Color(params.emissiveColor);
        }
        if (params.timeScale !== undefined) {
            this.uTimeScale.value = params.timeScale;
        }
    }

    private createRing(config: TornadoGroundConfig) {
        const geometry = new THREE.RingGeometry(
            config.innerRadius,
            config.outerRadius,
            config.segments,
            4,
        );

        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.FrontSide, // Performance: Cull back faces (not visible)
        });

        const radialCoord = vec2(positionLocal.x, positionLocal.y);
        const radius = length(radialCoord);
        const angle = atan(positionLocal.y, positionLocal.x);

        const swirlSpeed = time.mul(this.uTimeScale).mul(float(0.6));
        const swirlTightness = radius.mul(float(1.4));
        const swirlAngle = angle.add(swirlTightness).add(swirlSpeed);

        const stripe = sin(swirlAngle.mul(float(18.0))).mul(float(0.5)).add(float(0.5));
        const noise = mx_noise_float(vec3(radialCoord.mul(float(0.35)), time.mul(this.uTimeScale).mul(float(0.3))));
        const streak = smoothstep(float(0.5), float(0.9), stripe.add(noise.mul(float(0.35))));

        const innerFade = smoothstep(float(config.innerRadius), float(config.innerRadius + 0.5), radius);
        const outerFade = smoothstep(float(config.outerRadius - 0.6), float(config.outerRadius), radius);
        const ringFade = innerFade.mul(float(1.0).sub(outerFade));

        // Swirl mask blends sine stripes with noise for broken ground streaks.
        const intensity = clamp(ringFade.mul(streak).mul(float(1.6)), float(0.0), float(1.0));

        const emissive = this.uEmissiveColor.mul(intensity);
        material.colorNode = emissive.mul(float(0.25));
        material.emissiveNode = emissive;
        material.opacityNode = intensity.mul(float(0.9));

        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = -3.9;
        mesh.frustumCulled = true; // Performance: Enable automatic culling when off-screen

        return mesh;
    }

    dispose() {
        if (!this.mesh) return;
        if (this.mesh.geometry) {
            this.mesh.geometry.dispose();
        }
        const material = this.mesh.material;
        if (material) {
            if (Array.isArray(material)) {
                material.forEach((mat) => mat.dispose());
            } else {
                material.dispose();
            }
        }
        this.mesh = null;
    }
}
