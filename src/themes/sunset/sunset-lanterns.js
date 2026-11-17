/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sunset — what the lanterns are drawn with.
 *
 *   createLanterns   the lotus lanterns: one instanced mesh, modelled in Blender
 *                    (scripts/blender/sunset_lantern.py writes sunset-lantern-model.js): a paper
 *                    lotus afloat on a small dark disc with a lantern standing in it, a bud of
 *                    eight paper gores between bamboo ribs, open at the top, its flame low inside.
 *                    The CPU writes each one's place, lean and glow every frame
 *                    (sunset-lantern-pool.js).
 *   createGlows      one additive layer of soft lights that face the lens: each lantern's halo,
 *                    the lights in flight from the card, the drops of a splash. Each keeps a few
 *                    pixels across however far away it is, so a lantern over the horizon is still
 *                    a spark.
 *
 * The lantern's light. It is paper in the hour's light and a flame behind paper, both at once,
 * and the day turns in front of the player, so neither is ever switched off:
 *
 *   the hour     the sky the paper faces (`skyBase` by its normal, as the boat and the gulls take
 *                it, with a share of the hour's `ambient`), the sea's light from below, the sun or
 *                the moon on the faces turned to it, and that same light coming THROUGH the thin
 *                paper on the side turned away; the folds are darker by the occlusion Blender baked.
 *   the flame    the paper glows in the piece's colour, most where the flame stands low in the
 *                bud and less toward the crown; the flame itself shows through as a hot core that
 *                sits INSIDE the lantern (it is measured from the line of sight to the flame, so it
 *                moves behind the paper as the lantern turns and leans); the ribs are dark lines
 *                against it; through the open top the inner wall is seen lit. The petals take the
 *                flame's light on the faces turned to it, most at their base, and let a little
 *                through to their backs.
 *
 * How brightly the flame shows against the hour is taken from the hour's own `ambient` (the
 * brighter the day, the less of the picture a candle is): by night the lantern is its flame, at
 * noon it is coloured paper in the sun with a warm heart.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, dot, exp, faceDirection, float,
    length, max, mix, normalWorldGeometry, normalize, positionGeometry, positionWorld, pow, select, sin, smoothstep,
    step, uv, varying, vec3, vec4,
} from 'three/tsl';
import { SUNSET_LANTERN } from './sunset-lantern-model.js';
import { skyBase } from './sunset-tsl.js';
import { uploadUsed } from '../shared/instance-upload.js';

/**
 * The lantern's look, in one place.
 *
 * Per lantern, from its seed: `size` (how much larger or smaller), `squash` (taller and slimmer,
 * or squatter and wider), `lean` (a lean of its own on top of the swell's), and how pale its
 * paper is (`pale`: the share of white in it, the rest the piece's colour).
 */
