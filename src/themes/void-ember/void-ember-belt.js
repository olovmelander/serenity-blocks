/**
 * Void Ember — the cinder belt and the cinder world: what the ember still lights.
 *
 * The belt is the wreck of whatever once circled this star: a few thousand stones on their own
 * orbits, seen almost edge-on, the near arc crossing the star's lower face as black shapes and the
 * far arc going behind it. They are six asteroids sculpted in Blender (void-ember-stone-models.js,
 * written by scripts/blender/void_ember_stones.py): a bent potato with a saddle crater, a contact
 * binary, a splinter, a spinning-top rubble pile, a slab of layered crust and half a shell with a
 * bowl bitten out of it, each stretched its own way, with its craters' shadows and the dust on its
 * crests baked into its vertices. Most ride the field on Kepler orbits; a fifth of them ride in
 * three families, a parent boulder and its debris, that come round the near arc every few minutes.
 * Nothing lights them but the star, so each is a sliver of ember light with the dark behind it,
 * and they brighten as play blows the star up. When a clear's wave reaches a stone it flashes in
 * the wave's colour and is shoved outward; then the face it turns to the star glows like iron
 * cooling, its hollows hold the heat and a fracture or two burns for a few seconds.
 *
 * The cinder world is one dead planet far out on the other side of the board, backlit: a thin
 * crescent, a breath of atmosphere past the terminator, old lava still glowing in the fractures of
 * its night side when the star is hot, and one great wound, a basin whose floor never quite
 * cooled, that its turning brings round every few minutes. A small moon circles it, now a black
 * dot on its face, now a sliver beside it, now gone behind.
 *
 * Orbit, tumble and the wave's shove are closed forms of the clock: no per-frame CPU work, and a
 * seek reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    dFdx,
    dFdy,
    dot,
    exp,
    float,
    length,
    max,
    min,
    mix,
    normalGeometry,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    sign,
    sin,
    smoothstep,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    EMBER, TAU, mulberry32, veBlackbody, veFxMaterial, vePart, veSolidMaterial, veWaveLight,
} from './void-ember-tsl.js';
import { VOID_EMBER_STONE_MODELS } from './void-ember-stone-models.js';

/**
 * The three classes of stone: their size range (world units; the star's radius is 10), the level
 * of the Blender-made models they wear (void-ember-stone-models.js) and how far out they ride.
 * `detail` ranks the levels (2 = the finest).
 */
export const ROCK_CLASSES = Object.freeze([
    {
        name: 'boulders', level: 'boulder', detail: 2, size: [0.5, 1.35], maxOrbit: 3.4,
    },
    {
        name: 'stones', level: 'stone', detail: 1, size: [0.2, 0.62], maxOrbit: 3.9,
    },
    {
        name: 'gravel', level: 'gravel', detail: 0, size: [0.07, 0.24], maxOrbit: 3.9,
    },
]);

/**
 * A model's bounding radius is one; a stone's `size` was the radius of the cut ball the belt was
 * built from before, which stood about this much smaller than its bound.
 */
export const STONE_SCALE = 1.0;

/** How far a boulder's or a stone's shading leans from the smooth normal to its facets' own. */
const FACET = 0.5;

/** A stone's own proportions: each axis of its model is stretched by a number in this range. */
const STRETCH = Object.freeze([0.84, 1.18]);

/** A stone's angular speed on a circular orbit of `radius` (star radii), radians per second. */
export const keplerSpeed = (radius) => 0.0345 * (EMBER.beltPeak / radius) ** 1.5;

/**
 * Families: a parent boulder and the debris it has shed, strung out behind it along its orbit.
 * Every member turns at the parent's own angular speed, so a family never shears apart; each comes
 * round the near arc at its own interval (145 s, 184 s, 214 s), so which of them is in front of the
 * lens, and whether two pass together, is different every few minutes. `arc` (radians) and `width`
 * (star radii) are the spread of its core.
 */
export const SWARMS = Object.freeze([
    Object.freeze({
        radius: 2.58, angle: 0.7, arc: 0.1, width: 0.09,
    }),
    Object.freeze({
        radius: 3.02, angle: 2.9, arc: 0.13, width: 0.12,
    }),
    Object.freeze({
        radius: 3.34, angle: 5.0, arc: 0.11, width: 0.1,
    }),
]);
/** How near a family's parent (star radii, in the belt's plane) its debris may stand. */
const PARENT_CLEAR = 0.19;
/** The share of a class that rides in the families (the boulders give each one a parent). */
const SWARM_SHARE = Object.freeze({ boulders: 0.2, stones: 0.14, gravel: 0.16 });

