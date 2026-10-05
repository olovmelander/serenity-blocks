/**
 * Sakura Twilight — the cherry grove.
 *
 * Trees are authored in Blender (see sakura-assets.js): bark meshes are instanced per
 * specimen, and every blossom spray of every tree is one instance in a handful of shared
 * draws. Petals are real geometry lit as thin translucent blades, so the moon behind a
 * crown rims it silver, while the lanterns hung beneath paint it warm from below — their
 * light is gathered once per spray when the grove is built, so it costs nothing per frame.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, cross, dFdx, dFdy, dot, fract, mix, normalize,
    normalWorld, positionLocal, positionWorld, pow, saturate, sin, smoothstep, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { createSakuraVisibilityTest } from './sakura-composition.js';

const UP = new THREE.Vector3(0, 1, 0);
const INSTANCE_ATTRIBUTES = ['sakuraTree', 'sakuraCrown', 'sakuraBent', 'sakuraLamp'];

/** Deterministic 0..1 hash for choosing which sprays a tier keeps. */
function keepHash(index, salt) {
    const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
}

/** How much lantern light reaches a point, summed over every lantern in the garden. */
export function sakuraLanternReach(lanterns, x, y, z) {
    let total = 0;
    for (let index = 0; index < lanterns.length; index += 1) {
        const lantern = lanterns[index];
        const dx = lantern.x - x;
        const dy = lantern.y - y;
        const dz = lantern.z - z;
        const reach = 1 / (1 + (dx * dx + dy * dy + dz * dz) * 0.055);
        total += reach * reach * (lantern.power ?? 1);
    }
    return total;
}

export class SakuraForest {
    /**
     * `placements` are trees with a world position ({asset, x, y, z, yaw, scale, tone, far});
     * `lanterns` every light in the garden ([{x, y, z, power}]).
     */
    constructor({
        light, assets, tier, placements, lanterns = [], rng = Math.random,
    }) {
        this.light = light;
        this.assets = assets;
        this.tier = tier;
        this.rng = rng;
        this.placements = placements.filter((tree) => assets.trees[tree.asset]);
        this.lanterns = lanterns;
        this.group = new THREE.Group();
        this.group.name = 'SakuraGrove';
        this.owned = [];
        this.borrowed = [];
        this.stats = {
            trees: 0, sprays: 0, culledSprays: 0, blossomTriangles: 0, barkTriangles: 0,
        };
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        this.stats.trees = this.placements.length;
        this.buildBark();
        this.buildBlossom();
        return this;
    }

    // -- bark ---------------------------------------------------------------------------
    createBarkMaterial() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'SakuraCherryBark';
        const tree = attribute('sakuraTree', 'vec4'); // per tree: base xyz, height
        const paint = attribute('color', 'vec4'); // sway, limb phase, occlusion, moss
        const treePhase = fract(tree.x.mul(0.37).add(tree.z.mul(0.71)));
        material.positionNode = positionLocal.add(light.wind({
            world: positionLocal, base: tree.xyz, height: tree.w, treePhase, sway: paint.r, phase: paint.g,
        }));

        const st = uv();
        const grain = light.noise(st.mul(vec2(1, 0.55)));
        const fine = light.noise(st.mul(vec2(3.1, 1.4)).add(grain.rg.mul(0.25)));
        // Cherry bark: satin, red-brown, banded round the trunk with pale lenticels, and
        // split into rough plates where the tree is old.
        const bands = smoothstep(0.56, 0.74, light.noise(st.mul(vec2(0.5, 7.5)).add(grain.rg.mul(0.08))).r)
            .mul(smoothstep(0.3, 0.6, fine.g));
        const plates = smoothstep(0.38, 0.72, light.noise(st.mul(vec2(4.6, 1.1)).add(grain.rg.mul(0.3))).g
            .mul(0.6).add(fine.b.mul(0.4)));
        let albedo = mix(color(0x0d0809), color(0x33221f), plates).mul(grain.r.mul(0.6).add(0.7));
        albedo = mix(albedo, color(0x6a5650), bands.mul(0.75));
        const moss = mix(color(0x0f1c0c), color(0x2a3d18), fine.a);
        albedo = mix(albedo, moss, smoothstep(0.2, 0.75, paint.a.mul(fine.g.mul(0.8).add(0.6))).mul(0.8));
        const relief = plates.mul(0.8).add(fine.r.mul(0.3)).sub(bands.mul(0.3));

