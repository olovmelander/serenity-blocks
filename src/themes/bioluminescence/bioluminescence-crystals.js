/**
 * Bioluminescence — the crystals that stand in the pool.
 *
 * One instanced draw of a six-sided, pointed prism. Every facet is a flat plane (the normal is
 * the triangle's own), shaded as a pale stone with no scene light and no framebuffer read: it
 * mirrors the cave's glow and the lamps by Fresnel, shows the far side's edges through the near
 * face as straight bands that slide as the eye moves, glows from its root (the mycelium feeds it)
 * and catches light on every arris.
 *
 * The crystals are the grotto's bells. A T-spin, three lines or the Great Bloom makes them
 * chime: a front of light runs root to point through every stone and splits into colours.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    dFdx,
    dFdy,
    dot,
    exp,
    float,
    fwidth,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    reflect,
    sin,
    smoothstep,
    step,
    uniform,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import {
    blAtmosphere,
    blBell,
    blClearLight,
    blFogColor,
    blLamps,
    blLockLight,
    blPart,
} from './bioluminescence-tsl.js';

/** Height (0..1) of the shoulder under the point in the unit crystal. */
const SHOULDER = 0.78;
/** Corner radii of the unit crystal's six sides: a slightly irregular hexagon. */
const CORNERS = [1.0, 0.86, 1.04, 0.9, 1.0, 0.84];
/** Seconds a chime's front takes root to point, and its ring-down. */
const CHIME_RISE = 0.34;
const CHIME_FADE = 1.1;

function unitCrystal() {
    const positions = [];
    const facets = [];
    const corner = (k, y, taper) => {
        const a = (k % 6) * (Math.PI / 3);
        const r = CORNERS[k % 6] * taper;
        return [Math.cos(a) * r, y, Math.sin(a) * r];
    };
    for (let k = 0; k < 6; k++) {
        const a0 = corner(k, 0, 1);
        const a1 = corner(k + 1, 0, 1);
        const b0 = corner(k, SHOULDER, 0.84);
        const b1 = corner(k + 1, SHOULDER, 0.84);
        // The side: two triangles; aFacet.x runs −1..1 across it, aFacet.y is the height.
        positions.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
        facets.push(-1, 0, -1, SHOULDER, 1, 0, 1, 0, -1, SHOULDER, 1, SHOULDER);
        // The point.
        positions.push(...b0, 0, 1, 0, ...b1);
        facets.push(-1, SHOULDER, 0, 1, 1, SHOULDER);
    }
    return { positions, facets };
}

/** A cheap per-instance [0,1) from an integer seed (vertex stage: exact). */
function fractHash(seed, k) {
    return seed.mul(k).mul(0.1031).fract().mul(seed.mul(0.37).add(k * 3.1))
        .fract();
}

/**
 * @param {object} u     shared grotto uniforms
 * @param {object} plan  the grotto's plan
 * @param {object} opts
 * @param {number} opts.count  crystals drawn (the plan's first N)
 */
