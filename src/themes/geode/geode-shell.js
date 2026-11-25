/**
 * Geode — the wall of the cavity.
 *
 * One lumpy shell seen from inside, shaded in three zones by the wall coordinate w:
 *
 *   the heart   the far pole, where the wall is thin: a window of sugar-white crystal lit from
 *               behind, the source of every shaft of light in the cavity;
 *   the agate   concentric bands round the heart, lit through from behind and dimming outward:
 *               four band colours in turn, fine striping, pale seams, and the angular wander of
 *               a fortification agate. A lock's ring and a clear's fronts run out through them;
 *   the lining  past a ragged edge, dark matrix carrying glitter: one glint per cell of a
 *               world-space grid (two grid sizes blended by distance, so the grain holds its
 *               size on screen), each a facet that flashes when it mirrors the heart or the
 *               viewer's own light. Glints take the colour of the mineral zone they lie in, and
 *               every wave that passes wakes them.
 *
 * A four-line clear fractures the lining: a network of cracks opens outward from the heart,
 * burning white-gold, and heals (a second one opens over the first while it heals: two are drawn).
 * A fever holds the same network open: the cracks creep out from the heart as the fever fills,
 * light pulsing outward along them.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    attribute,
    cameraPosition,
    clamp,
    dot,
    exp,
    exp2,
    float,
    floor,
    fract,
    fwidth,
    length,
    log2,
    max,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BAND_EDGE_WANDER,
    CAVITY,
    CROWN_COLORS,
    CROWN_RINGS,
    CROWN_W0,
    CROWN_W1,
    GEODEFIRE,
    MINERALS,
    TAU,
    gdBandRamp,
    gdBell,
    gdClearLight,
    gdFracture,
    gdGlitter,
    gdLuma,
    gdMineral,
    gdPalette,
    gdPart,
    gdPulseLight,
    gdSheen,
    gdSpectrum,
    gdStrikeLight,
    gdSweep,
    gdThin,
    gdThinUV,
    gdVisit,
    gdWhirl,
} from './geode-tsl.js';
import { sessionShellArrays } from './geode-bakes.js';

/** The shell's mesh over its arrays (geode-bake-data.js's shellArrays, kept for the session). */
function buildGeometry(plan) {
    const {
        positions, normals, coords, index,
    } = sessionShellArrays(plan);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('aWall', new THREE.BufferAttribute(coords, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    return geometry;
}

/**
 * @param {object} u     shared geode uniforms
 * @param {object} plan  the geode's plan
 * @param {object} opts
 * @param {boolean} [opts.glitter=true]   two grain sizes blended (false = one)
 * @param {boolean} [opts.fracture=true]  the four-line clear's crack network
 */
export function createShell(u, plan, { glitter = true, fracture = true } = {}) {
    const geometry = buildGeometry(plan);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GeodeShell';
    material.fog = false;
    material.side = THREE.DoubleSide;
    const wall = attribute('aWall', 'vec2');

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const N = normalize(attribute('normal', 'vec3')).toVar();
        const toCam = normalize(cameraPosition.sub(p)).toVar();
        const w = wall.x.toVar();
        const turn = wall.y.div(TAU).toVar();
        const Lh = normalize(u.heartPos.sub(p)).toVar();
        const nA = u.noise(vec2(turn.mul(3.0), w.mul(0.9))).toVar();
        const nB = u.noise(vec2(turn.mul(11.0).add(0.21), w.mul(3.7))).toVar();
        const charge = u.power.mul(0.4).add(u.surge.mul(0.2)).add(1.0).toVar();
        // A level-up's front: the wall behind it is already the new mineral (gdSweep).
        const sweep = gdSweep(u, w).toVar();
        const pal = gdPalette(u, sweep.x);
        const fillLit = pal.fill.toVar();

        // ── Gameplay light on this ring of the wall (the loops rest when nothing is live) ──
        const pulse = vec3(0.0).toVar();
        const strike = vec3(0.0).toVar();
        const clear = vec4(0.0).toVar();
        const whirl = vec3(0.0).toVar();
        const visit = vec4(0.0).toVar();
        If(u.live.x.greaterThan(0.5), () => {
            pulse.assign(gdPulseLight(u, w));
        });
        If(u.live.y.greaterThan(0.5), () => {
            strike.assign(gdStrikeLight(u, p));
        });
        If(u.live.z.greaterThan(0.5), () => {
            clear.assign(gdClearLight(u, w));
        });
        // A twist's pinwheel, and what a visit lays over the wall.
        If(u.live2.x.greaterThan(0.5), () => {
            whirl.assign(gdWhirl(u, turn, w));
        });
        If(u.live2.z.greaterThan(0.5), () => {
            visit.assign(gdVisit(u, turn, w));
        });

        // ── The agate ──
        const fort = abs(fract(turn.mul(7.0).add(nA.g.mul(0.8)).add(u.twist)).sub(0.5)).mul(2.0);
        const q = w.add(nA.r.sub(0.5).mul(0.24))
            .add(fort.sub(0.5).mul(0.07).mul(nA.a.add(0.3)))
            .add(nB.r.sub(0.5).mul(0.035))
            // The bands creep outward, as if the agate were still being laid down.
            .sub(u.drift.mul(0.0011))
            .toVar();
        // (no two bands are one width: the band coordinate is laid down in fits and starts)
        const laid = q.add(sin(q.mul(7.0)).mul(0.035)).toVar();
        const ramp = gdBandRamp(pal, laid.mul(2.6).add(nA.a.mul(0.35))).toVar();
        const fine = sin(laid.mul(86.0).add(nB.g.mul(5.0))).mul(0.5).add(0.5).toVar();
        const seam = gdBell(fract(laid.mul(11.0)).sub(0.5).mul(7.0));
        // A hairline of white chalcedony here and there.
        const hair = gdBell(fract(laid.mul(4.3).add(0.2)).sub(0.5).mul(22.0)).mul(smoothstep(0.35, 0.7, nB.b));
        const deep = max(w.sub(CAVITY.wHeart), 0.0).div(CAVITY.wBands + 0.35 - CAVITY.wHeart);
        // (an air that carries the heart's light further lights the agate's outer bands too)
        const through = exp(deep.mul(float(-1.7).div(u.air.w))).mul(fine.mul(0.5).add(0.6)).mul(charge).toVar();
        const lit = mix(u.heart, vec3(1.0), 0.35);
        // (back-to-back clears wind the fortification tighter and set its bands blazing: heat.w)
        const agate = ramp.mul(lit).mul(through).mul(u.heat.w.mul(0.55).add(1.05))
            .add(mix(u.heart, vec3(1.0), 0.6).mul(seam.add(hair.mul(1.6))).mul(through).mul(u.heat.w.mul(0.5).add(0.4)))
            .toVar();
        // The agate is polished stone: it throws the viewer's own cool light back in a soft sheen
        // that slides over the bands as the view drifts.
        const facing = max(dot(N, toCam), 0.0).toVar();
        const fa2 = facing.mul(facing);
        const fa8 = fa2.mul(fa2).mul(fa2).mul(fa2);
        agate.addAssign(mix(fillLit, vec3(1.0), 0.5).mul(fa8.mul(fa8).mul(fa8)).mul(fine.mul(0.5).add(0.5)).mul(0.1));
        // A ring passing through lights the bands it crosses; a clear leaves them glowing.
        agate.addAssign(pulse.mul(fine.mul(0.9).add(0.5)).mul(1.3));
        agate.addAssign(clear.rgb.mul(fine.add(0.6)).mul(1.2));
        agate.addAssign(ramp.mul(clear.a).mul(0.1));
        // A twist's pinwheel shows through the bands; a visit's ring lights them as it crosses.
        agate.addAssign(whirl.mul(fine.mul(0.7).add(0.6)).mul(ramp.add(0.35)).mul(1.5));
        agate.addAssign(visit.rgb.mul(fine.add(0.5)).mul(1.4));

        // ── The heart's window ──
        // A window of sugar-white crystal with the light close behind it: white-hot where the
        // light stands (it wanders: u.heartPos), the heart's own colour round that, and the
        // window's fibres radiating from its middle like the rays of a chalcedony sun.
        const hk = clamp(w.div(CAVITY.wHeart), 0.0, 1.0);
        const off = length(p.xy.sub(u.heartPos.xy)).div(CAVITY.a * Math.sin(CAVITY.wHeart)).toVar();
        const fibre = u.noise(vec2(turn.mul(9.0), w.mul(0.7).add(0.13))).toVar();
        const rays = smoothstep(0.3, 0.75, fibre.r).mul(0.55).add(fibre.b.mul(0.5)).add(0.5);
        const sugar = smoothstep(0.5, 0.9, nB.a).mul(0.6).add(1.0);
        const hot = exp(off.mul(off).mul(-2.6));
        const core = mix(u.heart, vec3(1.0), hot.mul(0.55).add(0.12))
            .mul(hot.mul(2.9).add(exp(hk.mul(hk).mul(-1.6)).mul(0.5)).add(0.3))
            .mul(sugar).mul(rays)
            .mul(charge);
        const pane = smoothstep(CAVITY.wHeart * 0.6, CAVITY.wHeart * 1.15, w.add(nA.g.sub(0.5).mul(0.08)));
        const inner = mix(core, agate, pane);

        // ── The lining ──
        const edge = float(CAVITY.wBands).add(nA.r.sub(0.5).mul(BAND_EDGE_WANDER)).toVar();
        const lining = smoothstep(edge.sub(0.035), edge.add(0.03), w).toVar();
        const zone = fract(nA.b.mul(1.7).add(0.1)).mul(MINERALS);
        const gem = mix(pal.druzy, gdMineral(pal, zone), 0.55).toVar();
        const ndl = max(dot(N, Lh), 0.0);
        // Where the wall is thin, light from outside the stone comes through it: the matrix
        // between the points glows like an ember there, in the stone's colour warmed by the light.
        const thin = gdThin(u.noise(gdThinUV(u, turn, w))).mul(u.mood.x).toVar();
        // The moonstone sheen crossing the lining (an air: zero in the others).
        const sheen = gdSheen(u, turn, w).toVar();
        const rock = pal.rock.mul(nB.b.mul(1.4).add(0.5))
            .mul(u.heart.mul(ndl.mul(2.2)).add(fillLit.mul(facing.mul(0.5).add(0.12))))
            .add(gem.mul(0.035).mul(nB.a.add(0.4)))
            .add(mix(gem, u.heart, 0.45).mul(gem.add(0.3)).mul(thin).mul(nB.b.mul(0.9).add(0.2))
                .mul(0.4))
            .add(mix(fillLit, vec3(1.0), 0.35).mul(sheen).mul(nB.b.mul(0.6).add(0.25)).mul(0.3));
        const H1 = normalize(Lh.add(toCam)).toVar();
        const grain = length(fwidth(p));
        const level = log2(max(grain.mul(11.0 / 0.36), 1.0)).toVar();
        const l0 = floor(level);
        const cell = exp2(l0).mul(0.36).toVar();
        // (a perfect clear's opal fire turns every glint to a colour of the spectrum)
        const play = clamp(u.opal.mul(0.6).add(0.45), 0.0, 1.0).toVar();
        const gA = gdGlitter(p, cell, N, H1, toCam, u.time).toVar();
        const sparkle = mix(gem, gdSpectrum(gA.y), play).mul(gA.x).toVar();
        if (glitter) {
            const blend = level.sub(l0);
            const gB = gdGlitter(p, cell.mul(2.0), N, H1, toCam, u.time).toVar();
            sparkle.assign(mix(sparkle, mix(gem, gdSpectrum(gB.y), play).mul(gB.x), blend));
        }
        // The glints crowd at the agate's rim, and every passing wave wakes them.
        const rim = exp(max(w.sub(edge), 0.0).mul(-7.0)).mul(1.6).add(1.0);
        const wake = gdLuma(pulse).mul(9.0).add(gdLuma(clear.rgb).mul(8.0)).add(clear.a.mul(0.3))
            .add(gdLuma(strike).mul(9.0))
            .add(gdLuma(whirl).mul(7.0))
            .add(visit.a)
            .add(sheen.mul(1.6))
            .add(u.opal.mul(2.4))
            .add(u.power.mul(0.6))
            .add(u.surge.mul(1.0))
            // the lining glitters harder the hotter play runs
            .add(u.heat.x.mul(0.5))
            .add(u.heat.y.mul(0.9))
            .add(u.air.x);
        const druzy = rock.add(mix(sparkle, vec3(gdLuma(sparkle)), 0.2).mul(rim).mul(wake).mul(3.4)).toVar();
        druzy.addAssign(pulse.mul(gem.add(0.15)).mul(0.3));
        druzy.addAssign(strike.mul(gem.add(0.2)).mul(0.4));
        druzy.addAssign(clear.rgb.mul(gem.add(0.2)).mul(0.3));
        druzy.addAssign(whirl.mul(gem.add(0.3)).mul(0.45));
        druzy.addAssign(visit.rgb.mul(gem.add(0.3)).mul(0.6));

        const col = mix(inner, druzy, lining).toVar();
        // Between the agate and the amethyst a geode lays down a rind of clear quartz: a pale,
        // sugared band along the agate's ragged edge, brightest where the heart's light still
        // reaches it, glittering.
        const rind = gdBell(w.sub(edge.sub(0.05)).div(0.07));
        const rindLight = mix(u.heart, vec3(1.0), 0.6)
            .mul(exp(max(w.sub(CAVITY.wHeart), 0.0).mul(-1.3)))
            .mul(smoothstep(0.3, 0.8, nB.g).mul(0.7).add(0.35).add(gA.x.mul(6.0)));
        col.addAssign(rindLight.mul(rind).mul(charge).mul(0.5));
        // The front of a recrystallisation is a line of frost: the new mineral's first crystals.
        col.addAssign(mix(u.heart, vec3(1.0), 0.75).mul(gdBell(sweep.y.sub(0.05).div(0.09)).mul(u.sweep.y))
            .mul(nB.g.mul(0.9).add(0.5)).mul(0.8));
        col.mulAssign(u.breath);

        // ── The crown's rings: a seam of light where each ring of the chain has grown ──
        for (let k = 0; k < CROWN_RINGS; k++) {
            const c = CROWN_COLORS[k];
            const at = CROWN_W0 + ((CROWN_W1 - CROWN_W0) * k) / (CROWN_RINGS - 1);
            const grown = clamp(u.crown.sub(k), 0.0, 1.0);
            const seamLine = gdBell(w.sub(at).add(nB.r.sub(0.5).mul(0.03)).div(0.05));
            col.addAssign(vec3(c[0], c[1], c[2]).mul(seamLine.mul(grown)).mul(nB.g.mul(0.8).add(0.5)).mul(u.breath)
                .mul(0.55));
        }

        // ── The fracture (the newest, the one still healing under it, and a fever's veins): the
        // wall breaks into plates. Light burns white-gold in the cracks between them, and each
        // plate flares, in its own moment and its own strength, as the fracture's head reaches it. ──
        if (fracture) {
            const broken = gdFracture(u, turn, w).toVar();
            const crack = float(1.0).sub(smoothstep(0.01, 0.055, broken.x));
            const halo = exp(broken.x.mul(-9.0)).mul(0.2);
            const fire = vec3(GEODEFIRE[0], GEODEFIRE[1], GEODEFIRE[2]);
            col.addAssign(fire.mul(crack.add(halo)).mul(broken.y).mul(lining.mul(0.85).add(0.15)).mul(4.0));
            col.addAssign(mix(fire, gem, 0.4).mul(broken.z).mul(smoothstep(0.015, 0.2, broken.x).mul(0.7).add(0.3))
                .mul(0.9));
        }
        return col;
    })();

    // Drawn after the stones that stand on it: it is shaded only where it shows between them.
    return gdPart('GeodeShell', geometry, material, -30);
}
