/**
 * Cosmic Noir — white water in the air: what a breaking wave throws up the rock.
 *
 * A roller that meets the rock bursts. Two things are drawn, each one instanced quad:
 *
 *   THE BURST (`createBurst`): some hundreds of billows of spray. Each leaves the shore where the
 *   crest struck (the flanks a moment after the face, as the crest wraps the rock), is flung up
 *   fast, slows against the air, swells as it climbs, hangs, leans away before the wind and thins
 *   to nothing. Many stay low and a few go high, so the burst has a thick white foot and a torn
 *   crown. A billow is a soft disc eaten ragged by the baked smoke, lit on the side the lamp
 *   stands and brightest at its thin edge. They are laid OVER the picture: a burst between the eye
 *   and the tower veils the tower.
 *
 *   THE DROPS (`createDrops`): a thousand or so bright streaks on plain arcs (up fast, falling
 *   back), drawn along their own flight and added to the picture.
 *
 * A billow's or a drop's whole flight is a function of its seed and its wave's row (its age, how
 * hard it broke), worked out in the vertex stage: nothing is simulated, on the CPU or the GPU, and
 * a seek redraws the same burst. A wave keeps its row for as long as it lives (the world writes
 * the rows round-robin), so nothing in the air changes hands when the next wave breaks.
 *
 * Nothing here knows depth (the lighthouse is drawn by a distance field in the backdrop), so what
 * stands behind the tower is found by where the sight line to it meets the tower's cylinder.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    sqrt,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CAGE, PULSAR, ROCK, ROCK_XZ, ROLLERS, SEA, SPLASH, SPLASH_SLOTS, TOWER, UPSTREAM, cnLampAt, cnPart, cnUpright,
    mulberry32,
} from './cosmic-noir-tsl.js';

/** How far round the shore from where the crest struck head-on a burst leaves (radians, either way). */
const ARC = 1.5;
/** A billow is flung up at between these speeds (a full wave, where it struck head-on; scene units / s). */
const FLING_LEAST = 2.2;
const FLING_SPREAD = 17.0;
/** The air stops it within this many seconds, and it sinks back this fast (units / s², least and spread). */
const DRAG = 0.56;
const SINK = 0.5;
const SINK_SPREAD = 1.5;
/** How far out from the rock it is thrown, and how fast the wind carries it off (more the higher it stands). */
const THROW = 2.3;
const CARRY = 0.5;
/** A billow's size as it leaves (its radius, scene units) and how many times larger it swells. */
const SIZE = 0.07;
const SIZE_SPREAD = 0.19;
const SWELL = 2.3;
/** Water falls back this many times as fast as the mist round it sinks. */
const WATER_FALLS = 2.4;
/** The mist round the water: how many times larger its billows are, and how much thinner. */
const MIST_SIZE = 3.4;
const MIST_THIN = 0.3;
/** What the lamp lets fall on the burst (a share of its own light), the galaxy's share, the sky's, and its whiteness. */
const LAMP_FALL = 0.55;
const LAMP_SHARE = 0.75;
const GALAXY_SHARE = 0.085;
const BURST_WHITE = 1.05;
/** How hard the drops fall back (scene units / s²). */
const FALL = 6.0;
const DROP_GAIN = 2.6;

/** The tower's shaft as the burst sees it: a cylinder from its foot to the gallery, in the lamp's frame. */
const SHAFT = Object.freeze({
    radius: (TOWER.neckRadius + TOWER.footRadius) * 0.5 - 0.1,
    y0: SEA.level + TOWER.footLift - PULSAR.height - 0.6,
    y1: -TOWER.galleryDrop,
    gallery: TOWER.galleryRadius,
    top: CAGE.halfHeight + TOWER.domeRise,
});

function quadGeometry(seeds, count) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.instanceCount = count;
    return geometry;
}

/** Four draws an instance: three numbers, and the wave it belongs to (whole part) with one more draw. */
function seedsFor(count, salt) {
    const seeds = new Float32Array(count * 4);
    const rand = mulberry32(salt);
    for (let i = 0; i < count; i++) {
        seeds[i * 4] = rand();
        seeds[i * 4 + 1] = rand();
        seeds[i * 4 + 2] = rand();
        seeds[i * 4 + 3] = (i % SPLASH_SLOTS) + rand() * 0.999;
    }
    return seeds;
}

