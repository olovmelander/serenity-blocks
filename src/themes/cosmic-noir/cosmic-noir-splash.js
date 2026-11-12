/**
 * Cosmic Noir — the breaking: a roller meets the rock and throws its smoke up the rock's face.
 *
 * A curtain of smoke stands up along the shore where the crest struck, first where it struck
 * head-on and a moment later round the flanks (the crest wraps the rock). It climbs fast and
 * slows, in fingers; then it hangs, leans over the rock with the wind, tears into threads and is
 * gone, leaving a veil that lingers. How high it goes follows how hard the wave broke: a wave
 * between sets throws a low burst, the tallest of a set throws its smoke half-way up the tower.
 *
 * It is a volume, walked along the view ray at the screen's own resolution, but only inside an
 * upright cylinder round the rock, only while a wave is breaking, and only as far as whatever
 * stands in the ray's way (the rock, the tower, the sea): smoke thrown up in front of the tower
 * veils it, smoke behind it is hidden. Each breaking wave is a few numbers (its age, its strength, a
 * seed) the world writes; the curtain is a function of those and the place, so a seek redraws it.
 *
 * Its light is what lights smoke here: the lamp from above (what the gallery lets fall, and the
 * beam when it sweeps through, which sets the whole plume ablaze), the galaxy from behind (thin
 * smoke passes its light forward, so the plume's edges are its brightest part), an echo's flash,
 * and a little of the starlight.
 */

import {
    Break,
    If,
    Loop,
    clamp,
    dot,
    exp,
    float,
    int,
    length,
    max,
    min,
    pow,
    screenCoordinate,
    smoothstep,
    vec2,
    vec3,
} from 'three/tsl';
import {
    PULSAR, ROCK, ROLLERS, SEA, SPLASH, SPLASH_SLOTS, ROCK_XZ, UPSTREAM, cnHash21, cnLampAt, cnPhase, cnUpright,
} from './cosmic-noir-tsl.js';
import { GALAXY_DIR } from './cosmic-noir-sky.js';

/** The cylinder the curtain is walked inside: round the rock's middle, from under the sea to over the tallest plume. */
const BOUND = Object.freeze({
    radius: ROCK.shore + 4.4, core: ROCK.shore - 1.1, y0: -0.7, y1: SPLASH.height * 1.5 * 1.7 + 1.2,
});
/** How thick the thrown smoke is (per unit of length, at its foot), and the veil it leaves. */
const SMOKE = 1.7;
const VEIL = 0.012;
/** The galaxy's light through the plume, and how much of the lamp's it shows. */
const GALAXY_LIGHT = 0.2;
const LAMP_LIGHT = 0.6;
const LAMP_FALL = 0.5;

/**
 * How much smoke one breaking wave has at a point `p` (from the rock's middle on the sea: x, up, z).
 * `row` = (seconds since it met the shore, how hard it broke, a seed, _).
 */