export const LANTERN_LOOK = Object.freeze({
    size: 0.09,
    squash: 0.07,
    lean: 0.035,
    pale: Object.freeze([0.05, 0.17]),
    /** How much of the light that falls on it the paper gives back (white paper is not 1). */
    reflect: 0.84,
    /** A petal is paler than the lantern's paper (`petalPale` at its base), and paler again at its tip. */
    petalPale: 0.15,
    tipPale: 0.45,
    /** The wood of the float and the bamboo of the hoops (linear). */
    wood: Object.freeze([0.1, 0.064, 0.042]),
    /** The flame's own colour, mixed into the piece's (so a violet lantern is still candle-lit). */
    candle: Object.freeze([1.0, 0.72, 0.38]),
    candleShare: 0.07,
    /** Light that has come through tinted paper is deeper than the paper: the colour to this power. */
    deep: 1.2,
    /** The flame is never still: how far it wanders behind the paper (metres). */
    dance: 0.012,
    /** What the hottest paper pales toward. */
    hot: Object.freeze([1.0, 0.86, 0.62]),
    /**
     * The paper by its flame: `floor` everywhere, `heart` more where the flame stands (a bell
     * `heartWide` of the paper's height wide), `core` more on the line of sight to the flame (a
     * spot `coreWide` metres wide); `within` and `withinHeart` for the inner wall seen through
     * the open top. `gain` scales them all.
     */
    floor: 0.3,
    heart: 0.6,
    heartWide: 0.28,
    core: 2.0,
    coreWide: 0.07,
    within: 0.62,
    withinHeart: 1.3,
    gain: 1.3,
    /** A lit shell is deeper toward its outline, where the light crosses more paper. */
    limb: 0.66,
    /** The petals by the flame: their gain, how far its light reaches (metres), what comes through. */
    petal: 5.2,
    petalReach: 0.19,
    petalThrough: 0.34,
    /** The flame on the wood of the float and the hoops, and its light come back off the petals. */
    woodLit: 4.0,
    woodBounce: 2.2,
    /** A lit paper never burns past this (its hue kept): a soft knee from `knee` up to `ceiling`. */
    knee: 2.8,
    ceiling: 4.2,
    /** How much of the flame shows at the brightest hour (1 by night). */
    dayFlame: 0.34,
    /** The hour on the paper: the sky, the sea from below, the key, and the key through the paper. */
    sky: 1.25,
    sea: 0.7,
    seaSun: 0.2,
    key: 0.85,
    through: Object.freeze({ paper: 0.6, within: 0.6, petal: 0.5 }),
    /** The share of the light that has come through that reaches every side (the rest: the side turned away). */
    throughAll: 0.3,
    /** How dark a bamboo rib is against the paper, a petal's fold against the petal. */
    rib: 0.7,
    ribWide: 0.14,
    fold: 0.3,
    foldWide: 0.12,
    /** Half a gore, half a petal: about this many metres across (it sizes a pixel against a line). */
    lineSpan: 0.05,
    /** How much deeper a gore is at its ribs than at its middle, a petal at its fold than at its edge. */
    gore: 0.2,
    foldSoft: 0.12,
});

function decode(text, Type) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer);
}

let decoded = null;

/** The lantern as the bundle carries it (sunset-lantern-model.js), decoded once. */
export function lanternModel() {
    if (decoded) return decoded;
    const { quant } = SUNSET_LANTERN;
    decoded = Object.freeze({
        positions: Float32Array.from(decode(SUNSET_LANTERN.positions, Int16Array), (v) => v * quant),
        normals: Float32Array.from(decode(SUNSET_LANTERN.normals, Int8Array), (v) => v / 127),
        index: decode(SUNSET_LANTERN.index, Uint16Array),
        colours: decode(SUNSET_LANTERN.colours, Uint8Array),
        vertexCount: SUNSET_LANTERN.vertexCount,
        triangleCount: SUNSET_LANTERN.triangleCount,
        height: SUNSET_LANTERN.height,
        width: SUNSET_LANTERN.width,
        flame: SUNSET_LANTERN.flame,
        paper: SUNSET_LANTERN.paper,
    });
    return decoded;
}

/**
 * The lantern's mesh: positions, Blender's normals, and `color`, the four numbers the shader
 * lights it with (how far up, baked occlusion, the dark lines, the part: see the model's header).
 */
export function buildLanternGeometry() {
    const m = lanternModel();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(m.colours, 4, true));
    geometry.setIndex(new THREE.BufferAttribute(m.index, 1));
    geometry.computeBoundingSphere();
    return geometry;
}

const fract = (x) => x - Math.floor(x);

/**
 * What a lantern's seed makes of it: its size, how tall it stands for its width, its lean and
 * how pale its paper is. Pure: the same seed gives the same lantern.
 */
export function lanternVariety(seed, out = {}) {
    const L = LANTERN_LOOK;
    out.size = 1 + L.size * (fract(seed * 7.13 + 0.31) * 2 - 1);
    out.tall = 1 + L.squash * (fract(seed * 11.7 + 0.73) * 2 - 1);
    out.leanX = L.lean * (fract(seed * 17.3 + 0.11) * 2 - 1);
    out.leanZ = L.lean * (fract(seed * 23.9 + 0.57) * 2 - 1);
    out.pale = fract(seed * 5.41 + 0.19);
    return out;
}

