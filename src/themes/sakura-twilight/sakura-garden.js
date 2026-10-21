/**
 * Sakura Twilight — what people have put in the garden, and the grass around it.
 *
 * Stone lanterns by the water, paper lanterns hung from the low boughs, a torii standing
 * in the lake, a drum bridge to the islet, a pagoda on the far shore, boulders along the
 * shoreline, and the spring grass of the knoll. The furniture is modelled in Blender (see
 * sakura-assets.js); its vertex colours carry surface colour and baked occlusion, and its
 * UVs say which faces are lit paper.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, dot, exp, instancedBufferAttribute, length, mix, normalize, positionLocal,
    positionWorld, pow, saturate, sin, smoothstep, uv, varying, vec3, vec4,
} from 'three/tsl';
import {
    SAKURA_BRIDGE, SAKURA_PAGODA, SAKURA_STONE_LANTERNS, SAKURA_TORII, SAKURA_VIEWS,
} from './sakura-composition.js';
import { createSakuraPropMaterial } from './sakura-prop-material.js';
import { sakuraLand, sakuraPathDistance, sakuraTerrainHeight } from './sakura-terrain.js';

const TAU = Math.PI * 2;
/** Fallen flowers in the grass, as a share of the tier's tufts. */
const FALLEN_SHARE = 0.06;

/** A small seeded generator of its own (mulberry32). */
function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

