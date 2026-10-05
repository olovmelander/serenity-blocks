/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * The lotus of Heart Glow and its image in the pond.
 *
 * Three rings of petals hinge from the flower's base and unfold ring by ring with the breath: the
 * outer ring leads the opening and the inner ring leads the folding, so the bloom always moves in
 * order. Green sepals lie open on the water beneath them. A petal is a thin translucent spoon bent
 * along an arc: closed, the rings make an egg-shaped bud; open, a wide bowl around the golden seed
 * head. The heart is the only light inside the flower: it lights the faces it can see and glows
 * through the ones it cannot, so the flower reads as a lantern — hot magenta at the claw, rose
 * through the body, a white blush at the tip, fine veins that show against the light and a pale
 * Fresnel rim wherever a petal turns edge-on. All the petals are one mesh: each vertex follows its
 * own petal's matrix from a uniform array, so the whole bloom is a single draw.
 *
 * The mirror image is the same flower reflected through the water plane (a true reflection: the
 * pond shows the petals' undersides, as still water does). It is drawn additively, dimmer and cooler
 * than the flower, fading with depth below the surface, broken by the swell and hidden behind the
 * lily pads; only its nearest surface lights each pixel, so overlapping petals never stack.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraViewMatrix, dot, exp, faceDirection, float, int, mat3, mix, modelNormalMatrix,
    modelViewProjection, normalGeometry, positionGeometry, positionLocal, positionWorld, sin, smoothstep, uniform,
    uniformArray, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fadeOut } from '../stage/breath-tsl.js';
import { pondPlane, screenPoint } from './lotus-pond.js';

const TAU = Math.PI * 2;
const GOLD = vec3(1.0, 0.72, 0.32);
/** The night's light on what faces the sky, and the cool cast of everything seen in the water. */
const SKYLIGHT = vec3(0.012, 0.012, 0.032);
const DEEP_WATER_TINT = vec3(0.72, 0.6, 1.0);
/**
 * Outer to inner. count, length, width; hinge radius and lift above the base; closed and open
 * angle of the claw from the flower's axis (radians); cup across the petal and bend along it
 * (radians over the whole length); pigment at the claw, through the body and at the tip (linear
 * RGB); `glow`: how much of the heart's light reaches it; `still`: sepals barely follow the breath.
 */
const RINGS = [
    {
        count: 5,
        length: 0.3,
        width: 0.2,
        hinge: 0.07,
        lift: -0.012,
        closed: 1.3,
        open: 1.55,
        cup: 0.35,
        bend: 0.2,
        claw: [0.03, 0.07, 0.025],
        body: [0.12, 0.2, 0.07],
        tip: [0.5, 0.2, 0.26],
        glow: 0.7,
        still: true,
    },
    {
        count: 8,
        length: 0.62,
        width: 0.33,
        hinge: 0.068,
        lift: 0.0,
        closed: 0.82,
        open: 1.76,
        cup: 0.5,
        bend: 0.78,
        claw: [0.55, 0.02, 0.2],
        body: [0.86, 0.17, 0.38],
        tip: [0.98, 0.66, 0.74],
        glow: 1,
    },
    {
        count: 8,
        length: 0.55,
        width: 0.31,
        hinge: 0.056,
        lift: 0.012,
        closed: 0.52,
        open: 1.5,
        cup: 0.55,
        bend: 0.76,
        claw: [0.6, 0.03, 0.22],
        body: [0.9, 0.24, 0.44],
        tip: [1.0, 0.74, 0.8],
        glow: 1,
    },
    {
        count: 6,
        length: 0.42,
        width: 0.28,
        hinge: 0.046,
        lift: 0.024,
        closed: 0.3,
        open: 1.32,
        cup: 0.6,
        bend: 0.74,
        claw: [0.66, 0.05, 0.24],
        body: [0.94, 0.34, 0.5],
        tip: [1.0, 0.82, 0.86],
        glow: 1,
    },
];
/** The top of the seed head sits this high above the petals' hinges, in flower units. */
const HEART_HEIGHT = 0.05;

/**
 * One petal standing along +Y from its hinge: narrow at the claw, widest a little past the middle,
 * a pointed tip. A spoon bent along an arc: the margins lift toward the inner face (-Z) and the
 * whole petal curves inward by `bend` radians from claw to tip. The front face (+Z) is the outer
 * side. UV: x across (0..1), y from claw (0) to tip (1). The ring's pigment rides along as vertex
 * attributes, so every ring shares one material (one shader to compile instead of four).
 */
