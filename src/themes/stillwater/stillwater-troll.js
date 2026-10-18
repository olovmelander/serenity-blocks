/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater — the troll as he stands in the scene: his sculpt, his staff and his lantern.
 *
 * His body (assets/troll-lod0..3.glb, drawn clean from numbers in Blender in the character of the
 * theme's own sculpt by scripts/blender/stillwater_assets.py: smooth masses under a mane of matted
 * moss locks, a moss beard and brows, a loincloth, a few mushrooms in his moss; a skeleton of
 * twenty-one bones) is posed every frame by stillwater-troll-body.js. The file's colour says what
 * each vertex is (his ruddy face, his hide, moss and the shade of its lock, leather, an eye, a
 * mushroom) and how shut in it is, and he is shaded in a few big masses as part of the place: moss
 * for his mane, earth for his hide, his face warm in his lantern's light, an edge of moonlight on
 * his outline. The mane hangs free below his shoulders: it sways in the air and swings after him.
 *
 * The lantern hangs from the crook of a gnarled staff he walks with; its flame is the shared
 * `lanternAt` uniform, so the bank, the troll and the water all take the same light.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cross,
    dFdx,
    dFdy,
    cameraProjectionMatrix,
    cameraViewMatrix,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    normalWorld,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    sign,
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
import trollLod0Url from './assets/troll-lod0.glb?url';
import trollLod1Url from './assets/troll-lod1.glb?url';
import trollLod2Url from './assets/troll-lod2.glb?url';
import trollLod3Url from './assets/troll-lod3.glb?url';
import {
    TROLL, swFog, swLight, swLuma, swPart,
} from './stillwater-tsl.js';
import { buildFigure } from './stillwater-rig.js';
import {
    STAFF, TrollBody, parentsFromSpec, restFromSpec,
} from './stillwater-troll-body.js';
import { Spring3 } from './stillwater-motion.js';

const TROLL_URLS = [trollLod0Url, trollLod1Url, trollLod2Url, trollLod3Url];

/**
 * Ways to colour him (scene-linear albedos: `skin` his ruddy face, `bare` his hide, `hide` the
 * leather of his loincloth, `mossLo`/`mossHi` the darkest and palest of his locks; `hour` = the share
 * of the hour's own palette in them, `lampWhite` = how far his lantern's light on him is whitened,
 * `fungus` = how much the mushrooms in his moss glow).
 */
/** How he is coloured unless asked otherwise: moss and earth, with glowing mushrooms in his moss. */
export const DEFAULT_LOOK = 'forest';

export const TROLL_LOOKS = Object.freeze({
    // Everything near the hour's own moss and stone.
    stone: Object.freeze({
        skin: [0.21, 0.165, 0.13],
        bare: [0.17, 0.15, 0.12],
        hide: [0.08, 0.068, 0.056],
        mossLo: [0.033, 0.09, 0.031],
        mossHi: [0.07, 0.165, 0.077],
        hour: 0.5,
        lampWhite: 0,
        lampGain: 1,
        fungus: 0,
    }),
    // Earth and moss: a ruddy face, an earthen hide, dark leather, deep moss.
    earth: Object.freeze({
        skin: [0.34, 0.19, 0.15],
        bare: [0.2, 0.165, 0.125],
        hide: [0.075, 0.045, 0.028],
        mossLo: [0.035, 0.09, 0.024],
        mossHi: [0.12, 0.24, 0.07],
        hour: 0.25,
        lampWhite: 0.82,
        lampGain: 0.65,
        fungus: 0,
    }),
    // Earth and moss, and small mushrooms growing in his moss that glow and wake with the chain.
    forest: Object.freeze({
        skin: [0.34, 0.19, 0.15],
        bare: [0.2, 0.165, 0.125],
        hide: [0.075, 0.045, 0.028],
        mossLo: [0.035, 0.09, 0.024],
        mossHi: [0.12, 0.24, 0.07],
        hour: 0.25,
        lampWhite: 0.82,
        lampGain: 0.65,
        fungus: 1,
    }),
});

