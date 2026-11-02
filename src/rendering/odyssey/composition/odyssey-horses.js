/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE MEADOW'S WILD HORSES — a band of wild horses on the open meadow east of the rail (chapters
 * 3-4, 2026-11-02): grazing and wandering most of the time, foals at their mothers' sides, and
 * twice a loop a gallop round the copse or along the open band. Their life is
 * odyssey-horse-band.js (three-free); this draws it, the way odyssey-deer.js draws the deer.
 *
 * The models are Blender-built (`assets/chapter-03/horses/wild-horses.glb`, built by
 * scripts/blender/odyssey/wild_horse.py): a mare (~2,400 triangles) and a foal (~1,800), each one
 * mesh skinned to its own 29-bone skeleton through `_bones`/`_weights`, the coat's masks in the
 * vertex colours (pale, points, black, sky seen). The coat itself (bay, dun, grey) is a tint per
 * horse. Every horse is one instance of one of TWO draws (the mares and the foals): the band poses
 * each on the CPU into one float table (a row a horse, two texels a bone), and the vertex stage
 * skins each instance from its row. A third draw lays a soft shadow under each.
 *
 * ZERO-HITCH (ADR-0020), the deer's lifecycle exactly (`driveOdysseyHorses`): fetched and planned
 * off the GPU as the window approaches, compiled through the board's live-loop path while idle,
 * only then drawn; a load or compile failure leaves the act exactly as it was.
 * BISECT LEVER (board): `?odysseyNoHorses=1`.
 *
 * Their light is the deer's: the world's low sun, the sky from above (softened toward the act's
 * warm air), the meadow's green bounced up under the belly, a little sky on the edges, the air
 * between them and the eye.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, cross, dot, exp, float, floor, instanceIndex, int, ivec2,
    length, max, mix, mx_noise_float as mxNoise, mx_worley_noise_float as mxWorley, normalize, positionGeometry, positionWorld, pow,
    sin, smoothstep, textureLoad, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { loadOdysseyGltfCached } from '../chapter-environments/shared/odyssey-gltf-loader.js';
import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';
import { odysseyWorldHeight } from '../world/odyssey-world-height.js';
import {
    HORSE_DUST, ODYSSEY_HORSES, bandDustAt, buildBand, createHorseRig, gaitShares, horseRevealAt, planFootfalls,
    poseHorse,
} from './odyssey-horse-band.js';

export const ODYSSEY_HORSES_URL = new URL('../assets/chapter-03/horses/wild-horses.glb', import.meta.url).href;

/** The vertex attributes each model must carry. */
const HORSE_ATTRIBUTES = Object.freeze(['position', 'normal', 'color', '_bones', '_weights', '_hair']);
/**
 * Texels a row of the table holds after the bones: the shadow (centre, cast, plane), then the
 * gait (stride phase, trot share, canter share, board time) the hair moves with.
 */
const EXTRA_TEXELS = 4;
/** The most dust puffs drawn at once (the band at a gallop raises ~60). */
const DUST_MAX = 112;
/** How far a shadow is drawn toward the eye along its line of sight, as a share of the distance. */
const SHADOW_PULL = 0.002;
/** The coats' order in the shader's pick (`look.z`). */
const COAT_ORDER = Object.freeze(['bay', 'dun', 'grey']);
/** The two models, in the order their rows sit in the table. */
const MODELS = Object.freeze(['horse', 'foal']);

/** Turn a vector by a unit quaternion (TSL). */
const turn = (q, v) => {
    const t = cross(q.xyz, v).mul(2);
    return v.add(t.mul(q.w)).add(cross(q.xyz, t));
};

/**
 * One model from the parsed GLB: a geometry in metres (quantised positions decoded through the
 * node's scale and translation) and its skeleton. Throws when it is not what the band needs.
 * @param {THREE.Object3D} root gltf.scene
 * @param {'horse'|'foal'} name
 */