function decode(text, Type) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer);
}

/** A level's models merged, decoded once a page: every world (a rebuild, a quality change) shares it. */
const merged = new Map();

/**
 * One level's models as plain arrays (three-free: the tests read it): every model's vertices one
 * after another, each tagged with the model it belongs to.
 * @param {'boulder'|'stone'|'gravel'} level
 * @returns {{ position: Float32Array, normal: Float32Array, shade: Float32Array, index: Uint16Array,
 *     variants: number, vertexCount: number, triangleCount: number,
 *     ranges: { design: string, vertex: number, vertices: number, index: number, indices: number }[] }}
 *     `shade` holds (ambient occlusion, crest, variant) per vertex
 */
export function stoneMesh(level) {
    const known = merged.get(level);
    if (known) return known;
    const models = VOID_EMBER_STONE_MODELS[level];
    if (!models?.length) throw new Error(`Void Ember has no stone models for level "${level}".`);
    let vertexCount = 0;
    let indexCount = 0;
    models.forEach((model) => {
        vertexCount += model.vertexCount;
        indexCount += model.triangleCount * 3;
    });
    const position = new Float32Array(vertexCount * 3);
    const normal = new Float32Array(vertexCount * 3);
    const shade = new Float32Array(vertexCount * 3);
    const index = new Uint16Array(indexCount);
    const ranges = [];
    let v = 0;
    let t = 0;
    models.forEach((model, variant) => {
        const p = decode(model.positions, Int16Array);
        const n = decode(model.normals, Int8Array);
        const s = decode(model.shade, Uint8Array);
        const tri = decode(model.index, Uint16Array);
        for (let i = 0; i < model.vertexCount; i++) {
            const o = (v + i) * 3;
            let nx = n[i * 3];
            let ny = n[i * 3 + 1];
            let nz = n[i * 3 + 2];
            // Eight bits a component: unit again, and never a zero normal (a NaN in the shader).
            const nl = Math.hypot(nx, ny, nz) || 1;
            nx /= nl;
            ny /= nl;
            nz /= nl;
            if (nx === 0 && ny === 0 && nz === 0) ny = 1;
            position[o] = p[i * 3] * VOID_EMBER_STONE_MODELS.quant;
            position[o + 1] = p[i * 3 + 1] * VOID_EMBER_STONE_MODELS.quant;
            position[o + 2] = p[i * 3 + 2] * VOID_EMBER_STONE_MODELS.quant;
            normal[o] = nx;
            normal[o + 1] = ny;
            normal[o + 2] = nz;
            shade[o] = s[i * 2] / 255;
            shade[o + 1] = s[i * 2 + 1] / 255;
            shade[o + 2] = variant;
        }
        for (let i = 0; i < tri.length; i++) index[t + i] = tri[i] + v;
        ranges.push({
            design: model.design, vertex: v, vertices: model.vertexCount, index: t, indices: tri.length,
        });
        v += model.vertexCount;
        t += tri.length;
    });
    const mesh = {
        position, normal, shade, index, ranges, variants: models.length, vertexCount, triangleCount: indexCount / 3,
    };
    merged.set(level, mesh);
    return mesh;
}

/**
 * One class's stones as ONE geometry: all its models, so the class stays one mesh and one
 * pipeline. An instance wears one of them; the vertex stage folds the others' vertices onto the
 * stone's middle (triangles of no area, which the rasteriser drops).
 * @returns {THREE.BufferGeometry} indexed, with `position`, `normal` and `aShade`
 */
