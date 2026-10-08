/**
 * Cinder Drift — the air of the chamber.
 *
 *  - Embers: the cinders the theme is named for. Each one rises from the lake on a thermal,
 *    swaying wider the higher it climbs, cooling from gold through red to nothing: a closed-form
 *    function of one clock, which the chamber's pressure winds faster.
 *  - Smoke: slow banks of it under the roof, lit from below by the lake and cold where the
 *    night's shaft passes through. They hide a little of what stands behind them, which is
 *    what gives the chamber its depth.
 *  - The shaft: the night coming in through the hole in the roof, drawn as light in the smoke.
 */

import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cross,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SKYLIGHT, TAU, cdFxMaterial, cdGlowGain, cdPart, cdQuadGeometry, mulberry32,
} from './cinder-drift-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

// ── Embers ──────────────────────────────────────────────────────────────────────

/**
 * @param {object} u
 * @param {number} count
 * @param {object} plan
 */
export function createEmbers(u, count, plan) {
    const rand = mulberry32(0xe3be);
    const aHome = new Float32Array(count * 4);
    const aKind = new Float32Array(count * 4);
    const { foot } = plan.fall;
    for (let i = 0; i < count; i++) {
        const pick = rand();
        let x;
        let z;
        if (pick < 0.24) {
            // Close to the viewer: the cinders that drift past the lens.
            x = (rand() - 0.5) * 30;
            z = -2.5 - rand() * 22;
        } else if (pick < 0.5) {
            // The fall throws them up in a cloud.
            const a = rand() * TAU;
            const r = Math.sqrt(rand()) * 22;
            x = foot[0] + 6 + Math.cos(a) * r;
            z = foot[2] + 4 + Math.sin(a) * r;
        } else {
            const depth = 20 + rand() ** 1.4 * 170;
            x = (rand() - 0.5) * Math.min(110, depth * 1.5);
            z = -depth;
        }
        // Over rock they would rise through the columns: keep them over the lava.
        if (plan.depthAt(x, z) > -1) {
            x *= 0.4;
            z = -6 - rand() * 30;
        }
        aHome.set([x, z, rand(), 0.55 + rand() * 1.3], i * 4);
        aKind.set([0.016 + rand() ** 2.2 * 0.05, 0.5 + rand() * 1.5, rand(), 7 + rand() ** 1.6 * 26], i * 4);
    }
    const geometry = cdQuadGeometry(count, { aHome: [aHome, 4], aKind: [aKind, 4] });
    const home = attribute('aHome', 'vec4');
    const kind = attribute('aKind', 'vec4');

    const material = cdFxMaterial('CinderEmbers');
    const phase = home.z;
    const k = fract(u.lift.mul(home.w).div(kind.w).add(phase));
    // Fast off the lake, slowing as it cools.
    const y = kind.w.mul(k.mul(float(1.6).sub(k.mul(0.6))));
    const wide = k.mul(2.4).add(0.3).mul(kind.y);
    const swayX = sin(u.lift.mul(0.33).mul(kind.y).add(phase.mul(TAU))).mul(wide)
        .add(sin(u.lift.mul(0.117).add(phase.mul(17.0))).mul(k).mul(1.6));
    const swayZ = sin(u.lift.mul(0.27).mul(kind.y).add(phase.mul(29.0))).mul(wide.mul(0.7));
    const world = vec3(home.x.add(swayX), y.add(0.05), home.y.add(swayZ));
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    const px = clamp(kind.x.mul(pxPerMetre), u.viewport.y.mul(0.0013), u.viewport.y.mul(0.02));
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const flicker = sin(u.time.mul(phase.mul(11.0).add(7.0)).add(phase.mul(40.0))).mul(0.3).add(0.7);
    const life = smoothstep(0.0, 0.04, k).mul(float(1.0).sub(k)).mul(float(1.0).sub(k.mul(0.5)));
    // Gold as it leaves the lake, red as it dies.
    const hue = mix(u.spark.add(u.hot.mul(0.6)), u.deep.mul(1.6).add(u.spark.mul(0.25)), smoothstep(0.05, 0.75, k.add(kind.z.mul(0.2))));
    // A cinder smaller than its floor in pixels gives the light it has, not the light of the floor.
    const fill = clamp(kind.x.mul(pxPerMetre).div(px), 0.15, 1.0);
    const vLight = varying(hue.mul(life).mul(flicker).mul(fill).mul(u.breath)
        .mul(3.4), 'cdEmber');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const dot2 = exp(d.mul(d).mul(-7.0)).add(exp(d.mul(-4.0)).mul(0.16));
        return vec4(vLight.mul(dot2).mul(smoothstep(1.0, 0.7, d)), 0.0);
    })();
    const part = cdPart('CinderEmbers', geometry, material, 30);
    part.count = count;
    return part;
}

// ── Smoke ───────────────────────────────────────────────────────────────────────

/**
 * @param {object} u
 * @param {number} count
 */