function petalGeometry({
    length, width, cup, bend, claw, body, tip, glow,
}) {
    const geometry = new THREE.PlaneGeometry(1, 1, 10, 24);
    const { position } = geometry.attributes;
    const radius = length / Math.max(bend, 1e-3);
    for (let i = 0; i < position.count; i++) {
        const across = position.getX(i) * 2;
        const along = position.getY(i) + 0.5;
        const shape = Math.sin(Math.PI * along ** 1.2) ** 0.9 + 0.1 * (1 - along) ** 4;
        const half = shape * width * 0.5;
        // The centreline bends along a circle; the cup pushes the margins toward its centre.
        const angle = (along * length) / radius;
        const lift = across * across * half * cup;
        const y = radius * Math.sin(angle) - Math.sin(angle) * lift;
        const z = -radius * (1 - Math.cos(angle)) - Math.cos(angle) * lift;
        position.setXYZ(i, across * half, y, z);
    }
    geometry.computeVertexNormals();
    const fill = (values) => new THREE.BufferAttribute(
        Float32Array.from({ length: position.count * values.length }, (_, k) => values[k % values.length]),
        values.length,
    );
    geometry.setAttribute('aClaw', fill([...claw, glow]));
    geometry.setAttribute('aBody', fill(body));
    geometry.setAttribute('aTip', fill(tip));
    return geometry;
}

/**
 * The stamens: a fringe of fine golden filaments around the seed head, each a thin tapered blade
 * leaning outward. UV y runs from the filament's foot (0) to its anther (1).
 */
function stamenGeometry(count, radius, length, width) {
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * TAU + Math.sin(i * 12.9898) * 0.08;
        const lean = 0.5 + 0.45 * ((Math.sin(i * 78.233) + 1) / 2);
        const reach = length * (0.75 + 0.5 * ((Math.sin(i * 39.37) + 1) / 2));
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const foot = [c * radius, 0, s * radius];
        const tip = [foot[0] + c * Math.sin(lean) * reach, Math.cos(lean) * reach, foot[2] + s * Math.sin(lean) * reach];
        const side = [-s * width * 0.5, 0, c * width * 0.5];
        const base = positions.length / 3;
        positions.push(
            foot[0] - side[0],
            foot[1],
            foot[2] - side[2],
            foot[0] + side[0],
            foot[1],
            foot[2] + side[2],
            tip[0] - side[0] * 1.8,
            tip[1],
            tip[2] - side[2] * 1.8,
            tip[0] + side[0] * 1.8,
            tip[1],
            tip[2] + side[2] * 1.8,
        );
        uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

/**
 * The look of everything that is seen in the water rather than in the air: dimmer, cooler, fading
 * with depth below the surface, broken by slow horizontal swell bands, and hidden wherever a lily
 * pad lies on the water in front of it. `plane` is (normal.xyz, offset): a point P lies on the
 * water where dot(normal, P) = offset.
 */
function underwater(color, u, light, padField = null) {
    const below = light.plane.w.sub(dot(light.plane.xyz, positionWorld)).max(0).toVar();
    const fade = exp(below.mul(below).mul(-3.5)).mul(exp(below.mul(-1.1)));
    const swell = sin(positionWorld.y.mul(64).add(sin(positionWorld.x.mul(8).add(u.time.mul(0.3))).mul(1.8))
        .add(u.time.mul(0.8)));
    const bands = float(1).sub(smoothstep(0.3, 1.0, swell).mul(0.5).mul(smoothstep(0.015, 0.1, below)));
    let image = color.mul(DEEP_WATER_TINT).mul(fade).mul(bands).mul(0.42);
    if (padField) {
        const pond = pondPlane(screenPoint(u), u);
        image = image.mul(float(1).sub(padField(pond.plane, pond.planePx, false).cover));
    }
    return image;
}

/**
 * The mirror's depth, pushed back past everything above the water (about 0.012 in NDC on either
 * backend): it still sorts among itself and still hides behind the flower, but never hides a
 * firefly. `bias` sets the depth-only pre-pass a hair behind the colour pass.
 */
const sunkDepth = (bias) => Fn(() => {
    const clip = modelViewProjection;
    return vec4(clip.x, clip.y, clip.z.add(clip.w.mul(0.012 + bias)), clip.w);
})();

/**
 * The pond's image is light added to the dark water, but only from the nearest mirrored surface at
 * each pixel: a depth-only twin of every mirrored mesh draws first (see `withDepthTwin`), so petals
 * that overlap in the mirror never pile up into a glassy stack.
 */
function asImage(material) {
    return Object.assign(material, {
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexNode: sunkDepth(0),
    });
}

/** The depth-only pre-pass of the mirrored meshes (`petals`: placed like the bloom's vertices). */
function imageDepthMaterial(petals = null) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, colorWrite: false });
    if (petals) material.positionNode = petalPlacement(petals).position;
    material.vertexNode = sunkDepth(2e-5);
    return material;
}

