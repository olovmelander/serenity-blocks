/**
 * Vesper Chrysalis — the wings.
 *
 * Four fans of light rooted at the chrysalis's shoulders: two forewings that sweep up and out,
 * two hindwings that hang toward the lake and stop just short of it. They are never solid. A
 * wing is a veil of colour, dusted like a moth's, with its veins drawn in light (light runs out
 * along them from the root), two scalloped bands near its margin, the bright margin itself, a
 * glitter of scales, and an eye that opens late in a chain.
 *
 * A wing is WRITTEN outward from the root: everything inside the front is lit, the front itself
 * is a hot line, and beyond it there is nothing. The front's place is how far the chain of
 * clears has come (u.wing.x), so every step of a combo draws a new band of wing on both sides
 * of the board. When the chain breaks the wings burn away from the margin inward (u.wing.z).
 *
 * Drawn premultiplied (One, OneMinusSrcAlpha): the light adds, and the little alpha the veil
 * and the eyes' pupils carry lets them darken what is behind them.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    cos,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    sin,
    smoothstep,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    WINGS,
    vcBell,
    vcHash21,
    vcPart,
    wingBase,
    wingPoint,
    wingScallop,
} from './vesper-chrysalis-tsl.js';

/**
 * One geometry for all four wings. aWing = (an, v, kind, side); aOut = (the margin at an without
 * its scallops, the scallop there): the scallops are let in only near the margin, so everything
 * drawn on the wing in (an, v) keeps its shape.
 */
export function buildWingGeometry() {
    const position = [];
    const wing = [];
    const out = [];
    const index = [];
    const p = [0, 0, 0];
    [-1, 1].forEach((side) => {
        [0, 1].forEach((kind) => {
            const fan = kind === 0 ? WINGS.fore : WINGS.hind;
            const base = position.length / 3;
            for (let i = 0; i <= fan.segA; i++) {
                const an = i / fan.segA;
                const margin = wingBase(kind, an);
                const scallop = wingScallop(kind, an);
                for (let j = 0; j <= fan.segV; j++) {
                    const v = j / fan.segV;
                    wingPoint(kind, side, an, v, 1, 0, p);
                    position.push(p[0], p[1], p[2]);
                    wing.push(an, v, kind, side);
                    out.push(margin, scallop);
                }
            }
            const row = fan.segV + 1;
            for (let i = 0; i < fan.segA; i++) {
                for (let j = 0; j < fan.segV; j++) {
                    const a = base + i * row + j;
                    index.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
                }
            }
        });
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 4));
    geometry.setAttribute('aOut', new THREE.Float32BufferAttribute(out, 2));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    return geometry;
}

/** The margin where each wing's eye sits: the eye's own scale. */
const EYE_SCALE = [wingBase(0, WINGS.foreEye[0]), wingBase(1, WINGS.hindEye[0])];

/**
 * @param {object} u  shared uniforms
 * @param {object} [opts]
 * @param {number} [opts.detail=2]  0 = veins and bands, 1 = + the glitter of the scales,
 *                                  2 = + the fine net between the veins
 */
