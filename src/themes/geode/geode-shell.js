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
 * burning white-gold, and heals.
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
    min,
    mix,
    mod,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    step,
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
    FRACTURE_HEAL,
    FRACTURE_TRAVEL,
    GEODEFIRE,
    MINERALS,
    TAU,
    gdBandRamp,
    gdBell,
    gdClearLight,
    gdGlitter,
    gdHash21,
    gdLuma,
    gdMineral,
    gdPart,
    gdPulseLight,
    gdSpectrum,
    gdStrikeLight,
    wallNormal,
} from './geode-tsl.js';

const RINGS = 132;
const SPOKES = 176;
/** Cells of the fracture network round the axis and per radian along the wall. */
const CRACK_ROUND = 22;
const CRACK_ALONG = 5.4;

function buildGeometry(plan) {
    const cols = SPOKES + 1;
    const count = (RINGS + 1) * cols;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const coords = new Float32Array(count * 2);
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const c = [0, 0, 0];
    const d = [0, 0, 0];
    const n = [0, 0, 0];
    const eps = 0.012;
    for (let i = 0; i <= RINGS; i++) {
        const w = Math.max(1e-3, (i / RINGS) * CAVITY.wMax);
        for (let j = 0; j <= SPOKES; j++) {
            const phi = (j / SPOKES) * TAU;
            const o = i * cols + j;
            plan.surface(w, phi, a);
            positions.set(a, o * 3);
            coords.set([w, phi], o * 2);
            // The lumpy surface's own normal, from its two tangents, turned into the cavity.
            plan.surface(w + eps, phi, a);
            plan.surface(Math.max(1e-3, w - eps), phi, b);
            plan.surface(w, phi + eps, c);
            plan.surface(w, phi - eps, d);
            const tw = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
            const tp = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
            let nx = tw[1] * tp[2] - tw[2] * tp[1];
            let ny = tw[2] * tp[0] - tw[0] * tp[2];
            let nz = tw[0] * tp[1] - tw[1] * tp[0];
            wallNormal(w, phi, n);
            const len = Math.hypot(nx, ny, nz);
            if (len < 1e-7) {
                [nx, ny, nz] = n;
            } else {
                const s = (nx * n[0] + ny * n[1] + nz * n[2] < 0 ? -1 : 1) / len;
                nx *= s;
                ny *= s;
                nz *= s;
            }
            normals.set([nx, ny, nz], o * 3);
        }
    }
    const index = [];
    for (let i = 0; i < RINGS; i++) {
        for (let j = 0; j < SPOKES; j++) {
            const p0 = i * cols + j;
            const p1 = p0 + 1;
            const p2 = p0 + cols;
            const p3 = p2 + 1;
            index.push(p0, p2, p1, p1, p2, p3);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('aWall', new THREE.BufferAttribute(coords, 2));
    geometry.setIndex(index);
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

        // ── Gameplay light on this ring of the wall (the loops rest when nothing is live) ──
        const pulse = vec3(0.0).toVar();
        const strike = vec3(0.0).toVar();
        const clear = vec4(0.0).toVar();
        If(u.live.x.greaterThan(0.5), () => {
            pulse.assign(gdPulseLight(u, w));
        });
        If(u.live.y.greaterThan(0.5), () => {
            strike.assign(gdStrikeLight(u, p));
        });
        If(u.live.z.greaterThan(0.5), () => {
            clear.assign(gdClearLight(u, w));
        });

        // ── The agate ──
        const fort = abs(fract(turn.mul(7.0).add(nA.g.mul(0.8)).add(u.twist)).sub(0.5)).mul(2.0);
        const q = w.add(nA.r.sub(0.5).mul(0.24))
            .add(fort.sub(0.5).mul(0.07).mul(nA.a.add(0.3)))
            .add(nB.r.sub(0.5).mul(0.035))
            // The bands creep outward, as if the agate were still being laid down.
            .sub(u.drift.mul(0.0011))
            .toVar();
        const ramp = gdBandRamp(u, q.mul(2.6).add(nA.a.mul(0.35))).toVar();
        const fine = sin(q.mul(86.0).add(nB.g.mul(5.0))).mul(0.5).add(0.5).toVar();
        const seam = gdBell(fract(q.mul(11.0)).sub(0.5).mul(7.0));
        const deep = max(w.sub(CAVITY.wHeart), 0.0).div(CAVITY.wBands + 0.35 - CAVITY.wHeart);
        const through = exp(deep.mul(-1.7)).mul(fine.mul(0.5).add(0.6)).mul(charge);
        const lit = mix(u.heart, vec3(1.0), 0.35);
        const agate = ramp.mul(lit).mul(through).mul(1.05)
            .add(mix(u.heart, vec3(1.0), 0.6).mul(seam).mul(through).mul(0.4))
            .toVar();
        // A ring passing through lights the bands it crosses; a clear leaves them glowing.
        agate.addAssign(pulse.mul(fine.mul(0.9).add(0.5)).mul(1.3));
        agate.addAssign(clear.rgb.mul(fine.add(0.6)).mul(1.2));
        agate.addAssign(ramp.mul(clear.a).mul(0.1));

        // ── The heart's window ──
        const hk = clamp(w.div(CAVITY.wHeart), 0.0, 1.0);
        const sugar = smoothstep(0.5, 0.9, nB.a).mul(0.6).add(1.0);
        const core = mix(u.heart, vec3(1.0), 0.4).mul(exp(hk.mul(hk).mul(-2.2)).mul(2.6).add(0.35))
            .mul(sugar).mul(charge);
        const pane = smoothstep(CAVITY.wHeart * 0.6, CAVITY.wHeart * 1.15, w.add(nA.g.sub(0.5).mul(0.08)));
        const inner = mix(core, agate, pane);

        // ── The lining ──
        const edge = float(CAVITY.wBands).add(nA.r.sub(0.5).mul(BAND_EDGE_WANDER));
        const lining = smoothstep(edge.sub(0.035), edge.add(0.03), w);
        const zone = fract(nA.b.mul(1.7).add(0.1)).mul(MINERALS);
        const gem = mix(u.druzy, gdMineral(u, zone), 0.55).toVar();
        const ndl = max(dot(N, Lh), 0.0);
        const facing = max(dot(N, toCam), 0.0);
        const rock = u.rock.mul(nB.b.mul(1.4).add(0.5))
            .mul(u.heart.mul(ndl.mul(2.2)).add(u.fill.mul(facing.mul(0.5).add(0.12))))
            .add(gem.mul(0.035).mul(nB.a.add(0.4)));
        const H1 = normalize(Lh.add(toCam)).toVar();
        const grain = length(fwidth(p));
        const level = log2(max(grain.mul(11.0 / 0.36), 1.0)).toVar();
        const l0 = floor(level);
        const cell = exp2(l0).mul(0.36).toVar();
        const gA = gdGlitter(p, cell, N, H1, toCam, u.time).toVar();
        const sparkle = mix(gem, gdSpectrum(gA.y), 0.45).mul(gA.x).toVar();
        if (glitter) {
            const blend = level.sub(l0);
            const gB = gdGlitter(p, cell.mul(2.0), N, H1, toCam, u.time).toVar();
            sparkle.assign(mix(sparkle, mix(gem, gdSpectrum(gB.y), 0.45).mul(gB.x), blend));
        }
        // The glints crowd at the agate's rim, and every passing wave wakes them.
        const rim = exp(max(w.sub(edge), 0.0).mul(-7.0)).mul(1.6).add(1.0);
        const wake = gdLuma(pulse).mul(9.0).add(gdLuma(clear.rgb).mul(8.0)).add(clear.a.mul(0.3))
            .add(gdLuma(strike).mul(9.0))
            .add(u.power.mul(0.6))
            .add(u.surge.mul(1.0))
            .add(1.0);
        const druzy = rock.add(mix(sparkle, vec3(gdLuma(sparkle)), 0.2).mul(rim).mul(wake).mul(3.4)).toVar();
        druzy.addAssign(pulse.mul(gem.add(0.15)).mul(0.3));
        druzy.addAssign(strike.mul(gem.add(0.2)).mul(0.4));
        druzy.addAssign(clear.rgb.mul(gem.add(0.2)).mul(0.3));

        const col = mix(inner, druzy, lining).mul(u.breath).toVar();

        // ── The crown's rings: a seam of light where each ring of the chain has grown ──
        for (let k = 0; k < CROWN_RINGS; k++) {
            const c = CROWN_COLORS[k];
            const at = CROWN_W0 + ((CROWN_W1 - CROWN_W0) * k) / (CROWN_RINGS - 1);
            const grown = clamp(u.crown.sub(k), 0.0, 1.0);
            const seamLine = gdBell(w.sub(at).add(nB.r.sub(0.5).mul(0.03)).div(0.05));
            col.addAssign(vec3(c[0], c[1], c[2]).mul(seamLine.mul(grown)).mul(nB.g.mul(0.8).add(0.5)).mul(u.breath)
                .mul(0.55));
        }

        // ── The fracture ──
        if (fracture) {
            If(u.live.w.greaterThan(0.5), () => {
                const age = u.time.sub(u.shock.x);
                const reached = age.div(FRACTURE_TRAVEL).mul(CAVITY.wMax);
                // Voronoi borders over the wall: F2 − F1 is small along them.
                const g = vec2(turn.mul(CRACK_ROUND), w.mul(CRACK_ALONG));
                const id = floor(g);
                const f = fract(g);
                const f1 = float(8.0).toVar();
                const f2 = float(8.0).toVar();
                for (let j = -1; j <= 1; j++) {
                    for (let i = -1; i <= 1; i++) {
                        const o = vec2(i, j);
                        const key = vec2(mod(id.x.add(i).add(CRACK_ROUND), CRACK_ROUND), id.y.add(j));
                        const site = vec2(gdHash21(key), gdHash21(key.add(vec2(31.7, 12.3)))).mul(0.8).add(0.1);
                        const dist = length(o.add(site).sub(f));
                        f2.assign(min(f2, max(f1, dist)));
                        f1.assign(min(f1, dist));
                    }
                }
                const gap = f2.sub(f1);
                const crack = float(1.0).sub(smoothstep(0.008, 0.045, gap));
                const halo = exp(gap.mul(-14.0)).mul(0.1);
                const since = max(age.sub(w.div(CAVITY.wMax).mul(FRACTURE_TRAVEL)), 0.0);
                const open = step(w, reached).mul(exp(since.div(-FRACTURE_HEAL * 0.4)));
                const head = gdBell(w.sub(reached).div(0.16));
                const fire = vec3(GEODEFIRE[0], GEODEFIRE[1], GEODEFIRE[2]);
                col.addAssign(fire.mul(crack.add(halo)).mul(open).mul(u.shock.y).mul(lining.mul(0.85).add(0.15))
                    .mul(3.6));
                col.addAssign(mix(fire, gem, 0.3).mul(head).mul(u.shock.y).mul(0.7));
            });
        }
        return col;
    })();

    // Drawn after the stones that stand on it: it is shaded only where it shows between them.
    return gdPart('GeodeShell', geometry, material, -30);
}