export function createSmoke(u, count) {
    const rand = mulberry32(0x5a0c);
    const aAt = new Float32Array(count * 4);
    const aRand = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        const depth = 55 + rand() * 170;
        const y = 12 + rand() ** 0.8 * 28;
        aAt.set([(rand() - 0.5) * Math.min(120, depth * 1.2), y, -depth, 26 + rand() * 34], i * 4);
        aRand.set([rand(), 0.5 + rand(), 0.2 + rand() * 0.3, rand() * TAU], i * 4);
    }
    const geometry = cdQuadGeometry(count, { aAt: [aAt, 4], aRand: [aRand, 4] });
    const at = attribute('aAt', 'vec4');
    const rnd = attribute('aRand', 'vec4');

    const material = cdFxMaterial('CinderSmoke');
    const driftX = sin(u.time.mul(0.021).mul(rnd.y).add(rnd.w)).mul(9.0);
    const driftY = sin(u.time.mul(0.016).mul(rnd.y).add(rnd.w.mul(2.0))).mul(2.5);
    const centre = vec3(at.x.add(driftX), at.y.add(driftY), at.z);
    const toCam = normalize(cameraPosition.sub(centre));
    const right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    const up = cross(toCam, right);
    const world = centre.add(right.mul(positionGeometry.x.mul(at.w).mul(1.7))).add(up.mul(positionGeometry.y.mul(at.w)));
    material.vertexNode = viewProjection(world);
    const vWorld = varying(world, 'cdSmokeP');
    const vRand = varying(rnd, 'cdSmokeR');
    material.colorNode = Fn(() => {
        const st = uv();
        const q = st.sub(0.5).mul(2.0);
        const fall = float(1.0).sub(smoothstep(0.25, 1.0, length(q)));
        const churn = u.noise(st.mul(0.55).add(vec2(vRand.x.mul(3.0).add(u.time.mul(0.004)), vRand.x.mul(7.0)))).r;
        const wisp = u.noise(st.mul(1.4).add(vec2(vRand.x.mul(11.0), u.time.mul(-0.006).add(churn.mul(0.2))))).g;
        const density = smoothstep(0.38, 0.8, churn.mul(0.65).add(wisp.mul(0.35)).mul(fall.mul(0.8).add(0.5)))
            .mul(fall).mul(vRand.z);
        // Lit from below by the lake, more on its underside; cold where the night's shaft crosses it.
        const p = vWorld;
        const belly = float(1.0).sub(st.y).mul(0.7).add(0.3);
        const warm = u.haze.mul(1.5).add(u.mid.mul(0.02)).mul(exp(p.y.div(-30.0))).mul(belly)
            .mul(cdGlowGain(u));
        const axis = normalize(u.skyFoot.sub(u.skyTop));
        const fromTop = p.sub(u.skyTop);
        const sunk = dot(fromTop, axis);
        const off = length(fromTop.sub(axis.mul(sunk)));
        const cold = u.cool.mul(float(1.0).sub(smoothstep(4.0, sunk.mul(0.1).add(16.0), off))).mul(0.22);
        const col = warm.add(cold).add(u.rock.mul(0.1));
        return vec4(col.mul(density), density.mul(0.82));
    })();
    const part = cdPart('CinderSmoke', geometry, material, 20);
    part.count = count;
    return part;
}

// ── The shaft ───────────────────────────────────────────────────────────────────

/** @param {object} u */
export function createShaft(u) {
    const geometry = cdQuadGeometry(1, {}, 8);
    const material = cdFxMaterial('CinderShaft');
    const s = uv().y;
    // The beam starts above the roof and ends a little under the lake, so neither end shows.
    const top = u.skyTop.add(u.skyTop.sub(u.skyFoot).mul(0.12));
    const centre = mix(top, u.skyFoot, s.mul(1.12));
    const axis = normalize(u.skyFoot.sub(u.skyTop));
    const side = normalize(cross(axis, cameraPosition.sub(centre)));
    const width = mix(float(SKYLIGHT.radius * 0.9), float(SKYLIGHT.radius * 2.2), s);
    material.vertexNode = viewProjection(centre.add(side.mul(positionGeometry.x.mul(width))));
    material.colorNode = Fn(() => {
        const st = uv();
        const across = abs(st.x.sub(0.5)).mul(2.0);
        const body = smoothstep(0.0, 0.55, float(1.0).sub(across));
        // Smoke passing through the light.
        const streak = u.noise(vec2(st.x.mul(0.9), st.y.mul(0.22).add(u.time.mul(0.008)))).r;
        const dust = u.noise(vec2(st.x.mul(2.3).add(u.time.mul(0.01)), st.y.mul(0.9).sub(u.time.mul(0.02)))).b;
        const ends = smoothstep(0.0, 0.14, st.y).mul(float(1.0).sub(smoothstep(0.82, 1.0, st.y)));
        const k = body.mul(body).mul(ends).mul(streak.mul(0.9).add(0.35)).mul(dust.mul(0.6).add(0.7));
        // (It hides a little of the fire-lit smoke behind it, so it reads cold, not mauve.)
        return vec4(u.cool.mul(k).mul(0.3).mul(u.breath.mul(0.5).add(0.5)), k.mul(0.34));
    })();
    return cdPart('CinderShaft', geometry, material, 22);
}