/** How much of a point the tower's shaft and gallery hide from the eye (0 clear .. 1 hidden). */
const hiddenBy = (u, world) => {
    const eye = u.camPos;
    const toPoint = world.sub(eye);
    const far = max(length(toPoint), 1e-3);
    const dir = toPoint.div(far);
    const rel = eye.sub(u.pulsar);
    const shaft = cnUpright(rel, dir, float(SHAFT.radius), float(SHAFT.y0), float(SHAFT.y1));
    const head = cnUpright(rel, dir, float(SHAFT.gallery), float(SHAFT.y1 - 0.15), float(SHAFT.top));
    const behind = (hit) => hit.z.mul(smoothstep(0.0, 0.7, far.sub(max(hit.x, 0.0))));
    return max(behind(shaft), behind(head));
};

/** An echo's shell flashing through a point as it passes (clears light the burst). */
const echoFlash = (u, world) => {
    const flash = float(0.0).toVar();
    const fromLamp = length(world.sub(u.pulsar)).toVar();
    Loop({
        start: int(0), end: u.echoCount, type: 'int', condition: '<', name: 'e',
    }, ({ e }) => {
        const a = u.echoes.element(e);
        const x = fromLamp.sub(a.x).div(a.y.mul(2.6));
        flash.addAssign(a.z.mul(exp(x.mul(x).negate())));
    });
    return flash;
};

/**
 * The burst: billows of spray, laid over the picture.
 * @param {object} u      shared uniforms
 * @param {number} count  billows (shared between the waves breaking at once)
 */
