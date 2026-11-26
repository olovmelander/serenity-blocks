/**
 * Chromatic Impasto — what is in the air over the canvas: thrown paint, and dust in the lamp.
 *
 * The canvas lies flat under the eye, as an action painter's does: +z is up, toward the camera.
 * A drop of thrown paint leaves the cloth, rises, and falls back; where it lands the painter lays
 * a dot (the world schedules it from the landing this pool reports). Its whole flight is closed
 * form in the world clock, so nothing is stepped: a pool of instanced quads, always drawn, with
 * dormant slots collapsed to nothing. Every drop throws a shadow on the paint beneath it, which
 * is what tells the eye it is in the air.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    attribute,
    clamp,
    dot,
    float,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    reflect,
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

import { DROPLET_GRAVITY, TAU, mulberry32 } from './chromatic-impasto-core.js';
import { ciSoftBox } from './chromatic-impasto-tsl.js';

function quadGeometry(count, attributes) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    Object.keys(attributes).forEach((name) => geometry.setAttribute(name, attributes[name]));
    geometry.instanceCount = count;
    return geometry;
}

function fxMaterial(name) {
    const m = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    m.name = name;
    m.fog = false;
    m.toneMapped = false;
    // Premultiplied "over": a fragment that returns alpha 0 is purely additive.
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    m.forceSinglePass = true;
    return m;
}

function part(name, geometry, material, renderOrder) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, geometry, material };
}

/** Seconds a drop thrown up at `vz` from height `z0` stays in the air. */
export function flightTime(vz, z0 = 0) {
    return (vz + Math.sqrt(vz * vz + 2 * DROPLET_GRAVITY * Math.max(0, z0))) / DROPLET_GRAVITY;
}

/**
 * Thrown paint.
 *
 * @param {object} u      the studio's uniforms
 * @param {number} count  drops in the air at once
 */
