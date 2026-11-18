/**
 * Shifting Sands — the formations: one merged mesh, one material, one draw.
 *
 *  - The Sentinel: a monumental sandstone butte in the right zone — a talus apron strewn with
 *    fallen blocks, a sheer cliff cut by joints into buttresses and alcoves, a caprock, and a
 *    finger of rock standing off one end. The low sun rakes its left flank; its front face sits
 *    in violet shade, and by night it is a black mass under the moons.
 *  - A totem spire and a mitten beside it; a natural arch far out on the suns' side of the erg,
 *    its window open to the afterglow; a cluster of hoodoo knobs, a hogback fin and a tilted slab
 *    at the edges of the wide view.
 *  - The Rampart: a long crenellated escarpment on the far horizon that the suns set toward,
 *    almost dissolved in haze — the last depth layer before the sky.
 *
 * The landforms were sculpted by script in Blender (scripts/blender/shifting_sands_rocks.py →
 * shifting-sands-rock-models.js: base64 typed arrays, no loader and no asset file): each a signed
 * distance field of jointed, bedded rock on a talus apron, at two levels of the same solid, every
 * vertex carrying the fine surface's normal, its ambient occlusion and how exposed it is. Here
 * they are decoded, stood on the sand and merged; the shadow march reads each as a stack of
 * flat-topped cylinders measured from its own mesh (`heightAt`). The Rampart is still a ribbon
 * built here. Shading: strata bands by world height, desert-varnish streaks down the cliffs, sand
 * caught on ledges and the apron, the baked occlusion in every joint, the twin-sun light, violet
 * sky fill, the moons' silver, a backlit rim and the shared aerial perspective.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    clamp,
    dot,
    float,
    fract,
    max,
    mix,
    normalize,
    positionWorld,
    pow,
    smoothstep,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { groundPointAt, SENTINEL } from './shifting-sands-composition.js';
import { mulberry32, ssTexNoise } from './shifting-sands-tsl.js';
import { SHIFTING_SANDS_ROCK_MODELS } from './shifting-sands-rock-models.js';
import { drainSteps, stepClock } from '../shared/build-steps.js';

const DEG = Math.PI / 180;

/**
 * How long a slice of standing the formations runs before it yields to the page (ms): decoding
 * and placing the Sentinel's forty thousand triangles is the long one.
 */
const FORMATION_SLICE_MS = 8;

/**
 * Where each formation stands: azimuth from the rest camera (degrees, + right of forward),
 * distance, its height in world units and the turn it is given about the vertical (degrees).
 * The right-zone rocks stand as their models were judged (yaw 0 is the eye's own view of them);
 * the arch and the fin are turned broadside to the eye, so the window and the crest read whole.
 * kind: 0 the butte, 1 everything else that stands (the Rampart is 2).
 */
export const FORMATIONS = Object.freeze([
    Object.freeze({
        model: 'sentinel', kind: 0, az: SENTINEL.az, dist: SENTINEL.dist, height: SENTINEL.height, yaw: 0,
    }),
    Object.freeze({
        model: 'spireA', kind: 1, az: 38.5, dist: 1880, height: 220, yaw: 0,
    }),
    Object.freeze({
        model: 'spireB', kind: 1, az: 23.5, dist: 3050, height: 290, yaw: 0,
    }),
    // Far out, right of the white sun's bearing and well under it: its window holds the afterglow.
    Object.freeze({
        model: 'arch', kind: 1, az: -16.5, dist: 2700, height: 235, yaw: 25,
    }),
    Object.freeze({
        model: 'knobs', kind: 1, az: -37.5, dist: 2500, height: 150, yaw: 0,
    }),
    Object.freeze({
        model: 'finA', kind: 1, az: -41.5, dist: 1500, height: 74, yaw: 41.5,
    }),
    Object.freeze({
        model: 'cuesta', kind: 1, az: -48, dist: 2300, height: 96, yaw: 0,
    }),
]);