export function createStoneGeometry(level) {
    const mesh = stoneMesh(level);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normal, 3));
    geometry.setAttribute('aShade', new THREE.BufferAttribute(mesh.shade, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.index, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    return geometry;
}

/**
 * The stones of one class, as plain numbers (three-free: tests read it).
 *   orbit  (radius in star radii, angle at t = 0, height off the plane, radians per second)
 *   body   (size, the tumble axis as two angles, radians of tumble per second)
 *   seed   (the tumble's phase, a shade, 0..40, 0..1)
 *   look   (which model it wears, its stretch along x, y, z)
 *   family which swarm it rides in (−1 = the field)
 * @returns {{ orbit: Float32Array, body: Float32Array, seed: Float32Array, look: Float32Array,
 *     family: Int8Array, count: number }}
 */
export function planRocks(seed, count, cls) {
    const rand = mulberry32(seed);
    const orbit = new Float32Array(count * 4);
    const body = new Float32Array(count * 4);
    const seeds = new Float32Array(count * 4);
    const look = new Float32Array(count * 4);
    const family = new Int8Array(count).fill(-1);
    const variants = VOID_EMBER_STONE_MODELS[cls.level]?.length || 1;
    const inner = EMBER.beltInner;
    const outer = Math.min(EMBER.beltOuter, cls.maxOrbit);
    const span = outer - inner;
    const gauss = () => (rand() + rand() + rand() + rand() - 2) * 0.5;
    // The families take their members first: a parent each (the boulders), then the debris.
    const riders = Math.min(count, Math.floor(count * (SWARM_SHARE[cls.name] ?? 0.18)));
    const offset = Math.floor(rand() * variants);
    for (let i = 0; i < count; i++) {
        let radius;
        let angle;
        let height;
        let speed;
        let size = cls.size[0] + (cls.size[1] - cls.size[0]) * rand() ** 1.9;
        if (i < riders) {
            const which = i % SWARMS.length;
            const swarm = SWARMS[which];
            const parent = cls.detail === 2 && i < SWARMS.length;
            family[i] = which;
            // The debris trails its parent: a core round it and a tail strung out behind.
            let along = parent ? 0 : gauss() * swarm.arc * 0.7 - Math.abs(gauss()) * swarm.arc * 3.2;
            radius = Math.max(inner, Math.min(outer, swarm.radius + (parent ? 0 : gauss() * swarm.width)));
            // Never inside the parent itself: what would stand in it stands off behind it.
            const aside = radius - swarm.radius;
            if (!parent && Math.hypot(aside, along * swarm.radius) < PARENT_CLEAR) {
                const off = Math.sqrt(Math.max(0, (PARENT_CLEAR * 1.1) ** 2 - aside * aside));
                along = -(off + Math.abs(along) * swarm.radius) / swarm.radius;
            }
            angle = (((swarm.angle + along) % TAU) + TAU) % TAU;
            height = (parent ? 0 : gauss() * EMBER.beltThickness * 0.55) * (radius / EMBER.beltPeak);
            // One angular speed for the whole family: it never shears apart.
            speed = keplerSpeed(swarm.radius);
            if (parent) size = cls.size[1] * (0.82 + 0.18 * rand());
        } else {
            // Thickest near the belt's own radius, thinning to both edges.
            const t = (rand() + rand() + rand()) / 3;
            radius = inner + span * Math.min(1, Math.max(0, 0.5 + (t - 0.5) * 2.1));
            height = gauss() * EMBER.beltThickness * (radius / EMBER.beltPeak);
            // Kepler: the inner stones overtake the outer ones.
            speed = keplerSpeed(radius) * (0.94 + rand() * 0.12);
            angle = rand() * TAU;
        }
        orbit.set([radius, angle, height, speed], i * 4);
        const tumble = (0.05 + rand() * 0.3) * (rand() < 0.5 ? -1 : 1);
        body.set([size, Math.acos(rand() * 2 - 1), rand() * TAU, tumble], i * 4);
        seeds.set([rand() * TAU, rand(), rand() * 40, rand()], i * 4);
        // Every model in turn, so a class of thirty wears all six.
        look.set([
            (i + offset) % variants,
            STRETCH[0] + (STRETCH[1] - STRETCH[0]) * rand(),
            STRETCH[0] + (STRETCH[1] - STRETCH[0]) * rand(),
            STRETCH[0] + (STRETCH[1] - STRETCH[0]) * rand(),
        ], i * 4);
    }
    return {
        orbit, body, seed: seeds, look, family, count,
    };
}

/** Where a stone is in the belt's frame at `time` (star radii). CPU twin of the vertex stage. */
export function rockPosition(plan, index, time, out = [0, 0, 0]) {
    const r = plan.orbit[index * 4];
    const a = plan.orbit[index * 4 + 1] + plan.orbit[index * 4 + 3] * time;
    out[0] = Math.cos(a) * r;
    out[1] = plan.orbit[index * 4 + 2];
    out[2] = Math.sin(a) * r;
    return out;
}

/**
 * One class of stones.
 * @param {object} u       shared uniforms
 * @param {object} cls     ROCK_CLASSES entry
 * @param {number} count
 * @param {number} seed
 * @param {object} opts
 * @param {boolean} [opts.cracks=true]  the stone's grain and its fractures (one noise read per
 *                                      pixel of a boulder or a stone; gravel never reads)
 */
export function createRocks(u, cls, count, seed, { cracks = true } = {}) {
    const plan = planRocks(seed, count, cls);
    const rock = createStoneGeometry(cls.level);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(rock.getIndex());
    geometry.setAttribute('position', rock.getAttribute('position'));
    geometry.setAttribute('normal', rock.getAttribute('normal'));
    geometry.setAttribute('aShade', rock.getAttribute('aShade'));
    geometry.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(plan.orbit, 4));
    geometry.setAttribute('aBody', new THREE.InstancedBufferAttribute(plan.body, 4));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(plan.seed, 4));
    geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(plan.look, 4));
    geometry.instanceCount = count;
    // (Seven vertex buffers: WebGPU binds eight to a pipeline.)

    const orbit = attribute('aOrbit', 'vec4');
    const body = attribute('aBody', 'vec4');
    const seeds = attribute('aSeed', 'vec4');
    const look = attribute('aLook', 'vec4');
    const shade = attribute('aShade', 'vec3');
    /** Gravel is a few pixels across: no grain, no fractures, no texture read at all. */
    const grained = cracks && cls.detail > 0;

    const material = veSolidMaterial(`VoidEmberRocks_${cls.name}`);

    // ── Where the stone is ──
    const angle = orbit.y.add(orbit.w.mul(u.time));
    const inBelt = vec3(cos(angle).mul(orbit.x), orbit.z, sin(angle).mul(orbit.x));
    const fromStar = u.beltRot.mul(inBelt);
    // The wave: light, afterglow and a shove, all from the stone's own distance.
    const wave = veWaveLight(u, orbit.x);
    const shove = normalize(fromStar).mul(wave.w.mul(0.03).add(max(wave.x, max(wave.y, wave.z)).mul(0.14)));
    const centre = u.centre.add(fromStar.add(shove).mul(u.radius));
    // Its tumble: a turn about its own axis.
    const axis = vec3(sin(body.y).mul(cos(body.z)), cos(body.y), sin(body.y).mul(sin(body.z)));
    const turn = seeds.x.add(body.w.mul(u.time));
    const ct = cos(turn);
    const st = sin(turn);
    const spinV = (v) => v.mul(ct).add(cross(axis, v).mul(st)).add(axis.mul(dot(axis, v)).mul(float(1.0).sub(ct)));
    // Only the model this stone wears keeps its shape; the others' vertices fold onto its middle.
    const wears = step(abs(shade.z.sub(look.x)), 0.5);
    const size = body.x.mul(STONE_SCALE);
    const world = centre.add(spinV(positionGeometry.mul(look.yzw)).mul(size.mul(wears)));
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));
    material.vertexNode = clip;

    const vWorld = varying(world, 'veRockWorld');
    // (A stretched model's normals turn the other way: divided by the stretch, not multiplied.)
    const vNormal = varying(spinV(normalize(normalGeometry.div(look.yzw))), 'veRockNormal');
    const vLocal = varying(positionGeometry, 'veRockLocal');
    const vWave = varying(wave, 'veRockWave');
    // (ambient occlusion, crest, the stone's own shade, its radius on screen in pixels)
    const vShade = varying(vec4(
        shade.x,
        shade.y,
        seeds.y,
        size.div(max(clip.w, 1.0).mul(u.pixelAngle)),
    ), 'veRockShade');
    const vOrbit = varying(orbit.x, 'veRockOrbit');
    // Two fractures through the stone, each a plane of its own (the second branches off the first).
    const plane = (a, b, offset) => vec4(cos(a), sin(a).mul(cos(b)), sin(a).mul(sin(b)), offset);
    const vFractureA = grained
        ? varying(plane(seeds.x, seeds.z, seeds.y.sub(0.5).mul(0.5)), 'veRockFractureA') : null;
    const vFractureB = grained
        ? varying(plane(seeds.z.mul(1.7), seeds.x.mul(2.3), seeds.w.sub(0.5).mul(0.6)), 'veRockFractureB') : null;

    material.colorNode = Fn(() => {
        // The model's own normal is the fine surface's, smoothed: it carries the craters and the
        // neck. A boulder or a stone is also cut in facets (the face's own normal, read from the
        // slope of the surface on screen: no vertex is split for it), or it reads as clay.
        const round = normalize(vNormal).toVar();
        const N = round.toVar();
        if (cls.detail > 0) {
            const face = cross(dFdx(vWorld), dFdy(vWorld)).toVar();
            const facet = face.div(max(length(face), 1e-20)).mul(sign(dot(face, round)));
            N.assign(normalize(mix(round, facet, FACET)));
        }
        const toStar = u.centre.sub(vWorld).toVar();
        const range = max(length(toStar), 1e-3).toVar();
        const radii = max(range.div(u.radius), 1.0).toVar();
        const L = toStar.div(range).toVar();
        const V = normalize(cameraPosition.sub(vWorld)).toVar();
        const ndl = dot(N, L).toVar();
        // (Clamped: with MSAA a varying is extrapolated past its corners' values on a thin stone.)
        const ao = clamp(vShade.x, 0.0, 1.0).toVar();
        const crest = clamp(vShade.y, 0.0, 1.0).toVar();
        const shadeOwn = clamp(vShade.z, 0.0, 1.0).toVar();
        // The stone's grain: blotches of lighter and darker rock, and what bends its fractures.
        const grainAt = vLocal.mul(3.3).add(vec3(shadeOwn.mul(31.0).add(8.0), 12.0, shadeOwn.mul(17.0).add(8.0)));
        const grain = (grained ? u.noise3(grainAt) : vec2(0.5, 0.5)).toVar();
        const mottle = grain.x.mul(0.8).add(0.6).toVar();

        // ── Rock and dust ──
        // Dark rock in the crevices, pale dust on the crests, every stone a shade of its own.
        const albedo = u.rock.mul(shadeOwn.mul(0.9).add(0.72)).mul(mix(float(0.42), float(1.5), crest)).mul(mottle)
            .toVar();
        // Lit by the star alone, its light thinning with the square of the distance; a crater
        // or a neck holds a shadow of its own (the bake's occlusion, squared: the bodies are open
        // and its values are gentle).
        const day = smoothstep(-0.06, 0.26, ndl).mul(max(ndl, 0.0).mul(0.75).add(0.25)).toVar();
        const fall = min(float(9.0).div(radii.mul(radii)), 3.0).toVar();
        const open = ao.mul(ao).mul(0.88).add(0.12);
        const col = albedo.mul(u.starLight).mul(day.mul(fall).mul(open)).toVar();
        // A dusty sheen where the light grazes.
        const edge = float(1.0).sub(clamp(dot(round, V), 0.0, 1.0)).toVar();
        const sheen = edge.mul(edge).mul(edge).mul(day).mul(fall);
        col.addAssign(u.starLight.mul(sheen.mul(ao).mul(0.05)));
        // What little the void gives the night side.
        const night = N.y.mul(0.35).add(0.65).mul(albedo.x.mul(8.0)).mul(ao);
        col.addAssign(u.fill.mul(night.mul(u.iris.pow(0.45))));
        // Backlit: a stone between the eye and the star wears a thin rim of its light, where the
        // dust on its edges scatters it on toward the eye (without it, a flat cut-out). The star
        // is large seen from the belt: "behind" is a wide cone.
        const behind = smoothstep(0.35, 0.92, dot(V.negate(), L));
        const edge2 = edge.mul(edge);
        const rimLine = edge2.mul(edge2).mul(edge);
        col.addAssign(u.starLight.mul(rimLine.mul(behind).mul(fall).mul(0.55)));
        // The wave's front lights the side that faces the star.
        col.addAssign(albedo.mul(vWave.rgb).mul(day.mul(0.6).add(0.4)).mul(6.0));

        // ── Fractures: a few, and only where the stone is large enough on screen to show a line ──
        const seam = float(0.0).toVar();
        if (grained) {
            const px = max(vShade.w, 1.0);
            const width = max(float(0.034), float(1.25).div(px)).toVar();
            const bend = grain.y.sub(0.5).mul(0.5).toVar();
            const sA = dot(vLocal, vFractureA.xyz).sub(vFractureA.w).add(bend).toVar();
            const sB = dot(vLocal, vFractureB.xyz).sub(vFractureB.w).sub(bend).toVar();
            const lineA = float(1.0).sub(smoothstep(width.mul(0.35), width, abs(sA)));
            // The second runs off the first, on one side of it only.
            const lineB = float(1.0).sub(smoothstep(width.mul(0.3), width.mul(0.85), abs(sB)))
                .mul(smoothstep(0.0, width, sA));
            seam.assign(max(lineA, lineB.mul(0.85)).mul(smoothstep(4.0, 11.0, px)));
            // Cold, a fracture is a dark line in the rock.
            col.mulAssign(float(1.0).sub(seam.mul(0.42)));
        }

        // ── Heat: what a wave leaves behind, the star's own close in, and the blaze of hot play ──
        const near = float(1.0).sub(smoothstep(2.1, 3.6, vOrbit)).mul(max(u.heat.sub(0.4), 0.0)).mul(1.5);
        const fire = min(vWave.w.mul(0.8).add(near).add(u.blaze.mul(shadeOwn.mul(0.7).add(0.3))), 2.0).toVar();
        If(fire.greaterThan(0.004), () => {
            // The face turned to the star glows like iron cooling: dull red, through orange, to
            // gold at the hottest and never white (a burning belt keeps its colour).
            const facing = smoothstep(-0.3, 0.55, ndl).toVar();
            const warm = fire.mul(facing).mul(mix(float(1.15), float(0.82), crest)).mul(mottle).toVar();
            col.addAssign(veBlackbody(min(warm.mul(0.3).add(0.12), 0.8)).mul(min(warm.mul(warm), 1.6).mul(0.95)));
            // The hollows hold their heat longest, on every side.
            const hollow = float(1.0).sub(smoothstep(0.2, 0.5, crest)).mul(fire).mul(facing.mul(0.7).add(0.3));
            col.addAssign(veBlackbody(min(fire.mul(0.25).add(0.3), 0.82)).mul(hollow.mul(0.85)));
            if (grained) {
                // ...and its fractures burn: a few lines, not a crazed glaze.
                col.addAssign(veBlackbody(min(fire.mul(0.26).add(0.4), 0.8))
                    .mul(seam.mul(fire).mul(facing.mul(0.6).add(0.4)).mul(1.7)));
            }
        });
        return vec4(col.mul(u.breath.mul(0.75).add(0.25)), 1.0);
    })();

    const part = vePart(`VoidEmberRocks_${cls.name}`, geometry, material, 2);
    part.plan = plan;
    part.count = count;
    part.extraGeometry = rock;
    return part;
}