export function createDroplets(u, count) {
    const aStart = new Float32Array(count * 4);
    const aVel = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    /** When each drop lands (world seconds): a slot whose drop is still in the air is not reused while another is free. */
    const landAt = new Float64Array(count).fill(-Infinity);
    for (let i = 0; i < count; i++) aStart[i * 4 + 3] = -1000;
    const attributes = {
        aStart: new THREE.InstancedBufferAttribute(aStart, 4),
        aVel: new THREE.InstancedBufferAttribute(aVel, 4),
        aTint: new THREE.InstancedBufferAttribute(aTint, 4),
    };
    const geometry = quadGeometry(count, attributes);

    const start = attribute('aStart', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const tint = attribute('aTint', 'vec4');
    const g = DROPLET_GRAVITY;
    const tau = u.time.sub(start.w);
    const span = vel.z.add(sqrt(vel.z.mul(vel.z).add(start.z.mul(2 * g)))).div(g);
    const alive = step(0.0, tau).mul(step(tau, span));
    const t = clamp(tau, 0.0, span);
    const centre = vec3(
        start.x.add(vel.x.mul(t)),
        start.y.add(vel.y.mul(t)),
        max(start.z.add(vel.z.mul(t)).sub(t.mul(t).mul(g * 0.5)), 0.0),
    );
    const pace = length(vel.xy);
    const heading = vel.xy.div(max(pace, 1e-4));
    const across = vec2(heading.y.negate(), heading.x);
    // The brush pulls a strand off its tip. Surface tension draws it into a bead at
    // the top of its arc; on the way down a shorter neck trails it again.
    const phase = t.div(max(span, 0.001));
    const pull = mix(1.0, 0.16, smoothstep(0.04, 0.48, phase)).add(smoothstep(0.64, 1.0, phase).mul(0.38));
    const stretch = float(1.0).add(min(pace.mul(0.92), 1.9).mul(pull));
    const corner = positionGeometry.xy.mul(2.0);
    const extent = vel.w.mul(alive);

    const material = fxMaterial('Chromatic Impasto — thrown paint');
    material.positionNode = vec3(
        centre.xy.add(heading.mul(corner.x.mul(extent).mul(stretch))).add(across.mul(corner.y.mul(extent))),
        centre.z,
    );
    const vHeading = varying(heading, 'ciDropHeading');
    const vStretch = varying(stretch, 'ciDropStretch');
    const vTint = varying(tint, 'ciDropTint');
    material.colorNode = Fn(() => {
        const cornerUv = uv().mul(2.0).sub(1.0);
        const neck = float(1.0).add(smoothstep(0.0, 0.95, cornerUv.x.negate()).mul(vStretch.sub(1.0)).mul(0.75));
        const st = vec2(cornerUv.x, cornerUv.y.mul(neck)).toVar();
        const r2 = dot(st, st);
        const mask = float(1.0).sub(smoothstep(0.78, 1.0, r2));
        const nz = sqrt(max(float(1.0).sub(r2), 0.0));
        const side = vec2(vHeading.y.negate(), vHeading.x);
        const N = normalize(vec3(vHeading.mul(st.x.div(vStretch)).add(side.mul(st.y)), nz.add(0.05)));
        const V = vec3(0.0, 0.0, 1.0);
        const metal = clamp(vTint.w, 0.0, 1.0);
        const ndl = max(dot(N, u.lightDir), 0.0);
        const diffuse = vTint.rgb.mul(u.keyColor.mul(ndl).add(u.fillColor.mul(N.z.mul(0.5).add(0.5))))
            .mul(float(1.0).sub(metal));
        const R = reflect(V.negate(), N);
        const window = ciSoftBox(R, u.lightDir, vec2(0.62, 0.44), float(0.1), true);
        const cool = ciSoftBox(R, u.rimDir, vec2(0.7, 0.5), float(0.18), false);
        const fres = float(1.0).sub(clamp(N.z, 0.0, 1.0));
        const F0 = mix(vec3(0.05), vTint.rgb, metal);
        const F = F0.add(vec3(1.0).sub(F0).mul(fres.mul(fres).mul(fres)));
        const mirror = u.keyColor.mul(window.mul(u.windowGain)).add(u.rimColor.mul(cool)).add(vec3(0.2).mul(metal));
        return vec4(diffuse.add(mirror.mul(F)).mul(u.exposure).mul(mask), mask);
    })();
    const drops = part('Chromatic Impasto — thrown paint', geometry, material, 4);

    // ── Their shadows on the paint ──
    const shadowGeometry = quadGeometry(count, attributes);
    const shadowMaterial = fxMaterial('Chromatic Impasto — drop shadows');
    const away = u.lightDir.xy.div(max(u.lightDir.z, 0.15)).negate();
    const spreadOut = float(1.25).add(centre.z.mul(7.0));
    shadowMaterial.positionNode = vec3(
        centre.xy.add(away.mul(centre.z))
            .add(heading.mul(corner.x.mul(extent).mul(stretch).mul(spreadOut)))
            .add(across.mul(corner.y.mul(extent).mul(spreadOut))),
        0.0005,
    );
    const vDark = varying(alive.mul(0.62).div(centre.z.mul(16.0).add(1.0)), 'ciDropShade');
    shadowMaterial.colorNode = Fn(() => {
        const st = uv().mul(2.0).sub(1.0);
        const soft = float(1.0).sub(smoothstep(0.1, 1.0, dot(st, st)));
        return vec4(0.0, 0.0, 0.0, soft.mul(vDark));
    })();
    const shadows = part('Chromatic Impasto — drop shadows', shadowGeometry, shadowMaterial, 2);

    let cursor = 0;
    let bursts = 0;
    /** Slots looked at past the cursor for one whose drop has landed. */
    const SCAN = 48;
    /**
     * The slot for a drop thrown at `time`: the next in turn if its drop has landed, else the
     * first landed one a little further on, else (the pool is all in the air) the one nearest
     * its landing. A big throw never plucks drops out of the air while landed slots stand idle.
     */
    const take = (time) => {
        let best = cursor % count;
        for (let k = 0; k < Math.min(SCAN, count); k++) {
            const i = (cursor + k) % count;
            if (landAt[i] <= time) {
                best = i;
                break;
            }
            if (landAt[i] < landAt[best]) best = i;
        }
        cursor = best + 1;
        return best;
    };
    const touch = () => {
        attributes.aStart.needsUpdate = true;
        attributes.aVel.needsUpdate = true;
        attributes.aTint.needsUpdate = true;
    };

    /**
     * Throw `n` drops from (x, y) toward (dx, dy) at `time` (which may be a moment ahead).
     * `spread` = the fan's full angle (radians); `speed` and `size` scale the defaults.
     * @returns {{ x:number, y:number, time:number, radius:number, speed:number, angle:number, seed:number }[]}
     *          where and when each drop lands
     */
    drops.emit = ({
        x, y, dx = 0, dy = 1, n, color, time, speed = 1, spread = 0.9, size = 1, special = 0, strip = null,
    }) => {
        const rand = mulberry32(0x7a31 + bursts * 7919);
        bursts += 1;
        const landings = [];
        const total = Math.min(Math.max(0, Math.round(n)), count);
        const base = Math.atan2(dy, dx);
        for (let k = 0; k < total; k++) {
            const i = take(time);
            const a = base + (rand() - 0.5) * spread;
            const out = speed * (0.25 + rand() ** 1.5 * 1.0);
            const lift = Math.sqrt(speed) * (0.45 + rand() * 1.5);
            const vz = strip ? Math.min(lift, Math.sqrt(strip.depth * 1.65)) : lift;
            const t0 = time + rand() * 0.07;
            const z0 = 0.008;
            const radius = Math.min((0.0055 + rand() ** 2 * 0.012) * size, strip ? strip.depth * 0.05 : Infinity);
            const flight = flightTime(vz, z0);
            let vx = Math.cos(a) * out;
            let vy = Math.sin(a) * out;
            if (strip) {
                // Constrain the landing, then solve the velocity. The airborne bead
                // and the dot it leaves still meet in the same place at the same time.
                const edge = strip.edge + strip.sign * strip.depth;
                const pad = radius * 2.1;
                const lx = Math.max(-strip.halfWidth + pad, Math.min(strip.halfWidth - pad, x + vx * flight));
                const ly = Math.max(
                    Math.min(edge, strip.edge) + pad,
                    Math.min(Math.max(edge, strip.edge) - pad, y + vy * flight),
                );
                vx = (lx - x) / flight;
                vy = (ly - y) / flight;
            }
            aStart.set([x, y, z0, t0], i * 4);
            aVel.set([vx, vy, vz, radius], i * 4);
            const shade = 0.82 + rand() * 0.3;
            aTint.set([color[0] * shade, color[1] * shade, color[2] * shade, special], i * 4);
            landAt[i] = t0 + flight;
            landings.push({
                x: x + vx * flight,
                y: y + vy * flight,
                time: t0 + flight,
                radius: radius * (1.15 + rand() * 0.9),
                speed: clamp01js(out / 1.6),
                angle: a,
                seed: rand() * 4096,
            });
        }
        touch();
        return landings;
    };
    drops.reset = () => {
        for (let i = 0; i < count; i++) aStart[i * 4 + 3] = -1000;
        attributes.aStart.needsUpdate = true;
        landAt.fill(-Infinity);
        cursor = 0;
        bursts = 0;
    };
    drops.update = () => {};
    drops.count = count;
    drops.state = { aStart, aVel, aTint };
    drops.shadows = shadows;
    drops.dispose = () => {
        shadowGeometry.dispose();
        shadowMaterial.dispose();
    };
    return drops;
}

function clamp01js(v) {
    return Math.max(0, Math.min(1, v));
}

/**
 * The lens's depth of field on dust: the camera is focused on the canvas (z = 0), so a mote's
 * blur disc grows with its height over it (radius = aperture · z / focus distance, world units),
 * and the light it scatters is spread over that disc. `aperture` is the lens's radius.
 */
export const DUST = Object.freeze({
    aperture: 0.042,
    /** Share of the motes that hang high, near the lens (the rest drift low, near the paint). */
    high: 0.3,
    /** The beam's half-angle round the lamp's aim (cosine at its soft edge), and its brightness. */
    beamCos: 0.86,
    gain: 0.006,
    /**
     * How fast a disc dims as it grows (per unit of its screen radius squared). Spread over its
     * whole area at full strength, a disc near the lens would vanish; held a little brighter, it
     * reads as dust drifting out of focus between the eye and the canvas.
     */
    spread: 36,
    /** The widest a blur disc may look (its radius on the canvas, canvas units: the frame is 2 tall). */
    widest: 0.05,
});

/**
 * Dust in the lamp's beam, between the eye and the canvas. The camera is focused on the paint:
 * motes drifting near it are fine points, those that hang near the lens are broad, faint discs of
 * light with a brighter rim (the aperture's shape). Each is lit only while it is in the lamp's
 * beam (a cone aimed at the canvas from beyond its upper left), more brightly nearer the lamp, so
 * the dust gathers on the lamp's side as the light does.
 *
 * @param {object} u
 * @param {number} count
 */
export function createMotes(u, count) {
    const aSeed = new Float32Array(count * 4);
    const rand = mulberry32(0x40d7);
    for (let i = 0; i < count; i++) aSeed.set([rand(), rand(), rand(), rand()], i * 4);
    const geometry = quadGeometry(count, { aSeed: new THREE.InstancedBufferAttribute(aSeed, 4) });
    const seed = attribute('aSeed', 'vec4');
    const frame = uniform(new THREE.Vector2(1.78, 1));
    /** The camera's distance from the canvas (the focus distance). */
    const focus = uniform(3.08);
    /** The board's card on the canvas (x0, y0, x1, y1, canvas units): dust keeps out of it. */
    const card = uniform(new THREE.Vector4(-0.4, -0.85, 0.4, 0.85));

    const material = fxMaterial('Chromatic Impasto — dust');
    const tt = uniform(0);
    let lastTime = null;
    // Each mote wanders on its own slow loop and drifts with the room's air.
    const drift = vec3(
        sin(tt.mul(seed.w.mul(0.05).add(0.03)).add(seed.x.mul(TAU))).mul(0.12),
        sin(tt.mul(seed.z.mul(0.04).add(0.025)).add(seed.y.mul(TAU))).mul(0.1),
        sin(tt.mul(0.021).add(seed.w.mul(TAU))).mul(0.12),
    );
    // Most drift low over the paint; a few hang near the lens. A high mote is placed in the
    // narrower field the lens sees at its height.
    const high = step(seed.z, DUST.high);
    const z = mix(seed.z.mul(0.9).add(0.08), seed.w.mul(0.9).add(1.55), high);
    const narrow = float(1.0).sub(z.div(focus));
    const home = vec3(
        seed.x.mul(2.0).sub(1.0).mul(frame.x).mul(narrow),
        seed.y.mul(2.0).sub(1.0).mul(frame.y).mul(narrow),
        z,
    );
    const pearl = step(0.10, seed.z).mul(step(seed.z, 0.4));
    // Cream paint suspended a little above the canvas catches the same window as the
    // wet strokes. Only the smaller dust scatters light out of focus near the lens.
    const pearlZ = seed.w.mul(0.7).add(0.48);
    const pearlHome = vec3(seed.xy.mul(2.0).sub(1.0).mul(frame).mul(float(1.0).sub(pearlZ.div(focus))), pearlZ);
    const centre = mix(home, pearlHome, pearl).add(drift).toVar();
    // The blur disc (world radius), never smaller than a fine point, and never wider on screen
    // than DUST.widest (a narrow phone frame would otherwise hold a few discs as big as coins).
    const depth = focus.sub(centre.z).div(focus);
    const blur = clamp(centre.z.mul(DUST.aperture).div(focus), 0.0016, depth.mul(DUST.widest));
    const coc = mix(blur, depth.mul(seed.x.mul(seed.x).mul(0.014).add(0.008)), pearl);
    const squeeze = vec2(seed.y.mul(0.22).add(0.81), 1.0);
    const extent = positionGeometry.xy.mul(coc.mul(2.0)).mul(mix(vec2(1.0), squeeze, pearl));
    material.positionNode = vec3(centre.xy.add(extent), centre.z);
    // The lamp's light at the mote: its beam (a soft cone toward the canvas's middle) and its
    // falloff, spread over the disc as the eye sees it (the disc's screen area grows as coc² over
    // the distance², and the light a mote scatters does not).
    const fromLamp = centre.sub(u.lampPos);
    const lampDist = length(fromLamp);
    const aim = normalize(u.lampPos.negate());
    const inBeam = smoothstep(DUST.beamCos, DUST.beamCos + 0.05, dot(fromLamp.div(lampDist), aim));
    const near = u.lampFalloff.x.div(lampDist).pow(u.lampFalloff.y);
    const seen = coc.mul(focus).div(max(focus.sub(centre.z), 0.2));
    const twinkle = sin(tt.mul(seed.w.mul(0.7).add(0.4)).add(seed.z.mul(40.0))).mul(0.35).add(0.65);
    // Where the eye sees the mote on the canvas: dust keeps clear of the board's card.
    const onCanvas = centre.xy.div(max(depth, 0.1));
    const middle = card.xy.add(card.zw).mul(0.5);
    const halfSize = card.zw.sub(card.xy).mul(0.5);
    const outside = length(max(abs(onCanvas.sub(middle)).sub(halfSize), vec2(0.0)));
    const clear = smoothstep(seen.mul(0.6), seen.add(0.06), outside);
    const vGlow = varying(
        inBeam.mul(near).mul(twinkle).mul(clear).mul(DUST.gain)
            .div(seen.mul(seen).mul(DUST.spread).add(0.004)),
        'ciMote',
    );
    const vRim = varying(smoothstep(0.004, 0.02, coc), 'ciMoteRim');
    const vPearl = varying(vec3(pearl, clear, seed.y), 'ciPearl');
    const vToLamp = varying(fromLamp.div(lampDist).negate(), 'ciPearlLight');
    material.fragmentNode = Fn(() => {
        const st = uv().mul(2.0).sub(1.0).toVar();
        const r2 = dot(st, st).toVar();
        // Most flecks remain soft points of dust in the beam.
        const point = float(1.0).sub(smoothstep(0.0, 1.0, r2)).pow(2.0);
        const disc = float(1.0).sub(smoothstep(0.82, 1.0, r2)).mul(smoothstep(0.55, 0.95, r2).mul(0.6).add(0.7));
        const shape = mix(point, disc, vRim);
        const dustLight = u.keyColor.mul(vec3(1.0, 0.8, 0.58)).mul(shape.mul(vGlow).mul(0.58)).mul(u.exposure);
        const result = vec4(dustLight, 0.0).toVar();
        If(vPearl.x.greaterThan(0.5), () => {
            // The floating skin has a soft lower edge, a cool shaded belly, and one warm
            // window reflection curved across the crown. A slight lean breaks its contour.
            const q = vec2(st.x.add(st.y.mul(st.y).mul(vPearl.z.sub(0.5)).mul(0.32)), st.y).toVar();
            const d2 = dot(q, q).toVar();
            const crown = sqrt(max(float(1.0).sub(d2), 0.0)).toVar();
            const normal = vec3(q, crown);
            const lit = clamp(dot(normal, vToLamp).mul(0.66).add(0.32), 0.0, 1.0);
            const body = mix(vec3(0.075, 0.088, 0.084), vec3(0.67, 0.52, 0.33), lit);
            const glintOffset = q.sub(vToLamp.xy.mul(0.56));
            const glint = float(1.0).sub(smoothstep(0.07, 0.29, length(glintOffset.mul(vec2(0.78, 1.24)))));
            const rim = float(1.0).sub(crown).mul(max(dot(q, vToLamp.xy.negate()), 0.0));
            const light = body.mul(u.keyColor).mul(0.61).add(u.keyColor.mul(glint.mul(0.92)))
                .add(vec3(0.27, 0.44, 0.49).mul(rim));
            const alpha = float(1.0).sub(smoothstep(0.64, 1.0, d2)).mul(vPearl.y).mul(0.88);
            result.assign(vec4(light.mul(alpha).mul(u.exposure), alpha));
        });
        return result;
    })();
    const motes = part('Chromatic Impasto — dust', geometry, material, 6);
    motes.count = count;
    motes.update = (time, aspect, cameraDistance, cardRect = null, reducedMotion = false) => {
        // Pause the drift in place. Resuming from its last phase avoids a jump past all
        // the seconds spent still. A backwards seek starts a new studio clock.
        if (lastTime === null || time < lastTime) tt.value = reducedMotion ? 0 : time;
        else if (!reducedMotion) tt.value += time - lastTime;
        lastTime = time;
        frame.value.set(Math.max(0.3, aspect) * 1.02, 1.02);
        if (Number.isFinite(cameraDistance) && cameraDistance > 0.5) focus.value = cameraDistance;
        if (cardRect) card.value.set(cardRect.x0, cardRect.y0, cardRect.x1, cardRect.y1);
    };
    return motes;
}