function curtain(u, p, row) {
    const age = row.x;
    const strength = row.y;
    const out = float(0.0).toVar();
    // How high in its own plume this smoke stands (0 at the foot, 1 at the crown): the crown is in the light.
    const high = float(0.0).toVar();
    const flat = p.xz.toVar();
    const reach = max(length(flat), 1e-3).toVar();
    const headOn = dot(flat.div(reach), vec2(UPSTREAM[0], UPSTREAM[1])).toVar(); // 1 where the crest struck, −1 in the lee
    // The crest wraps the rock: the flanks break a moment after the face.
    const local = age.sub(float(1.0).sub(headOn).mul((ROCK.shore / ROLLERS.speed) * 0.9)).toVar();
    const face = pow(clamp(headOn.mul(0.5).add(0.5), 0.0, 1.0), 1.5).toVar();
    // Nothing reaches the cylinder's wall: the curtain ends before it does.
    const inside = float(1.0).sub(smoothstep(BOUND.radius * 0.72, BOUND.radius * 0.98, reach));
    If(local.greaterThan(0.0).and(face.mul(inside).greaterThan(0.02)), () => {
        const climb = clamp(local.div(SPLASH.rise), 0.0, 1.0);
        const up = float(1.0).sub(float(1.0).sub(climb).mul(float(1.0).sub(climb))).toVar();
        const after = max(local.sub(SPLASH.rise), 0.0).toVar();
        const { y } = p;
        // The wind leans the hanging smoke over the rock: what is here came from upwind of here.
        const lean = min(after.mul(0.55), 2.0).mul(clamp(y.div(SPLASH.height * 0.5), 0.0, 1.3));
        const from = flat.add(vec2(UPSTREAM[0], UPSTREAM[1]).mul(lean)).toVar();
        const far = max(length(from), 1e-3).toVar();
        const along = from.div(far).mul(ROCK.shore * 0.34).toVar();
        // Its crown is ragged: some of the shore throws its smoke far higher than the rest (jets).
        const crown = u.smokeFar(vec3(along.x.mul(2.3).add(row.z.mul(5.3)), 0.37, along.y.mul(2.3).add(row.z.mul(2.9)))).toVar();
        const jet = smoothstep(0.3, 0.85, crown.r).mul(0.6).add(crown.g.mul(0.18)).add(0.42);
        // How high the smoke stands here now: it sinks a little as it hangs.
        const top = strength.mul(pow(face, 0.45)).mul(SPLASH.height).mul(up).mul(jet)
            .mul(float(1.0).sub(min(after.div(4.0), 1.0).mul(0.14)))
            .toVar();
        // Thrown up in fingers (the smoke is read along the shore and drawn out upward, rising with
        // the climb), which tear into threads as they hang: thin ones first, the foot last.
        const grain = u.smoke(vec3(along.x.mul(3.3).add(row.z.mul(3.1)), y.sub(up.mul(top).mul(0.8)).mul(0.085), along.y.mul(3.3).add(row.z.mul(1.7)))).toVar();
        // Its head billows: how high a place counts as rides on the smoke's own lumps, so the
        // crown is a ragged, rounded edge and never a ruled one.
        const billow = u.smoke(vec3(along.x.mul(1.4).add(row.z), y.sub(up.mul(top).mul(0.5)).mul(0.24), along.y.mul(1.4).sub(row.z))).toVar();
        const rise = clamp(y.div(top.add(0.25)).add(billow.r.sub(0.5).mul(0.55)).add(billow.b.sub(0.5).mul(0.25)), 0.0, 1.5).toVar();
        // A sheet on the shore at its foot, fanning outward and thickening as it climbs and ages.
        const middle = y.mul(0.3).add(ROCK.shore);
        const wide = y.mul(0.15).add(after.mul(0.3)).add(0.36).toVar();
        const off = far.sub(middle).div(wide).toVar();
        const sheet = exp(off.mul(off).negate());
        // Thick at its foot and thinning upward, a soft head, nothing under the sea.
        const head = float(1.0).sub(smoothstep(0.72, 1.0, rise));
        const column = exp(rise.mul(-1.5)).mul(1.3).add(0.3);
        const above = smoothstep(-0.5, 0.25, y);
        const born = smoothstep(0.0, 0.12, local);
        const dying = exp(after.div(-SPLASH.hang));
        const fingers = grain.g.mul(0.78).add(grain.r.mul(0.42)).add(grain.b.mul(0.15));
        const tear = min(after.div(SPLASH.hang), 1.0).mul(0.5).add(0.36)
            .sub(float(1.0).sub(min(rise, 1.0)).mul(0.14));
        const body = smoothstep(tear, tear.add(0.15), fingers);
        out.assign(strength.mul(face).mul(sheet).mul(head).mul(column)
            .mul(above)
            .mul(body)
            .mul(born)
            .mul(dying)
            .mul(SMOKE));
        // The veil it leaves: wider, thinner, slower to go.
        const veilOff = far.sub(middle).div(wide.mul(1.7));
        out.addAssign(strength.mul(face).mul(exp(veilOff.mul(veilOff).negate()))
            .mul(float(1.0).sub(smoothstep(0.2, 1.25, rise)))
            .mul(above)
            .mul(born)
            .mul(exp(after.div(-SPLASH.hang * 1.25)))
            .mul(VEIL));
        // All of it is gone before the wave after next: nothing hangs on as a stale box of haze.
        out.mulAssign(inside.mul(float(1.0).sub(smoothstep(SPLASH.life * 0.5, SPLASH.life - SPLASH.rise - 0.6, after))));
        high.assign(min(rise, 1.0));
    });
    return vec2(out, out.mul(high));
}

/**
 * Walk the view ray through the smoke the breaking waves have thrown up. Call inside a Fn.
 * @param {object} tStop  where the ray ends (on the rock, the tower or the sea): a var
 * @returns {{ light: object, through: object }} vars: the smoke's light, and how much of what
 *   lies behind it shows through
 */