// ── The cinder world ────────────────────────────────────────────────────────────

/** Where the cinder world's wound is, in its own frame, and how wide (a chord of the unit ball). */
export const WORLD_WOUND = Object.freeze({ at: [0.58, 0.3, 0.756], rim: 0.46 });

/**
 * @param {object} u shared uniforms
 * @param {object} opts
 * @param {boolean} [opts.cracks=true]  fractures from the baked plates (one fetch); off, the old
 *                                      rifts of the noise it already reads
 */
export function createCinderWorld(u, { segments = 48, cracks = true } = {}) {
    const geometry = new THREE.SphereGeometry(1, segments, Math.round(segments * 0.6));
    const material = veSolidMaterial('VoidEmberCinderWorld');
    material.colorNode = Fn(() => {
        const p = normalize(positionLocal).toVar();
        const N = normalize(positionWorld.sub(u.worldCentre)).toVar();
        const V = normalize(cameraPosition.sub(positionWorld));
        const toStar = u.centre.sub(u.worldCentre);
        const radii = length(toStar).div(u.radius);
        const L = normalize(toStar);
        const ndl = dot(N, L).toVar();
        const mu = clamp(dot(N, V), 0.0, 1.0).toVar();
        const day = smoothstep(-0.1, 0.22, ndl).mul(max(ndl, 0.0).mul(0.8).add(0.2)).toVar();
        const fall = min(float(9.0).div(radii.mul(radii)), 3.0);
        // Highlands and basins, and a net of old rifts.
        const land = u.noise3(p.mul(3.1).add(vec3(5.0, 1.0, 9.0))).toVar();
        const fine = u.noise3(p.mul(9.5).add(vec3(2.0, 7.0, 4.0))).toVar();
        // The wound: one great basin with a raised rim, its floor darker than the highlands.
        const dWound = length(p.sub(vec3(WORLD_WOUND.at[0], WORLD_WOUND.at[1], WORLD_WOUND.at[2]))).toVar();
        const basin = float(1.0).sub(smoothstep(WORLD_WOUND.rim * 0.72, WORLD_WOUND.rim, dWound.add(fine.x.sub(0.5).mul(0.07)))).toVar();
        const lip = dWound.sub(WORLD_WOUND.rim * 1.04).div(0.06);
        const rimRise = exp(lip.mul(lip).negate());
        const albedo = u.rock.mul(land.x.mul(0.9).add(fine.x.mul(0.5)).add(0.35))
            .mul(float(1.0).sub(basin.mul(0.55)).add(rimRise.mul(0.5)));
        const wave = veWaveLight(u, radii);
        const col = albedo.mul(u.starLight.mul(fall.mul(4.0)).add(wave.rgb.mul(5.0))).mul(day).toVar();
        // The atmosphere catches the light past the terminator: a thin bright arc.
        const rim = float(1.0).sub(mu);
        const air = rim.mul(rim).mul(rim).mul(rim).mul(rim)
            .mul(smoothstep(-0.3, 0.3, ndl));
        col.addAssign(u.starLight.mul(fall).add(wave.rgb.mul(2.0)).mul(air.mul(0.7)));
        // Old lava in the night side, waking as the star does.
        const wake = u.heat.mul(u.heat).mul(0.8).add(0.012).add(wave.w.mul(0.5))
            .toVar();
        let rift;
        if (cracks) {
            // Fractures between the plates of its dead crust (the star's own baked plates, torn by
            // the land's noise so no two bodies wear the same net), and only some of them alight.
            const net = u.plates(p.add(vec3(land.x.sub(0.5), fine.y.sub(0.5), land.y.sub(0.5)).mul(0.16)));
            // (Wide: the world is sixty pixels across, and a hairline there is a row of dots.)
            rift = float(1.0).sub(smoothstep(0.012, 0.085, net.x))
                .mul(smoothstep(0.34, 0.7, net.y.mul(0.55).add(land.y.mul(0.45))));
        } else {
            const seam = float(1.0).sub(abs(fine.y.mul(2.0).sub(1.0)));
            rift = seam.mul(seam).mul(seam).mul(seam).mul(seam)
                .mul(smoothstep(0.35, 0.75, land.y));
        }
        col.addAssign(veBlackbody(wake.mul(0.35).add(0.18)).mul(rift.mul(wake).mul(1.5)).mul(float(1.0).sub(day)));
        // The wound's floor never quite cooled: a lake of old fire under a broken skin, brighter
        // where the skin is thin, and the star's waking stirs it.
        const skin = smoothstep(0.34, 0.72, fine.x.mul(0.55).add(land.y.mul(0.45)));
        const lake = basin.mul(basin).mul(skin.mul(0.85).add(0.15)).mul(wake.mul(1.3).add(0.11));
        col.addAssign(veBlackbody(wake.mul(0.4).add(0.3)).mul(lake.mul(1.6)).mul(float(1.0).sub(day.mul(0.75))));
        col.addAssign(u.fill.mul(0.5));
        return vec4(col.mul(u.breath.mul(0.75).add(0.25)), 1.0);
    })();
    return vePart('VoidEmberCinderWorld', geometry, material, 1);
}

