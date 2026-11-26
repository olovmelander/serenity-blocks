import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, exp,
    length, max, mul, sin, smoothstep, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { flashScale } from '../../utils/photosensitivity.js';
import { DIRECTOR_LIMITS } from './black-hole-director.js';

// A pressure front illuminates gas above the plane. Each strip is an incomplete crest whose
// angular extent is in radians, radial distance is in Schwarzschild radii, and delay is seconds.
// Scales and bearings differ between crests so their profiles stay legible even exactly edge-on.
const ECHOES = {
    single: {
        tint: [1, 0.46, 0.14],
        from: 4.25,
        to: 8.3,
        life: 1.33,
        width: 0.43,
        arcs: [[0.24, 2.75, 1, 0]],
    },
    double: {
        tint: [0.29, 0.76, 1],
        from: 3.75,
        to: 8.6,
        life: 1.48,
        width: 0.49,
        arcs: [[-0.94, 2.14, 1, 0], [2.13, 2.3, 1.07, 0.11]],
    },
    triple: {
        tint: [1, 0.3, 0.10],
        from: 3.68,
        to: 9.65,
        life: 1.55,
        width: 0.59,
        arcs: [[0.02, 2.06, 1.1, 0], [2.3, 1.63, 0.87, 0.10], [4.24, 1.76, 1.0, 0.21]],
    },
    cascade: {
        tint: [0.59, 0.71, 1],
        from: 3.8,
        to: 7.7,
        life: 1.19,
        width: 0.44,
        arcs: [[2.72, 2.84, 1, 0], [3.38, 1.62, 0.82, 0.16]],
    },
    level: {
        tint: [0.20, 1, 0.80],
        from: 10.4,
        to: 4.2,
        life: 1.89,
        width: 0.8,
        arcs: [[0.06, 3.0, 1, 0.02], [2.97, 3.0, 1.02, 0.19], [0.75, 2.62, 0.83, 0.30]],
    },
    over: {
        tint: [0.97, 0.18, 0.075],
        from: 9.5,
        to: 3.28,
        life: 2.62,
        width: 0.73,
        arcs: [[2.96, 3.14, 1, 0], [3.56, 2.37, 0.76, 0.13]],
    },
    release: {
        tint: [0.79, 0.52, 0.33],
        from: 4.2,
        to: 9.2,
        life: 2,
        width: 0.69,
        arcs: [[3.3, 2.76, 1, 0], [0, 1.5, 1.06, 0.16]],
    },
};
const STRIDE = 12;
const TAU = Math.PI * 2;
const NAME = 'Black Hole — caustic echoes';

