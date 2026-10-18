/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater — the spirit as she stands in the scene.
 *
 * Her figure (assets/spirit-lod0..1.glb, built in Blender from a few numbers by
 * scripts/blender/stillwater_figures.py: a slender body, a long gown with a train, bell sleeves,
 * gold hair to her knees, a thin circlet; a skeleton with two hair links and four gown panels) is
 * posed every frame by her body (stillwater-spirit-body.js). The file's colour says what each vertex
 * is: skin, hair (both: the circlet's gold), how freely it hangs, how shut in it is.
 *
 * She is lit from within. The light is strongest at her breast and runs out into the cloth; thin
 * cloth seen edge-on glows; her hair is gold with a sheen down its strands; and below her knees
 * the gown goes out into the mist that lies on the water, dissolving at the hem. A soft halo stands
 * round her, and motes of light rise from her like breath on a cold night.
 */

import * as THREE from 'three/webgpu';
import {
    Discard,
    Fn,
    If,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    cos,
    dot,
    exp,
    float,
    fract,
    instanceIndex,
    length,
    mix,
    normalWorld,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    screenCoordinate,
    sin,
    smoothstep,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import spiritLod0Url from './assets/spirit-lod0.glb?url';
import spiritLod1Url from './assets/spirit-lod1.glb?url';
import {
    SPIRIT, swFog, swLight, swPart,
} from './stillwater-tsl.js';
import { buildFigure } from './stillwater-rig.js';
import { SpiritBody } from './stillwater-spirit-body.js';
import { parentsFromSpec, restFromSpec } from './stillwater-troll-body.js';

const SPIRIT_URLS = [spiritLod0Url, spiritLod1Url];

/** Motes of light that rise round her. */
const MOTES = 36;

/**
 * @param {object} u
 * @param {object} [opts]
 * @param {number} [opts.lod=0]  0 = the full figure, 1 = half (the low tiers)
 * @param {number} [opts.motes=MOTES]
 */
export function createSpirit(u, opts = {}) {
    const lod = Math.max(0, Math.min(1, Math.round(opts.lod ?? 0)));
    const group = new THREE.Group();
    group.name = 'StillwaterSpirit';
    const walkSpace = new THREE.Group();
    group.add(walkSpace);
    const figure = new THREE.Group();
    const turn = new THREE.Group();
    figure.add(turn);
    walkSpace.add(figure);
    const scaled = new THREE.Group();
    scaled.scale.setScalar(SPIRIT.height);
    turn.add(scaled);

    /** 0..1: how much her light has been fed (wisps come home, the heart), on top of her own. */
    const uFed = uniform(0);
    /** Her hem's height over the water (m): the dissolve lies on the water, not on her stone. */
    const uLift = uniform(0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StillwaterSpirit';
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.toneMapped = false;
    const col = attribute('color', 'vec4');
    const vModel = varying(positionLocal, 'vSpiritModel');
    material.positionNode = Fn(() => {
        const P = positionLocal;
        // What hangs free breathes with the air (the panels and hair links carry the big motion).
        const free = col.z;
        const stir = vec3(
            sin(u.sway.mul(1.3).add(P.y.mul(11.0)).add(P.x.mul(6.0))),
            0.0,
            sin(u.sway.mul(1.05).add(P.y.mul(8.0)).add(1.3)),
        ).mul(u.wind.mul(0.006).add(0.003));
        return P.add(stir.mul(free));
    })();
    material.fragmentNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(normalWorld).toVar();
        const V = normalize(P.sub(cameraPosition));
        const M = vModel;
        const skin = col.x;
        const hair = col.y;
        const ao = col.w;
        const gold = skin.mul(hair);
        const isHair = hair.mul(float(1.0).sub(skin));
        const isSkin = skin.mul(float(1.0).sub(hair));
        const facing = abs(dot(N, V));
        const edge = float(1.0).sub(facing);
        // What she is made of: linen, gold hair, pale skin, a gold circlet.
        const linen = u.spirit;
        const hairGold = mix(u.heart.mul(0.9), u.spirit, 0.12);
        const strands = u.noise(vec2(M.x.mul(30.0).add(M.z.mul(24.0)), M.y.mul(2.2))).r;
        const sheen = smoothstep(0.55, 0.85, strands).mul(edge.mul(0.6).add(0.4));
        const pale = u.spirit.mul(vec3(1.0, 0.93, 0.88));
        const cloth = mix(mix(mix(linen, hairGold.mul(strands.mul(0.5).add(0.7)), isHair), pale, isSkin), u.heart, gold);
        // Her light: from within, brightest at the breast, out along the cloth; thin cloth seen edge-on glows.
        const power = u.spiritAt.w.add(uFed.mul(0.6));
        const within = exp(abs(M.y.sub(0.74)).mul(-2.4)).mul(0.55).add(0.28);
        const glow = cloth.mul(within.add(edge.mul(edge).mul(0.85))).mul(power).mul(0.82)
            .add(hairGold.mul(sheen).mul(isHair).mul(power).mul(0.6))
            .add(u.heart.mul(gold).mul(power).mul(2.4));
        const moon = swLight(u, cloth.mul(0.8), N, P, { wrap: 0.6, shade: float(1.0), local: 0.4 });
        const shut = ao.mul(0.55).add(0.45);
        // Below the knee the gown goes out into the mist on the water, and dissolves at the hem.
        const above = P.y.sub(uLift);
        const hem = smoothstep(0.0, 0.42, above).mul(skin.max(hair).oneMinus()).add(skin.max(hair)).clamp(0.0, 1.0);
        const lit = glow.mul(u.breath.mul(0.6).add(0.4)).add(moon).mul(shut).toVar();
        const mist = swFog(u, lit, P);
        const dither = fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453));
        If(hem.lessThan(dither.mul(0.55)), () => {
            Discard();
        });
        return vec4(mix(swFog(u, lit.mul(0.3), P, 3.0), mist, hem.mul(0.8).add(0.2)), 1.0);
    })();

    // Her light in the air round her: a soft halo that always faces the viewer.
    const haloGeometry = new THREE.PlaneGeometry(1, 1);
    const haloMaterial = new THREE.MeshBasicNodeMaterial();
    haloMaterial.name = 'StillwaterSpiritHalo';
    haloMaterial.transparent = true;
    haloMaterial.blending = THREE.AdditiveBlending;
    haloMaterial.premultipliedAlpha = true;
    haloMaterial.depthWrite = false;
    haloMaterial.fog = false;
    haloMaterial.toneMapped = false;
    haloMaterial.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    haloMaterial.vertexNode = Fn(() => {
        const view = cameraViewMatrix.mul(vec4(u.spiritAt.xyz, 1.0));
        const size = float(4.0).add(uFed.mul(1.8));
        const q = positionGeometry.xy.mul(size);
        return cameraProjectionMatrix.mul(vec4(view.x.add(q.x), view.y.add(q.y.mul(1.3)), view.z, 1.0));
    })();
    haloMaterial.outputNode = Fn(() => {
        const d = length(uv().sub(0.5).mul(2.0));
        const fade = float(1.0).sub(smoothstep(0.7, 1.0, d));
        const light = exp(d.mul(-4.2)).mul(0.5).add(exp(d.mul(d).mul(-30.0)).mul(0.22)).mul(fade);
        return vec4(u.spirit.mul(light).mul(u.spiritAt.w.add(uFed.mul(0.8))).mul(u.breath).mul(0.5), 0.0);
    })();
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    halo.frustumCulled = false;
    halo.renderOrder = 64;
    group.add(halo);

    // Motes: small lights that rise round her and go out, a little faster when she is fed.
    const moteCount = Math.max(0, Math.round(opts.motes ?? MOTES));
    let motes = null;
    let moteGeometry = null;
    let moteMaterial = null;
    if (moteCount > 0) {
        moteGeometry = new THREE.InstancedBufferGeometry();
        const quad = new THREE.PlaneGeometry(1, 1);
        moteGeometry.index = quad.index;
        moteGeometry.setAttribute('position', quad.getAttribute('position'));
        moteGeometry.setAttribute('uv', quad.getAttribute('uv'));
        moteGeometry.instanceCount = moteCount;
        moteMaterial = new THREE.MeshBasicNodeMaterial();
        moteMaterial.name = 'StillwaterSpiritMotes';
        moteMaterial.transparent = true;
        moteMaterial.blending = THREE.AdditiveBlending;
        moteMaterial.premultipliedAlpha = true;
        moteMaterial.depthWrite = false;
        moteMaterial.fog = false;
        moteMaterial.toneMapped = false;
        moteMaterial.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
        const vLife = varying(float(0.0), 'vMoteLife');
        moteMaterial.vertexNode = Fn(() => {
            const i = float(instanceIndex);
            const seed = fract(sin(i.mul(12.9898)).mul(43758.5453));
            const seed2 = fract(sin(i.mul(78.233)).mul(12345.678));
            const rate = float(0.14).add(seed.mul(0.1)).mul(uFed.mul(0.6).add(1.0));
            const age = fract(u.time.mul(rate).add(seed2));
            const angle = seed.mul(6.2832).add(u.time.mul(0.2).mul(seed2.sub(0.5)));
            const radius = float(0.18).add(seed2.mul(0.35)).add(age.mul(0.12));
            const base = u.spiritAt.xyz.sub(vec3(0.0, 0.9, 0.0));
            const at = base.add(vec3(cos(angle).mul(radius), age.mul(2.1).add(seed.mul(0.2)), sin(angle).mul(radius)));
            vLife.assign(smoothstep(0.0, 0.15, age).mul(float(1.0).sub(smoothstep(0.55, 1.0, age))));
            const view = cameraViewMatrix.mul(vec4(at, 1.0));
            const size = float(0.035).add(seed.mul(0.03));
            const q = positionGeometry.xy.mul(size);
            return cameraProjectionMatrix.mul(vec4(view.x.add(q.x), view.y.add(q.y), view.z, 1.0));
        })();
        moteMaterial.outputNode = Fn(() => {
            const d = length(uv().sub(0.5).mul(2.0));
            const light = exp(d.mul(d).mul(-6.0)).mul(float(1.0).sub(smoothstep(0.8, 1.0, d)));
            return vec4(u.spirit.mul(light).mul(vLife).mul(u.spiritAt.w.add(uFed)).mul(u.breath)
                .mul(1.6), 0.0);
        })();
        motes = new THREE.Mesh(moteGeometry, moteMaterial);
        motes.frustumCulled = false;
        motes.renderOrder = 71;
        group.add(motes);
    }

    const part = swPart('StillwaterSpirit', null, material, 12, { mesh: group });
    part.uFed = uFed;
    part.figure = figure;
    part.ready = false;
    part.failed = false;
    part.body = null;
    let built = null;
    let disposed = false;
    const tmp = new THREE.Vector3();
    const pending = {
        x: SPIRIT.home[0], y: SPIRIT.home[1], z: SPIRIT.home[2], heading: 1.6,
    };

    part.load = async (loader = new GLTFLoader()) => {
        try {
            const gltf = await loader.loadAsync(SPIRIT_URLS[lod]);
            if (disposed) return false;
            built = buildFigure(gltf, material);
            built.mesh.renderOrder = 12;
            built.mesh.layers.mask = group.layers.mask;
            scaled.position.y = -built.extras.sole * SPIRIT.height;
            scaled.add(built.mesh);
            part.body = new SpiritBody(restFromSpec(built.extras), {
                height: SPIRIT.height,
                sole: built.extras.sole,
                parents: parentsFromSpec(built.extras),
                tails: built.tails,
            });
            part.body.reset(pending.x, pending.y, pending.z, pending.heading);
            part.ready = true;
            return true;
        } catch (error) {
            part.failed = true;
            console.warn('[Stillwater] The spirit could not be loaded.', error);
            return false;
        }
    };

    part.reset = (x, y, z, heading) => {
        pending.x = x;
        pending.y = y;
        pending.z = z;
        pending.heading = heading;
        part.body?.reset(x, y, z, heading);
    };

    /** Move her on by `dt` toward what she means to do (see SpiritBody.update); returns her events. */
    part.update = (dt, want, time) => {
        const { body } = part;
        if (!body) return [];
        body.update(dt, want, time);
        body.applyTo(built.bones);
        figure.position.copy(body.root);
        turn.rotation.set(0, body.heading, 0);
        // The dissolve lies on the water (or her stone) under her.
        uLift.value = Math.max(0, body.root.y - 0.02);
        return body.events;
    };

    part.setSqueeze = (s) => {
        walkSpace.scale.set(1 / Math.max(0.2, s), 1, 1);
    };

    /** Her heart in world space (where the light she takes goes). */
    part.heartWorld = (out) => {
        if (part.body) part.body.heartWalk(tmp);
        else tmp.set(pending.x, pending.y + SPIRIT.height * 0.72, pending.z);
        walkSpace.updateWorldMatrix(true, false);
        tmp.applyMatrix4(walkSpace.matrixWorld);
        out[0] = tmp.x;
        out[1] = tmp.y;
        out[2] = tmp.z;
        return out;
    };

    /** Where she stands (walk frame). */
    part.rootWalk = () => (part.body ? part.body.root : tmp.set(pending.x, pending.y, pending.z));

    part.dispose = () => {
        disposed = true;
        if (built) {
            built.mesh.geometry.dispose();
            built.mesh.skeleton?.dispose?.();
        }
        haloGeometry.dispose();
        haloMaterial.dispose();
        moteGeometry?.dispose();
        moteMaterial?.dispose();
        material.dispose();
    };
    return part;
}