/** The staff in its own frame: y from its foot up, the crook bending toward +z at the top. */
export function createStaffGeometry(long = STAFF.length) {
    const pts = [
        [0, 0, 0], [0.018, long * 0.22, 0.008], [-0.014, long * 0.45, -0.006], [0.012, long * 0.68, 0.01],
        [-0.006, long * 0.9, 0.0], [0, long * 0.975, 0.045], [0, long * 1.0, 0.12], [0, long * 0.985, 0.19],
        [0, long * 0.955, 0.215],
    ].map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const geometry = new THREE.TubeGeometry(curve, 56, 0.032, 7, false);
    // Thicker at the foot, thinner toward the crook, with a knot here and there.
    const pos = geometry.attributes.position;
    const centre = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        const ring = Math.floor(i / 8);
        const t = Math.min(1, ring / 56);
        curve.getPointAt(Math.min(1, t), centre);
        p.fromBufferAttribute(pos, i).sub(centre);
        const knot = 1 + 0.35 * Math.exp(-(((t - 0.31) * 30) ** 2)) + 0.28 * Math.exp(-(((t - 0.62) * 34) ** 2));
        p.multiplyScalar((1.15 - 0.45 * t) * knot);
        pos.setXYZ(i, centre.x + p.x, centre.y + p.y, centre.z + p.z);
    }
    geometry.computeVertexNormals();
    return geometry;
}

/**
 * @param {object} u
 * @param {object} [opts]
 * @param {number} [opts.lod=1]  which of the four meshes (0 = the finest)
 * @param {(x: number, z: number) => number} [opts.ground]  ground height in the walk frame
 * @returns the part; `load()` fetches the sculpt, `update(dt, want, time)` moves him,
 *   `lanternWorld(out)` gives the lantern's flame in world space.
 */
