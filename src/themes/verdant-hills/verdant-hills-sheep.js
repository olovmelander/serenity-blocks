/**
 * Verdant Hills — the flock, drawn.
 *
 * Two models, the ewe and her lamb (assets/verdant-ewe.glb, assets/verdant-lamb.glb: one skinned
 * mesh each on the skeletons of verdant-hills-sheep-rig.js, modelled in headless Blender and rigged
 * by scripts/verdant-hills/model-sheep.mjs). Every sheep of a kind is one instance of one draw. The
 * flock (verdant-hills-flock.js) poses each one on the CPU; here its bones go into a float texture,
 * a row a sheep, two texels a bone (its rotation in the world, and where its joint stands with the
 * sheep's size), and the vertex stage skins every instance from its row: four bones a vertex,
 * blended. Two more texels a row lay the sheep's shadow on the grass.
 *
 * They are seen two hundred metres off and more, so they are drawn for their silhouette and their
 * light: the fleece takes the sun all round (wool scatters it), glows at its edges when the sun is
 * behind it, and goes cream, grey or the brown of a soiled breech from one ewe to the next; the
 * faces and legs are black. Each vertex's colour holds four numbers the modelling script baked:
 * how much of it is wool, how soiled the wool is, the darkest parts (eyes, nostrils, hooves), and
 * how much of the sky it sees.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, cross, dot, float, floor, instanceIndex, int, ivec2, length, mix, normalize,
    positionGeometry, positionWorld, pow, saturate, smoothstep, textureLoad, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EWE_BONES, LAMB_BONES } from './verdant-hills-sheep-rig.js';

export const VERDANT_HILLS_EWE_URL = new URL('./assets/verdant-ewe.glb', import.meta.url).href;
export const VERDANT_HILLS_LAMB_URL = new URL('./assets/verdant-lamb.glb', import.meta.url).href;

/** Texels a sheep's row holds: two a bone, and two for its shadow. */
const BONES = EWE_BONES.length;
const ROW = BONES * 2 + 2;
/** How far a shadow is drawn toward the eye along its line of sight, as a share of the distance. */
const SHADOW_PULL = 0.0015;

/**
 * The model of one kind from its GLB: its skinned geometry (bone indices and weights as normalised
 * bytes, one format on both backends) checked against the rig's bones. Null when it is not on the
 * skeleton it should be.
 */
export function parseVerdantHillsSheep(gltf, bones, name) {
    let skin = null;
    gltf.scene.traverse((child) => {
        if (child.isSkinnedMesh && !skin) skin = child;
    });
    if (!skin) return null;
    const names = skin.skeleton.bones.map((bone) => bone.name);
    if (names.length !== bones.length || names.some((bone, i) => bone !== bones[i][0])) {
        console.warn(`[Verdant Hills] the ${name} is not on the flock's skeleton.`);
        return null;
    }
    const source = skin.geometry;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', source.attributes.position);
    geometry.setAttribute('normal', source.attributes.normal);
    geometry.setAttribute('color', source.attributes.color);
    const bones8 = Uint8Array.from(source.attributes.skinIndex.array);
    geometry.setAttribute('_bones', new THREE.BufferAttribute(bones8, 4, true));
    const weights = source.attributes.skinWeight;
    geometry.setAttribute('_weights', weights.array instanceof Uint8Array
        ? new THREE.BufferAttribute(weights.array, 4, true)
        : new THREE.BufferAttribute(Uint8Array.from(weights.array, (w) => Math.round(w * 255)), 4, true));
    geometry.setIndex(source.index);
    geometry.name = `VerdantHills ${name}`;
    const materials = Array.isArray(skin.material) ? skin.material : [skin.material];
    materials.forEach((material) => material?.dispose?.());
    return { geometry, triangles: source.index ? source.index.count / 3 : 0 };
}

/** Fetch both models. Resolves null when either cannot be read (the hills keep their still flock). */
export async function loadVerdantHillsSheep({ loader = new GLTFLoader() } = {}) {
    try {
        const [ewe, lamb] = await Promise.all([
            loader.loadAsync(VERDANT_HILLS_EWE_URL),
            loader.loadAsync(VERDANT_HILLS_LAMB_URL),
        ]);
        const parsed = {
            ewe: parseVerdantHillsSheep(ewe, EWE_BONES, 'ewe'),
            lamb: parseVerdantHillsSheep(lamb, LAMB_BONES, 'lamb'),
        };
        if (!parsed.ewe || !parsed.lamb) {
            parsed.ewe?.geometry.dispose();
            parsed.lamb?.geometry.dispose();
            return null;
        }
        return parsed;
    } catch (error) {
        console.warn('[Verdant Hills] the flock did not arrive:', error?.message || error);
        return null;
    }
}