/** The cinder world's moon: a small grey ball lit by the star alone. */
export function createCinderMoon(u, { segments = 20 } = {}) {
    const geometry = new THREE.SphereGeometry(1, segments, Math.round(segments * 0.6));
    const material = veSolidMaterial('VoidEmberCinderMoon');
    material.colorNode = Fn(() => {
        const p = normalize(positionLocal).toVar();
        const N = normalize(positionWorld.sub(u.moonCentre)).toVar();
        const V = normalize(cameraPosition.sub(positionWorld));
        const toStar = u.centre.sub(u.moonCentre);
        const radii = length(toStar).div(u.radius);
        const ndl = dot(N, normalize(toStar)).toVar();
        const day = smoothstep(-0.06, 0.25, ndl).mul(max(ndl, 0.0).mul(0.8).add(0.2));
        const fall = min(float(9.0).div(radii.mul(radii)), 3.0);
        const land = u.noise3(p.mul(4.2).add(vec3(1.0, 8.0, 3.0)));
        const albedo = u.rock.mul(land.x.mul(1.1).add(0.55));
        const wave = veWaveLight(u, radii);
        const col = albedo.mul(u.starLight.mul(fall.mul(4.5)).add(wave.rgb.mul(5.0))).mul(day).toVar();
        // A hair of light on its limb where the star stands behind it.
        const rim = float(1.0).sub(clamp(dot(N, V), 0.0, 1.0));
        col.addAssign(u.starLight.mul(fall).mul(rim.mul(rim).mul(rim).mul(rim).mul(smoothstep(-0.3, 0.3, ndl))
            .mul(0.25)));
        col.addAssign(u.fill.mul(0.6));
        return vec4(col.mul(u.breath.mul(0.75).add(0.25)), 1.0);
    })();
    return vePart('VoidEmberCinderMoon', geometry, material, 1);
}