export class SakuraGarden {
    /**
     * `paperLanterns` come from planPaperLanterns(): [{x, y, z, phase, red}]; `blossoms` is the
     * flower pack (its `flower` falls into the grass; without it the grass has none).
     */
    constructor({
        light, props, blossoms = null, tier, paperLanterns = [], rng = Math.random,
    }) {
        this.light = light;
        this.props = props;
        this.blossoms = blossoms;
        this.tier = tier;
        this.paperLanterns = paperLanterns;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'SakuraGarden';
        this.owned = [];
        this.stats = { props: 0, grass: 0, blossom: 0 };
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    mesh(name) {
        const geometry = this.props.meshes[name];
        if (!geometry) throw new Error(`[Sakura] Garden mesh "${name}" is missing from the asset pack.`);
        return geometry;
    }

    build() {
        this.buildStoneLanterns();
        this.buildPaperLanterns();
        this.buildLandmarks();
        this.buildRocks();
        this.buildGrass();
        return this;
    }

    createPropMaterial(name, options = {}) {
        return this.own(createSakuraPropMaterial(this.light, name, options));
    }

    instanced(name, geometryName, items, materialOptions = {}) {
        if (!items.length) return null;
        const lookData = new Float32Array(items.length * 4);
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4));
        const material = this.createPropMaterial(name, { ...materialOptions, look });
        const mesh = new THREE.InstancedMesh(this.mesh(geometryName), material, items.length);
        mesh.name = name;
        const dummy = new THREE.Object3D();
        items.forEach((item, index) => {
            dummy.position.set(item.x, item.y, item.z);
            dummy.rotation.set(item.tilt ?? 0, item.yaw ?? 0, item.roll ?? 0);
            if (item.size) dummy.scale.set(item.size[0], item.size[1], item.size[2]);
            else dummy.scale.setScalar(item.scale ?? 1);
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
            lookData.set([item.phase ?? 0, item.red ? 1 : 0, item.glow ?? 1, 0], index * 4);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = materialOptions.castShadow ?? true;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.stats.props += items.length;
        return mesh;
    }

    buildStoneLanterns() {
        const byKind = new Map();
        SAKURA_STONE_LANTERNS.forEach((lantern, index) => {
            if (!byKind.has(lantern.kind)) byKind.set(lantern.kind, []);
            byKind.get(lantern.kind).push({
                x: lantern.x,
                y: sakuraTerrainHeight(lantern.x, lantern.z) - 0.04,
                z: lantern.z,
                yaw: lantern.yaw,
                scale: lantern.kind === 'stone_lantern' ? 1.08 : 1.15,
                phase: (index * 0.381) % 1,
            });
        });
        byKind.forEach((items, kind) => this.instanced(`SakuraGarden ${kind}`, kind, items));
    }

    buildPaperLanterns() {
        const items = this.paperLanterns.map((lantern) => ({
            x: lantern.x, y: lantern.y, z: lantern.z, yaw: lantern.phase * TAU, phase: lantern.phase, red: lantern.red,
        }));
        this.instanced('SakuraGarden paper_lantern', 'paper_lantern', items, { hung: true, castShadow: false });
    }

    buildLandmarks() {
        [['torii', SAKURA_TORII, 0.2], ['bridge', SAKURA_BRIDGE, 0.06], ['pagoda', SAKURA_PAGODA, -0.2]]
            .forEach(([name, place, lift]) => {
                const mesh = new THREE.Mesh(this.mesh(name), this.createPropMaterial(`SakuraGarden ${name}`, {
                    glow: name === 'pagoda' ? 0.5 : 1,
                }));
                mesh.name = `SakuraGarden ${name}`;
                mesh.position.set(place.x, Math.max(0, sakuraTerrainHeight(place.x, place.z)) + lift, place.z);
                mesh.rotation.y = place.yaw;
                mesh.scale.setScalar(place.scale);
                mesh.updateMatrix();
                mesh.matrixAutoUpdate = false;
                mesh.frustumCulled = false;
                mesh.castShadow = true;
                this.group.add(mesh);
                this.stats.props += 1;
            });
    }

    /** Boulders where the bank meets the water, most of them near the camera. */
    buildRocks() {
        const { rng } = this;
        const byKind = { rock_a: [], rock_b: [], rock_c: [] };
        const kinds = Object.keys(byKind);
        const wanted = 30;
        for (let attempt = 0, placed = 0; placed < wanted && attempt < wanted * 40; attempt += 1) {
            const near = rng() < 0.6;
            const x = (rng() * 2 - 1) * (near ? 24 : 52);
            const z = near ? -8 + rng() * 16 : -52 + rng() * 48;
            const land = sakuraLand(x, z);
            if (land > -0.5 && land < 0.9) {
                const scale = 0.45 + rng() ** 2 * 1.25;
                byKind[kinds[Math.floor(rng() * kinds.length)]].push({
                    x, y: sakuraTerrainHeight(x, z) - 0.1 * scale, z, yaw: rng() * TAU, scale, tilt: (rng() - 0.5) * 0.3,
                });
                placed += 1;
            }
        }
        kinds.forEach((kind) => this.instanced(`SakuraGarden ${kind}`, kind, byKind[kind], { tint: 0.4 }));
    }

    /** A tuft: a few tapered blades leaning out from one root. */
    createTuftGeometry() {
        const positions = [];
        const paint = [];
        const indices = [];
        const blades = 5;
        for (let blade = 0; blade < blades; blade += 1) {
            const angle = (blade / blades) * TAU + (blade % 2) * 0.4;
            const lean = 0.25 + (blade % 3) * 0.3;
            const height = 0.36 + ((blade * 37) % 10) * 0.022;
            const width = 0.028;
            const dirX = Math.cos(angle);
            const dirZ = Math.sin(angle);
            const base = positions.length / 3;
            for (let step = 0; step <= 2; step += 1) {
                const v = step / 2;
                const out = lean * v * v * height;
                const half = width * (1 - v * 0.9);
                const y = v * height;
                positions.push(dirX * out - dirZ * half, y, dirZ * out + dirX * half);
                positions.push(dirX * out + dirZ * half, y, dirZ * out - dirX * half);
                paint.push(v, blade / blades, v, blade / blades);
            }
            for (let step = 0; step < 2; step += 1) {
                const a = base + step * 2;
                indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(paint, 2));
        geometry.setIndex(indices);
        geometry.computeBoundingSphere();
        return geometry;
    }

    buildGrass() {
        const { light, rng } = this;
        // The portrait framing stands further back: the grass starts at its feet.
        const eye = [0, 0, Math.max(SAKURA_VIEWS.landscape.position[2], SAKURA_VIEWS.portrait.position[2])];
        const tufts = [];
        for (let attempt = 0; tufts.length < this.tier.grass && attempt < this.tier.grass * 14; attempt += 1) {
            // Dense on the knoll in front of the camera, thinning toward the points.
            const depth = rng() ** 2.6;
            const z = eye[2] - 2.6 - depth * 47;
            const x = (rng() * 2 - 1) * (5 + (eye[2] - z) * 0.95);
            const land = sakuraLand(x, z);
            if (land > 0.5 && sakuraPathDistance(x, z) > 1.1) {
                // Grazed short along the shore, where the foxes walk; rank on the knoll.
                const shore = 0.42 + 0.58 * THREE.MathUtils.smoothstep(land, 1.5, 7.5);
                tufts.push({
                    x,
                    y: sakuraTerrainHeight(x, z) - 0.03,
                    z,
                    yaw: rng() * TAU,
                    scale: (0.55 + rng() * 0.75 + depth * 0.8) * shore,
                    phase: rng(),
                });
            }
        }
        if (!tufts.length) return;
        const geometry = this.own(this.createTuftGeometry());
        const lookData = new Float32Array(tufts.length * 4);
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4)); // phase, tone, -, -
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = 'SakuraSpringGrass';
        const st = uv(); // height along the blade, blade id
        const t = light.uTime;
        const world0 = positionLocal;
        const along = world0.x.mul(light.uWindDir.x).add(world0.z.mul(light.uWindDir.z));
        const front = exp(world0.x.sub(light.uFront.x).div(light.uFront.z).pow2().negate()).mul(light.uFront.y);
        const force = light.uWind.add(light.uGust).add(front);
        const bend = sin(t.mul(1.7).add(along.mul(0.6)).add(look.x.mul(TAU))).mul(0.6).add(0.5)
            .mul(force)
            .mul(st.x.mul(st.x))
            .mul(0.3);
        material.positionNode = positionLocal.add(vec3(light.uWindDir.x.mul(bend), bend.mul(-0.25), light.uWindDir.z.mul(bend)));
        const world = positionWorld;
        const offset = cameraPosition.sub(world);
        const view = normalize(offset);
        // Night grass: blue-green in the open, olive where it grows rank, its roots in the dark.
        // Patches a few metres across keep the knoll from reading as one carpet.
        const patch = light.noise(world.xz.mul(0.035)).g.mul(0.7).add(look.y.mul(0.3));
        const tip = mix(mix(color(0x234638), color(0x35583c), look.y), color(0x56603a), smoothstep(0.45, 0.75, patch));
        const blade = mix(mix(color(0x050b0a), color(0x0a1410), look.y), tip, st.x.mul(st.x.mul(0.4).add(0.6)));
        // Backlit blades glow at their tips; lantern light and the board's ring pass over them.
        const through = pow(saturate(dot(view, light.uMoonDir).negate()), 2).mul(st.x);
        const lamp = varying(light.lamps(positionWorld));
        const ring = varying(light.rings(positionWorld.xz).band);
        const moon = light.moonlight();
        // The moon silvers the tips it catches: a cool sheen, not a brighter green.
        const sheen = vec3(0.5, 0.56, 0.86).mul(pow(st.x, 2.5)).mul(through.mul(0.8).add(0.12)).mul(moon);
        // The nearest grass stands in the shade of the knoll's lip: a dark frame for the garden.
        const shade = smoothstep(2.5, 9, length(offset)).mul(0.45).add(0.55);
        const lit = blade.mul(light.uMoonColor).mul(through.mul(1.3).add(0.42)).mul(moon)
            .add(blade.mul(light.ambient(vec3(0, 1, 0))).mul(1.25))
            .add(sheen.mul(0.3))
            .mul(shade)
            .add(blade.mul(lamp).mul(1.5))
            .add(mix(blade, vec3(1.0, 0.6, 0.74), 0.5).mul(ring).mul(0.6).mul(st.x));
        material.colorNode = vec4(light.haze(lit, { world }), 1);
        const mesh = new THREE.InstancedMesh(geometry, material, tufts.length);
        mesh.name = 'SakuraSpringGrass';
        const dummy = new THREE.Object3D();
        tufts.forEach((tuft, index) => {
            dummy.position.set(tuft.x, tuft.y, tuft.z);
            dummy.rotation.set(0, tuft.yaw, 0);
            dummy.scale.setScalar(tuft.scale);
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
            lookData.set([tuft.phase, rng(), 0, 0], index * 4);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.stats.grass = tufts.length;
        this.buildFallenBlossom(tufts, eye);
    }

    /**
     * Whole flowers the boughs have let fall, caught in the tops of the tufts near the eye:
     * the foreground's own blossom. Placed from a generator of their own, so the garden's
     * shared sequence (and everything built after the grass) is the same with or without them.
     */
    buildFallenBlossom(tufts, eye) {
        const flower = this.blossoms?.meshes?.flower;
        const wanted = Math.round(this.tier.grass * FALLEN_SHARE);
        if (!flower || !wanted) return;
        const near = tufts.filter((tuft) => eye[2] - tuft.z < 24);
        if (!near.length) return;
        const random = mulberry32(0x5a4b);
        const lookData = new Float32Array(wanted * 4);
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4)); // tone, -, -, -
        const mesh = new THREE.InstancedMesh(flower, this.createFallenMaterial(look), wanted);
        mesh.name = 'SakuraFallenBlossom';
        const dummy = new THREE.Object3D();
        for (let index = 0; index < wanted; index += 1) {
            const tuft = near[Math.floor(random() * near.length)];
            const spread = 0.12 * tuft.scale;
            dummy.position.set(
                tuft.x + (random() - 0.5) * spread,
                tuft.y + (0.3 + random() * 0.14) * tuft.scale,
                tuft.z + (random() - 0.5) * spread,
            );
            // Lying on the blades, face up, at whatever slant they caught it.
            dummy.rotation.set(-Math.PI / 2 + (random() - 0.5) * 0.9, (random() - 0.5) * 0.7, random() * TAU);
            dummy.scale.setScalar(0.1 + random() * 0.06);
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
            lookData[index * 4] = random();
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.stats.blossom = wanted;
    }

    /** Fallen flowers: white going pink at the heart, lit like the petals in the air. */
    createFallenMaterial(look) {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = 'SakuraFallenBlossom';
        const paint = attribute('color', 'vec4'); // along the petal, flower id, shade, petal
        const world = positionWorld;
        const pale = mix(color(0xfff0f3), color(0xffc4d4), look.x);
        const heart = mix(color(0xe0799a), color(0xb8365e), look.x);
        const petal = mix(heart, pale, smoothstep(0.05, 0.5, paint.r)).mul(paint.b.mul(0.35).add(0.65));
        const lamp = varying(light.lamps(positionWorld));
        const ring = varying(light.rings(positionWorld.xz).band);
        const lit = petal.mul(light.uMoonColor).mul(light.moonlight()).mul(0.42)
            .add(petal.mul(light.ambient(vec3(0, 1, 0))).mul(1.5))
            .add(petal.mul(lamp).mul(1.2))
            .add(petal.mul(vec3(1.0, 0.6, 0.78)).mul(ring).mul(0.7));
        material.colorNode = vec4(light.haze(lit, { world }), 1);
        return material;
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
