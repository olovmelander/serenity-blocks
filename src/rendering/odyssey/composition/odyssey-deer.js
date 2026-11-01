/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE GLADE'S DEER — a small herd of red deer grazing the open slope above the chapter-3 shore
 * (chapters 2-3, Odyssey's first animals on the ground, 2026-11-01). Their life is
 * odyssey-deer-herd.js (three-free); this draws it.
 *
 * The model is a Blender-built red deer hind (`assets/chapter-03/deer/red-deer.glb`, built by
 * scripts/blender/odyssey/red_deer.py: one mesh, ~1,800 triangles, skinned to 25 bones through
 * its own `_bones`/`_weights` attributes, coat paint in its vertex colours). Every deer is one
 * instance of ONE draw: the herd poses each on the CPU, its bones go into a float table (a row a
 * deer, two texels a bone: its rotation in the world, and where its rest frame lands with its
 * size), and the vertex stage skins each instance from its row, four bones a vertex (Verdant
 * Hills' flock, the same technique). A second draw lays a soft shadow under each, on the slope's
 * own plane, cast a little away from the sun.
 *
 * ZERO-HITCH (ADR-0020), the eagle's lifecycle exactly: nothing here touches the GPU until the
 * board says so. `load()` only fetches + parses (and builds the geometry and the table, CPU
 * arrays); the board compiles the group through its live-loop path while idle and only then calls
 * `markReady()`. Until ready the group stays hidden; after it only uniforms and the table's data
 * change. A load or compile failure leaves the act exactly as it was.
 * BISECT LEVER (board): `?odysseyNoDeer=1`.
 *
 * Its light is the act's: the world's low sun from the left of the frame, the sky from above,
 * the meadow's green bounced up under the belly, a little sky on the edges, and the air between
 * it and the eye. The coat scatters light round itself a little (wrapped), so the shade side
 * stays a warm brown rather than going black.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, cross, dot, exp, float, floor, instanceIndex, int, ivec2,
    length, max, mix, normalize, positionGeometry, positionWorld, smoothstep, textureLoad, varying,
    vec2, vec3, vec4,
} from 'three/tsl';
import { loadOdysseyGltfCached } from '../chapter-environments/shared/odyssey-gltf-loader.js';
import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';
import { odysseyWorldHeight } from '../world/odyssey-world-height.js';
import {
    ODYSSEY_DEER, buildHerd, createDeerRig, deerRevealAt, deerStateAt, poseDeer,
} from './odyssey-deer-herd.js';

export const ODYSSEY_DEER_URL = new URL('../assets/chapter-03/deer/red-deer.glb', import.meta.url).href;

/** The vertex attributes the model must carry. */
const DEER_ATTRIBUTES = Object.freeze(['position', 'normal', 'color', '_bones', '_weights']);
/** Texels a row of the table holds after the bones: the shadow (centre, cast, plane). */
const SHADOW_TEXELS = 3;
/** How far a shadow is drawn toward the eye along its line of sight, as a share of the distance. */
const SHADOW_PULL = 0.002;

/** Turn a vector by a unit quaternion (TSL). */
const turn = (q, v) => {
    const t = cross(q.xyz, v).mul(2);
    return v.add(t.mul(q.w)).add(cross(q.xyz, t));
};

/**
 * The model from the parsed GLB: a geometry in metres (quantised positions decoded through the
 * node's scale and translation) and its skeleton. Throws when it is not what the herd needs.
 * @param {THREE.Object3D} root gltf.scene
 */
export function parseOdysseyDeer(root) {
    const mesh = root.children.find((c) => c.name === 'deer' && c.geometry) ?? null;
    if (!mesh) throw new Error('[Odyssey deer] the model has no "deer" mesh');
    const source = mesh.geometry;
    DEER_ATTRIBUTES.forEach((name) => {
        if (!source.attributes[name]) throw new Error(`[Odyssey deer] the model lacks its "${name}" attribute`);
    });
    const skeleton = root.userData?.skeleton;
    if (!Array.isArray(skeleton) || !skeleton.length) throw new Error('[Odyssey deer] the model lacks its skeleton');
    const src = source.attributes.position;
    const positions = new Float32Array(src.count * 3);
    const { position: t, scale: s } = mesh;
    for (let i = 0; i < src.count; i += 1) {
        positions[i * 3] = (src.getX(i) * s.x) + t.x;
        positions[(i * 3) + 1] = (src.getY(i) * s.y) + t.y;
        positions[(i * 3) + 2] = (src.getZ(i) * s.z) + t.z;
    }
    // Own copies of every attribute (plain, not interleaved): the herd's geometry can be disposed
    // without touching the cached model, and nothing here is ever re-uploaded from a disposed view.
    const normals = new Float32Array(src.count * 3);
    const nrm = source.attributes.normal;
    for (let i = 0; i < src.count; i += 1) {
        normals[i * 3] = nrm.getX(i);
        normals[(i * 3) + 1] = nrm.getY(i);
        normals[(i * 3) + 2] = nrm.getZ(i);
    }
    const bytes = (attr) => {
        const out = new Uint8Array(attr.count * 4);
        for (let i = 0; i < attr.count; i += 1) {
            [attr.getX(i), attr.getY(i), attr.getZ(i), attr.getW(i)].forEach((v, c) => {
                // getX() returns the normalised value of a normalised attribute.
                out[(i * 4) + c] = Math.round(Math.max(0, Math.min(1, attr.normalized ? v : v / 255)) * 255);
            });
        }
        return new THREE.BufferAttribute(out, 4, true);
    };
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    ['color', '_bones', '_weights'].forEach((name) => geometry.setAttribute(name, bytes(source.attributes[name])));
    geometry.setIndex(new THREE.BufferAttribute(Uint16Array.from(source.index.array), 1));
    geometry.name = 'OdysseyDeer';
    return {
        geometry,
        skeleton: skeleton.map((b) => ({ name: b.name, parent: b.parent, head: [...b.head] })),
        triangles: source.index ? source.index.count / 3 : 0,
    };
}

/**
 * @param {object} [opts]
 * @param {object} [opts.hazeColour] TSL vec3 node: the world's horizon (the air colour)
 * @param {object} [opts.sunColour] TSL vec3 node: the world's sun colour
 * @param {(x: number, z: number) => number} [opts.heightAt] the drawn ground (the world's mirror)
 * @param {string} [opts.url] model URL
 * @param {(url: string) => Promise<{scene: THREE.Object3D}>} [opts.loadGltf] the fetch + parse (tests)
 */
export function createOdysseyDeer({
    hazeColour = null, sunColour = null, heightAt = odysseyWorldHeight, url = ODYSSEY_DEER_URL,
    loadGltf = loadOdysseyGltfCached,
} = {}) {
    const group = new THREE.Group();
    group.name = 'odyssey-deer';
    group.visible = false;
    const herd = buildHerd(ODYSSEY_DEER);
    const count = herd.length;
    const sun = sunColour ?? vec3(1.0, 0.95, 0.86);
    const haze = hazeColour ?? vec3(0.72, 0.82, 0.93);
    const sunD = new THREE.Vector3(...ODYSSEY_WORLD_SUN).normalize();
    const L = vec3(sunD.x, sunD.y, sunD.z);

    let model = null;
    let rig = null;
    let table = null;
    let data = null;
    let row = 0;
    let bones = 0;
    let loaded = false;
    let ready = false;
    const states = herd.map(() => ({}));
    let triangles = 0;

    /** The herd's draw: every deer an instance, skinned from its row of the table. */
    function buildMaterial() {
        const material = new THREE.MeshBasicNodeMaterial();
        material.name = 'OdysseyDeer';
        material.fog = false;
        const look = attribute('look', 'vec4'); // row, tone, size, -
        const paint = attribute('color', 'vec4'); // pale, dark, grey, sky seen
        const vNormal = varying(vec3(0, 1, 0), 'odDeerNormal');
        const vPaint = varying(vec4(0), 'odDeerPaint');
        const vLook = varying(vec4(0), 'odDeerLook');
        material.positionNode = Fn(() => {
            const r = int(floor(look.x.add(0.5)));
            const ids = attribute('_bones', 'vec4');
            const ws = attribute('_weights', 'vec4');
            const p = positionGeometry;
            const n = attribute('normal', 'vec3');
            const pos = vec3(0).toVar();
            const nor = vec3(0).toVar();
            [ids.x, ids.y, ids.z, ids.w].forEach((id, k) => {
                const w = [ws.x, ws.y, ws.z, ws.w][k];
                const x = int(floor(id.mul(255).add(0.5))).mul(2);
                const q = textureLoad(table, ivec2(x, r)).toVar();
                const t = textureLoad(table, ivec2(x.add(1), r)).toVar();
                pos.addAssign(turn(q, p).mul(t.w).add(t.xyz).mul(w));
                nor.addAssign(turn(q, n).mul(w));
            });
            vNormal.assign(normalize(nor));
            vPaint.assign(paint);
            vLook.assign(look);
            return pos;
        })();
        material.colorNode = Fn(() => {
            const N = normalize(vNormal).toVar();
            const toEye = cameraPosition.sub(positionWorld);
            const V = normalize(toEye).toVar();
            const pale = clamp(vPaint.x, 0, 1);
            const dark = clamp(vPaint.y, 0, 1);
            const grey = clamp(vPaint.z, 0, 1);
            const seen = clamp(vPaint.w, 0, 1);
            const tone = vLook.y;
            // The summer coat: a warm red-brown, a little redder or duller from one hind to the next;
            // the neck, head and lower legs greyer; the rump patch, belly and insides cream; the
            // hooves, nose and eyes near black.
            const coat = mix(vec3(0.20, 0.072, 0.026), vec3(0.27, 0.105, 0.04), tone);
            const greyCoat = mix(coat, vec3(0.115, 0.075, 0.05), grey.mul(0.8));
            // The rump patch (and the tail on it) a pale cream, the belly and chin toward it.
            const buff = mix(greyCoat, vec3(0.66, 0.56, 0.39), pale);
            const albedo = mix(buff, vec3(0.018, 0.014, 0.012), dark).toVar();
            // Fur wraps the light round itself a little; the bake's occlusion darkens the creases.
            const ndl = clamp(dot(N, L).add(0.35).div(1.35), 0, 1);
            const skyUp = max(N.y, 0);
            const meadowUp = max(N.y.negate(), 0);
            // The sky from above (its blue softened toward the warm air of the act, so a red coat in
            // shade stays brown, not purple) and the sunlit meadow's green-gold bounced up from below.
            const sky = mix(haze, vec3(0.62, 0.58, 0.5), 0.45);
            const ambient = sky.mul(skyUp.mul(0.26).add(0.17))
                .add(vec3(0.2, 0.24, 0.1).mul(meadowUp.mul(0.34).add(0.06)));
            const occlusion = mix(float(0.5), float(1), seen);
            const lit = albedo.mul(sun.mul(ndl.mul(0.95)).add(ambient)).mul(occlusion).toVar();
            // A little sky on the edges keeps the outline against the grass.
            const edge = float(1).sub(abs(dot(N, V)));
            const rim = haze.mul(edge.mul(edge).mul(edge).mul(0.05));
            const air = float(1).sub(exp(length(toEye).div(-2600.0)));
            return mix(lit.add(rim), haze, air.mul(0.8));
        })();
        return material;
    }

    /** The shadows' draw: an ellipse on the slope's plane under each deer, cast from the sun. */
    function buildShadow() {
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([
            -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1,
        ], 3));
        geometry.setIndex([0, 2, 1, 0, 3, 2]);
        geometry.instanceCount = count;
        geometry.name = 'OdysseyDeerShadows';
        const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
        material.name = 'OdysseyDeerShadows';
        material.fog = false;
        const vUv = varying(vec2(0), 'odDeerShadowUv');
        const vStrength = varying(float(0), 'odDeerShadowStrength');
        material.positionNode = Fn(() => {
            const r = int(instanceIndex);
            // a: the centre on the ground (x, y, z) and the strength; b: the cast's way (x, z), its
            // length and width; c: the ground's slope (dy/dx, dy/dz).
            const a = textureLoad(table, ivec2(bones * 2, r));
            const b = textureLoad(table, ivec2(bones * 2 + 1, r));
            const c = textureLoad(table, ivec2(bones * 2 + 2, r));
            const along = vec2(b.x, b.y);
            const across = vec2(b.y.negate(), b.x);
            const corner = positionGeometry;
            const flat = along.mul(corner.x.mul(b.z)).add(across.mul(corner.z.mul(b.w)));
            const ground = vec3(a.x.add(flat.x), a.y.add(flat.x.mul(c.x)).add(flat.y.mul(c.y)), a.z.add(flat.y));
            vUv.assign(corner.xz);
            vStrength.assign(a.w);
            const toEye = cameraPosition.sub(ground);
            return ground.add(toEye.mul(SHADOW_PULL));
        })();
        material.colorNode = Fn(() => {
            const d = length(vUv);
            const soft = smoothstep(1, 0.2, d).mul(smoothstep(1, 0.55, d).mul(0.4).add(0.6));
            const toEye = cameraPosition.sub(positionWorld);
            const air = float(1).sub(exp(length(toEye).div(-2600.0)));
            return vec4(vec3(0.03, 0.05, 0.02), soft.mul(vStrength).mul(float(1).sub(air)));
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'odyssey-deer-shadows';
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;
        return mesh;
    }

    /** Pose the whole herd at board time `time` into the table. */
    function poseHerd(time) {
        const flat = Math.hypot(sunD.x, sunD.z) || 1;
        const sx = -sunD.x / flat;
        const sz = -sunD.z / flat;
        herd.forEach((deer, i) => {
            const state = deerStateAt(deer, time, states[i]);
            const base = i * row * 4;
            const out = poseDeer(rig, state, deer.k, heightAt, time, deer.member.seed, data, base);
            // The shadow: under the body, drawn a little from the sun (the sun is low: the cast is
            // kept short and soft, a contact shade more than a silhouette).
            const o = base + (bones * 8);
            const tall = 1.1 * deer.k;
            const cast = tall * 0.45;
            data[o] = state.x + (sx * cast);
            data[o + 1] = out.ground;
            data[o + 2] = state.z + (sz * cast);
            data[o + 3] = 0.42;
            data[o + 4] = sx;
            data[o + 5] = sz;
            const along = Math.abs((sx * Math.sin(state.heading)) + (sz * Math.cos(state.heading)));
            data[o + 6] = cast + (0.75 * deer.k * (0.4 + (0.6 * along)));
            data[o + 7] = (0.32 * deer.k) + (0.6 * deer.k * (1 - along));
            data[o + 8] = out.gx;
            data[o + 9] = out.gz;
        });
        table.needsUpdate = true;
    }

    return {
        group,
        herd,
        /** Fetch + parse only (CPU arrays, no GPU work). Resolves true when the herd is in the group. */
        async load() {
            if (loaded) return true;
            const gltf = await loadGltf(url);
            model = parseOdysseyDeer(gltf.scene);
            rig = createDeerRig(model.skeleton);
            bones = model.skeleton.length;
            row = (bones * 2) + SHADOW_TEXELS;
            data = new Float32Array(row * count * 4);
            table = new THREE.DataTexture(data, row, count, THREE.RGBAFormat, THREE.FloatType);
            table.minFilter = THREE.NearestFilter;
            table.magFilter = THREE.NearestFilter;
            table.generateMipmaps = false;
            table.colorSpace = THREE.NoColorSpace;
            table.name = 'OdysseyDeerPoses';
            const { geometry } = model;
            geometry.instanceCount = count;
            const looks = new Float32Array(count * 4);
            herd.forEach((deer, i) => looks.set([i, deer.member.tone, deer.member.size, 0], i * 4));
            geometry.setAttribute('look', new THREE.InstancedBufferAttribute(looks, 4));
            const mesh = new THREE.Mesh(geometry, buildMaterial());
            mesh.name = 'odyssey-deer-herd';
            mesh.frustumCulled = false;
            group.add(buildShadow(), mesh);
            triangles = model.triangles * count;
            poseHerd(0);
            loaded = true;
            return true;
        },
        /** The board calls this after its live-loop compile landed; only then may it draw. */
        markReady() { ready = loaded; },
        get isLoaded() { return loaded; },
        get isReady() { return ready; },
        /** Where each deer stood at the last update (read-only; captures and probes). */
        get states() { return states; },
        /** Triangles the herd draws (all instances), for the record. */
        get triangles() { return triangles; },
        /** Reveal (0 or 1) the progress window asks for at `p`. */
        revealAt(p) { return deerRevealAt(p); },
        /**
         * @param {number} time board clock (s)
         * @param {number} progress journey progress
         */
        update(time, progress) {
            const show = ready && deerRevealAt(progress) > 0;
            group.visible = show;
            if (!show) return;
            poseHerd(time);
        },
        dispose() {
            group.traverse((o) => {
                if (!o.isMesh) return;
                o.material?.dispose?.();
                // The deer geometry is ours (built from the cached model's arrays); the cached
                // model's own geometry is never disposed here.
                o.geometry?.dispose?.();
            });
            table?.dispose();
            group.removeFromParent();
        },
    };
}
