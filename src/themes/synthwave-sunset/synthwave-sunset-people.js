/* eslint-disable import/no-unresolved */
/**
 * Synthwave Sunset — the people on the pier, drawn.
 *
 * The cast's figures (assets/strollers.glb, from scripts/blender/synthwave_strollers.py: eight
 * outfits on three builds, each skinned to one thirteen-bone skeleton) are dressed and merged into
 * one mesh for the tier's people, so all of them are one draw. Every frame StrollerLife
 * (synthwave-sunset-strollers.js) poses them on the CPU; their bones go into a float texture, a
 * row a person, two texels a bone (its rotation, and where it carries the rest frame with the
 * person's size), and the vertex stage skins each vertex from its person's row: two bones a
 * vertex, blended across the joints.
 *
 * Light as the pier takes it: the evening sky from above (less where the body shuts it out: the
 * model's `sky` share), the low sun's warmth on what faces it and as a rim round the outline,
 * which is what they mostly are against the sunset, and after dark the railing's bulbs and the
 * lamps from below and the side. Opaque, with depth, on the mirror layer (the sea reflects them).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, cross, dot, exp, faceDirection, float, floor, int, ivec2, max, mix, normalize,
    positionGeometry, positionWorld, smoothstep, textureLoad, varying, vec3, vec4,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { rgb } from './synthwave-sunset-tsl.js';
import { pierFrame } from './synthwave-sunset-layout.js';
import {
    DECK, STROLLER_BONES, STROLLER_ROW, StrollerLife, pierPlane, strollerRig,
} from './synthwave-sunset-strollers.js';

export const STROLLERS_URL = new URL('./assets/strollers.glb', import.meta.url).href;

/**
 * The figures out of a parsed glTF: per outfit its geometry (position, normal, _bones, _paint,
 * index) and its rig (the rest joints, height and foot length the model carries as extras).
 */
export function strollerFiguresFromGltf(gltf) {
    const figures = {};
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
        if (!object.isMesh) return;
        const data = object.userData ?? {};
        if (!Array.isArray(data.joints) || data.joints.length !== STROLLER_BONES.length * 3) return;
        const geometry = object.geometry.clone();
        geometry.applyMatrix4(object.matrixWorld);
        for (const name of ['position', 'normal', '_bones', '_paint']) {
            if (!geometry.getAttribute(name)) throw new Error(`[SynthwaveSunset] the stroller "${object.name}" has no "${name}"`);
        }
        figures[object.name] = { geometry, rig: strollerRig(data.joints, data.height, data.foot) };
    });
    return figures;
}

/** Fetch and parse the cast. Resolves null when it cannot be read (the pier goes without). */
export async function loadStrollerFigures(url = STROLLERS_URL) {
    try {
        if (typeof fetch !== 'function' || typeof document === 'undefined') return null;
        return strollerFiguresFromGltf(await new GLTFLoader().loadAsync(url));
    } catch (error) {
        console.warn('[SynthwaveSunset] the strollers did not arrive:', error?.message || error);
        return null;
    }
}

/** Turn a vector by a unit quaternion (TSL). */
const turn = (q, v) => {
    const t = cross(q.xyz, v).mul(2);
    return v.add(t.mul(q.w)).add(cross(q.xyz, t));
};

/**
 * The cast's merged mesh: every person's figure, dressed in their colours (linear RGB, with the
 * model's sky share in alpha), and which row of the table skins it.
 */
