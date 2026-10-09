/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater — the two who meet at the tarn.
 *
 * The spirit: a pale figure built here from a few curves — a long gown, long hair down her back,
 * arms folded before her — who holds a light of her own. She stands on her stone at the left
 * bank and looks down into the water; a chain of clears draws her out over it.
 *
 * The troll: the theme's own sculpt (assets/troll-lod*.glb: a hunched, shaggy troll with a walk
 * cycle), shaded here as part of the place: stone and lichen for hair, moss on his back, his
 * nose and hands warm in the light of the lantern he carries on a staff. A chain brings him down
 * from his seat by the great spruce to the water's edge.
 *
 * Both are hung in the stage group; on a narrow frame (the stage drawn in) each is widened by
 * the same factor, so neither is squeezed.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    min,
    mix,
    normalWorld,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    uniform,
    uv,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import trollLod0Url from './assets/troll-lod0.glb?url';
import trollLod1Url from './assets/troll-lod1.glb?url';
import trollLod2Url from './assets/troll-lod2.glb?url';
import trollLod3Url from './assets/troll-lod3.glb?url';
import {
    SPIRIT, TROLL, swFog, swLight, swLuma, swPart,
} from './stillwater-tsl.js';

const TROLL_URLS = [trollLod0Url, trollLod1Url, trollLod2Url, trollLod3Url];

// ── The spirit ──────────────────────────────────────────────────────────────────

/** The gown's outline, hem to crown: [height, radius] for a figure one unit tall. */
const GOWN = [
    [0.0, 0.215], [0.07, 0.2], [0.26, 0.145], [0.46, 0.105], [0.58, 0.08], [0.655, 0.085], [0.745, 0.1],
    [0.805, 0.092], [0.832, 0.04], [0.855, 0.034], [0.872, 0.052], [0.905, 0.064], [0.945, 0.06], [0.98, 0.036],
    [1.0, 0.0],
];

/**
 * The spirit as one mesh (a figure one unit tall, facing +z). Attribute aBody = (what it is:
 * 0 gown, 1 hair, 2 head and hands; how freely it moves 0..1).
 */