// ── The belt's dust ─────────────────────────────────────────────────────────────

/**
 * The fine dust the stones ride in: a thin ring of ringlets and gaps in the belt's plane. Seen
 * almost edge-on it is a band that glows where the star's light comes through it toward the
 * camera, dims what is behind it, and lights up as a clear's wave runs out along it.
 *
 * @param {object} u
 * @param {object} opts
 * @param {number} [opts.detail=2]  noise reads per pixel (1..3)
 */
export function createDustRing(u, { detail = 2 } = {}) {
    const inner = EMBER.beltInner - 0.35;
    const outer = EMBER.beltOuter + 0.45;
    const segments = 160;
    const positions = new Float32Array((segments + 1) * 2 * 3);
    const index = [];
    for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * TAU;
        positions.set([Math.cos(a) * inner, 0, Math.sin(a) * inner], i * 6);
        positions.set([Math.cos(a) * outer, 0, Math.sin(a) * outer], i * 6 + 3);
        if (i < segments) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(index);

    const material = veFxMaterial('VoidEmberDustRing');
    const world = u.centre.add(u.beltRot.mul(positionGeometry).mul(u.radius));
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));
    const vLocal = varying(positionGeometry, 'veRingLocal');
    const vWorld = varying(world, 'veRingWorld');

    material.colorNode = Fn(() => {
        const r = length(vLocal.xz).toVar();
        // Ringlets and gaps: noise along the radius only, at two scales; clumps along the ring.
        const lanes = u.noise3(vec3(r.mul(7.5), 3.3, 9.1)).toVar();
        let fine = float(0.5);
        if (detail >= 2) fine = u.noise3(vec3(r.mul(31.0), 1.7, 4.4)).x;
        let clump = float(0.5);
        if (detail >= 3) clump = u.noise3(vec3(vLocal.x.mul(1.6), vLocal.z.mul(1.6), u.time.mul(0.004))).x;
        const body = smoothstep(inner, inner + 0.5, r).mul(float(1.0).sub(smoothstep(outer - 0.9, outer, r)));
        const bulk = exp(r.sub(EMBER.beltPeak).mul(r.sub(EMBER.beltPeak)).mul(-0.9)).mul(0.75).add(0.25);
        const gaps = smoothstep(0.24, 0.42, lanes.y);
        const density = body.mul(bulk).mul(lanes.x.mul(0.8).add(0.2)).mul(fine.mul(0.7).add(0.65))
            .mul(clump.mul(0.6).add(0.7))
            .mul(gaps)
            .toVar();

        // The longer the line of sight lies in the ring, the more dust it crosses.
        const V = normalize(cameraPosition.sub(vWorld)).toVar();
        const normal = u.beltRot.mul(vec3(0.0, 1.0, 0.0));
        const slant = float(1.0).div(max(abs(dot(V, normal)), 0.16));
        const tau = density.mul(slant).mul(0.11);
        const alpha = float(1.0).sub(exp(tau.negate())).toVar();

        // Lit by the star alone: brightest where its light comes on through the dust at us.
        const away = normalize(vWorld.sub(u.centre));
        const cosine = dot(away, V);
        const forward = max(cosine, 0.0);
        const phase = forward.mul(forward).mul(forward).mul(1.3).add(float(1.0).sub(abs(cosine)).mul(0.3))
            .add(0.26);
        const fall = min(float(9.0).div(r.mul(r)), 3.0);
        // The dust takes the sky's share of the star's light: it must not veil a white-hot star.
        // And a breath of the void's own cold light, which is what the far side of the ring
        // shows: each level's palette is read in it.
        const cold = mix(u.dustA, u.dustB, lanes.x).mul(smoothstep(2.3, 3.7, r).mul(0.2).add(0.035))
            .mul(u.iris.pow(0.45));
        const light = u.skyLight.mul(fall).mul(phase).mul(0.27).add(cold)
            .toVar();
        If(u.wavesLive.greaterThan(0.5), () => {
            const wave = veWaveLight(u, r);
            light.addAssign(wave.rgb.mul(1.2).add(u.skyLight.mul(wave.w).mul(0.05)));
        });
        return vec4(light.mul(alpha).mul(u.breath.mul(0.75).add(0.25)), alpha.mul(0.3));
    })();

    return vePart('VoidEmberDustRing', geometry, material, 8);
}
