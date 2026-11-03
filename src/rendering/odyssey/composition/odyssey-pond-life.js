/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * LIFE AT THE POND — a pair of mute swans gliding on the tarn, a grey heron in its shallows, and a
 * hind and her calf that come down to drink at its bank (chapter 3, 2026-11-02). Their lives are
 * odyssey-pond-life-motion.js (three-free); this draws them.
 *
 * The birds are Blender-built (scripts/blender/odyssey/pond_birds.py: `swan.glb`, 1,598 triangles,
 * 9 bones; `heron.glb`, 1,656 triangles, 17 bones, its open wings drawn only in flight), skinned in
 * the vertex stage from a float table
 * of bone poses as the deer are: a row an animal, two texels a bone (its rotation in the world, and
 * where its rest frame lands with its size). One draw per species. The drinkers are the glade's
 * deer model and life (createOdysseyDeer with ODYSSEY_TARN_DEER), so they cost no new pipeline.
 *
 * THE WAKES are the tarn's: each frame the swans' places and velocities go to the world
 * (`setTarnSwans`), whose water draws a soft V behind each and a pale reflection under it.
 *
 * ZERO-HITCH (ADR-0020), the deer's lifecycle: nothing touches the GPU until the board says so.
 * `load()` only fetches + parses; the board compiles the group through its live-loop path while
 * idle and only then calls `markReady()`. Until ready the group stays hidden; a load or compile
 * failure leaves the act exactly as it was. BISECT LEVER (board): `?odysseyNoPondLife=1`.
 *
 * Their light is the act's: the world's low sun, the sky from above, the water's turquoise (the
 * swans) or the meadow's green (the heron) bounced up from below, and the air between them and the
 * eye. White plumage scatters light round itself (wrapped), so a swan's shade side stays a soft
 * white, never grey. Against the low sun the edges of the feathers light up (`sunRim`), most on
 * white: that, a darker slate back and a whiter face part the heron from its bank (VISIBILITY,
 * 2026-11-03).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, cross, dot, exp, float, floor, int, ivec2,
    length, max, mix, normalize, positionGeometry, positionWorld, smoothstep, textureLoad, varying, vec3, vec4,
} from 'three/tsl';
import { loadOdysseyGltfCached } from '../chapter-environments/shared/odyssey-gltf-loader.js';
import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';
import { ODYSSEY_TARN, odysseyWorldHeight } from '../world/odyssey-world-height.js';
import { createOdysseyDeer } from './odyssey-deer.js';
import {
    ODYSSEY_POND, ODYSSEY_TARN_DEER, createBirdRig, poseHeron, poseSwan,
} from './odyssey-pond-life-motion.js';

export const ODYSSEY_SWAN_URL = new URL('../assets/chapter-03/pond/swan.glb', import.meta.url).href;
export const ODYSSEY_HERON_URL = new URL('../assets/chapter-03/pond/heron.glb', import.meta.url).href;

const BIRD_ATTRIBUTES = Object.freeze(['position', 'normal', 'color', '_bones', '_weights']);

/** Each species' paint: the base, the white, the bill (and the heron's legs), the dark. */
const PAINT = Object.freeze({
    swan: Object.freeze({
        // A mute swan's white is a little warm (cream), which parts it from the turquoise water;
        // the water's teal bounced up into its underside is kept low, so its shade stays white.
        base: [0.84, 0.82, 0.76],
        white: [0.84, 0.82, 0.76],
        bill: [0.78, 0.30, 0.05],
        dark: [0.02, 0.02, 0.02],
        wrap: 0.6,
        below: [0.08, 0.2, 0.2],
        sunRim: 0.45,
    }),
    heron: Object.freeze({
        base: [0.16, 0.18, 0.22],
        white: [0.94, 0.94, 0.92],
        bill: [0.86, 0.68, 0.16],
        dark: [0.012, 0.012, 0.016],
        wrap: 0.45,
        below: [0.14, 0.2, 0.1],
        // The low sun behind it lights the edges of its plumage (white most).
        sunRim: 0.7,
    }),
});

/** Turn a vector by a unit quaternion (TSL). */
const turn = (q, v) => {
    const t = cross(q.xyz, v).mul(2);
    return v.add(t.mul(q.w)).add(cross(q.xyz, t));
};

/**
 * A bird from its parsed GLB: a geometry in metres and its skeleton. Throws when it is not what the
 * pond needs.
 * @param {THREE.Object3D} root gltf.scene
 * @param {string} name the mesh's name
 */
