import { lerp } from './waves-core.js';
import { exposedWater } from './waves-wake-lace.js';

// A breaking crest has a continuous white foot with separate strands lifting out of it.
// Lay that foot directly on the visible trough. The noise, wind and gravity then belong
// to the ordinary foam and spray pools, including during the four-line time hold.
const SALT = [0.81, 1, 1.04];
const SUNLIT = [1.15, 0.90, 0.67];
const hit = {};

/**
 * A small breaker peels from one end to the other. Horizontal coordinates run across
 * the part of the trough exposed to the left of the boards. On narrow layouts the
 * breaker runs along the strip of water under the well.
 */
function peel(world, x0, y0, x1, y1, {
    delay = 0, duration = 0.45, bow = 0, lift = 0.55, along = 0, ahead = 0, warm = false,
} = {}) {
    if (!world.spray || !world.camera) return;
    const { clock, fxRand: rand } = world;
    const cards = world.layout?.cards;
    const left = world.hasBoard && cards?.length ? Math.min(...cards.map((card) => card.x0)) : 0.44;
    const narrow = left < 0.17;
    const width = narrow ? 0.67 : Math.min(0.42, left - 0.04);
    const start = narrow ? 0.12 : 0.025;
    const sites = Math.round(8 + 8 * Math.min(1, world.tier.foam / 72));
    const strands = Math.max(2, Math.round(Math.min(1, world.tier.spray / 2400) * 5));
    const tint = warm ? SUNLIT : SALT;
    const phase = rand() * 6.28;
    for (let i = 0; i < sites; i += 1) {
        const u = i / (sites - 1);
        const swell = Math.sin(Math.PI * u);
        const x = start + width * lerp(x0, x1, u);
        const y = lerp(y0, y1, u) + bow * swell + 0.003 * Math.sin(phase + u * 16);
        world.castScreen(x, narrow ? 0.89 + (y - 0.58) * 0.23 : y, hit);
        const where = Math.min(1.6, Math.max(0.6, hit.t / 6));
        const birth = clock + delay + u * duration;
        const height = (0.36 + 0.64 * swell) * lift * where;
        if (i % 2 === 0) {
            world.foam.puff(clock, birth, hit.x, hit.y + 0.05 * where, hit.z, {
                v: [along * 0.3, height * 0.18, ahead * 0.45],
                size: (0.10 + 0.16 * swell) * where,
                spread: 0.24 * where,
                flat: 0.86,
                strength: 0.29 + swell * 0.18,
                life: 1.6 + 0.7 * swell,
            });
        }
        for (let j = 0; j < strands; j += 1) {
            const crest = (0.65 + rand() * 0.65) * height;
            world.spray.drop(
                clock,
                birth + rand() * 0.09,
                hit.x + (rand() - 0.5) * 0.06,
                hit.y + 0.055 * where,
                hit.z,
                along * (0.6 + 0.5 * swell) + (rand() - 0.5) * 0.11,
                crest,
                ahead + (rand() - 0.5) * 0.16,
                (0.016 + rand() * 0.024) * where,
                tint,
                1.1 + rand() * 0.9,
            );
        }
    }
}

/** A double splits like a bow wake. A triple trips three short, successively taller breakers. */
export function clearBreak(world, lines, cascade) {
    if (cascade > 1) {
        // Later falls skip out towards the sun, with water still falling from the previous skip.
        const skips = Math.min(4, cascade);
        for (let i = 0; i < skips; i += 1) {
            const y = 0.83 - i * 0.056;
            peel(world, 0.26 + i * 0.08, y, 0.49 + i * 0.05, y, {
                lift: 0.48 + 0.12 * i, delay: i * 0.17, duration: 0.1, bow: -0.012, ahead: -0.52,
            });
        }
    } else if (lines === 2) {
        peel(world, 0.49, 0.82, 0.12, 0.69, { along: -0.28, bow: -0.025 });
        peel(world, 0.49, 0.82, 0.92, 0.68, { along: 0.30, bow: -0.025 });
    } else if (lines === 3) {
        for (let i = 0; i < 3; i += 1) {
            const y = 0.70 + 0.055 * i;
            peel(world, 0.14 + i * 0.03, y, 0.63 + i * 0.11, y - 0.04, {
                delay: i * 0.19, lift: 0.6 + 0.18 * i, along: -0.23, ahead: 0.28, bow: -0.037, warm: true,
            });
        }
    }
}

const SEA_GLASS = [0.44, 1.1, 1.3];
const PHOSPHOR = [0.07, 0.75, 1.35];

/** Set a particle just in front of the moving glass at a point on the exposed wall. */
function onGlass(world, area, x, y) {
    world.castScreen(area.x0 + x * area.width, area.y0 + y * area.height, hit);
    const eye = world.camera.position;
    hit.x = lerp(hit.x, eye.x, 0.10);
    hit.y = lerp(hit.y, eye.y, 0.10);
    hit.z = lerp(hit.z, eye.z, 0.10);
    // A small target on a narrow margin keeps the motion and the droplets within that margin.
    return Math.max(0.12, Math.min(1.3, hit.t / 5)) * Math.min(1, area.height * 2.4, area.width * 5);
}

