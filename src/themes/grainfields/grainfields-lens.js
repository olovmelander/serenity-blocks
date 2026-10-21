/**
 * Grainfields — the ears by the lens.
 *
 * The eye stands low in the stand, and a few ears of it stand nearer than the lens can focus: they
 * rise into the bottom corners of the frame soft and out of focus, swaying with the wind. They
 * frame the picture (the board stands between them) and say where the eye is: in the barley, not
 * over it.
 *
 * Each ear is placed in the camera's own frame (a point on the screen and a depth), so every lens
 * and every aspect keeps it in its corner, and the lens's shift (portrait) is allowed for. One
 * instanced ear: a stem up from below the frame, the spindle and its brush of awns, a ribbon turned
 * to the eye and widened by its circle of confusion; its outline is blurred by that circle, so the
 * spindle is a soft gold shape in a haze of awns, a little see-through. Lit as the stand is: the sun
 * through the deck at the eye, the sky's fill, the field's bounce, and with the sun ahead the light
 * through the awns (a blurred blaze is a glow, which the bloom carries).
 *
 * Normal blending, no depth write, drawn last: nothing in the world stands nearer.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    cos,
    cross,
    dot,
    float,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    pow,
    select,
    sin,
    smoothstep,
    uniform,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import { deckShadow } from './grainfields-tsl.js';
import { SOIL } from './grainfields-land.js';
import { BLAZE_CAP, EAR_SHAPE } from './grainfields-grain.js';

/**
 * The ears: where each one's head stands on the screen (x, y in −1..1 from the bottom-left), how
 * far from the eye (metres), which way its stem leans (+ right), its size, and its seed.
 * Two clusters, one in each bottom corner, nearest lowest.
 */
export const LENS_EARS = Object.freeze([
    Object.freeze({
        x: -0.95, y: -0.72, depth: 0.95, lean: 0.22, size: 1.0, seed: 0.13,
    }),
    Object.freeze({
        x: -0.86, y: -0.92, depth: 0.8, lean: 0.12, size: 1.06, seed: 0.57,
    }),
    Object.freeze({
        x: -0.76, y: -0.8, depth: 1.35, lean: -0.08, size: 0.94, seed: 0.81,
    }),
    Object.freeze({
        x: 0.94, y: -0.76, depth: 0.92, lean: -0.26, size: 1.04, seed: 0.33,
    }),
    Object.freeze({
        x: 0.84, y: -0.94, depth: 0.78, lean: -0.1, size: 1.0, seed: 0.69,
    }),
    Object.freeze({
        x: 0.7, y: -0.79, depth: 1.4, lean: 0.14, size: 0.9, seed: 0.92,
    }),
]);

/**
 * The defocus: an ear at depth d is blurred by an angle of `coc / d` (a lens focused far out sees
 * a near point as a disc of about the aperture's own size): `coc` metres, so the blur's width at the
 * ear itself is constant. `opacity` how much of what lies behind a blurred ear it hides; `light`
 * how much of the stand's own light reaches an ear this low and this near (the stand shades it,
 * and a darker foreground frames the field rather than glaring in front of it).
 */
export const LENS_BLUR = Object.freeze({ coc: 0.0042, opacity: 0.94, light: 0.32 });

/** How long the stem runs down from the head (metres): out under the frame's bottom edge. */
const STEM = 0.62;
const STEM_ROWS = 8;
const EAR_ROWS = 14;

