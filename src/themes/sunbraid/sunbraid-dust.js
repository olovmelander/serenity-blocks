/**
 * Sunbraid — the dust play raises off the plain: twisters and dust rings.
 *
 * A twister: a twist turns the braid, and on the plain beside the board the air turns with it: a
 * dust devil of white gypsum, narrow at its foot and opening upward, leaning with the ground wind
 * and walking slowly downwind. It stands in the light of three suns, so it throws three coloured
 * shadows that sweep the tiles as it walks (the world writes it into the shadow rows as a faint
 * cylinder, sunbraid-tsl.js sunVisibility). The wind weather raises one far out on its own now
 * and then.
 *
 * One tall quad a twister, turned to face the eye about the vertical, in rows so it can lean and
 * snake. The fragment treats the quad as the column seen from the side: across it, the chord
 * through a hollow tube (the dust is in the wall); on it, streaks wound round the tube, read once
 * for the wall facing the eye and once for the wall behind, which crosses the quad the other way:
 * that is what reads as turning (one read scrolled sideways is a conveyor).
 *
 * A dust ring: a hard drop strikes the plain and throws up a low ring of dust that runs out with
 * the ripple in the tiles and settles: a band standing on a circle, leaning outward as it goes.
 *
 * Both are things, not light: a lit colour with its own cover, blended as light plus cover, so
 * they show against the bright floor and sky and hide what is behind them. Every slot is always
 * drawn (a dormant one has no size), so nothing compiles at the moment of an event.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, asin, attribute, clamp, cross, dot, exp, float, max, mix, normalize, positionGeometry, sin,
    smoothstep, texture, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { groundHeight } from './sunbraid-plan.js';

/** Twisters standing at once (a second twist while one stands raises another). */
export const TWISTERS = 3;
/**
 * A twister: it rises over `rise` s and thins away over its last `fade` s; it walks downwind at
 * `walk` m/s; how much of a sun's light its column takes from the floor behind it (`shade`), and
 * how much wider than its waist its shadow is cast (`girth`).
 */
export const TWISTER = Object.freeze({
    rise: 1.2, fade: 2.8, walk: 7, shade: 0.5, girth: 1.5,
});
/** Dust rings at once. */
export const DUST_RINGS = 4;
/** The quad's rows up a twister, and how much wider it is than the column (room for a soft edge). */
const ROWS = 22;
const MARGIN = 1.3;
/** A dust ring's segments round the circle. */
const RING_SEGMENTS = 56;

/** The column's half-width at height share `v` (0 the foot … 1 the top), as a share of its radius. */
const widthAt = (v) => v.pow(0.9).mul(1.25).add(0.5).add(exp(v.mul(-13.0)).mul(1.4));

/** Light plus cover: the dust adds its own lit colour and hides what is behind it by its cover. */
function lightAndCover(material) {
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendEquationAlpha = THREE.AddEquation;
    material.blendSrcAlpha = THREE.ZeroFactor;
    material.blendDstAlpha = THREE.OneFactor;
    material.premultipliedAlpha = true;
    material.side = THREE.DoubleSide;
    material.fog = false;
    return material;
}

/**
 * The light on dust standing at `centre` (a share `v` up its column): each sun's light sent on
 * toward the eye (the suns stand in front of the lens: dust between glows), the dome's fill, and
 * the glare off the white floor on its lower part.
 */
function dustLight(u, centre, v) {
    const V = normalize(centre.sub(u.eye));
    const sent = (S) => {
        const ahead = clamp(dot(V, S), 0.0, 1.0);
        const a2 = ahead.mul(ahead);
        return a2.mul(a2).mul(1.1).add(a2.mul(0.4)).add(0.3);
    };
    return u.col0.mul(sent(u.sun0)).add(u.col1.mul(sent(u.sun1))).add(u.col2.mul(sent(u.sun2))).mul(0.3)
        .add(mix(u.horizon, u.zenith, 0.4).mul(0.9))
        .add(u.groundLit.mul(float(1.0).sub(v).mul(0.16)));
}