        const world = positionWorld;
        // Relief from the bark pattern itself: the low moon rakes across the plates.
        const smooth = normalize(normalWorld);
        const across = dFdx(world);
        const along = dFdy(world);
        const r1 = cross(along, smooth);
        const r2 = cross(smooth, across);
        const area = dot(across, r1);
        const slope = r1.mul(dFdx(relief)).add(r2.mul(dFdy(relief))).mul(area.sign());
        const normal = normalize(smooth.mul(area.abs()).sub(slope.mul(0.05)));
        const view = normalize(cameraPosition.sub(world));
        const moon = light.moonlight();
        const facing = saturate(dot(normal, light.uMoonDir));
        // The moon behind a trunk wraps a thin silver rim around its silhouette.
        const rim = pow(saturate(dot(normal, view)).oneMinus(), 3)
            .mul(saturate(dot(view, light.uMoonDir).negate().mul(0.6).add(0.55)));
        const occlusion = paint.b.mul(0.85).add(0.15);
        const lamp = varying(light.lamps(positionWorld));
        const ring = varying(light.rings(positionWorld.xz).band);
        const lit = albedo.mul(light.uMoonColor).mul(facing.mul(1.3).add(rim.mul(1.1))).mul(moon)
            .add(albedo.mul(light.ambient(normal)).mul(occlusion).mul(1.5))
            .add(albedo.mul(lamp).mul(occlusion).mul(1.6))
            .add(albedo.mul(vec3(1.0, 0.62, 0.76)).mul(ring).mul(0.9));
        // fragmentNode, not colorNode: the shadow pass multiplies a caster's alpha by its
        // colorNode, which would sample the shadow map while it is being drawn.
        material.fragmentNode = vec4(light.haze(lit, { world }), 1);
        return material;
    }

    buildBark() {
        const byAsset = new Map();
        this.placements.forEach((tree) => {
            if (!byAsset.has(tree.asset)) byAsset.set(tree.asset, []);
            byAsset.get(tree.asset).push(tree);
        });
        const dummy = new THREE.Object3D();
        byAsset.forEach((trees, name) => {
            const asset = this.assets.trees[name];
            const data = new Float32Array(trees.length * 4);
            // Per-tree data rides on the geometry, so every specimen shares one bark
            // material (and one set of pipelines) instead of owning a copy of it.
            asset.bark.setAttribute('sakuraTree', new THREE.InstancedBufferAttribute(data, 4));
            if (!this.barkMaterial) this.barkMaterial = this.createBarkMaterial();
            const mesh = new THREE.InstancedMesh(asset.bark, this.barkMaterial, trees.length);
            mesh.name = `SakuraBark ${name}`;
            trees.forEach((tree, index) => {
                dummy.position.set(tree.x, tree.y, tree.z);
                dummy.rotation.set(0, tree.yaw, 0);
                dummy.scale.setScalar(tree.scale);
                dummy.updateMatrix();
                mesh.setMatrixAt(index, dummy.matrix);
                data.set([tree.x, tree.y, tree.z, asset.height * tree.scale], index * 4);
            });
            mesh.instanceMatrix.needsUpdate = true;
            mesh.castShadow = true;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            this.group.add(mesh);
            let drawn = asset.bark.index.count;
            if (!this.tier.twigs && asset.barkCoreIndices > 0 && asset.barkCoreIndices < drawn) {
                drawn = asset.barkCoreIndices;
            }
            // The geometry belongs to the asset bundle, so the range is set for every
            // tier and handed back in dispose().
            asset.bark.setDrawRange(0, drawn === asset.bark.index.count ? Infinity : drawn);
            this.borrowed.push(asset.bark);
            this.stats.barkTriangles += (drawn / 3) * trees.length;
        });
    }

    // -- blossom ------------------------------------------------------------------------
    createBlossomMaterial() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = 'SakuraBlossom';
        // Per-spray data rides on each spray geometry as instanced attributes.
        const crown = attribute('sakuraCrown', 'vec4'); // sky, sway, phase, hue
        const bent = attribute('sakuraBent', 'vec4'); // bent normal xyz, tree tone
        const tree = attribute('sakuraTree', 'vec4'); // base xyz, height
        const lamp = attribute('sakuraLamp', 'float'); // lantern light gathered at build
        const paint = attribute('color', 'vec4'); // along the petal, flower id, shade, petal (1) or wood (0)
        const treePhase = fract(tree.x.mul(0.37).add(tree.z.mul(0.71)));
        const t = light.uTime;
        const force = light.uWind.add(light.uGust);
        const flutter = sin(t.mul(paint.g.mul(3).add(5)).add(paint.g.mul(41)).add(crown.z.mul(13)))
            .mul(paint.r).mul(paint.a).mul(force.mul(0.03).add(0.006));
        material.positionNode = positionLocal
            .add(light.wind({
                world: positionLocal, base: tree.xyz, height: tree.w, treePhase, sway: crown.y, phase: crown.z,
            }))
            .add(vec3(light.uWindDir.x.mul(0.5), 1, light.uWindDir.z.mul(0.5)).mul(flutter));

        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const blade = normalize(normalWorld);
        const normal = normalize(mix(blade, bent.xyz, 0.55));
        // Colour: each tree sits somewhere between near-white and rose; every flower is a
        // little its own, and deepens toward its heart.
        const tone = saturate(bent.w.add(crown.w.sub(0.5).mul(0.3)).add(paint.g.sub(0.5).mul(0.36)));
        const pale = mix(color(0xffdfe8), color(0xff9fbe), tone);
        const heart = mix(color(0xe66a90), color(0xbe2c5c), tone);
        const petal = mix(heart, pale, smoothstep(0.06, 0.5, paint.r));
        const albedo = mix(color(0x140c0e), petal, paint.a).mul(paint.b);
        const glowing = pow(petal, vec3(0.8)).mul(paint.a);

        const moon = light.moonlight();
        const facing = dot(blade, light.uMoonDir);
        const wrap = saturate(dot(normal, light.uMoonDir).mul(0.6).add(0.4));
        const front = albedo.mul(wrap).mul(saturate(facing.mul(4).add(0.6)));
        // Thin-petal transmission: the moon on the far face lights the near one, most of
        // all when the eye looks straight up the beam.
        const through = pow(saturate(dot(view, light.uMoonDir).negate()), 3);
        const back = glowing.mul(saturate(facing.negate()).mul(0.4).add(through.mul(0.62)))
            .mul(crown.x.mul(0.5).add(0.5));
        const occlusion = crown.x.mul(0.8).add(0.2);
        const flicker = sin(t.mul(5.3).add(tree.x.mul(1.7))).mul(sin(t.mul(2.1).add(tree.z))).mul(0.06).add(0.94);
        // Lantern light pools inside the crown, where the sky does not reach.
        const lantern = light.uLampColor.mul(lamp).mul(light.uLampGain).mul(flicker)
            .mul(crown.x.oneMinus().mul(0.5).add(0.6))
            .mul(0.22);
        const ring = varying(light.rings(positionWorld.xz).band);
        const lit = front.add(back).mul(light.uMoonColor).mul(moon)
            .add(albedo.mul(light.ambient(normal)).mul(occlusion).mul(1.45))
            .add(albedo.mul(lantern))
            // The garden answers the game: blossom lit from within, and the ring of a
            // locked piece passing through the crowns.
            .add(glowing.mul(vec3(1.0, 0.56, 0.72)).mul(light.uGlow.mul(0.2).add(ring.mul(0.7)))
                .mul(crown.x.mul(0.5).add(0.5)));
        material.fragmentNode = vec4(light.haze(lit, { world }), 1);
        return material;
    }

    buildBlossom() {
        const visible = createSakuraVisibilityTest();
        const buckets = new Map();
        const position = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const yaw = new THREE.Quaternion();
        const bentNormal = new THREE.Vector3();
        const scale = new THREE.Vector3();
        const matrix = new THREE.Matrix4();
        const { variants } = this.assets.blossoms;
        this.placements.forEach((tree, treeIndex) => {
            const asset = this.assets.trees[tree.asset];
            const { sites } = asset;
            const keep = this.tier.foliage * (tree.far ? 0.6 : 1);
            const grow = (1 / keep) ** 0.36;
            yaw.setFromAxisAngle(UP, tree.yaw);
            for (let i = 0; i < sites.count; i += 1) {
                if (keepHash(i, treeIndex + 1) <= keep) {
                    position.fromArray(sites.position, i * 3).multiplyScalar(tree.scale).applyQuaternion(yaw);
                    position.x += tree.x;
                    position.y += tree.y;
                    position.z += tree.z;
                    const size = sites.scale[i] * tree.scale * grow;
                    if (visible(position.x, position.y, position.z, size * 1.2)) {
                        const key = `${asset.foliage}_${sites.variant[i] % variants}`;
                        if (!buckets.has(key)) {
                            buckets.set(key, {
                                kind: asset.foliage, matrices: [], crown: [], bent: [], tree: [], lamp: [],
                            });
                        }
                        const bucket = buckets.get(key);
                        rotation.fromArray(sites.rotation, i * 4).premultiply(yaw);
                        matrix.compose(position, rotation, scale.setScalar(size));
                        bucket.matrices.push(...matrix.elements);
                        bucket.crown.push(sites.sky[i], sites.sway[i], sites.phase[i], sites.hue[i]);
                        bentNormal.fromArray(sites.bent, i * 3).applyQuaternion(yaw);
                        bucket.bent.push(bentNormal.x, bentNormal.y, bentNormal.z, tree.tone);
                        bucket.tree.push(tree.x, tree.y, tree.z, asset.height * tree.scale);
                        bucket.lamp.push(Math.min(1.4, sakuraLanternReach(this.lanterns, position.x, position.y, position.z)));
                    } else this.stats.culledSprays += 1;
                }
            }
        });
        buckets.forEach((bucket, key) => {
            const geometry = this.assets.blossoms.meshes[key];
            if (!geometry) throw new Error(`[Sakura] Blossom mesh "${key}" is missing from the asset pack.`);
            const count = bucket.matrices.length / 16;
            // Spray kinds differ only in geometry and instance data: the data rides on the
            // geometry, so all of them share one material and one set of pipelines.
            geometry.setAttribute('sakuraCrown', new THREE.InstancedBufferAttribute(new Float32Array(bucket.crown), 4));
            geometry.setAttribute('sakuraBent', new THREE.InstancedBufferAttribute(new Float32Array(bucket.bent), 4));
            geometry.setAttribute('sakuraTree', new THREE.InstancedBufferAttribute(new Float32Array(bucket.tree), 4));
            geometry.setAttribute('sakuraLamp', new THREE.InstancedBufferAttribute(new Float32Array(bucket.lamp), 1));
            this.borrowed.push(geometry);
            if (!this.blossomMaterial) this.blossomMaterial = this.createBlossomMaterial();
            const mesh = new THREE.InstancedMesh(geometry, this.blossomMaterial, count);
            mesh.name = `SakuraBlossom ${key}`;
            mesh.instanceMatrix.array.set(bucket.matrices);
            mesh.instanceMatrix.needsUpdate = true;
            mesh.castShadow = true;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            this.group.add(mesh);
            this.stats.sprays += count;
            this.stats.blossomTriangles += (geometry.index.count / 3) * count;
        });
    }

    /** Points on the crowns where a petal may let go, as [x, y, z, tone]. */
    sampleCrownPoints(count, rng = this.rng) {
        const points = new Float32Array(count * 4);
        const yaw = new THREE.Quaternion();
        const position = new THREE.Vector3();
        const near = this.placements.filter((tree) => !tree.far);
        if (!near.length) return points;
        for (let i = 0; i < count; i += 1) {
            // The two old trees by the camera shed most of what is seen.
            const tree = rng() < 0.5 ? near[Math.floor(rng() * Math.min(2, near.length))]
                : near[Math.floor(rng() * near.length) % near.length];
            const asset = this.assets.trees[tree.asset];
            const site = Math.floor(rng() * asset.sites.count) % asset.sites.count;
            yaw.setFromAxisAngle(UP, tree.yaw);
            position.fromArray(asset.sites.position, site * 3).multiplyScalar(tree.scale).applyQuaternion(yaw);
            points.set([position.x + tree.x, position.y + tree.y, position.z + tree.z, tree.tone], i * 4);
        }
        return points;
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        // The geometries belong to the asset bundle: hand them back as they came.
        this.borrowed.forEach((geometry) => {
            geometry.setDrawRange(0, Infinity);
            INSTANCE_ATTRIBUTES.forEach((name) => geometry.deleteAttribute(name));
        });
        this.borrowed.length = 0;
        this.barkMaterial = null;
        this.blossomMaterial = null;
        this.group.removeFromParent();
        this.group.clear();
    }
}