/** The template: per ear a stem strip (z 0) and an ear strip (z 1); x along (0..1), y across (−1..1). */
function lensTemplate() {
    const position = [];
    const index = [];
    const strip = (part, rows) => {
        const base = position.length / 3;
        for (let r = 0; r <= rows; r++) position.push(r / rows, -1, part, r / rows, 1, part);
        for (let r = 0; r < rows; r++) {
            const a = base + r * 2;
            index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
    };
    strip(0, STEM_ROWS);
    strip(1, EAR_ROWS);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setIndex(index);
    return geometry;
}

const CORE_SHARE = 1 / (1 + EAR_SHAPE.reach);

/** The spindle's outline along the ear (0..1 of its half-width; 0 past its tip). */
const spindle = (a) => {
    const k = clamp(a.div(CORE_SHARE), 0.0, 1.0);
    return pow(sin(k.mul(3.1416)).max(0.001), 0.5).mul(smoothstep(CORE_SHARE + 0.02, CORE_SHARE - 0.02, a));
};

export function createLensEars(u, t, { count = LENS_EARS.length } = {}) {
    const ears = LENS_EARS.slice(0, Math.max(0, Math.min(LENS_EARS.length, count)));
    const geometry = lensTemplate();
    const placeData = new Float32Array(Math.max(1, ears.length) * 4);
    const lookData = new Float32Array(Math.max(1, ears.length) * 4);
    ears.forEach((ear, i) => {
        placeData.set([ear.x, ear.y, ear.depth, ear.lean], i * 4);
        lookData.set([ear.size, ear.seed, 0, 0], i * 4);
    });
    geometry.setAttribute('iPlace', new THREE.InstancedBufferAttribute(placeData, 4));
    geometry.setAttribute('iLook', new THREE.InstancedBufferAttribute(lookData, 4));
    geometry.instanceCount = ears.length;

    /** The lens's vertical shift (NDC; the portrait rig moves the image up by it). */
    const shift = uniform(0);
    /** 0 still (reduced motion) … 1 the wind's own sway. */
    const swayGain = uniform(1);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GrainfieldsLensEars';
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.side = THREE.DoubleSide;
    material.fog = false;
    const iPlace = attribute('iPlace', 'vec4');
    const iLook = attribute('iLook', 'vec4');
    const vInfo = varying(vec4(0.0), 'gfLensInfo'); // part, s, w, the drawn half-width (m)
    const vEdge = varying(vec4(0.0), 'gfLensEdge'); // the true half-width (m), blur (m), seed, size
    const vLight = varying(vec4(0.0), 'gfLensLight'); // sunlit, the view toward the sun, unused
    material.positionNode = Fn(() => {
        const s = positionGeometry.x;
        const w = positionGeometry.y;
        const isEar = positionGeometry.z.greaterThan(0.5);
        const depth = iPlace.z;
        const size = iLook.x;
        const seed = iLook.y;
        // The head's place in the camera's frame (the screen point at its depth; the shift undone).
        const tanV = u.tanHalfFov;
        const head0 = u.eye.add(u.camFwd.mul(depth))
            .add(u.camRight.mul(iPlace.x.mul(tanV).mul(u.aspect).mul(depth)))
            .add(u.camUp.mul(iPlace.y.sub(shift).mul(tanV).mul(depth)));
        // The wind sways the head over its stem (more on a long stem, its own phase).
        const gust = u.windStrength.add(0.2).mul(swayGain);
        const sway = sin(u.time.mul(1.25).add(seed.mul(17.0))).mul(0.6)
            .add(sin(u.time.mul(2.7).add(seed.mul(41.0))).mul(0.25))
            .add(sin(u.time.mul(0.45).add(seed.mul(5.0))).mul(0.4));
        const nodSway = sin(u.time.mul(1.9).add(seed.mul(23.0))).mul(0.06).mul(gust);
        const head = head0.add(u.camRight.mul(sway.mul(gust).mul(0.012).mul(depth.add(0.4))))
            .add(u.camFwd.mul(sin(u.time.mul(0.9).add(seed.mul(9.0))).mul(gust).mul(0.03)));
        // The stem: up from under the frame to the head, leaning, bowed a little.
        const foot = head0.sub(u.camUp.mul(STEM * 0.94)).sub(u.camRight.mul(iPlace.w.mul(STEM * 0.45)));
        const stemAt = (k) => mix(foot, head, k).add(u.camRight.mul(k.mul(float(1.0).sub(k)).mul(iPlace.w).mul(0.06)));
        // The ear nods off its neck toward its lean, and sways about it.
        const tilt = iPlace.w.mul(0.9).add(nodSway).add(seed.sub(0.5).mul(0.3));
        const earAxis = normalize(u.camUp.mul(cos(tilt)).add(u.camRight.mul(sin(tilt))).add(u.camFwd.mul(0.12))).toVar();
        const earLen = mix(float(EAR_SHAPE.length[0]), float(EAR_SHAPE.length[1]), seed).mul(size).mul(1 + EAR_SHAPE.reach);
        const along = select(isEar, head.add(earAxis.mul(earLen.mul(s))), stemAt(s)).toVar();
        const axis = select(isEar, earAxis, normalize(head.sub(foot))).toVar();
        // Turned to the eye; widened by the blur so the soft edge fits inside the ribbon.
        const toEye = normalize(u.eye.sub(along));
        const across = normalize(cross(axis, toEye).add(vec3(1e-5, 0.0, 0.0)));
        const brush = EAR_SHAPE.brush * 1.15;
        const earHalf = max(spindle(s).mul(EAR_SHAPE.core * 1.1), smoothstep(0.04, 0.5, s).mul(float(1.0).sub(smoothstep(0.82, 1.0, s).mul(0.75))).mul(brush))
            .mul(size);
        const stemHalf = float(0.0021).sub(s.mul(0.0004));
        const trueHalf = select(isEar, earHalf, stemHalf);
        const blur = float(LENS_BLUR.coc);
        const drawn = trueHalf.add(blur.mul(1.6));
        vInfo.assign(vec4(positionGeometry.z, s, w, drawn));
        vEdge.assign(vec4(trueHalf, blur, seed, size));
        // The light here: the sun through the deck at the eye, and how far the sun is ahead.
        const sunlit = deckShadow(u, t.noise, u.eye).mul(u.sunUp);
        vLight.assign(vec4(sunlit, clamp(dot(normalize(along.sub(u.eye)), u.sunDir), 0.0, 1.0), 0.0, 0.0));
        return along.add(across.mul(w.mul(drawn)));
    })();
    material.colorNode = Fn(() => {
        const isEar = vInfo.x.greaterThan(0.5);
        const s = vInfo.y;
        const m = abs(vInfo.z).mul(vInfo.w);
        const R = vEdge.x;
        const blur = vEdge.y;
        // The blurred outline: a disc of confusion swept over the edge.
        const solid = smoothstep(R.add(blur), R.sub(blur), m);
        // The awns are a haze, fainter than the spindle's body; the stem fades out low in the frame.
        const core = spindle(s).mul(EAR_SHAPE.core * 1.1).mul(vEdge.w);
        const body = smoothstep(core.add(blur), core.sub(blur), m);
        const earA = max(body, solid.mul(0.42)).mul(smoothstep(0.0, 0.06, s));
        const stemA = solid.mul(smoothstep(0.0, 0.35, s));
        const alpha = select(isEar, earA, stemA).mul(LENS_BLUR.opacity);
        // The crop's gold (paler awns, a straw stem going green toward its foot), in the stand's shade
        // low down.
        const crop = vec3(...SOIL.barley).mul(vEdge.z.mul(0.25).add(0.9));
        const awny = float(1.0).sub(body);
        const earCol = mix(crop.mul(1.05), crop.mul(vec3(1.12, 1.1, 1.05)).add(vec3(0.03, 0.025, 0.01)), awny.mul(0.7));
        const stemCol = crop.mul(mix(vec3(0.42, 0.55, 0.28), vec3(0.85, 0.82, 0.68), smoothstep(0.2, 0.8, s)));
        const albedo = select(isEar, earCol, stemCol).toVar();
        const shade = select(isEar, float(1.0), mix(float(0.3), float(0.9), s));
        const sunlit = vLight.x;
        const ahead = vLight.y;
        const a2 = ahead.mul(ahead);
        const a4 = a2.mul(a2);
        // Round and soft (no facet reads at this blur): a wrapped diffuse from the sun's side, the sky,
        // the field's gold from below; with the sun ahead the light comes through the awns.
        const col = albedo.mul(u.sun.mul(sunlit).mul(0.55).mul(shade)
            .add(u.fill.mul(1.9).mul(shade))
            .add(u.bounce.mul(0.6))).mul(LENS_BLUR.light).toVar();
        const through = a4.mul(0.55).add(a4.mul(a4).mul(1.2)).add(a2.mul(0.1));
        col.addAssign(albedo.mul(vec3(1.45, 1.15, 0.6)).mul(u.sun).mul(through).mul(sunlit)
            .mul(select(isEar, awny.mul(0.6).add(0.5), float(0.25)))
            .mul(LENS_BLUR.light));
        // After sunset the ears keep a little of the afterglow.
        col.addAssign(albedo.mul(u.glow).mul(u.day.oneMinus()).mul(0.06));
        // The blaze's soft cap (a backlit ear stays gold).
        const peak = max(max(col.x, col.y), max(col.z, 1e-4));
        const over = max(peak.sub(BLAZE_CAP.knee), 0.0);
        const capped = min(peak, float(BLAZE_CAP.knee).add(over.div(over.div(BLAZE_CAP.top - BLAZE_CAP.knee).add(1.0))));
        col.mulAssign(capped.div(peak));
        return vec4(col, alpha);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'GrainfieldsLensEars';
    mesh.frustumCulled = false;
    mesh.renderOrder = 60;
    mesh.visible = ears.length > 0;

    return {
        mesh,
        meshes: [mesh],
        count: ears.length,
        update(time, dt, world) {
            const camera = world?._camera;
            // The portrait rig's lens shift (projection's row 1, column 2), so a corner stays a corner.
            if (camera?.projectionMatrix) shift.value = -camera.projectionMatrix.elements[9];
            swayGain.value = world?.reducedMotion ? 0.15 : 1;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