export function createLanterns({ capacity, U }) {
    const geometry = buildLanternGeometry();
    const model = lanternModel();
    const lamp = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    lamp.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aLamp', lamp);
    // Where its flame burns (world) and how pale its paper is: the hot core is measured from the
    // line of sight to the flame, which the instanced vertex stage cannot work out for itself.
    const flame = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    flame.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aFlame', flame);

    const L = LANTERN_LOOK;
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    material.name = 'sunset-lanterns';
    const aLamp = attribute('aLamp', 'vec4');
    const aFlame = attribute('aFlame', 'vec4');
    const aTone = attribute('color', 'vec4');
    /** Where the flame stands, as a share of the paper's height. */
    const flameUp = (model.flame[1] - model.paper.mouth) / (model.paper.crown - model.paper.mouth);
    const rgb = (c) => vec3(c[0], c[1], c[2]);
    const max3 = (c) => max(c.x, max(c.y, c.z));
    // The flame wanders a little (worked out once a vertex: it is the same all over a lantern).
    const flameAt = varying(Fn(() => {
        const beat = aFlame.w.mul(40.0);
        return aFlame.xyz.add(vec3(
            sin(U.time.mul(6.3).add(beat)),
            sin(U.time.mul(9.1).add(beat.mul(1.7))).mul(1.4),
            sin(U.time.mul(5.2).add(beat.mul(0.6))),
        ).mul(L.dance));
    })(), 'vSunsetFlameAt');
    material.colorNode = Fn(() => {
        const { light } = U;
        // The mesh's four numbers (clamped: a varying strays outside its range on a thin edge).
        const tone = clamp(aTone, 0.0, 1.0).toVar();
        const up = tone.x;
        const open = tone.y;
        const line = tone.z;
        const wood = step(0.75, tone.w).toVar();
        const petal = step(0.25, tone.w).sub(wood).toVar();
        const colour = aLamp.xyz.toVar();
        const glow = aLamp.w;

        // The side the eye sees: a petal's back, the paper's inner wall through the open top.
        const facing = float(faceDirection).toVar();
        const inside = facing.mul(-0.5).add(0.5).toVar();
        const N = normalize(normalWorldGeometry).mul(facing).toVar();
        const toEye = cameraPosition.sub(positionWorld).toVar();
        const V = normalize(toEye).toVar();
        const toFlame = flameAt.sub(positionWorld).toVar();
        const far2 = dot(toFlame, toFlame).toVar();
        const toward = dot(N, toFlame.div(max(far2, 1e-6).sqrt())).toVar();

        // Its colours: the paper (the piece's colour with a share of white of its own), a petal
        // paler to its tip, the wood.
        const white = vec3(1.0, 0.95, 0.88).mul(L.reflect);
        const paper = mix(colour.mul(L.reflect), white, mix(L.pale[0], L.pale[1], clamp(aFlame.w, 0.0, 1.0))).toVar();
        const leaf = mix(paper, white, up.mul(up).mul(L.tipPale).add(L.petalPale));
        const albedo = mix(mix(paper, leaf, petal), rgb(L.wood), wood).toVar();
        // The dark lines, as wide as the mesh draws them or as a pixel is, whichever is wider
        // (a line thinner than a pixel is kept as a fainter one: it never crawls). A pixel's
        // width comes from how far away the lantern is: the line runs along a crest of `line`,
        // where a screen derivative is zero on one pixel and whole on the next (a dotted rib).
        const pixel = length(toEye).mul(U.pixelAngle).mul(1.5 / L.lineSpan);
        const drawnWide = mix(float(L.ribWide), float(L.foldWide), petal);
        const wide = max(pixel, drawnWide).toVar();
        const drawn = smoothstep(float(1.0).sub(wide), 1.0, line).mul(drawnWide.div(wide));
        // A gore is deeper toward its ribs (the paper doubles at the seam), a petal toward its fold.
        const soft = line.mul(line).mul(mix(float(L.gore), float(L.foldSoft), petal));
        const lines = float(1.0).sub(drawn.mul(mix(float(L.rib), float(L.fold), petal)).add(soft).mul(wood.oneMinus()))
            .toVar();

        // ── The hour's light on it ──
        const key = normalize(mix(U.sun, U.moon, U.moonKey)).toVar();
        const keyUp = mix(U.sunUp, U.moonUp, U.moonKey).toVar();
        const sky = mix(skyBase(normalize(vec3(N.x, max(N.y, 0.0).add(0.25), N.z)), U), light.ambient, 0.3).mul(L.sky);
        const sea = skyBase(normalize(vec3(N.x, 0.12, N.z)), U).mul(L.sea).add(light.cloudLit.mul(keyUp).mul(L.seaSun));
        // The folds: the baked occlusion on the side it was baked for; inside the bud the sky
        // comes in at the open top only.
        const fold = mix(
            float(0.22).add(open.mul(0.78)),
            mix(float(0.2).add(up.mul(up).mul(0.5)), float(0.85), petal),
            inside,
        );
        const ambient = mix(sea, sky, N.y.mul(0.5).add(0.5)).mul(fold);
        const sunOn = dot(N, key).toVar();
        // Thin paper lets the light through, deeper in colour for the paper it has crossed: the
        // side turned from the sun glows (a share of it everywhere: what comes through one wall
        // of the bud lights the whole of its inside).
        const thin = mix(mix(float(L.through.paper), float(L.through.within), inside), float(L.through.petal), petal)
            .mul(wood.oneMinus());
        const through = max(sunOn.negate(), 0.0).mul(1.0 - L.throughAll).add(L.throughAll).mul(thin);
        const direct = light.cloudLit.mul(keyUp).mul(L.key).mul(
            vec3(max(sunOn, 0.0).mul(mix(float(1.0), open, 0.5)))
                .add(mix(albedo, vec3(1.0), 0.5).mul(through)),
        );
        const day = albedo.mul(ambient.add(direct)).mul(lines);

        // ── The flame ──
        // How much of it shows against the hour: all of it by night, a warm heart at noon.
        const daylight = smoothstep(0.12, 0.92, dot(light.ambient, vec3(0.2126, 0.7152, 0.0722)));
        const burn = glow.mul(mix(float(1.0), float(L.dayFlame), daylight)).toVar();
        const candle = mix(pow(max(colour, vec3(0.0)), vec3(L.deep)), rgb(L.candle), L.candleShare).toVar();
        // The paper: lit most where the flame stands, and the flame itself a hot core behind it,
        // found from how near the line of sight passes it.
        const along = dot(toFlame, V);
        const off2 = max(far2.sub(along.mul(along)), 0.0);
        const core = exp(off2.mul(-0.5 / (L.coreWide * L.coreWide))).toVar();
        const rise = up.sub(flameUp).div(L.heartWide);
        const heart = exp(rise.mul(rise).negate()).toVar();
        const limb = mix(float(L.limb), float(1.0), clamp(dot(N, V), 0.0, 1.0));
        const shell = mix(
            float(L.floor).add(heart.mul(L.heart)).mul(limb).add(core.mul(L.core)),
            float(L.within).add(heart.mul(L.withinHeart)),
            inside,
        ).mul(L.gain);
        const paperGlow = mix(candle, rgb(L.hot), clamp(core.mul(0.45).add(inside.mul(0.25)), 0.0, 1.0)).mul(shell);
        // The petals: the flame's light on the faces turned to it, most at their base, a little
        // of it through to their backs.
        const reach = float(1.0).div(far2.div(L.petalReach * L.petalReach).add(1.0)).toVar();
        const caught = max(toward, 0.0).add(max(toward.negate(), 0.0).mul(L.petalThrough))
            .mul(reach).mul(float(1.0).sub(up.mul(0.6)));
        const petalGlow = candle.mul(mix(leaf, white, 0.4)).mul(caught.mul(L.petal));
        const woodGlow = candle.mul(rgb(L.wood)).mul(max(toward, 0.0).mul(L.woodLit).add(L.woodBounce).mul(reach));
        const lit = mix(mix(paperGlow, petalGlow, petal), woodGlow, wood).mul(lines).mul(burn).toVar();
        // A flare (a lantern lighting, a fever of play) must not burn the paper to white.
        const peak = max(max3(lit), 1e-4).toVar();
        const span = L.ceiling - L.knee;
        const kept = select(
            peak.greaterThan(L.knee),
            float(L.knee).add(float(span).mul(float(1.0).sub(exp(peak.sub(L.knee).div(-span))))),
            peak,
        );
        return vec4(day.add(lit.mul(kept.div(peak))), 1.0);
    })();

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = 'sunset-lanterns';
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const f = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    const spin = new THREE.Quaternion();
    const variety = {};
    return {
        mesh,
        /** Start writing a frame's lanterns. */
        begin() {
            mesh.count = 0;
        },
        /** One lantern: its foot, the slope it leans on, its scale, colour, glow and seed. */
        push(x, y, z, tiltX, tiltZ, scale, rgbOf, glow, seed) {
            const i = mesh.count;
            if (i >= capacity) return;
            // No two are quite alike: the seed gives each its size, its build, a lean and a paper.
            lanternVariety(seed, variety);
            n.set(-tiltX + variety.leanX, 1, -tiltZ + variety.leanZ).normalize();
            q.setFromUnitVectors(UP, n);
            spin.setFromAxisAngle(UP, seed * Math.PI * 2);
            q.multiply(spin);
            p.set(x, y, z);
            const size = scale * variety.size;
            const wide = size / Math.sqrt(variety.tall);
            s.set(wide, size * variety.tall, wide);
            m.compose(p, q, s);
            mesh.setMatrixAt(i, m);
            lamp.setXYZW(i, rgbOf[0], rgbOf[1], rgbOf[2], glow);
            f.set(model.flame[0], model.flame[1], model.flame[2]).applyMatrix4(m);
            flame.setXYZW(i, f.x, f.y, f.z, variety.pale);
            mesh.count = i + 1;
        },
        end() {
            // Only this frame's lanterns go up: the pool past them is not drawn.
            uploadUsed([mesh.instanceMatrix], mesh.count * 16);
            uploadUsed([lamp, flame], mesh.count * 4);
        },
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}

/**
 * The soft lights: `capacity` quads that face the lens, written every frame.
 * Each: centre (world), radius (metres; never less than `minPixels` pixels), colour × intensity,
 * and a shape (0 a round glow with a hot core, 1 a soft disc only).
 */
export function createGlows({ capacity, U, minPixels = 3 }) {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    const b = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    a.setUsage(THREE.DynamicDrawUsage);
    b.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aGlowA', a);
    geometry.setAttribute('aGlowB', b);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        fog: false,
    });
    material.name = 'sunset-glows';
    const A = attribute('aGlowA', 'vec4');
    const B = attribute('aGlowB', 'vec4');
    material.vertexNode = Fn(() => {
        const view = cameraViewMatrix.mul(vec4(A.xyz, 1.0)).toVar();
        const depth = max(view.z.negate(), 0.01);
        const radius = max(A.w, depth.mul(U.pixelAngle).mul(minPixels));
        const at = view.xyz.add(vec3(positionGeometry.xy.mul(radius), 0.0));
        return cameraProjectionMatrix.mul(vec4(at, 1.0));
    })();
    const shapeOf = Fn(() => {
        const d = uv().sub(0.5).mul(2.0);
        const r2 = d.dot(d);
        const halo = exp(r2.mul(-4.5));
        const core = exp(r2.mul(-60.0)).mul(2.2);
        const rim = float(1.0).sub(smoothstep(0.55, 1.0, r2));
        const glow = mix(halo.add(core), halo.mul(rim), B.w.greaterThan(0.5).select(1.0, 0.0));
        return B.xyz.mul(glow);
    });
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = vec4(shapeOf(), 0.0);

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = 'sunset-glows';
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 60;
    return {
        mesh,
        get count() {
            return mesh.count;
        },
        begin() {
            mesh.count = 0;
        },
        push(x, y, z, radius, r, g, bl, shape = 0) {
            const i = mesh.count;
            if (i >= capacity) return;
            a.setXYZW(i, x, y, z, radius);
            b.setXYZW(i, r, g, bl, shape);
            mesh.count = i + 1;
        },
        end() {
            // Only this frame's lights go up: the pool past them is not drawn.
            uploadUsed([a, b], mesh.count * 4);
        },
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