export function createBurst(u, count) {
    const geometry = quadGeometry(seedsFor(count, 0xb075), count);
    // Premultiplied, laid over: a billow hides what is behind it by its own cover.
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
        premultipliedAlpha: true,
    });
    material.name = 'CosmicNoirBurst';
    material.fog = false;
    material.forceSinglePass = true;

    const seed = attribute('aSeed', 'vec4');
    const draw = fract(seed.w);
    const row = u.splashes.element(int(floor(seed.w)));
    const strength = row.y;
    // Where on the shore it leaves, all round the side the crest struck.
    const bearing = seed.x.sub(0.5).mul(2.0 * ARC);
    const c = cos(bearing);
    const s = sin(bearing);
    const outward = vec2(c.mul(UPSTREAM[0]).sub(s.mul(UPSTREAM[1])), s.mul(UPSTREAM[0]).add(c.mul(UPSTREAM[1])));
    const face = pow(max(c.mul(0.5).add(0.5), 0.0), 1.5);
    // The crest wraps the rock (the flanks a moment later), and the burst keeps coming for a while.
    const age = row.x.sub(float(1.0).sub(c).mul((ROCK.shore / ROLLERS.speed) * 0.9)).sub(draw.mul(draw).mul(0.7));
    // Some of the shore throws its water far higher than the rest: jets, their places the wave's own.
    const jet = sin(bearing.mul(5.3).add(row.z.mul(41.0))).mul(0.5).add(0.5)
        .mul(sin(bearing.mul(2.1).sub(row.z.mul(17.0))).mul(0.35).add(0.65));
    const power = sqrt(max(strength, 0.0)).mul(face.mul(0.55).add(0.45)).mul(jet.mul(0.75).add(0.45));
    // Many low, a few flung high: the low ones are the foot (large, slow, long to go), the high
    // ones the crown (small, fast, soon gone).
    const high = seed.y.mul(seed.y);
    const fling = power.mul(high.mul(FLING_SPREAD).add(FLING_LEAST));
    // Two in three are water (small, torn, drawn out along their flight, soon fallen back); the
    // rest are the mist that hangs round it (large, soft, thin, slow to go).
    const soft = smoothstep(0.7, 0.72, fract(seed.x.mul(7.31).add(seed.z.mul(3.17))));
    const sinking = seed.z.mul(SINK_SPREAD).add(SINK).mul(0.5).mul(mix(float(WATER_FALLS), float(1.0), soft));
    const lean = seed.z.mul(0.75).add(0.25).mul(power).mul(THROW);
    const aside = seed.z.sub(0.5).mul(0.8);
    /** Where a billow is `at` seconds after it left. */
    const placeAt = (at) => {
        const rise = float(1.0).sub(exp(at.div(-DRAG)));
        const after = max(at.sub(0.35), 0.0);
        const height = fling.mul(DRAG).mul(rise).sub(after.mul(after).mul(sinking));
        const spread = float(1.0).sub(exp(at.div(-0.9)));
        const reach = lean.mul(spread).add(ROCK.shore * 1.02);
        // The wind leans what hangs away over the rock: the higher, the further.
        const carried = at.mul(0.5).add(at.mul(at).mul(0.11))
            .mul(clamp(height.div(SPLASH.height), 0.0, 1.4).mul(0.8).add(0.25)).mul(CARRY);
        const flat = outward.mul(reach).add(vec2(outward.y.negate(), outward.x).mul(aside.mul(spread)))
            .sub(vec2(UPSTREAM[0], UPSTREAM[1]).mul(carried));
        return vec3(flat.x.add(ROCK_XZ[0]), height.add(SEA.level + 0.05), flat.y.add(ROCK_XZ[1]));
    };
    const a = max(age, 0.0);
    const world = placeAt(a);
    const before = placeAt(max(a.sub(0.06), 0.0));
    const lifted = clamp(world.y.sub(SEA.level).div(SPLASH.height), 0.0, 1.4);
    const view = cameraProjectionMatrix.mul(cameraViewMatrix);
    const clip = view.mul(vec4(world, 1.0));
    const clipBefore = view.mul(vec4(before, 1.0));
    const half = u.viewport.mul(0.5);
    // It swells as it climbs and goes on swelling as it thins.
    const size = draw.mul(SIZE_SPREAD).add(SIZE).mul(float(1.25).sub(high.mul(0.6)))
        .mul(sqrt(max(strength, 0.05)).mul(0.3).add(0.72))
        .mul(float(1.0).sub(exp(a.div(-1.1))).mul(SWELL - 1).add(1.0)
            .add(a.mul(0.12)))
        .mul(mix(float(1.0), float(MIST_SIZE), soft));
    const px = size.mul(u.viewport.y).div(u.tanHalf.y.mul(2.0)).div(max(clip.w, 0.5));
    // Drawn out along its own flight while it is flying fast; round once it hangs.
    const flown = clip.xy.div(max(clip.w, 0.5)).sub(clipBefore.xy.div(max(clipBefore.w, 0.5))).mul(half);
    const flownPx = max(length(flown), 1e-3);
    const along = flown.div(flownPx);
    const drawn = clamp(flownPx.div(px.mul(0.8)), 0.0, mix(float(3.2), float(0.5), soft)).add(1.0);
    const corner = positionGeometry.xy.mul(2.0);
    const offset = along.mul(corner.x.mul(px).mul(drawn))
        .add(vec2(along.y.negate(), along.x).mul(corner.y.mul(px).mul(mix(float(0.82), float(1.0), soft))));
    material.vertexNode = vec4(clip.xy.add(offset.div(half).mul(clip.w)), clip.z, clip.w);

    // How long it lasts: the high, thin ones go first; the foot hangs on as mist.
    const life = float(4.8).sub(high.mul(2.6)).add(draw.mul(0.9)).mul(mix(float(0.62), float(1.0), soft));
    const alive = smoothstep(0.0, 0.09, age)
        .mul(float(1.0).sub(smoothstep(life.mul(0.3), life, a)))
        .mul(smoothstep(-0.25, 0.25, world.y.sub(SEA.level)))
        .mul(clamp(strength.mul(3.0), 0.0, 1.0));
    // Thick as it leaves, thinner as it swells.
    const thick = float(1.0).div(float(1.0).add(a.mul(0.7))).mul(0.62).add(0.1)
        .mul(mix(float(1.0), float(MIST_THIN), soft));
    const shown = alive.mul(thick).mul(float(1.0).sub(hiddenBy(u, world)));
    // Its light: what the lamp lets fall and what passes the slats (the beam sets it ablaze), the
    // galaxy, the sky, an echo's flash. The foot stands in the rock's shadow, the crown in the light.
    const fromLamp = length(world.sub(u.pulsar)).div(PULSAR.coreReach * 1.5);
    const lit = u.coreGain.mul(LAMP_FALL).div(fromLamp.mul(fromLamp).add(1.0))
        .add(cnLampAt(u, world, float(0.16)).mul(LAMP_SHARE))
        .add(u.galaxy.mul(GALAXY_SHARE))
        .add(u.skyGlow.mul(1.3))
        .add(u.ambient.mul(3.0))
        .add(echoFlash(u, world).mul(0.5))
        .mul(lifted.mul(0.75).add(draw.mul(0.3)).add(0.38));
    // The side the lamp stands on, on screen, in the billow's own frame (x along its flight).
    const lampClip = view.mul(vec4(u.pulsar, 1.0));
    const toLamp = normalize(lampClip.xy.div(max(lampClip.w, 0.1)).sub(clip.xy.div(max(clip.w, 0.1)))
        .mul(vec2(u.viewport.x.div(u.viewport.y), 1.0)).add(vec2(1e-4, 0.0)));
    const lampSide = vec2(dot(toLamp, along), dot(toLamp, vec2(along.y.negate(), along.x)));
    const vLight = varying(vec4(lit.mul(u.breath).mul(BURST_WHITE), shown, lampSide), 'cnBurstLight');
    const vSeed = varying(
        vec4(seed.x.mul(11.0), seed.y.mul(7.0), seed.z.mul(13.0).add(a.mul(0.1)), drawn),
        'cnBurstSeed',
    );
    // (Water that has hung a second is spray: its torn edge goes soft.)
    const vSoft = varying(max(soft, smoothstep(0.8, 2.0, a).mul(0.85)), 'cnBurstSoft');
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0).toVar();
        const far2 = dot(q, q).toVar();
        // Eaten ragged by the smoke at two scales (heads, froth), drawn out along its flight: no
        // two alike, each changing as it ages.
        const grainAt = vec2(q.x.mul(vSeed.w), q.y);
        const headsAt = vec3(grainAt.x.mul(0.17).add(vSeed.x), grainAt.y.mul(0.24).add(vSeed.y), vSeed.z);
        const frothAt = vec3(grainAt.x.mul(0.42).add(vSeed.y), grainAt.y.mul(0.7).add(vSeed.x), vSeed.z.mul(1.7));
        const heads = u.smoke(headsAt).toVar();
        const froth = u.smoke(frothAt).toVar();
        const lump = heads.b.mul(0.42).add(heads.r.mul(0.4)).add(froth.g.mul(0.52)).add(froth.b.mul(0.22));
        // Water has a torn edge, not a soft one (soft and large it is smoke); the mist round it
        // has no edge at all.
        const torn = smoothstep(0.22, 0.62, lump.sub(far2.mul(lump.mul(0.55).add(0.7))));
        const haze = exp(far2.mul(-2.6)).mul(smoothstep(0.25, 0.95, lump).mul(1.15).add(0.05))
            .mul(float(1.0).sub(smoothstep(0.7, 1.0, far2)));
        const body = mix(torn, clamp(haze, 0.0, 1.0), vSoft).toVar();
        // Lit from the lamp's side; its thin edge passes light, its heart keeps it.
        const side = dot(q, vLight.zw).mul(0.34).add(0.72);
        const edge = float(1.0).sub(body).mul(0.5).add(0.78);
        const cover = clamp(body.mul(vLight.y), 0.0, 1.0);
        // (Water is whiter than the mist round it.)
        return vec4(vec3(vLight.x.mul(side).mul(edge).mul(mix(float(1.35), float(0.8), vSoft)).mul(cover)), cover);
    })();

    const part = cnPart('CosmicNoirBurst', geometry, material, -90);
    part.count = count;
    return part;
}

