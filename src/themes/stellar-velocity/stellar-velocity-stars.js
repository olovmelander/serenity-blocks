/**
 * Stellar Velocity — what we fly past.
 *
 *  - The near stars: suns that stand IN the canyon and the space round it. They come toward us
 *    as we fly, slide past and are left behind, each wrapped back to the far end of its own
 *    depth. At speed three things happen to them at once, all from one number (the share of
 *    light's speed the sky is shown at): they bunch toward the sun (aberration), they shift
 *    through the starbow (blue dead ahead, through white, amber and red out to the sides), and
 *    they draw out into trails as long as the ground they cover in a shutter's time.
 *  - The dust: motes close to the lens, lit by the sun. At rest they hang and drift by; at speed
 *    they are the lines that tell the eye how fast it is going.
 *
 * Both are one draw of instanced quads, strung between where a point is now and where it was a
 * shutter ago. Nothing is simulated: a point's place is a function of how far we have come.
 */

import {
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    exp,
    float,
    length,
    max,
    min,
    mix,
    mod,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    sqrt,
    step,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    TAU, mulberry32, svBowShift, svFxMaterial, svPart, svQuadGeometry, svSeenCos, svShift, svStarbow,
} from './stellar-velocity-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

/** The near stars' depth (canyon units from the far end of their run to the camera) and what is kept behind it. */
export const STAR_DEPTH = 90;
export const STAR_BEHIND = 6;
/** The dust's. */
export const MOTE_DEPTH = 9;
export const MOTE_BEHIND = 1.5;

/**
 * Where something true at `point` (relative to the camera) is SEEN at speed `beta`: bunched
 * toward the course's far end, at the same range.
 */
const seenFrom = (rel, beta) => {
    const range = max(length(rel), 1e-4);
    const dir = rel.div(range);
    const truth = clamp(dir.z.negate(), -1.0, 1.0);
    const seen = svSeenCos(truth, beta);
    const side = dir.xy.div(max(sqrt(max(float(1.0).sub(truth.mul(truth)), 1e-8)), 1e-4));
    return {
        point: vec3(side.mul(sqrt(max(float(1.0).sub(seen.mul(seen)), 0.0))), seen.negate()).mul(range),
        seen,
        range,
    };
};

/**
 * @param {object} u
 * @param {object} options
 * @param {number} options.count
 * @param {'stars'|'motes'} options.kind
 * @param {number} [options.seed]
 */