export function disposeVerdantHillsSheep(sheep) {
    sheep?.ewe?.geometry.dispose();
    sheep?.lamb?.geometry.dispose();
}

/** Turn a vector by a unit quaternion (TSL). */
const turn = (q, v) => {
    const t = cross(q.xyz, v).mul(2);
    return v.add(t.mul(q.w)).add(cross(q.xyz, t));
};

export class VerdantHillsSheep {
    /**
     * @param {object} o
     * @param {object} o.light  the light rig
     * @param {object} o.models what loadVerdantHillsSheep() resolved
     * @param {object} o.flock  a VerdantHillsFlock
     * @param {boolean} [o.shadows=true]  lay their shadows on the grass
     */
    constructor({
        light, models, flock, shadows = true,
    }) {
        this.light = light;
        this.models = models;
        this.flock = flock;
        this.shadows = shadows;
        this.group = new THREE.Group();
        this.group.name = 'VerdantHillsSheep';
        this.owned = [];
        this.triangles = 0;
        // Scratch for writing the table.
        this.q = [0, 0, 0, 1];
        this.v = [0, 0, 0];
    }

    build() {
        const { flock } = this;
        const count = flock.sheep.length;
        const data = new Float32Array(ROW * Math.max(1, count) * 4);
        const table = new THREE.DataTexture(data, ROW, Math.max(1, count), THREE.RGBAFormat, THREE.FloatType);
        table.minFilter = THREE.NearestFilter;
        table.magFilter = THREE.NearestFilter;
        table.generateMipmaps = false;
        table.colorSpace = THREE.NoColorSpace;
        table.name = 'VerdantHillsSheepPoses';
        table.needsUpdate = true;
        this.table = table;
        this.data = data;
        this.owned.push(table);
        [['ewe', false], ['lamb', true]].forEach(([kind, lamb]) => {
            const members = flock.sheep.filter((s) => s.lamb === lamb);
            if (!members.length) return;
            const model = this.models[kind];
            const geometry = new THREE.InstancedBufferGeometry();
            ['position', 'normal', 'color', '_bones', '_weights'].forEach((name) => {
                geometry.setAttribute(name, model.geometry.attributes[name]);
            });
            geometry.setIndex(model.geometry.index);
            geometry.instanceCount = members.length;
            // Each instance: its row in the table, and who it is (fleece tone, a black fleece, its seed).
            const looks = new Float32Array(members.length * 4);
            members.forEach((s, i) => {
                const entry = flock.entries[s.index];
                looks.set([s.index, s.look, entry.black ? 1 : 0, lamb ? 1 : 0], i * 4);
            });
            geometry.setAttribute('look', new THREE.InstancedBufferAttribute(looks, 4));
            const material = this.createMaterial(kind);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `VerdantHills ${kind}s`;
            mesh.frustumCulled = false;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            this.group.add(mesh);
            this.owned.push(geometry, material);
            this.triangles += model.triangles * members.length;
        });
        if (this.shadows) this.buildShadows(count);
        this.update();
        return this;
    }

    /** The skinned position and normal of an instance's vertex, from its row of the table. */
    skin(row) {
        const { table } = this;
        const ids = attribute('_bones', 'vec4');
        const ws = attribute('_weights', 'vec4');
        const p = positionGeometry;
        const n = attribute('normal', 'vec3');
        const pos = vec3(0).toVar();
        const nor = vec3(0).toVar();
        [ids.x, ids.y, ids.z, ids.w].forEach((id, k) => {
            const w = [ws.x, ws.y, ws.z, ws.w][k];
            const x = int(floor(id.mul(255).add(0.5))).mul(2);
            const q = textureLoad(table, ivec2(x, row)).toVar();
            const t = textureLoad(table, ivec2(x.add(1), row)).toVar();
            pos.addAssign(turn(q, p).mul(t.w).add(t.xyz).mul(w));
            nor.addAssign(turn(q, n).mul(w));
        });
        return { pos, nor };
    }