function decode(text, Type) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer);
}

/**
 * A model at a level, decoded: `position` (Int16 in units of the module's `quant`, unit height),
 * `normal` (Int8), `shade` (Uint8 pairs: ambient occlusion, crest) and `index` (Uint16).
 * @param {string} name
 * @param {'hi'|'lo'} level
 */
export function rockModel(name, level) {
    const model = SHIFTING_SANDS_ROCK_MODELS.models[name];
    if (!model) throw new Error(`Shifting Sands has no rock model "${name}".`);
    const data = model[level] || model.hi;
    return {
        kind: model.kind,
        footprint: model.footprint,
        proxies: model.proxies,
        vertexCount: data.vertexCount,
        triangleCount: data.triangleCount,
        position: decode(data.positions, Int16Array),
        normal: decode(data.normals, Int8Array),
        shade: decode(data.shade, Uint8Array),
        index: decode(data.index, Uint16Array),
    };
}

/**
 * The far escarpment: a ribbon along an arc around the camera, crenellated into mesas.
 */
function buildEscarpment(rand, out, vertexOffset, { dist = 8200, base = -40, segs = 360 } = {}) {
    const az0 = (-72 * Math.PI) / 180;
    const az1 = (72 * Math.PI) / 180;
    const rows = 5;
    const ph = [rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2];
    const heightAt = (t) => {
        // Mesa blocks: a quantised low-frequency signal with eroded steps.
        const n = Math.sin(t * 7.1 + ph[0]) * 0.5 + Math.sin(t * 17.3 + ph[1]) * 0.3 + Math.sin(t * 41 + ph[2]) * 0.12;
        const block = Math.round(n * 3) / 3;
        const mixT = 0.7;
        const v = block * mixT + n * (1 - mixT);
        return 300 + v * 190 + Math.sin(t * 97 + ph[3]) * 12;
    };
    for (let j = 0; j <= segs; j++) {
        const t = j / segs;
        const az = az0 + (az1 - az0) * t;
        const h = Math.max(120, heightAt(t));
        const d0 = dist + Math.sin(t * 13 + ph[1]) * 600;
        for (let r = 0; r < rows; r++) {
            const s = r / (rows - 1);
            // Talus at the foot, cliff above, slightly set back toward the crown.
            const back = s < 0.3 ? (0.3 - s) * -900 : (s - 0.3) * 160;
            const dd = d0 + back;
            const x = Math.sin(az) * dd;
            const z = -Math.cos(az) * dd;
            const y = base + (s < 0.3 ? (s / 0.3) * 0.25 : 0.25 + ((s - 0.3) / 0.7) * 0.75) * (h - base);
            out.positions.push(x, y, z);
            // Facing the camera, tilted up on the talus.
            const nx = -Math.sin(az);
            const nz = Math.cos(az);
            const tilt = s < 0.3 ? 0.55 : 0.12;
            const nl = Math.hypot(nx, tilt, nz);
            out.normals.push(nx / nl, tilt / nl, nz / nl);
            out.params.push(s, h - base, 2, 41);
            out.bake.push(1, 0.5);
        }
    }
    for (let j = 0; j < segs; j++) {
        for (let r = 0; r < rows - 1; r++) {
            const a = vertexOffset + j * rows + r;
            const b = vertexOffset + (j + 1) * rows + r;
            out.indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
    return (segs + 1) * rows;
}

/**
 * Build every formation.
 * @param {import('./shifting-sands-terrain.js').DuneField} field  (for base heights)
 * @param {object} [opts] { detail }: under 1 the models' lighter level is stood (the same solids)
 */
export function buildFormations(field, options = {}) {
    return drainSteps(buildFormationsSteps(field, options));
}

/**
 * `buildFormations` as steps (the world's build breathes between them): the same formations in
 * the same order, yielding every FORMATION_SLICE_MS.
 */
export function* buildFormationsSteps(field, { detail = 1 } = {}) {
    const clock = stepClock(FORMATION_SLICE_MS);
    const rand = mulberry32(777);
    const level = detail >= 1 ? 'hi' : 'lo';
    const { quant } = SHIFTING_SANDS_ROCK_MODELS;
    const groundAt = (x, z) => field.sample(x, z, field.scratch).h;
    const out = {
        positions: [], normals: [], params: [], bake: [], indices: [],
    };
    const list = [];
    const solids = [];
    let offset = 0;
    for (let f = 0; f < FORMATIONS.length; f++) {
        const place = FORMATIONS[f];
        const model = rockModel(place.model, level);
        const at = groundPointAt(place.az, place.dist);
        const H = place.height;
        const cos = Math.cos(place.yaw * DEG);
        const sin = Math.sin(place.yaw * DEG);
        // Seated on the lowest sand under its apron (the dunes drift up against the talus).
        const ring = model.footprint * H * 0.85;
        let ground = groundAt(at.x, at.z);
        for (let k = 0; k < 10; k++) {
            const a = (k / 10) * Math.PI * 2;
            ground = Math.min(ground, groundAt(at.x + Math.cos(a) * ring, at.z + Math.sin(a) * ring));
        }
        const base = ground - 2;
        const seed = 1201 + f * 17;
        const scale = quant * H;
        const { position, normal, shade } = model;
        for (let i = 0; i < model.vertexCount; i++) {
            const px = position[i * 3] * scale;
            const py = position[i * 3 + 1] * scale;
            const pz = position[i * 3 + 2] * scale;
            out.positions.push(at.x + px * cos + pz * sin, base + py, at.z - px * sin + pz * cos);
            const nx = normal[i * 3];
            const ny = normal[i * 3 + 1];
            const nz = normal[i * 3 + 2];
            const nl = Math.hypot(nx, ny, nz) || 1;
            out.normals.push((nx * cos + nz * sin) / nl, ny / nl, (-nx * sin + nz * cos) / nl);
            out.params.push(position[i * 3 + 1] * quant, H, place.kind, seed % 97);
            out.bake.push(shade[i * 2] / 255, shade[i * 2 + 1] / 255);
            if ((i & 4095) === 4095 && clock.due()) {
                yield 'formation vertices';
                clock.restart();
            }
        }
        const { index } = model;
        for (let i = 0; i < index.length; i++) out.indices.push(offset + index[i]);
        offset += model.vertexCount;
        // What stands in for the solid: its tiers as flat-topped cylinders, in the world.
        let solid = 0;
        for (let i = 0; i < model.proxies.length; i++) {
            const p = model.proxies[i];
            const x = at.x + (p.x * cos + p.z * sin) * H;
            const z = at.z + (-p.x * sin + p.z * cos) * H;
            solids.push({
                x, z, r2: (p.r * H) ** 2, top: base + p.t1 * H,
            });
            if (p.t1 >= 0.45) solid = Math.max(solid, (Math.hypot(p.x, p.z) + p.r) * H);
        }
        list.push({
            model: place.model,
            kind: place.kind,
            x: at.x,
            z: at.z,
            base,
            height: H,
            radius: model.footprint * H,
            solid: Math.max(solid, model.footprint * H * 0.4),
        });
        if (clock.due()) {
            yield 'formation';
            clock.restart();
        }
    }
    offset += buildEscarpment(rand, out, offset);
    if (clock.due()) {
        yield 'escarpment';
        clock.restart();
    }

    const geometry = new THREE.BufferGeometry();
    const IndexAttr = offset > 65535 ? THREE.Uint32BufferAttribute : THREE.Uint16BufferAttribute;
    geometry.setIndex(new IndexAttr(out.indices, 1));
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(out.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(out.normals, 3));
    geometry.setAttribute('aRock', new THREE.Float32BufferAttribute(out.params, 4));
    geometry.setAttribute('aBake', new THREE.Float32BufferAttribute(out.bake, 2));
    geometry.computeBoundingSphere();

    /** Solid height for the shadow march (each formation as its stack of cylinders). */
    const heightAt = (x, z) => {
        let h = -Infinity;
        for (let i = 0; i < solids.length; i++) {
            const o = solids[i];
            const dx = x - o.x;
            const dz = z - o.z;
            if (dx * dx + dz * dz < o.r2 && o.top > h) h = o.top;
        }
        return h;
    };
    return {
        geometry, heightAt, list, vertexCount: offset,
    };
}

/**
 * The rock material (one for every formation).
 * aRock = (s: normalised height, H: formation height, kind, seed)
 * aBake = (ambient occlusion: 1 in the open; crest: 0 in a joint, ½ on a face, 1 on an exposed edge)
 */
export function createRockMaterial(shared) {
    const {
        uSunA, uSunB, uSunLightA, uSunLightB, uUpper, uZenith, uHorizonCool, atmosphere, noiseTex,
        uMoonDir, uMoonLight, uGlowA,
    } = shared;
    const aRock = attribute('aRock', 'vec4');
    const aBake = attribute('aBake', 'vec2');
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'shifting-sands-rock';
    material.fog = false;
    const nAttr = attribute('normal', 'vec3');

    material.colorNode = Fn(() => {
        const wp = positionWorld;
        const N = normalize(nAttr).toVar();
        const V = normalize(cameraPosition.sub(wp));
        const s = aRock.x;
        const kind = aRock.z;
        const escarp = smoothstep(1.5, 2.0, kind);
        const open = aBake.x;
        const crest = aBake.y;

        // ── Strata: level beds that undulate a little ──
        // The period is fixed: a period that varied across the face made neighbouring beds
        // converge, and the pale beds crossed the cliff as diagonal scratches.
        const nw = ssTexNoise(noiseTex, vec2(wp.x.add(wp.z).mul(0.004), wp.y.mul(0.006)));
        // Formation-relative height: a darker shale base, the red cliff sandstone with thin pale
        // beds, a pale caprock.
        const band = fract(wp.y.add(nw.x.mul(4.0)).div(41.0));
        const red = vec3(0.52, 0.2, 0.09);
        const orange = vec3(0.64, 0.31, 0.14);
        const buff = vec3(0.76, 0.56, 0.38);
        const shale = vec3(0.36, 0.17, 0.11);
        const albedo = mix(red, orange, smoothstep(0.2, 0.6, band).mul(0.7).add(nw.z.mul(0.3))).toVar();
        const paleBed = smoothstep(0.8, 0.86, band).mul(float(1.0).sub(smoothstep(0.92, 0.97, band)));
        albedo.assign(mix(albedo, buff, paleBed.mul(0.55)));
        albedo.assign(mix(shale, albedo, smoothstep(0.3, 0.42, s)));
        const caprock = smoothstep(0.9, 0.95, s).mul(float(1.0).sub(smoothstep(1.5, 2.0, kind)));
        albedo.assign(mix(albedo, buff.mul(0.95), caprock));
        // Desert varnish: dark streaks running down the cliffs from the crown.
        const vn = ssTexNoise(noiseTex, vec2(wp.x.add(wp.z.mul(0.7)).mul(0.07), wp.y.mul(0.004)));
        const varnish = smoothstep(0.55, 0.85, vn.z).mul(smoothstep(0.25, 0.9, s)).mul(float(1.0).sub(escarp));
        albedo.assign(mix(albedo, vec3(0.16, 0.08, 0.05), varnish.mul(0.75)));
        // Sand on ledges, the crown and the apron.
        const sandy = smoothstep(0.55, 0.85, N.y).add(float(1.0).sub(smoothstep(0.06, 0.22, s)).mul(0.8));
        albedo.assign(mix(albedo, vec3(0.8, 0.45, 0.21), clamp(sandy, 0.0, 1.0)));
        // The joints and the undercut beds are stained dark; an exposed arris is worn pale.
        albedo.mulAssign(mix(0.7, 1.0, smoothstep(0.0, 0.45, crest)));
        albedo.assign(mix(albedo, albedo.mul(1.12).add(vec3(0.03, 0.02, 0.012)), smoothstep(0.6, 1.0, crest).mul(0.5)));

        // ── Light ──
        const nlA = dot(N, uSunA);
        const nlB = dot(N, uSunB);
        // (a joint deep in the cliff sees little of either sun)
        const sunReach = mix(0.45, 1.0, smoothstep(0.15, 0.75, open));
        const direct = uSunLightA.mul(clamp(nlA.mul(1.6), 0.0, 1.0))
            .add(uSunLightB.mul(clamp(nlB.mul(1.5), 0.0, 1.0)))
            .mul(sunReach);
        // The baked occlusion: what each point sees of the sky, the talus under it and the rock round it.
        const ao = mix(0.55, 1.0, smoothstep(0.0, 0.35, s)).mul(mix(0.75, 1.0, vn.w)).mul(mix(0.3, 1.0, open));
        const skyFill = mix(uHorizonCool.mul(0.45), uUpper.mul(0.9).add(uZenith.mul(0.7)), N.y.mul(0.5).add(0.5));
        const col = albedo.mul(direct.add(skyFill.mul(ao))).toVar();
        // By moonlight the stone goes to silver (the eye has lost its colour); the moons stand
        // behind the Sentinel, so it is mostly their rim that it wears.
        const grey = dot(albedo, vec3(0.3, 0.5, 0.2));
        const silver = mix(albedo, vec3(0.92, 1.0, 1.16).mul(grey).mul(1.3), 0.75);
        const moonFace = clamp(dot(N, uMoonDir).mul(1.5).add(0.1), 0.0, 1.0).add(0.07);
        col.addAssign(silver.mul(uMoonLight).mul(moonFace).mul(ao));
        // Backlit rim: silhouette edges facing the suns glow (and go on glowing in the afterglow).
        const facing = pow(float(1.0).sub(clamp(dot(N, V), 0.0, 1.0)), 3.0);
        const rim = facing.mul(pow(clamp(dot(V.negate(), uSunA).mul(0.5).add(0.5), 0.0, 1.0), 3.0));
        col.addAssign(uSunLightA.mul(0.35).add(uGlowA.mul(0.05)).mul(rim).mul(albedo.add(0.25))
            .mul(sunReach));
        const rimM = facing.mul(pow(clamp(dot(V.negate(), uMoonDir).mul(0.5).add(0.5), 0.0, 1.0), 3.0));
        col.addAssign(uMoonLight.mul(rimM.mul(0.6)).mul(silver.add(0.2)));
        // The escarpment is mostly silhouette: flatten its light.
        col.assign(mix(col, albedo.mul(skyFill.mul(0.8).add(uSunLightA.mul(0.06))), escarp.mul(0.6)));
        return vec4(atmosphere.applyAerial(col, wp, max(float(1.0), escarp.mul(1.15))), 1.0);
    })();

    return material;
}

export function createFormations(options) {
    return drainSteps(createFormationsSteps(options));
}

/** `createFormations` as steps: the geometry in slices (buildFormationsSteps), then the material and mesh. */
export function* createFormationsSteps({ field, shared, detail = 1 }) {
    const built = yield* buildFormationsSteps(field, { detail });
    const material = createRockMaterial(shared);
    const mesh = new THREE.Mesh(built.geometry, material);
    mesh.name = 'shifting-sands-rocks';
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return {
        mesh,
        material,
        heightAt: built.heightAt,
        list: built.list,
        /** Footprints for the worm director: r = the apron on the sand, solid = the standing rock. */
        obstacles: built.list.map((f) => ({
            x: f.x, z: f.z, r: f.radius * 1.02, solid: f.solid, h: f.height,
        })),
        dispose() {
            built.geometry.dispose();
            material.dispose();
        },
    };
}
