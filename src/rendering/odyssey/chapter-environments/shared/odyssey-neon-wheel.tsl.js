/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview THE WHEEL AT THE END OF THE LINE (2026-11-25).
 *
 * The journey's last orb is "Last Light": the sun sets behind a lit ferris wheel. The city had the
 * sun and no wheel. A wheel now stands on a low roof of the boulevard's left wall a block past the
 * end of the rail, under the DROP tower's screen: the arrival at the last orb looks straight at
 * it, the sun's disc at its shoulder.
 *
 * One quad and one small shader: the rim's two rings, the spokes, the hub, the cabins (each hangs
 * level as the wheel carries it round) and the two legs, all drawn as lines that keep their light
 * when they are thinner than a pixel. Dark steel against the sun, with a few lights on it: lamps
 * round the rim that chase, light running out along the spokes, the cabins' windows. It stands in
 * the city's air and lights with the city (`neonIgnition`, `seamReveal`).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    clamp,
    cos,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    mix,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { neonAir, neonCityPos, neonIgnition } from './odyssey-neon-light.tsl.js';

/** Where the wheel stands and how big it is (corridor units). */
export const NEON_WHEEL = Object.freeze({
    /**
     * The hub: over the roof of a low block of the boulevard's left wall (the inner bank's rank 12,
     * roof at y 4), a block past the end of the rail (z -123) and at the foot of the DROP tower. Every
     * wheel tried further off (past the last rank, or on the far roofs) was hidden from the rail by
     * the wall's own towers: the eye rides 60 to 76 u over the street, level with their roofs.
     */
    hub: Object.freeze([-46, 27, -199]),
    radius: 20,
    spokes: 20,
    cabins: 14,
    /** Seconds a turn. */
    period: 110,
    /** The quad round it: half its width, how far it reaches over and under the hub (in radii). */
    half: 1.14,
    over: 1.1,
    under: 1.2,
});

const TAU = Math.PI * 2;
const not = (x) => float(1.0).sub(x);

/**
 * @param {object} N neon uniforms
 * @returns {THREE.Mesh}
 */
