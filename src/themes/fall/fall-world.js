/** The same autumn artwork runs in the isolated bench and both player backends. */
import * as THREE from 'three/webgpu';
import {
    color, cos, exp, float, fract, instancedBufferAttribute, length, mix,
    normalize, positionGeometry, positionLocal, sin, smoothstep, uniform, uv, vec3,
} from 'three/tsl';
import { FallForest } from './fall-forest.js';
import { FALL_REACTION_LIMITS } from './fall-reactions.js';

export const FALL_WORLD_BUDGETS = Object.freeze({
    Minimal: {
        leaves: 160, motes: 60, rays: 4, burstLeaves: 14,
    },
    Low: {
        leaves: 240, motes: 90, rays: 5, burstLeaves: 18,
    },
    Medium: {
        leaves: 400, motes: 150, rays: 6, burstLeaves: 24,
    },
    High: {
        leaves: 700, motes: 230, rays: 8, burstLeaves: 32,
    },
    Ultra: {
        leaves: 1000, motes: 320, rays: 10, burstLeaves: 40,
    },
    Extreme: {
        leaves: 1400, motes: 420, rays: 12, burstLeaves: 48,
    },
});

const clamp = (v) => (Number.isFinite(v) ? THREE.MathUtils.clamp(v, 0, 1) : 0);
const PALETTE = [0xf9c74d, 0xe99932, 0xc95a27, 0xa82d3d, 0xe8a84a, 0xd8683c];

function leafGeometry() {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.55);
    [[-0.07, -0.3], [-0.34, -0.2], [-0.22, -0.05], [-0.48, 0.12],
        [-0.32, 0.2], [-0.3, 0.4], [-0.14, 0.32], [0, 0.62],
        [0.14, 0.32], [0.3, 0.4], [0.32, 0.2], [0.48, 0.12],
        [0.22, -0.05], [0.34, -0.2], [0.07, -0.3]].forEach(([x, y]) => shape.lineTo(x, y));
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i += 1) {
        const x = positions.getX(i); const y = positions.getY(i);
        positions.setZ(i, Math.abs(x) * 0.16 + Math.sin(y * 4) * 0.055);
    }
    geometry.computeVertexNormals();
    return geometry;
}

function identityInstances(mesh) {
    const identity = new THREE.Matrix4();
    for (let i = 0; i < mesh.count; i += 1) mesh.setMatrixAt(i, identity);
    mesh.frustumCulled = false;
}

function instanceAttribute(geometry, name, values, size) {
    const attribute = new THREE.InstancedBufferAttribute(values, size);
    geometry.setAttribute(name, attribute);
    return instancedBufferAttribute(attribute);
}

export class FallWorld {
    constructor({
        scene, camera, quality = 'High', rng = Math.random,
    }) {
        this.scene = scene; this.camera = camera; this.quality = quality; this.rng = rng;
        this.budget = FALL_WORLD_BUDGETS[quality] || FALL_WORLD_BUDGETS.High;
        this.group = new THREE.Group();
        this.group.name = 'Fall — amber glade';
        this.uTime = uniform(0); this.uGust = uniform(0); this.uWarmth = uniform(0);
        this.uShafts = uniform(0); this.uGlow = uniform(0); this.uVortex = uniform(0);
        this.burstSlots = [];
        this.disposed = false;
        this.built = false;
    }

    build() {
        if (this.disposed) throw new Error('Cannot rebuild a disposed FallWorld.');
        if (this.built) return this;
        this.built = true;
        this.oldFog = this.scene.fog;
        this.fog = new THREE.FogExp2(0x48535f, 0.011);
        this.scene.fog = this.fog;
        this.scene.add(this.group);
        this.forest = new FallForest({ scene: this.scene, quality: this.quality, rng: this.rng });
        this.forest.build();
        // Include the forest in the warm-up ownership root.
        this.group.add(this.forest.group);
        this.buildSky();
        this.buildMist();
        this.buildShafts();
        this.buildLeaves();
        this.buildMotes();
        this.buildBursts();
        this.prepareCamera(this.camera.aspect);
        return this;
    }

