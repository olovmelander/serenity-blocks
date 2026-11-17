/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE SUMMIT'S CAP — lenticular cloud standing in the lee of the hero summit through chapter 5's
 * evening (the sky pass, 2026-11-17; the evening is odyssey-evening.js).
 *
 * The climb looks up at one summit for five orbs. A summit in a gale wears more than a banner:
 * where the wind rides up over the peak and down its lee, the air's wave condenses into smooth
 * lens-shaped clouds that stand still while the wind blows through them, stacked like plates,
 * forming and thinning away with the wave. They are the cloud a low sun paints best: gold, then
 * rose on the side turned to it and along their thin rims, the sky's violet beneath.
 *
 * Three lenses in one instanced draw, each a closed smooth hull (a disc whose top and bottom
 * close to nothing at the rim): OPAQUE, in the field's two painted tones, depth-tested against
 * the mountain and the banner's plume. They stand over the lee side, downwind of the tip, where
 * the rail never goes (it passes ~280 u away at the top of the climb).
 *
 * ALIVE. Each lens swells from a thin wisp to its full plate and thins away again on its own
 * period (`life`), out of step with the others, so the stack is never the same twice: sometimes
 * one great plate, sometimes three. A lens that is gone has no thickness and no size: it leaves
 * as lenticular cloud does, by thinning, not by fading.
 *
 * COST: 3 instances x ~1.5k triangles, one opaque draw, no textures. Hidden outside the evening.
 */
import * as THREE from 'three/webgpu';
import {
    abs, attribute, clamp, dot, float, length, max, mix, normalize, positionGeometry, sin, smoothstep, uniform,
    varying, vec2, vec3,
} from 'three/tsl';
import { ODYSSEY_EVENING_U, eveningCloudLitShare } from './odyssey-evening.js';

export const ODYSSEY_SUMMIT_CAP = Object.freeze({
    /** Downwind (unit x/z): the summit's wind, toward west-north-west. */
    wind: Object.freeze([-0.928, -0.373]),
    /** The stack's foot: this far downwind of the tip and this far above it (u). */
    lee: 250,
    lift: 150,
    /** How far each lens is drawn out along the wind (x its radius), and the stack's lean downwind
     * per unit of height. */
    stretch: 1.30,
    lean: 0.55,
    /**
     * The lenses: radius, half-thickness, height over the stack's foot (u), and their lives:
     * period (s) and phase (turns). Biggest at the bottom, as a stack of plates stands.
     */
    lenses: Object.freeze([
        Object.freeze({
            radius: 124, half: 13, y: 0, period: 131, phase: 0.08,
        }),
        Object.freeze({
            radius: 90, half: 10, y: 32, period: 97, phase: 0.46,
        }),
        Object.freeze({
            radius: 58, half: 8, y: 58, period: 73, phase: 0.81,
        }),
    ]),
    /** Rings and segments of one lens's disc (each side). */
    rings: 9,
    segments: 40,
    /** How much of a life a lens is whole for: `sin` lifted by this, clamped (0 = half its life). */
    dwell: 0.35,
});

/**
 * A lens's size through its life: 0 (gone) .. 1 (whole). Pure; the material's twin.
 * @param {number} time seconds
 * @param {{period:number, phase:number}} lens
 */
export function summitCapLife(time, lens) {
    const s = 0.5 + ((0.5 + ODYSSEY_SUMMIT_CAP.dwell) * Math.sin(2 * Math.PI * ((time / lens.period) + lens.phase)));
    const c = Math.min(Math.max(s, 0), 1);
    return c * c * (3 - (2 * c));
}