export function createTroll(u, opts = {}) {
    const lod = Math.max(0, Math.min(3, Math.round(opts.lod ?? 1)));
    const ground = opts.ground || (() => 0);
    const group = new THREE.Group();
    group.name = 'StillwaterTroll';
    /** True metres in x whatever the stage's squeeze: the body walks in this frame. */
    const walkSpace = new THREE.Group();
    group.add(walkSpace);
    const figure = new THREE.Group();
    const turn = new THREE.Group();
    figure.add(turn);
    walkSpace.add(figure);
    const scaled = new THREE.Group();
    scaled.scale.setScalar(TROLL.height);
    turn.add(scaled);

    /** The cloak's swing (model units, his own frame): it lags after the body. */
    const uCloak = uniform(new THREE.Vector3());
    /** His colours (scene-linear albedos), the share the hour's palette has in them, and the rest. */
    const look = {
        skin: uniform(new THREE.Color()),
        bare: uniform(new THREE.Color()),
        hide: uniform(new THREE.Color()),
        mossLo: uniform(new THREE.Color()),
        mossHi: uniform(new THREE.Color()),
        hour: uniform(0.5),
        lampWhite: uniform(0),
        lampGain: uniform(1),
        fungus: uniform(0),
    };
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StillwaterTroll';
    material.fog = false;
    material.toneMapped = false;
    const col = attribute('color', 'vec4');
    const vModel = varying(positionLocal, 'vTrollModel');
    material.positionNode = Fn(() => {
        const P = positionLocal;
        // The pelt hangs free below his shoulders, the more so the lower it hangs.
        const free = col.z.mul(smoothstep(0.18, -0.42, P.y));
        const air = vec3(
            sin(u.sway.mul(1.3).add(P.y.mul(9.0)).add(P.x.mul(4.0))),
            0.0,
            sin(u.sway.mul(0.9).add(P.y.mul(7.0)).add(P.z.mul(5.0)).add(1.7)),
        ).mul(u.wind.mul(0.01).add(0.003));
        return P.add(air.add(uCloak).mul(free));
    })();
    material.fragmentNode = Fn(() => {
        const P = positionWorld;
        const N0 = normalize(normalWorld);
        const V = normalize(P.sub(cameraPosition));
        const skin = col.x;
        const ao = col.y;
        const hair = col.z;
        const kind = col.w;
        const M = vModel;
        // What he is (the file's colour: skin 1 his ruddy face and ears, 0.65 his hide, 0.2 an eye;
        // moss, with its lock's shade in `kind` (0..0.6); kind 0.7 an eye, 1 a mushroom; nothing = the
        // leather of his loincloth).
        const notHair = float(1.0).sub(hair);
        const fleshy = smoothstep(0.3, 0.55, skin);
        const rosy = smoothstep(0.75, 0.95, skin);
        const eye = smoothstep(0.1, 0.16, skin).mul(float(1.0).sub(smoothstep(0.24, 0.3, skin)))
            .mul(smoothstep(0.55, 0.65, kind)).mul(notHair);
        const cap = smoothstep(0.85, 0.95, kind).mul(notHair).mul(float(1.0).sub(fleshy));
        // Fine strands down his locks, in light relief (the locks themselves are the shape; a
        // surface-gradient bump from the screen derivatives of their height).
        const strand = u.noise(vec2(M.x.mul(46.0).add(M.z.mul(39.0)), M.y.mul(5.0))).g;
        const height = strand.mul(hair).mul(0.004);
        const dpx = dFdx(P);
        const dpy = dFdy(P);
        const r1 = cross(dpy, N0);
        const r2 = cross(N0, dpx);
        const det = dot(dpx, r1);
        const grad = r1.mul(dFdx(height)).add(r2.mul(dFdy(height))).mul(sign(det));
        const N = normalize(abs(det).mul(N0).sub(grad)).toVar();
        const upward = smoothstep(-0.2, 0.9, N.y);
        // Moss: each lock its own shade, paler where it faces the sky, a little darker down its
        // strands. (His colours are his own, leaned a share toward the hour's so he belongs to the night.)
        const { hour } = look;
        const mossLo = mix(look.mossLo, u.moss.mul(1.1), hour);
        const mossHi = mix(look.mossHi, u.moss.mul(1.6).add(u.stone.mul(0.5)), hour);
        const shadeOfLock = clamp(kind.div(0.6).mul(0.7).add(upward.mul(0.45)).sub(0.12), 0.0, 1.0);
        const pelt = mix(mossLo, mossHi, shadeOfLock).mul(strand.mul(0.3).add(0.82));
        const leather = mix(look.hide, u.stone, hour.mul(0.6));
        const flesh = mix(mix(look.bare, look.skin, rosy), u.stone.mul(1.3), hour.mul(0.6));
        const body = mix(mix(leather, pelt, hair), flesh, fleshy.mul(notHair));
        // Dark wet eyes; pale mushroom caps.
        const withParts = mix(mix(body, vec3(0.012, 0.009, 0.007), eye), vec3(0.42, 0.4, 0.33), cap);
        const albedo = withParts.mul(ao.mul(0.85).add(0.15));
        const lit = swLight(u, albedo, N, P, { wrap: 0.6, local: look.lampGain.mul(0.25) }).toVar();
        // His own lantern, close by: it warms what faces it and falls away fast, so the side of
        // him the moon has stays cool and mossy.
        const toLantern = u.lanternAt.xyz.sub(P);
        const dLantern = length(toLantern);
        const facingLantern = max(dot(N, toLantern.div(max(dLantern, 1e-3))), 0.0);
        // (His lantern's light on him, a share whitened so his own colours survive it.)
        const lampOnHim = mix(u.lantern, vec3(1.0, 0.9, 0.78).mul(swLuma(u.lantern).mul(1.25)), look.lampWhite)
            .mul(look.lampGain);
        lit.addAssign(albedo.mul(lampOnHim).mul(facingLantern.mul(0.85).add(0.15))
            .div(dLantern.mul(dLantern).mul(1.6).add(1.0)).mul(u.lanternAt.w)
            .mul(u.breath)
            .mul(2.2));
        // The moon and the mist find his outline: a shaggy edge of light; his lantern warms the near side.
        // (Rims come from his outline, not from the strands' relief.)
        const edge = float(1.0).sub(abs(dot(N0, V)));
        const e3 = edge.mul(edge).mul(edge);
        const toMoon = max(dot(N, u.moonDir).mul(0.5).add(0.5), 0.0);
        lit.addAssign(u.moonLight.mul(e3).mul(toMoon).mul(0.8).mul(hair.mul(0.6).add(0.4))
            .mul(u.breath.mul(0.5).add(0.5)));
        // Wet moss catches the moon a little; his eyes catch it and his lantern as two small lights.
        const R = V.sub(N.mul(dot(V, N).mul(2.0)));
        const glint = max(dot(R, u.moonDir), 0.0).pow(14.0).mul(strand.mul(0.6).add(0.4)).mul(hair);
        lit.addAssign(u.moonLight.mul(glint).mul(0.12).mul(u.breath.mul(0.5).add(0.5)));
        const toLamp = u.lanternAt.xyz.sub(P);
        const lampD = length(toLamp);
        const lampDir = toLamp.div(max(lampD, 1e-3));
        const catchLight = max(dot(R, lampDir), 0.0).pow(40.0).mul(u.lanternAt.w).mul(1.6)
            .add(max(dot(R, u.moonDir), 0.0).pow(30.0).mul(0.5));
        lit.addAssign(mix(u.moonLight, u.lantern, 0.6).mul(catchLight).mul(eye));
        const lampRim = e3.mul(max(dot(N0, lampDir), 0.0)).div(lampD.mul(lampD).mul(0.4).add(1.0));
        lit.addAssign(lampOnHim.mul(lampRim).mul(u.lanternAt.w).mul(albedo.mul(1.5).add(0.25)));
        // The mushrooms in his moss glow the colour of the ones on the banks, faint at rest and
        // waking with the chain as theirs do.
        const wake = u.caps.y.mul(0.85).add(0.15);
        lit.addAssign(mix(u.crest, u.firefly, 0.3).mul(cap).mul(wake).mul(look.fungus)
            .mul(u.breath)
            .mul(1.6));
        return vec4(swFog(u, lit, P), 1.0);
    })();

    // ── The staff ──
    const staffMaterial = new THREE.MeshBasicNodeMaterial();
    staffMaterial.name = 'StillwaterStaff';
    staffMaterial.fog = false;
    staffMaterial.toneMapped = false;
    staffMaterial.fragmentNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(normalWorld);
        const G = positionGeometry;
        const grain = u.noise(vec2(G.y.mul(3.0), G.x.add(G.z).mul(40.0))).r;
        const wood = u.bark.mul(grain.mul(0.5).add(0.65)).add(vec3(0.02, 0.014, 0.008));
        return vec4(swFog(u, swLight(u, wood, N, P, { wrap: 0.6, local: 0.8 }), P), 1.0);
    })();
    const staffGeometry = createStaffGeometry();
    const staff = new THREE.Mesh(staffGeometry, staffMaterial);
    staff.frustumCulled = false;
    staff.renderOrder = 11;
    walkSpace.add(staff);

    // ── The lantern: a little cage of horn panes with a flame in it, hung by its bail ──
    const lantern = new THREE.Group();
    lantern.name = 'StillwaterLantern';
    const cageGeometry = new THREE.CylinderGeometry(0.075, 0.09, 0.22, 6, 1, true);
    cageGeometry.translate(0, -0.15, 0);
    const capGeometry = new THREE.ConeGeometry(0.1, 0.08, 6, 1, false);
    capGeometry.translate(0, -0.0, 0);
    const cageMaterial = new THREE.MeshBasicNodeMaterial();
    cageMaterial.name = 'StillwaterLanternCage';
    cageMaterial.side = THREE.DoubleSide;
    cageMaterial.fog = false;
    cageMaterial.toneMapped = false;
    cageMaterial.fragmentNode = Fn(() => {
        const st = uv();
        // Horn panes between dark bars: the flame shows through, warmest at its height.
        const bars = smoothstep(0.42, 0.5, abs(fract(st.x.mul(6.0)).sub(0.5)));
        const pane = u.lantern.mul(exp(abs(st.y.sub(0.45)).mul(-3.5))).mul(u.lanternAt.w.mul(2.6).add(0.2));
        return vec4(mix(pane, vec3(0.012, 0.01, 0.008), bars).mul(u.breath.mul(0.7).add(0.3)), 1.0);
    })();
    const capMaterial = new THREE.MeshBasicNodeMaterial();
    capMaterial.name = 'StillwaterLanternCap';
    capMaterial.fog = false;
    capMaterial.toneMapped = false;
    capMaterial.fragmentNode = Fn(() => {
        const P = positionWorld;
        return vec4(swFog(u, swLight(u, vec3(0.03, 0.026, 0.022), normalize(normalWorld), P, { local: 0.3 }), P), 1.0);
    })();
    const cage = new THREE.Mesh(cageGeometry, cageMaterial);
    const cap = new THREE.Mesh(capGeometry, capMaterial);
    cage.frustumCulled = false;
    cap.frustumCulled = false;
    lantern.add(cage, cap);
    const flameGeometry = new THREE.PlaneGeometry(1, 1);
    const flameMaterial = new THREE.MeshBasicNodeMaterial();
    flameMaterial.name = 'StillwaterLanternGlow';
    flameMaterial.transparent = true;
    flameMaterial.blending = THREE.AdditiveBlending;
    flameMaterial.premultipliedAlpha = true;
    flameMaterial.depthWrite = false;
    flameMaterial.fog = false;
    flameMaterial.toneMapped = false;
    flameMaterial.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    flameMaterial.vertexNode = Fn(() => {
        const view = cameraViewMatrix.mul(vec4(u.lanternAt.xyz, 1.0));
        // (Small: the bloom carries the glow out; a big sprite would wash out his face.)
        const size = float(0.85).add(u.lanternAt.w.mul(0.45));
        const q = positionGeometry.xy.mul(size);
        return cameraProjectionMatrix.mul(vec4(view.x.add(q.x), view.y.add(q.y), view.z, 1.0));
    })();
    flameMaterial.outputNode = Fn(() => {
        const d = length(uv().sub(0.5).mul(2.0));
        const fade = float(1.0).sub(smoothstep(0.7, 1.0, d));
        // The flame never burns quite evenly.
        const flicker = sin(u.time.mul(13.0)).mul(0.04).add(sin(u.time.mul(5.1).add(1.7)).mul(0.07)).add(1.0);
        const light = exp(d.mul(-4.0)).mul(0.45).add(exp(d.mul(d).mul(-40.0)).mul(1.8)).mul(fade);
        return vec4(u.lantern.mul(light).mul(u.lanternAt.w).mul(flicker).mul(u.breath)
            .mul(1.2), 0.0);
    })();
    const flame = new THREE.Mesh(flameGeometry, flameMaterial);
    flame.frustumCulled = false;
    flame.renderOrder = 65;
    walkSpace.add(lantern);
    // The cord it hangs by (a hair of bark-dark line from the crook to the bail).
    const cordGeometry = new THREE.CylinderGeometry(0.007, 0.007, 1, 4, 1, true);
    const cord = new THREE.Mesh(cordGeometry, capMaterial);
    cord.frustumCulled = false;
    walkSpace.add(cord);
    // (The glow is a camera-facing sprite placed by the uniform: it lives outside the swinging cage.)
    walkSpace.add(flame);

    const part = swPart('StillwaterTroll', null, material, 11, { mesh: group });
    part.figure = figure;
    part.ready = false;
    part.failed = false;
    part.lod = lod;
    part.body = null;
    part.uCloak = uCloak;
    /** Colour him one of TROLL_LOOKS (by name). */
    part.setLook = (name) => {
        const preset = TROLL_LOOKS[name] || TROLL_LOOKS[DEFAULT_LOOK];
        ['skin', 'bare', 'hide', 'mossLo', 'mossHi'].forEach((key) => {
            const [r, g, b] = preset[key];
            look[key].value.setRGB(r, g, b);
        });
        look.hour.value = preset.hour;
        look.lampWhite.value = preset.lampWhite;
        look.lampGain.value = preset.lampGain ?? 1;
        look.fungus.value = preset.fungus;
        part.look = name in TROLL_LOOKS ? name : DEFAULT_LOOK;
    };
    part.setLook(opts.look || DEFAULT_LOOK);
    let squeeze = 1;
    let built = null;
    let disposed = false;
    const cloak = new Spring3();
    const lastVel = new THREE.Vector3();
    const flameAt = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    const bx = new THREE.Vector3();
    const by = new THREE.Vector3();
    const bz = new THREE.Vector3();
    const pending = {
        x: TROLL.home[0], z: TROLL.home[2], heading: -1.48, opts: { seated: true, seat: TROLL.seat },
    };

    /** Fetch the sculpt. Resolves true when he stands in the scene, false when he could not be had. */
    part.load = async (loader = new GLTFLoader()) => {
        try {
            const gltf = await loader.loadAsync(TROLL_URLS[lod]);
            if (disposed) return false;
            built = buildFigure(gltf, material);
            built.mesh.renderOrder = 11;
            built.mesh.layers.mask = group.layers.mask;
            scaled.position.y = -built.extras.sole * TROLL.height;
            scaled.add(built.mesh);
            part.body = new TrollBody(restFromSpec(built.extras), {
                sole: built.extras.sole,
                height: TROLL.height,
                ground,
                parents: parentsFromSpec(built.extras),
            });
            part.body.reset(pending.x, pending.z, pending.heading, pending.opts);
            part.ready = true;
            return true;
        } catch (error) {
            part.failed = true;
            console.warn('[Stillwater] The troll could not be loaded; the lantern stands without him.', error);
            return false;
        }
    };

    /** Stand him somewhere at rest (walk frame), seated or standing. */
    part.reset = (x, z, heading, opts2 = {}) => {
        pending.x = x;
        pending.z = z;
        pending.heading = heading;
        pending.opts = opts2;
        cloak.set(0, 0, 0);
        lastVel.set(0, 0, 0);
        part.body?.reset(x, z, heading, opts2);
    };

    /**
     * Move him on by `dt` toward what he means to do (see TrollBody.update). Returns his footfalls
     * and the staff's (walk frame) for the water to answer.
     */
    part.update = (dt, want, time) => {
        const { body } = part;
        if (!body) {
            // Without the sculpt the lantern still stands where his staff would be.
            lantern.position.set(TROLL.home[0] - 0.4, TROLL.home[1] + 2.2, TROLL.home[2] + 0.3);
            flameAt.set(lantern.position.x, lantern.position.y - 0.15, lantern.position.z);
            staff.visible = false;
            return [];
        }
        staff.visible = true;
        body.update(dt, want, time);
        body.applyTo(built.bones);
        figure.position.copy(body.root);
        turn.rotation.set(0, body.heading, 0);
        // The cloak swings after him: it lags his velocity's changes and settles back.
        if (dt > 0) {
            const ax = (body.velocity.x - lastVel.x) / dt;
            const az = (body.velocity.z - lastVel.z) / dt;
            lastVel.copy(body.velocity);
            tmp.set(-body.velocity.x * 0.012 - ax * 0.01, 0, -body.velocity.z * 0.012 - az * 0.01)
                .applyAxisAngle(by.set(0, 1, 0), -body.heading);
            cloak.step(tmp.x, 0, tmp.z, 0.22, dt);
            uCloak.value.set(cloak.x[0], 0, cloak.x[2]);
        }
        // The staff: its foot, its line, and the crook turned the way he faces.
        const st = body.staff;
        if (st.foot) {
            by.copy(st.dirN);
            bz.set(Math.sin(body.heading), 0, Math.cos(body.heading)).addScaledVector(by, -by.z * Math.cos(body.heading)
                - by.x * Math.sin(body.heading));
            if (bz.lengthSq() < 1e-6) bz.set(0, 0, 1);
            bz.normalize();
            bx.crossVectors(by, bz).normalize();
            bz.crossVectors(bx, by);
            basis.makeBasis(bx, by, bz);
            staff.quaternion.setFromRotationMatrix(basis);
            staff.position.copy(st.foot);
        }
        // The lantern hangs from the hook on its cord: its bail at the cord's end, the cage below.
        tmp.copy(body.hookAt).sub(body.lanternAt);
        const drop = Math.max(1e-3, tmp.length());
        tmp.divideScalar(drop);
        lantern.position.copy(body.lanternAt);
        lantern.quaternion.setFromUnitVectors(by.set(0, 1, 0), tmp);
        flameAt.copy(lantern.position).addScaledVector(tmp, -0.15);
        cord.position.copy(body.lanternAt).addScaledVector(tmp, drop * 0.5);
        cord.quaternion.copy(lantern.quaternion);
        cord.scale.set(1, drop, 1);
        return body.events;
    };

    /** He keeps his width when the stage is drawn in (and walks in true metres). */
    part.setSqueeze = (s) => {
        squeeze = Math.max(0.2, s);
        walkSpace.scale.set(1 / squeeze, 1, 1);
    };
    /** The lantern's flame in world space. */
    part.lanternWorld = (out) => {
        walkSpace.updateWorldMatrix(true, false);
        tmp.copy(flameAt).applyMatrix4(walkSpace.matrixWorld);
        out[0] = tmp.x;
        out[1] = tmp.y;
        out[2] = tmp.z;
        return out;
    };
    part.dispose = () => {
        disposed = true;
        if (built) {
            built.mesh.geometry.dispose();
            built.mesh.skeleton?.dispose?.();
        }
        staffGeometry.dispose();
        staffMaterial.dispose();
        cageGeometry.dispose();
        cordGeometry.dispose();
        capGeometry.dispose();
        cageMaterial.dispose();
        capMaterial.dispose();
        flameGeometry.dispose();
        flameMaterial.dispose();
        material.dispose();
    };
    return part;
}