export function parseOdysseyHorse(root, name) {
    const mesh = root.children.find((c) => c.name === name && c.geometry) ?? null;
    if (!mesh) throw new Error(`[Odyssey horses] the model has no "${name}" mesh`);
    const source = mesh.geometry;
    HORSE_ATTRIBUTES.forEach((attr) => {
        if (!source.attributes[attr]) throw new Error(`[Odyssey horses] the ${name} lacks its "${attr}" attribute`);
    });
    const skeleton = root.userData?.skeletons?.[name];
    if (!Array.isArray(skeleton) || !skeleton.length) throw new Error(`[Odyssey horses] the ${name} lacks its skeleton`);
    const src = source.attributes.position;
    const positions = new Float32Array(src.count * 3);
    const { position: t, scale: s } = mesh;
    for (let i = 0; i < src.count; i += 1) {
        positions[i * 3] = (src.getX(i) * s.x) + t.x;
        positions[(i * 3) + 1] = (src.getY(i) * s.y) + t.y;
        positions[(i * 3) + 2] = (src.getZ(i) * s.z) + t.z;
    }
    // Own plain copies of every attribute: the band's geometry can be disposed without touching
    // the cached model, and nothing is ever re-uploaded from a disposed interleaved view.
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
                out[(i * 4) + c] = Math.round(Math.max(0, Math.min(1, attr.normalized ? v : v / 255)) * 255);
            });
        }
        return new THREE.BufferAttribute(out, 4, true);
    };
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    ['color', '_bones', '_weights', '_hair'].forEach((attr) => geometry.setAttribute(attr, bytes(source.attributes[attr])));
    geometry.setIndex(new THREE.BufferAttribute(Uint16Array.from(source.index.array), 1));
    geometry.name = name === 'foal' ? 'OdysseyHorseFoal' : 'OdysseyHorse';
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
export function createOdysseyHorses({
    hazeColour = null, sunColour = null, heightAt = odysseyWorldHeight, url = ODYSSEY_HORSES_URL,
    loadGltf = loadOdysseyGltfCached,
} = {}) {
    const group = new THREE.Group();
    group.name = 'odyssey-horses';
    group.visible = false;
    // The table's rows: the mares first, then the foals (each draw indexes its own rows).
    const band = buildBand(ODYSSEY_HORSES);
    const order = MODELS.flatMap((name) => band.filter((h) => h.member.model === name));
    const count = order.length;
    const sun = sunColour ?? vec3(1.0, 0.95, 0.86);
    const haze = hazeColour ?? vec3(0.72, 0.82, 0.93);
    const sunD = new THREE.Vector3(...ODYSSEY_WORLD_SUN).normalize();
    const L = vec3(sunD.x, sunD.y, sunD.z);

    const rigs = {};
    let table = null;
    let data = null;
    let dustMesh = null;
    let dustData = null;
    let dustAttr = null;
    let dustSize = null;
    let dustSizeAttr = null;
    const dustScratch = new Float32Array(DUST_MAX * 4);
    let row = 0;
    let bones = 0;
    let loaded = false;
    let ready = false;
    const states = order.map(() => ({}));
    let triangles = 0;

    /** One model's draw: every horse of it an instance, skinned from its row of the table. */
    function buildMaterial(name) {
        const material = new THREE.MeshBasicNodeMaterial();
        material.name = name === 'foal' ? 'OdysseyHorseFoals' : 'OdysseyHorses';
        material.fog = false;
        // (Six geometry attributes and ONE instanced: WebGPU allows eight vertex buffers a draw,
        // so the coat is an index into the three coats, picked here, not three colour attributes.)
        const look = attribute('look', 'vec4'); // row, tone, coat (0 bay, 1 dun, 2 grey), -
        const paint = attribute('color', 'vec4'); // pale, points, black, sky seen
        const hairMask = attribute('_hair', 'vec4'); // hair, flutter, definition, barring
        const vNormal = varying(vec3(0, 1, 0), 'odHorseNormal');
        const vPaint = varying(vec4(0), 'odHorsePaint');
        const vLook = varying(vec4(0), 'odHorseLook');
        const vHair = varying(vec4(0), 'odHorseHair');
        const vRest = varying(vec3(0), 'odHorseRest');
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
            // THE HAIR MOVES WITH THE GAIT: the mane, forelock and tail tips (their flutter) bob
            // with the stride (twice a stride at a trot, once at a canter, lagging toward the
            // tips), stream back and lift in a run, and sway a little in the air while it stands.
            const gait = textureLoad(table, ivec2(int(bones * 2 + 3), r)).toVar(); // phase, trot, canter, time
            const root = textureLoad(table, ivec2(int(0), r));
            const scale = textureLoad(table, ivec2(int(1), r)).w;
            const fwd = turn(root, vec3(0, 0, 1));
            const side = turn(root, vec3(1, 0, 0));
            const f = hairMask.y;
            const ph = gait.x.mul(Math.PI * 2);
            const bob = sin(ph.mul(2).sub(f.mul(1.4))).mul(gait.y.mul(0.035))
                .add(sin(ph.sub(f.mul(1.3))).mul(gait.z.mul(0.06)));
            const stream = gait.z.mul(0.1).add(gait.y.mul(0.03));
            const sway = sin(gait.w.mul(1.3).add(look.x.mul(1.7)).add(f.mul(2.2))).mul(0.02);
            pos.addAssign(vec3(0, 1, 0).mul(bob.add(gait.z.mul(0.035))).sub(fwd.mul(stream)).add(side.mul(sway))
                .mul(f.mul(scale)));
            vNormal.assign(normalize(nor));
            vPaint.assign(paint);
            vLook.assign(look);
            vHair.assign(hairMask);
            vRest.assign(p);
            return pos;
        })();
        material.colorNode = Fn(() => {
            const N = normalize(vNormal).toVar();
            const toEye = cameraPosition.sub(positionWorld);
            const V = normalize(toEye).toVar();
            const pale = clamp(vPaint.x, 0, 1);
            const points = clamp(vPaint.y, 0, 1);
            const black = clamp(vPaint.z, 0, 1);
            const seen = clamp(vPaint.w, 0, 1);
            const hair = clamp(vHair.x, 0, 1);
            const definition = vHair.z;
            const barring = clamp(vHair.w, 0, 1);
            const idx = vLook.z;
            const dun = smoothstep(0.4, 0.6, idx).mul(smoothstep(1.6, 1.4, idx));
            const grey = smoothstep(1.4, 1.6, idx);
            const coat = (key) => {
                const [a, b, c] = COAT_ORDER.map((coatName) => vec3(...ODYSSEY_HORSES.coats[coatName][key]));
                return mix(mix(a, b, smoothstep(0.4, 0.6, idx)), c, smoothstep(1.4, 1.6, idx));
            };
            // THE COAT. Its body colour a touch lighter or darker from one horse to the next; a
            // grey's dappled (light rounds in a darker net, on the body, not the legs or head);
            // the mealy muzzle and belly toward the pale; the mane, tail, dorsal stripe and
            // lower legs the points colour, and a dun's faint bars on the forearms and gaskins;
            // hooves, eyes and nostrils near black whatever the coat.
            // (Dapples: soft light rounds in a darker net over the barrel and quarters, fading up
            // the neck and down the legs.)
            const dappleCell = mxWorley(vRest.mul(6.5));
            const onBody = smoothstep(0.55, 0.85, vRest.y).mul(smoothstep(1.75, 1.35, vRest.y));
            const dapple = smoothstep(0.12, 0.5, dappleCell).mul(grey).mul(float(1).sub(points)).mul(onBody);
            const body = coat('body').mul(mix(float(0.88), float(1.1), vLook.y)).mul(float(1.06).sub(dapple.mul(0.2)));
            const mealy = mix(body, coat('pale'), pale.mul(0.85));
            // (A dun's leg bars: faint, thin and a little uneven, never a zebra's.)
            const wobble = mxNoise(vRest.mul(9)).mul(0.012);
            const bars = smoothstep(0.62, 0.9, sin(vRest.y.add(wobble).mul((Math.PI * 2) / 0.085)).mul(0.5).add(0.5));
            const barred = barring.mul(bars).mul(dun).mul(0.12);
            const pointed = mix(mealy, coat('points'), clamp(points.add(barred), 0, 1));
            // The hair in strands: a streaked darkening along its fall.
            const strands = mxNoise(vRest.mul(vec3(70, 9, 70))).mul(0.5).add(0.5);
            const haired = pointed.mul(mix(float(1), mix(float(0.72), float(1.12), strands), hair));
            const albedo = mix(haired, vec3(0.016, 0.013, 0.012), black).toVar();
            // MUSCLE: the baked definition (bulges up, creases down) shapes the light as well as
            // the normals do; strongest where the sun falls on it.
            const ndlRaw = dot(N, L);
            const ndl = clamp(ndlRaw.add(0.35).div(1.35), 0, 1);
            const relief = float(1).add(definition.sub(0.5).mul(mix(float(0.55), float(0.95), ndl)));
            const skyUp = max(N.y, 0);
            const meadowUp = max(N.y.negate(), 0);
            const sky = mix(haze, vec3(0.62, 0.58, 0.5), 0.45);
            const ambient = sky.mul(skyUp.mul(0.26).add(0.17))
                .add(vec3(0.2, 0.24, 0.1).mul(meadowUp.mul(0.34).add(0.06)));
            const occlusion = mix(float(0.5), float(1), seen);
            const lit = albedo.mul(sun.mul(ndl.mul(0.95)).add(ambient)).mul(occlusion).mul(relief).toVar();
            // A sheen on the coat and the hair where the low sun grazes it, a little sky on the
            // edges: the outline against the grass.
            const H = normalize(L.add(V));
            const sheen = pow(clamp(dot(N, H), 0, 1), 18).mul(mix(float(0.05), float(0.12), hair)).mul(ndl);
            const edge = float(1).sub(abs(dot(N, V)));
            const rim = haze.mul(edge.mul(edge).mul(edge).mul(0.06)).add(sun.mul(sheen));
            const air = float(1).sub(exp(length(toEye).div(-2600.0)));
            return mix(lit.add(rim), haze, air.mul(0.8));
        })();
        return material;
    }

    /** The dust's draw: soft, world-anchored puffs where the hooves struck at a run. */
    function buildDust() {
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([
            -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
        ], 3));
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        dustData = new Float32Array(DUST_MAX * 4);
        dustAttr = new THREE.InstancedBufferAttribute(dustData, 4);
        dustAttr.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('puff', dustAttr);
        dustSize = new Float32Array(DUST_MAX);
        dustSizeAttr = new THREE.InstancedBufferAttribute(dustSize, 1);
        dustSizeAttr.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('puffSize', dustSizeAttr);
        geometry.instanceCount = 0;
        geometry.name = 'OdysseyHorseDust';
        const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
        material.name = 'OdysseyHorseDust';
        material.fog = false;
        const puff = attribute('puff', 'vec4'); // x, y (the ground), z, age (s)
        const strength = attribute('puffSize', 'float'); // the puff's drawn size (u)
        const vUv = varying(vec2(0), 'odHorseDustUv');
        const vFade = varying(float(0), 'odHorseDustFade');
        material.positionNode = Fn(() => {
            const u = clamp(puff.w.div(HORSE_DUST.life), 0, 1);
            const size = strength.mul(mix(float(0.18), float(0.62), pow(u, 0.6)));
            const centre = vec3(puff.x, puff.y.add(strength.mul(0.12)).add(u.mul(strength.mul(0.22))), puff.z);
            const toEye = normalize(cameraPosition.sub(centre));
            const right = normalize(cross(vec3(0, 1, 0), toEye));
            const up = cross(toEye, right);
            const corner = positionGeometry;
            vUv.assign(corner.xy);
            vFade.assign(smoothstep(0, 0.08, u).mul(float(1).sub(u)).mul(float(1).sub(u)));
            return centre.add(right.mul(corner.x.mul(size))).add(up.mul(corner.y.mul(size.mul(0.7))));
        })();
        material.colorNode = Fn(() => {
            const d = length(vUv);
            const soft = smoothstep(1, 0.1, d);
            const toEye = cameraPosition.sub(positionWorld);
            const air = float(1).sub(exp(length(toEye).div(-2600.0)));
            const dust = mix(vec3(0.5, 0.43, 0.31).mul(sun.mul(0.6).add(0.45)), haze, air.mul(0.8));
            return vec4(dust, soft.mul(vFade).mul(0.42));
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'odyssey-horse-dust';
        mesh.frustumCulled = false;
        mesh.renderOrder = 2;
        return mesh;
    }

    /** The shadows' draw: an ellipse on the slope's plane under each horse, cast from the sun. */
    function buildShadow() {
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([
            -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1,
        ], 3));
        geometry.setIndex([0, 2, 1, 0, 3, 2]);
        geometry.instanceCount = count;
        geometry.name = 'OdysseyHorseShadows';
        const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
        material.name = 'OdysseyHorseShadows';
        material.fog = false;
        const vUv = varying(vec2(0), 'odHorseShadowUv');
        const vStrength = varying(float(0), 'odHorseShadowStrength');
        material.positionNode = Fn(() => {
            const r = int(instanceIndex);
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
        mesh.name = 'odyssey-horse-shadows';
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;
        return mesh;
    }

    /** Pose the whole band at board time `time` into the table. */
    function poseBand(time) {
        const flat = Math.hypot(sunD.x, sunD.z) || 1;
        const sx = -sunD.x / flat;
        const sz = -sunD.z / flat;
        order.forEach((horse, i) => {
            const base = i * row * 4;
            const out = poseHorse(rigs[horse.member.model], horse, time, heightAt, data, base);
            const { state } = out;
            const s = states[i];
            s.x = state.x;
            s.z = state.z;
            s.heading = state.heading;
            s.head = state.head;
            s.speed = state.speed;
            // The shadow: under the body, drawn a little from the sun (a contact shade).
            const o = base + (bones * 8);
            const tall = 1.4 * horse.k * (horse.member.model === 'foal' ? 0.75 : 1);
            const cast = tall * 0.45;
            const long = horse.member.model === 'foal' ? 0.62 : 1;
            data[o] = state.x + (sx * cast);
            data[o + 1] = out.ground;
            data[o + 2] = state.z + (sz * cast);
            data[o + 3] = 0.42;
            data[o + 4] = sx;
            data[o + 5] = sz;
            const along = Math.abs((sx * Math.sin(state.heading)) + (sz * Math.cos(state.heading)));
            data[o + 6] = cast + (0.95 * horse.k * long * (0.4 + (0.6 * along)));
            data[o + 7] = (0.36 * horse.k * long) + (0.85 * horse.k * long * (1 - along));
            data[o + 8] = out.gx;
            data[o + 9] = out.gz;
            // The gait the hair moves with.
            const shares = gaitShares(out.rhythm.speed);
            data[o + 12] = out.rhythm.phase - Math.floor(out.rhythm.phase);
            data[o + 13] = shares.trot;
            data[o + 14] = shares.canter;
            data[o + 15] = time % 1000;
        });
        table.needsUpdate = true;
        // The dust: the puffs the planned hoof landings raised, each on the ground where it struck.
        const n = bandDustAt(order, time, dustScratch, DUST_MAX);
        for (let i = 0; i < n; i += 1) {
            const o = i * 4;
            dustData[o] = dustScratch[o];
            dustData[o + 1] = heightAt(dustScratch[o], dustScratch[o + 1]);
            dustData[o + 2] = dustScratch[o + 1];
            dustData[o + 3] = dustScratch[o + 2];
            dustSize[i] = dustScratch[o + 3];
        }
        dustMesh.geometry.instanceCount = n;
        if (n) {
            dustAttr.needsUpdate = true;
            dustSizeAttr.needsUpdate = true;
        }
    }

    const api = {
        group,
        band: order,
        /** Fetch + parse + plan only (CPU arrays, no GPU work). Resolves true when the band is in the group. */
        async load() {
            if (loaded) return true;
            const gltf = await loadGltf(url);
            const models = Object.fromEntries(MODELS.map((name) => [name, parseOdysseyHorse(gltf.scene, name)]));
            MODELS.forEach((name) => { rigs[name] = createHorseRig(models[name].skeleton); });
            if (models.horse.skeleton.length !== models.foal.skeleton.length) {
                throw new Error('[Odyssey horses] the mare and the foal must share a bone count');
            }
            // Every hoof's steps through the loop, planned once on the CPU: one horse a task, so
            // planning never holds a frame.
            await order.reduce((before, horse) => before.then(() => new Promise((resolve) => {
                setTimeout(() => {
                    planFootfalls([horse], rigs);
                    resolve();
                }, 0);
            })), Promise.resolve());
            bones = models.horse.skeleton.length;
            row = (bones * 2) + EXTRA_TEXELS;
            data = new Float32Array(row * count * 4);
            table = new THREE.DataTexture(data, row, count, THREE.RGBAFormat, THREE.FloatType);
            table.minFilter = THREE.NearestFilter;
            table.magFilter = THREE.NearestFilter;
            table.generateMipmaps = false;
            table.colorSpace = THREE.NoColorSpace;
            table.name = 'OdysseyHorsePoses';
            group.add(buildShadow());
            dustMesh = buildDust();
            group.add(dustMesh);
            MODELS.forEach((name) => {
                const { geometry } = models[name];
                const rows = order.map((h, i) => [h, i]).filter(([h]) => h.member.model === name);
                geometry.instanceCount = rows.length;
                const attr = (fn) => {
                    const values = new Float32Array(rows.length * 4);
                    rows.forEach(([h, i], j) => values.set(fn(h, i), j * 4));
                    return new THREE.InstancedBufferAttribute(values, 4);
                };
                geometry.setAttribute('look', attr((h, i) => [i, h.member.tone, COAT_ORDER.indexOf(h.member.coat), 0]));
                const mesh = new THREE.Mesh(geometry, buildMaterial(name));
                mesh.name = name === 'foal' ? 'odyssey-horse-foals' : 'odyssey-horse-band';
                mesh.frustumCulled = false;
                group.add(mesh);
                triangles += models[name].triangles * rows.length;
            });
            poseBand(0);
            loaded = true;
            return true;
        },
        /** The board calls this after its live-loop compile landed; only then may it draw. */
        markReady() { ready = loaded; },
        get isLoaded() { return loaded; },
        get isReady() { return ready; },
        /** Where each horse stood at the last update (read-only; captures and probes). */
        get states() { return states; },
        /** Triangles the band draws (all instances), for the record. */
        get triangles() { return triangles; },
        /** Reveal (0 or 1) the progress window asks for at `p`. */
        revealAt(p) { return horseRevealAt(p); },
        /**
         * @param {number} time board clock (s)
         * @param {number} progress journey progress
         */
        update(time, progress) {
            const show = ready && horseRevealAt(progress) > 0;
            group.visible = show;
            if (!show) return;
            poseBand(time);
        },
        dispose() {
            group.traverse((o) => {
                if (!o.isMesh) return;
                o.material?.dispose?.();
                o.geometry?.dispose?.();
            });
            table?.dispose();
            group.removeFromParent();
        },
        /** The lifecycle's own flags (driveOdysseyHorses). */
        life: {
            loading: false, compiling: false, failed: false, loadedAt: null,
        },
    };
    return api;
}

/**
 * The band, one step per frame, on the deer's lifecycle (OdysseyBoardController._tickDeer): fetch
 * and plan as the window approaches (no GPU), compile through the board's live-loop path only
 * while the board is idle (with the same 4 s starvation escape), then draw. Any failure leaves
 * them hidden for the session.
 * @param {object} board the OdysseyBoardController
 * @param {ReturnType<typeof createOdysseyHorses>} horses
 * @param {number} cameraProgress
 */
export function driveOdysseyHorses(board, horses, cameraProgress) {
    const { life } = horses;
    if (life.failed) return;
    const near = horses.revealAt(cameraProgress + 0.03) > 0 || horses.revealAt(cameraProgress) > 0;
    if (!horses.isLoaded && !life.loading && board.isActive && near) {
        life.loading = true;
        horses.load()
            .then((ok) => {
                if (!ok) return;
                life.loadedAt = performance.now();
                console.log('[OdysseyBoard] wild horses loaded');
            })
            .catch((error) => {
                life.failed = true;
                console.warn('[OdysseyBoard] wild horses load failed (non-fatal):', error);
            })
            .finally(() => { life.loading = false; });
    }
    const waitedMs = performance.now() - (life.loadedAt ?? performance.now());
    if (horses.isLoaded && !horses.isReady && !life.compiling && board.liveCompileEnabled
        && board._renderLoopActive() && (board._canRunBackgroundTask() || waitedMs > 4000)) {
        life.compiling = true;
        board._compileGroupThroughPost(horses.group, { live: true })
            .then((compiled) => {
                if (compiled) {
                    horses.markReady();
                    console.log('[OdysseyBoard] wild horses ready (live-loop compiled)');
                } else life.failed = true;
            })
            .catch((error) => {
                life.failed = true;
                console.warn('[OdysseyBoard] wild horses compile failed (non-fatal):', error);
            })
            .finally(() => { life.compiling = false; });
    }
    horses.update(board.time, cameraProgress);
}