/** Give a mirrored mesh its depth-only twin (a child, so it follows every transform). */
function withDepthTwin(mesh, depthMaterial) {
    const twin = new THREE.Mesh(mesh.geometry, depthMaterial);
    twin.frustumCulled = false;
    twin.renderOrder = 4;
    mesh.add(twin);
    return mesh;
}

/**
 * Where a bloom vertex goes: it follows its own petal's matrix (`aPetal` picks it from `petals`).
 * The matrices hold a rotation and a uniform scale only, so their linear part carries normals too.
 */
function petalPlacement(petals) {
    const matrix = petals.element(int(attribute('aPetal', 'float').add(0.5)));
    return {
        position: matrix.mul(vec4(positionGeometry, 1)).xyz,
        normal: varying(mat3(matrix).mul(normalGeometry), 'vPetalNormal'),
    };
}

/**
 * Petal colour under the heart's light, for every ring (each ring's pigment comes from its
 * geometry). `mirror`: the same petals as the pond shows them, hidden behind the lily pads.
 */
function petalMaterial(u, light, petals, mirror, padField) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    if (mirror) asImage(material);
    const placement = petalPlacement(petals);
    material.positionNode = placement.position;
    material.colorNode = Fn(() => {
        // The petal's normal on the side we see, in world space, and how squarely it faces us.
        const normal = modelNormalMatrix.mul(placement.normal).normalize().mul(faceDirection).toVar();
        const toward = cameraViewMatrix.mul(vec4(normal, 0)).z.abs().min(1);
        const along = uv().y.toVar();
        const side = uv().x.mul(2).sub(1).toVar();
        const across = side.abs().toVar();
        const claw = attribute('aClaw', 'vec4').toVar();
        const ringGlow = claw.w;
        // Deep at the claw, rose through the body, a white blush toward the tip.
        const body = mix(claw.xyz, attribute('aBody', 'vec3'), smoothstep(0.0, 0.34, along));
        const pigment = mix(body, attribute('aTip', 'vec3'), smoothstep(0.55, 1.0, along)).toVar();
        // Veins fan out from the claw and meet again at the tip: lines of constant `side`.
        const veinWave = sin(side.mul(Math.PI * 8).add(sin(along.mul(15)).mul(0.1))).abs();
        const vein = fadeOut(0.0, 0.22, veinWave).mul(smoothstep(0.06, 0.25, along)).mul(fadeOut(0.85, 1.0, along)).toVar();
        const midrib = exp(side.mul(side).mul(-90)).mul(fadeOut(0.6, 0.95, along)).toVar();
        // The heart's light: softened inverse square, direct on the faces it sees, through the tissue
        // on the others. Light that passes through a petal comes out deeper and more saturated.
        const toHeart = (mirror ? light.mirror : light.heart).sub(positionWorld).toVar();
        const d2 = dot(toHeart, toHeart).toVar();
        const facing = dot(normal, toHeart.div(d2.max(1e-6).sqrt())).toVar();
        const lit = smoothstep(-0.3, 0.4, facing).toVar();
        const reach = light.glow.mul(ringGlow).div(d2.mul(30).add(1.5)).toVar();
        const tint = mix(pigment.mul(pigment).mul(1.5), pigment, lit);
        const veil = mix(float(1).sub(vein.mul(0.22)).sub(midrib.mul(0.2)), float(1).sub(vein.mul(0.06)), lit);
        const col = tint.mul(lit.mul(0.6).add(0.4)).mul(reach).mul(veil).toVar();
        // The whole flower is a lantern: a soft glow from within everywhere, hotter toward the claw.
        const inner = exp(along.mul(-3.0)).mul(0.36).add(0.1).mul(light.glow.mul(ringGlow).mul(0.25).add(0.32));
        col.addAssign(pigment.mul(inner).mul(veil));
        // Thin margins pass the most light.
        col.addAssign(pigment.mul(smoothstep(0.7, 1.0, across)).mul(reach).mul(0.25));
        // The night sky on whatever faces up.
        col.addAssign(SKYLIGHT.mul(normal.y.max(0)).mul(pigment.add(0.3)));
        // Fresnel rim, with a faint violet-to-gold sheen along the petal.
        const m = float(1).sub(toward).toVar();
        const rim = m.mul(m).mul(m).toVar();
        const sheen = mix(vec3(0.62, 0.5, 0.95), vec3(1.0, 0.78, 0.7), along);
        col.addAssign(sheen.mul(rim).mul(pigment.add(0.25)).mul(light.glow.mul(0.12).add(0.14)));
        return mirror ? underwater(col, u, light, padField) : col;
    })();
    return material;
}

