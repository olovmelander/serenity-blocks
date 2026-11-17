/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview THE ENDING'S LIGHTS (2026-11-17 masterpiece pass): lanterns and fireworks in the
 * journey's colours. Both are closed forms of the ending's clock (odyssey-journey-ending.js), so
 * the ending can be scrubbed, captured and replayed, and nothing is simulated.
 *
 *   Lanterns   warm paper lanterns let go in drifts from the street corners and the roofs, the
 *              boulevard's first, each carrying one of the eight chapters' colours in its paper.
 *              They rise past the eye on the wind, sway, thin out high up and are let go again:
 *              at the rest they are still rising, for as long as the player stays.
 *   Fireworks  the night's show over the whole upper sky, in the chapters' colours, several
 *              shells aloft at once, building to a finale as the first light shows:
 *                chrysanthemums  a full sphere of streaking stars with a pale heart;
 *                willows         gold tails that hang and fall for seconds;
 *                rings           a tilted ring of stars round a small heart;
 *                crossettes      stars that fly out and each split into four.
 *              Each star is a streak along the path it has just flown, a rocket climbs to each
 *              burst, and each burst leaves smoke hanging that catches the light of the next.
 *              The light the shells throw (`fireworksLightAt`) washes the cloud, the glass and
 *              the street through the sky's `burst` uniform. Everything a burst lights goes
 *              through `flashScale` where it is written (ADR-0021); under reduced motion there is
 *              no show, and the lanterns and the dawn remain.
 *
 * One instanced draw each, pure added light.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    exp,
    float,
    length,
    max,
    min,
    mix,
    mod,
    modelViewMatrix,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { STREET_Y, mulberry32 } from './odyssey-neon-city-plan.js';
import { latticeNoise3 } from './odyssey-lattice-noise.js';

/** The eight chapters' colours until the journey's chart hands over the real ones (scene-linear). */
export const JOURNEY_COLOURS_FALLBACK = Object.freeze([
    [1.0, 0.36, 0.08], [0.08, 0.5, 1.0], [0.3, 0.95, 0.4], [0.75, 0.9, 1.0],
    [0.4, 0.7, 1.0], [0.62, 0.36, 1.0], [1.0, 0.25, 0.62], [0.1, 0.9, 1.0],
]);

/**
 * The chapters' colours from the journey's chart: its orbs' colours in order, each new one once.
 * @param {ReadonlyArray<{ colour: ArrayLike<number> }>|null} chart
 * @returns {number[][]} up to eight [r, g, b]
 */
export function journeyColours(chart) {
    const out = [];
    (chart || []).forEach((orb) => {
        const c = orb?.colour;
        if (!c) return;
        const last = out[out.length - 1];
        if (!last || Math.abs(last[0] - c[0]) + Math.abs(last[1] - c[1]) + Math.abs(last[2] - c[2]) > 1e-3) {
            out.push([c[0], c[1], c[2]]);
        }
    });
    if (out.length < 2) return JOURNEY_COLOURS_FALLBACK.map((c) => [...c]);
    // Light that is added washes toward white: the chapters' colours are deepened a little, so a
    // lantern and a shell keep their chapter's hue through the bloom.
    return out.slice(0, 8).map((c) => {
        const luma = (0.2126 * c[0]) + (0.7152 * c[1]) + (0.0722 * c[2]);
        return c.map((v) => Math.max(0, luma + ((v - luma) * 1.45)));
    });
}

/** A unit quad (xy in -1..1, uv 0..1) with the given instanced attributes. */
function quadGeometry(count, attributes) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    Object.entries(attributes).forEach(([name, attr]) => geometry.setAttribute(name, attr));
    geometry.instanceCount = count;
    return geometry;
}

/** Instance data packed into ONE interleaved buffer (WebGPU binds at most 8 vertex buffers). */
function interleaved(count, attributes) {
    const names = Object.keys(attributes);
    const stride = names.reduce((sum, name) => sum + attributes[name][1], 0);
    const packed = new Float32Array(count * stride);
    const buffer = new THREE.InstancedInterleavedBuffer(packed, stride, 1);
    const out = {};
    let offset = 0;
    names.forEach((name) => {
        const [data, itemSize] = attributes[name];
        for (let r = 0; r < count; r += 1) {
            for (let k = 0; k < itemSize; k += 1) packed[(r * stride) + offset + k] = data[(r * itemSize) + k];
        }
        out[name] = new THREE.InterleavedBufferAttribute(buffer, itemSize, offset);
        offset += itemSize;
    });
    return out;
}

