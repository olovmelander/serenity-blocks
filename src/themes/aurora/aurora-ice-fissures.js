import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, exp, float, int, length, mix, positionGeometry,
    smoothstep, uniformArray, vec3, vec4,
} from 'three/tsl';
import { createRandom } from './aurora-noise.js';

const SLOTS = 8;
const LIFE = 2.8;

// A stress line has long straight stretches and angular forks. Distance is measured from
// the point of impact, including the journey to a fork, so light reaches the join first.
function fractureGeometry() {
    const positions = [];
    const strokes = [];
    const indices = [];
    const random = createRandom(0x193ab3);
    for (let slot = 0; slot < SLOTS; slot += 1) {
        const stroke = (originX, originZ, heading, start, segments, step, width, forks) => {
            let x = originX;
            let z = originZ;
            let distance = start;
            let direction = heading;
            for (let i = 0; i < segments; i += 1) {
                direction = heading + (direction - heading) * 0.55 + (random() - 0.5) * 0.96;
                const span = step * (0.6 + random() * 0.8);
                const endX = x + Math.cos(direction) * span;
                const endZ = z + Math.sin(direction) * span;
                const index = positions.length / 3;
                for (const [px, pz, along, taper] of [
                    [x, z, distance, 1 - i / segments],
                    [endX, endZ, distance + span, 1 - (i + 1) / segments],
                ]) {
                    for (const side of [-1, 1]) {
                        positions.push(px, 0, pz);
                        strokes.push(slot, along, side, width * (0.3 + taper * 0.7));
                    }
                }
                indices.push(index, index + 1, index + 2, index + 2, index + 1, index + 3);
                if (forks && i > 0 && i < segments - 1 && i % 2 === 0) {
                    const lean = (i % 4 === 0 ? -1 : 1) * (0.58 + random() * 0.7);
                    stroke(endX, endZ, direction + lean, distance + span, 3, step * 0.62, width * 0.66, false);
                }
                x = endX;
                z = endZ;
                distance += span;
            }
        };
        stroke(0, 0, (random() - 0.62) * 0.9, 0, 11, 0.084, 1, true);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('iceStroke', new THREE.Float32BufferAttribute(strokes, 4));
    geometry.setIndex(indices);
    return geometry;
}

export class AuroraIceFissures {
    constructor(parent, uniforms) {
        this.origins = Array.from({ length: SLOTS }, () => new THREE.Vector4(0, 0, -1000, 0));
        this.colors = this.origins.map(() => new THREE.Vector4());
        const origins = uniformArray(this.origins, 'vec4');
        const colors = uniformArray(this.colors, 'vec4');
        const stroke = attribute('iceStroke', 'vec4');
        const slot = int(stroke.x.add(0.5));
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            forceSinglePass: true,
            blending: THREE.AdditiveBlending,
            premultipliedAlpha: true,
            fog: false,
        });
        material.positionNode = Fn(() => {
            const row = origins.element(slot).toVar();
            const world = vec3(
                row.x.add(positionGeometry.x.mul(row.w)),
                0.18,
                row.y.add(positionGeometry.z.mul(abs(row.w))),
            ).toVar();
            // At this grazing angle a line lying flat on the lake vanishes. Give the ice
            // vein a thin vertical face, with a pixel floor for the longest viewing distance.
            const width = length(world.sub(cameraPosition)).div(uniforms.viewHeight).max(0.055);
            return world.add(vec3(0, stroke.z.mul(width).mul(stroke.w.mul(1.3).add(0.6)), 0));
        })();
        material.outputNode = Fn(() => {
            const row = origins.element(slot).toVar();
            const tint = colors.element(slot).toVar();
            const age = uniforms.time.sub(row.z).toVar();
            const passed = age.sub(stroke.y.mul(0.62)).toVar();
            const light = smoothstep(-0.05, 0.06, passed)
                .mul(exp(passed.max(0).mul(-2.6)).mul(0.74).add(0.26))
                .mul(float(1).sub(smoothstep(0.85, LIFE, age)));
            const core = float(1).sub(smoothstep(0.16, 1, abs(stroke.z)));
            const rgb = mix(tint.rgb, vec3(0.65, 0.88, 1), 0.55);
            return vec4(rgb.mul(light).mul(core).mul(tint.w).mul(stroke.w), 0);
        })();
        this.mesh = new THREE.Mesh(fractureGeometry(), material);
        this.mesh.name = 'Aurora — pressure cracks under the ice';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 7;
        // Draw the empty pool once on the loading frame so the first clear already has
        // its pipeline. Park the whole mesh between strikes after that frame.
        this.warmed = false;
        this.mesh.onAfterRender = () => { this.warmed = true; };
        parent.add(this.mesh);
        this.reset();
    }

    followRipple(time, ripple, tangentX, reducedMotion) {
        if (!ripple.fracture) return;
        const {
            fracture, range, azimuth, color,
        } = ripple;
        const depth = 32 + range * 53;
        const halfFrame = Math.min(1.1, tangentX) * depth;
        const side = Math.sign(fracture);
        const strength = Math.abs(fracture);
        const x = Math.tan(azimuth) * depth + side * halfFrame * 0.08;
        const reach = halfFrame * (0.34 + 0.34 * strength) * (reducedMotion ? 0.75 : 1);
        const slot = this.next;
        this.next = (slot + 1) % SLOTS;
        this.origins[slot].set(x, -depth, time, side * reach);
        this.colors[slot].set(color[0], color[1], color[2], (0.38 + strength * 0.58) * (reducedMotion ? 0.6 : 1));
        this.last = time;
    }

    update(time) {
        this.mesh.visible = !this.warmed || time - this.last < LIFE;
    }

    reset() {
        this.next = 0;
        this.last = -Infinity;
        this.origins.forEach((row) => row.set(0, 0, -1000, 0));
        this.mesh.visible = !this.warmed;
    }

    dispose() {
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
