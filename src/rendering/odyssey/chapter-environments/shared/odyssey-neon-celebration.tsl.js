/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview THE ENDING'S LIGHTS (2026-11-17 masterpiece pass): lanterns and fireworks in the
 * journey's colours. Both are closed forms of the ending's clock (odyssey-journey-ending.js), so
 * the ending can be scrubbed, captured and replayed, and nothing is simulated.
 *
 *   Lanterns   paper lanterns let go from the streets and the roofs, first round the spire and
 *              then further and further out, each in one of the eight chapters' colours. They rise
 *              on the wind, sway, thin out high up and are let go again: at the rest they are
 *              still rising, for as long as the player stays.
 *   Fireworks  over the skyline while the sun comes up: a rocket's climb, a shell of stars that
 *              spreads, slows and falls, in a chapter's colour with a white heart, a soft light in
 *              the air round each burst. A frame-wide flash goes through `flashScale` where it is
 *              written (ADR-0021); under reduced motion there is no show.
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
    max,
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
import { NEON_SPIRE_XZ } from './odyssey-neon-light.tsl.js';

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

function quadGeometry(count, attributes) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    Object.entries(attributes).forEach(([name, attr]) => geometry.setAttribute(name, attr));
    geometry.instanceCount = count;
    return geometry;
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
    /** They are let go within this reach of the spire, the nearest first. */
    reach: 640,
    /** Seconds the release takes to spread from the spire to the reach. */
    spread: 22,
    rise: Object.freeze([4.2, 8.5]),
    climb: Object.freeze([330, 520]),
    wind: Object.freeze([1.1, 0.5]),
});

/**
 * Plan the lanterns: where each is let go, when (seconds after the release begins), how it rises.
 * @param {number} count
 * @returns {{ x: number, y: number, z: number, delay: number, speed: number, climb: number,
 *   seed: number, colour: number }[]}
 */
export function planSkyLanterns(count) {
    const L = NEON_SKY_LANTERNS;
    const rand = mulberry32(0x1a27e5);
    const out = [];
    for (let i = 0; i < count; i += 1) {
        // Denser near the spire and down the boulevard, where the eye looks.
        const r = L.reach * (rand() ** 0.75);
        const a = rand() * Math.PI * 2;
        const x = NEON_SPIRE_XZ[0] + (Math.cos(a) * r * 0.82);
        const z = NEON_SPIRE_XZ[1] + 170 + (Math.sin(a) * r);
        const fromSpire = Math.hypot(x - NEON_SPIRE_XZ[0], z - NEON_SPIRE_XZ[1]);
        out.push({
            x,
            y: STREET_Y + 4 + (rand() * 60),
            z,
            delay: ((fromSpire / L.reach) * L.spread) + (rand() * 5),
            speed: L.rise[0] + (rand() * (L.rise[1] - L.rise[0])),
            climb: L.climb[0] + (rand() * (L.climb[1] - L.climb[0])),
            seed: rand(),
            colour: i % 8,
        });
    }
    return out;
}

/**
 * @param {number} count
 * @returns {{ mesh: THREE.Mesh, uniforms: { clock: *, gain: * }, setColours: (colours: number[][]) => void }}
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
    // A lantern a metre across; never under a couple of pixels far away.
    const size = max(float(1.25), view.z.negate().mul(0.0075));
    material.vertexNode = cameraProjectionMatrix.mul(vec4(
        view.xy.add(positionGeometry.xy.mul(vec2(size.mul(0.86), size.mul(1.15)))),
        view.z,
        1.0,
    ));
    const out = age.div(life);
    const seen = step(0.0, since).mul(smoothstep(0.0, 0.035, out)).mul(float(1.0).sub(smoothstep(0.78, 1.0, out)));
    const flame = sin(u.time.mul(rise.z.mul(5.0).add(6.0)).add(rise.z.mul(90.0))).mul(0.12).add(0.88);
    const vColour = varying(attribute('aLanternColour', 'vec3'), 'vLanternColour');
    const vSeen = varying(seen.mul(flame).mul(u.gain), 'vLanternSeen');
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const r2 = q.dot(q);
        // The paper's glow in the chapter's colour, a warm flame low in it.
        // A paper lantern: a rounded bag, wider at its shoulders than at its mouth, the flame
        // low in it lighting the paper from inside (bright at the foot, dimmer toward the crown),
        // and a little of its light in the air round it.
        const width = mix(float(0.42), float(0.62), smoothstep(-0.55, 0.35, q.y));
        const dx = max(q.x.abs().sub(width), 0.0);
        const dy = max(q.y.abs().sub(0.5), 0.0);
        const bag = float(1.0).sub(smoothstep(0.02, 0.2, dx.mul(dx).add(dy.mul(dy)).sqrt()));
        const inner = mix(float(1.25), float(0.5), smoothstep(-0.55, 0.6, q.y));
        const flameAt = vec2(q.x, q.y.add(0.34));
        const heart = exp(flameAt.dot(flameAt).mul(-30.0));
        const air = exp(r2.mul(-2.4)).mul(0.16);
        const light = vColour.mul(bag.mul(inner).mul(0.95).add(air)).add(vec3(1.0, 0.72, 0.38).mul(heart.mul(0.7)));
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

export const NEON_FIREWORKS = Object.freeze({
    /** The show's length (odyssey-journey-ending.js JOURNEY_ENDING.fireworks). */
    seconds: 29,
    /** A rocket's climb, a shell's life (seconds). */
    climb: 1.5,
    life: 3.4,
    /** Where shells burst (corridor units): over the skyline, ahead of the risen eye. */
    x: Object.freeze([-330, 300]),
    z: Object.freeze([-470, -130]),
    y: Object.freeze([130, 300]),
    speed: Object.freeze([95, 170]),
});