function additive(name) {
    const uOpacity = uniform(1);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = name;
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.forceSinglePass = true;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.uniforms = { uOpacity };
    material.userData.emitsBloom = true;
    return { material, uOpacity };
}

// ── Lanterns ─────────────────────────────────────────────────────────────────────

export const NEON_SKY_LANTERNS = Object.freeze({
    /** Lanterns let go together from one street corner or roof. */
    perDrift: 15,
    /** Where the drifts are let go (corridor units): the boulevard and the streets either side. */
    halfWidth: 260,
    z: Object.freeze([80, -600]),
    /** How far a drift's lanterns stand from its middle. */
    spread: 24,
    /** Seconds over which the drifts are let go, the boulevard's first. */
    release: 24,
    rise: Object.freeze([6.5, 11.5]),
    climb: Object.freeze([430, 660]),
    wind: Object.freeze([1.3, 0.5]),
});

/**
 * Plan the lanterns: drifts of them, each let go from one place a moment apart.
 * @param {number} count
 * @returns {{ x: number, y: number, z: number, delay: number, speed: number, climb: number,
 *   seed: number, colour: number, drift: number }[]}
 */
export function planSkyLanterns(count) {
    const L = NEON_SKY_LANTERNS;
    const rand = mulberry32(0x1a27e5);
    const out = [];
    const drifts = Math.max(1, Math.ceil(count / L.perDrift));
    for (let d = 0; d < drifts; d += 1) {
        // Denser on the boulevard, where the eye looks; a third of the drifts leave from roofs.
        const side = rand() < 0.5 ? -1 : 1;
        const across = rand() ** 1.5;
        const cx = side * across * L.halfWidth;
        const cz = L.z[0] + (rand() * (L.z[1] - L.z[0]));
        const cy = rand() < 0.33 ? STREET_Y + 40 + (rand() * 70) : STREET_Y + 3;
        const start = (across * L.release * 0.65) + (rand() * L.release * 0.35);
        const speed = L.rise[0] + (rand() * (L.rise[1] - L.rise[0]));
        for (let k = 0; k < L.perDrift && out.length < count; k += 1) {
            const a = rand() * Math.PI * 2;
            const r = Math.sqrt(rand()) * L.spread;
            out.push({
                x: cx + (Math.cos(a) * r),
                y: cy + (rand() * 5),
                z: cz + (Math.sin(a) * r),
                delay: start + (rand() * 5),
                speed: speed * (0.85 + (rand() * 0.3)),
                climb: L.climb[0] + (rand() * (L.climb[1] - L.climb[0])),
                seed: rand(),
                colour: (d + k) % 8,
                drift: d,
            });
        }
    }
    return out;
}

/**
 * @param {number} count
 * @returns {{ mesh: THREE.Mesh, uniforms: { clock: *, gain: *, time: * },
 *   setColours: (colours: number[][]) => void }}
 */
