/**
 * Fall — the light and the floor's motion that the game's events own.
 *
 * FallReactions describes each event's own form in board terms (`frame.fx`); this module holds the
 * uniforms those forms are drawn from and the small TSL hooks the grove's materials take them by:
 *
 *   rings    a hard drop's thump and a perfect clear's wave: a ring running out over the floor from
 *            the card's foot. The litter hops as its crest passes (`hop`), the grass bows outward
 *            (`bow`), and the carpet under them takes a crest of light (`onGround`).
 *   floods   the sunburst's light rolling over the floor from the sun toward the eye, with an
 *            afterglow behind its edge (`gain`, in `onGround`, `onFloor`, `onBark`, `onFoliage`).
 *   dawn     a level's light front crossing the grove downwind (`gain` again).
 *   pulses   a back-to-back: a band of amber light climbing the two great trunks (`onBark`) and
 *            their crowns glowing from inside as it arrives (`onFoliage`).
 *   canopy   from three lines the crowns turn their pale undersides to each gust front as it
 *            passes (`onFoliage`, read off the light rig's own front uniforms).
 *
 * Each hook is one call in a material and costs a few exponentials, most of them in the vertex
 * stage (the readings are varyings). A tier that does not carry a hook gets the colour or the
 * position back untouched: the node is never built (a zero uniform switches nothing off).
 *
 * `update()` turns the director's readings into world space: where the card's foot stands on the
 * floor (FallStage), how far a ring of a given age has run, where a flood's edge is.
 */
import * as THREE from 'three/webgpu';
import {
    atan, exp, float, length, max, min, saturate, smoothstep, uniform, varying, vec2, vec3,
} from 'three/tsl';
import { flashScale } from '../../utils/photosensitivity.js';
import { FALL_FEATURE_TREES } from './fall-composition.js';
import { FALL_TIERS } from './fall-quality.js';
import { FALL_STAGE_DEPTH } from './fall-stage.js';

/**
 * What the show scales by tier (the grove's own table is fall-quality.js):
 *   light    the fragment hooks (floods, the light front, the trunk pulse, the pale canopy)
 *   crest    the ring's crest of light on the carpet (a per-pixel term of the largest surface)
 *   floor    the vertex hooks (the litter hops, the grass bows)
 *   keys, acorns, lights   particles in flight at once: maple keys, acorns, motes and sparks
 *   lanterns the ring of lantern light at the card's foot
 *   birds    the flock a perfect clear startles out of the trees
 *   fan      the sunburst's fan of beams (it stands in the volumetric shafts, so only where they are)
 */
const COLUMNS = ['light', 'crest', 'floor', 'keys', 'acorns', 'lights', 'lanterns', 'birds', 'fan'];
const ROWS = {
    Extreme: [true, true, true, 560, 48, 1500, 30, 36, true],
    Ultra: [true, true, true, 460, 40, 1200, 28, 30, true],
    High: [true, true, true, 380, 32, 950, 26, 26, true],
    Medium: [true, false, true, 240, 24, 560, 20, 18, true],
    Low: [false, false, true, 130, 16, 280, 14, 12, false],
    Minimal: [false, false, false, 64, 8, 130, 10, 8, false],
};
export const FALL_EVENT_TIERS = Object.freeze(Object.fromEntries(Object.entries(ROWS).map(([name, row]) => [
    name,
    Object.freeze(Object.fromEntries(COLUMNS.map((key, index) => [key, row[index]]))),
])));

/** The show's tier for a quality name or for a row of FALL_TIERS (High for anything else). */
export function fallEventTier(quality) {
    if (typeof quality === 'string' && FALL_EVENT_TIERS[quality]) return FALL_EVENT_TIERS[quality];
    const name = Object.keys(FALL_TIERS).find((key) => FALL_TIERS[key] === quality);
    return FALL_EVENT_TIERS[name] || FALL_EVENT_TIERS.High;
}

/** How far a ring has run at `age` seconds (metres): it leaves fast and slows as it spreads. */
export function fallRingRadius(age, wave = false) {
    const t = Number.isFinite(age) ? Math.max(0, age) : 0;
    return wave ? 0.8 + 27 * (1 - Math.exp(-t * 1.05)) : 0.5 + 9 * (1 - Math.exp(-t * 1.7));
}