/**
 * Plan the show: when and where each shell bursts, and in which chapter's colour. Spread over
 * the show with a finale: the last fifth of the shells in its last few seconds.
 * @param {number} shells
 * @returns {{ x: number, y: number, z: number, at: number, colour: number, speed: number }[]}
 */
export function planFireworks(shells) {
    const F = NEON_FIREWORKS;
    const rand = mulberry32(0xf12e77);
    const out = [];
    const finaleFrom = Math.floor(shells * 0.72);
    for (let i = 0; i < shells; i += 1) {
        const finale = i >= finaleFrom;
        const at = finale
            ? (F.seconds * 0.76) + (((i - finaleFrom) / Math.max(1, shells - finaleFrom)) * F.seconds * 0.16) + (rand() * 0.5)
            : F.climb + (((i + (rand() * 0.6)) / finaleFrom) * (F.seconds * 0.7));
        out.push({
            x: F.x[0] + (rand() * (F.x[1] - F.x[0])),
            y: F.y[0] + (rand() * (F.y[1] - F.y[0])),
            z: F.z[0] + (rand() * (F.z[1] - F.z[0])),
            at,
            colour: i % 8,
            speed: F.speed[0] + (rand() * (F.speed[1] - F.speed[0])),
        });
    }
    return out;
}

/**
 * @param {{ shells?: number, stars?: number }} [options]
 * @returns {{ mesh: THREE.Mesh, uniforms: { clock: *, gain: *, flash: * }, setColours: (colours: number[][]) => void }}
 */
