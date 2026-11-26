/**
 * Cinder Drift — the air of the chamber.
 *
 *  - Embers: the cinders the theme is named for. Each one rises from the lake on a thermal,
 *    swaying wider the higher it climbs, cooling from gold through red to nothing: a closed-form
 *    function of one clock, which the chamber's pressure winds faster.
 *  - Smoke: slow banks of it under the roof, lit from below by the lake and cold where the
 *    night's shaft passes through. They hide a little of what stands behind them, which is
 *    what gives the chamber its depth.
 *  - The plume: where the great fall strikes the lake it boils, and steam and smoke roll up out
 *    of the splash, lit hot from below and going to smoke as they climb.
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
    cos,
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
    const drift = u.draft.x.mul(k.mul(k)).mul(kind.w).mul(0.44);
    const world = vec3(home.x.add(swayX).add(drift), y.add(0.05), home.y.add(swayZ).add(drift.mul(0.17)));
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    const apparent = kind.x.mul(pxPerMetre);
    const px = clamp(apparent, u.viewport.y.mul(0.0012), u.viewport.y.mul(0.007));
    // A large cinder turns its broad scorched face to the lens; the smaller sparks stretch up
    // the thermal. Subpixel cinders retain a round footprint.
    const resolved = smoothstep(0.8, 2.6, apparent);
    const flake = smoothstep(0.74, 0.87, kind.z).mul(resolved);
    const turn = u.draft.z.mul(kind.y.mul(0.8).add(0.25)).add(phase.mul(TAU));
    const angle = mix(u.draft.x.mul(-0.43).add(sin(turn).mul(0.25)), turn, flake);
    const face = abs(cos(turn.mul(1.3)));
    const offset = positionGeometry.xy.mul(vec2(
        mix(float(1.0).sub(resolved.mul(0.22)), face.mul(0.85).add(0.32), flake),
        float(1.0).add(resolved.mul(0.43)),
    ));
    const screen = vec2(
        offset.x.mul(cos(angle)).sub(offset.y.mul(sin(angle))),
        offset.x.mul(sin(angle)).add(offset.y.mul(cos(angle))),
    );
    material.vertexNode = vec4(clip.xy.add(screen.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const flicker = sin(u.draft.z.mul(phase.mul(7.0).add(3.0)).add(phase.mul(40.0))).mul(0.17).add(0.8);
    const life = smoothstep(0.0, 0.04, k).mul(float(1.0).sub(k)).mul(float(1.0).sub(k.mul(0.5)));
    // Gold as it leaves the lake, red as it dies.
    const hue = mix(u.spark.add(u.hot.mul(0.6)), u.deep.mul(1.6).add(u.spark.mul(0.25)), smoothstep(0.05, 0.75, k.add(kind.z.mul(0.2))));
    // A cinder smaller than its floor in pixels gives the light it has, not the light of the floor.
    const fill = clamp(kind.x.mul(pxPerMetre).div(px), 0.15, 1.0);
    const vLight = varying(hue.mul(life).mul(flicker).mul(fill).mul(u.breath)
        .mul(3.4 * Math.min(1.15, Math.sqrt(1600 / count))), 'cdEmber');
    const vFlake = varying(vec2(flake, life.mul(fill)), 'cdEmberFlake');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const mote = exp(d.mul(d).mul(-7.0)).add(exp(d.mul(-4.0)).mul(0.16))
            .mul(float(1.0).sub(smoothstep(0.7, 1.0, d)));
        const facet = abs(q.x.add(q.y.mul(0.24))).mul(1.2).add(abs(q.y).mul(0.76));
        const shard = float(1.0).sub(smoothstep(0.44, 0.98, mix(d, facet, 0.56)));
        const litEdge = smoothstep(-0.18, 0.4, q.x.sub(q.y.mul(0.58)));
        const coal = mix(mote, shard.mul(litEdge.mul(0.86).add(0.1)), vFlake.x);
        return vec4(vLight.mul(coal), shard.mul(vFlake.x).mul(vFlake.y).mul(0.5));
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
    const driftX = sin(u.draft.z.mul(0.021).mul(rnd.y).add(rnd.w)).mul(9.0)
        .sub(u.draft.x.mul(at.y).mul(0.29));
    const driftY = sin(u.draft.z.mul(0.016).mul(rnd.y).add(rnd.w.mul(2.0))).mul(2.5);
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
        const churn = u.noise(st.mul(0.55).add(vec2(vRand.x.mul(3.0).add(u.draft.z.mul(0.004)), vRand.x.mul(7.0)))).r;
        const wisp = u.noise(st.mul(1.4).add(vec2(vRand.x.mul(11.0), u.draft.z.mul(-0.006).add(churn.mul(0.2))))).g;
        const density = smoothstep(0.38, 0.8, churn.mul(0.65).add(wisp.mul(0.35)).mul(fall.mul(0.8).add(0.5)))
            .mul(fall).mul(vRand.z);
        // Lit from below by the lake, more on its underside; cold where the night's shaft crosses it.
        const p = vWorld;
        const belly = float(1.0).sub(st.y).mul(0.7).add(0.3);
        // (Its crown, far from the lava, is only smoke: dark, and it hides what is behind it.)
        const warm = u.haze.mul(1.5).add(u.mid.mul(0.02)).mul(exp(p.y.div(-18.0))).mul(belly.mul(belly))
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

// ── The plume ───────────────────────────────────────────────────────────────────

/**
 * Puffs that roll up out of the great fall's splash, each on its own loop: fast off the lake,
 * slowing, swelling and leaning the way the crust drifts. Closed form in the clock.
 * @param {object} u
 * @param {number} count
 * @param {object} plan
 */