/** How much of a ring is left at `age` of `life` seconds: in over a few frames, out over its run. */
export function fallRingFade(age, life) {
    if (!(life > 0) || !Number.isFinite(age) || age <= 0 || age >= life) return 0;
    const u = age / life;
    return Math.min(1, age / 0.07) * (1 - u * u);
}

/** The way a flood of light rolls over the floor: from the sun (far, left) toward the eye. */
const FLOOD_AXIS = Object.freeze([0.397, 0.918]);
/** Where along that axis a flood's edge sets out and how far it rolls (metres). */
const FLOOD_RUN = Object.freeze([-88, 116]);
/**
 * How high a pulse of light has climbed a trunk at `age` seconds (metres above its foot): steadily
 * up the few metres of trunk the eye sees, then away into the crown.
 */
export function fallPulseHeight(age) {
    const t = Math.max(0, Number.isFinite(age) ? age : 0);
    const away = Math.max(0, t - 0.85);
    return -0.7 + 6.4 * t + 11 * away * away;
}
/** The crowns' glow from inside over a pulse's life: it swells as the light arrives and breathes out. */
export function fallCrownGlow(age) {
    const t = Number.isFinite(age) ? age : -1;
    if (t <= 0.5 || t >= 2.6) return 0;
    const rise = Math.min(1, (t - 0.5) / 0.7);
    const fall = Math.min(1, (2.6 - t) / 1.1);
    return rise * rise * (3 - 2 * rise) * fall * fall * (3 - 2 * fall);
}
/** The colours: a flood and a light front are gold, a pulse is amber. */
const GOLD = Object.freeze([1.0, 0.8, 0.5]);
const AMBER = Object.freeze([1.5, 0.44, 0.05]);
/**
 * The light's gain at full strength: a flood, a light front, a ring's crest on the carpet; and the
 * share of the first two that the trees take (the flood is the floor's: the trunks and the crowns
 * keep their depth).
 */
const GAIN = Object.freeze({
    flood: 0.75, dawn: 1.1, crest: 2.0, trees: 0.45,
});
/** How far the litter hops on a ring's crest and the grass bows (metres at full strength). */
const HOP = Object.freeze({ lift: 0.3, push: 0.12, front: 0.07 });
const BOW = 0.34;
/** How fast the crowns turn pale to a passing front and back (per second). */
const CANOPY_EASE = 7;
const RING_ROWS = 3;

const unit = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);

export class FallEventLight {
    /** @param {object} light the grove's light rig (FallLight): its tier, its fronts, its noise */
    constructor(light) {
        this.light = light;
        this.tier = fallEventTier(light?.tier);
        // Rings: centre x, centre z, radius, strength (a spent row is all zero).
        this.uRings = Array.from({ length: RING_ROWS }, () => uniform(new THREE.Vector4(0, 0, 1, 0)));
        // Two floods: where each edge stands along the flood axis, and its strength.
        this.uFlood = uniform(new THREE.Vector4(FLOOD_RUN[0], 0, FLOOD_RUN[0], 0));
        // The light front: world x, strength, width.
        this.uDawn = uniform(new THREE.Vector4(0, 0, 9, 0));
        // Two pulses: how high each stands on a trunk, and its strength; then the crowns' glow.
        this.uPulse = uniform(new THREE.Vector4(0, 0, 0, 0));
        this.uCrown = uniform(0);
        // How pale the crowns turn to a passing front.
        this.uCanopy = uniform(0);
        // How much of the floor's motion plays (reduced motion).
        this.uMotion = uniform(1);
        this.point = new THREE.Vector3();
        /** What update() last wrote, as plain numbers (diagnostics and tests). */
        this.state = {
            rings: 0, floods: 0, dawn: 0, pulses: 0, crown: 0, canopy: 0,
        };
    }

    // -- TSL -----------------------------------------------------------------------------------
    /** Every ring's crest at a place on the floor: a bell across the ring's edge, times its strength. */
    crest(xz) {
        let sum = float(0);
        for (const ring of this.uRings) {
            const reach = length(xz.sub(ring.xy)).sub(ring.z).div(ring.z.mul(0.09).add(0.75));
            sum = sum.add(exp(min(reach.mul(reach), 30).negate()).mul(ring.w));
        }
        return sum;
    }