function createTwisters(u, t) {
    const plane = new THREE.PlaneGeometry(2, 1, 1, ROWS);
    plane.translate(0, 0.5, 0);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.attributes.position);
    // Per twister: foot (x, y, z) and age; height, radius, spin (signed) and power (0 = dormant).
    const rows = new Float32Array(TWISTERS * 8);
    const buffer = new THREE.InstancedInterleavedBuffer(rows, 8, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aFoot', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('aColumn', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geometry.instanceCount = TWISTERS;

    const material = lightAndCover(new THREE.MeshBasicNodeMaterial());
    material.name = 'SunbraidTwister';
    const aFoot = attribute('aFoot', 'vec4');
    const aColumn = attribute('aColumn', 'vec4');
    const vAt = varying(vec4(0.0), 'sbTwisterAt'); // across (−MARGIN..MARGIN), up 0..1, age, power
    const vLight = varying(vec4(0.0), 'sbTwisterLight'); // the dust's light, which side the suns are on
    const vTurn = varying(vec2(0.0), 'sbTwisterTurn'); // spin, seed
    material.positionNode = Fn(() => {
        const p = positionGeometry;
        const v = p.y.toVar();
        const age = aFoot.w.toVar();
        const height = aColumn.x;
        const radius = aColumn.y;
        // It rises out of the floor.
        const grown = smoothstep(0.0, TWISTER.rise, age).mul(0.82).add(0.18);
        const foot = aFoot.xyz.toVar();
        const toEye = u.eye.sub(foot);
        const level = cross(vec3(0.0, 1.0, 0.0), vec3(toEye.x, 0.0, toEye.z));
        const across = normalize(level.add(vec3(1e-5, 0.0, 0.0))).toVar();
        const seed = aFoot.x.mul(0.37).add(aFoot.z.mul(0.11)).toVar();
        // The column leans downwind more the higher it stands, and snakes as it turns.
        const lean = vec3(u.gustAlong.x, 0.0, u.gustAlong.y).mul(v.mul(v).mul(height).mul(0.2).mul(u.wind.add(0.35)));
        const snake = across.mul(sin(v.mul(5.2).add(age.mul(1.7)).add(seed)).mul(v).mul(radius).mul(0.55));
        const half = widthAt(v).mul(radius).mul(MARGIN);
        const centre = foot.add(vec3(0.0, v.mul(height).mul(grown), 0.0)).add(lean).add(snake).toVar();
        vAt.assign(vec4(p.x.mul(MARGIN), v, age, aColumn.w));
        vTurn.assign(vec2(aColumn.z, seed));
        vLight.assign(vec4(dustLight(u, centre, v), dot(u.centre, across)));
        return centre.add(across.mul(p.x.mul(half)));
    })();
    material.colorNode = Fn(() => {
        const x = vAt.x.toVar();
        const v = vAt.y.toVar();
        const age = vAt.z.toVar();
        const ax = x.abs().toVar();
        // Across the column: a hollow tube seen side on. Its wall is where the dust is, so the
        // sight line through the rim crosses the most of it and the one through the eye the least.
        const inside = float(1.0).sub(smoothstep(0.7, 1.0, ax));
        const rim = ax.mul(ax).mul(0.45).add(0.55);
        // The streaks wound round it: the near wall (angle asin x) and the far wall (pi minus it),
        // both carried round by the spin, so the near one crosses the quad one way and the far one
        // the other. They climb as they turn (a helix), tighter toward the foot.
        const theta = asin(clamp(x, -1.0, 1.0)).div(3.1416);
        const run = age.mul(vTurn.x).mul(0.11);
        const helix = v.mul(1.6).add(vTurn.y);
        const climb = v.mul(2.4).sub(age.mul(0.42));
        // (Read blurred: a column a hundred pixels across shows the baked noise's finest octave
        // as a pattern of diamonds.)
        const near = texture(t.noise, vec2(theta.mul(0.5).add(helix).sub(run), climb)).bias(1.4).g.toVar();
        const far = texture(t.noise, vec2(float(0.5).sub(theta.mul(0.5)).add(helix).sub(run), climb.add(0.37)))
            .bias(1.4).g;
        const streaks = smoothstep(0.36, 0.62, near).mul(0.62).add(smoothstep(0.36, 0.62, far).mul(0.38)).toVar();
        // Its top frays into the air (unevenly); its foot stands in the dust it is lifting.
        const top = float(1.0).sub(smoothstep(0.42, 1.0, v.add(near.sub(0.5).mul(0.5))));
        const base = smoothstep(0.0, 0.05, v);
        const lived = smoothstep(0.0, 0.7, age);
        const cover = inside.mul(rim).mul(streaks.mul(0.8).add(0.2)).mul(top).mul(base)
            .mul(lived)
            .mul(vAt.w)
            .mul(1.5)
            .clamp(0.0, 0.9);
        // White gypsum dust; the side toward the suns lighter, the other in its own shade (a
        // column, not a card).
        const tone = mix(vec3(0.6, 0.58, 0.6), vec3(0.95, 0.93, 0.89), streaks);
        const side = x.mul(vLight.w.sign()).mul(vLight.w.abs().min(1.0)).mul(0.28).add(0.86);
        return vec4(tone.mul(vLight.xyz).mul(side).mul(cover), cover);
    })();
    material.outputNode = material.colorNode;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Sunbraid twisters';
    mesh.frustumCulled = false;
    mesh.renderOrder = 22;
    return {
        mesh, geometry, material, plane, rows, buffer,
    };
}