export function createPlume(u, count, plan) {
    const rand = mulberry32(0x91e3);
    const aP = new Float32Array(count * 4);
    const aQ = new Float32Array(count * 4);
    const { foot, width } = plan.fall;
    for (let i = 0; i < count; i++) {
        // (phase, across the splash, along it, a random number)
        aP.set([(i + rand() * 0.6) / count, (rand() - 0.5) * width * 1.6, (rand() - 0.5) * 3.5, rand()], i * 4);
        // (seconds per loop, how high it climbs, how big it grows, its spin)
        aQ.set([8.8 + rand() * 2.0, 15 + rand() * 10, 0.84 + rand() * 0.38, rand() * TAU], i * 4);
    }
    const geometry = cdQuadGeometry(count, { aPlumeP: [aP, 4], aPlumeQ: [aQ, 4] });
    const P = attribute('aPlumeP', 'vec4');
    const Q = attribute('aPlumeQ', 'vec4');

    const material = cdFxMaterial('CinderPlume');
    const a = fract(u.draft.z.div(Q.x).add(P.x));
    const out = float(1.0).sub(a);
    const climb = float(1.0).sub(out.mul(out));
    const height = Q.y.mul(climb).mul(u.draft.y.mul(0.29).add(0.93)).add(0.6);
    // The impact drives the plume outward first. The crossdraft catches it higher up.
    const lean = vec2(climb.mul(8.8).add(a.mul(a).mul(u.draft.x.mul(11.0).add(6.0))), a.mul(3.4));
    const curl = sin(a.mul(6.2).add(Q.w)).mul(a).mul(3.2);
    const centre = vec3(
        float(foot[0] + 2.5).add(P.y).add(lean.x).add(curl),
        height,
        float(foot[2] + 3.0).add(P.z).add(lean.y),
    );
    const radius = Q.z.mul(climb.mul(7.6).add(1.65)).mul(u.draft.y.mul(0.14).add(0.96));
    const toCam = normalize(cameraPosition.sub(centre));
    const right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    const up = cross(toCam, right);
    // (Turned on its own spin, so no two puffs show the same face.)
    const cs = vec2(sin(Q.w.add(a.mul(0.8)).add(1.5708)), sin(Q.w.add(a.mul(0.8))));
    const qx = positionGeometry.x.mul(cs.x).sub(positionGeometry.y.mul(cs.y));
    const qy = positionGeometry.x.mul(cs.y).add(positionGeometry.y.mul(cs.x));
    const world = centre.add(right.mul(qx.mul(radius.mul(2.0)))).add(up.mul(qy.mul(radius.mul(2.0))));
    material.vertexNode = viewProjection(world);
    const vWorld = varying(world, 'cdPlumeP');
    const vAge = varying(vec4(a, P.w, qx, qy), 'cdPlumeA');
    material.colorNode = Fn(() => {
        const st = uv();
        const q = st.sub(0.5).mul(2.0);
        const r = length(q);
        const age = vAge.x;
        const seed = vAge.y;
        const churn = u.noise(st.mul(0.6).add(vec2(seed.mul(5.0), age.mul(0.35).add(seed.mul(9.0))))).r;
        const wisp = u.noise(st.mul(1.6).add(vec2(seed.mul(13.0).add(churn.mul(0.3)), age.mul(-0.5)))).g;
        const edge = r.add(churn.sub(0.5).mul(0.62)).add(wisp.sub(0.5).mul(0.21));
        const shape = float(1.0).sub(smoothstep(0.48, 0.97, edge));
        const life = smoothstep(0.0, 0.09, age).mul(float(1.0).sub(smoothstep(0.57, 1.0, age)));
        const lobes = smoothstep(0.24, 0.76, churn.mul(0.54).add(wisp.mul(0.46))).toVar();
        const density = shape.mul(lobes.mul(0.54).add(0.46)).mul(life).toVar();
        // The low boil is backlit from the pool. Higher up the glowing fall rakes the left
        // shoulder of each roll, the shaded face holds soot and catches a little of the night.
        const y = max(vWorld.y, 0.0);
        const belly = clamp(float(0.56).sub(vAge.w.mul(1.12)).add(lobes.mul(0.14)), 0.12, 1.0);
        const lower = exp(y.div(-4.4)).mul(belly);
        const flank = smoothstep(0.07, 0.87, float(0.39).sub(vAge.z.mul(1.38)).sub(vAge.w.mul(0.38))
            .add(churn.sub(0.5).mul(1.1))
            .add(wisp.sub(0.5).mul(0.52)));
        const fromPour = exp(abs(vWorld.x.sub(foot[0])).div(-14.5)).mul(flank.mul(flank));
        const reflected = u.mid.mul(0.59).add(u.hot.mul(0.19)).mul(fromPour);
        const fire = u.mid.mul(1.35).add(u.hot.mul(0.68)).mul(lower).add(reflected)
            .mul(u.fallGain)
            .mul(cdGlowGain(u));
        const sky = smoothstep(5.0, 18.0, y).mul(lobes.mul(0.32).add(0.68));
        const soot = u.rock.mul(0.49).add(u.cool.mul(0.18).mul(sky));
        const opacity = density.mul(float(0.46).add(sky.mul(0.3)));
        return vec4(soot.mul(opacity).add(fire.mul(density)), opacity);
    })();
    const part = cdPart('CinderPlume', geometry, material, 21);
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
        const streak = u.noise(vec2(
            st.x.mul(0.9).add(u.draft.x.mul(0.12)),
            st.y.mul(0.22).add(u.draft.z.mul(0.008)),
        )).r;
        const dust = u.noise(vec2(st.x.mul(2.3).add(u.draft.z.mul(0.01)), st.y.mul(0.9).sub(u.draft.z.mul(0.02)))).b;
        const ends = smoothstep(0.0, 0.14, st.y).mul(float(1.0).sub(smoothstep(0.82, 1.0, st.y)));
        const k = body.mul(body).mul(ends).mul(streak.mul(0.9).add(0.35)).mul(dust.mul(0.6).add(0.7))
            .mul(float(1.16).sub(u.draft.y.mul(0.38)));
        // Motes of ash turning slowly in the cold light.
        const mote = u.noise(vec2(st.x.mul(4.2).add(u.draft.z.mul(0.011)), st.y.mul(2.4).sub(u.draft.z.mul(0.026)))).a;
        const motes = smoothstep(0.84, 0.96, mote).mul(body).mul(ends);
        const light = u.cool.mul(k.mul(0.62).add(motes.mul(1.6))).mul(u.breath.mul(0.5).add(0.5));
        // (It hides a little of the fire-lit smoke behind it, so it reads cold, not mauve.)
        return vec4(light, k.mul(0.26));
    })();
    return cdPart('CinderShaft', geometry, material, 22);
}