    buildSky() {
        const direction = normalize(positionGeometry);
        const h = smoothstep(-0.2, 0.62, direction.y);
        const dusk = mix(color(0x827877), color(0x252b40), h);
        const glow = exp(length(direction.sub(vec3(0.24, 0.1, -0.96))).mul(-3.7));
        const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
        material.colorNode = mix(dusk, color(0xeeb078).mul(this.uWarmth.mul(0.08).add(1)), glow.mul(0.88));
        const sky = new THREE.Mesh(new THREE.SphereGeometry(220, 24, 16), material);
        sky.name = 'Offscreen sunset glow'; sky.renderOrder = -20;
        this.group.add(sky);
    }

    buildShafts() {
        const coordinate = uv();
        const cross = exp(coordinate.x.sub(0.5).pow(2).mul(-26));
        const fade = smoothstep(0, 0.16, coordinate.y).mul(float(1).sub(smoothstep(0.74, 1, coordinate.y)));
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            fog: false,
        });
        material.colorNode = color(0xffd49a).mul(1.15);
        material.opacityNode = cross.mul(fade).mul(this.uShafts.mul(0.055).add(0.038));
        const geometry = new THREE.PlaneGeometry(1, 1);
        const rays = new THREE.InstancedMesh(geometry, material, this.budget.rays);
        const dummy = new THREE.Object3D();
        for (let i = 0; i < rays.count; i += 1) {
            dummy.position.set(3.8 + i * 2.5, 10, -27 - i * 2.4);
            dummy.rotation.z = -0.42 - i * 0.023;
            dummy.scale.set(0.8 + this.rng() * 2.1, 33 + this.rng() * 9, 1);
            dummy.updateMatrix(); rays.setMatrixAt(i, dummy.matrix);
        }
        rays.name = 'Light through the canopy'; rays.frustumCulled = false;
        this.group.add(rays);
    }

    buildMist() {
        const layers = this.quality === 'Minimal' || this.quality === 'Low' ? 2 : 3;
        const geometry = new THREE.PlaneGeometry(1, 1);
        for (let i = 0; i < layers; i += 1) {
            const st = uv();
            const drift = sin(this.uTime.mul(0.07).add(i * 1.7)).mul(0.035);
            const bank = exp(st.y.sub(0.28).pow(2).mul(-28))
                .mul(exp(st.x.sub(0.5).add(drift).pow(2).mul(-3.5)));
            const billow = sin(st.x.mul(13).add(this.uTime.mul(0.06)).add(i))
                .mul(sin(st.y.mul(7).add(i))).mul(0.12).add(0.88);
            const material = new THREE.MeshBasicNodeMaterial({
                transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
            });
            material.colorNode = mix(color(0x8a989d), color(0xe8bc83), st.x.mul(0.38).add(this.uWarmth.mul(0.12)));
            material.opacityNode = bank.mul(billow).mul(i === 0 ? 0.25 : 0.19);
            const mist = new THREE.Mesh(geometry, material);
            mist.position.set(0, 3.2 + i * 1.6, -38 - i * 27);
            mist.scale.set(115 + i * 35, 19 + i * 8, 1);
            mist.name = `Woodland mist layer ${i}`;
            this.group.add(mist);
        }
    }

    buildLeaves() {
        const count = this.budget.leaves;
        const geometry = leafGeometry();
        const origins = new Float32Array(count * 3); const params = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i += 1) {
            origins.set([(this.rng() - 0.5) * 80, this.rng() * 30, -3 - this.rng() * 85], i * 3);
            params.set([this.rng() * Math.PI * 2, 0.22 + this.rng() * 0.35, 0.14 + this.rng() * 0.29], i * 3);
            const c = new THREE.Color(PALETTE[Math.floor(this.rng() * PALETTE.length)]);
            colors.set([c.r, c.g, c.b], i * 3);
        }
        const origin = instanceAttribute(geometry, 'fallOrigin', origins, 3);
        const p = instanceAttribute(geometry, 'fallMotion', params, 3);
        const tint = instanceAttribute(geometry, 'fallTint', colors, 3);
        const phase = this.uTime.mul(p.y).add(p.x);
        const local = positionGeometry;
        const rotated = vec3(
            local.x.mul(cos(phase)).sub(local.y.mul(sin(phase))).mul(p.z),
            local.x.mul(sin(phase)).add(local.y.mul(cos(phase))).mul(p.z),
            local.z.add(local.x.mul(sin(phase.mul(1.7)))).mul(p.z),
        );
        const travel = this.uTime.mul(p.y.mul(0.025).add(0.017));
        const falling = float(1).sub(fract(origin.y.div(30).add(travel))).mul(30).sub(2);
        const spiral = phase.add(origin.y.mul(0.18));
        const drift = sin(phase.mul(0.75)).mul(1.6)
            .add(this.uGust.mul(sin(phase).mul(2).add(2)))
            .add(cos(spiral).mul(this.uVortex).mul(2.5));
        const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
        material.positionNode = positionLocal.add(rotated.sub(local)).add(vec3(
            origin.x.add(drift),
            falling.add(sin(spiral).mul(this.uVortex).mul(1.2)),
            origin.z,
        ));
        const vein = float(1).sub(smoothstep(0.012, 0.032, local.x.abs()));
        material.colorNode = tint.mul(float(0.72).add(cos(phase).abs().mul(0.25)))
            .mul(float(1).sub(vein.mul(0.14))).mul(this.uWarmth.mul(0.25).add(1));
        const leaves = new THREE.InstancedMesh(geometry, material, count);
        identityInstances(leaves); leaves.name = 'Tumbling maple leaves';
        this.group.add(leaves);
    }

    buildMotes() {
        const count = this.budget.motes;
        const geometry = new THREE.PlaneGeometry(1, 1);
        const data = new Float32Array(count * 3); const phases = new Float32Array(count);
        for (let i = 0; i < count; i += 1) {
            data.set([(this.rng() - 0.5) * 52, this.rng() * 15, -2 - this.rng() * 55], i * 3);
            phases[i] = this.rng() * 6.28;
        }
        const origin = instanceAttribute(geometry, 'moteOrigin', data, 3);
        const phase = instanceAttribute(geometry, 'motePhase', phases, 1);
        const drift = vec3(
            sin(this.uTime.mul(0.28).add(phase)).mul(0.45),
            sin(this.uTime.mul(0.19).add(phase)).mul(0.55),
            0,
        );
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        });
        material.positionNode = positionLocal.mul(0.055).add(origin).add(drift);
        const disc = float(1).sub(smoothstep(0.05, 0.5, length(uv().sub(0.5))));
        const flicker = sin(this.uTime.mul(1.2).add(phase)).mul(0.3).add(0.65);
        material.colorNode = color(0xffd68c).mul(this.uGlow.mul(0.5).add(1.8));
        material.opacityNode = disc.pow(2).mul(flicker).mul(0.68);
        const motes = new THREE.InstancedMesh(geometry, material, count);
        identityInstances(motes); motes.name = 'Golden dust in the glade';
        this.group.add(motes);
    }

    buildBursts() {
        const slots = FALL_REACTION_LIMITS[this.quality] || FALL_REACTION_LIMITS.High;
        const ribbonGeometry = new THREE.PlaneGeometry(1, 1, 1, 64);
        // All meshes and materials exist before gameplay; events only fill uniform slots.
        for (let slot = 0; slot < slots; slot += 1) {
            const geometry = leafGeometry(); const count = this.budget.burstLeaves;
            const data = new Float32Array(count * 3); const colors = new Float32Array(count * 3);
            for (let i = 0; i < count; i += 1) {
                data.set([(i / count) * Math.PI * 2, this.rng(), this.rng()], i * 3);
                const c = new THREE.Color(PALETTE[i % PALETTE.length]); colors.set([c.r, c.g, c.b], i * 3);
            }
            const p = instanceAttribute(geometry, 'burstMotion', data, 3);
            const tint = instanceAttribute(geometry, 'burstTint', colors, 3);
            const progress = uniform(0); const strength = uniform(0); const side = uniform(1);
            const kind = uniform(0); const seed = uniform(0);
            const angle = p.x.add(progress.mul(6).mul(kind.mul(1.2).add(1))).add(seed.mul(6.28));
            const radius = progress.mul(p.y.mul(2).add(1)).mul(strength.mul(2).add(1));
            const x = side.mul(8).add(cos(angle).mul(radius));
            const y = progress.mul(kind.mul(9).add(8)).mul(strength)
                .sub(progress.pow(2).mul(4)).add(sin(angle).mul(radius.mul(0.55)));
            const z = float(-8).sub(p.z.mul(12)).add(sin(angle).mul(radius.mul(0.32)));
            const local = positionGeometry;
            const size = p.z.mul(0.22).add(0.18).mul(strength.mul(0.5).add(0.7));
            const spin = angle.add(progress.mul(4));
            const rotated = vec3(
                local.x.mul(cos(spin)).sub(local.y.mul(sin(spin))),
                local.x.mul(sin(spin)).add(local.y.mul(cos(spin))),
                local.z.add(local.x.mul(sin(spin.mul(1.3)))),
            ).mul(size);
            const material = new THREE.MeshBasicNodeMaterial({
                transparent: true, depthWrite: false, side: THREE.DoubleSide,
            });
            material.positionNode = positionLocal.add(rotated.sub(local)).add(vec3(x, y, z));
            material.colorNode = tint.mul(strength.mul(0.38).add(1.05));
            material.opacityNode = smoothstep(0, 0.07, progress).mul(float(1).sub(smoothstep(0.65, 1, progress)));
            const mesh = new THREE.InstancedMesh(geometry, material, count);
            identityInstances(mesh); mesh.visible = false; mesh.name = `Harvest leaf cascade ${slot}`;
            this.group.add(mesh);
            // A fine strand catches the light behind combo leaves. Its moving
            // head reveals the wind's path without covering the play area.
            const t = positionGeometry.y.add(0.5);
            const theta = t.mul(9.2).add(seed.mul(6.28)).add(progress.mul(1.8));
            const spread = t.mul(2.6).mul(strength).add(0.15);
            const ribbonMaterial = new THREE.MeshBasicNodeMaterial({
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            });
            ribbonMaterial.positionNode = vec3(
                side.mul(8).add(cos(theta).mul(spread)).add(positionGeometry.x.mul(0.06)),
                t.mul(12).mul(strength).sub(0.8),
                float(-13).add(sin(theta).mul(spread.mul(0.5))),
            );
            const head = progress.mul(1.55);
            const trail = smoothstep(-0.04, 0.025, head.sub(t))
                .mul(float(1).sub(smoothstep(0.15, 0.45, head.sub(t))));
            const taper = sin(t.mul(Math.PI)).max(0);
            ribbonMaterial.colorNode = color(0xffca69).mul(1.35);
            ribbonMaterial.opacityNode = trail.mul(taper).mul(strength).mul(0.34)
                .mul(float(1).sub(smoothstep(0.6, 1, progress)));
            const ribbon = new THREE.Mesh(ribbonGeometry, ribbonMaterial);
            ribbon.visible = false; ribbon.frustumCulled = false;
            ribbon.name = `Harvest wind strand ${slot}`;
            this.group.add(ribbon);
            this.burstSlots.push({
                mesh, ribbon, progress, strength, side, kind, seed,
            });
        }
    }

    prepareCamera(aspect) {
        this.camera.fov = aspect < 0.85 ? 68 : 55;
        this.camera.far = 300;
        this.camera.position.set(0, 4, aspect < 0.85 ? 23 : 18);
        this.camera.lookAt(0, 4, -35);
        this.camera.updateProjectionMatrix();
        this.forest?.prepareCamera?.(aspect);
    }

    update(time, dt, frame = {}) {
        this.uTime.value = Number.isFinite(time) ? Math.max(0, time) : this.uTime.value;
        this.uGust.value = clamp(frame.gust); this.uWarmth.value = clamp(frame.warmth);
        this.uShafts.value = clamp(frame.shafts); this.uGlow.value = clamp(frame.glow);
        this.uVortex.value = clamp(frame.vortex);
        this.forest?.update(time, dt, frame);
        for (const slot of this.burstSlots) { slot.mesh.visible = false; slot.ribbon.visible = false; }
        for (const burst of frame.bursts || []) {
            const slot = this.burstSlots[burst.id];
            if (!slot || !burst.active) continue;
            slot.mesh.visible = true; slot.progress.value = burst.progress;
            slot.ribbon.visible = burst.kind === 'combo';
            slot.strength.value = burst.strength; slot.side.value = burst.side;
            slot.kind.value = burst.kind === 'combo' ? 1 : 0; slot.seed.value = burst.seed;
        }
    }

    getDiagnostics() {
        return { quality: this.quality, ...this.budget, burstSlots: this.burstSlots.length };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.forest?.dispose(); this.forest = null;
        const geometries = new Set(); const materials = new Set();
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
            if (object.geometry) geometries.add(object.geometry);
            if (object.material) materials.add(object.material);
        });
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        this.group.removeFromParent(); this.group.clear(); this.burstSlots.length = 0;
        if (this.scene.fog === this.fog) this.scene.fog = this.oldFog;
    }
}
