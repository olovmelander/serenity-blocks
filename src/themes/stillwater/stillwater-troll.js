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
    normalGeometry,
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
    pow2,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import trollLod0Url from './assets/troll-lod0.glb?url';
import trollLod1Url from './assets/troll-lod1.glb?url';
import trollLod2Url from './assets/troll-lod2.glb?url';
import trollLod3Url from './assets/troll-lod3.glb?url';
import {
    TROLL, swFog, swLight, swLuma, swPart,
} from './stillwater-tsl.js';
import { buildFigure } from './stillwater-rig.js';
import {
    STAFF, TrollBody, parentsFromSpec, restFromSpec, tailsFromSpec,
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

/** Metres of the staff's radius where his hand slides on it (his fist closes on so much: the
 * sculpt's grip, troll_shape.py `STAFF_R`), and the stretch of it his hand may hold (metres from
 * its foot: the planned grip, slid down or up as far as FIST_HOLD lets it). */
export const STAFF_GRIP = Object.freeze({ radius: 0.046, from: 0.24, to: 1.5 });

const smooth01 = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/**
 * The staff in its own frame: y from its foot up, the crook bending toward +z at the top. An old
 * branch: a knob of root for its foot, its grain twisting round it in flutes (gentle where his hand
 * slides, so his fist closes on it), knots above his reach, a few twigs broken off short, and the
 * crook its top bends into, thinning to its end. The uv runs along it (x: 0 at the foot, 1 at the
 * crook's end) and round it (y), the twigs too.
 */
export function createStaffGeometry(long = STAFF.length) {
    const pts = [
        [0, 0, 0], [0.018, long * 0.22, 0.008], [-0.014, long * 0.45, -0.006], [0.012, long * 0.68, 0.01],
        [-0.006, long * 0.9, 0.0], [0, long * 0.975, 0.045], [0, long * 1.0, 0.12], [0, long * 0.985, 0.19],
        [0, long * 0.955, 0.215],
    ].map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const SEG = 120;
    const RAD = 10;
    const tube = new THREE.TubeGeometry(curve, SEG, 1, RAD, false);
    const pos = tube.attributes.position;
    const centre = new THREE.Vector3();
    const p = new THREE.Vector3();
    const bump = (s, at, width, height) => height * Math.exp(-(((s - at) / width) ** 2));
    const g = STAFF_GRIP;
    for (let i = 0; i < pos.count; i++) {
        const t = Math.floor(i / (RAD + 1)) / SEG;
        const phi = ((i % (RAD + 1)) / RAD) * Math.PI * 2;
        const s = t * long;
        curve.getPointAt(t, centre);
        p.fromBufferAttribute(pos, i).sub(centre);
        let r = g.radius + 0.002 - 0.007 * t;
        r *= 1 - 0.18 * smooth01(0.84, 0.94, t) - 0.3 * smooth01(0.94, 1, t);
        r += bump(s, 0, 0.08, 0.022) + bump(s, 0.11, 0.035, 0.005);
        r += bump(s, 1.68, 0.05, 0.012) + bump(s, 1.98, 0.04, 0.009) + bump(s, 2.2, 0.035, 0.006);
        const hand = smooth01(g.from - 0.06, g.from + 0.04, s) * (1 - smooth01(g.to - 0.04, g.to + 0.08, s));
        const flute = 0.075 * Math.sin(3 * phi + s * 2.4) + 0.04 * Math.sin(5 * phi - s * 4.1 + 1.3);
        r *= 1 + flute * (1 - 0.65 * hand);
        p.multiplyScalar(r);
        pos.setXYZ(i, centre.x + p.x, centre.y + p.y, centre.z + p.z);
    }
    tube.computeVertexNormals();
    // Twigs broken off short, angled up out of it (above his reach: his hand never meets them).
    const parts = [tube];
    const tangent = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    [[1.62, [1, 0, 0.2], 0.1, 0.016], [1.88, [-0.8, 0, 0.5], 0.13, 0.017], [2.08, [0.3, 0, -1], 0.07, 0.013],
        [2.28, [0.9, 0, -0.3], 0.06, 0.011]].forEach(([s, out, len, radius]) => {
        const t = s / long;
        curve.getPointAt(t, centre);
        curve.getTangentAt(t, tangent);
        dir.set(out[0], out[1], out[2]).normalize().multiplyScalar(0.75).addScaledVector(tangent, 0.65)
            .normalize();
        const twig = new THREE.CylinderGeometry(radius * 0.45, radius, len, 6, 2, false);
        twig.translate(0, len * 0.5, 0);
        // (Along it as the staff's uv runs: x by height, y round.)
        const uvs = twig.attributes.uv;
        for (let i = 0; i < uvs.count; i++) {
            const around = uvs.getX(i);
            uvs.setXY(i, t + uvs.getY(i) * (len / long), around);
        }
        q.setFromUnitVectors(yAxis, dir);
        twig.applyQuaternion(q);
        twig.translate(centre.x - dir.x * 0.02, centre.y - dir.y * 0.02, centre.z - dir.z * 0.02);
        parts.push(twig);
    });
    const geometry = mergeGeometries(parts, false);
    parts.forEach((part) => part.dispose());
    return geometry;
}

/**
 * The lantern's frame (its own frame: hung from y = 0, the cage below): a foot of dark iron, six
 * posts up the corners of its horn panes, a band round their top, the cap, a knob on it and the
 * bail it hangs by.
 */
export function createLanternFrameGeometry() {
    const parts = [];
    const foot = new THREE.CylinderGeometry(0.1, 0.094, 0.032, 6, 1, false);
    foot.translate(0, -0.272, 0);
    parts.push(foot);
    const band = new THREE.CylinderGeometry(0.084, 0.084, 0.02, 6, 1, false);
    band.translate(0, -0.046, 0);
    parts.push(band);
    const cap = new THREE.ConeGeometry(0.1, 0.08, 6, 1, false);
    parts.push(cap);
    const knob = new THREE.SphereGeometry(0.018, 6, 4);
    knob.translate(0, 0.046, 0);
    parts.push(knob);
    const bail = new THREE.TorusGeometry(0.032, 0.0055, 4, 12, Math.PI);
    bail.translate(0, 0.04, 0);
    parts.push(bail);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const d = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2;
        a.set(Math.sin(ang) * 0.092, -0.26, Math.cos(ang) * 0.092);
        b.set(Math.sin(ang) * 0.077, -0.04, Math.cos(ang) * 0.077);
        const len = d.copy(b).sub(a).length();
        const post = new THREE.CylinderGeometry(0.0075, 0.0075, len, 4, 1, false);
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        post.applyQuaternion(q);
        post.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        parts.push(post);
    }
    const nonIndexed = parts.map((part) => {
        const flat = part.index ? part.toNonIndexed() : part;
        flat.deleteAttribute('uv');
        return flat;
    });
    const geometry = mergeGeometries(nonIndexed, false);
    parts.forEach((part) => part.dispose());
    nonIndexed.forEach((part) => part.dispose());
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
    // (His hide's grain is laid on his rest pose, so it stays on his skin however he moves.)
    const vRest = varying(positionGeometry, 'vTrollRest');
    const vRestN = varying(normalGeometry, 'vTrollRestN');
    // (The way his hair runs at each vertex, root to tip, on his rest pose: the file's `_FLOW`.)
    const vFlow = varying(attribute('flow', 'vec3'), 'vTrollFlow');
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
        // What he is (the file's colour: skin 1 his ruddy face and ears, 0.65 his hide, 0.2 an eye;
        // moss, with its lock's shade in `kind` (0..0.6), and skin 0.18 on moss his beard-lichen;
        // kind 0.7 an eye, 1 a mushroom; nothing = leather: his loincloth, his nails, twigs in his hair).
        const notHair = float(1.0).sub(hair);
        const fleshy = smoothstep(0.3, 0.55, skin);
        const rosy = smoothstep(0.75, 0.95, skin);
        const lichen = smoothstep(0.08, 0.15, skin).mul(float(1.0).sub(smoothstep(0.24, 0.3, skin))).mul(hair)
            .toVar();
        const eye = smoothstep(0.1, 0.16, skin).mul(float(1.0).sub(smoothstep(0.24, 0.3, skin)))
            .mul(smoothstep(0.55, 0.65, kind)).mul(notHair);
        const cap = smoothstep(0.85, 0.95, kind).mul(notHair).mul(float(1.0).sub(fleshy));
        // Strands along each lock, the way it runs (the file's flow), at two sizes and in relief: the
        // locks themselves are the shape; the strands are laid on his rest pose, so they stay on
        // the hair however he moves (a surface-gradient bump from the screen derivatives of their height).
        const fl = normalize(vFlow);
        const across = normalize(cross(fl, normalize(vRestN)).add(vec3(1e-4, 0.0, 0.0)));
        const sAcross = dot(vRest, across);
        const sAlong = dot(vRest, fl);
        const strandA = u.noise(vec2(sAcross.mul(58.0), sAlong.mul(4.0))).g;
        const strandB = u.noise(vec2(sAcross.mul(170.0), sAlong.mul(9.0)).add(0.31)).b;
        const strand = strandA.mul(0.6).add(strandB.mul(0.4)).toVar();
        // His hide (face, hands, limbs): old troll skin, read off his rest pose three ways at once.
        const flesh01 = fleshy.mul(notHair).mul(float(1.0).sub(eye)).toVar();
        const R0 = vRest;
        const nR = abs(normalize(vRestN));
        const wR = nR.mul(nR).mul(nR.mul(nR)).toVar();
        wR.divAssign(wR.x.add(wR.y).add(wR.z).add(1e-4));
        const tri = (k) => u.noise(R0.zy.mul(k)).mul(wR.x)
            .add(u.noise(R0.xz.mul(k).add(0.37)).mul(wR.y))
            .add(u.noise(R0.xy.mul(k).add(0.71)).mul(wR.z));
        const coarse = tri(4.0).toVar();
        const mid = tri(9.5).toVar();
        const fine = tri(23.0).toVar();
        // Metres a pixel spans on him: each grain of his skin gives way as he grows small in the frame.
        // In play he is about 1.4 cm a pixel: the lumps and the folds of his old skin carry there; the
        // creases and pores come in as he comes nearer (never as speckle).
        const pxm = length(P.sub(cameraPosition)).mul(u.pixelAngle);
        const lumpsOn = float(1.0).sub(smoothstep(0.02, 0.05, pxm));
        const foldsOn = float(1.0).sub(smoothstep(0.009, 0.024, pxm));
        const creasesOn = float(1.0).sub(smoothstep(0.004, 0.011, pxm));
        // Lumps and warts, big and soft; folds of old skin, a net of them; fine creases, pores, grain.
        const lumps = smoothstep(0.45, 0.85, coarse.b).mul(lumpsOn);
        const fold = smoothstep(0.8, 0.97, float(1.0).sub(abs(mid.g.mul(2.0).sub(1.0)))).mul(foldsOn).toVar();
        const crease = smoothstep(0.86, 0.98, float(1.0).sub(abs(fine.g.mul(2.0).sub(1.0)))).mul(creasesOn).toVar();
        const pores = smoothstep(0.72, 0.9, fine.b).mul(creasesOn);
        const grain = fine.r.sub(0.5).mul(creasesOn);
        const hideHeight = lumps.mul(0.016).sub(fold.mul(0.005)).sub(crease.mul(0.003)).sub(pores.mul(0.0009))
            .add(grain.mul(0.0012))
            .mul(flesh01);
        // (Lichen is stringier than moss: finer strands, less relief.)
        const height = strand.mul(hair).mul(float(0.007).sub(lichen.mul(0.003))).add(hideHeight);
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
        // A few of his locks are old moss gone russet; the rest green, darker deep in the mane and
        // paler and yellower where they are outermost and lit; the strands light and dark.
        const russet = smoothstep(0.8, 0.9, fract(kind.mul(13.7)));
        const mossCol = mix(mossLo, mossHi, shadeOfLock);
        const outer = smoothstep(0.55, 0.95, ao).mul(upward.mul(0.6).add(0.4));
        const greenMoss = mix(mossCol, mossCol.mul(vec3(1.25, 1.15, 0.7)), outer.mul(0.6));
        const pelt = mix(greenMoss, mossCol.mul(vec3(1.4, 0.78, 0.42)), russet.mul(0.85))
            .mul(strand.mul(0.5).add(0.72));
        // His beard is beard-lichen: pale grey-green strings, darker within.
        const lichenCol = mix(vec3(0.07, 0.083, 0.062), vec3(0.2, 0.225, 0.165), strand.mul(0.7).add(outer.mul(0.3)));
        const hairCol = mix(pelt, mix(lichenCol, u.stone.mul(1.6), hour.mul(0.35)), lichen);
        const leather = mix(look.hide, u.stone, hour.mul(0.6));
        // His skin is not one colour: olive and lichen-grey blotches over its earth at two sizes,
        // darker spots of age, the folds and creases dark and stained green with moss, the lumps a
        // shade paler, lichen grown in pale specks on his shoulders, and the ends of him flushed like
        // his face (his hands hang at his sides in his rest pose, his feet are lowest).
        const ends = smoothstep(0.24, 0.3, abs(R0.x)).mul(smoothstep(-0.02, -0.16, R0.y))
            .add(smoothstep(-0.41, -0.46, R0.y))
            .min(1.0);
        const flush = max(rosy, ends.mul(0.55));
        const ruddy = mix(look.bare, look.skin, flush);
        const blotch = smoothstep(0.45, 0.72, coarse.r).mul(0.75);
        const blotch2 = smoothstep(0.5, 0.78, mid.r).mul(0.55).mul(foldsOn.mul(0.6).add(0.4));
        const spots = smoothstep(0.62, 0.86, coarse.a).mul(0.15)
            .add(smoothstep(0.76, 0.9, mid.a).mul(0.1).mul(foldsOn));
        const olive = mix(ruddy, ruddy.mul(vec3(0.78, 0.93, 0.66)), blotch);
        const grey = mix(olive, olive.mul(vec3(0.86, 0.9, 0.94)).add(0.008), blotch2);
        const stained = mix(grey, grey.mul(vec3(0.55, 0.64, 0.46)), fold.mul(0.5).add(crease.mul(0.35)).min(1.0));
        const speck = smoothstep(0.82, 0.9, mid.b).mul(smoothstep(-0.02, 0.1, R0.y)).mul(upward).mul(0.85);
        const mottled = mix(
            stained.mul(float(1.0).sub(spots)).mul(lumps.mul(0.12).add(1.0)),
            vec3(0.3, 0.33, 0.26),
            speck.mul(float(1.0).sub(rosy)),
        );
        const flesh = mix(mottled, u.stone.mul(1.3), hour.mul(0.6));
        const body = mix(mix(leather, hairCol, hair), flesh, fleshy.mul(notHair));
        // Dark wet eyes; pale mushroom caps.
        const withParts = mix(mix(body, vec3(0.012, 0.009, 0.007), eye), vec3(0.42, 0.4, 0.33), cap);
        // (His occlusion was baked with his arms hanging against his hips: on his arms it is let
        // off lightly, or the hip's shadow would ride up with an arm he lifts.)
        const limb = smoothstep(0.19, 0.25, abs(R0.x)).mul(smoothstep(-0.34, -0.28, R0.y)).mul(flesh01);
        // (Deep in his mane the occlusion is let off a little too: each lock darkened all round where it
        // meets the next reads as a separate tube, not as hair.)
        const shut = mix(mix(ao, max(ao, 0.82), limb), ao.mul(0.55).add(0.4), hair.mul(0.6));
        const albedo = withParts.mul(shut.mul(0.85).add(0.15));
        // (Moss and leather take the light softly; his skin takes it with less wrap, so the moon
        // models his face, his arms and his belly instead of lighting them all alike.)
        const soft = swLight(u, albedo, N, P, { wrap: 0.6, local: look.lampGain.mul(0.25) });
        const firm = swLight(u, albedo, N, P, { wrap: 0.3, local: look.lampGain.mul(0.25) });
        const lit = mix(soft, firm, flesh01).toVar();
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
        // His skin is not clay. Light goes a little way into it and comes out warm along the edge of
        // the lit side, and glows red through what is thin (his ears, his nose) when the lantern is
        // behind it; and it is damp, with a soft sheen, most on his nose and brow, none in a crease.
        const lampFall = float(1.0).div(lampD.mul(lampD).mul(1.6).add(1.0)).mul(u.lanternAt.w).mul(u.breath);
        const lampFacing = dot(N, lampDir);
        const band = smoothstep(-0.45, 0.05, lampFacing).mul(float(1.0).sub(smoothstep(0.05, 0.6, lampFacing)));
        const through = max(dot(V, lampDir), 0.0).pow(3.0).mul(rosy.add(ends.mul(0.5)));
        const warm = vec3(1.0, 0.32, 0.16);
        lit.addAssign(lampOnHim.mul(warm).mul(albedo).mul(band.mul(0.35).add(through.mul(1.4)))
            .mul(lampFall)
            .mul(flesh01)
            .mul(2.2));
        const moonFacing = dot(N, u.moonDir);
        const moonBand = smoothstep(-0.4, 0.0, moonFacing).mul(float(1.0).sub(smoothstep(0.0, 0.5, moonFacing)));
        lit.addAssign(u.moonLight.mul(vec3(0.9, 0.5, 0.45)).mul(albedo).mul(moonBand).mul(0.2)
            .mul(flesh01)
            .mul(u.breath.mul(0.5).add(0.5)));
        const toEye = V.negate();
        const fres = float(1.0).sub(clamp(dot(N, toEye), 0.0, 1.0)).pow(5.0).mul(0.6)
            .add(0.08);
        const damp = rosy.mul(0.65).add(0.35).mul(float(1.0).sub(crease)).mul(fine.a.mul(0.4).add(0.6));
        const sheenLamp = max(dot(N, normalize(lampDir.add(toEye))), 0.0).pow(28.0).mul(lampFall).mul(1.2);
        const sheenMoon = max(dot(N, normalize(u.moonDir.add(toEye))), 0.0).pow(20.0).mul(0.25)
            .mul(u.breath.mul(0.5).add(0.5));
        lit.addAssign(lampOnHim.mul(sheenLamp).add(u.moonLight.mul(sheenMoon)).mul(fres).mul(damp)
            .mul(flesh01));
        // Moss is velvet: it gathers light along its edges, softly, and his beard-lichen glows where
        // his lantern or the moon is behind it (light goes through thin strings).
        const fuzz = pow2(float(1.0).sub(abs(dot(N0, V)))).mul(hair)
            .mul(float(1.0).sub(lichen.mul(0.7)));
        lit.addAssign(mix(u.moonLight, lampOnHim, 0.35).mul(albedo).mul(fuzz).mul(0.5)
            .mul(u.breath.mul(0.5).add(0.5)));
        const lampBehind = max(dot(V, lampDir), 0.0).pow(2.5);
        const moonBehind = max(dot(V, u.moonDir), 0.0).pow(4.0);
        lit.addAssign(lampOnHim.mul(lampBehind).mul(lampFall).mul(1.2).add(u.moonLight.mul(moonBehind).mul(0.3))
            .mul(lichenCol)
            .mul(lichen));
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
        const st = uv();
        const along = st.x.mul(STAFF.length);
        // Bark: fissures down it, winding a little with its grain, pale ridges between them and a
        // finer grain; worn smooth and dark where his hand slides; moss about its foot. (Round it
        // by whole turns of the noise, so its seam does not show.)
        const fis = u.noise(vec2(st.y.mul(4.0).add(along.mul(0.38)), along.mul(0.9))).toVar();
        const fissure = smoothstep(0.62, 0.8, float(1.0).sub(abs(fis.g.mul(2.0).sub(1.0))));
        const grain = u.noise(vec2(st.y.mul(9.0).add(along.mul(0.8)), along.mul(5.0))).r;
        const worn = smoothstep(STAFF_GRIP.from - 0.04, STAFF_GRIP.from + 0.12, along)
            .mul(float(1.0).sub(smoothstep(STAFF_GRIP.to - 0.12, STAFF_GRIP.to + 0.06, along)));
        const bark = u.bark.mul(grain.mul(0.45).add(0.7)).add(vec3(0.02, 0.014, 0.008));
        const ridged = mix(bark.mul(1.3), bark.mul(0.35), fissure.mul(float(1.0).sub(worn.mul(0.75))));
        const handled = mix(ridged, ridged.mul(vec3(1.15, 0.9, 0.72)).mul(0.85), worn.mul(0.8));
        const mossy = float(1.0).sub(smoothstep(0.06, 0.34, along)).mul(smoothstep(0.42, 0.6, fis.b));
        const wood = mix(handled, vec3(0.03, 0.07, 0.022), mossy);
        // Handled wood shines a little in his lantern's light.
        const V = normalize(P.sub(cameraPosition));
        const toLamp = normalize(u.lanternAt.xyz.sub(P));
        const R = V.sub(N.mul(dot(V, N).mul(2.0)));
        const gloss = max(dot(R, toLamp), 0.0).pow(18.0).mul(worn).mul(u.lanternAt.w)
            .mul(0.35);
        const lit = swLight(u, wood, N, P, { wrap: 0.6, local: 0.8 }).add(u.lantern.mul(gloss).mul(u.breath));
        return vec4(swFog(u, lit, P), 1.0);
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
    const capGeometry = createLanternFrameGeometry();
    const cageMaterial = new THREE.MeshBasicNodeMaterial();
    cageMaterial.name = 'StillwaterLanternCage';
    cageMaterial.side = THREE.DoubleSide;
    cageMaterial.fog = false;
    cageMaterial.toneMapped = false;
    cageMaterial.fragmentNode = Fn(() => {
        const st = uv();
        // Horn panes (the posts of the frame stand at their corners): the flame shows through,
        // warmest at its height, the horn clouded unevenly and sooted toward the top.
        const bars = smoothstep(0.44, 0.5, abs(fract(st.x.mul(6.0)).sub(0.5)));
        const horn = u.noise(vec2(st.x.mul(2.0), st.y.mul(0.6).add(0.37))).r.mul(0.6).add(0.7);
        const soot = smoothstep(0.6, 1.0, st.y).mul(0.55);
        const pane = u.lantern.mul(exp(abs(st.y.sub(0.42)).mul(-3.5))).mul(u.lanternAt.w.mul(2.6).add(0.2))
            .mul(horn)
            .mul(float(1.0).sub(soot));
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
                tails: tailsFromSpec(built.extras),
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