function recedingFoam(world, area) {
    const { clock, fxRand: rand } = world;
    const count = Math.min(17, Math.floor(world.foam.count / 2));
    for (let i = 0; i < count; i += 1) {
        const t = (i + 0.45 * rand()) / count;
        const arc = Math.sin(t * Math.PI);
        const s = onGlass(world, area, 0.2 + 0.59 * t, 0.47 + 0.20 * arc - 0.18 * t);
        const when = clock + t * 0.48;
        // The thinning shelf slumps from its middle first. The torn ends hang a moment longer.
        world.foam.puff(clock, when, hit.x, hit.y, hit.z, {
            v: [-0.13 * s, -(0.4 + arc * 0.8) * s, 0.12 * s],
            size: (0.11 + arc * 0.16) * s,
            spread: 0.15 * s,
            strength: 0.42 + rand() * 0.16,
            flat: 0.45 + 0.4 * rand(),
            life: 2.6 - arc * 0.65,
        });
        for (let j = 0; j < 2; j += 1) {
            world.spray.drop(
                clock,
                when + rand() * 0.13,
                hit.x,
                hit.y,
                hit.z,
                -0.1 * s,
                -(0.20 + rand() * 0.8) * s,
                0.16 * s,
                (0.026 + rand() * 0.034) * s,
                SALT,
                1.7,
            );
        }
    }
}

function risingBubbles(world, area) {
    const { clock, fxRand: rand } = world;
    const count = Math.min(56, Math.round(world.spray.count * 0.085));
    for (let i = 0; i < count; i += 1) {
        const t = i / count;
        const drift = Math.sin(t * 7.4) * 0.048;
        const x = 0.66 + drift - 0.12 * t + (rand() - 0.5) * (0.05 + 0.13 * t);
        const s = onGlass(world, area, x, 0.84 - 0.42 * t + 0.035 * rand());
        const size = (0.032 + rand() ** 2.4 * 0.105) * s;
        world.spray.drop(
            clock,
            clock + rand() * 0.48 + t * 0.26,
            hit.x,
            hit.y,
            hit.z,
            -0.08 * s,
            (0.7 + rand() * 0.49) * s,
            0.09 * s,
            -size,
            SEA_GLASS,
            1.65 + rand() * 0.7,
        );
    }
}

function fadingWake(world, area) {
    const { clock, fxRand: rand } = world;
    const count = Math.min(84, Math.round(world.spray.count * 0.105));
    for (let i = 0; i < count; i += 1) {
        const t = rand();
        const fan = Math.sin(t * Math.PI);
        // A fading streak of tiny luminous plankton in the backwash. Intermittent patches
        // catch the light, then go dark progressively from the far end.
        const x = 0.12 + t * 0.67;
        const y = 0.75 - t * 0.24 + fan * 0.07 + (rand() - 0.5) * (0.025 + 0.13 * fan);
        const s = onGlass(world, area, x, y);
        const pulse = 0.5 + 0.5 * Math.sin(t * 18.5 + 0.4);
        const size = (0.014 + (0.03 + pulse * 0.055) * rand()) * s;
        world.spray.drop(
            clock,
            clock + (1 - t) * 0.42,
            hit.x,
            hit.y,
            hit.z,
            -0.13 * s,
            0.1 * s,
            -(0.2 + rand() * 0.26) * s,
            size,
            PHOSPHOR,
            1.0 + 1.8 * t,
        );
    }
}

/** The direction the water travels describes what happened to the player's well. */
export function versusBreak(world, kind, lines) {
    const force = 0.55 + Math.min(8, lines) * 0.06;
    switch (kind) {
    case 'incoming':
        // A broad white bore rolls in towards the rider.
        peel(world, 0.05, 0.67, 0.96, 0.72, { lift: force, bow: -0.035, ahead: 1.45 });
        break;
    case 'outgoing':
        // A fast rip current pulls a narrow train of spray back out to sea.
        peel(world, 0.78, 0.86, 0.36, 0.63, {
            lift: 0.45, along: -0.15, ahead: -1.3 * force, warm: true,
        });
        break;
    case 'counter':
        // Two opposed sheets collide in a single rising splash.
        peel(world, 0.08, 0.8, 0.49, 0.72, { lift: force, along: 0.65, bow: -0.014 });
        peel(world, 0.90, 0.8, 0.49, 0.72, { lift: force, along: -0.65, bow: -0.014 });
        break;
    case 'topout':
        if (world.camera) recedingFoam(world, exposedWater(world));
        break;
    case 'respawn':
        if (world.camera) risingBubbles(world, exposedWater(world));
        break;
    case 'end':
        if (world.camera) fadingWake(world, exposedWater(world));
        break;
    default: break;
    }
}
