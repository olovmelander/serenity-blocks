/**
 * Tornado — the air at the lens: chaff on the inflow, the straw a landing piece kicks up, rain.
 *
 * The storm draws air in along the ground, and until now nothing showed it but the wheat. Three
 * things do:
 *
 * CHAFF. Flecks of straw and husk ride the inflow past the lens toward the funnel, thin when the
 * storm is at rest and thick when it is wound up. They are things, not light (a spark added to a
 * sunlit field shows nothing): a lit colour with its own cover. Each lives in a box of air round
 * the lens, its place a function of how far the inflow has travelled (u.airDrift), wrapped, so
 * nothing is simulated and a frozen clock replays it.
 *
 * BURSTS. A hard drop slams the field: straw is thrown up out of the wheat at both feet of the
 * card, out and away from it and into the wind, with soft puffs of dust for a body (what is
 * thrown up behind the card is never seen). A plain lock throws a little, on the piece's side.
 * In the piece's colour as much as in the straw's.
 *
 * RAIN. A squall crosses the lens every few minutes, and a storm in a fever brings its own: thin
 * slanted streaks, pale against the deck and the field, lost against the bright gap.
 */
import * as THREE from 'three/webgpu';
import {
    attribute,
    cameraPosition,
    clamp,
    cross,
    dot,
    exp,
    float,
    fract,
    int,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    texture,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { mulberry32 } from './tornado-core.js';
import { AIR_BOX, BURSTS, RAIN_BOX } from './tornado-tsl.js';

/** Light plus cover: the colour is added over (1 − cover) of what is behind; its alpha stays. */
function lightAndCover(material) {
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendEquationAlpha = THREE.AddEquation;
    material.blendSrcAlpha = THREE.ZeroFactor;
    material.blendDstAlpha = THREE.OneFactor;
    material.premultipliedAlpha = true;
    material.side = THREE.DoubleSide;
    material.fog = false;
    return material;
}

/** `count` quads, each with one vec4 of its own under `name`. */
function quads(name, data, count) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.attributes.position);
    geometry.setAttribute('uv', base.attributes.uv);
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, 4));
    geometry.instanceCount = count;
    return { geometry, base };
}

const randoms = (count, seed) => {
    const rand = mulberry32(seed);
    const data = new Float32Array(count * 4);
    for (let i = 0; i < data.length; i += 1) data[i] = rand();
    return data;
};

/**
 * A streak that ends at `head`, `long` metres back along `run`, `thick` pixels through: never
 * shorter than `least` pixels (it would be lost) and never longer than `most` (a fleck close to
 * the lens in a gale would be a stick across the frame).
 */
function streak(u, head, run, long, thick, least, most) {
    const range = length(cameraPosition.sub(head));
    const pixel = range.mul(u.pixelAngle);
    const reach = clamp(long, pixel.mul(least), pixel.mul(most));
    const centre = head.sub(run.mul(reach.mul(0.5)));
    const aside = normalize(cross(run, cameraPosition.sub(centre)));
    return {
        range,
        position: centre
            .add(run.mul(positionGeometry.x.mul(reach)))
            .add(aside.mul(positionGeometry.y.mul(2.0)).mul(pixel.mul(thick))),
    };
}

function createChaff({ u, tier }) {
    const count = tier.chaff;
    const { geometry, base } = quads('aChaff', randoms(count, 5150), count);
    const material = lightAndCover(new THREE.MeshBasicNodeMaterial());
    const c = attribute('aChaff', 'vec4');
    const seed = c.w;
    // Quarter steps of speed: the drift wraps on the CPU at four boxes, which is then exact.
    const speed = seed.mul(4.0).floor().mul(0.25).add(0.75);
    const box = vec3(AIR_BOX.wide, AIR_BOX.tall, AIR_BOX.deep);
    const t = fract(vec3(c.x, c.y, c.z).add(u.airDrift.mul(speed).div(box)));
    // Low over the stand mostly, a few high in the air; a flutter of its own.
    const flutter = vec3(
        sin(u.wind.mul(2.1).add(seed.mul(40.0))),
        sin(u.wind.mul(2.7).add(seed.mul(17.0))).mul(0.5),
        sin(u.wind.mul(1.9).add(seed.mul(23.0))),
    ).mul(0.22);
    const head = vec3(
        t.x.sub(0.5).mul(AIR_BOX.wide),
        t.y.mul(t.y).mul(AIR_BOX.tall).add(0.4),
        t.z.mul(AIR_BOX.deep).sub(AIR_BOX.ahead),
    ).add(flutter);
    const run = normalize(vec3(u.inflow.x, 0.08, u.inflow.y));
    // Nothing pops at the box's faces, and nothing smears across the lens.
    const edge = (v, lo, hi) => smoothstep(0.0, lo, v).mul(smoothstep(hi, 1.0, v).oneMinus());
    const inBox = edge(t.x, 0.07, 0.93).mul(edge(t.z, 0.07, 0.93)).mul(edge(t.y, 0.05, 0.8));
    // More of it in the air as the storm winds up (u.air.x: the share that flies).
    const shown = step(fract(seed.mul(91.7)), u.air.x);
    const line = streak(u, head, run, speed.mul(u.air.y), fract(seed.mul(7.9)).mul(1.1).add(1.2), 3.0, 16.0);
    const live = inBox.mul(shown).mul(smoothstep(2.0, 5.0, line.range));
    material.positionNode = mix(head, line.position, step(0.001, live));

    // Straw catching the low sun as it tumbles; one fleck in four a dark husk.
    const glint = max(sin(u.wind.mul(seed.mul(9.0).add(7.0)).add(seed.mul(50.0))), 0.0);
    const husk = step(0.6, fract(seed.mul(13.3)));
    const straw = u.wheatLit.mul(1.05).add(u.sun.mul(glint.mul(glint)).mul(0.32));
    const lit = varying(vec4(mix(straw, u.wheatShade.mul(0.7), husk), live.mul(0.82)));
    const across = clamp(uv().y.sub(0.5).mul(2.0), -1.0, 1.0);
    const along = clamp(uv().x, 0.0, 1.0);
    const fleck = exp(across.mul(across).mul(-3.0)).mul(smoothstep(0.0, 0.2, along)).mul(smoothstep(0.75, 1.0, along).oneMinus());
    material.colorNode = vec4(lit.rgb.mul(lit.a).mul(fleck), lit.a.mul(fleck));
    material.outputNode = material.colorNode;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 54;
    mesh.name = 'tornado-chaff';
    return { mesh, base };
}