/**
 * The drops: bright streaks flung off the rock, added to the picture.
 * @param {object} u      shared uniforms
 * @param {number} count  drops (shared between the waves breaking at once)
 */
export function createDrops(u, count) {
    const geometry = quadGeometry(seedsFor(count, 0x5e4), count);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    });
    material.name = 'CosmicNoirSpray';
    material.fog = false;
    // Premultiplied and added: a drop returns its light with no alpha, so it only ever adds.
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    material.forceSinglePass = true;

    const seed = attribute('aSeed', 'vec4');
    const draw = fract(seed.w);
    const row = u.splashes.element(int(floor(seed.w)));
    const strength = row.y;
    const bearing = seed.x.sub(0.5).mul(2.0 * ARC);
    const c = cos(bearing);
    const s = sin(bearing);
    const outward = vec2(c.mul(UPSTREAM[0]).sub(s.mul(UPSTREAM[1])), s.mul(UPSTREAM[0]).add(c.mul(UPSTREAM[1])));
    const face = pow(max(c.mul(0.5).add(0.5), 0.0), 1.5);
    const age = row.x.sub(float(1.0).sub(c).mul((ROCK.shore / ROLLERS.speed) * 0.9)).sub(draw.mul(0.6));
    const power = sqrt(max(strength, 0.0)).mul(face.mul(0.45).add(0.55));
    // Many low, a few flung high.
    const lift = power.mul(seed.y.mul(seed.y).mul(7.4).add(2.2));
    const flight = lift.mul(2.0 / FALL);
    /** Where a drop is `at` seconds into its flight. */
    const placeAt = (at) => {
        const height = lift.mul(at).sub(at.mul(at).mul(FALL * 0.5));
        const reach = seed.z.mul(2.3).add(0.3).mul(at).add(ROCK.shore * 0.86);
        const aside = seed.z.sub(0.5).mul(0.9).mul(at);
        const flat = outward.mul(reach).add(vec2(outward.y.negate(), outward.x).mul(aside))
            .sub(vec2(UPSTREAM[0], UPSTREAM[1]).mul(at.mul(at).mul(0.3)));
        return vec3(flat.x.add(ROCK_XZ[0]), height.add(SEA.level + 0.1), flat.y.add(ROCK_XZ[1]));
    };
    const a = clamp(age, 0.0, flight);
    const world = placeAt(a);
    const before = placeAt(max(a.sub(0.035), 0.0));
    const view = cameraProjectionMatrix.mul(cameraViewMatrix);
    const clip = view.mul(vec4(world, 1.0));
    const clipBefore = view.mul(vec4(before, 1.0));
    const half = u.viewport.mul(0.5);
    // Drawn along its own flight: as long as it flew in a twenty-eighth of a second.
    const here = clip.xy.div(max(clip.w, 0.5)).mul(half);
    const there = clipBefore.xy.div(max(clipBefore.w, 0.5)).mul(half);
    const flown = here.sub(there);
    const flownPx = max(length(flown), 1e-3);
    const along = flown.div(flownPx);
    const units = draw.mul(draw).mul(0.034).add(0.012);
    const rawPx = units.mul(u.viewport.y).div(u.tanHalf.y.mul(2.0)).div(max(clip.w, 0.5));
    // Never thinner than a pixel (it dims instead), never a blob.
    const wide = clamp(rawPx, 1.2, 5.0);
    const long = clamp(flownPx.mul(0.7), wide, 26.0);
    const corner = positionGeometry.xy.mul(2.0);
    const offset = along.mul(corner.x.mul(long)).add(vec2(along.y.negate(), along.x).mul(corner.y.mul(wide)));
    material.vertexNode = vec4(clip.xy.add(offset.div(half).mul(clip.w)), clip.z, clip.w);

    // In the air only: fading in as it leaves, dimming as it falls back.
    const alive = smoothstep(0.0, 0.05, age).mul(float(1.0).sub(smoothstep(flight.mul(0.6), flight, age)))
        .mul(clamp(strength.mul(4.0), 0.0, 1.0))
        .mul(float(1.0).sub(hiddenBy(u, world)));
    const fromLamp = length(world.sub(u.pulsar)).div(PULSAR.coreReach * 1.5);
    const lit = u.coreGain.mul(LAMP_FALL).div(fromLamp.mul(fromLamp).add(1.0))
        .add(cnLampAt(u, world, float(0.16)).mul(LAMP_SHARE))
        .add(u.galaxy.mul(GALAXY_SHARE * 2.0))
        .add(u.skyGlow.mul(1.6))
        .add(u.ambient.mul(3.0));
    // (A streak spreads a drop's light along its length.)
    const vLight = varying(lit.mul(alive).mul(clamp(rawPx.div(1.2), 0.35, 1.0)).mul(strength.mul(0.5).add(0.5))
        .mul(mix(float(1.0), wide.div(long), 0.55))
        .mul(u.breath)
        .mul(DROP_GAIN), 'cnSprayLight');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const soft = exp(dot(q, q).mul(-3.2));
        return vec4(vec3(vLight.mul(soft)), 0.0);
    })();

    const part = cnPart('CosmicNoirSpray', geometry, material, -89);
    part.count = count;
    return part;
}