export function createJourneyFireworks({ shells = 16, stars = 96 } = {}) {
    const F = NEON_FIREWORKS;
    const plan = planFireworks(shells);
    // Each star is drawn a few times along the path it has just flown, fainter and smaller the
    // further back: a streak of fire, not a dot (round dots read as bubbles).
    const LAGS = 4;
    const per = (stars * LAGS) + 2; // the stars and their streaks, the rocket, the light in the air
    const count = shells * per;
    const rand = mulberry32(0x7f1ee);
    const aOrigin = new Float32Array(count * 4); // x, y, z, burst time
    const aFling = new Float32Array(count * 4); // direction, speed
    const aMeta = new Float32Array(count * 4); // kind (0 star, 1 rocket, 2 light), seed, shell, -
    const aColour = new Float32Array(count * 3);
    plan.forEach((shell, b) => {
        let fling = [0, 1, 0, shell.speed];
        let seed = 0;
        for (let k = 0; k < per; k += 1) {
            const i = (b * per) + k;
            let kind = 0;
            if (k === stars * LAGS) kind = 1;
            else if (k === (stars * LAGS) + 1) kind = 2;
            const lag = kind === 0 ? k % LAGS : 0;
            if (lag === 0) {
                // Even over the sphere, speeds in two rings so the shell has a rim and a heart.
                const y = (rand() * 2) - 1;
                const a = rand() * Math.PI * 2;
                const r = Math.sqrt(Math.max(0, 1 - (y * y)));
                const ring = rand() < 0.7 ? 1 : 0.55;
                fling = [Math.cos(a) * r, y, Math.sin(a) * r, shell.speed * ring * (0.92 + (rand() * 0.16))];
                seed = rand();
            }
            aOrigin.set([shell.x, shell.y, shell.z, shell.at], i * 4);
            aFling.set(fling, i * 4);
            aMeta.set([kind, seed, b, lag], i * 4);
            aColour.set(JOURNEY_COLOURS_FALLBACK[shell.colour], i * 3);
        }
    });
    const colourAttribute = new THREE.InstancedBufferAttribute(aColour, 3);
    colourAttribute.setUsage(THREE.DynamicDrawUsage);
    const geometry = quadGeometry(count, {
        aShellOrigin: new THREE.InstancedBufferAttribute(aOrigin, 4),
        aShellFling: new THREE.InstancedBufferAttribute(aFling, 4),
        aShellMeta: new THREE.InstancedBufferAttribute(aMeta, 4),
        aShellColour: colourAttribute,
    });
    const u = {
        /** Seconds into the show (negative: no show). */
        clock: uniform(-1),
        gain: uniform(0),
        /** What a frame-wide flash keeps (flashScale()). */
        flash: uniform(1),
    };
    const { material, uOpacity } = additive('odyssey-journey-fireworks');
    const origin = attribute('aShellOrigin', 'vec4');
    const fling = attribute('aShellFling', 'vec4');
    const meta = attribute('aShellMeta', 'vec4');
    const isRocket = step(0.5, meta.x).mul(step(meta.x, 1.5));
    const isLight = step(1.5, meta.x);
    const isStar = float(1.0).sub(step(0.5, meta.x));
    // A streak's copies trail the star by a few hundredths of a second each.
    const age = u.clock.sub(origin.w).sub(meta.w.mul(0.045));
    const streak = float(1.0).sub(meta.w.div(LAGS));
    // A star: flung out, slowed by the air, pulled down.
    const drag = float(1.5);
    const a = max(age, 0.0);
    const reach = float(1.0).sub(exp(a.mul(drag).negate())).div(drag);
    const starAt = origin.xyz.add(fling.xyz.mul(fling.w.mul(reach))).add(vec3(0.0, a.mul(a).mul(-5.5), 0.0));
    // The rocket: up from the street to the burst over `climb` seconds, easing out.
    const climb = smoothstep(0.0, 1.0, age.add(F.climb).div(F.climb));
    const rocketAt = vec3(origin.x, mix(float(STREET_Y + 20), origin.y, climb.mul(float(2.0).sub(climb))), origin.z);
    const centre = mix(mix(starAt, rocketAt, isRocket), origin.xyz, isLight);
    const view = modelViewMatrix.mul(vec4(centre, 1.0));
    const far = view.z.negate();
    const lifeT = a.div(F.life);
    const starSize = max(float(1.5), far.mul(0.0052)).mul(float(1.0).sub(lifeT.mul(0.45))).mul(streak.mul(0.5).add(0.5));
    const rocketSize = max(float(1.2), far.mul(0.003));
    const lightSize = fling.w.mul(1.5).mul(smoothstep(0.0, 0.5, a).mul(0.6).add(0.7));
    const size = mix(mix(starSize, rocketSize, isRocket), lightSize, isLight);
    material.vertexNode = cameraProjectionMatrix.mul(vec4(view.xy.add(positionGeometry.xy.mul(size)), view.z, 1.0));
    // Light: a star burns, crackles as it dies; the rocket is a spark; the air glows and fades.
    const burning = step(0.0, age).mul(step(age, F.life));
    const crackle = sin(u.clock.mul(31.0).add(meta.y.mul(80.0))).mul(0.5).add(0.5);
    const starLight = burning.mul(float(1.0).sub(lifeT)).mul(float(1.0).sub(lifeT)).mul(streak.mul(streak))
        .mul(mix(float(1.0), crackle, smoothstep(0.45, 0.9, lifeT)))
        // The first instant is white-hot: that is the flash, and it goes through flashScale.
        .mul(exp(a.mul(-6.0)).mul(1.6).mul(u.flash).add(1.0));
    const rocketLight = step(float(-F.climb), age).mul(step(age, 0.0)).mul(0.7);
    const airLight = burning.mul(exp(a.mul(-2.4))).mul(0.04).mul(u.flash);
    const vLight = varying(
        mix(mix(starLight, rocketLight, isRocket), airLight, isLight).mul(u.gain),
        'vShellLight',
    );
    const colour = attribute('aShellColour', 'vec3');
    // A white heart while it is young, the chapter's colour as it spreads.
    const vColour = varying(
        mix(mix(colour.mul(1.5), vec3(1.0, 0.95, 0.85), exp(a.mul(-5.0)).mul(0.6).mul(isStar)), vec3(1.0, 0.8, 0.5), isRocket),
        'vShellColour',
    );
    const vSoft = varying(isLight, 'vShellSoft');
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const r2 = q.dot(q);
        const point = exp(r2.mul(-7.0)).add(exp(r2.mul(-1.8)).mul(0.12));
        // The light in the air has no edge: it is gone well inside its quad.
        const cloud = exp(r2.mul(-6.5));
        const shape = mix(point, cloud, vSoft).mul(float(1.0).sub(smoothstep(mix(float(0.75), float(0.3), vSoft), 1.0, r2)));
        return vec4(vColour.mul(shape).mul(vLight).mul(uOpacity), 0.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'journey-fireworks';
    mesh.frustumCulled = false;
    mesh.renderOrder = 46;
    mesh.visible = false;
    return {
        mesh,
        uniforms: u,
        setColours(colours) {
            plan.forEach((shell, b) => {
                const c = colours[shell.colour % colours.length];
                for (let k = 0; k < per; k += 1) colourAttribute.setXYZ((b * per) + k, c[0], c[1], c[2]);
            });
            colourAttribute.needsUpdate = true;
        },
    };
}