export function createCrystals(u, plan, { count }) {
    const n = Math.min(count, plan.crystals.length);
    const aBase = new Float32Array(Math.max(1, n) * 4);
    const aAxis = new Float32Array(Math.max(1, n) * 4);
    const aLook = new Float32Array(Math.max(1, n) * 4);
    for (let i = 0; i < n; i++) {
        const c = plan.crystals[i];
        aBase.set([c.x, c.y, c.z, c.height], i * 4);
        aAxis.set([c.axis[0], c.axis[1], c.axis[2], c.radius], i * 4);
        aLook.set([c.yaw, c.hue, c.seed, i], i * 4);
    }
    const unit = unitCrystal();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(unit.positions, 3));
    geometry.setAttribute('aFacet', new THREE.Float32BufferAttribute(unit.facets, 2));
    geometry.setAttribute('aBase', new THREE.InstancedBufferAttribute(aBase, 4));
    geometry.setAttribute('aAxis', new THREE.InstancedBufferAttribute(aAxis, 4));
    geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(aLook, 4));
    geometry.instanceCount = n;

    const base = attribute('aBase', 'vec4');
    const axis = attribute('aAxis', 'vec4');
    const look = attribute('aLook', 'vec4');
    const facet = attribute('aFacet', 'vec2');
    /** The chime: (birth time, strength). */
    const chime = uniform(new THREE.Vector2(-100, 0));

    // They stand in the water: an upright screen draws them nearer the middle with the courts.
    const root = vec3(base.x.mul(u.squeeze), base.y, base.z);
    const g = positionGeometry;
    const s1 = fractHash(look.z, 1.7);
    const s2 = fractHash(look.z, 5.3);
    const shoulder = s1.mul(0.26).add(0.6);
    const y = mix(
        g.y.mul(shoulder.div(SHOULDER)),
        shoulder.add(g.y.sub(SHOULDER).div(1 - SHOULDER).mul(float(1.0).sub(shoulder))),
        step(SHOULDER, g.y),
    );
    const apex = step(0.999, g.y);
    const cy = cos(look.x);
    const sy = sin(look.x);
    const squash = s2.mul(0.3).add(0.82);
    const lx = g.x.mul(cy).sub(g.z.mul(sy)).mul(squash).add(apex.mul(s1.sub(0.5)).mul(0.55));
    const lz = g.x.mul(sy).add(g.z.mul(cy)).add(apex.mul(s2.sub(0.5)).mul(0.55));
    const up = axis.xyz;
    const side = normalize(cross(up, vec3(0.0, 0.0, 1.0)));
    const fwd = cross(side, up);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'BioluminescenceCrystals';
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.positionNode = root.add(up.mul(y.mul(base.w))).add(side.mul(lx).add(fwd.mul(lz)).mul(axis.w));

    const vLook = varying(vec3(look.y, fractHash(look.z, 2.9), base.w), 'blCrystalLook');
    const vRing = varying(blLockLight(u, root), 'blCrystalRing');
    const vClear = varying(blClearLight(u, root), 'blCrystalClear');

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const toCam = normalize(cameraPosition.sub(p)).toVar();
        const face = normalize(cross(dFdx(p), dFdy(p))).toVar();
        const facing = dot(face, toCam);
        const N = face.mul(step(0.0, facing).mul(2.0).sub(1.0)).toVar();
        const V = toCam.negate().toVar();
        const t = facet.y.toVar();
        const ndv = clamp(dot(N, toCam), 0.0, 1.0).toVar();
        const rnd = vLook.y;
        // Each stone leans to the crystal hue, to the caps' or to the accent.
        const tint = mix(mix(u.crystal, mix(u.crystal, u.primary, 0.6), step(0.35, vLook.x)), mix(u.crystal, u.accent, 0.55), step(0.72, vLook.x)).toVar();

        // ── Mirror: the cave's glow and the lamps, by Fresnel ──
        const R = reflect(V, N).toVar();
        const oneMinus = float(1.0).sub(ndv);
        const fres = oneMinus.mul(oneMinus).mul(oneMinus).mul(0.9).add(0.06);
        const lampsR = blLamps(u, p, R).toVar();
        const mirror = blFogColor(u, R).mul(3.0).add(lampsR.mul(0.9));

        // ── The stone: lit facets, each cut a little differently ──
        const cut = sin(dot(N, vec3(12.9, 78.2, 37.7)).add(rnd.mul(20.0))).mul(0.5).add(0.5);
        const growth = sin(t.mul(vLook.z).mul(9.0).add(rnd.mul(30.0))).mul(0.09).add(0.95);
        const lit = blLamps(u, p, N).toVar();
        const front = tint.mul(lit.mul(0.5).add(u.ambient.mul(1.5))).mul(cut.mul(0.7).add(0.45)).mul(growth);

        // ── Within: the far edges seen through the near face, inclusions, a root that glows ──
        const ghost = facet.x.mul(1.6).add(V.x.mul(1.5)).add(V.z.mul(0.9)).add(rnd.mul(6.0));
        const planes = blBell(ghost.fract().sub(0.5).mul(3.4)).mul(0.62)
            .add(blBell(ghost.mul(2.3).add(0.37).fract().sub(0.5)
                .mul(5.5)).mul(0.38));
        const inside = p.mul(0.9).add(V.mul(0.55));
        const grit = u.noise(vec2(inside.x.mul(2.3).add(inside.z), inside.y.mul(2.1)).add(V.xy.mul(0.7))).a;
        const specks = smoothstep(0.72, 0.9, grit).mul(sin(u.time.mul(1.9).add(grit.mul(60.0))).mul(0.5).add(0.5));
        const breathe = sin(u.time.mul(0.55).add(rnd.mul(40.0))).mul(0.18).add(0.82);
        const low = float(1.0).sub(t);
        const core = tint.mul(mix(tint, vec3(1.0), 0.3)).mul(low.mul(low).mul(low).mul(1.5).add(0.08))
            .mul(breathe).mul(u.power.mul(1.5).add(1.0));
        const within = tint.mul(planes).mul(lit.mul(0.25).add(u.fogFar.mul(2.0)))
            .add(core.mul(planes.mul(0.7).add(0.6)))
            .add(mix(tint, vec3(1.0), 0.55).mul(specks).mul(0.3));

        // ── The chime: a front of light root to point, split into colours ──
        const age = u.time.sub(chime.x);
        const rise = age.div(CHIME_RISE);
        const env = exp(max(age, 0.0).div(-CHIME_FADE)).mul(step(0.0, age)).mul(chime.y);
        const band = blBell(t.sub(rise).div(0.3)).add(step(rise, 1.6).oneMinus().mul(0.35));
        const split = vec3(
            sin(facet.x.mul(2.4).add(t.mul(7.0)).add(rnd.mul(9.0))),
            sin(facet.x.mul(2.4).add(t.mul(7.0)).add(rnd.mul(9.0)).add(2.1)),
            sin(facet.x.mul(2.4).add(t.mul(7.0)).add(rnd.mul(9.0)).add(4.2)),
        ).mul(0.5).add(0.5);
        const ring = mix(tint.add(0.3), split.mul(1.5), 0.26).mul(band.add(planes.mul(0.5))).mul(env).mul(1.7);

        // ── Edges: every arris and the shoulder catch the light ──
        const ew = fwidth(facet.x).mul(1.1).add(0.016);
        const sw = fwidth(facet.y).mul(1.3).add(0.002);
        const arris = max(
            smoothstep(float(1.0).sub(ew.mul(2.2)), float(1.0).sub(ew.mul(0.5)), abs(facet.x)),
            float(1.0).sub(smoothstep(sw.mul(0.5), sw.mul(2.0), abs(facet.y.sub(SHOULDER)))).mul(0.7),
        );
        const edge = blFogColor(u, N).mul(5.0).add(lit.mul(0.3)).add(tint.mul(0.1))
            .add(ring.mul(0.5));

        const col = mix(front.add(within), mirror, fres).mul(u.breath).toVar();
        col.addAssign(edge.mul(arris).mul(u.breath.mul(0.8).add(0.2)));
        col.addAssign(ring);
        // Gameplay light that travels over the pool lights the stone from below.
        col.addAssign(vRing.mul(mix(tint, vec3(1.0), 0.4)).mul(low.mul(low).mul(1.5).add(0.25)));
        col.addAssign(vClear.rgb.mul(mix(tint, vec3(1.0), 0.35)).mul(0.8));
        col.addAssign(tint.mul(vClear.w).mul(0.3).mul(low.add(0.3)));
        return blAtmosphere(u, col, p);
    })();

    const part = blPart('BioluminescenceCrystals', geometry, material, -29);
    part.count = n;
    part.uniforms = { chime };
    /** Ring every crystal at `time` (which may be a moment ahead). */
    part.chime = (time, strength = 1) => {
        chime.value.set(time, strength);
    };
    part.reset = () => {
        chime.value.set(-100, 0);
    };
    return part;
}