function createDustRings(u, t) {
    const position = [];
    const round = [];
    const index = [];
    for (let i = 0; i <= RING_SEGMENTS; i++) {
        const a = (i / RING_SEGMENTS) * Math.PI * 2;
        position.push(Math.cos(a), 0, Math.sin(a), Math.cos(a), 1, Math.sin(a));
        round.push(i / RING_SEGMENTS, i / RING_SEGMENTS);
    }
    for (let i = 0; i < RING_SEGMENTS; i++) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    // How far round the circle a vertex stands (turns).
    geometry.setAttribute('aRound', new THREE.Float32BufferAttribute(round, 1));
    geometry.setIndex(index);
    // Per ring: centre (x, y, z) and age; reach (m), life (s), height (m), power (0 = dormant).
    const rows = new Float32Array(DUST_RINGS * 8);
    const buffer = new THREE.InstancedInterleavedBuffer(rows, 8, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aRing', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('aThrow', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geometry.instanceCount = DUST_RINGS;

    const material = lightAndCover(new THREE.MeshBasicNodeMaterial());
    material.name = 'SunbraidDustRing';
    const aRing = attribute('aRing', 'vec4');
    const aThrow = attribute('aThrow', 'vec4');
    const vRing = varying(vec4(0.0), 'sbRingAt'); // round the circle (turns), up 0..1, how far through its life, power
    const vRingLight = varying(vec3(0.0), 'sbRingLight');
    material.positionNode = Fn(() => {
        const p = positionGeometry;
        const v = p.y.toVar();
        const through = clamp(aRing.w.div(max(aThrow.y, 0.05)), 0.0, 1.0).toVar();
        // It runs out fast and slows (with the ripple in the tiles), rising as it goes and
        // leaning outward at its top.
        const run = float(1.0).sub(float(1.0).sub(through).mul(float(1.0).sub(through)));
        const height = aThrow.z.mul(through.mul(0.7).add(0.3));
        const radius = aThrow.x.mul(run).add(v.mul(height).mul(0.7));
        const centre = aRing.xyz.add(vec3(p.x.mul(radius), v.mul(height), p.z.mul(radius))).toVar();
        vRing.assign(vec4(attribute('aRound', 'float'), v, through, aThrow.w));
        vRingLight.assign(dustLight(u, centre, v));
        return centre;
    })();
    material.colorNode = Fn(() => {
        const v = vRing.y.toVar();
        const through = vRing.z.toVar();
        // Billows round the ring, rising as it ages; thick low down, frayed at the top.
        const puff = texture(t.noise, vec2(vRing.x.mul(7.0), v.mul(0.8).sub(through.mul(0.6)))).bias(1.0).g.toVar();
        const wisp = texture(t.noise, vec2(vRing.x.mul(19.0).add(0.4), v.mul(1.7).sub(through.mul(1.1)))).bias(1.0).b;
        const body = smoothstep(0.3, 0.62, puff.mul(0.65).add(wisp.mul(0.35)));
        const up = smoothstep(0.0, 0.12, v).mul(float(1.0).sub(smoothstep(0.3, 1.0, v.add(puff.sub(0.5).mul(0.5)))));
        const lived = smoothstep(0.0, 0.08, through).mul(float(1.0).sub(through).pow(1.3));
        const cover = body.mul(up).mul(lived).mul(vRing.w).mul(1.25)
            .clamp(0.0, 0.8);
        const tone = mix(vec3(0.66, 0.64, 0.66), vec3(0.96, 0.94, 0.9), puff);
        return vec4(tone.mul(vRingLight).mul(cover), cover);
    })();
    material.outputNode = material.colorNode;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Sunbraid dust rings';
    mesh.frustumCulled = false;
    mesh.renderOrder = 21;
    return {
        mesh, geometry, material, rows, buffer,
    };
}

/**
 * The dust part: the twisters and the dust rings. `update` reads the world's `twisters` and
 * `dustRings` (fixed slots: { at, life, … }) and writes what shows.
 */
export function createDust(u, t) {
    const twisters = createTwisters(u, t);
    const rings = createDustRings(u, t);
    return {
        mesh: twisters.mesh,
        meshes: [rings.mesh, twisters.mesh],
        twisterMaterial: twisters.material,
        ringMaterial: rings.material,
        update(time, dt, world) {
            const calm = world.reducedMotion ? 0.35 : 1;
            world.twisters.forEach((d, i) => {
                const o = i * 8;
                const age = time - d.at;
                const live = d.power > 0 && age >= 0 && age < d.life;
                const fade = live ? 1 - Math.min(1, Math.max(0, (age - (d.life - TWISTER.fade)) / TWISTER.fade)) : 0;
                const x = d.x + (live ? d.wx * age : 0);
                const z = d.z + (live ? d.wz * age : 0);
                twisters.rows[o] = x;
                twisters.rows[o + 1] = groundHeight(x, z) + 0.2;
                twisters.rows[o + 2] = z;
                twisters.rows[o + 3] = live ? age : 0;
                twisters.rows[o + 4] = d.height;
                twisters.rows[o + 5] = live ? d.radius : 0;
                twisters.rows[o + 6] = d.spin * calm;
                twisters.rows[o + 7] = live ? d.power * fade : 0;
            });
            twisters.buffer.needsUpdate = true;
            world.dustRings.forEach((d, i) => {
                const o = i * 8;
                const age = time - d.at;
                const live = d.power > 0 && age >= 0 && age < d.life;
                rings.rows[o] = d.x;
                rings.rows[o + 1] = groundHeight(d.x, d.z) + 0.1;
                rings.rows[o + 2] = d.z;
                rings.rows[o + 3] = live ? age : 0;
                rings.rows[o + 4] = live ? d.reach : 0;
                rings.rows[o + 5] = d.life;
                rings.rows[o + 6] = d.height;
                rings.rows[o + 7] = live ? d.power : 0;
            });
            rings.buffer.needsUpdate = true;
        },
        dispose() {
            twisters.geometry.dispose();
            twisters.plane.dispose();
            twisters.material.dispose();
            rings.geometry.dispose();
            rings.material.dispose();
        },
    };
}