    createMaterial(kind) {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = `VerdantHillsSheep ${kind}`;
        const look = attribute('look', 'vec4');
        const paint = attribute('color', 'vec4'); // wool, soil, dark, sky seen
        const vNormal = varying(vec3(0, 1, 0), 'vhSheepNormal');
        const vPaint = varying(vec4(0), 'vhSheepPaint');
        const vLook = varying(vec4(0), 'vhSheepLook');
        material.positionNode = Fn(() => {
            const row = int(floor(look.x.add(0.5)));
            const { pos, nor } = this.skin(row);
            vNormal.assign(normalize(nor));
            vPaint.assign(paint);
            vLook.assign(look);
            return pos;
        })();
        material.colorNode = Fn(() => {
            const world = positionWorld;
            const N = normalize(vNormal).toVar();
            const V = normalize(cameraPosition.sub(world)).toVar();
            const wool = saturate(vPaint.x);
            const soil = saturate(vPaint.y);
            const dark = saturate(vPaint.z);
            // (Wool scatters light down into its own creases, and the shade was baked standing: the
            // wool tucked behind a shoulder comes out onto the flank as the leg swings. On the fleece
            // only a quarter of the bake's shade is kept; the bare skin keeps all of it.)
            const sees = mix(saturate(vPaint.w), saturate(vPaint.w).mul(0.25).add(0.75), saturate(vPaint.x));
            const tone = vLook.y;
            const black = vLook.z;
            const lamb = vLook.w;
            // The fleece: cream to clean white from one sheep to the next (a lamb's the cleanest),
            // grey-brown where it is soiled, and the black ewe's a dull brown-black.
            const clean = mix(vec3(0.66, 0.62, 0.53), vec3(0.82, 0.8, 0.74), saturate(tone.add(lamb.mul(0.45))));
            const soiled = mix(clean, vec3(0.42, 0.36, 0.27), soil.mul(lamb.mul(-0.5).add(0.85)));
            const fleece = mix(soiled, vec3(0.075, 0.062, 0.055).add(vec3(0.05, 0.04, 0.03).mul(tone)), black);
            // The bare skin of the face and legs is black; its darkest parts blacker.
            const skinColour = mix(vec3(0.045, 0.04, 0.038), vec3(0.018, 0.016, 0.015), dark);
            const albedo = mix(skinColour, fleece, wool).toVar();
            // The clouds' shadows only: the flock grazes far beyond the home hill's shadow map, where
            // a look-up in it would print false shade on the fleece.
            const sun = light.cloudShadow(world);
            const toward = dot(N, light.uSunDir);
            // Wool scatters the light round itself; bare skin is lit from the front only.
            const facing = mix(saturate(toward), pow(saturate(toward.mul(0.65).add(0.35)), 1.3), wool);
            // Seen against the sun its outline glows through the fleece (the longer, the more).
            const edge = pow(saturate(dot(N, V)).oneMinus(), 2.5);
            const behind = saturate(dot(V, light.uSunDir).negate().mul(0.8).add(0.25));
            const halo = edge.mul(behind).mul(wool.mul(0.9).add(0.1));
            const open = mix(float(0.22), float(1), sees.mul(sees));
            const fill = light.ambient(N).mul(open);
            const lit = albedo.mul(light.uSunColor).mul(facing.mul(0.38).mul(mix(float(0.45), float(1), sees))).mul(sun)
                .add(light.uSunColor.mul(albedo.mul(0.6).add(0.12)).mul(halo.mul(0.22)).mul(sun))
                .add(albedo.mul(fill));
            return vec4(light.haze(lit, { world }), 1);
        })();
        this.owned.push(material);
        return material;
    }