export function buildCastGeometry(life, figures) {
    const parts = life.people.map((person) => figures[person.figure]?.geometry ?? null);
    let vertices = 0;
    let indices = 0;
    parts.forEach((g) => {
        if (!g) return;
        vertices += g.getAttribute('position').count;
        indices += g.index ? g.index.count : g.getAttribute('position').count;
    });
    const position = new Float32Array(vertices * 3);
    const normal = new Float32Array(vertices * 3);
    const skin = new Float32Array(vertices * 4);
    const dress = new Float32Array(vertices * 4);
    const index = new Uint32Array(indices);
    let v0 = 0;
    let i0 = 0;
    life.people.forEach((person, row) => {
        const g = parts[row];
        if (!g) return;
        const pos = g.getAttribute('position');
        const nor = g.getAttribute('normal');
        const bones = g.getAttribute('_bones');
        const paint = g.getAttribute('_paint');
        for (let k = 0; k < pos.count; k += 1) {
            const o = v0 + k;
            position[o * 3] = pos.getX(k);
            position[o * 3 + 1] = pos.getY(k);
            position[o * 3 + 2] = pos.getZ(k);
            normal[o * 3] = nor.getX(k);
            normal[o * 3 + 1] = nor.getY(k);
            normal[o * 3 + 2] = nor.getZ(k);
            skin[o * 4] = bones.getX(k);
            skin[o * 4 + 1] = bones.getY(k);
            skin[o * 4 + 2] = bones.getZ(k);
            skin[o * 4 + 3] = row;
            const slot = Math.round(paint.getX(k));
            const c = person.colours[slot] ?? person.colours[0];
            dress[o * 4] = c[0];
            dress[o * 4 + 1] = c[1];
            dress[o * 4 + 2] = c[2];
            dress[o * 4 + 3] = paint.getY(k);
        }
        if (g.index) {
            for (let k = 0; k < g.index.count; k += 1) index[i0 + k] = g.index.getX(k) + v0;
            i0 += g.index.count;
        } else {
            for (let k = 0; k < pos.count; k += 1) index[i0 + k] = v0 + k;
            i0 += pos.count;
        }
        v0 += pos.count;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('aSkin', new THREE.BufferAttribute(skin, 4));
    geometry.setAttribute('aDress', new THREE.BufferAttribute(dress, 4));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.name = 'SynthwaveStrollers';
    return geometry;
}

export class SynthwavePeople {
    /**
     * @param {object} u  world uniforms (ambient, sunDir, sunWarm, sunBand, dusk, pierGlow, pierPower)
     * @param {object} [o]
     * @param {number} [o.count=10]  people on the pier (a tier's count; 0 = none)
     * @param {number} [o.mirrorLayer]
     */
    constructor(u, { count = 10, mirrorLayer } = {}) {
        this.u = u;
        this.count = count;
        this.mirrorLayer = mirrorLayer;
        this.group = new THREE.Group();
        this.group.name = 'SynthwaveStrollers';
        this.life = null;
        this.mesh = null;
        this.table = null;
    }

    /** The figures have come: dress the cast and start drawing it. */
    attach(figures) {
        if (this.mesh || !figures || this.count <= 0) return false;
        const rigs = Object.fromEntries(Object.entries(figures).map(([name, f]) => [name, f.rig]));
        this.life = new StrollerLife({ plane: pierPlane(pierFrame()), count: this.count, rigs });
        const rows = Math.max(1, this.life.people.length);
        this.data = new Float32Array(STROLLER_ROW * rows * 4);
        const table = new THREE.DataTexture(this.data, STROLLER_ROW, rows, THREE.RGBAFormat, THREE.FloatType);
        table.minFilter = THREE.NearestFilter;
        table.magFilter = THREE.NearestFilter;
        table.generateMipmaps = false;
        table.colorSpace = THREE.NoColorSpace;
        table.name = 'SynthwaveStrollerPoses';
        this.table = table;
        const geometry = buildCastGeometry(this.life, figures);
        const mesh = new THREE.Mesh(geometry, this.createMaterial());
        mesh.name = 'SynthwaveStrollers';
        mesh.frustumCulled = false;
        mesh.renderOrder = -5;
        if (Number.isInteger(this.mirrorLayer)) mesh.layers.enable(this.mirrorLayer);
        this.mesh = mesh;
        this.group.add(mesh);
        this.update(this.lastTime ?? 0);
        return true;
    }

    createMaterial() {
        const { u, table } = this;
        const material = new THREE.MeshBasicNodeMaterial();
        material.name = 'SynthwaveStrollers';
        material.fog = false;
        material.side = THREE.DoubleSide;
        const skin = attribute('aSkin', 'vec4');
        const dress = attribute('aDress', 'vec4');
        const vNormal = varying(vec3(0, 1, 0), 'swStrollerNormal');
        const vDress = varying(vec4(0), 'swStrollerDress');
        material.positionNode = Fn(() => {
            const row = int(floor(skin.w.add(0.5)));
            const ia = int(floor(skin.x.add(0.5))).mul(2);
            const ib = int(floor(skin.y.add(0.5))).mul(2);
            const qa = textureLoad(table, ivec2(ia, row)).toVar();
            const ta = textureLoad(table, ivec2(ia.add(1), row)).toVar();
            const qb = textureLoad(table, ivec2(ib, row)).toVar();
            const tb = textureLoad(table, ivec2(ib.add(1), row)).toVar();
            const p = positionGeometry;
            const n = attribute('normal', 'vec3');
            const w = skin.z;
            const pa = turn(qa, p).mul(ta.w).add(ta.xyz);
            const pb = turn(qb, p).mul(tb.w).add(tb.xyz);
            vNormal.assign(mix(turn(qa, n), turn(qb, n), w));
            vDress.assign(dress);
            return mix(pa, pb, w);
        })();
        material.colorNode = Fn(() => {
            const albedo = vDress.xyz;
            const open = vDress.w;
            const N = normalize(vNormal).mul(faceDirection).toVar();
            const V = normalize(cameraPosition.sub(positionWorld)).toVar();
            const h = positionWorld.y.sub(DECK.y);
            // The evening's sky from above, as the pier takes it.
            const sky = rgb(0x8a7aa8, 0.3).mul(float(0.55).add(max(N.y, 0.0).mul(0.45))).mul(u.ambient).mul(open);
            // The low sun: warm on what faces it while it is up, and round the outline.
            const toSun = max(dot(N, u.sunDir), 0.0);
            const sunUp = smoothstep(-0.16, 0.06, u.sunDir.y);
            const key = u.sunWarm.mul(toSun.mul(0.28).mul(sunUp));
            const edge = float(1.0).sub(abs(dot(N, V)));
            const rim = edge.mul(edge).mul(edge).mul(toSun.mul(0.8).add(0.2))
                .mul(u.sunBand.mul(0.55))
                .mul(mix(float(1.0), float(0.35), u.dusk));
            // The railing's bulbs and the lamps once they are lit: warm from below and the side.
            const lit = u.pierGlow.mul(u.pierPower);
            const bulbs = rgb(0xffb878).mul(exp(h.mul(-0.9)).mul(0.5).add(0.14).mul(lit)).mul(max(N.y.negate(), 0.0).mul(0.4).add(0.6));
            return albedo.mul(sky.add(key).add(bulbs)).add(rim.mul(albedo.mul(0.5).add(0.5)));
        })();
        return material;
    }

    /** Pose everyone for `time` (the gulls' clock: held back under reduced motion). */
    update(time) {
        this.lastTime = time;
        if (!this.life) return;
        this.life.write(time, this.data);
        this.table.needsUpdate = true;
    }

    /** A firework burst: heads turn up to it (`at` on the same clock as update's). */
    notice(pos, at, scale) {
        this.life?.notice(pos.x, pos.y, pos.z, at, scale);
    }

    /** A seek: forget the bursts. */
    seek() {
        this.life?.reset();
    }

    dispose() {
        this.mesh?.geometry.dispose();
        this.mesh?.material.dispose();
        this.table?.dispose();
        this.group.removeFromParent();
        this.mesh = null;
        this.life = null;
    }
}