    /**
     * The rings as light on the carpet: bright on each crest, a little darker in the trough that
     * follows it inside the ring, so the ring has a shape and is not only a brightening.
     */
    ripple(xz) {
        let sum = float(0);
        for (const ring of this.uRings) {
            const reach = length(xz.sub(ring.xy)).sub(ring.z).div(ring.z.mul(0.09).add(0.75));
            const trough = reach.add(1.9);
            sum = sum.add(exp(min(reach.mul(reach), 30).negate())
                .sub(exp(min(trough.mul(trough), 30).negate()).mul(0.38)).mul(ring.w));
        }
        return sum;
    }

    /** The crests as a push outward along the floor (xz), for whatever bows or is carried. */
    push(xz) {
        let sum = vec2(0, 0);
        for (const ring of this.uRings) {
            const offset = xz.sub(ring.xy);
            const range = max(length(offset), 0.001);
            const reach = range.sub(ring.z).div(ring.z.mul(0.09).add(0.75));
            sum = sum.add(offset.div(range).mul(exp(min(reach.mul(reach), 30).negate()).mul(ring.w)));
        }
        return sum;
    }

    /** How hard the gust fronts blow at a world x (the light rig's own three fronts). */
    fronts(x) {
        const { light } = this;
        const width = light.uFrontC.z;
        const gale = (at, strength) => {
            const off = x.sub(at).div(width);
            return exp(min(off.mul(off), 30).negate()).mul(strength);
        };
        return gale(light.uFront.x, light.uFront.y).add(gale(light.uFront.z, light.uFront.w))
            .add(gale(light.uFrontC.x, light.uFrontC.y));
    }

    /**
     * The floods and the light front at a place, as one gain (0 at rest). Read in the vertex stage:
     * both are tens of metres broad.
     */
    gain(world) {
        const along = world.x.mul(FLOOD_AXIS[0]).add(world.z.mul(FLOOD_AXIS[1]));
        const flood = (edge, strength) => {
            const behind = edge.sub(along);
            // Bright at the edge, an afterglow behind it; nothing ahead of it.
            return smoothstep(-4, 2, behind).mul(exp(max(behind, 0).div(-18)).mul(0.72).add(0.28)).mul(strength);
        };
        const floods = flood(this.uFlood.x, this.uFlood.y).add(flood(this.uFlood.z, this.uFlood.w));
        const off = world.x.sub(this.uDawn.x);
        const band = off.div(this.uDawn.z);
        const dawn = exp(min(band.mul(band), 30).negate())
            .add(float(1).sub(smoothstep(-3, 3, off)).mul(exp(min(off, 0).div(22))).mul(0.4))
            .mul(this.uDawn.y);
        return varying(floods.mul(GAIN.flood).add(dawn.mul(GAIN.dawn)), 'vFallEventGain');
    }

    /** `lit` in the floods' and the light front's gold (`share`: how much of them this surface takes). */
    gilded(lit, world, share = 1) {
        return lit.mul(vec3(1, 1, 1).add(vec3(...GOLD).mul(this.gain(world).mul(share))));
    }

    /** The carpet: the floods and the light front, and the ring's crest of light. */
    onGround(lit, { world }) {
        if (!this.tier.light) return lit;
        const gilded = this.gilded(lit, world);
        if (!this.tier.crest) return gilded;
        return gilded.mul(max(this.ripple(world.xz).mul(GAIN.crest).add(1), 0.5));
    }

    /** Whatever lies or grows on the floor: the floods and the light front. */
    onFloor(lit, { world }) {
        return this.tier.light ? this.gilded(lit, world) : lit;
    }

