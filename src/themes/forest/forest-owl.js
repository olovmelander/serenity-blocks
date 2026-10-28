/**
 * Forest — the eagle owl, drawn.
 *
 * The model is the theme's own, modelled and rigged in Blender (assets/owl.glb;
 * scripts/blender/forest_owl.py, packed by scripts/forest/pack-owl.mjs): a soft body and a vane for
 * every feather, a bone for every flight feather. There are no clips: the mind (forest-owl-mind.js)
 * says where the owl is and what it is doing, the rig (forest-owl-rig.js) turns that into a turn for
 * every bone, and this module writes them to the skeleton and lights the bird.
 *
 * It is lit as the old wood is (forest-light.js): the moon stands behind it, so the side the eye sees
 * is its shaded side, edged in silver where its outline catches the moon, and its wings glow through
 * when it crosses the light, the bars of its flight feathers dark in them. The sky and the moonlit
 * ride fill its face; the forest's own light (a wave, a passing firefly) shows its true colour. Its
 * plumage is drawn in the shader from codes each vertex carries (`_plumage`): the kind of feather or
 * part, where on a vane it is, and a seed.
 *
 * Its home is a dead limb of its own on the elder spruce, reaching out toward the moon.
 */

import * as THREE from 'three/webgpu';
import {
    Fn, abs, atan, attribute, cameraPosition, color, dot, float, floor, fract, frontFacing, fwidth, hash, length,
    mix, normalWorld, normalize, positionGeometry, positionWorld, reflect, saturate,
    select, sin, smoothstep, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import {
    OWL_BONES, OWL_DRAWN_SCALE, OWL_ROOT_HEIGHT, createOwlFrame, poseOwl,
} from './forest-owl-rig.js';
import { FOREST_OWL_LIMB, FOREST_OWL_LIMBS } from './forest-owl-perches.js';

/** How much larger than life the owl is drawn (forest-owl-rig.js). */
export const FOREST_OWL_SCALE = OWL_DRAWN_SCALE;

// Plumage kinds (model.py KIND).
const K = {
    body: 0,
    face: 1,
    eye: 2,
    bill: 3,
    claw: 4,
    primary: 5,
    secondary: 6,
    covert: 7,
    under: 8,
    rectrix: 9,
    tuft: 10,
    lid: 11,
    foot: 12,
    arm: 13,
    scapular: 14,
};
/** Where the left eye sits in the rest pose (model.py EYE), and the way it looks. */
const EYE = [0.035, 0.481, 0.0935];
const EYE_LOOK = (() => {
    const v = [0.16, -0.02, 1];
    const l = Math.hypot(...v);
    return v.map((c) => c / l);
})();

export const FOREST_OWL_EYE = Object.freeze({ centre: EYE, look: EYE_LOOK });

const isKind = (kind, k) => float(1).sub(saturate(abs(kind.sub(k)).mul(2)));

/**
 * The plumage. COLOR_0 = linear albedo + the sky the vertex sees; _plumage = (kind / 16, along, across,
 * seed): for a vane, how far along it and across it (0 inner edge, 1 outer); for the body, how much it
 * wears the breast's bold streaks and the belly's fine bars, drawn from the rest position.
 */
function createOwlMaterial(light, u) {
    const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
    material.name = 'ForestOwlPlumage';
    material.fragmentNode = Fn(() => {
        // Pinned before any branch (three's normal vars are assigned where first built).
        const N = normalize(normalWorld).toVar();
        const world = positionWorld.toVar();
        const V = normalize(cameraPosition.sub(world)).toVar();
        const paint = attribute('color', 'vec4');
        const code = attribute('_plumage', 'vec4');
        const rest = positionGeometry.toVar();
        const kind = floor(code.x.mul(16).add(0.5)).toVar();
        const along = code.y.toVar();
        const across = code.z.mul(2).sub(1).toVar();
        const seed = code.w.toVar();
        const sky = paint.a.toVar();
        const base = paint.rgb.toVar();
        const dorsal = select(frontFacing, float(1), float(0)).toVar();

        const flight = isKind(kind, K.primary).add(isKind(kind, K.secondary)).add(isKind(kind, K.rectrix)).toVar();
        const covert = isKind(kind, K.covert).add(isKind(kind, K.scapular)).toVar();
        const arm = isKind(kind, K.arm).toVar();
        const under = isKind(kind, K.under).toVar();
        const tuft = isKind(kind, K.tuft).toVar();
        const vane = saturate(flight.add(covert).add(under).add(tuft)).toVar();
        // (the wing's leading edge, kind arm, is soft like the body)
        const body = isKind(kind, K.body).add(isKind(kind, K.foot)).toVar();
        const face = isKind(kind, K.face).add(isKind(kind, K.lid)).toVar();
        const eye = isKind(kind, K.eye).toVar();
        const horn = isKind(kind, K.bill).add(isKind(kind, K.claw)).toVar();

        // Colours are the forest's (a night forest's albedos are dark: bark is a few hundredths), an
        // eagle owl a little paler than the bark it sits on.
        // -- flight feathers: soft wavy dark bars across a buff ground, the shaft paler, the outer vane
        // darker on top; underneath paler with fainter bars. The bars fade to their mean as they grow
        // finer than a pixel, so a far wing never shimmers.
        const bars = float(5.5).add(seed.mul(1.6)).toVar();
        const phase = along.mul(bars).add(across.mul(0.3)).add(sin(across.mul(5).add(seed.mul(17))).mul(0.12))
            .add(seed.mul(3.1))
            .toVar();
        const wave = sin(phase.mul(Math.PI * 2)).toVar();
        const fine = saturate(fwidth(phase).mul(1.6)).toVar();
        const barDark = mix(smoothstep(-0.35, 0.75, wave), float(0.45), fine).toVar();
        const shaft = smoothstep(0.07, 0.0, abs(across)).mul(smoothstep(0.02, 0.12, along)).toVar();
        const outerVane = smoothstep(0.0, 0.25, across).mul(0.35).mul(isKind(kind, K.primary));
        const tipDark = smoothstep(0.8, 1.0, along).mul(0.3);
        const top = mix(
            vec3(0.075, 0.048, 0.024),
            vec3(0.02, 0.013, 0.008),
            saturate(barDark.mul(0.85).add(outerVane).add(tipDark)),
        ).toVar();
        const bottom = mix(vec3(0.15, 0.125, 0.09), vec3(0.06, 0.044, 0.028), barDark.mul(0.7)).toVar();
        const flightCol = mix(mix(bottom, top, dorsal), vec3(0.13, 0.11, 0.08), shaft.mul(0.35)).toVar();

        // -- the mottled upperparts (mantle, scapulars, coverts): every feather dark down its middle, its
        // edges tawny, a buff spot here and there. On a vane drawn from where on it a point lies; on the
        // soft back from a lattice of feather-sized cells in the rest pose.
        const cellUV = vec2(rest.x.div(0.017).add(rest.z.div(0.03)), rest.y.div(0.022)).add(64).toVar();
        const row = floor(cellUV.y).toVar();
        const cellX = cellUV.x.add(row.mul(0.5)).toVar();
        const cell = hash(floor(cellX).add(row.mul(131))).toVar();
        const inCell = vec2(fract(cellX).sub(0.5), fract(cellUV.y).sub(0.5)).toVar();
        const backStreak = smoothstep(0.24, 0.08, abs(inCell.x)).mul(smoothstep(-0.55, 0.15, inCell.y)).toVar();
        const backSpot = smoothstep(0.22, 0.08, length(inCell.sub(vec2(0.18, -0.2)))).mul(step01(cell.sub(0.6)))
            .toVar();
        const featherDark = vec3(0.016, 0.011, 0.007);
        const featherEdge = vec3(0.07, 0.044, 0.022);
        const featherSpot = vec3(0.12, 0.085, 0.05);
        const backCol = mix(mix(featherEdge, featherDark, backStreak.mul(0.85)), featherSpot, backSpot.mul(0.8))
            .mul(cell.mul(0.35).add(0.8)).toVar();
        // On a covert vane: the same feather, drawn by its own coordinates.
        const vaneStreak = smoothstep(0.55, 0.15, abs(across)).mul(smoothstep(0.95, 0.5, along)).toVar();
        const vaneSpot = smoothstep(0.24, 0.08, length(vec2(across.sub(0.25), along.sub(0.7))))
            .mul(step01(seed.sub(0.55))).toVar();
        const covertTop = mix(mix(featherEdge, featherDark, vaneStreak.mul(0.85)), featherSpot, vaneSpot.mul(0.8))
            .mul(seed.mul(0.3).add(0.85));
        const covertCol = mix(vec3(0.11, 0.09, 0.065), covertTop, dorsal).toVar();
        // -- under coverts: pale, a dark streak down the shaft.
        const underCol = mix(
            vec3(0.15, 0.125, 0.09),
            vec3(0.045, 0.032, 0.02),
            smoothstep(0.2, 0.05, abs(across)).mul(0.6),
        ).toVar();
        // -- ear tufts: near black, their outer edge buff.
        const tuftCol = mix(vec3(0.01, 0.007, 0.005), vec3(0.06, 0.04, 0.02), smoothstep(0.4, 0.95, across)).toVar();

        // -- the soft body: the breast's bold dark streaks, the belly's fine wavy bars; elsewhere (the
        // back, the crown, the nape) the mottled upperparts.
        const tone = base.mul(0.24).toVar();
        const streakCell = rest.x.div(0.021).add(64).toVar();
        const cellId = floor(streakCell).toVar();
        const jitter = hash(cellId.add(floor(rest.y.div(0.05).add(8)).mul(37))).toVar();
        const cx = fract(streakCell).sub(0.5).sub(jitter.sub(0.5).mul(0.3)).toVar();
        // Each streak a drop that tapers to nothing at its cell's ends (so rows never seam), its width
        // its own: bold on the upper breast, finer below.
        const lengthwise = fract(rest.y.div(0.05)).toVar();
        const boldness = hash(cellId.mul(7.3).add(floor(rest.y.div(0.05).add(8)).mul(53))).mul(0.8).add(0.55).toVar();
        const streakWidth = float(0.2).mul(sin(lengthwise.mul(Math.PI))).mul(boldness)
            .mul(smoothstep(0.12, 0.3, rest.y).mul(0.6).add(0.4))
            .add(0.008)
            .toVar();
        const streak = smoothstep(streakWidth, streakWidth.mul(0.4), abs(cx)).mul(code.y).toVar();
        const barPhase = rest.y.div(0.0075).add(sin(rest.x.mul(90).add(rest.z.mul(40))).mul(0.7)).toVar();
        const barLine = smoothstep(0.3, 0.95, sin(barPhase.mul(Math.PI * 2)))
            .mul(float(1).sub(saturate(fwidth(barPhase).mul(1.5)))).mul(code.z).toVar();
        const underparts = saturate(code.y.add(code.z).mul(3)).toVar();
        const breastCol = tone.mul(float(1).sub(streak.mul(0.8)).sub(barLine.mul(0.45))).toVar();
        const bodyCol = mix(mix(backCol, tone, 0.35), breastCol, underparts).toVar();
        // -- the facial disc: fine lines radiating from the eyes.
        const toEye = rest.sub(vec3(select(rest.x.greaterThan(0), float(EYE[0]), float(-EYE[0])), EYE[1], EYE[2]))
            .toVar();
        const radial = sin(atan(toEye.y, toEye.x).mul(26)).mul(0.5).add(0.5).toVar();
        const faceCol = base.mul(0.34).mul(float(0.88).add(radial.mul(0.18))).toVar();

        // -- the eyes: a black pupil, an orange iris deepening toward it, wet.
        const eyeAxis = vec3(
            select(rest.x.greaterThan(0), float(EYE_LOOK[0]), float(-EYE_LOOK[0])),
            EYE_LOOK[1],
            EYE_LOOK[2],
        );
        const eyeCos = dot(normalize(toEye), eyeAxis).toVar();
        const eyeAngle = float(1).sub(eyeCos).toVar(); // 0 at the pupil's centre
        const pupilEdge = float(0.066).mul(u.pupil).toVar();
        const irisEdge = float(0.34).toVar();
        const pupil = smoothstep(pupilEdge.add(0.012), pupilEdge, eyeAngle).toVar();
        const iris = smoothstep(irisEdge.add(0.02), irisEdge, eyeAngle).toVar();
        const irisCol = mix(vec3(0.95, 0.42, 0.04), vec3(0.62, 0.12, 0.01), smoothstep(irisEdge, pupilEdge, eyeAngle))
            .mul(float(0.85).add(sin(atan(toEye.y, toEye.x).mul(40)).mul(0.15)));
        const eyeCol = mix(mix(vec3(0.02, 0.012, 0.008), irisCol, iris), vec3(0.002), pupil).toVar();

        const albedo = vec3(0).toVar();
        albedo.assign(bodyCol.mul(body));
        albedo.addAssign(faceCol.mul(face));
        albedo.addAssign(flightCol.mul(flight));
        albedo.addAssign(covertCol.mul(covert));
        albedo.addAssign(backCol.mul(arm));
        albedo.addAssign(underCol.mul(under));
        albedo.addAssign(tuftCol.mul(tuft));
        albedo.addAssign(eyeCol.mul(eye));
        albedo.addAssign(base.mul(0.5).mul(horn));

        // -- light
        const L = light.uMoonDir;
        const moon = light.moonlight().toVar();
        const ndl = dot(N, L).toVar();
        const facing = saturate(ndl).toVar();
        const cool = light.night(albedo).toVar();
        // The moon behind it edges the outline in silver (the soft body's outline most).
        const edge = float(1).sub(saturate(dot(N, V))).toVar();
        const edge3 = edge.mul(edge).mul(edge).toVar();
        const behind = saturate(dot(V, L).negate()).toVar();
        const rimLight = edge3.mul(behind.mul(0.75).add(0.25)).mul(float(1).sub(vane.mul(0.5))).toVar();
        // Through a thin vane lit from its far side: warmer than it went in, the bars dark in it.
        const thinness = flight.mul(0.9).add(covert.mul(0.35)).add(tuft.mul(0.5)).add(under.mul(0.6))
            .toVar();
        // Only near the moon's own line does a vane glow (forward scatter); elsewhere a trace.
        const behind2 = behind.mul(behind).toVar();
        const behind8 = behind2.mul(behind2).mul(behind2).mul(behind2).toVar();
        const transmit = saturate(ndl.negate()).mul(behind8.mul(0.85).add(0.15)).mul(thinness)
            .mul(float(1).sub(barDark.mul(0.75).mul(flight)))
            .toVar();
        const throughCol = vec3(0.6, 0.42, 0.22).mul(transmit).mul(0.06);
        const ambient = light.ambient(N).mul(sky.mul(0.8).add(0.2)).toVar();
        const glow = light.glow(world).toVar();
        const lit = cool.mul(light.moonColour()).mul(facing.mul(1.3).add(rimLight.mul(1.9))).mul(moon)
            .add(light.moonColour().mul(throughCol).mul(moon))
            // The fringe of the plumage catches the moon behind it whatever its colour: a silver edge.
            .add(light.moonColour().mul(rimLight.mul(behind).mul(0.014)).mul(moon))
            .add(cool.mul(ambient).mul(1.55))
            .add(albedo.mul(1.5).add(0.004).mul(glow).mul(sky.mul(0.6).add(0.4)))
            .toVar();
        // The eyes: a wet glint of the moon and the bright sky, and a little of the light they gather.
        const R = reflect(V.negate(), N).toVar();
        const glint = saturate(dot(R, L)).toVar();
        const glint2 = glint.mul(glint).toVar();
        const glint8 = glint2.mul(glint2).mul(glint2).mul(glint2).toVar();
        // A small sharp catchlight of the moon, the sky only at the cornea's grazing rim, and an iris that
        // holds a little light of its own and takes the forest's light (a wave, a firefly) as an ember.
        const irisLit = irisCol.mul(iris.mul(float(1).sub(pupil)));
        const wet = light.moonColour().mul(glint8.mul(glint8).mul(3.5).mul(moon.mul(0.7).add(0.3)))
            .add(light.sky(R).mul(edge3.mul(0.45).add(0.015)))
            .add(irisLit.mul(u.eyeLight.add(glow.length().mul(2.2))));
        lit.addAssign(wet.mul(eye));
        // A little of a hard drop's or a wave's light catches the horn and the eyes the same way.
        lit.addAssign(vec3(0.6).mul(glint8).mul(horn).mul(0.15));
        return vec4(light.haze(lit, { world, glow }), 1);
    })();
    return material;
}

function step01(x) {
    return saturate(x.mul(1e4));
}

/** The owl's dead limb on the elder spruce: grey, lichened, a broken twig or two. */
function createLimbMaterial(light) {
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'ForestOwlLimb';
    material.fragmentNode = Fn(() => {
        const N = normalize(normalWorld).toVar();
        const world = positionWorld.toVar();
        const V = normalize(cameraPosition.sub(world)).toVar();
        const rest = positionGeometry.toVar();
        const grain = light.noise(vec2(rest.x.mul(1.3).add(rest.z.mul(1.3)), rest.y.mul(1.3))).toVar();
        const fine = light.noise(vec2(rest.x.mul(7).add(rest.z.mul(6)), rest.y.mul(9))).toVar();
        const wood = mix(color(0x2b241e), color(0x6a6158), grain.r.mul(0.6).add(fine.g.mul(0.4))).toVar();
        const lichen = smoothstep(0.55, 0.75, fine.b.mul(0.6).add(grain.a.mul(0.4))).mul(N.y.mul(0.5).add(0.5)).toVar();
        const albedo = mix(wood, mix(color(0x4c5444), color(0x8a917a), fine.r), lichen.mul(0.8)).toVar();
        const moon = light.moonlight();
        const facing = saturate(dot(N, light.uMoonDir));
        const edge = float(1).sub(saturate(dot(N, V)));
        const rimLight = edge.mul(edge).mul(edge).mul(saturate(dot(V, light.uMoonDir).negate().mul(0.6).add(0.55)));
        const cool = light.night(albedo);
        const glow = light.glow(world);
        const lit = cool.mul(light.moonColour()).mul(facing.mul(1.4).add(rimLight.mul(1.5))).mul(moon)
            .add(cool.mul(light.ambient(N)).mul(1.4))
            .add(albedo.mul(1.5).add(0.006).mul(glow));
        return vec4(light.haze(lit, { world, glow }), 1);
    })();
    return material;
}

/** The limb's mesh: a bent, tapering tube from inside the trunk out toward the moon, two twig stubs. */
export function createLimbGeometry(limb = FOREST_OWL_LIMB) {
    const curve = new THREE.CatmullRomCurve3(limb.points.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.5);
    const parts = [];
    const tube = new THREE.TubeGeometry(curve, 28, 1, 9, false);
    // Taper the unit tube by its ring: TubeGeometry lays rings along the curve in order.
    const pos = tube.attributes.position;
    const rings = 29;
    const perRing = 10;
    const centre = new THREE.Vector3();
    const point = new THREE.Vector3();
    for (let r = 0; r < rings; r += 1) {
        const t = r / (rings - 1);
        curve.getPointAt(t, centre);
        const radius = limb.radius[0] + (limb.radius[1] - limb.radius[0]) * t;
        const knot = 1 + 0.12 * Math.sin(t * 23.0) * Math.exp(-t * 2);
        for (let k = 0; k < perRing; k += 1) {
            const i = r * perRing + k;
            point.fromBufferAttribute(pos, i).sub(centre).multiplyScalar(radius * knot).add(centre);
            pos.setXYZ(i, point.x, point.y, point.z);
        }
    }
    tube.computeVertexNormals();
    parts.push(tube);
    limb.twigs.forEach(({
        at, dir, length: twigLength, radius,
    }) => {
        const start = curve.getPointAt(at);
        const d = new THREE.Vector3(...dir).normalize();
        const twig = new THREE.CylinderGeometry(radius * 0.35, radius, twigLength, 6, 1, false);
        twig.translate(0, twigLength / 2, 0);
        twig.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
        twig.translate(start.x, start.y, start.z);
        parts.push(twig.toNonIndexed());
    });
    // One geometry: positions and normals only.
    const geometries = parts.map((g) => {
        const plain = g.index ? g.toNonIndexed() : g;
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', plain.attributes.position.clone());
        out.setAttribute('normal', plain.attributes.normal.clone());
        return out;
    });
    let count = 0;
    geometries.forEach((g) => { count += g.attributes.position.count; });
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    let at = 0;
    geometries.forEach((g) => {
        positions.set(g.attributes.position.array, at * 3);
        normals.set(g.attributes.normal.array, at * 3);
        at += g.attributes.position.count;
    });
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    merged.computeBoundingSphere();
    [tube, ...parts, ...geometries].forEach((g) => g.dispose());
    return merged;
}

/**
 * The owl in the scene: its model, its limb, and the pose written each frame.
 */
export class ForestOwl {
    constructor({ light, gltf, scale = FOREST_OWL_SCALE }) {
        this.light = light;
        this.gltf = gltf;
        this.scale = scale;
        this.group = new THREE.Group();
        this.group.name = 'ForestOwl';
        this.uniforms = { pupil: uniform(1.6), eyeLight: uniform(0.075) };
        this.frame = createOwlFrame();
        this.built = false;
        this.stats = { owlTriangles: 0, owlBones: 0 };
    }

    build() {
        if (this.built) return this;
        this.built = true;
        const { gltf, light } = this;
        this.limbMaterial = createLimbMaterial(light);
        this.limbs = FOREST_OWL_LIMBS.map((limb, i) => {
            const mesh = new THREE.Mesh(createLimbGeometry(limb), this.limbMaterial);
            mesh.name = `ForestOwlLimb ${i}`;
            this.group.add(mesh);
            return mesh;
        });
        if (!gltf) return this;
        this.material = createOwlMaterial(light, this.uniforms);
        // Each world its own copy of the skeleton (a forest rebuilt for another tier gets a fresh one);
        // the geometry is shared and belongs to the asset pack.
        const model = cloneSkinned(gltf.scene);
        model.name = 'ForestOwlModel';
        model.traverse((child) => {
            if (!child.isMesh) return;
            child.material = this.material;
            child.frustumCulled = false;
            child.castShadow = false;
            child.receiveShadow = false;
            if (child.isSkinnedMesh) this.body = child;
            this.stats.owlTriangles += child.geometry.index ? child.geometry.index.count / 3 : 0;
        });
        this.bones = OWL_BONES.map((name) => model.getObjectByName(name) || null);
        this.stats.owlBones = this.bones.filter(Boolean).length;
        this.rest = this.bones.map((bone) => (bone ? bone.position.clone() : null));
        this.restScale = this.bones.map((bone) => (bone ? bone.scale.clone() : null));
        this.model = model;
        this.pivot = new THREE.Group();
        this.pivot.name = 'ForestOwlPivot';
        this.pivot.scale.setScalar(this.scale);
        this.pivot.add(model);
        this.group.add(this.pivot);
        return this;
    }

    /**
     * Write a placement and a pose: `place` = { x, y, z, heading (radians about y) } is where the model's
     * origin stands (the perch under its feet), `pose` the rig's numbers.
     */
    apply(place, pose) {
        if (!this.model) return;
        this.pivot.position.set(place.x, place.y, place.z);
        this.pivot.rotation.set(0, place.heading, 0);
        const frame = poseOwl(pose, this.frame);
        const { bones, rest } = this;
        for (let i = 0; i < bones.length; i += 1) {
            const bone = bones[i];
            if (!bone) continue;
            const q = frame.rotations[i];
            bone.quaternion.set(q[0], q[1], q[2], q[3]);
        }
        const root = bones[0];
        if (root) root.position.copy(rest[0]).add({ x: frame.root[0], y: frame.root[1], z: frame.root[2] });
        Object.entries(frame.scales).forEach(([name, s]) => {
            const bone = bones[OWL_BONES.indexOf(name)];
            if (bone) bone.scale.set(s[0], s[1], s[2]);
        });
    }

    /** The world point of the owl's body centre for a placement (the root joint, at rest). */
    static bodyCentre(place, out = new THREE.Vector3()) {
        return out.set(place.x, place.y + OWL_ROOT_HEIGHT * FOREST_OWL_SCALE, place.z);
    }

    dispose() {
        this.limbs?.forEach((mesh) => mesh.geometry.dispose());
        this.limbMaterial?.dispose();
        this.material?.dispose();
        this.model?.traverse((child) => {
            if (child.isSkinnedMesh) child.skeleton?.dispose?.();
        });
        this.group.removeFromParent();
        this.group.clear();
        this.model = null;
    }
}