/** Seconds a burst's straw is in the air, at most. */
export const BURST_LIFE = 2.6;
/** A burst throws dust as well as straw only at this power or more (tornado-world.js burstPower). */
export const PUFF_POWER = 0.95;

function createBursts({ u, noise, tier }) {
    const per = tier.burst;
    const count = per * BURSTS;
    const data = randoms(count, 8086);
    // (slot, three randoms). One in seven is a puff of dust, the rest straw.
    for (let i = 0; i < count; i += 1) data[i * 4] = Math.floor(i / per);
    const { geometry, base } = quads('aBurst', data, count);
    const material = lightAndCover(new THREE.MeshBasicNodeMaterial());
    const b = attribute('aBurst', 'vec4');
    const slot = int(b.x.mul(2.0).add(0.5));
    const from = u.bursts.element(slot); // (origin, start)
    const paint = u.bursts.element(slot.add(1)); // (rgb, power)
    const puff = step(0.8, fract(b.y.mul(57.3)));
    const age = u.time.sub(from.w).sub(b.y.mul(0.1));
    const a = max(age, 0.0);
    const life = mix(b.z.mul(1.0).add(1.3), float(BURST_LIFE), puff);
    // Thrown out to one side of the card or the other and up, slowing in the air; then the
    // inflow has it. Straw is light: it falls slowly, and the wind takes it further each second.
    // (The side it is thrown to is the sign of its power: away from the card.)
    const side = step(0.0, paint.w).mul(2.0).sub(1.0);
    const acrossDir = normalize(vec3(u.camRight.x, 0.0, u.camRight.z));
    const power = paint.w.abs();
    const thrown = acrossDir.mul(side.mul(b.z.mul(7.0).add(1.5)))
        .add(vec3(0.0, b.y.mul(6.5).add(3.0), 0.0))
        .add(vec3(u.inflow.x, 0.0, u.inflow.y).mul(b.w.sub(0.3).mul(5.0)))
        .mul(mix(float(1.0), float(0.42), puff))
        .mul(power.mul(0.3).add(0.7));
    const drag = 1.7;
    const placeAt = (when) => from.xyz
        .add(thrown.mul(float(1.0).sub(exp(when.mul(-drag))).div(drag)))
        .add(vec3(0.0, when.mul(when).mul(mix(float(-2.1), float(0.25), puff)), 0.0))
        .add(vec3(u.inflow.x, 0.0, u.inflow.y).mul(when.mul(when).mul(u.air.z)));
    const head = placeAt(a);
    const tail = placeAt(max(a.sub(0.03), 0.0));
    const run = normalize(head.sub(tail).add(vec3(0.0, 1e-4, 0.0)));
    const alive = step(0.0, age).mul(step(age, life)).mul(step(0.001, power))
        // A soft lock throws less of it.
        .mul(step(fract(b.w.mul(7.7)), power.mul(0.62)))
        // Dust only for a slam at full strength (a quick hand's drops throw straw alone).
        .mul(mix(float(1.0), step(PUFF_POWER, power), puff))
        .mul(smoothstep(0.35, 0.8, head.y));
    const range = length(cameraPosition.sub(head));
    const pixel = range.mul(u.pixelAngle);
    const line = streak(u, head, run, length(head.sub(tail)).mul(1.4), b.z.mul(1.4).add(1.5), 3.2, 34.0);
    // A puff: a quad that faces the lens and swells as it slows.
    const swell = a.mul(1.7).add(0.8).mul(b.z.mul(0.7).add(0.65));
    const puffAt = head
        .add(u.camRight.mul(positionGeometry.x).add(u.camUp.mul(positionGeometry.y)).mul(max(swell, pixel.mul(6.0))));
    const near = smoothstep(1.2, 3.5, range);
    material.positionNode = mix(from.xyz, mix(line.position, puffAt, puff), step(0.001, alive.mul(near)));

    const fade = float(1.0).sub(smoothstep(0.55, 1.0, a.div(life)));
    // Half straw, half the piece's own colour, in the hour's light.
    const strawTone = u.wheatLit.mul(1.45).add(u.sun.mul(0.14));
    const flake = mix(strawTone, paint.rgb.mul(u.wheatLit.add(u.sun.mul(0.25)).dot(vec3(0.5, 0.6, 0.2)).add(0.35)), 0.42);
    const dustTone = u.dust.mul(1.15).add(paint.rgb.mul(u.dust.dot(vec3(0.33, 0.33, 0.33))).mul(0.4));
    const colour = varying(vec4(mix(flake, dustTone, puff), alive.mul(near).mul(fade).mul(mix(float(0.9), float(0.3), puff))));
    const kind = varying(vec2(puff, b.y));
    const q = uv().sub(0.5).mul(2.0);
    const fleck = exp(q.y.mul(q.y).mul(-3.0)).mul(smoothstep(-1.0, -0.6, q.x)).mul(smoothstep(0.5, 1.0, q.x).oneMinus());
    // (A Gaussian, bitten by its own patch of the noise by a threshold that barely follows the
    // radius: a puff has no edge and no rim.)
    const soft = exp(dot(q, q).mul(-2.6));
    const billow = texture(noise, uv().mul(0.3).add(vec2(kind.y, kind.y.mul(7.3)))).g;
    const body = soft.mul(smoothstep(0.34, 0.64, billow.add(soft.mul(0.22))));
    const shape = mix(fleck, body, kind.x);
    material.colorNode = vec4(colour.rgb.mul(colour.a).mul(shape), colour.a.mul(shape));
    material.outputNode = material.colorNode;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 56;
    mesh.name = 'tornado-bursts';
    return { mesh, base };
}