export function cnSplash(u, o, ray, tStop, { steps = 16 } = {}) {
    const light = float(0.0).toVar();
    const through = float(1.0).toVar();
    let live = u.splashes.element(0).y;
    for (let k = 1; k < SPLASH_SLOTS; k++) live = live.add(u.splashes.element(k).y);
    If(live.greaterThan(0.002), () => {
        const foot = vec3(ROCK_XZ[0], SEA.level, ROCK_XZ[1]);
        const rel = o.sub(foot).toVar();
        // (No taller than the plumes standing now: a lesser wave is walked over a smaller part of the frame.)
        const bound = cnUpright(rel, ray, float(BOUND.radius), float(BOUND.y0), min(u.splashTop, BOUND.y1)).toVar();
        // The curtain is a shell round the rock: a ray that goes on into the rock's own core has
        // crossed all of it that shows (the far side stands behind the rock, in its lee), so the
        // walk ends there and its steps are spent on the near wall.
        const core = cnUpright(rel, ray, float(BOUND.core), float(BOUND.y0 - 1.0), float(BOUND.y1 + 1.0)).toVar();
        const t0 = max(bound.x, 0.0).toVar();
        const t1 = min(bound.y, tStop).toVar();
        If(core.z.greaterThan(0.5).and(core.x.greaterThan(t0)), () => {
            t1.assign(min(t1, core.x));
        });
        If(bound.z.greaterThan(0.5).and(t1.greaterThan(t0)), () => {
            const dt = t1.sub(t0).div(steps).toVar();
            // A different start per pixel: the grain of it sits in the film's own.
            // (White, like the film's grain it sits in: a patterned start would show as a screen.)
            const jitter = cnHash21(screenCoordinate.xy.add(u.time.mul(24.0).floor().mul(vec2(17.0, 31.0))));
            const t = t0.add(dt.mul(jitter)).toVar();
            const toEye = ray.negate().toVar();
            // What lights it, taken once where the ray is half-way through: the galaxy from
            // behind (thin smoke passes light forward) and an echo's flash as its shell passes.
            const midway = o.add(ray.mul(t0.add(t1).mul(0.5))).toVar();
            const galaxy = u.galaxy.mul(GALAXY_LIGHT)
                .mul(cnPhase(dot(vec3(GALAXY_DIR[0], GALAXY_DIR[1], GALAXY_DIR[2]), ray), float(0.5))).toVar();
            const flash = float(0.0).toVar();
            const fromLamp = length(midway.sub(u.pulsar)).toVar();
            Loop({
                start: int(0), end: u.echoCount, type: 'int', condition: '<', name: 'e',
            }, ({ e }) => {
                const a = u.echoes.element(e);
                const x = fromLamp.sub(a.x).div(a.y.mul(2.6));
                flash.addAssign(a.z.mul(exp(x.mul(x).negate())));
            });
            const fill = galaxy.add(flash.mul(0.55)).add(u.ambient.mul(2.2)).toVar();
            Loop(steps, () => {
                const p = rel.add(ray.mul(t)).toVar();
                const both = vec2(0.0, 0.0).toVar();
                for (let k = 0; k < SPLASH_SLOTS; k++) {
                    const row = u.splashes.element(k);
                    If(row.y.greaterThan(0.002), () => {
                        both.addAssign(curtain(u, p, row));
                    });
                }
                const smoke = both.x;
                If(smoke.greaterThan(0.003), () => {
                    const alpha = float(1.0).sub(exp(smoke.mul(dt).negate()));
                    const world = p.add(foot);
                    // The lamp: its light past the slats (the beam, when it sweeps through), and
                    // what falls through the gallery's grating onto whatever climbs toward it.
                    const under = length(world.sub(u.pulsar)).div(PULSAR.coreReach * 1.5);
                    const lamp = cnLampAt(u, world, float(0.14))
                        .mul(cnPhase(dot(world.sub(u.pulsar).normalize(), toEye), u.forward)).mul(LAMP_LIGHT)
                        .add(u.coreGain.mul(LAMP_FALL).div(under.mul(under).add(1.0)));
                    // Thin smoke is the bright part: a thick heart keeps its light to itself. And
                    // the head of a plume stands in more light than its foot under the rock.
                    const thin = exp(smoke.mul(-0.45)).mul(0.62).add(0.38);
                    const crownward = both.y.div(max(smoke, 1e-4));
                    const lifted = crownward.mul(crownward).mul(1.05).add(0.2);
                    light.addAssign(lamp.add(fill).mul(lifted).mul(thin).mul(alpha)
                        .mul(through));
                    through.mulAssign(float(1.0).sub(alpha));
                });
                t.addAssign(dt);
                // Nothing shows through any more: what lies deeper adds nothing.
                If(through.lessThan(0.03), () => {
                    Break();
                });
            });
            // Lit from behind, what the eye cannot see through is the dark part: the edges glow.
            light.mulAssign(through.mul(0.45).add(0.55).mul(u.breath));
        });
    });
    return { light, through };
}
