/**
 * Star Cradle (Nebula Flow) — the aura: the shapes the big moments throw round a star.
 *
 * A clear's answer is a front of light (a ring from the cluster) and blades out of the card; the
 * bigger moments each get a SHAPE of their own here, so no two read as "another ring":
 *
 *   lobes     four lines: the great star blows an hourglass of glowing gas along its axis, two
 *             limb-bright lobes pinched at the star with a thin skirt across the waist, torn into
 *             filaments, opening over a couple of seconds and thinning out
 *   pinwheel  a T-spin: a pinwheel of hot dust unwinds from the star its piece kindled, one arm
 *             (two when the twist clears lines) wound as an Archimedean spiral, beaded with knots
 *             of dust, turning as it grows
 *   shells    back-to-back: nested shells of dust round the star of the moment, rounded squares,
 *             one more for every back-to-back in a row, the newest innermost, creeping outward
 *   nova      the nursery's own: a far star in the cavity swells to a blaze with long spikes and
 *             fades over most of a minute
 *
 * One instanced quad per slot, sized by its kind and age and zero-sized while dead, so the sheet
 * costs nothing at rest. Every slot is closed-form state against the clock (rows written once, at
 * the event), so a seek redraws any moment.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    attribute,
    clamp,
    cos,
    exp,
    float,
    fract,
    int,
    length,
    max,
    mix,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    texture,
    uniformArray,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import { TAU } from './nebula-flow-core.js';
import {
    nfClip, nfGauss, nfLightMaterial, nfPart, nfQuadGeometry,
} from './nebula-flow-tsl.js';
import { spikes } from './nebula-flow-stars.js';

export const AURA_SLOTS = 6;
/** vec4 rows per slot: (x, y, born, kind) + (r, g, b, power) + (size, angle, a, b). */
export const AURA_ROWS = 3;

export const AURA_LOBES = 1;
export const AURA_PINWHEEL = 2;
export const AURA_SHELLS = 3;
export const AURA_NOVA = 4;

/** Seconds each kind lives (index = kind). */
export const AURA_LIFE = Object.freeze([0, 13, 8, 11, 48]);

/** The most nested shells a back-to-back streak shows. */
export const SHELLS_MAX = 5;

/** A kind's life (twin of the shader's select chain). */
export const auraLife = (kind) => AURA_LIFE[Math.max(0, Math.min(AURA_LIFE.length - 1, Math.round(kind)))] || 0;

const easeOut = (k) => float(1).sub(pow(float(1).sub(clamp(k, 0, 1)), 3.0));

/**
 * @param {object} u the world's uniforms
 * @param {THREE.Texture} noiseTex the nursery's baked noise (tatters and beads)
 */