    /**
     * The bark: the floods and the light front, and on the two great trees a band of amber light
     * climbing the trunk, an ember of it left below. `tree` is the instance's foot (xyz) and height.
     */
    onBark(lit, { world, tree }) {
        if (!this.tier.light) return lit;
        const { light } = this;
        const rise = world.y.sub(tree.y);
        const band = (height, strength) => {
            const off = rise.sub(height);
            const reach = off.div(0.55);
            return exp(min(reach.mul(reach), 30).negate())
                .add(float(1).sub(smoothstep(-0.4, 0.4, off)).mul(exp(min(off, 0).div(1.5))).mul(0.3))
                .mul(strength);
        };
        const pulse = varying(
            band(this.uPulse.x, this.uPulse.y).add(band(this.uPulse.z, this.uPulse.w)).mul(this.great(tree)),
            'vFallTrunkPulse',
        );
        // The light runs up the furrows: fine streaks drawn out along the trunk, the bark dark between them.
        // (Read round the trunk's own axis, so the streaks stand upright on either tree.)
        const round = atan(world.z.sub(tree.z), world.x.sub(tree.x)).div(Math.PI * 2);
        const grain = light.noise(vec2(round.mul(3), world.y.mul(0.025))).level(0);
        const veins = smoothstep(0.47, 0.68, grain.b.mul(0.6).add(grain.a.mul(0.4))).mul(0.9).add(0.1);
        return this.gilded(lit, world, GAIN.trees).add(vec3(...AMBER).mul(pulse).mul(veins));
    }

    /**
     * The leaves on the trees: the floods and the light front; pale undersides turned to a passing
     * front; and the two great crowns glowing from inside when a pulse arrives. `glowing` is the
     * leaf's own backlit colour.
     */
    onFoliage(lit, { world, tree, glowing }) {
        if (!this.tier.light) return lit;
        const pale = varying(this.fronts(world.x).mul(this.uCanopy), 'vFallCanopyPale');
        const inner = varying(
            this.uCrown.mul(this.great(tree)).mul(smoothstep(2.5, 7, world.y.sub(tree.y))),
            'vFallCrownGlow',
        );
        return this.gilded(lit, world, GAIN.trees).mul(saturate(pale).mul(0.55).add(1))
            .add(glowing.mul(vec3(...AMBER)).mul(inner).mul(0.5));
    }

    /** 1 on the two great trees (by where the instance stands), 0 on every other. */
    great(tree) {
        let mask = float(0);
        for (const hero of FALL_FEATURE_TREES.slice(0, 2)) {
            const off = tree.xz.sub(vec2(hero.x, hero.z));
            mask = mask.add(float(1).sub(smoothstep(0.5, 1.5, length(off))));
        }
        return saturate(mask);
    }

    /**
     * The litter: a leaf hops as a ring's crest passes under it and is carried a little outward,
     * and flutters up as a gust front goes over. `weight` (0..1) is the leaf's own lightness.
     */
    hop(world, weight) {
        if (!this.tier.floor) return vec3(0, 0, 0);
        const lift = this.crest(world.xz).mul(HOP.lift).add(this.fronts(world.x).mul(HOP.front));
        const out = this.push(world.xz).mul(HOP.push);
        return vec3(out.x, lift, out.y).mul(weight).mul(this.uMotion);
    }

    /** The grass and the ferns: they bow outward as a ring's crest passes. `height` is 0 at the root, 1 at the tip. */
    bow(world, height) {
        if (!this.tier.floor) return vec3(0, 0, 0);
        const out = this.push(world.xz).mul(height.mul(height)).mul(BOW).mul(this.uMotion);
        return vec3(out.x, length(out).mul(-0.35), out.y);
    }