/** One lens: a disc of `rings` x `segments`, its top and bottom closing to nothing at the rim. */
function buildLensGeometry(rings, segments) {
    const positions = [];
    const normals = [];
    const indices = [];
    // A lens's profile: full in the middle, closing smoothly and thin at the rim.
    const profile = (r) => (1 - (r * r)) ** 1.5;
    const slope = (r) => -3 * r * Math.sqrt(Math.max(1 - (r * r), 0));
    [1, -1].forEach((side) => {
        const base = positions.length / 3;
        positions.push(0, side, 0);
        normals.push(0, side, 0);
        for (let i = 1; i <= rings; i += 1) {
            // Rings crowd toward the rim, where the profile turns fastest.
            const r = Math.sin(((i / rings) * Math.PI) / 2);
            for (let j = 0; j < segments; j += 1) {
                const a = (j / segments) * Math.PI * 2;
                positions.push(Math.cos(a) * r, side * profile(r), Math.sin(a) * r);
                // The unit lens's normal (radius 1, half-thickness 1); the material rescales it.
                const dydr = side * slope(r);
                const len = Math.hypot(dydr, 1);
                const out = (-dydr * side) / len;
                normals.push(out * Math.cos(a), side / len, out * Math.sin(a));
            }
        }
        for (let j = 0; j < segments; j += 1) {
            const a = base + 1 + j;
            const b = base + 1 + ((j + 1) % segments);
            if (side > 0) indices.push(base, b, a); else indices.push(base, a, b);
        }
        for (let i = 1; i < rings; i += 1) {
            for (let j = 0; j < segments; j += 1) {
                const a = base + 1 + ((i - 1) * segments) + j;
                const b = base + 1 + ((i - 1) * segments) + ((j + 1) % segments);
                const c = a + segments;
                const d = b + segments;
                if (side > 0) indices.push(a, b, c, b, d, c); else indices.push(a, c, b, b, c, d);
            }
        }
    });
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    return geometry;
}

/**
 * @param {object} kit the world's own nodes and paint (as the cloud sea takes them)
 * @param {{x:number,y:number,z:number}} kit.summit the hero summit's tip (world)
 * @param {object} kit.cameraPosition vec3 node: the eye, in the world group's own frame
 * @param {(dir: object) => object} kit.skyAirAt
 * @param {(colour: object) => object} kit.toCloudOutput
 * @param {object} kit.sunColour vec3 node
 * @param {object} kit.cloudWhite vec3 node
 * @returns {{mesh: THREE.Mesh, update: (time: number, reveal: number, shown: boolean) => void, dispose: () => void}}
 */
