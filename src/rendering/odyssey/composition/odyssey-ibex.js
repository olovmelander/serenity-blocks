/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE MASSIF'S IBEX — a buck, two nannies and a kid on the grey rock band at the massif's foot
 * (chapter 4, 2026-11-02). Their life is odyssey-ibex-herd.js (the red deer's herd code with a leap
 * added); this draws them, the deer's way (odyssey-deer.js):
 *
 * - The model is a Blender-built Alpine ibex (`assets/chapter-04/ibex/alpine-ibex.glb`, built by
 *   scripts/blender/odyssey/alpine_ibex.py: one mesh, ~2,200 triangles, skinned to the deer's 27
 *   bones through `_bones`/`_weights`, its coat in its vertex colours). Every horn vertex carries
 *   `_horn` (its root, 1): each animal's horns are scaled about their roots here (the buck's great
 *   sweep, a nanny's short horns, the kid's buds), so one model and ONE draw serve them all.
 * - The group poses each animal on the CPU into a float table, the vertex stage skins each instance
 *   from its row, and a second draw lays a soft contact shadow under each on the slope's plane.
 *
 * ZERO-HITCH (ADR-0020), the eagle's and the deer's lifecycle: `load()` only fetches + parses (CPU);
 * `tick(board, progress)` live-compiles the group through the board's own path while it is idle and
 * only then lets it draw. A load or compile failure leaves the act exactly as it was.
 * BISECT LEVER (board): `?odysseyNoIbex=1`.
 *
 * Their light is the act's: the low sun, the sky from above, the warm ground bounced up under them,
 * a little sky on the outline, and the air between them and the eye.
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
import { createDeerRig, planFootfalls, poseDeer } from './odyssey-deer-herd.js';
import { ODYSSEY_IBEX, buildIbexHerd, ibexRevealAt } from './odyssey-ibex-herd.js';

export const ODYSSEY_IBEX_URL = new URL('../assets/chapter-04/ibex/alpine-ibex.glb', import.meta.url).href;

const IBEX_ATTRIBUTES = Object.freeze(['position', 'normal', 'color', '_bones', '_weights', '_horn']);
/** Texels a row of the table holds after the bones: the shadow (centre, cast, plane). */
const SHADOW_TEXELS = 3;
/** How far a shadow is drawn toward the eye along its line of sight, as a share of the distance. */
const SHADOW_PULL = 0.002;
/** Board seconds to wait for an idle moment before compiling anyway (the deer's starvation escape). */
const COMPILE_PATIENCE_MS = 4000;

/** Turn a vector by a unit quaternion (TSL). */
const turn = (q, v) => {
    const t = cross(q.xyz, v).mul(2);
    return v.add(t.mul(q.w)).add(cross(q.xyz, t));
};

/**
 * The model from the parsed GLB: a geometry in metres (positions decoded through the node's scale and
 * translation) and its skeleton. Throws when it is not what the group needs.
 * @param {THREE.Object3D} root gltf.scene
 */