export function createSkyLanterns(count) {
    const plan = planSkyLanterns(count);
    const aSeat = new Float32Array(count * 4); // x, y, z, delay
    const aRise = new Float32Array(count * 4); // speed, climb, seed, colour index
    const aColour = new Float32Array(count * 3);
    plan.forEach((lantern, i) => {
        aSeat.set([lantern.x, lantern.y, lantern.z, lantern.delay], i * 4);
        aRise.set([lantern.speed, lantern.climb, lantern.seed, lantern.colour], i * 4);
        aColour.set(JOURNEY_COLOURS_FALLBACK[lantern.colour], i * 3);
    });
    const colourAttribute = new THREE.InstancedBufferAttribute(aColour, 3);
    colourAttribute.setUsage(THREE.DynamicDrawUsage);
    const geometry = quadGeometry(count, {
        aLanternSeat: new THREE.InstancedBufferAttribute(aSeat, 4),
        aLanternRise: new THREE.InstancedBufferAttribute(aRise, 4),
        aLanternColour: colourAttribute,
    });
    const u = {
        /** Seconds since the release began (negative: none let go yet). */
        clock: uniform(-1),
        gain: uniform(0),
        time: uniform(0),
    };
    const { material, uOpacity } = additive('odyssey-sky-lanterns');
    const seat = attribute('aLanternSeat', 'vec4');
    const rise = attribute('aLanternRise', 'vec4');
    const since = u.clock.sub(seat.w);
    const life = rise.y.div(rise.x);
    // Let go again each time it has climbed out: always some rising, for as long as the eye stays.
    const age = mod(max(since, 0.0), life);
    const climbed = age.mul(rise.x);
    const sway = sin(u.time.mul(0.55).add(rise.z.mul(40.0))).mul(2.2);
    const W = NEON_SKY_LANTERNS.wind;
    const centre = vec3(
        seat.x.add(age.mul(W[0])).add(sway),
        seat.y.add(climbed),
        seat.z.add(age.mul(W[1])).add(sway.mul(0.6)),
    );
    const view = modelViewMatrix.mul(vec4(centre, 1.0));
    const far = view.z.negate();
    // A lantern a couple of metres tall near the eye; never under a few pixels far away.
    const size = max(float(2.3), far.mul(0.0105));
    material.vertexNode = cameraProjectionMatrix.mul(vec4(
        view.xy.add(positionGeometry.xy.mul(vec2(size.mul(0.86), size.mul(1.15)))),
        view.z,
        1.0,
    ));
    const out = age.div(life);
    // One drifting right past the lens would be a blob of light over the whole frame: it thins
    // out inside a few lengths of the eye.
    const seen = step(0.0, since).mul(smoothstep(0.0, 0.03, out)).mul(float(1.0).sub(smoothstep(0.8, 1.0, out)))
        .mul(smoothstep(9.0, 30.0, far));
    const flame = sin(u.time.mul(rise.z.mul(5.0).add(6.0)).add(rise.z.mul(90.0))).mul(0.1).add(0.9);
    // Warm paper, the chapter's colour in it.
    const vColour = varying(mix(attribute('aLanternColour', 'vec3'), vec3(1.0, 0.4, 0.09), 0.6), 'vLanternColour');
    const vSeen = varying(seen.mul(flame).mul(u.gain), 'vLanternSeen');
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const r2 = q.dot(q);
        // A paper lantern: a rounded bag, wider at its shoulders than at its mouth, the flame
        // low in it lighting the paper from inside (bright at the foot, dimmer toward the crown),
        // and a little of its light in the air round it.
        const width = mix(float(0.42), float(0.62), smoothstep(-0.55, 0.35, q.y));
        const dx = max(q.x.abs().sub(width), 0.0);
        const dy = max(q.y.abs().sub(0.5), 0.0);
        const bag = float(1.0).sub(smoothstep(0.02, 0.2, dx.mul(dx).add(dy.mul(dy)).sqrt()));
        const inner = mix(float(1.0), float(0.42), smoothstep(-0.55, 0.6, q.y));
        const flameAt = vec2(q.x, q.y.add(0.34));
        const heart = exp(flameAt.dot(flameAt).mul(-26.0));
        const air = exp(r2.mul(-2.2)).mul(0.14);
        // Kept under the bloom's white: a lantern is warm paper, not a lamp.
        const light = vColour.mul(bag.mul(inner).mul(0.78).add(air)).add(vec3(1.0, 0.66, 0.3).mul(heart.mul(0.5)));
        return vec4(light.mul(float(1.0).sub(smoothstep(0.7, 1.0, r2))).mul(vSeen).mul(uOpacity), 0.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'journey-sky-lanterns';
    mesh.frustumCulled = false;
    mesh.renderOrder = 45;
    mesh.visible = false;
    return {
        mesh,
        uniforms: u,
        setColours(colours) {
            plan.forEach((lantern, i) => {
                const c = colours[lantern.colour % colours.length];
                colourAttribute.setXYZ(i, c[0], c[1], c[2]);
            });
            colourAttribute.needsUpdate = true;
        },
    };
}

// ── Fireworks ────────────────────────────────────────────────────────────────────

/** Shell kinds (the shader's `kind`); 4 and 5 are each shell's rocket and its smoke. */
export const SHELL_KIND = Object.freeze({
    chrysanthemum: 0, willow: 1, ring: 2, crossette: 3, rocket: 4, smoke: 5,
});

/** How each kind of star flies: seconds alight, air drag, fall, the streak it draws (seconds). */
const SHELL_FLIGHT = Object.freeze([
    Object.freeze({
        life: 3.7, drag: 1.5, gravity: 5, trail: 0.3, reach: 1,
    }),
    Object.freeze({
        life: 6.2, drag: 1.2, gravity: 10, trail: 1.1, reach: 0.82,
    }),
    Object.freeze({
        life: 3.3, drag: 1.7, gravity: 3.5, trail: 0.2, reach: 1,
    }),
    Object.freeze({
        life: 3.5, drag: 1.6, gravity: 4.5, trail: 0.24, reach: 0.9, split: 1.05,
    }),
]);

export const NEON_FIREWORKS = Object.freeze({
    /** The show's length (odyssey-journey-ending.js JOURNEY_ENDING.fireworks). */
    seconds: 29,
    /** A rocket's climb (seconds, and the height it climbs through). */
    climb: 1.3,
    climbHeight: 230,
    /** Smoke hangs this long after its burst. */
    smoke: 9,
    /**
     * Where the shells burst, about the eye once it has risen over the roofs (corridor units,
     * degrees): the whole upper sky of that view, which looks ~21 deg left of the boulevard.
     */
    eye: Object.freeze([0, 150, -30]),
    distance: Object.freeze([380, 640]),
    azimuth: Object.freeze([-62, 26]),
    elevation: Object.freeze([13, 41]),
    /** A shell's angular radius seen from the eye, degrees; the finale's are the largest. */
    radius: Object.freeze([9, 14.5]),
    finaleRadius: Object.freeze([12, 17]),
    /** The finale: this share of the shells, in this window of the show. */
    finaleShare: 0.42,
    finale: Object.freeze([0.69, 0.92]),
    /** How fast a burst's light on the city comes up and dies (per second). */
    lightRise: 11,
    lightFall: 2.1,
});

function halton(index, base) {
    let f = 1;
    let r = 0;
    let i = index;
    while (i > 0) {
        f /= base;
        r += f * (i % base);
        i = Math.floor(i / base);
    }
    return r;
}

/**
 * Plan the show: when and where each shell bursts, its kind, its size and its chapter's colour.
 * Volleys of three keep several aloft at once; the last two fifths are the finale.
 * @param {number} shells
 * @returns {{ x: number, y: number, z: number, at: number, colour: number, kind: number,
 *   radius: number, life: number, finale: boolean }[]}
 */
export function planFireworks(shells) {
    const F = NEON_FIREWORKS;
    const rand = mulberry32(0xf12e77);
    const toRad = Math.PI / 180;
    const out = [];
    const finaleCount = Math.round(shells * F.finaleShare);
    const opening = shells - finaleCount;
    const finaleFrom = F.finale[0] * F.seconds;
    const finaleTo = F.finale[1] * F.seconds;
    const volleys = Math.max(1, Math.ceil(opening / 3));
    for (let i = 0; i < shells; i += 1) {
        const finale = i >= opening;
        const roll = rand();
        let kind = SHELL_KIND.chrysanthemum;
        if (roll > 0.42) kind = SHELL_KIND.willow;
        if (roll > 0.66) kind = SHELL_KIND.ring;
        if (roll > 0.85) kind = SHELL_KIND.crossette;
        const flight = SHELL_FLIGHT[kind];
        // The opening's shells come three to a volley, a breath apart.
        let at = finale
            ? finaleFrom + ((((i - opening) + rand()) / Math.max(1, finaleCount)) * (finaleTo - finaleFrom))
            : F.climb + (((Math.floor(i / 3) + (rand() * 0.22)) / volleys) * (finaleFrom - F.climb - 0.6))
                + ((i % 3) * 0.32);
        // Every star is out before the show ends.
        at = Math.min(at, F.seconds + 0.6 - flight.life);
        // Spread over the whole upper sky (a low-discrepancy pair), never bunched in one corner.
        const az = (F.azimuth[0] + (halton(i + 1, 2) * (F.azimuth[1] - F.azimuth[0]))) * toRad;
        const el = (F.elevation[0] + (halton(i + 1, 3) * (F.elevation[1] - F.elevation[0]))) * toRad;
        const distance = F.distance[0] + (rand() * (F.distance[1] - F.distance[0]));
        const span = finale ? F.finaleRadius : F.radius;
        const radius = distance * Math.tan((span[0] + (rand() * (span[1] - span[0]))) * toRad);
        out.push({
            x: F.eye[0] + (distance * Math.sin(az) * Math.cos(el)),
            y: F.eye[1] + (distance * Math.sin(el)),
            z: F.eye[2] - (distance * Math.cos(az) * Math.cos(el)),
            at,
            colour: i % 8,
            kind,
            radius,
            life: flight.life,
            finale,
        });
    }
    return out;
}

/**
 * The light the shells aloft throw on the city at a moment of the show: the sum of their colours,
 * each coming up in a tenth of a second and dying over one, never more than a soft wash. The
 * caller multiplies it by `flashScale()`.
 * @param {ReturnType<typeof planFireworks>} plan
 * @param {number} seconds into the show
 * @param {ReadonlyArray<ArrayLike<number>>} colours the chapters' colours
 * @param {number[]} [out]
 * @returns {number[]} [r, g, b]
 */
export function fireworksLightAt(plan, seconds, colours, out = [0, 0, 0]) {
    const F = NEON_FIREWORKS;
    let r = 0;
    let g = 0;
    let b = 0;
    if (Number.isFinite(seconds) && seconds >= 0) {
        for (let i = 0; i < plan.length; i += 1) {
            const age = seconds - plan[i].at;
            if (age > 0 && age < plan[i].life) {
                const w = (1 - Math.exp(-age * F.lightRise)) * Math.exp(-age * F.lightFall)
                    * (plan[i].finale ? 1.15 : 1);
                const c = colours[plan[i].colour % colours.length];
                r += c[0] * w;
                g += c[1] * w;
                b += c[2] * w;
            }
        }
    }
    // A wash, never a white-out: many shells at once saturate instead of adding up.
    const peak = Math.max(r, g, b);
    const scale = peak > 1e-6 ? (1.45 * (1 - Math.exp(-peak / 1.45))) / peak : 0;
    out[0] = r * scale;
    out[1] = g * scale;
    out[2] = b * scale;
    return out;
}

/**
 * @param {{ shells?: number, stars?: number }} [options]
 * @returns {{ mesh: THREE.Mesh, plan: ReturnType<typeof planFireworks>,
 *   uniforms: { clock: *, gain: *, flash: *, burst: * },
 *   setColours: (colours: number[][]) => void, lightAt: (seconds: number, out?: number[]) => number[] }}
 */
export function createJourneyFireworks({ shells = 40, stars = 110 } = {}) {
    const F = NEON_FIREWORKS;
    const plan = planFireworks(shells);
    const per = stars + 2; // the stars, the rocket, the smoke
    const count = shells * per;
    const rand = mulberry32(0x7f1ee);
    const aOrigin = new Float32Array(count * 4); // x, y, z, burst time
    const aFling = new Float32Array(count * 4); // direction, speed
    const aMeta = new Float32Array(count * 4); // kind, seed (+1: the shell's pale heart), radius, -
    const aPhys = new Float32Array(count * 4); // drag, gravity, life, streak seconds
    const aCross = new Float32Array(count * 4); // the split's direction * speed, the split's time
    const aColour = new Float32Array(count * 3);
    const sphere = () => {
        const y = (rand() * 2) - 1;
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(Math.max(0, 1 - (y * y)));
        return [Math.cos(a) * r, y, Math.sin(a) * r];
    };
    plan.forEach((shell, b) => {
        const flight = SHELL_FLIGHT[shell.kind];
        // A star's reach is speed / drag: the speed that carries it to the shell's radius.
        const speed = shell.radius * flight.drag * flight.reach;
        // A ring lies in a plane tipped to the eye, so it reads as an ellipse.
        const tilt = (0.9 + (rand() * 0.5)) * (rand() < 0.5 ? -1 : 1);
        const turn = rand() * Math.PI;
        let parent = [0, 1, 0, speed];
        for (let k = 0; k < per; k += 1) {
            const i = (b * per) + k;
            let { kind } = shell;
            if (k === stars) kind = SHELL_KIND.rocket;
            else if (k === stars + 1) kind = SHELL_KIND.smoke;
            let fling = [0, 1, 0, 0];
            let cross = [0, 0, 0, 0];
            let heart = 0;
            if (kind === SHELL_KIND.chrysanthemum) {
                // Two layers: the shell, and a pale heart inside it.
                heart = rand() < 0.24 ? 1 : 0;
                fling = [...sphere(), speed * (heart ? 0.5 : 1) * (0.93 + (rand() * 0.14))];
            } else if (kind === SHELL_KIND.willow) {
                const d = sphere();
                fling = [d[0], (d[1] * 0.8) + 0.25, d[2], speed * (0.7 + (rand() * 0.4))];
            } else if (kind === SHELL_KIND.ring) {
                heart = rand() < 0.14 ? 1 : 0;
                if (heart) fling = [...sphere(), speed * 0.3];
                else {
                    const a = ((k / stars) * Math.PI * 2) + (rand() * 0.03);
                    const cx = Math.cos(a);
                    const cy = Math.sin(a) * Math.cos(tilt);
                    const cz = Math.sin(a) * Math.sin(tilt);
                    fling = [
                        (cx * Math.cos(turn)) - (cz * Math.sin(turn)), cy,
                        (cx * Math.sin(turn)) + (cz * Math.cos(turn)), speed * (0.97 + (rand() * 0.06)),
                    ];
                }
            } else if (kind === SHELL_KIND.crossette) {
                // Four stars share each path until it splits, then part four ways across it.
                if (k % 4 === 0) parent = [...sphere(), speed * (0.9 + (rand() * 0.2))];
                fling = parent;
                const up = Math.abs(parent[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
                const ax = [
                    (parent[1] * up[2]) - (parent[2] * up[1]),
                    (parent[2] * up[0]) - (parent[0] * up[2]),
                    (parent[0] * up[1]) - (parent[1] * up[0]),
                ];
                const al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
                const bx = [
                    (parent[1] * ax[2]) - (parent[2] * ax[1]),
                    (parent[2] * ax[0]) - (parent[0] * ax[2]),
                    (parent[0] * ax[1]) - (parent[1] * ax[0]),
                ];
                const way = k % 4;
                const sa = (way < 2 ? 1 : -1) * (way % 2 === 0 ? 1 : 0);
                const sb = (way < 2 ? 1 : -1) * (way % 2 === 0 ? 0 : 1);
                const part = speed * 0.85;
                cross = [
                    (((ax[0] / al) * sa) + ((bx[0] / al) * sb)) * part,
                    (((ax[1] / al) * sa) + ((bx[1] / al) * sb)) * part,
                    (((ax[2] / al) * sa) + ((bx[2] / al) * sb)) * part,
                    flight.split,
                ];
            }
            aOrigin.set([shell.x, shell.y, shell.z, shell.at], i * 4);
            aFling.set(fling, i * 4);
            aMeta.set([kind, rand() + heart, shell.radius, 0], i * 4);
            aPhys.set([flight.drag, flight.gravity, flight.life, flight.trail], i * 4);
            aCross.set(cross, i * 4);
            aColour.set(JOURNEY_COLOURS_FALLBACK[shell.colour], i * 3);
        }
    });
    const colourAttribute = new THREE.InstancedBufferAttribute(aColour, 3);
    colourAttribute.setUsage(THREE.DynamicDrawUsage);
    const geometry = quadGeometry(count, {
        ...interleaved(count, {
            aShellOrigin: [aOrigin, 4],
            aShellFling: [aFling, 4],
            aShellMeta: [aMeta, 4],
            aShellPhys: [aPhys, 4],
            aShellCross: [aCross, 4],
        }),
        aShellColour: colourAttribute,
    });
    const u = {
        /** Seconds into the show (negative: no show). */
        clock: uniform(-1),
        gain: uniform(0),
        /** What a frame-wide flash keeps (flashScale()). */
        flash: uniform(1),
        /** The light of the shells aloft (fireworksLightAt, already through flashScale). */
        burst: uniform(new THREE.Vector3()),
    };
    const { material, uOpacity } = additive('odyssey-journey-fireworks');
    const origin = attribute('aShellOrigin', 'vec4');
    const fling = attribute('aShellFling', 'vec4');
    const meta = attribute('aShellMeta', 'vec4');
    const phys = attribute('aShellPhys', 'vec4');
    const cross = attribute('aShellCross', 'vec4');
    const kind = meta.x;
    const isWillow = step(0.5, kind).mul(step(kind, 1.5));
    const isRocket = step(3.5, kind).mul(step(kind, 4.5));
    const isSmoke = step(4.5, kind);
    const heart = step(1.0, meta.y);
    const seed = meta.y.sub(heart);
    const age = u.clock.sub(origin.w);
    const life = phys.z;
    // Where a star is `t` seconds after its burst: flung out, slowed by the air, pulled down,
    // and (a crossette) parted four ways once it has split.
    const hasSplit = step(0.01, cross.w);
    const starAt = (t) => {
        const tt = max(t, 0.0);
        const tMain = mix(tt, min(tt, cross.w), hasSplit);
        const reach = float(1.0).sub(exp(tMain.mul(phys.x).negate())).div(phys.x);
        const after = max(tt.sub(cross.w), 0.0).mul(hasSplit);
        const part = float(1.0).sub(exp(after.mul(-3.0))).div(3.0);
        return origin.xyz.add(fling.xyz.mul(fling.w.mul(reach))).add(cross.xyz.mul(part))
            .add(vec3(0.0, tt.mul(tt).mul(phys.y).mul(-0.5), 0.0));
    };
    // The rocket: up to the burst over `climb` seconds, slowing as it arrives.
    const rocketAt = (t) => {
        const s = float(1.0).sub(t.add(F.climb).div(F.climb).clamp(0.0, 1.0));
        return origin.xyz.sub(vec3(0.0, s.mul(s).mul(F.climbHeight), 0.0));
    };
    const headWorld = mix(starAt(age), rocketAt(age), isRocket);
    const tailWorld = mix(starAt(age.sub(phys.w)), rocketAt(age.sub(0.2)), isRocket);
    const head = modelViewMatrix.mul(vec4(headWorld, 1.0)).xyz;
    const tail = modelViewMatrix.mul(vec4(tailWorld, 1.0)).xyz;
    const far = head.z.negate();
    // A streak from where the star was to where it is, round at both ends, facing the eye.
    const span = head.xy.sub(tail.xy);
    const spanLength = max(length(span), 1e-3);
    const along = span.div(spanLength);
    const across = vec2(along.y.negate(), along.x);
    const lifeT = max(age, 0.0).div(life).clamp(0.0, 1.0);
    const width = max(float(1.25), far.mul(0.0044)).mul(mix(float(1.0), float(0.72), isWillow))
        .mul(mix(float(1.0), float(0.6), isRocket))
        .mul(float(1.0).sub(lifeT.mul(0.4)))
        .mul(heart.mul(-0.25).add(1.0));
    const t01 = positionGeometry.y.mul(0.5).add(0.5);
    const streak = mix(tail.xy, head.xy, t01)
        .add(across.mul(positionGeometry.x.mul(width)))
        .add(along.mul(positionGeometry.y.mul(width)));
    // The smoke: a soft cloud where the shell burst, widening and leaning on the wind.
    const smokeAge = max(age, 0.0);
    const smokeAt = origin.xyz.add(vec3(smokeAge.mul(2.6), smokeAge.mul(-1.2), smokeAge.mul(1.1)));
    const smokeView = modelViewMatrix.mul(vec4(smokeAt, 1.0)).xyz;
    const smokeSize = meta.z.mul(smokeAge.mul(0.075).add(0.62));
    const viewXY = mix(streak, smokeView.xy.add(positionGeometry.xy.mul(smokeSize)), isSmoke);
    const viewZ = mix(mix(tail.z, head.z, t01), smokeView.z, isSmoke);
    material.vertexNode = cameraProjectionMatrix.mul(vec4(viewXY, viewZ, 1.0));

    // ── Light ──
    const alight = step(0.0, age).mul(step(age, life));
    const crackle = sin(u.clock.mul(34.0).add(seed.mul(90.0))).mul(0.5).add(0.5);
    const starFade = mix(float(1.0).sub(lifeT).pow(1.6), float(1.0).sub(lifeT.mul(lifeT)), isWillow);
    const starLight = alight.mul(starFade)
        .mul(mix(float(1.0), crackle.mul(0.75).add(0.25), smoothstep(0.5, 0.92, lifeT)))
        // The first instant is white-hot: that is the flash, and it goes through flashScale.
        .mul(exp(max(age, 0.0).mul(-6.0)).mul(1.5).mul(u.flash).add(1.0))
        .mul(1.5);
    const rocketLight = step(float(-F.climb), age).mul(step(age, 0.0)).mul(0.5);
    const smokeT = smokeAge.div(F.smoke).clamp(0.0, 1.0);
    const smokeLight = step(0.0, age).mul(smoothstep(0.0, 0.07, smokeT)).mul(float(1.0).sub(smokeT).pow(1.5));
    // The show ends without a cut: its last light dies over its last seconds.
    const curtain = float(1.0).sub(smoothstep(F.seconds - 2.2, F.seconds, u.clock));
    const vLight = varying(
        mix(mix(starLight, rocketLight, isRocket), smokeLight, isSmoke).mul(u.gain).mul(curtain),
        'vShellLight',
    );
    const colour = attribute('aShellColour', 'vec3');
    const gold = vec3(1.0, 0.62, 0.2);
    // A star: its chapter's colour; a heart is pale; a willow turns to gold as it falls. The
    // smoke holds its own burst's glow for a second, then only what the next bursts throw on it.
    const starColour = mix(
        mix(colour.mul(1.45), vec3(1.0, 0.93, 0.8), heart.mul(0.7)),
        gold.mul(1.25),
        isWillow.mul(smoothstep(0.12, 0.6, lifeT)),
    );
    const smokeColour = colour.mul(exp(smokeAge.mul(-1.7)).mul(0.5).mul(u.flash))
        .add(u.burst.mul(0.2))
        .add(vec3(0.012, 0.01, 0.02));
    const vColour = varying(
        mix(mix(starColour, vec3(1.0, 0.82, 0.55), isRocket), smokeColour, isSmoke),
        'vShellColour',
    );
    const vSoft = varying(isSmoke, 'vShellSoft');
    // The streak's length in widths (its head sits one width inside the quad's end).
    const vSpan = varying(spanLength.div(width).add(2.0), 'vShellSpan');
    const vSeed = varying(seed, 'vShellSeed');
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0).toVar();
        const st = uv();
        // A streak: bright at its head, thinning and fading down its tail.
        const fromHead = float(1.0).sub(st.y).mul(vSpan).sub(1.0);
        const headR2 = fromHead.mul(fromHead).add(q.x.mul(q.x));
        const headGlow = exp(headR2.mul(-2.4)).mul(1.7);
        const tailT = st.y.mul(vSpan).sub(1.0).div(max(vSpan.sub(2.0), 0.05)).clamp(0.0, 1.0);
        const taper = tailT.mul(0.65).add(0.35);
        const core = exp(q.x.mul(q.x).div(taper.mul(taper)).mul(-3.2)).mul(tailT.mul(tailT)).mul(0.8)
            .mul(step(0.0, fromHead));
        const star = headGlow.add(core);
        // The smoke: eaten into wisps from its edge (never a disc with a rim).
        const r2 = q.dot(q);
        const wisp = latticeNoise3(vec3(q.x.mul(1.3).add(vSeed.mul(17.0)), q.y.mul(1.3), vSeed.mul(9.0)));
        const cloud = smoothstep(0.3, 0.95, float(1.0).sub(r2.sqrt()).mul(wisp.mul(1.1).add(0.45))).mul(0.55);
        const shape = mix(star, cloud, vSoft);
        return vec4(vColour.mul(shape).mul(vLight).mul(uOpacity), 0.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'journey-fireworks';
    mesh.frustumCulled = false;
    mesh.renderOrder = 46;
    mesh.visible = false;
    let palette = JOURNEY_COLOURS_FALLBACK;
    return {
        mesh,
        plan,
        uniforms: u,
        setColours(colours) {
            palette = colours;
            plan.forEach((shell, b) => {
                const c = colours[shell.colour % colours.length];
                for (let k = 0; k < per; k += 1) colourAttribute.setXYZ((b * per) + k, c[0], c[1], c[2]);
            });
            colourAttribute.needsUpdate = true;
        },
        /** The light the shells aloft throw at `seconds` of the show (before flashScale). */
        lightAt: (seconds, out) => fireworksLightAt(plan, seconds, palette, out),
    };
}