export function createNeonWheel(N) {
    const W = NEON_WHEEL;
    const R = W.radius;
    const uOpacity = uniform(1);
    const width = 2 * W.half * R;
    const height = (W.over + W.under) * R;
    const geometry = new THREE.PlaneGeometry(width, height, 1, 1);
    const pcVarying = neonCityPos(N, 'vWheelPos');

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'odyssey-neon-wheel';
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.forceSinglePass = true;
    // Premultiplied "over": the steel covers what is behind it, the lights add to it.
    material.premultipliedAlpha = true;
    material.uniforms = { uOpacity };
    material.userData.emitsBloom = true;

    material.outputNode = Fn(() => {
        // (Clamped: under MSAA an interpolated uv leaves 0..1 at a far quad's edge.)
        const st = clamp(uv(), 0.0, 1.0);
        // The hub is the origin; units are corridor units.
        const p = vec2(st.x.sub(0.5).mul(width), st.y.mul(height).sub(W.under * R)).toVar();
        const px = max(fwidth(p.x), fwidth(p.y)).max(1e-3).toVar();
        const r = length(p).toVar();
        const turn = N.uTime.mul(TAU / W.period).toVar();
        const theta = atan(p.y, p.x).sub(turn).toVar();
        // A line `half` wide at distance `d` from its axis: drawn at least a pixel wide, and as
        // much dimmer as it was widened, so a far wheel is fine lines and not a grey disc.
        const line = (d, half) => {
            const drawn = max(float(half), px.mul(0.6));
            return not(smoothstep(drawn, drawn.add(px), d)).mul(float(half).div(drawn));
        };
        // ── The steel: two rings, the spokes, the hub, the legs ──
        const rimD = abs(r.sub(R)).toVar();
        const rings = max(line(rimD, 0.26), line(abs(r.sub(R * 0.9)), 0.18));
        const spokeTurn = theta.div(TAU).mul(W.spokes).toVar();
        const spokeD = abs(fract(spokeTurn.add(0.5)).sub(0.5)).mul(TAU / W.spokes).mul(r);
        const spokes = line(spokeD, 0.11).mul(step(r, R)).mul(step(R * 0.05, r)).toVar();
        const hub = not(smoothstep(R * 0.055, px.add(R * 0.055), r));
        // The legs: from the hub down and out to the ground, either side.
        const legD = abs(abs(p.x).sub(p.y.negate().mul(0.3))).mul(0.958);
        const legs = line(legD, 0.34).mul(step(p.y, 0.0)).toVar();

        // ── The lights ──
        // Light runs out along every spoke, a spoke in rose, the next in cyan.
        const spokeId = floor(spokeTurn.add(0.5));
        const run = smoothstep(0.55, 1.0, fract(r.mul(2.2 / R).sub(N.uTime.mul(0.16)).add(spokeId.mul(0.37))));
        const spokeCol = mix(vec3(1.0, 0.22, 0.6), vec3(0.12, 0.85, 1.0), step(0.5, fract(spokeId.mul(0.5))));
        const spokeLight = spokeCol.mul(spokes).mul(run.mul(0.85).add(0.15));
        // Lamps round the rim, a wave of them chasing.
        const lamp = not(smoothstep(0.16, 0.3, abs(fract(theta.div(TAU).mul(W.cabins * 4)).sub(0.5))));
        const chase = sin(theta.mul(3.0).add(N.uTime.mul(1.3))).mul(0.5).add(0.5);
        const rimLight = vec3(1.0, 0.72, 0.42).mul(line(rimD, 0.36)).mul(lamp.mul(0.75).add(0.25))
            .mul(chase.mul(0.7).add(0.3));
        // The cabins: each hangs under its pin on the rim, level whatever the wheel's turn.
        const cabinId = floor(theta.div(TAU).mul(W.cabins).add(0.5)).toVar();
        const pinAngle = cabinId.mul(TAU / W.cabins).add(turn).toVar();
        const hang = p.sub(vec2(cos(pinAngle), sin(pinAngle)).mul(R)).add(vec2(0.0, R * 0.05)).toVar();
        const box = max(abs(hang.x).sub(R * 0.034), abs(hang.y).sub(R * 0.026));
        const cabin = not(smoothstep(0.0, px, box)).toVar();
        const cabinPick = fract(cabinId.mul(0.33));
        const cabinCol = mix(
            mix(vec3(1.0, 0.82, 0.55), vec3(1.0, 0.3, 0.62), step(0.34, cabinPick)),
            vec3(0.2, 0.9, 1.0),
            step(0.67, cabinPick),
        );
        const hubGlow = exp(r.div(R * 0.09).negate()).mul(0.9);
        const lights = spokeLight.mul(0.8).add(rimLight.mul(0.95)).add(cabinCol.mul(cabin).mul(1.1))
            .add(vec3(1.0, 0.86, 0.7).mul(hubGlow))
            // A red lamp now and then down each leg.
            .add(vec3(1.0, 0.25, 0.2).mul(legs).mul(smoothstep(0.75, 0.95, fract(p.y.mul(0.045)))).mul(0.9));

        // ── In the city's air, lit with the city ──
        const air = neonAir(N, pcVarying, vec3(0.0, 0.0, 0.0));
        const ign = neonIgnition(N, pcVarying);
        const coverage = max(max(max(rings, spokes), max(hub, legs)), cabin);
        const body = mix(vec3(0.012, 0.01, 0.02), air.colour, air.amount.mul(0.82));
        const glow = lights.mul(ign.level).mul(not(air.amount.mul(0.55)));
        // (It arrives through the 7->8 tunnel's mouth with the rest of the city: `seamReveal`.)
        const shown = uOpacity.mul(N.seamReveal);
        return vec4(body.mul(coverage).add(glow).mul(shown), coverage.mul(shown));
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'neon-wheel';
    mesh.position.set(W.hub[0], W.hub[1] + ((W.over - W.under) * R * 0.5), W.hub[2]);
    mesh.frustumCulled = false;
    // After the Retrosun (-95), the skyline cards (-88, -86) and the street (-80), all behind it.
    mesh.renderOrder = -70;
    return mesh;
}