export function createOdysseySummitCap({
    summit, cameraPosition, skyAirAt, toCloudOutput, sunColour, cloudWhite,
}) {
    const C = ODYSSEY_SUMMIT_CAP;
    const E = ODYSSEY_EVENING_U;
    const geometry = buildLensGeometry(C.rings, C.segments);
    const rows = new Float32Array(C.lenses.length * 4);
    const lives = new Float32Array(C.lenses.length * 2);
    C.lenses.forEach((l, i) => {
        rows.set([l.radius, l.half, l.y, i], i * 4);
        lives.set([l.period, l.phase], i * 2);
    });
    geometry.setAttribute('aLens', new THREE.InstancedBufferAttribute(rows, 4));
    geometry.setAttribute('aLife', new THREE.InstancedBufferAttribute(lives, 2));
    geometry.instanceCount = C.lenses.length;

    const uTime = uniform(0);
    const uReveal = uniform(0);
    const aLens = attribute('aLens', 'vec4');
    const aLife = attribute('aLife', 'vec2');
    const wind = vec2(...C.wind);

    // A lens's life (the twin of `summitCapLife`), times the evening's reveal.
    const raw = sin(uTime.div(aLife.x).add(aLife.y).mul(6.2831853)).mul(0.5 + C.dwell).add(0.5).clamp(0, 1);
    const life = raw.mul(raw).mul(float(3).sub(raw.mul(2))).mul(uReveal);
    const radius = aLens.x.mul(life.mul(0.72).add(0.28));
    const half = aLens.y.mul(life);
    // The lens in the world: drawn out along the wind, leaning downwind as it stands higher,
    // rocking a little on the wave that makes it.
    const rock = sin(uTime.mul(0.11).add(aLens.w.mul(2.1))).mul(0.035);
    const alongLocal = positionGeometry.x.mul(radius).mul(C.stretch);
    const acrossLocal = positionGeometry.z.mul(radius);
    const upLocal = positionGeometry.y.mul(half).add(alongLocal.mul(rock));
    const foot = vec3(
        summit.x + (C.wind[0] * C.lee),
        summit.y + C.lift,
        summit.z + (C.wind[1] * C.lee),
    );
    const leanOut = aLens.z.mul(C.lean);
    const place = () => vec3(
        foot.x.add(wind.x.mul(alongLocal.add(leanOut))).sub(wind.y.mul(acrossLocal)),
        foot.y.add(aLens.z).add(upLocal),
        foot.z.add(wind.y.mul(alongLocal.add(leanOut))).add(wind.x.mul(acrossLocal)),
    );
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OdysseySummitCap';
    material.fog = false;
    material.side = THREE.FrontSide;
    material.positionNode = place();
    const vWorld = varying(place(), 'capWorld');
    // The unit lens's normal, rescaled to this lens's own shape and turned to the wind.
    const nLocal = vec3(
        attribute('normal', 'vec3').x.div(max(radius.mul(C.stretch), float(1))),
        attribute('normal', 'vec3').y.div(max(half, float(0.5))),
        attribute('normal', 'vec3').z.div(max(radius, float(1))),
    );
    const vNormal = varying(normalize(vec3(
        wind.x.mul(nLocal.x).sub(wind.y.mul(nLocal.z)),
        nLocal.y,
        wind.y.mul(nLocal.x).add(wind.x.mul(nLocal.z)),
    )), 'capNormal');

    const vRing = varying(length(positionGeometry.xz), 'capRing');
    const n = normalize(vNormal);
    const toEye = cameraPosition.sub(vWorld);
    const v = toEye.div(max(length(toEye), float(0.001)));
    // Lit where it turns to the sun (a wide wrap: a thin cloud is lit through), and by the low
    // sun from beneath on the sun's side: the lens's belly glows at the day's end.
    const wrap = clamp(dot(n, E.sunDir).add(0.55).div(1.55), 0, 1);
    const sunFlat = normalize(E.sunDir.xz);
    // The belly: a lens is thin, and a low sun shines along and through it, so what the climb
    // looks up at is LIT: brightest toward the sun's side, easing to the sky's violet on the far
    // side. Smooth, not stepped: a lenticular's satin is the one cloud here without lobes.
    const sunSide = dot(normalize(vWorld.xz.sub(vec2(foot.x, foot.z)).add(vec2(1e-3, 0))), sunFlat).mul(0.5).add(0.5);
    const under = float(1).sub(smoothstep(float(-0.5), float(0.15), n.y));
    // (its thick middle a step darker than its thin rim, which is how a lens shows its depth)
    const core = float(1).sub(smoothstep(float(0.25), float(0.85), vRing));
    const belly = under.mul(sunSide.mul(0.62).add(0.30).add(E.dusk.mul(0.10)).sub(core.mul(0.22)));
    const tone = max(smoothstep(float(0.34), float(0.66), wrap), belly);
    const lit = mix(sunColour, cloudWhite, eveningCloudLitShare(0.60)).mul(1.12);
    const skyUnder = skyAirAt(normalize(vec3(n.x, max(n.y, float(0.35)), n.z)));
    const slate = mix(cloudWhite.mul(0.84), skyUnder, float(0.46));
    const body = mix(slate, lit, tone);
    // The thin rim: brighter where it faces the sun (light through the thinnest cloud), and its
    // last pixels melting into the sky behind, so the plate's outline is soft as a lens's is.
    const rim = float(1).sub(abs(dot(n, v)));
    const silver = smoothstep(float(0.55), float(0.95), rim).mul(clamp(dot(n, E.sunDir).add(0.5), 0, 1)).mul(0.5);
    const melt = smoothstep(float(0.90), float(0.995), rim).mul(0.5);
    const colour = mix(mix(body, lit.mul(1.04), silver), mix(skyAirAt(v.negate()), cloudWhite, float(0.5)), melt);
    material.colorNode = toCloudOutput(colour);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-world-summit-cap';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;

    return {
        mesh,
        uniforms: { uTime, uReveal },
        /**
         * @param {number} time seconds
         * @param {number} reveal 0..1 (the evening's `cap`)
         * @param {boolean} shown whether the world lets it draw
         */
        update(time, reveal, shown) {
            // Wrapped at a common multiple of the lives' periods' order of magnitude: the lives
            // read time / period, so the wrap only has to be long, and float-exact.
            uTime.value = (Number.isFinite(time) ? time : 0) % 86400;
            const r = Math.min(Math.max(Number.isFinite(reveal) ? reveal : 0, 0), 1);
            uReveal.value = r;
            mesh.visible = !!shown && r > 0.001;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.removeFromParent();
        },
    };
}