export function createStreakField(u, { count, kind = 'stars', seed = 0x51a7 } = {}) {
    const stars = kind === 'stars';
    const depthSpan = stars ? STAR_DEPTH : MOTE_DEPTH;
    const behind = stars ? STAR_BEHIND : MOTE_BEHIND;
    const rand = mulberry32(seed);
    const aPlace = new Float32Array(count * 4);
    const aLook = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        const a = rand() * TAU;
        // Stars thin out away from the course; the dust hangs in and round the open channel.
        const r = stars ? 1.1 + rand() ** 2.1 * 24 : 0.1 + Math.sqrt(rand()) * 2.3;
        aPlace.set([Math.cos(a) * r, Math.sin(a) * r * (stars ? 0.8 : 1), rand() * depthSpan, rand()], i * 4);
        // (brightness: a few bright, most faint; size; warmth; twinkle phase)
        aLook.set([rand() ** (stars ? 7 : 2.4), 0.6 + rand() * 0.8, rand(), rand() * TAU], i * 4);
    }
    const geometry = svQuadGeometry(count, { aPlace: [aPlace, 4], aLook: [aLook, 4] });
    const place = attribute('aPlace', 'vec4');
    const look = attribute('aLook', 'vec4');
    const uniforms = {
        /** Seconds of travel a trail shows. */
        shutter: uniform(stars ? 0.34 : 0.09),
        /** The whole field's gain. */
        gain: uniform(1),
    };
    const travel = stars ? u.starTravel : u.moteTravel;
    // The dust is too near to bunch with the sky: it takes a share of it, as the canyon does.
    const beta = stars ? u.warp.mul(0.62) : u.warp.mul(0.5);

    /** A point of the field `lead` canyon units further along its run than it is now. */
    const at = (lead) => {
        // How far ahead of the camera it stands: it comes toward us and wraps to the far end.
        const ahead = mod(place.z.sub(travel).add(lead), depthSpan).sub(behind);
        const turn = u.twist.mul(ahead).mul(stars ? 0.35 : 1.0);
        const c = cos(turn);
        const s = sin(turn);
        const rel = vec3(
            place.x.mul(c).sub(place.y.mul(s)),
            place.x.mul(s).add(place.y.mul(c)),
            ahead.negate(),
        ).sub(u.camPos);
        return { rel, ahead };
    };
    const now = at(float(0.0));
    const was = at(u.speed.mul(uniforms.shutter));
    const seenNow = seenFrom(now.rel, beta);
    const seenWas = seenFrom(was.rel, beta);
    const c1 = viewProjection(seenNow.point.add(u.camPos));
    const c0 = viewProjection(seenWas.point.add(u.camPos));

    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(max(c0.w, 1e-3)).mul(half);
    const s1 = c1.xy.div(max(c1.w, 1e-3)).mul(half);
    const trail = s1.sub(s0);
    const trailLen = length(trail);
    const dirS = trail.add(vec2(1e-4, 0.0)).div(max(trailLen, 1e-4));
    const nrm = vec2(dirS.y.negate(), dirS.x);
    const along = positionGeometry.x.add(0.5);
    const clip = mix(c0, c1, along);

    // In front of the lens, and not at the seam where its run wraps.
    const farFade = float(1.0).sub(smoothstep(depthSpan * 0.72 - behind, depthSpan - behind - 0.5, now.ahead));
    const nearFade = smoothstep(stars ? 0.3 : 0.12, stars ? 2.5 : 0.5, seenNow.range);
    const front = step(0.02, min(c0.w, c1.w));
    const alive = farFade.mul(nearFade).mul(front);

    // A star a unit away is a few pixels wide; far ones are held at a pixel and dimmed instead.
    const world = stars ? look.y.mul(0.012) : look.y.mul(0.0035);
    const wantPx = world.div(max(seenNow.range, 0.05).mul(u.pixelAngle));
    const widthPx = clamp(wantPx, 1.15, stars ? 5.0 : 2.6).mul(step(1e-3, alive));
    const lead = dirS.mul(along.sub(0.5).mul(2.0)).mul(widthPx);
    const material = svFxMaterial(stars ? 'StellarVelocityStars' : 'StellarVelocityMotes');
    material.vertexNode = vec4(
        clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).add(lead).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );

    // ── Light (all of it decided per star, in the vertex stage) ──
    const shift = svShift(seenNow.seen, beta);
    const factor = pow(float(2.0), shift);
    const own = stars
        ? mix(vec3(1.0, 0.8, 0.62), vec3(0.7, 0.84, 1.0), look.z).mul(u.starTint)
        : mix(u.sunCol, u.glow.mul(2.0), look.z.mul(0.6));
    const tinted = smoothstep(0.03, stars ? 0.45 : 0.7, beta);
    const colour = mix(own, svStarbow(svBowShift(seenNow.seen, beta)), tinted.mul(stars ? 1.0 : 0.6));
    // What a pixel-wide star would have been, had it been drawn its true size.
    const shrink = min(float(1.0), wantPx.div(1.15));
    const twinkle = sin(u.time.mul(look.y.mul(1.7).add(0.6)).add(look.w)).mul(0.14).add(0.86);
    const near = stars
        ? float(1.0).div(float(1.0).add(seenNow.range.mul(seenNow.range).mul(0.012)))
        : smoothstep(MOTE_DEPTH - MOTE_BEHIND, 0.0, seenNow.range).mul(0.9).add(0.1);
    // Light piles up ahead and thins out to the sides.
    const beam = clamp(pow(factor, stars ? 1.2 : 1.0), 0.6, 2.4);
    // The canyon stands in front of the far ones.
    const veil = u.canyonAt(vec2(clip.x.div(max(clip.w, 1e-3)).mul(0.5).add(0.5), float(0.5).sub(clip.y.div(max(clip.w, 1e-3)).mul(0.5)))).a;
    const shown = mix(float(1.0), veil, smoothstep(stars ? 2.0 : 0.6, stars ? 14.0 : 4.0, seenNow.range));
    // A trail spreads one star's light along its length.
    const spread = float(1.0).div(float(1.0).add(trailLen.div(max(widthPx.mul(2.0), 1.0)).mul(stars ? 0.22 : 0.35)));
    const base = stars ? look.x.mul(6.0).add(0.09) : look.x.mul(0.5).add(0.05);
    // At speed a star that does not draw a trail is only noise: the far, faint ones give way to
    // the ones near enough to streak.
    const streaks = smoothstep(1.5, 10.0, trailLen);
    const atSpeed = mix(float(1.0), streaks.mul(2.0).add(0.12), tinted);
    const vLight = varying(
        colour.mul(base).mul(shrink).mul(twinkle).mul(near)
            .mul(beam)
            .mul(shown)
            .mul(spread)
            .mul(alive)
            .mul(atSpeed)
            .mul(uniforms.gain)
            .mul(u.breath)
            .mul(stars ? float(1.0) : u.sunGain.mul(0.5).add(0.5).mul(u.warp.mul(3.0).add(1.0))),
        stars ? 'svStarLight' : 'svMoteLight',
    );
    const vTrail = varying(trailLen.div(max(widthPx, 1.0)), stars ? 'svStarTrail' : 'svMoteTrail');

    // The quad is a capsule: round across, round at both ends, even along its trail.
    const q = uv().sub(0.5).mul(2.0);
    const stretch = vTrail.mul(0.5).add(1.0);
    const endX = max(q.x.abs().mul(stretch).sub(stretch.sub(1.0)), 0.0);
    const r2 = endX.mul(endX).add(q.y.mul(q.y));
    const body = exp(r2.mul(-3.6)).mul(float(1.0).sub(smoothstep(0.7, 1.0, r2)));
    // Brighter at the head: a trail fades back along where the star has been.
    const head = mix(float(0.35), float(1.0), smoothstep(-1.0, 1.0, q.x));
    material.colorNode = vec4(vLight.mul(body).mul(mix(float(1.0), head, smoothstep(0.5, 3.0, vTrail))), 0.0);

    const part = svPart(material.name, geometry, material, stars ? 10 : 30);
    part.uniforms = uniforms;
    part.count = count;
    return part;
}