export function createSpiritGeometry() {
    const positions = [];
    const body = [];
    const index = [];
    const lathe = (profile, sides, radiusAt, kind, freeAt, a0 = 0, a1 = Math.PI * 2) => {
        const base = positions.length / 3;
        const closed = a1 - a0 >= Math.PI * 2 - 1e-6;
        const cols = closed ? sides : sides + 1;
        for (let k = 0; k < profile.length; k++) {
            const [y, r] = profile[k];
            for (let a = 0; a < cols; a++) {
                // Anticlockwise seen from above, starting at the front (+z).
                const an = a0 + (a / sides) * (a1 - a0);
                const rr = radiusAt(r, y, an);
                positions.push(Math.sin(an) * rr, y, Math.cos(an) * rr * 0.8);
                body.push(kind, freeAt(y));
            }
        }
        for (let k = 0; k < profile.length - 1; k++) {
            for (let a = 0; a < (closed ? sides : sides); a++) {
                const b = closed ? (a + 1) % sides : a + 1;
                const i0 = base + k * cols + a;
                const i1 = base + k * cols + b;
                const i2 = base + (k + 1) * cols + a;
                const i3 = base + (k + 1) * cols + b;
                index.push(i0, i1, i2, i1, i3, i2);
            }
        }
    };
    // The gown: folds that deepen toward the hem.
    lathe(GOWN, 40, (r, y, an) => {
        const hem = Math.max(0, 1 - y / 0.5);
        // (Few enough folds for the ring to draw each one round: a fold cut by too few sides is a facet.)
        return r * (1 + 0.12 * hem * Math.cos(an * 5 + 0.6) + 0.05 * hem * Math.cos(an * 3));
    }, 0, (y) => Math.max(0, 1 - y / 0.62) ** 1.5);
    // Head and neck are part of the same outline: mark them by height.
    for (let i = 0; i < body.length; i += 2) {
        const y = positions[(i / 2) * 3 + 1];
        if (y > 0.84) body[i] = 2;
    }
    // Her hair: a mantle over the back of the head and down her back to the knee.
    const HAIR = [
        [0.985, 0.03], [0.965, 0.062], [0.92, 0.074], [0.87, 0.07], [0.82, 0.085], [0.74, 0.115], [0.62, 0.118],
        [0.5, 0.125], [0.4, 0.14], [0.31, 0.15],
    ];
    lathe(
        [...HAIR].reverse(),
        22,
        (r, y, an) => r * (1 + 0.05 * Math.cos(an * 6 + y * 14)),
        1,
        (y) => Math.max(0, 1 - (y - 0.3) / 0.6) ** 1.3 * 0.9,
        Math.PI * 0.52,
        Math.PI * 1.48,
    );
    // Her arms, folded before her.
    const arm = (side) => {
        const from = [side * 0.092, 0.78, 0.0];
        const elbow = [side * 0.105, 0.63, 0.03];
        const hand = [side * 0.018, 0.585, 0.082];
        const base = positions.length / 3;
        const sides = 10;
        const rings = 6;
        for (let k = 0; k <= rings; k++) {
            const t = k / rings;
            const a = t < 0.5 ? t * 2 : (t - 0.5) * 2;
            const p0 = t < 0.5 ? from : elbow;
            const p1 = t < 0.5 ? elbow : hand;
            const c = [p0[0] + (p1[0] - p0[0]) * a, p0[1] + (p1[1] - p0[1]) * a, p0[2] + (p1[2] - p0[2]) * a];
            const r = 0.03 - t * 0.012;
            for (let s = 0; s < sides; s++) {
                const an = (s / sides) * Math.PI * 2;
                positions.push(c[0] + Math.sin(an) * r, c[1] + Math.cos(an) * r * 0.6, c[2] + Math.cos(an) * r);
                body.push(t > 0.86 ? 2 : 0, 0);
            }
        }
        for (let k = 0; k < rings; k++) {
            for (let s = 0; s < sides; s++) {
                const b = (s + 1) % sides;
                const i0 = base + k * sides + s;
                const i1 = base + k * sides + b;
                const i2 = base + (k + 1) * sides + s;
                const i3 = base + (k + 1) * sides + b;
                // (The rings run the other way round the arm than round the gown.)
                index.push(i0, i2, i1, i1, i2, i3);
            }
        }
    };
    arm(-1);
    arm(1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('aBody', new THREE.BufferAttribute(new Float32Array(body), 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
}

/**
 * @param {object} u
 * @returns the part; `place({ x, y, z, facing, lean })` stands her somewhere (stage space),
 *   `heartWorld(out)` gives her heart in world space.
 */
export function createSpirit(u) {
    const group = new THREE.Group();
    group.name = 'StillwaterSpirit';
    /** Where she stands (and her width on a narrow frame); `turn` is which way she faces. */
    const figure = new THREE.Group();
    const turn = new THREE.Group();
    figure.add(turn);
    group.add(figure);
    /** How she is moving (stage space, m/s): her gown and her hair trail behind. */
    const uTrail = uniform(new THREE.Vector3(0, 0, 0));
    /** 0..1: how much her light has been fed (a clear's wisps going home), on top of her own. */
    const uFed = uniform(0);

    const geometry = createSpiritGeometry();
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StillwaterSpirit';
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.toneMapped = false;
    const aBody = attribute('aBody', 'vec2');
    const vKind = varying(aBody.x, 'vSpiritKind');
    const vUp = varying(positionGeometry.y, 'vSpiritUp');
    material.positionNode = Fn(() => {
        const free = aBody.y;
        const { y } = positionGeometry;
        // What hangs free breathes with the air and trails behind her as she moves.
        const stir = vec3(
            sin(u.sway.mul(1.4).add(y.mul(9.0))).mul(0.012),
            0.0,
            sin(u.sway.mul(1.1).add(y.mul(7.0)).add(1.3)).mul(0.016),
        );
        return positionLocal.add(stir.mul(free)).sub(uTrail.mul(free).mul(0.085));
    })();
    material.fragmentNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(normalWorld).toVar();
        const V = normalize(P.sub(cameraPosition));
        const facing = abs(dot(N, V));
        const edge = float(1.0).sub(facing);
        const isHair = smoothstep(0.5, 0.9, vKind).mul(float(1.0).sub(smoothstep(1.1, 1.5, vKind)));
        const isSkin = smoothstep(1.5, 1.9, vKind);
        // White linen, gold hair; she is lit from within, brightest at the breast, and her
        // edges take the light the way thin cloth does.
        const linen = u.spirit;
        const gold = u.heart.mul(0.85).add(u.spirit.mul(0.15));
        const cloth = mix(mix(linen, gold, isHair), u.spirit.mul(vec3(1.0, 0.94, 0.86)), isSkin);
        const power = u.spiritAt.w.add(uFed.mul(0.6));
        const within = exp(abs(vUp.sub(0.72)).mul(-2.6)).mul(0.55).add(0.3);
        // A thin circlet of gold on her brow.
        const circlet = smoothstep(0.957, 0.963, vUp).mul(float(1.0).sub(smoothstep(0.971, 0.977, vUp)))
            .mul(float(1.0).sub(isHair));
        const glow = cloth.mul(within.add(edge.mul(edge).mul(0.7))).mul(power).mul(1.25)
            .add(u.heart.mul(circlet).mul(power).mul(2.2));
        const moon = swLight(u, cloth.mul(0.5), N, P, { wrap: 0.7, shade: float(1.0) });
        // Her hem is lost in the mist that lies on the water.
        const hem = smoothstep(0.0, 0.16, vUp);
        const col = glow.mul(u.breath.mul(0.6).add(0.4)).add(moon).mul(hem.mul(0.75).add(0.25));
        return vec4(swFog(u, col, P), 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(SPIRIT.height);
    mesh.frustumCulled = false;
    turn.add(mesh);

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
        const size = float(4.2).add(uFed.mul(1.6));
        const q = positionGeometry.xy.mul(size);
        return cameraProjectionMatrix.mul(vec4(view.x.add(q.x), view.y.add(q.y.mul(1.25)), view.z, 1.0));
    })();
    haloMaterial.outputNode = Fn(() => {
        const d = length(uv().sub(0.5).mul(2.0));
        const fade = float(1.0).sub(smoothstep(0.7, 1.0, d));
        const light = exp(d.mul(-4.2)).mul(0.5).add(exp(d.mul(d).mul(-30.0)).mul(0.25)).mul(fade);
        return vec4(u.spirit.mul(light).mul(u.spiritAt.w.add(uFed.mul(0.8))).mul(u.breath).mul(0.55), 0.0);
    })();
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    halo.frustumCulled = false;
    halo.renderOrder = 64;
    group.add(halo);

    const part = swPart('StillwaterSpirit', geometry, material, 12, { mesh: group });
    part.uTrail = uTrail;
    part.uFed = uFed;
    part.figure = figure;
    const heart = new THREE.Vector3();
    /** Stand her at a stage point, turned to `facing` (radians about the vertical, 0 = toward +z). */
    part.place = ({
        x, y, z, facing = 0, lean = 0,
    }) => {
        figure.position.set(x, y, z);
        turn.rotation.set(lean, facing, 0, 'YXZ');
    };
    /** She keeps her width when the stage is drawn in. */
    part.setSqueeze = (squeeze) => {
        figure.scale.set(1 / Math.max(0.2, squeeze), 1, 1);
    };
    /** Her heart in world space. */
    part.heartWorld = (out) => {
        figure.updateWorldMatrix(true, false);
        heart.set(0, SPIRIT.height * 0.7, 0).applyMatrix4(figure.matrixWorld);
        out[0] = heart.x;
        out[1] = heart.y;
        out[2] = heart.z;
        return out;
    };
    part.dispose = () => {
        haloGeometry.dispose();
        haloMaterial.dispose();
    };
    part.place({ x: SPIRIT.home[0], y: SPIRIT.home[1], z: SPIRIT.home[2] });
    return part;
}

// ── The troll ───────────────────────────────────────────────────────────────────

/** The sculpt stands one unit tall about its own middle; this is its sole. */
const TROLL_SOLE = -0.5;
/** Seconds of the walk cycle (two steps). */
const WALK_CYCLE = 1.2;

/**
 * @param {object} u
 * @param {object} [opts]
 * @param {number} [opts.lod=1]  which of the four meshes (0 = the finest)
 * @returns the part; `load()` fetches the sculpt, `place(...)` stands him somewhere,
 *   `lanternWorld(out)` gives the lantern's flame in world space.
 */
export function createTroll(u, opts = {}) {
    const lod = Math.max(0, Math.min(3, Math.round(opts.lod ?? 1)));
    const group = new THREE.Group();
    group.name = 'StillwaterTroll';
    /** Where he stands (and his width on a narrow frame); `turn` is which way he faces. */
    const figure = new THREE.Group();
    const turn = new THREE.Group();
    figure.add(turn);
    group.add(figure);
    /** Scaled and lifted so his soles are on the ground at the figure's origin. */
    const scaled = new THREE.Group();
    scaled.scale.setScalar(TROLL.height);
    scaled.position.y = -TROLL_SOLE * TROLL.height;
    turn.add(scaled);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StillwaterTroll';
    material.fog = false;
    material.toneMapped = false;
    material.fragmentNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(normalWorld).toVar();
        const V = normalize(P.sub(cameraPosition));
        const paint = max(attribute('color', 'vec3'), vec3(0.0)).toVar();
        const value = swLuma(paint);
        const chroma = max(paint.r, max(paint.g, paint.b)).sub(min(paint.r, min(paint.g, paint.b)));
        // The sculpt's own paint says what is what: his pelt is black and white, his skin has colour.
        const skin = smoothstep(0.1, 0.26, chroma);
        const mossTop = smoothstep(0.15, 0.7, N.y).mul(float(1.0).sub(skin));
        const pelt = mix(u.bark.mul(0.5), u.stone.mul(1.35), smoothstep(0.08, 0.7, value));
        const hide = mix(pelt, u.moss.mul(1.05), mossTop.mul(0.7));
        const flesh = paint.mul(vec3(0.5, 0.44, 0.4)).mul(0.8).add(u.stone.mul(0.2));
        const albedo = mix(hide, flesh, skin);
        const lit = swLight(u, albedo, N, P, { wrap: 0.55, local: 0.42 }).toVar();
        // The moon and the mist find his outline: a shaggy edge of light.
        const edge = float(1.0).sub(abs(dot(N, V)));
        const e2 = edge.mul(edge);
        const toMoon = max(dot(N, u.moonDir).mul(0.5).add(0.5), 0.0);
        lit.addAssign(u.moonLight.mul(e2.mul(edge)).mul(toMoon).mul(0.22).mul(u.breath.mul(0.5).add(0.5)));
        return vec4(swFog(u, lit, P), 1.0);
    })();

    // The staff and its lantern: carried at his shoulder, the lantern hung out ahead of him.
    const staffMaterial = new THREE.MeshBasicNodeMaterial();
    staffMaterial.name = 'StillwaterStaff';
    staffMaterial.fog = false;
    staffMaterial.toneMapped = false;
    staffMaterial.fragmentNode = Fn(() => {
        const P = positionWorld;
        return vec4(swFog(u, swLight(u, u.bark.mul(0.8), normalize(normalWorld), P, { wrap: 0.6 }), P), 1.0);
    })();
    const staffGeometry = new THREE.CylinderGeometry(0.014, 0.02, 1, 6);
    staffGeometry.translate(0, 0.5, 0);
    const staff = new THREE.Mesh(staffGeometry, staffMaterial);
    staff.frustumCulled = false;
    /** Model space (the sculpt's unit frame): where the staff is held, and where its tip is. */
    const STAFF_FOOT = new THREE.Vector3(0.2, -0.3, 0.06);
    const STAFF_TIP = new THREE.Vector3(0.36, 0.5, 0.74);
    const staffAnchor = new THREE.Group();
    staffAnchor.position.copy(STAFF_FOOT);
    staffAnchor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), STAFF_TIP.clone().sub(STAFF_FOOT).normalize());
    staff.scale.set(1, STAFF_TIP.distanceTo(STAFF_FOOT), 1);
    staffAnchor.add(staff);
    const tip = new THREE.Object3D();
    tip.position.set(0, STAFF_TIP.distanceTo(STAFF_FOOT), 0);
    staffAnchor.add(tip);
    scaled.add(staffAnchor);

    // The lantern: a little cage with a flame in it, hung from the tip; its light is the
    // shared `lanternAt` uniform, so the bank, the troll and the water all take it.
    const lantern = new THREE.Group();
    lantern.name = 'StillwaterLantern';
    const cageGeometry = new THREE.CylinderGeometry(0.075, 0.09, 0.2, 6, 1, true);
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
    const cage = new THREE.Mesh(cageGeometry, cageMaterial);
    cage.frustumCulled = false;
    lantern.add(cage);
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
        const size = float(1.9).add(u.lanternAt.w.mul(1.1));
        const q = positionGeometry.xy.mul(size);
        return cameraProjectionMatrix.mul(vec4(view.x.add(q.x), view.y.add(q.y), view.z, 1.0));
    })();
    flameMaterial.outputNode = Fn(() => {
        const d = length(uv().sub(0.5).mul(2.0));
        const fade = float(1.0).sub(smoothstep(0.7, 1.0, d));
        // The flame never burns quite evenly.
        const flicker = sin(u.time.mul(13.0)).mul(0.04).add(sin(u.time.mul(5.1).add(1.7)).mul(0.07)).add(1.0);
        const light = exp(d.mul(-5.0)).mul(0.6).add(exp(d.mul(d).mul(-90.0)).mul(2.4)).mul(fade);
        return vec4(u.lantern.mul(light).mul(u.lanternAt.w).mul(flicker).mul(u.breath)
            .mul(1.2), 0.0);
    })();
    const flame = new THREE.Mesh(flameGeometry, flameMaterial);
    flame.frustumCulled = false;
    flame.renderOrder = 65;
    lantern.add(flame);
    group.add(lantern);

    const part = swPart('StillwaterTroll', null, material, 11, { mesh: group });
    part.figure = figure;
    part.ready = false;
    part.failed = false;
    part.lod = lod;
    let mixer = null;
    let action = null;
    let bones = null;
    let model = null;
    /** The spine's and the head's own turns in the walk: played here, so a look can be laid over them. */
    const own = {};
    const rest = {};
    const restX = staffAnchor.rotation.x;
    const tipWorld = new THREE.Vector3();
    const walkQ = new THREE.Quaternion();
    const lookQ = new THREE.Quaternion();
    const lookE = new THREE.Euler();
    let disposed = false;

    /** Fetch the sculpt. Resolves true when he stands in the scene, false when he could not be had. */
    part.load = async (loader = new GLTFLoader()) => {
        try {
            const gltf = await loader.loadAsync(TROLL_URLS[lod]);
            if (disposed) return false;
            model = gltf.scene;
            const found = {};
            model.traverse((o) => {
                if (o.isMesh) {
                    o.material = material;
                    o.frustumCulled = false;
                    o.renderOrder = 11;
                    o.layers.mask = group.layers.mask;
                    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
                }
                if (o.isBone) found[o.name] = o;
            });
            bones = found;
            ['spine', 'head'].forEach((name) => {
                if (found[name]) rest[name] = found[name].quaternion.clone();
            });
            if (gltf.animations.length) {
                const clip = gltf.animations[0];
                clip.tracks = clip.tracks.filter((track) => {
                    const cut = track.name.lastIndexOf('.');
                    const name = track.name.slice(0, cut);
                    if (rest[name] && track.name.slice(cut + 1) === 'quaternion') {
                        own[name] = track.createInterpolant();
                        return false;
                    }
                    return true;
                });
                mixer = new THREE.AnimationMixer(model);
                action = mixer.clipAction(clip);
                action.play();
                mixer.setTime(0);
            }
            scaled.add(model);
            part.ready = true;
            return true;
        } catch (error) {
            part.failed = true;
            console.warn('[Stillwater] The troll could not be loaded; the lantern stands without him.', error);
            return false;
        }
    };

    /**
     * Stand him at a stage point.
     * @param {object} p
     * @param {number} p.x @param {number} p.y @param {number} p.z
     * @param {number} p.facing   radians about the vertical (0 = toward +z)
     * @param {number} p.stride   how far he has walked, in cycles (its fraction is the pose)
     * @param {number} p.moving   0..1: how much of the walk shows (0 = standing)
     * @param {number} p.time     the world clock (he breathes)
     * @param {number} p.look     radians: how far his head is turned
     * @param {number} p.lift     0..1: how high he holds the lantern
     */
    part.place = ({
        x, y, z, facing = 0, stride = 0, moving = 0, time = 0, look = 0, lift = 0,
    }) => {
        figure.position.set(x, y, z);
        turn.rotation.set(0, facing, 0);
        const phase = ((stride % 1) + 1) % 1;
        const walk = Math.max(0, Math.min(1, moving));
        if (mixer && action) {
            // He stands as he was sculpted; walking plays the cycle by the ground he has covered.
            action.setEffectiveWeight(walk);
            mixer.setTime(phase * WALK_CYCLE);
        }
        if (bones) {
            const turnBone = (name, rx, ry) => {
                const bone = bones[name];
                if (!bone || !rest[name]) return;
                bone.quaternion.copy(rest[name]);
                if (own[name] && walk > 0) {
                    walkQ.fromArray(own[name].evaluate(phase * WALK_CYCLE));
                    bone.quaternion.slerp(walkQ, walk);
                }
                bone.quaternion.multiply(lookQ.setFromEuler(lookE.set(rx, ry, 0)));
            };
            // He breathes; his head follows what he watches; holding the lantern out straightens him.
            turnBone('spine', Math.sin(time * 1.15) * 0.012 - lift * 0.08, 0);
            turnBone('head', Math.sin(time * 0.47) * 0.03 - lift * 0.12, look);
        }
        // The staff comes up as he holds the lantern out.
        staffAnchor.rotation.x = restX - lift * 0.32;
        // The lantern hangs from the tip and swings a little with his step.
        figure.updateWorldMatrix(true, true);
        tip.getWorldPosition(tipWorld);
        group.worldToLocal(tipWorld);
        const swing = Math.sin(stride * Math.PI * 2) * 0.05 * walk + Math.sin(time * 0.9) * 0.012;
        lantern.position.set(tipWorld.x + swing, tipWorld.y - 0.24, tipWorld.z);
    };
    /** He keeps his width when the stage is drawn in (and so does his lantern). */
    part.setSqueeze = (squeeze) => {
        figure.scale.set(1 / Math.max(0.2, squeeze), 1, 1);
        lantern.scale.set(1 / Math.max(0.2, squeeze), 1, 1);
    };
    /** The lantern's flame in world space. */
    part.lanternWorld = (out) => {
        lantern.updateWorldMatrix(true, false);
        tipWorld.setFromMatrixPosition(lantern.matrixWorld);
        out[0] = tipWorld.x;
        out[1] = tipWorld.y;
        out[2] = tipWorld.z;
        return out;
    };
    part.dispose = () => {
        disposed = true;
        mixer?.stopAllAction();
        if (model) {
            mixer?.uncacheRoot(model);
            model.traverse((o) => {
                if (o.isMesh) o.geometry.dispose();
                if (o.isSkinnedMesh) o.skeleton?.dispose?.();
            });
        }
        staffGeometry.dispose();
        staffMaterial.dispose();
        cageGeometry.dispose();
        cageMaterial.dispose();
        flameGeometry.dispose();
        flameMaterial.dispose();
        material.dispose();
    };
    part.place({ x: TROLL.home[0], y: TROLL.home[1], z: TROLL.home[2] });
    return part;
}