/** The seed head: a flat-topped golden cup with a ring of seeds set into its face. */
function receptacleMaterial(u, light, mirror) {
    const material = new THREE.MeshBasicNodeMaterial();
    if (mirror) asImage(material);
    material.colorNode = Fn(() => {
        const top = smoothstep(0.018, 0.024, positionLocal.y).toVar();
        const face = positionLocal.xz.div(0.06).toVar();
        const seeds = float(0).toVar();
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * TAU;
            const d = face.sub(vec2(Math.cos(a) * 0.58, Math.sin(a) * 0.58)).length();
            seeds.assign(seeds.max(fadeOut(0.1, 0.17, d)));
        }
        seeds.assign(seeds.max(fadeOut(0.1, 0.17, face.length())));
        const face0 = mix(vec3(1.0, 0.82, 0.34), vec3(0.42, 0.36, 0.06), seeds.mul(0.85));
        const wall = mix(vec3(0.3, 0.34, 0.06), vec3(0.85, 0.66, 0.2), smoothstep(-0.02, 0.02, positionLocal.y));
        const col = mix(wall, face0, top).mul(light.glow.mul(1.1).add(0.3));
        return mirror ? underwater(col, u, light) : col;
    })();
    return material;
}

/** Filaments warm gold, anthers bright: the hottest light in the flower. */
function stamenMaterial(u, light, mirror) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    if (mirror) asImage(material);
    material.colorNode = Fn(() => {
        const t = uv().y;
        const col = mix(vec3(0.6, 0.3, 0.08), vec3(1.0, 0.8, 0.38), smoothstep(0.55, 0.85, t))
            .mul(smoothstep(0.55, 0.9, t).mul(1.6).add(0.45)).mul(light.glow.mul(0.9).add(0.2));
        return mirror ? underwater(col, u, light) : col;
    })();
    return material;
}

/** A soft halo of light around the heart, drawn over the petals: the flower glows from within. */
function haloSprite(u, light, { strength, depthTest }) {
    const material = new THREE.SpriteNodeMaterial({
        transparent: true, depthWrite: false, depthTest, blending: THREE.AdditiveBlending,
    });
    const r = uv().sub(0.5).length().mul(2)
        .toVar();
    // Closed, the light is spread through the bud; the bright core gathers only as it opens.
    const core = exp(r.mul(r).mul(-16)).mul(u.breathSoft.mul(0.8).add(0.2));
    const wide = exp(r.mul(r).mul(-4.5)).mul(fadeOut(0.6, 1.0, r));
    material.colorNode = GOLD.mul(core.mul(0.7)).add(vec3(1.0, 0.4, 0.55).mul(wide.mul(0.16)))
        .mul(light.glow.mul(strength));
    material.opacityNode = float(1);
    const sprite = new THREE.Sprite(material);
    sprite.frustumCulled = false;
    return sprite;
}

/**
 * Where every petal sits on the flower, fixed at build time: its ring, its turn about the stem
 * (each ring in the gaps of the one outside it), a little twist and size, and its own phase for
 * the idle sway. Ordered ring by ring, as the bloom geometry is built.
 */