    // -- the frame ---------------------------------------------------------------------------
    /**
     * Take the director's frame. `stage` says where the card's foot stands in the grove (none: the
     * rings stay where they were, at no strength).
     * @param {object} [frame] FallReactions' frame (its `fx`, `motion`)
     * @param {{ stage?: object | null, flash?: number, dt?: number }} [options]  `dt`: the frame's
     *   seconds, for what eases (without one, a seek or a rest, everything is set at once)
     */
    update(frame = {}, { stage = null, flash = flashScale(), dt } = {}) {
        const fx = frame && typeof frame === 'object' && frame.fx && typeof frame.fx === 'object' ? frame.fx : {};
        const { state } = this;
        const dim = Number.isFinite(flash) ? Math.max(0, Math.min(1, flash)) : 1;
        this.uMotion.value = Number.isFinite(frame?.motion) ? unit(frame.motion) : 1;
        // Rings: each a function of its own age, laid in whichever row (they are summed).
        const rings = Array.isArray(fx.rings) ? fx.rings : [];
        let row = 0;
        for (let i = 0; i < rings.length && row < RING_ROWS; i += 1) {
            const ring = rings[i];
            const strength = stage && ring ? unit(ring.strength) * fallRingFade(ring.age, ring.life) : 0;
            if (strength > 0) {
                const { board } = stage;
                const sx = board.x0 + (board.x1 - board.x0) * unit(ring.column);
                const foot = stage.point(sx, board.y1, FALL_STAGE_DEPTH, this.point);
                // (A wave is the whole floor's: stronger and broader than a thump at the same reading.)
                this.uRings[row].value.set(foot.x, foot.z, fallRingRadius(ring.age, ring.wave), strength * (ring.wave ? 1.5 : 1));
                row += 1;
            }
        }
        state.rings = row;
        for (; row < RING_ROWS; row += 1) this.uRings[row].value.set(0, 0, 1, 0);
        // Floods of light: where each edge has rolled to.
        const floods = Array.isArray(fx.floods) ? fx.floods : [];
        const edge = (flood) => (flood && Number.isFinite(flood.travel)
            ? FLOOD_RUN[0] + FLOOD_RUN[1] * (1 - (1 - unit(flood.travel)) ** 1.7) : FLOOD_RUN[0]);
        const strong = (flood) => (flood && Number.isFinite(flood.strength)
            ? Math.max(0, Math.min(1.25, flood.strength)) * dim : 0);
        this.uFlood.value.set(edge(floods[0]), strong(floods[0]), edge(floods[1]), strong(floods[1]));
        state.floods = (strong(floods[0]) > 0 ? 1 : 0) + (strong(floods[1]) > 0 ? 1 : 0);
        // The light front, where the gust fronts cross (world x from its place across the view).
        const dawn = fx.light && typeof fx.light === 'object' ? fx.light : null;
        const half = stage && typeof stage.halfWidth === 'function' ? stage.halfWidth(26) : 24;
        const dawnX = dawn && Number.isFinite(dawn.position) ? dawn.position * half : 0;
        state.dawn = dawn && Number.isFinite(dawn.strength) ? Math.max(0, Math.min(1.25, dawn.strength)) * dim : 0;
        this.uDawn.value.set(dawnX, state.dawn, 4.2, 0);
        // Pulses up the two great trunks, and the crowns' glow as they arrive.
        const pulses = Array.isArray(fx.pulses) ? fx.pulses : [];
        let crown = 0;
        const climb = (pulse) => {
            if (!pulse || !Number.isFinite(pulse.age)) return [0, 0];
            const strength = unit(pulse.strength);
            crown += strength * fallCrownGlow(pulse.age);
            // (The band thins away as it leaves the trunk for the crown.)
            return [fallPulseHeight(pulse.age), strength * Math.min(1, pulse.age / 0.12) * unit((1.9 - pulse.age) / 0.6)];
        };
        const [h0, s0] = climb(pulses[0]);
        const [h1, s1] = climb(pulses[1]);
        this.uPulse.value.set(h0, s0, h1, s1);
        this.uCrown.value = Math.min(1.3, crown);
        state.pulses = (s0 > 0 ? 1 : 0) + (s1 > 0 ? 1 : 0);
        state.crown = this.uCrown.value;
        // The crowns turn pale to the fronts from three lines up (two lines only open the shafts).
        // (Eased: the threshold steepens the swell's rise about fourfold, and a crown turned pale in
        // one frame reads as a flicker, not as leaves turned by the wind.)
        const canopy = unit(fx.canopy);
        const t = unit((canopy - 0.45) / 0.35);
        const pale = t * t * (3 - 2 * t);
        const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
        this.uCanopy.value = step > 0 ? this.uCanopy.value + (pale - this.uCanopy.value) * (1 - Math.exp(-step * CANOPY_EASE))
            : pale;
        state.canopy = this.uCanopy.value;
    }

    /** Everything at rest (a new world, the effects setting off). */
    reset() {
        this.update({});
    }
}

/**
 * A small seeded generator for the show (mulberry32): what the events throw draws its chances from
 * its own stream, so nothing here shifts the draws the grove itself is built and played with.
 * @param {number} seed
 * @returns {() => number}
 */
export function fallEventRandom(seed = 1) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), state | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