function createRain({ u, tier }) {
    const count = tier.rain;
    const { geometry, base } = quads('aRain', randoms(count, 1912), count);
    const material = lightAndCover(new THREE.MeshBasicNodeMaterial());
    const r = attribute('aRain', 'vec4');
    const seed = r.w;
    const fall = seed.mul(3.0).floor().mul(0.25).add(1.0); // 1, 1.25, 1.5: exact under the wrap
    const box = vec3(RAIN_BOX.wide, RAIN_BOX.tall, RAIN_BOX.deep);
    const travelled = vec3(u.airDrift.x, u.rainFall.mul(fall).negate(), u.airDrift.z);
    const t = fract(vec3(r.x, r.y, r.z).add(travelled.div(box)));
    const head = vec3(
        t.x.sub(0.5).mul(RAIN_BOX.wide),
        t.y.mul(RAIN_BOX.tall),
        t.z.mul(RAIN_BOX.deep).sub(RAIN_BOX.ahead),
    );
    // It falls slanted, down the inflow.
    const run = normalize(vec3(u.inflow.x.mul(0.55), -1.0, u.inflow.y.mul(0.55)));
    const edge = (v) => smoothstep(0.0, 0.08, v).mul(smoothstep(0.92, 1.0, v).oneMinus());
    const line = streak(u, head, run, fall.mul(1.7), float(0.95), 9.0, 70.0);
    const live = edge(t.x).mul(edge(t.z)).mul(edge(t.y)).mul(smoothstep(1.5, 4.0, line.range))
        .mul(step(fract(seed.mul(71.3)), u.squall));
    material.positionNode = mix(head, line.position, step(0.001, live));
    // Pale in the hour's air, brighter looking into the low sun.
    const toward = clamp(dot(normalize(head.sub(cameraPosition)), u.sunDir), 0.0, 1.0);
    const lit = varying(vec4(u.haze.mul(0.95).add(u.sun.mul(toward.mul(toward)).mul(0.3)), live.mul(0.17)));
    const across = clamp(uv().y.sub(0.5).mul(2.0), -1.0, 1.0);
    const drop = exp(across.mul(across).mul(-3.5)).mul(smoothstep(0.0, 0.3, uv().x)).mul(smoothstep(0.6, 1.0, uv().x).oneMinus());
    material.colorNode = vec4(lit.rgb.mul(lit.a).mul(drop), lit.a.mul(drop));
    material.outputNode = material.colorNode;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 57;
    mesh.visible = false;
    mesh.name = 'tornado-rain';
    return { mesh, base };
}

export function createAir({ u, noise, tier }) {
    const chaff = createChaff({ u, tier });
    const bursts = createBursts({ u, noise, tier });
    const rain = createRain({ u, tier });
    const group = new THREE.Group();
    group.name = 'tornado-air';
    group.add(chaff.mesh, bursts.mesh, rain.mesh);
    return {
        object: group,
        rain: rain.mesh,
        dispose() {
            [chaff, bursts, rain].forEach((part) => {
                part.mesh.geometry.dispose();
                part.base.dispose();
                part.mesh.material.dispose();
            });
        },
    };
}
