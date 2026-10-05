/**
 * Golden Forest — the water's edge.
 *
 * Reeds standing in the shallows, tufts of grass on the banks, ice-rounded boulders, and
 * the things people left: a plank jetty with a rowboat moored to it, and on the islet a
 * long-dead pine. Everything is instanced and lit by the shared rig, so reeds glow when
 * the sun is behind them and the boat keeps its reflection.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, dot, exp, float, instancedBufferAttribute, mix, normalize, normalWorld,
    positionLocal, positionWorld, pow, saturate, sin, smoothstep, uv, vec3, vec4,
} from 'three/tsl';
import { goldenForestGroundHeight, goldenForestShoreDistance } from './golden-forest-terrain.js';

const JETTY = Object.freeze({ x: 13.6, z: 1, yaw: THREE.MathUtils.degToRad(28) });
const BOAT = Object.freeze({ x: 9.7, z: -3.3, yaw: THREE.MathUtils.degToRad(19) });
const SNAG = Object.freeze({ x: -20.3, z: -46, yaw: 1.1 });

/** A clump of tapering blades; uv.x is a per-blade id, uv.y runs from root to tip. */
function createClumpGeometry(rng, blades = 7) {
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let blade = 0; blade < blades; blade += 1) {
        const angle = rng() * Math.PI * 2;
        const spread = rng() * 0.12;
        const lean = 0.06 + rng() * 0.22;
        const height = 0.66 + rng() * 0.34;
        const width = 0.018 + rng() * 0.012;
        const id = rng();
        const across = [Math.cos(angle + 1.57), Math.sin(angle + 1.57)];
        const base = positions.length / 3;
        for (let step = 0; step <= 3; step += 1) {
            const t = step / 3;
            const out = spread + lean * t * t;
            const cx = Math.cos(angle) * out;
            const cz = Math.sin(angle) * out;
            const half = width * (1 - t * 0.9);
            positions.push(
                cx - across[0] * half,
                height * t,
                cz - across[1] * half,
                cx + across[0] * half,
                height * t,
                cz + across[1] * half,
            );
            uvs.push(id, t, id, t);
            if (step < 3) {
                const a = base + step * 2;
                indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

export class GoldenForestShore {
    constructor({
        light, props, tier, rng = Math.random,
    }) {
        this.light = light;
        this.props = props;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'GoldenForestWatersEdge';
        this.owned = [];
        this.boat = null;
        this.boatRing = 5;
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        this.buildBlades();
        if (this.props?.meshes) {
            this.buildBoulders();
            this.buildTimber();
        }
        return this;
    }

    /** Reeds in the shallows and grass on the banks, in one draw. */
    buildBlades() {
        const { light, rng, tier } = this;
        const places = [];
        const scatter = (wanted, box, accept, reed) => {
            let made = 0;
            for (let attempt = 0; made < wanted && attempt < wanted * 14; attempt += 1) {
                const x = box[0] + (box[1] - box[0]) * rng();
                const z = box[2] + (box[3] - box[2]) * rng();
                const shore = goldenForestShoreDistance(x, z);
                if (accept(shore, x, z)) {
                    // Reeds grow in stands: one accepted spot seeds a few neighbours.
                    const stand = reed ? 1 + Math.floor(rng() * 3) : 1;
                    for (let i = 0; i < stand && made < wanted; i += 1) {
                        const px = x + (i ? (rng() - 0.5) * 0.9 : 0);
                        const pz = z + (i ? (rng() - 0.5) * 0.9 : 0);
                        places.push({
                            x: px, z: pz, y: Math.max(-0.03, goldenForestGroundHeight(px, pz)), reed, seed: rng(),
                        });
                        made += 1;
                    }
                }
            }
        };
        const { reeds } = tier;
        // The water in front of the board stays open: that is where the rings are read.
        scatter(
            Math.round(reeds * 0.5),
            [-46, 46, -12, 14],
            (s, x) => s > -1.7 && s < 0.3 && Math.abs(x) > 5.5 + 3 * Math.sin(x * 1.7),
            1,
        );
        scatter(Math.round(reeds * 0.1), [-24, -11, -50, -40], (s) => s > -1.6 && s < 0.2, 1);
        scatter(Math.round(reeds * 0.4), [14, 70, -72, -30], (s) => s > -2.4 && s < 0.3, 1);
        scatter(tier.grass, [-48, 48, -12, 26], (s) => s > 0.35 && s < 18, 0);
        if (!places.length) return;
        const geometry = this.own(createClumpGeometry(rng));
        const lookData = new Float32Array(places.length * 4);
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4)); // reed, seed, height, -
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = 'GoldenForestReedsAndGrass';
        const st = uv();
        const t = light.uTime;
        const front = exp(positionLocal.x.sub(light.uFront.x).div(light.uFront.z).pow2().negate()).mul(light.uFront.y);
        const force = light.uWind.add(light.uGust).add(front);
        const sway = sin(t.mul(1.5).add(positionLocal.x.mul(0.45)).add(positionLocal.z.mul(0.31)).add(look.y.mul(6.3)))
            .mul(0.5).add(sin(t.mul(2.9).add(look.y.mul(31)).add(st.x.mul(9))).mul(0.18)).add(0.35);
        const bend = st.y.mul(st.y).mul(look.z).mul(force).mul(sway)
            .mul(0.3);
        material.positionNode = positionLocal.add(vec3(
            light.uWindDir.x.mul(bend),
            bend.abs().mul(-0.25),
            light.uWindDir.z.mul(bend),
        ));

        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        // Reeds: green at the root, straw at the tip. Grass: moss and the first dry blades.
        const straw = mix(color(0x8a7422), color(0xc49a3a), st.x);
        const reedColour = mix(color(0x23280c), straw, smoothstep(0.1, 0.9, st.y));
        const grassColour = mix(color(0x161c08), mix(color(0x4a4a14), color(0x8a6a22), st.x), st.y);
        const blade = mix(grassColour, reedColour, look.x);
        const glowing = pow(blade, vec3(0.7)).mul(vec3(1.15, 0.72, 0.2));
        const sun = light.sunlight();
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 3);
        const normal = normalize(normalWorld);
        const lit = blade.mul(saturate(dot(normal, light.uSunDir).abs().mul(1.4).add(0.3)))
            .add(glowing.mul(through.mul(0.7).add(0.08)).mul(st.y.mul(0.7).add(0.3)))
            .mul(light.uSunColor).mul(sun)
            .add(blade.mul(light.ambient(vec3(0, 1, 0))).mul(st.y.mul(0.6).add(0.5)).mul(1.2));
        material.colorNode = light.haze(lit, { world });
        const mesh = new THREE.InstancedMesh(geometry, material, places.length);
        mesh.name = 'GoldenForestReedsAndGrass';
        const dummy = new THREE.Object3D();
        places.forEach((place, index) => {
            const height = place.reed ? 0.8 + place.seed * 0.75 : 0.26 + place.seed * 0.34;
            const girth = place.reed ? 0.9 + place.seed * 0.5 : 0.8 + place.seed * 0.9;
            dummy.position.set(place.x, place.y, place.z);
            dummy.rotation.set(0, place.seed * 31, 0);
            dummy.scale.set(girth, height, girth);
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
            lookData.set([place.reed, place.seed, height, 0], index * 4);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.blades = mesh;
        this.group.add(mesh);
    }

    createStoneMaterial() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'GoldenForestGranite';
        const paint = attribute('color', 'vec4'); // tone, grain, occlusion, lichen
        const world = positionWorld;
        const speckle = light.noise(world.xz.mul(1.3).add(world.y.mul(0.7)));
        const granite = mix(color(0x2c2420), color(0x8c7a6e), paint.r.mul(0.7).add(speckle.a.mul(0.3)))
            .mul(paint.g.mul(0.3).add(0.82));
        const lichen = mix(color(0x7c8262), color(0xa8662a), smoothstep(0.45, 0.6, speckle.g));
        // Dark and wet where the lake laps it.
        const wet = float(1).sub(smoothstep(0.02, 0.3, world.y));
        const albedo = mix(granite, lichen, paint.a.mul(0.75)).mul(wet.mul(-0.55).add(1));
        const normal = normalize(normalWorld);
        const view = normalize(cameraPosition.sub(world));
        const sun = light.sunlight();
        const facing = saturate(dot(normal, light.uSunDir));
        const rim = pow(saturate(dot(normal, view)).oneMinus(), 3)
            .mul(saturate(dot(view, light.uSunDir).negate().mul(0.6).add(0.5)));
        const direct = facing.mul(1.3).add(rim.mul(0.9)).add(wet.mul(rim).mul(1.2));
        const lit = albedo.mul(light.uSunColor).mul(direct).mul(sun)
            .add(albedo.mul(light.ambient(normal)).mul(paint.b.mul(0.85).add(0.15)).mul(1.15));
        material.fragmentNode = vec4(light.haze(lit, { world }), 1);
        return material;
    }

    buildBoulders() {
        const { rng, tier } = this;
        const material = this.createStoneMaterial();
        const names = ['boulder_a', 'boulder_b', 'boulder_c'].filter((name) => this.props.meshes[name]);
        if (!names.length) return;
        const buckets = names.map(() => []);
        const place = (x, z, size) => {
            const variant = Math.floor(rng() * names.length) % names.length;
            buckets[variant].push({
                x,
                z,
                y: goldenForestGroundHeight(x, z) - size * 0.12,
                size,
                yaw: rng() * Math.PI * 2,
                squash: 0.75 + rng() * 0.4,
            });
        };
        // The stones that hold the picture's corners, then the scatter along the waterline.
        [[-7.4, 6.6, 1.25], [-5.6, 5.2, 0.6], [-13.8, 0.4, 0.95], [6.2, 5.9, 0.8], [7.9, 3.4, 1.35], [12.2, -1.6, 0.7],
            [-17.4, -43.2, 1.3], [-21.6, -44.4, 0.8]].forEach(([x, z, size]) => place(x, z, size));
        const wanted = Math.max(0, tier.rocks - 8);
        for (let made = 0, attempt = 0; made < wanted && attempt < wanted * 16; attempt += 1) {
            const far = rng() < 0.3;
            const x = far ? 14 + rng() * 60 : (rng() * 2 - 1) * 44;
            const z = far ? -72 + rng() * 40 : -10 + rng() * 26;
            const shore = goldenForestShoreDistance(x, z);
            if (shore > -2.2 && shore < 4) {
                place(x, z, 0.25 + rng() ** 2 * 1.1);
                made += 1;
            }
        }
        const dummy = new THREE.Object3D();
        buckets.forEach((stones, variant) => {
            if (!stones.length) return;
            const mesh = new THREE.InstancedMesh(this.props.meshes[names[variant]], material, stones.length);
            mesh.name = `GoldenForestBoulders ${names[variant]}`;
            stones.forEach((stone, index) => {
                dummy.position.set(stone.x, stone.y, stone.z);
                dummy.rotation.set(0, stone.yaw, 0);
                dummy.scale.set(stone.size, stone.size * stone.squash, stone.size);
                dummy.updateMatrix();
                mesh.setMatrixAt(index, dummy.matrix);
            });
            mesh.instanceMatrix.needsUpdate = true;
            mesh.castShadow = true;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            this.group.add(mesh);
        });
    }

    /** Weathered wood; `painted` gives the boat its faded red hull. */
    createTimberMaterial(painted) {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = painted ? 'GoldenForestBoatPaint' : 'GoldenForestTimber';
        const paint = attribute('color', 'vec4'); // tone, part id, occlusion, wear
        const world = positionWorld;
        const grain = light.noise(world.xz.mul(2.2).add(world.y.mul(3.1)).add(paint.g.mul(7)));
        const silvered = mix(color(0x241b15), color(0x8c7c68), paint.r.mul(0.75).add(grain.b.mul(0.25)));
        let albedo = silvered;
        if (painted) {
            // Red-oxide strakes with pale rails, thwarts and oars.
            const hull = mix(color(0x4a120c), color(0x8a2e1c), grain.g.mul(0.5).add(paint.r.mul(0.5)));
            albedo = mix(hull, silvered, smoothstep(0.58, 0.62, paint.r));
        }
        const weed = mix(albedo, color(0x1c2010), paint.a.mul(float(1).sub(smoothstep(0.05, 0.7, world.y))).mul(0.8));
        const normal = normalize(normalWorld);
        const view = normalize(cameraPosition.sub(world));
        const sun = light.sunlight();
        const facing = saturate(dot(normal, light.uSunDir).abs());
        const rim = pow(saturate(dot(normal, view).abs()).oneMinus(), 3)
            .mul(saturate(dot(view, light.uSunDir).negate().mul(0.6).add(0.5)));
        const lit = weed.mul(light.uSunColor).mul(facing.mul(1.2).add(rim.mul(0.9))).mul(sun)
            .add(weed.mul(light.ambient(normal)).mul(paint.b.mul(0.85).add(0.15)).mul(1.15));
        material.fragmentNode = vec4(light.haze(lit, { world }), 1);
        return material;
    }

    buildTimber() {
        const { meshes } = this.props;
        const timber = this.createTimberMaterial(false);
        const add = (name, material, x, y, z, yaw) => {
            if (!meshes[name]) return null;
            const mesh = new THREE.Mesh(meshes[name], material);
            mesh.name = `GoldenForest ${name}`;
            mesh.position.set(x, y, z);
            mesh.rotation.set(0, yaw, 0);
            mesh.castShadow = true;
            mesh.frustumCulled = false;
            mesh.updateMatrix();
            mesh.matrixAutoUpdate = false;
            this.group.add(mesh);
            return mesh;
        };
        add('jetty', timber, JETTY.x, 0, JETTY.z, JETTY.yaw);
        add('snag', timber, SNAG.x, goldenForestGroundHeight(SNAG.x, SNAG.z) - 0.1, SNAG.z, SNAG.yaw);
        this.boat = add('rowboat', this.createTimberMaterial(true), BOAT.x, 0, BOAT.z, BOAT.yaw);
    }

    /** The boat rides the water; returns a point for a faint ring when it rocks, else null. */
    update(time, dt) {
        const { boat } = this;
        if (!boat) return null;
        boat.position.y = Math.sin(time * 0.9) * 0.018;
        boat.rotation.set(
            Math.sin(time * 0.53 + 1) * 0.014,
            BOAT.yaw + Math.sin(time * 0.21) * 0.02,
            Math.sin(time * 0.7) * 0.03,
        );
        boat.updateMatrix();
        this.boatRing -= Math.max(0, dt);
        if (this.boatRing > 0) return null;
        this.boatRing = 6.5;
        return boat.position;
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.boat = null;
    }
}