function petalLayout() {
    return RINGS.flatMap((ring, ringIndex) => Array.from({ length: ring.count }, (_, i) => ({
        ring,
        order: Math.max(0, ringIndex - 1) / (RINGS.length - 2),
        turn: ((i + (ringIndex % 2) * 0.5) / ring.count) * TAU + Math.sin(i * 3.7 + ringIndex) * 0.07,
        twist: Math.sin(i * 5.3 + ringIndex * 2.1) * 0.06,
        size: 1 + Math.sin(i * 2.9 + ringIndex * 4.1) * 0.05,
        sway: i * 1.7 + ringIndex * 0.9,
        jitter: Math.sin(i * 7.1 + ringIndex * 1.3) * 0.035,
    })));
}

/** Every petal of every ring in one geometry; `aPetal` says which matrix each vertex follows. */
function bloomGeometry() {
    const parts = [];
    RINGS.forEach((ring) => {
        const petal = petalGeometry(ring);
        for (let i = 0; i < ring.count; i++) {
            const part = petal.clone();
            part.setAttribute('aPetal', new THREE.BufferAttribute(new Float32Array(petal.attributes.position.count).fill(parts.length), 1));
            parts.push(part);
        }
        petal.dispose();
    });
    const bloom = mergeGeometries(parts);
    parts.forEach((part) => part.dispose());
    return bloom;
}

const _spin = new THREE.Quaternion();
const _hinge = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** A petal's matrix in the flower: turned about the stem, then hinged outward by `angle` from its claw. */
function placePetal(target, petal, angle) {
    const { ring } = petal;
    _spin.setFromAxisAngle(_up, petal.turn);
    _position.set(0, ring.lift, ring.hinge).applyQuaternion(_spin);
    _hinge.setFromEuler(_euler.set(angle, 0, petal.twist)).premultiply(_spin);
    return target.compose(_position, _hinge, _scale.setScalar(petal.size));
}

/**
 * One flower: the bloom (every petal in one draw), the seed head with its stamens, and the halo.
 * `petals` holds the petal matrices, shared with the other flower: the image differs only by its
 * mirrored parent.
 */
function buildFlower(u, light, geometries, petals, mirror, padField) {
    const tilt = new THREE.Group();
    const body = new THREE.Group();
    tilt.add(body);
    const bloom = new THREE.Mesh(geometries.bloom, petalMaterial(u, light, petals, mirror, padField));
    const seedHead = new THREE.Mesh(geometries.receptacle, receptacleMaterial(u, light, mirror));
    seedHead.position.y = HEART_HEIGHT - 0.024;
    const stamens = new THREE.Mesh(geometries.stamens, stamenMaterial(u, light, mirror));
    stamens.position.y = HEART_HEIGHT - 0.04;
    // The image draws first (its depth-only twins before it), then the flower, then the halo over all.
    [bloom, seedHead, stamens].forEach((mesh) => {
        mesh.frustumCulled = false;
        mesh.renderOrder = mirror ? 5 : 10;
        body.add(mesh);
    });
    if (mirror) {
        withDepthTwin(bloom, imageDepthMaterial(petals));
        const depthMaterial = imageDepthMaterial();
        withDepthTwin(seedHead, depthMaterial);
        withDepthTwin(stamens, depthMaterial);
    }
    const halo = haloSprite(u, light, mirror ? { strength: 0.08, depthTest: true } : { strength: 0.28, depthTest: false });
    halo.position.y = HEART_HEIGHT + 0.01;
    halo.renderOrder = mirror ? 6 : 12;
    body.add(halo);
    return {
        tilt, body, stamens, halo,
    };
}

/**
 * The lotus and its reflection.
 * @param {object} u breath uniforms
 * @param {{ waterline: number, scale: number, padField: Function }} options flower base height (hero
 *   units), size, and the pond's lily pads (they hide the reflection where they lie in front of it)
 */