export class BlackHoleEchoes {
    constructor(parent, u) {
        const capacity = DIRECTOR_LIMITS.waves * 3;
        const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1, 64, 1));
        const buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(capacity * STRIDE), STRIDE, 1);
        buffer.setUsage(THREE.DynamicDrawUsage);
        this.buffer = buffer;
        for (const [name, offset] of [['crestArc', 0], ['crestTint', 4], ['crestShape', 8]]) {
            geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, offset));
        }
        const arc = attribute('crestArc', 'vec4'); // radius, width, start angle, sweep
        const tint = attribute('crestTint', 'vec4'); // HDR colour and local intensity
        const shape = attribute('crestShape', 'vec4'); // profile phase, ellipticity, radial warp, winding
        const light = varying(tint.rgb.mul(tint.w));
        const phase = varying(shape.x);
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthTest: false,
            depthWrite: false,
            fog: false,
            blending: THREE.AdditiveBlending,
            premultipliedAlpha: true,
            side: THREE.DoubleSide,
        });
        material.name = NAME;
        material.forceSinglePass = true;
        material.vertexNode = Fn(() => {
            const t = uv().x.toVar();
            const az = arc.z.add(t.mul(arc.w)).toVar();
            const bearing = cameraViewMatrix.mul(vec4(u.diskToWorld.mul(vec3(0, 1, 0)), 0)).xy.add(vec2(0, 0.025));
            const up = bearing.div(max(length(bearing), 0.001)).toVar();
            const across = vec2(up.y, up.x.negate());
            const warp = sin(az.mul(3).add(shape.x)).mul(0.44)
                .add(sin(az.mul(7).sub(shape.x.mul(1.1))).mul(0.13))
                .add(t.sub(0.5).mul(shape.w))
                .mul(shape.z);
            const radius = arc.x.add(warp).add(uv().y.mul(2).sub(1).mul(arc.y));
            const direction = across.mul(cos(az)).add(up.mul(sin(az).mul(shape.y)));
            const centre = cameraViewMatrix.mul(vec4(u.holePosition, 1));
            const offset = direction.mul(radius).mul(u.rs);
            return cameraProjectionMatrix.mul(vec4(centre.xy.add(offset), centre.z, 1));
        })();
        material.outputNode = Fn(() => {
            const t = clamp(uv().x, 0, 1).toVar();
            const cross = clamp(uv().y.mul(2).sub(1), -1, 1).toVar();
            const ys = mul(cross, cross).toVar();
            const tips = smoothstep(0, 0.16, t).mul(smoothstep(0, 0.24, t.oneMinus()));
            const filaments = sin(t.mul(52).add(phase).add(sin(t.mul(23).sub(phase)).mul(2.3))).toVar();
            const ribs = filaments.mul(0.24).add(0.76);
            const crest = cross.sub(filaments.mul(0.093));
            const knot = smoothstep(0.1, 0.93, sin(t.mul(17).add(phase)));
            const fork = cross.sub(0.36).sub(filaments.mul(0.14));
            const bright = exp(crest.mul(crest).mul(-66)).mul(1.32)
                .add(exp(ys.mul(-7.5)).mul(0.26))
                .add(exp(fork.mul(fork).mul(-63)).mul(knot).mul(0.41));
            const wake = abs(cross.add(0.52).add(sin(t.mul(14).add(phase)).mul(0.05)));
            const lightAcross = bright.add(exp(wake.mul(wake).mul(-62)).mul(0.15));
            return vec4(light.mul(lightAcross).mul(tips).mul(ribs), 0);
        })();
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.name = NAME;
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 34;
        this.mesh.visible = false;
        geometry.instanceCount = 1; // one zero-energy strip during warmup
        parent.add(this.mesh);
    }

    update(director) {
        const { array } = this.buffer;
        const motion = director.reducedMotion ? 0.22 : 1;
        const exposure = 0.66 + 0.34 * flashScale();
        let count = 0;
        for (const wave of director.waves) {
            const look = ECHOES[wave.cue];
            if (!wave.active || !look) continue;
            const energy = exposure * (0.78 + Math.min(1.3, wave.peak) * 0.44);
            for (const [start, span, scale, delay] of look.arcs) {
                const t = (wave.age - delay) / look.life;
                if (t <= 0 || t >= 1) continue;
                const ease = 1 - (1 - t) ** 1.5;
                const at = motion * ease + (1 - motion) * 0.44;
                const i = count * STRIDE;
                array[i] = (look.from + (look.to - look.from) * at) * scale;
                array[i + 1] = look.width * (0.77 + t * 0.72);
                array[i + 2] = start + motion * t * 0.38;
                array[i + 3] = span;
                array[i + 4] = look.tint[0];
                array[i + 5] = look.tint[1];
                array[i + 6] = look.tint[2];
                // The crest rises over several frames, then disappears into the surrounding gas.
                const rise = Math.min(1, t / 0.16);
                array[i + 7] = energy * rise * rise * (3 - 2 * rise) * (1 - t ** 2) ** 1.8;
                array[i + 8] = start * 2 + motion * t * TAU * 0.32;
                array[i + 9] = 0.84 + delay * 0.25;
                array[i + 10] = 0.65 + delay * 0.45;
                array[i + 11] = 0.9 + scale * 0.4;
                count += 1;
            }
        }
        this.mesh.visible = count > 0;
        this.mesh.geometry.instanceCount = Math.max(1, count);
        if (count) this.buffer.needsUpdate = true;
    }

    dispose() {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this.mesh.removeFromParent();
    }
}