export function createAura(u, noiseTex) {
    const table = Array.from({ length: AURA_SLOTS * AURA_ROWS }, () => new THREE.Vector4(0, -10, -1e5, 0));
    const rows = uniformArray(table, 'vec4');
    const slot = new Float32Array(AURA_SLOTS);
    for (let i = 0; i < AURA_SLOTS; i += 1) slot[i] = i;
    const geometry = nfQuadGeometry(AURA_SLOTS, { aSlot: { array: slot, size: 1 } });
    const material = nfLightMaterial();
    const base = int(attribute('aSlot', 'float').add(0.5)).mul(AURA_ROWS);

    /** The slot's numbers, pinned at the root of whichever stage reads them. */
    const read = () => {
        const A = rows.element(base);
        const C = rows.element(base.add(1));
        const E = rows.element(base.add(2));
        const kind = A.w.toVar();
        const age = u.time.sub(A.z).toVar();
        const is = (k) => kind.greaterThan(k - 0.5).and(kind.lessThan(k + 0.5));
        const life = is(AURA_LOBES).select(AURA_LIFE[AURA_LOBES], is(AURA_PINWHEEL).select(
            AURA_LIFE[AURA_PINWHEEL],
            is(AURA_SHELLS).select(AURA_LIFE[AURA_SHELLS], is(AURA_NOVA).select(AURA_LIFE[AURA_NOVA], 0)),
        ));
        const live = age.greaterThan(0).and(age.lessThan(life)).and(C.w.greaterThan(0.001)).select(1, 0)
            .toVar();
        return {
            A, C, E, kind, age, life, live, is,
        };
    };

    material.vertexNode = Fn(() => {
        const {
            A, E, live, is,
        } = read();
        // a far star stands at the far stars' parallax; the rest at the dust's (the nursery pass
        // shows the dust at its place − cam)
        const depth = is(AURA_NOVA).select(0.35, 1.0);
        const centre = A.xy.sub(u.cam.mul(depth));
        return nfClip(u, centre.add(positionGeometry.xy.mul(E.x.mul(live))));
    })();
    material.colorNode = vec4(0, 0, 0, 1);
    material.outputNode = Fn(() => {
        const {
            C, E, age, life, live, is,
        } = read();
        const q = positionGeometry.xy.toVar();
        const angle = E.y.toVar();
        const power = C.w.mul(live).toVar();
        const tint = C.rgb.toVar();
        const seed = E.w.toVar();
        const rgb = vec3(0).toVar();
        // the quad's own edge: everything is windowed to nothing before it
        const r = length(q).toVar();
        const edge = float(1).sub(smoothstep(0.86, 1.0, r)).toVar();
        const fadeOut = float(1).sub(smoothstep(life.mul(0.45), life, age)).toVar();
        const ca = cos(angle);
        const sa = sin(angle);
        // the slot's own frame: along its axis and across it
        const along = q.x.mul(ca).add(q.y.mul(sa)).toVar();
        const across = q.y.mul(ca).sub(q.x.mul(sa)).toVar();

        If(is(AURA_LOBES), () => {
            // Two lobes pinched at the star: ellipses whose near ends touch it, FILLED with mottled
            // gas (a lobe is a heap of lit cloud, not a glass outline) whose caps glow brightest,
            // the rim only a little brighter and torn into filaments by a read in the lobe's own
            // polar frame; a thin skirt of gas across the waist.
            const grow = easeOut(age.div(2.6));
            const L = grow.mul(0.46).add(0.02);
            const rx = grow.mul(0.44).add(0.02);
            const ry = grow.mul(0.3).add(0.015);
            const e = vec2(abs(along).sub(L).div(rx), across.div(ry));
            const rho = length(e).toVar();
            const theta = atan(e.y, e.x).div(TAU);
            const tear = texture(noiseTex, vec2(theta.mul(3.0), rho.mul(0.9).sub(age.mul(0.05))).add(seed.mul(7.1)))
                .level(1).a;
            const mottle = texture(noiseTex, vec2(along, across).mul(1.1).add(seed.mul(3.7)).add(age.mul(0.01)))
                .level(0).r;
            const inside = smoothstep(1.08, 0.55, rho);
            const skin = nfGauss(rho.sub(0.95).div(0.16)).mul(tear.mul(tear).mul(1.4).add(0.08));
            // the caps, out along the axis, catch the most light
            const cap = smoothstep(0.1, 0.95, abs(along).div(L.mul(2.0).add(0.01)));
            const fill = inside.mul(mottle.mul(mottle).mul(0.75).add(0.08)).mul(cap.mul(0.7).add(0.3));
            const skirt = nfGauss(along.div(0.022)).mul(nfGauss(across.div(grow.mul(0.42).add(0.01))))
                .mul(tear.mul(0.8).add(0.3)).mul(0.45);
            const core = nfGauss(r.div(0.05)).mul(0.6);
            // hot near the star, the moment's own colour out in the lobes, deeper where the gas
            // is thin
            const lobeRgb = mix(tint.mul(tint).mul(0.8), tint, mottle)
                .add(vec3(1.0, 0.94, 0.86).mul(nfGauss(r.div(0.3)).mul(0.5)));
            rgb.assign(lobeRgb.mul(skin.mul(0.6).add(fill)).add(mix(tint, vec3(1), 0.5).mul(skirt.add(core)))
                .mul(fadeOut).mul(smoothstep(0.0, 0.25, age)));
        });
        If(is(AURA_PINWHEEL), () => {
            // An Archimedean spiral of dust: one arm (two for a twist that clears lines), its turns
            // a pitch apart, measured as a line of one width round the nearest turn; it turns as it
            // grows, unwinds out to where its dust has reached, and is beaded with knots.
            const arms = E.z.max(1);
            const pitch = float(0.3);
            const spin = age.mul(2.4).add(seed.mul(TAU));
            const phi = atan(q.y, q.x);
            const wind = r.div(pitch).sub(phi.add(spin).div(TAU).mul(arms)).toVar();
            const off = fract(wind.add(0.5)).sub(0.5).mul(pitch);
            const reach = easeOut(age.div(3.2)).mul(0.88).add(0.05);
            const line = nfGauss(off.div(r.mul(0.06).add(0.012)));
            // dust in clumps along the arm, and a faint haze of it either side
            const bead = texture(noiseTex, vec2(wind.mul(0.37).add(seed), phi.div(TAU).mul(6.0))).level(0).g;
            const haze = nfGauss(off.div(r.mul(0.16).add(0.03))).mul(0.12);
            const dust = line.mul(bead.mul(bead).mul(2.2).add(0.12)).add(haze)
                .mul(smoothstep(reach, reach.mul(0.7), r)).mul(smoothstep(0.02, 0.09, r))
                .mul(float(1).sub(r.mul(0.6)));
            const hub = nfGauss(r.div(0.045)).mul(1.4);
            const hot = mix(tint, vec3(1.0, 0.55, 0.22), 0.45);
            rgb.assign(hot.mul(dust).add(mix(tint, vec3(1), 0.6).mul(hub)).mul(fadeOut).mul(smoothstep(0.0, 0.2, age)));
        });
        If(is(AURA_SHELLS), () => {
            // Nested shells of dust round the star: rounded squares (|x|³ + |y|³ = R³) turned with
            // the slot, the newest innermost, each creeping outward; brighter where the axis runs
            // through them, torn by the noise.
            const ax = abs(along);
            const ay = abs(across);
            const rho = pow(ax.mul(ax).mul(ax).add(ay.mul(ay).mul(ay)), 1.0 / 3.0).toVar();
            const count = clamp(E.z, 1, 5);
            const tear = texture(noiseTex, vec2(atan(across, along).div(TAU).mul(4.0), rho.mul(1.6)).add(seed.mul(5.3)))
                .level(1).r;
            const lit = ax.div(max(rho, 1e-3)).mul(0.55).add(0.45);
            const shells = float(0).toVar();
            for (let i = 0; i < 5; i += 1) {
                const R = float(0.13 + i * 0.13).add(age.mul(0.04)).add(easeOut(age.div(1.2)).mul(0.04));
                const w = 0.018 + i * 0.006;
                const ring = nfGauss(rho.sub(R).div(w)).mul(1 - i * 0.13);
                shells.addAssign(ring.mul(count.greaterThan(i + 0.5).select(1, 0)));
            }
            const dust = shells.mul(tear.mul(1.5).add(0.15)).mul(lit).mul(edge);
            const hub = nfGauss(r.div(0.04)).mul(1.1);
            // the shells are cooler dust than the star's own light: deep red-brown
            const warm = mix(tint, vec3(1.0, 0.3, 0.13), 0.65);
            rgb.assign(warm.mul(dust).add(mix(tint, vec3(1), 0.6).mul(hub))
                .mul(fadeOut).mul(smoothstep(0.0, 0.35, age)));
        });
        If(is(AURA_NOVA), () => {
            // A far star swells over a couple of seconds to a blaze with the telescope's spikes,
            // then fades over most of a minute (its spikes shorten as it fades).
            const swell = smoothstep(0.0, 2.2, age).mul(exp(age.sub(2.2).max(0).div(11.0).negate()));
            const reachK = swell.mul(0.7).add(0.3);
            const { core, halo, rays } = spikes(q.div(reachK), float(320.0));
            const white = core.mul(1.8).add(halo.mul(1.2)).add(rays.mul(1.3));
            rgb.assign(mix(tint, vec3(1), core.mul(0.6)).mul(white).mul(swell).mul(3.0));
        });
        return vec4(rgb.mul(power).mul(edge).mul(u.iris).mul(float(1).sub(u.hush.mul(0.6))), 0);
    })();

    const part = nfPart('aura', geometry, material, 13);

    /**
     * Light a slot: a dead one, else the one with least life left. `size` is the quad's half-side
     * (nursery units), `angle` its axis, `a` and `b` the kind's own numbers.
     */
    part.fire = (time, kind, {
        x, y, rgb = [1, 1, 1], power = 1, size = 0.4, angle = 0, a = 1, b = 0,
    }) => {
        let best = 0;
        let least = Infinity;
        for (let k = 0; k < AURA_SLOTS; k += 1) {
            const A = table[k * AURA_ROWS];
            const left = A.z + auraLife(A.w) - time;
            const score = !(table[k * AURA_ROWS + 1].w > 0) || left <= 0 ? -Infinity : left;
            if (score < least) {
                least = score;
                best = k;
            }
        }
        table[best * AURA_ROWS].set(x, y, time, kind);
        table[best * AURA_ROWS + 1].set(rgb[0], rgb[1], rgb[2], power);
        table[best * AURA_ROWS + 2].set(size, angle, a, b);
        return best;
    };
    /** The slots alive at `time` (diagnostics and tests): [{ kind, born, x, y, a }]. */
    part.live = (time) => {
        const out = [];
        for (let k = 0; k < AURA_SLOTS; k += 1) {
            const A = table[k * AURA_ROWS];
            const age = time - A.z;
            if (table[k * AURA_ROWS + 1].w > 0 && age >= 0 && age < auraLife(A.w)) {
                out.push({
                    kind: A.w, born: A.z, x: A.x, y: A.y, a: table[k * AURA_ROWS + 2].z,
                });
            }
        }
        return out;
    };
    part.reset = () => {
        for (let k = 0; k < AURA_SLOTS; k += 1) {
            table[k * AURA_ROWS].set(0, -10, -1e5, 0);
            table[k * AURA_ROWS + 1].set(0, 0, 0, 0);
            table[k * AURA_ROWS + 2].set(0, 0, 0, 0);
        }
    };
    part.table = table;
    return part;
}