export function createLotus(u, { waterline, scale, padField }) {
    const light = {
        /** The heart, in world space, and its image under the water. */
        heart: uniform(new THREE.Vector3(0, waterline, 0)),
        mirror: uniform(new THREE.Vector3(0, waterline, 0)),
        /** The heart on screen at rest (hero units), for the painted glow. */
        screen: uniform(new THREE.Vector2(0, waterline)),
        /** The water plane (normal, offset) the mirror is taken about. */
        plane: uniform(new THREE.Vector4(0, 1, 0, waterline)),
        /** The heart's brightness: swells with the breath. */
        glow: uniform(1),
    };
    const geometries = {
        bloom: bloomGeometry(),
        receptacle: new THREE.CylinderGeometry(0.058, 0.036, 0.048, 32, 1),
        stamens: stamenGeometry(56, 0.05, 0.065, 0.005),
    };
    // Every petal's matrix, written once a frame and read by the flower and its image alike.
    const layout = petalLayout();
    const matrices = layout.map(() => new THREE.Matrix4());
    const petals = uniformArray(matrices, 'mat4');
    const flower = buildFlower(u, light, geometries, petals, false, null);
    const image = buildFlower(u, light, geometries, petals, true, padField);
    flower.tilt.scale.setScalar(scale);
    flower.tilt.position.set(0, waterline, 0);
    image.tilt.scale.set(scale, -scale, scale);
    image.tilt.position.set(0, waterline, 0);

    const heartLocal = new THREE.Vector3(0, HEART_HEIGHT, 0);
    const heartWorld = new THREE.Vector3();

    /**
     * @param {{ time: number, breath: number, glow: number, elevation: number }} state
     *   elevation: the angle (radians) we look down onto the pond; the flower tilts toward us by it.
     */
    function update({
        time, breath, glow, elevation,
    }) {
        // Outer rings lead the opening and inner rings lead the folding: the bloom unfolds in order.
        layout.forEach((petal, index) => {
            const { ring } = petal;
            const lead = Math.min(1, Math.max(0, breath * 1.3 - petal.order * 0.3 + petal.jitter));
            const eased = ring.still ? breath : lead * lead * (3 - 2 * lead);
            const angle = ring.closed + (ring.open - ring.closed) * eased + Math.sin(time * 0.33 + petal.sway) * 0.016;
            placePetal(matrices[index], petal, angle);
        });
        [flower, image].forEach((side) => {
            // The stamens spread as the inner petals let them.
            const spread = 0.7 + 0.4 * breath;
            side.stamens.scale.set(spread, 0.8 + 0.25 * breath, spread);
            // Closed, the light fills the bud like a lantern; open, it gathers on the seed head.
            side.halo.scale.setScalar(0.42 + 0.14 * glow + 0.08 * breath);
            side.halo.position.y = HEART_HEIGHT + 0.01 + (1 - breath) * 0.13;
            // A slow turn about the stem and the faint rocking of something afloat.
            side.body.rotation.set(Math.sin(time * 0.37) * 0.016, time * 0.012, Math.sin(time * 0.29 + 1.3) * 0.02);
        });
        light.glow.value = glow;

        // The water plane passes through the flower's base, square to its axis. Reflecting through it
        // is the same as flipping the flower along its own axis: the image is the flower, tilted the
        // same way, scaled by -1 in y (three flips the winding of mirrored meshes itself).
        [flower, image].forEach((side) => {
            side.tilt.rotation.set(elevation, 0, 0);
            side.tilt.updateMatrix();
            side.body.updateMatrix();
        });
        const ny = Math.cos(elevation);
        const nz = Math.sin(elevation);
        light.plane.value.set(0, ny, nz, ny * waterline);
        heartWorld.copy(heartLocal).applyMatrix4(flower.body.matrix).applyMatrix4(flower.tilt.matrix);
        light.heart.value.copy(heartWorld);
        light.mirror.value.copy(heartLocal).applyMatrix4(image.body.matrix).applyMatrix4(image.tilt.matrix);
    }

    /** The heart's screen position (hero units) for a camera at rest `distance` from the z = 0 plane. */
    function heartOnScreen(focus, distance) {
        const k = distance / Math.max(distance - heartWorld.z, 0.1);
        light.screen.value.set(heartWorld.x * k, (heartWorld.y + focus) * k - focus);
    }

    // Closed and at rest until the first frame poses it (the petal matrices start as identities).
    update({
        time: 0, breath: 0, glow: 1, elevation: Math.PI / 6,
    });

    return {
        objects: [flower.tilt, image.tilt],
        light,
        update,
        heartOnScreen,
        dispose() {
            geometries.bloom.dispose();
            geometries.receptacle.dispose();
            geometries.stamens.dispose();
        },
    };
}