export function parseOdysseyPondBird(root, name) {
    const mesh = root.children.find((c) => c.name === name && c.geometry) ?? null;
    if (!mesh) throw new Error(`[Odyssey pond] the model has no "${name}" mesh`);
    const source = mesh.geometry;
    BIRD_ATTRIBUTES.forEach((a) => {
        if (!source.attributes[a]) throw new Error(`[Odyssey pond] the ${name} lacks its "${a}" attribute`);
    });
    const skeleton = root.userData?.skeleton;
    if (!Array.isArray(skeleton) || !skeleton.length) throw new Error(`[Odyssey pond] the ${name} lacks its skeleton`);
    const src = source.attributes.position;
    const positions = new Float32Array(src.count * 3);
    const normals = new Float32Array(src.count * 3);
    const { position: t, scale: s } = mesh;
    const nrm = source.attributes.normal;
    for (let i = 0; i < src.count; i += 1) {
        positions[i * 3] = (src.getX(i) * s.x) + t.x;
        positions[(i * 3) + 1] = (src.getY(i) * s.y) + t.y;
        positions[(i * 3) + 2] = (src.getZ(i) * s.z) + t.z;
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
    ['color', '_bones', '_weights'].forEach((a) => geometry.setAttribute(a, bytes(source.attributes[a])));
    geometry.setIndex(new THREE.BufferAttribute(Uint16Array.from(source.index.array), 1));
    geometry.name = `OdysseyPond-${name}`;
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
 * @param {{ setTarnSwans?: (rows: number[]) => void }} [opts.world] the world (the tarn's wakes)
 * @param {(url: string) => Promise<{scene: THREE.Object3D}>} [opts.loadGltf] the fetch + parse (tests)
 * @param {boolean} [opts.drinkers] the hind and calf at the bank (default on)
 */
export function createOdysseyPondLife({
    hazeColour = null, sunColour = null, heightAt = odysseyWorldHeight, world = null,
    loadGltf = loadOdysseyGltfCached, swanUrl = ODYSSEY_SWAN_URL, heronUrl = ODYSSEY_HERON_URL,
    drinkers = true,
} = {}) {
    const group = new THREE.Group();
    group.name = 'odyssey-pond-life';
    group.visible = false;
    const sun = sunColour ?? vec3(1.0, 0.95, 0.86);
    const haze = hazeColour ?? vec3(0.72, 0.82, 0.93);
    const sunD = new THREE.Vector3(...ODYSSEY_WORLD_SUN).normalize();
    const L = vec3(sunD.x, sunD.y, sunD.z);
    const deer = drinkers ? createOdysseyDeer({
        hazeColour, sunColour, heightAt, loadGltf, herd: ODYSSEY_TARN_DEER, name: 'odyssey-tarn-deer',
    }) : null;
    if (deer) group.add(deer.group);

    const species = [];
    let loaded = false;
    let ready = false;
    let triangles = 0;
    // The world's swan rows: (x, z, vx, vz) a swan; far away while hidden.
    const swanRows = new Float32Array(8);
    const swanStates = [{}, {}];
    let heronState = { feet: [{}, {}] };

    /** One species' draw: every animal an instance, skinned from its row of the table. */
    function buildMaterial(paint, table) {
        const material = new THREE.MeshBasicNodeMaterial();
        material.name = 'OdysseyPondBird';
        material.fog = false;
        const look = attribute('look', 'vec4'); // row, -, -, -
        const colour = attribute('color', 'vec4'); // bill, dark, white, sky seen
        const vNormal = varying(vec3(0, 1, 0), 'odPondNormal');
        const vPaint = varying(vec4(0), 'odPondPaint');
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
            vPaint.assign(colour);
            return pos;
        })();
        material.colorNode = Fn(() => {
            const N = normalize(vNormal).toVar();
            const toEye = cameraPosition.sub(positionWorld);
            const V = normalize(toEye).toVar();
            const bill = clamp(vPaint.x, 0, 1);
            const dark = clamp(vPaint.y, 0, 1);
            const white = clamp(vPaint.z, 0, 1);
            const seen = clamp(vPaint.w, 0, 1);
            const albedo = mix(
                mix(mix(vec3(...paint.base), vec3(...paint.white), white), vec3(...paint.bill), bill),
                vec3(...paint.dark),
                dark,
            ).toVar();
            // Feathers wrap the light round themselves; the bake's occlusion darkens the folds.
            const ndl = clamp(dot(N, L).add(paint.wrap).div(1 + paint.wrap), 0, 1);
            const skyUp = max(N.y, 0);
            const fromBelow = max(N.y.negate(), 0);
            const sky = mix(haze, vec3(0.62, 0.66, 0.72), 0.35);
            const ambient = sky.mul(skyUp.mul(0.3).add(0.2))
                .add(vec3(...paint.below).mul(fromBelow.mul(0.45).add(0.05)));
            const occlusion = mix(float(0.55), float(1), seen);
            const lit = albedo.mul(sun.mul(ndl.mul(0.92)).add(ambient)).mul(occlusion).toVar();
            const edge = float(1).sub(abs(dot(N, V)));
            let rim = haze.mul(edge.mul(edge).mul(edge).mul(0.06));
            if (paint.sunRim > 0) {
                // Against the light, the sun shines through the edges of the feathers: on the
                // sun's side of the outline, as strong as the sun is behind the bird.
                const behind = smoothstep(0.0, 0.7, dot(V, L).negate());
                const sunSide = clamp(dot(N, L).add(0.4).div(1.4), 0, 1);
                rim = rim.add(sun.mul(edge.mul(edge).mul(behind).mul(sunSide)
                    .mul(mix(float(0.35), float(1), white))
                    .mul(paint.sunRim)));
            }
            const air = float(1).sub(exp(length(toEye).div(-2600.0)));
            return mix(lit.add(rim), haze, air.mul(0.8));
        })();
        return material;
    }

    /** One species: its geometry with a row an instance, its table, its draw. */
    function buildSpecies(model, count, paint, name) {
        const bones = model.skeleton.length;
        const data = new Float32Array(bones * 2 * count * 4);
        const table = new THREE.DataTexture(data, bones * 2, count, THREE.RGBAFormat, THREE.FloatType);
        table.minFilter = THREE.NearestFilter;
        table.magFilter = THREE.NearestFilter;
        table.generateMipmaps = false;
        table.colorSpace = THREE.NoColorSpace;
        table.name = `OdysseyPond-${name}-poses`;
        const { geometry } = model;
        geometry.instanceCount = count;
        const looks = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) looks[i * 4] = i;
        geometry.setAttribute('look', new THREE.InstancedBufferAttribute(looks, 4));
        const mesh = new THREE.Mesh(geometry, buildMaterial(paint, table));
        mesh.name = `odyssey-pond-${name}`;
        mesh.frustumCulled = false;
        group.add(mesh);
        triangles += model.triangles * count;
        return {
            name, mesh, table, data, rig: createBirdRig(model.skeleton), row: bones * 8, count,
        };
    }

    function pose(time) {
        const [swans, heron] = species;
        for (let i = 0; i < swans.count; i += 1) {
            const s = poseSwan(swans.rig, i, time, ODYSSEY_TARN.waterY, swans.data, i * swans.row, swanStates[i]);
            swanRows.set([s.x, s.z, s.vx, s.vz], i * 4);
        }
        swans.table.needsUpdate = true;
        heronState = poseHeron(heron.rig, time, heightAt, heron.data, 0, heronState);
        heron.table.needsUpdate = true;
    }

    const hideWakes = () => {
        swanRows.fill(0);
        swanRows[0] = 1e5;
        swanRows[4] = 1e5;
        world?.setTarnSwans?.(swanRows);
    };

    return {
        group,
        /** Fetch + parse only (CPU arrays, no GPU work). Resolves true when the pond's life is in the group. */
        async load() {
            if (loaded) return true;
            const [swanGltf, heronGltf] = await Promise.all([loadGltf(swanUrl), loadGltf(heronUrl)]);
            const swan = parseOdysseyPondBird(swanGltf.scene, 'swan');
            const heron = parseOdysseyPondBird(heronGltf.scene, 'heron');
            species.push(buildSpecies(swan, 2, PAINT.swan, 'swans'), buildSpecies(heron, 1, PAINT.heron, 'heron'));
            if (deer) await deer.load();
            pose(0);
            loaded = true;
            return true;
        },
        /** The board calls this after its live-loop compile landed; only then may it draw. */
        markReady() {
            ready = loaded;
            deer?.markReady();
        },
        get isLoaded() { return loaded; },
        get isReady() { return ready; },
        /** Triangles the birds draw (the drinkers are the deer's), for the record. */
        get triangles() { return triangles; },
        /** The last posed states (read-only; captures and probes). */
        get swans() { return swanStates; },
        get heron() { return heronState; },
        get drinkers() { return deer; },
        /** Reveal (0 or 1) the progress window asks for at `p`. */
        revealAt(p) { return p >= ODYSSEY_POND.window[0] && p <= ODYSSEY_POND.window[1] ? 1 : 0; },
        /**
         * @param {number} time board clock (s)
         * @param {number} progress journey progress
         */
        update(time, progress) {
            const show = ready && this.revealAt(progress) > 0;
            group.visible = show;
            if (!show) {
                hideWakes();
                return;
            }
            pose(time);
            world?.setTarnSwans?.(swanRows);
            deer?.update(time, progress);
        },
        dispose() {
            hideWakes();
            deer?.dispose();
            species.forEach((s) => {
                s.mesh.material.dispose();
                s.mesh.geometry.dispose();
                s.table.dispose();
            });
            group.removeFromParent();
        },
    };
}