export function parseOdysseyIbex(root) {
    const mesh = root.children.find((c) => c.name === 'ibex' && c.geometry) ?? null;
    if (!mesh) throw new Error('[Odyssey ibex] the model has no "ibex" mesh');
    const source = mesh.geometry;
    IBEX_ATTRIBUTES.forEach((name) => {
        if (!source.attributes[name]) throw new Error(`[Odyssey ibex] the model lacks its "${name}" attribute`);
    });
    const skeleton = root.userData?.skeleton;
    if (!Array.isArray(skeleton) || !skeleton.length) throw new Error('[Odyssey ibex] the model lacks its skeleton');
    const src = source.attributes.position;
    const { count } = src;
    const { position: t, scale: s } = mesh;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const horns = new Float32Array(count * 4);
    const nrm = source.attributes.normal;
    const horn = source.attributes._horn;
    for (let i = 0; i < count; i += 1) {
        positions[i * 3] = (src.getX(i) * s.x) + t.x;
        positions[(i * 3) + 1] = (src.getY(i) * s.y) + t.y;
        positions[(i * 3) + 2] = (src.getZ(i) * s.z) + t.z;
        normals[i * 3] = nrm.getX(i);
        normals[(i * 3) + 1] = nrm.getY(i);
        normals[(i * 3) + 2] = nrm.getZ(i);
        horns[i * 4] = horn.getX(i);
        horns[(i * 4) + 1] = horn.getY(i);
        horns[(i * 4) + 2] = horn.getZ(i);
        horns[(i * 4) + 3] = horn.getW(i);
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
    geometry.setAttribute('_horn', new THREE.BufferAttribute(horns, 4));
    ['color', '_bones', '_weights'].forEach((name) => geometry.setAttribute(name, bytes(source.attributes[name])));
    geometry.setIndex(new THREE.BufferAttribute(Uint16Array.from(source.index.array), 1));
    geometry.name = 'OdysseyIbex';
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
export function createOdysseyIbex({
    hazeColour = null, sunColour = null, heightAt = odysseyWorldHeight, url = ODYSSEY_IBEX_URL,
    loadGltf = loadOdysseyGltfCached,
} = {}) {
    const group = new THREE.Group();
    group.name = 'odyssey-ibex';
    group.visible = false;
    const cfg = ODYSSEY_IBEX;
    const herd = buildIbexHerd(cfg);
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
    let failed = false;
    let loading = false;
    let compiling = false;
    let loadedAt = 0;
    const states = herd.map(() => ({}));
    let triangles = 0;

    function buildMaterial() {
        const material = new THREE.MeshBasicNodeMaterial();
        material.name = 'OdysseyIbex';
        material.fog = false;
        const look = attribute('look', 'vec4'); // row, tone, size, horn scale
        const paint = attribute('color', 'vec4'); // pale, dark, brown, sky seen
        const horn = attribute('_horn', 'vec4'); // the horn's root, 1 on a horn
        const vNormal = varying(vec3(0, 1, 0), 'odIbexNormal');
        const vPaint = varying(vec4(0), 'odIbexPaint');
        const vLook = varying(vec4(0), 'odIbexLook');
        const vHorn = varying(float(0), 'odIbexHorn');
        material.positionNode = Fn(() => {
            const r = int(floor(look.x.add(0.5)));
            const ids = attribute('_bones', 'vec4');
            const ws = attribute('_weights', 'vec4');
            // Each animal's horns, scaled about their roots (the buck's full sweep, the kid's buds).
            const p = mix(positionGeometry, horn.xyz.add(positionGeometry.sub(horn.xyz).mul(look.w)), horn.w);
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
            vHorn.assign(horn.w);
            return pos;
        })();
        material.colorNode = Fn(() => {
            const N = normalize(vNormal).toVar();
            const toEye = cameraPosition.sub(positionWorld);
            const V = normalize(toEye).toVar();
            const pale = clamp(vPaint.x, 0, 1);
            const dark = clamp(vPaint.y, 0, 1);
            const brown = clamp(vPaint.z, 0, 1);
            const seen = clamp(vPaint.w, 0, 1);
            const tone = vLook.y;
            // The summer coat: a warm grey-brown (the buck a little darker), darker brown down the
            // fronts of the legs, along the back and on the chest; the belly and the insides pale; the
            // hooves, nose and eyes near black; the horns a dark grey-brown.
            const coat = mix(vec3(0.115, 0.095, 0.07), vec3(0.17, 0.145, 0.108), tone);
            const darker = mix(coat, vec3(0.065, 0.045, 0.03), brown.mul(0.85));
            const belly = mix(darker, vec3(0.6, 0.55, 0.45), pale);
            const albedo = mix(mix(belly, vec3(0.018, 0.014, 0.012), dark), vec3(0.085, 0.075, 0.06), vHorn).toVar();
            const ndl = clamp(dot(N, L).add(0.35).div(1.35), 0, 1);
            const skyUp = max(N.y, 0);
            const groundUp = max(N.y.negate(), 0);
            // The sky from above (softened toward the act's warm air) and the warm rock and grass
            // bounced up from below.
            const sky = mix(haze, vec3(0.62, 0.58, 0.5), 0.45);
            const ambient = sky.mul(skyUp.mul(0.26).add(0.17))
                .add(vec3(0.2, 0.19, 0.13).mul(groundUp.mul(0.34).add(0.06)));
            const occlusion = mix(float(0.5), float(1), seen);
            const lit = albedo.mul(sun.mul(ndl.mul(0.95)).add(ambient)).mul(occlusion).toVar();
            const edge = float(1).sub(abs(dot(N, V)));
            const rim = haze.mul(edge.mul(edge).mul(edge).mul(0.05));
            const air = float(1).sub(exp(length(toEye).div(-2600.0)));
            return mix(lit.add(rim), haze, air.mul(0.8));
        })();
        return material;
    }

    function buildShadow() {
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([
            -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1,
        ], 3));
        geometry.setIndex([0, 2, 1, 0, 3, 2]);
        geometry.instanceCount = count;
        geometry.name = 'OdysseyIbexShadows';
        const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
        material.name = 'OdysseyIbexShadows';
        material.fog = false;
        const vUv = varying(vec2(0), 'odIbexShadowUv');
        const vStrength = varying(float(0), 'odIbexShadowStrength');
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
            return vec4(vec3(0.035, 0.035, 0.03), soft.mul(vStrength).mul(float(1).sub(air)));
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'odyssey-ibex-shadows';
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;
        return mesh;
    }

    /** Pose the whole group at board time `time` into the table. */
    function poseGroup(time) {
        const flat = Math.hypot(sunD.x, sunD.z) || 1;
        const sx = -sunD.x / flat;
        const sz = -sunD.z / flat;
        herd.forEach((animal, i) => {
            const base = i * row * 4;
            const out = poseDeer(rig, animal, time, heightAt, data, base, /** @type {any} */ (cfg));
            const { state } = out;
            Object.assign(states[i], {
                x: state.x, z: state.z, heading: state.heading, head: state.head,
            });
            // The contact shadow: under the body, a little from the sun; fainter while it is in the air.
            const o = base + (bones * 8);
            const air = Math.max(0, rig.J[rig.index.root][1] - out.ground - (0.75 * animal.k));
            const cast = animal.k * 0.4;
            data[o] = state.x + (sx * cast);
            data[o + 1] = out.ground;
            data[o + 2] = state.z + (sz * cast);
            data[o + 3] = 0.42 / (1 + (air / animal.k));
            data[o + 4] = sx;
            data[o + 5] = sz;
            const along = Math.abs((sx * Math.sin(state.heading)) + (sz * Math.cos(state.heading)));
            data[o + 6] = cast + (0.6 * animal.k * (0.4 + (0.6 * along)));
            data[o + 7] = (0.3 * animal.k) + (0.5 * animal.k * (1 - along));
            data[o + 8] = out.gx;
            data[o + 9] = out.gz;
        });
        table.needsUpdate = true;
    }

    const api = {
        group,
        herd,
        async load() {
            if (loaded) return true;
            const gltf = await loadGltf(url);
            model = parseOdysseyIbex(gltf.scene);
            rig = createDeerRig(model.skeleton);
            // Every hoof's steps through the loop, planned once, one animal a task.
            await herd.reduce((before, animal) => before.then(() => new Promise((resolve) => {
                setTimeout(() => {
                    planFootfalls([animal], rig, /** @type {any} */ (cfg));
                    resolve();
                }, 0);
            })), Promise.resolve());
            bones = model.skeleton.length;
            row = (bones * 2) + SHADOW_TEXELS;
            data = new Float32Array(row * count * 4);
            table = new THREE.DataTexture(data, row, count, THREE.RGBAFormat, THREE.FloatType);
            table.minFilter = THREE.NearestFilter;
            table.magFilter = THREE.NearestFilter;
            table.generateMipmaps = false;
            table.colorSpace = THREE.NoColorSpace;
            table.name = 'OdysseyIbexPoses';
            const { geometry } = model;
            geometry.instanceCount = count;
            const looks = new Float32Array(count * 4);
            herd.forEach((animal, i) => {
                const { tone, size, horn } = animal.member;
                looks.set([i, tone, size, horn], i * 4);
            });
            geometry.setAttribute('look', new THREE.InstancedBufferAttribute(looks, 4));
            const mesh = new THREE.Mesh(geometry, buildMaterial());
            mesh.name = 'odyssey-ibex-group';
            mesh.frustumCulled = false;
            group.add(buildShadow(), mesh);
            triangles = model.triangles * count;
            poseGroup(0);
            loaded = true;
            return true;
        },
        markReady() { ready = loaded; },
        get isLoaded() { return loaded; },
        get isReady() { return ready; },
        get states() { return states; },
        get triangles() { return triangles; },
        revealAt(p) { return ibexRevealAt(p, cfg); },
        /**
         * @param {number} time board clock (s)
         * @param {number} progress journey progress
         */
        update(time, progress) {
            const show = ready && ibexRevealAt(progress, cfg) > 0;
            group.visible = show;
            if (!show) return;
            poseGroup(time);
        },
        /**
         * One step of the lifecycle per frame (the deer's, on the board's own paths): fetch as the
         * window comes near (no GPU), compile through the live loop while the board is idle (with
         * the 4 s starvation escape), then draw. Any failure hides them for the session.
         * @param {object} board OdysseyBoardController
         * @param {number} progress journey progress
         */
        tick(board, progress) {
            if (failed) return;
            const near = ibexRevealAt(progress + 0.03, cfg) > 0 || ibexRevealAt(progress, cfg) > 0;
            if (!loaded && !loading && board.isActive && near) {
                loading = true;
                api.load()
                    .then((ok) => { if (ok) loadedAt = performance.now(); })
                    .catch((error) => {
                        failed = true;
                        console.warn('[OdysseyBoard] ibex load failed (non-fatal):', error);
                    })
                    .finally(() => { loading = false; });
            }
            if (loaded && !ready && !compiling && board.liveCompileEnabled && board._renderLoopActive()
                && (board._canRunBackgroundTask() || performance.now() - loadedAt > COMPILE_PATIENCE_MS)) {
                compiling = true;
                board._compileGroupThroughPost(group, { live: true })
                    .then((compiled) => {
                        if (compiled) api.markReady();
                        else failed = true;
                    })
                    .catch((error) => {
                        failed = true;
                        console.warn('[OdysseyBoard] ibex compile failed (non-fatal):', error);
                    })
                    .finally(() => { compiling = false; });
            }
            api.update(board.time, progress);
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
    };
    return api;
}