export function createWings(u, opts = {}) {
    const detail = opts.detail ?? 2;
    const geometry = buildWingGeometry();
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'VesperChrysalisWings';
    material.transparent = true;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.toneMapped = false;

    const aWing = attribute('aWing', 'vec4');
    const aOut = attribute('aOut', 'vec2');
    const vWing = varying(aWing, 'vWing');

    material.positionNode = Fn(() => {
        const an = aWing.x;
        const v = aWing.y;
        const kind = aWing.z;
        const side = aWing.w;
        const s = smoothstep(0.0, 0.8, u.wing.x);
        const fold = float(1.0).sub(kind);
        const spread = s.mul(0.38).add(0.62);
        const turn = fold.add(an.sub(fold).mul(spread));
        const a = mix(
            mix(float(WINGS.fore.a0), float(WINGS.fore.a1), turn),
            mix(float(WINGS.hind.a0), float(WINGS.hind.a1), turn),
            kind,
        );
        const v2 = v.mul(v);
        const v8 = v2.mul(v2).mul(v2).mul(v2);
        const reach = aOut.x.mul(aOut.y.mul(v8).add(1.0)).mul(v).mul(WINGS.span).mul(s.mul(0.26).add(0.74));
        const lx = cos(a).mul(reach);
        const ly = sin(a).mul(reach);
        // The stroke turns the wing about the body's upright axis, its tip lagging; and the
        // membrane is never quite still.
        const th = u.wing.y.mul(v.mul(0.65).add(0.35));
        const billow = sin(an.mul(7.0).add(v.mul(4.0)).sub(u.drift.mul(1.1)).add(kind.mul(2.0))).mul(v).mul(0.5);
        return vec3(
            side.mul(lx.mul(cos(th)).add(WINGS.root[0])),
            ly.add(WINGS.root[1]),
            abs(lx).mul(sin(th)).add(billow).add(WINGS.root[2]),
        );
    })();

    const shade = Fn(() => {
        const an = clamp(vWing.x, 0.0, 1.0).toVar();
        const v = clamp(vWing.y, 0.0, 1.0).toVar();
        const kind = vWing.z.toVar();
        const w = u.wing.x;
        const fall = u.wing.z;

        // ── The front: the wing is written outward from the root ──
        const grain = u.noise(vec2(an.mul(1.6).add(kind.mul(0.37)), v.mul(1.3).add(0.61))).toVar();
        const fine = u.noise(vec2(an.mul(5.5).add(kind.mul(0.71)), v.mul(6.5))).toVar();
        const front = w.mul(1.07).add(grain.r.sub(0.5).mul(0.05)).toVar();
        const lit = float(1.0).sub(smoothstep(front.sub(0.012), front, v)).mul(step(0.002, w)).toVar();
        const writing = float(1.0).sub(smoothstep(0.97, 1.03, w));
        const frontLine = vcBell(v.sub(front).add(0.01).div(0.016)).mul(writing).mul(step(0.002, w));
        const frontGlow = vcBell(v.sub(front).add(0.05).div(0.07)).mul(writing).mul(lit);

        // ── Colour runs from the root's gold through the mid tone to the margin ──
        const inward = mix(u.wingRoot, u.wingMid, smoothstep(0.05, 0.52, v));
        const tint = mix(inward, u.wingEdge, smoothstep(0.55, 0.98, v)).toVar();
        // A slow shimmer rolls across it, as light does over scales.
        const sheen = sin(v.mul(7.0).add(an.mul(4.0)).add(u.wing.y.mul(9.0)).add(u.drift.mul(0.3))).mul(0.5).add(0.5);
        tint.assign(mix(tint, tint.zxy.mul(0.55).add(tint.mul(0.5)), sheen.mul(0.2)));

        // ── Veins: they leave the root together, curve, and fork half way out ──
        const count = mix(float(WINGS.fore.veins), float(WINGS.hind.veins), kind);
        const bend = sin(v.mul(2.3).add(an.mul(3.0))).mul(0.05).mul(v).add(grain.a.sub(0.5).mul(0.035).mul(v));
        const cell = an.add(bend).mul(count).toVar();
        const width = mix(float(0.12), float(0.03), smoothstep(0.0, 0.75, v));
        const main = vcBell(abs(fract(cell).sub(0.5)).div(width));
        const fork = vcBell(abs(fract(cell.add(0.5)).sub(0.5)).div(width.mul(0.8))).mul(smoothstep(0.42, 0.64, v));
        // Light runs out along each vein from the root.
        const flow = sin(v.mul(13.0).sub(u.time.mul(2.1)).add(floor(cell).mul(1.9))).mul(0.4).add(0.6);
        const veins = max(main, fork.mul(0.7)).mul(flow).toVar();
        // The net between the veins: fine irregular cells, as in any insect's wing.
        const net = detail >= 2
            ? vcBell(fine.g.sub(0.5).div(0.03)).mul(smoothstep(0.12, 0.4, v)).mul(0.22)
            : float(0.0);

        // ── The bands near the margin, and the margin itself: scalloped between the veins ──
        const lobe = abs(sin(cell.mul(Math.PI))).sub(0.5);
        const band1 = vcBell(v.sub(0.69).sub(lobe.mul(0.03)).div(0.013));
        const band2 = vcBell(v.sub(0.87).sub(lobe.mul(0.022)).div(0.009));
        const margin = smoothstep(0.88, 1.0, v);
        const rim = exp(float(1.0).sub(v).mul(-60.0));

        // ── The eye ──
        const eye = mix(vec3(...WINGS.foreEye), vec3(...WINGS.hindEye), kind);
        const open = mix(u.eyes.y, u.eyes.x, kind).toVar();
        const sweep = mix(
            float(Math.abs(WINGS.fore.a1 - WINGS.fore.a0) * EYE_SCALE[0]),
            float(Math.abs(WINGS.hind.a1 - WINGS.hind.a0) * EYE_SCALE[1]),
            kind,
        );
        const scale = mix(float(EYE_SCALE[0]), float(EYE_SCALE[1]), kind);
        const e2 = vec2(an.sub(eye.x).mul(sweep).mul(eye.y), v.sub(eye.y).mul(scale)).div(eye.z).toVar();
        const ed = length(e2).div(max(open, 0.04)).toVar();
        const pupil = float(1.0).sub(smoothstep(0.27, 0.35, ed));
        const iris = vcBell(ed.sub(0.5).div(0.15));
        const ring = vcBell(ed.sub(0.74).div(0.09));
        const lash = vcBell(ed.sub(0.95).div(0.055));
        const glint = vcBell(length(e2.div(max(open, 0.04)).sub(vec2(-0.1, 0.12))).div(0.1));
        const eyeLight = u.wingRoot.mul(iris.mul(3.2))
            .add(u.wingMid.mul(ring.mul(2.0)))
            .add(u.wingEdge.mul(lash.mul(2.4)))
            .add(vec3(1.0, 0.97, 0.9).mul(glint.mul(4.5)))
            .mul(open);
        const eyeArea = float(1.0).sub(smoothstep(0.9, 1.05, ed)).mul(open);

        // ── The scales: a dusting over the veil, and a glitter where they catch the light ──
        const dust = fine.r.mul(0.7).add(grain.g.mul(0.3));
        const sparkle = float(0.0).toVar();
        if (detail >= 1) {
            // One scale to a cell of the wing, round, each winking to its own count.
            const grid = vec2(an.mul(mix(float(96.0), float(110.0), kind)), v.mul(190.0)).toVar();
            const h = vcHash21(floor(grid).add(vec2(0.5, 13.7)));
            const round = vcBell(length(fract(grid).sub(0.5)).div(0.46));
            const wink = sin(u.time.mul(h.mul(5.0).add(2.0)).add(h.mul(97.0))).mul(0.5).add(0.5);
            sparkle.assign(step(0.955, h).mul(round).mul(wink.mul(wink)).mul(margin.mul(1.5).add(band1).add(0.5)));
        }

        // ── All of it, inside the front ──
        const gain = u.power.mul(0.5).add(u.eyes.z.mul(0.8)).add(u.wing.w.mul(0.9)).add(0.85);
        const veil = dust.mul(0.3).add(0.1).add(margin.mul(0.22));
        const lines = veins.mul(1.25).add(net).add(band1.mul(1.1)).add(band2.mul(1.5))
            .add(rim.mul(2.0))
            .add(sparkle.mul(3.0));
        const light = tint.mul(veil.add(lines.mul(float(1.0).sub(eyeArea.mul(0.8))))).add(eyeLight).mul(lit).mul(gain)
            .toVar();
        // The front burns gold-white as it writes, and warms the wing just behind it.
        const hot = mix(u.wingRoot, vec3(1.0, 0.95, 0.85), 0.6);
        light.addAssign(hot.mul(frontLine.mul(u.wing.w.mul(3.0).add(2.6)).add(frontGlow.mul(0.35))));
        const alpha = float(0.14).add(dust.mul(0.1)).add(veins.mul(0.14)).add(margin.mul(0.08))
            .add(pupil.mul(open).mul(0.9))
            .mul(lit)
            .toVar();
        // A pupil is dark: it takes the light out of what it covers.
        light.mulAssign(float(1.0).sub(pupil.mul(open).mul(0.95)));

        // ── The fall: the wings burn away from the margin inward ──
        const hold = grain.b.mul(0.3).add(fine.b.mul(0.3)).add(float(1.0).sub(v).mul(0.4)).add(0.1);
        const edge = fall.mul(1.25);
        const keep = smoothstep(edge.sub(0.05), edge.add(0.02), hold).toVar();
        const ember = vcBell(hold.sub(edge).div(0.035)).mul(step(0.001, fall)).mul(lit);
        light.assign(light.mul(keep).add(hot.mul(ember).mul(2.4)));
        alpha.mulAssign(keep);

        return vec4(light.mul(u.breath), clamp(alpha, 0.0, 0.9));
    });

    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = shade();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return vcPart('VesperChrysalisWings', geometry, material, 64, { mesh });
}