    /**
     * A soft shadow under every sheep: an ellipse laid on the grass, cast away from the sun as far
     * as the sheep is tall, with a darker shade right under its body. Drawn a hair toward the eye
     * along each line of sight, so it never fights the ground for depth.
     */
    buildShadows(count) {
        const { light, table } = this;
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([
            -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1,
        ], 3));
        geometry.setIndex([0, 2, 1, 0, 3, 2]);
        geometry.instanceCount = count;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, transparent: true, depthWrite: false });
        material.name = 'VerdantHillsSheepShadows';
        const vUv = varying(vec2(0), 'vhShadowUv');
        const vSpot = varying(vec4(0), 'vhShadowSpot');
        material.positionNode = Fn(() => {
            const row = int(instanceIndex);
            // centre on the grass (x, y, z) and strength; the cast's way (x, z), its length and width
            const a = textureLoad(table, ivec2(BONES * 2, row));
            const b = textureLoad(table, ivec2(BONES * 2 + 1, row));
            const along = vec3(b.x, 0, b.y);
            const across = vec3(b.y.negate(), 0, b.x);
            const corner = positionGeometry;
            const flat = along.mul(corner.x.mul(b.z)).add(across.mul(corner.z.mul(b.w)));
            const ground = a.xyz.add(flat);
            vUv.assign(corner.xz);
            vSpot.assign(vec4(corner.x, corner.z, a.w, 0));
            const toEye = cameraPosition.sub(ground);
            return ground.add(toEye.mul(SHADOW_PULL));
        })();
        material.colorNode = Fn(() => {
            const r = length(vUv);
            const soft = smoothstep(1, 0.25, r).mul(smoothstep(1, 0.6, r).mul(0.5).add(0.5));
            // Out in the sun it is a shadow; under a cloud only the shade under the body is left.
            const sun = saturate(light.cloudShadow(positionWorld));
            const shade = soft.mul(vSpot.z).mul(sun.mul(0.75).add(0.25));
            return vec4(vec3(0.02, 0.035, 0.015), saturate(shade));
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'VerdantHills sheep shadows';
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;
        this.group.add(mesh);
        this.owned.push(geometry, material);
        this.shadowMesh = mesh;
    }

    /** Write every sheep's bones (and its shadow) into the table. */
    update() {
        const { flock, data } = this;
        const sun = this.light.uSunDir.value;
        const flat = Math.hypot(sun.x, sun.z) || 1;
        const sx = -sun.x / flat;
        const sz = -sun.z / flat;
        const stretch = flat / Math.max(0.15, sun.y);
        for (const s of flock.sheep) {
            const base = s.index * ROW * 4;
            const h = s.heading;
            const hs = Math.sin(h / 2);
            const hc = Math.cos(h / 2);
            const sinH = Math.sin(h);
            const cosH = Math.cos(h);
            const k = s.scale;
            const px = s.x;
            const py = s.y + s.lift - 0.02 * k;
            const pz = s.z;
            const { world, at } = s.posture;
            const { bones } = s.rig;
            for (let b = 0; b < BONES; b++) {
                const q = world[b];
                // The heading, then the bone: q = qh · qb (qh about +y).
                const qx = hc * q[0] + hs * q[2];
                const qy = hc * q[1] + hs * q[3];
                const qz = hc * q[2] - hs * q[0];
                const qw = hc * q[3] - hs * q[1];
                // Where the bone's rest point lands: at[b] − qb·rest[b], turned by the heading and sized.
                const rx = bones[b][2];
                const ry = bones[b][3];
                const rz = bones[b][4];
                const tx = 2 * (q[1] * rz - q[2] * ry);
                const ty = 2 * (q[2] * rx - q[0] * rz);
                const tz = 2 * (q[0] * ry - q[1] * rx);
                const ox = at[b][0] - (rx + q[3] * tx + (q[1] * tz - q[2] * ty));
                const oy = at[b][1] - (ry + q[3] * ty + (q[2] * tx - q[0] * tz));
                const oz = at[b][2] - (rz + q[3] * tz + (q[0] * ty - q[1] * tx));
                const o = base + b * 8;
                // (q and −q turn a vertex alike: the stage blends turned vertices, never quaternions.)
                const sign = qw < 0 ? -1 : 1;
                data[o] = qx * sign;
                data[o + 1] = qy * sign;
                data[o + 2] = qz * sign;
                data[o + 3] = qw * sign;
                data[o + 4] = px + (ox * cosH + oz * sinH) * k;
                data[o + 5] = py + oy * k;
                data[o + 6] = pz + (-ox * sinH + oz * cosH) * k;
                data[o + 7] = k;
            }
            // Its shadow: under its middle, cast away from the sun by its height; smaller and darker
            // lying down; off the grass for a leaping lamb, fainter the higher it springs.
            const o = base + BONES * 8;
            const lying = s.act === 'Lie' ? 1 : 0;
            const tall = (s.lamb ? 0.42 : 0.72) * k * (1 - 0.45 * lying);
            const long = (s.lamb ? 0.42 : 0.72) * k;
            const cast = tall * stretch * 0.5;
            const along = Math.abs(sx * sinH + sz * cosH);
            data[o] = s.x + sx * cast;
            data[o + 1] = s.y;
            data[o + 2] = s.z + sz * cast;
            data[o + 3] = (0.5 + 0.15 * lying) / (1 + s.lift * 3);
            data[o + 4] = sx;
            data[o + 5] = sz;
            data[o + 6] = cast + long * (0.45 + 0.55 * along);
            data[o + 7] = 0.3 * k + long * 0.5 * (1 - along);
        }
        this.table.needsUpdate = true;
    }

    dispose() {
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}
