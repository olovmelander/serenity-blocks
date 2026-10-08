/**
 * Summer — the water's edge.
 *
 * Reeds and bulrushes standing in the shallows of the cove, and water lilies on the still
 * water behind them. The reeds are instanced blades lit by the shared rig, so they glow
 * when the sun is behind them and keep their reflection; the lilies are planted with the
 * meadow's own flower shader, which lets them rock a little as a ring goes by.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, dot, exp, instancedBufferAttribute, mix, normalize, normalWorld, positionLocal,
    positionWorld, pow, saturate, sin, smoothstep, uv, vec3,
} from 'three/tsl';
import { createSummerLilyGeometry } from './summer-flowers.js';
import { summerGroundHeight, summerShoreDistance } from './summer-terrain.js';

/**
 * A stand of reed: tapering blades, and one bulrush with its brown spike. uv.x is a
 * per-blade id, uv.y runs from root to tip; `spike` marks the bulrush head.
 */
function createReedGeometry(rng, blades = 7) {
    const positions = [];
    const uvs = [];
    const spikes = [];
    const indices = [];
    const BULRUSH = [[0, 0.01, 0], [0.56, 0.008, 0], [0.6, 0.03, 1], [0.8, 0.03, 1], [0.83, 0.005, 0], [1, 0.002, 0]];
    for (let blade = 0; blade <= blades; blade += 1) {
        const rush = blade === blades;
        const angle = rng() * Math.PI * 2;
        const spread = rng() * 0.12;
        const lean = rush ? 0.02 + rng() * 0.05 : 0.06 + rng() * 0.22;
        const height = rush ? 0.92 + rng() * 0.1 : 0.66 + rng() * 0.34;
        const width = 0.018 + rng() * 0.012;
        const id = rng();
        const across = [Math.cos(angle + 1.57), Math.sin(angle + 1.57)];
        const base = positions.length / 3;
        const rungs = rush ? BULRUSH : [0, 1, 2, 3].map((step) => [step / 3, width * (1 - (step / 3) * 0.9), 0]);
        rungs.forEach(([t, half, spike], step) => {
            const out = spread + lean * t * t;
            const cx = Math.cos(angle) * out;
            const cz = Math.sin(angle) * out;
            positions.push(
                cx - across[0] * half,
                height * t,
                cz - across[1] * half,
                cx + across[0] * half,
                height * t,
                cz + across[1] * half,
            );
            uvs.push(id, t, id, t);
            spikes.push(spike, spike);
            if (step < rungs.length - 1) {
                const a = base + step * 2;
                indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            }
        });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('spike', new THREE.Float32BufferAttribute(spikes, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

export class SummerShore {
    constructor({
        light, tier, rng = Math.random, meadow = null,
    }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.meadow = meadow;
        this.group = new THREE.Group();
        this.group.name = 'SummerWatersEdge';
        this.owned = [];
        this.stats = { reeds: 0, lilies: 0 };
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        this.buildReeds();
        this.buildLilies();
        return this;
    }

    buildReeds() {
        const { light, rng, tier } = this;
        const places = [];
        const scatter = (wanted, box, accept) => {
            for (let made = 0, attempt = 0; made < wanted && attempt < wanted * 14; attempt += 1) {
                const x = box[0] + (box[1] - box[0]) * rng();
                const z = box[2] + (box[3] - box[2]) * rng();
                if (accept(summerShoreDistance(x, z), x, z)) {
                    // Reeds grow in stands: one accepted spot seeds a few neighbours.
                    const stand = 1 + Math.floor(rng() * 3);
                    for (let i = 0; i < stand && made < wanted; i += 1) {
                        const px = x + (i ? (rng() - 0.5) * 0.9 : 0);
                        const pz = z + (i ? (rng() - 0.5) * 0.9 : 0);
                        places.push({
                            x: px, z: pz, y: Math.max(-0.03, summerGroundHeight(px, pz)), seed: rng(),
                        });
                        made += 1;
                    }
                }
            }
        };
        // The water in front of the board and around the jetty stays open: that is where
        // the rings and the sun's path are read.
        const open = (x) => Math.abs(x) < 4.6 + 2.4 * Math.sin(x * 1.7) || (x > 2.5 && x < 12.5);
        scatter(Math.round(tier.reeds * 0.55), [-48, 48, -17, -4], (s, x) => s > -1.9 && s < 0.25 && !open(x));
        scatter(Math.round(tier.reeds * 0.3), [10, 60, -50, -8], (s, x, z) => s > -2.2 && s < 0.25 && z < -17);
        scatter(Math.round(tier.reeds * 0.15), [-24, -10, -68, -58], (s) => s > -1.4 && s < 0.2);
        if (!places.length) return;
        const geometry = this.own(createReedGeometry(rng));
        const lookData = new Float32Array(places.length * 4);
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4)); // seed, height, -, -
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = 'SummerReeds';
        const st = uv();
        const spike = attribute('spike', 'float');
        const t = light.uTime;
        const front = exp(positionLocal.x.sub(light.uFront.x).div(light.uFront.z).pow2().negate()).mul(light.uFront.y);
        const force = light.uWind.add(light.uGust).add(front);
        const sway = sin(t.mul(1.5).add(positionLocal.x.mul(0.45)).add(positionLocal.z.mul(0.31)).add(look.x.mul(6.3)))
            .mul(0.5).add(sin(t.mul(2.9).add(look.x.mul(31)).add(st.x.mul(9))).mul(0.18)).add(0.35);
        const bend = st.y.mul(st.y).mul(look.y).mul(force).mul(sway)
            .mul(0.3);
        material.positionNode = positionLocal.add(vec3(
            light.uWindDir.x.mul(bend),
            bend.abs().mul(-0.25),
            light.uWindDir.z.mul(bend),
        ));
        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        // June reeds: dark at the waterline, fresh green above, last year's straw among them.
        const fresh = mix(color(0x3f7a1c), color(0x86a83a), st.x);
        const reed = mix(
            mix(color(0x16300c), fresh, smoothstep(0.08, 0.8, st.y)),
            color(0xb9a65a),
            smoothstep(0.8, 0.95, st.x).mul(st.y),
        );
        const blade = mix(reed, color(0x2a170c), spike);
        const glowing = pow(blade, vec3(0.7)).mul(vec3(1.2, 1.2, 0.3)).mul(spike.oneMinus());
        const sun = light.sunlight();
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 3);
        const normal = normalize(normalWorld);
        const lit = blade.mul(saturate(dot(normal, light.uSunDir).abs().mul(0.9).add(0.25)))
            .add(glowing.mul(through.mul(0.6).add(0.06)).mul(st.y.mul(0.7).add(0.3)))
            .mul(light.uSunColor).mul(sun)
            .mul(0.34)
            .add(blade.mul(light.ambient(vec3(0, 1, 0))).mul(st.y.mul(0.6).add(0.45)));
        material.colorNode = light.haze(lit, { world });
        const mesh = new THREE.InstancedMesh(geometry, material, places.length);
        mesh.name = 'SummerReeds';
        const dummy = new THREE.Object3D();
        places.forEach((place, index) => {
            const height = 0.9 + place.seed * 0.8;
            const girth = 0.9 + place.seed * 0.5;
            dummy.position.set(place.x, place.y, place.z);
            dummy.rotation.set(0, place.seed * 31, 0);
            dummy.scale.set(girth, height, girth);
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
            lookData.set([place.seed, height, 0, 0], index * 4);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.reeds = mesh;
        this.stats.reeds = places.length;
        this.group.add(mesh);
    }

    /** Lily pads on the cove, some in flower. */
    buildLilies() {
        const { rng, tier, meadow } = this;
        if (!meadow?.flowerMaterial || !(tier.lilies > 0)) return;
        const lists = [[], []];
        const rafts = [[14.5, -15.2, 5.5], [-11.5, -13.4, 5], [22, -19.5, 4.5], [-24, -14.5, 5], [1.2, -16.8, 3.2]];
        for (let made = 0, attempt = 0; made < tier.lilies && attempt < tier.lilies * 20; attempt += 1) {
            const [cx, cz, reach] = rafts[Math.floor(rng() * rafts.length) % rafts.length];
            const angle = rng() * Math.PI * 2;
            const distance = Math.sqrt(rng()) * reach;
            const x = cx + Math.cos(angle) * distance;
            const z = cz + Math.sin(angle) * distance * 0.6;
            const shore = summerShoreDistance(x, z);
            if (shore < -0.7 && shore > -9) {
                const flowering = rng() < 0.26 ? 1 : 0;
                lists[flowering].push(x, 0.012, z, rng() * Math.PI * 2, 0.75 + rng() * 0.6, rng(), rng());
                made += 1;
            }
        }
        lists.forEach((plants, flowering) => {
            if (!plants.length) return;
            const geometry = this.own(createSummerLilyGeometry({ flowering: flowering === 1 }));
            const mesh = meadow.plant(geometry, meadow.flowerMaterial, plants, `SummerLilies ${flowering}`);
            // Planted by the meadow's shader, but they belong to the shore.
            if (mesh) this.group.add(mesh);
            this.stats.lilies += plants.length / 7;
        });
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}
