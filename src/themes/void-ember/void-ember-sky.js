/**
 * Void Ember — the void.
 *
 * One dome, shaded per view direction and drawn last among the solids so it costs only where
 * the sky shows. The void is deep, not empty:
 *
 *  - a band of far suns crosses it (the plane of the galaxy this star is dying in): points, not
 *    cloud, thick where the star clouds are and parted by dark rifts of dust. The band's line
 *    stands still in the frame; what is ON it goes slowly round (u.skyRot turns about the band's
 *    pole, a turn in SKY_TURN seconds), so the clouds, the rifts and the bright stars along it are
 *    never the same for long;
 *  - a cold, thin dust in the level's palette, torn into wisps, turning with the same sky;
 *  - a few bright stars with a lens's four rays, slowly variable;
 *  - the ember's own old breaths: thin broken shells of dust round the star (what it threw off
 *    long ago), warm where its light still reaches them and the void's colour further out,
 *    creeping outward for ever. A clear's wave lights each one as it passes: an echo.
 *
 * The dust near the ember is lit by it, a warm stain that spreads as the star is blown up, and a
 * clear's wave is seen crossing the dust as a ring of the wave's own colour.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    log,
    max,
    min,
    mix,
    normalize,
    positionWorld,
    select,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    NOVA_REMNANT, TAU, veHash33, vePart, veSolidMaterial, veWaveLight,
} from './void-ember-tsl.js';

/** Radius of the dome. */
export const SKY_RADIUS = 3000;

/**
 * The ember's old shells: how many, the innermost one's radius (star radii), the step from one to
 * the next (a ratio) and a shell's skin as a share of its radius.
 */
export const OLD_SHELLS = Object.freeze({
    count: 4, first: 1.85, step: 1.36, width: 0.03,
});

/** Seconds the shell four lines throw off is drawn for (its light falls to 1/e in NOVA_REMNANT). */
export const NOVA_SHELL_LIFE = NOVA_REMNANT * 2.4;

/**
 * @param {object} u  shared uniforms
 * @param {object} opts
 * @param {number} [opts.layers=3]     lattices of far stars
 * @param {boolean} [opts.dust=true]   the cold dust (two fetches)
 * @param {number} [opts.deep=2]       0 = the band and the shells from the dust's own reads;
 *                                     1 = + the bright stars; 2 = + the dust's fine grain, the
 *                                     shells' own tatters and layers and their creep outward (three
 *                                     fetches, and two more while a new shell is leaving)
 */
export function createSky(u, { layers = 3, dust = true, deep = 2 } = {}) {
    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 24, 16);
    const material = veSolidMaterial('VoidEmberSky');
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = true;

    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const pixel = length(fwidth(dir)).toVar();
        // The sky's own frame: y is the pole of the band of far suns, and the frame turns about it.
        const q = u.skyRot.mul(dir).toVar();
        // Round the band and off it, in turns: the dust's coordinates. Whole tiles go round, so
        // the texture has no seam where the longitude wraps (read at level 0: its derivative has).
        const sLat = clamp(q.y, -0.95, 0.95).toVar();
        const gs = vec2(atan(q.z, q.x), sLat.add(sLat.mul(sLat).mul(sLat).div(6.0))).div(TAU).toVar();
        // Angle from the ember, in its own apparent radii.
        const away = length(dir.sub(u.starDir)).div(u.starSize).toVar();
        // What is not lit by the ember (the void itself, its cold dust, the far stars) is
        // raised a little as the iris closes, so the sky does not go black behind a hot star; not
        // all the way back, so the void stays the dark the fire burns in.
        const keep = u.iris.pow(0.3).toVar();
        const col = u.voidCol.mul(dir.y.mul(0.25).add(1.0)).mul(keep).toVar();

        const density = float(0.0).toVar();
        const threads = float(0.0).toVar();
        /** Where the band of far suns is thick (0..1). */
        const band = float(0.0).toVar();
        /** Two fields that tear the old shells on the tiers without their own. */
        const tatter = vec2(0.5, 0.5).toVar();
        if (dust) {
            const c1 = u.fbmLod(gs.mul(2.0).add(vec2(0.13, 0.31)), 0.0).toVar();
            // The second read is carried by the first: wisps, not blots.
            const c2 = u.fbmLod(gs.mul(7.0).add(c1.rg.mul(0.42)).add(vec2(0.52, 0.07)), 0.0).toVar();
            density.assign(smoothstep(0.3, 0.9, c1.r.mul(0.6).add(c2.g.mul(0.4))));
            const thread = float(1.0).sub(abs(c2.a.mul(2.0).sub(1.0)));
            threads.assign(thread.mul(thread).mul(thread).mul(smoothstep(0.3, 0.72, c1.b)));
            const lanes = smoothstep(0.42, 0.74, c2.r.mul(0.6).add(c1.a.mul(0.4))).toVar();
            const cold = mix(u.dustA, u.dustB, smoothstep(0.3, 0.72, c1.g)).toVar();
            const veil = density.mul(density).mul(0.11).add(threads.mul(density).mul(0.12)).toVar();
            if (deep >= 2) {
                // Fine grain: the wisps' own filaments, sharp where the two broad reads are soft.
                const c3 = u.fbmLod(gs.mul(15.0).add(c2.rg.mul(0.2)), 0.0).toVar();
                const fibre = float(1.0).sub(abs(c3.r.mul(2.0).sub(1.0)));
                veil.mulAssign(fibre.mul(fibre).mul(fibre).mul(1.5).add(0.4));
                threads.mulAssign(c3.g.mul(1.1).add(0.45));
            }
            col.addAssign(cold.mul(veil).mul(float(1.0).sub(lanes.mul(0.85))).mul(keep));
            density.mulAssign(float(1.0).sub(lanes.mul(0.6)));

            // ── The band of far suns ──
            // Its middle wanders, its star clouds are the dust's broad read, and a dark rift runs
            // along it where the second read says so.
            const off = sLat.add(c1.b.sub(0.5).mul(0.11)).toVar();
            const profile = exp(off.mul(off).div(-0.021)).toVar();
            const clouds = smoothstep(0.22, 0.8, c1.r.mul(0.5).add(c2.g.mul(0.5)));
            const rift = smoothstep(0.46, 0.7, c2.b.mul(0.62).add(c1.a.mul(0.38)))
                .mul(exp(off.mul(off).div(-0.009)));
            band.assign(profile.mul(clouds.mul(0.7).add(0.3)).mul(float(1.0).sub(rift.mul(0.86))));
            // The suns too far to part: a faint warm light, never a fog.
            const glow = mix(u.starTint, vec3(1.0, 0.84, 0.66), 0.55);
            col.addAssign(glow.mul(band.mul(band).mul(0.045)).mul(keep));
            tatter.assign(vec2(c1.a, c2.b));
        }

        // ── The ember lights the dust round it ──
        const spread = away.mul(0.62);
        const reach = float(1.0).div(spread.mul(spread).add(1.0)).toVar();
        reach.mulAssign(reach.sqrt());
        const lit = density.mul(0.55).add(threads.mul(0.55)).add(0.05).toVar();
        col.addAssign(u.skyLight.mul(lit).mul(reach).mul(0.03));

        // ── The ember's old breaths: thin, broken shells of dust round it ──
        const shells = float(0.0).toVar();
        If(away.lessThan(8.5), () => {
            const creep = deep >= 2 ? fract(u.shellPhase) : float(0.0);
            const turn = deep >= 2 ? floor(u.shellPhase) : float(0.0);
            const torn = vec2(tatter).toVar();
            /** Layers within a shell: thin nested arcs, not one soft band. */
            const layered = float(1.0).toVar();
            if (deep >= 2) {
                // The shells' own tatters: a field of (the way round the star, how far out), so a
                // shell that creeps outward moves through it and its arcs slowly change.
                const round = dir.sub(u.starDir).div(max(away.mul(u.starSize), 1e-4));
                const rho = log(max(away, 1.0)).div(Math.log(OLD_SHELLS.step));
                torn.assign(u.noise3(vec3(round.xy.mul(1.7), rho.mul(0.9).add(4.1))));
                const fine = u.noise3(vec3(round.xy.mul(2.3), rho.mul(11.0)));
                layered.assign(smoothstep(0.3, 0.74, fine.x).mul(1.25).add(0.2).mul(fine.y.mul(0.5).add(0.75)));
            }
            for (let i = 0; i < OLD_SHELLS.count; i++) {
                const place = float(i).add(creep);
                const R = float(OLD_SHELLS.first).mul(float(OLD_SHELLS.step).pow(place)).toVar();
                const w = R.mul(OLD_SHELLS.width);
                // A thin shell seen through: bright where the eye runs along its skin, next to
                // nothing across its face, and no line at its edge.
                const inside = float(2.0).mul(R).mul(w)
                    .div(max(R.mul(R).sub(away.mul(away)), 0.0).add(R.mul(w).mul(2.0)));
                const outer = away.sub(R).div(w.mul(2.0));
                const skin = select(away.lessThan(R), inside.mul(inside).mul(inside), exp(outer.mul(outer).negate()));
                let mask;
                if (deep >= 2) {
                    // A shell keeps its own field as it moves up a place: the one of its number.
                    const own = float(i).sub(turn);
                    mask = mix(torn.x, torn.y, own.sub(floor(own.div(2.0)).mul(2.0)));
                } else {
                    mask = [torn.x, torn.y, float(1.0).sub(torn.x), float(1.0).sub(torn.y)][i];
                }
                // The first fades in as it leaves the star's glare, the last out as it thins.
                const stand = smoothstep(-0.2, 0.8, place)
                    .mul(float(1.0).sub(smoothstep(OLD_SHELLS.count - 1.1, OLD_SHELLS.count - 0.05, place)));
                shells.addAssign(skin.mul(smoothstep(0.34, 0.7, mask)).mul(stand).mul(layered));
            }
            // Warm where the ember's light still reaches, the void's own colour further out.
            const far = float(1.0).div(away.mul(0.4).mul(away.mul(0.4)).add(1.0));
            const cold = mix(u.dustA, u.dustB, 0.5).mul(keep);
            col.addAssign(u.skyLight.mul(far).mul(0.24).add(cold.mul(0.26))
                .mul(shells.mul(threads.mul(1.1).add(0.5))));
        });

        // ── The newest breath: the shell four lines throw off, thinning as it widens ──
        If(u.novaShell.y.greaterThan(0.001), () => {
            const tau = u.time.sub(u.novaShell.x).toVar();
            If(tau.greaterThan(0.0).and(tau.lessThan(NOVA_SHELL_LIFE)).and(away.lessThan(6.5)), () => {
                // It leaves fast and then hardly widens: it comes to rest among the old ones.
                const R = float(1.0).sub(exp(tau.mul(-0.32))).mul(2.3).add(1.45)
                    .toVar();
                const w = R.mul(0.022);
                const inside = float(2.0).mul(R).mul(w)
                    .div(max(R.mul(R).sub(away.mul(away)), 0.0).add(R.mul(w).mul(2.0)));
                const outer = away.sub(R).div(w.mul(1.3));
                const skin = select(away.lessThan(R), inside.mul(inside).mul(inside), exp(outer.mul(outer).negate()));
                const torn = vec2(tatter).toVar();
                const layers2 = float(1.0).toVar();
                if (deep >= 2) {
                    const round = dir.sub(u.starDir).div(max(away.mul(u.starSize), 1e-4));
                    torn.assign(u.noise3(vec3(round.xy.mul(2.3), u.novaShell.z.add(11.0))));
                    const fine = u.noise3(vec3(round.xy.mul(3.1), away.mul(7.0).sub(tau.mul(0.35))));
                    layers2.assign(smoothstep(0.4, 0.7, fine.x).mul(1.5).add(0.05).mul(fine.y.mul(0.6).add(0.7)));
                }
                const fade = smoothstep(0.0, 0.9, tau).mul(exp(tau.div(-NOVA_REMNANT)))
                    .mul(float(1.0).sub(smoothstep(NOVA_SHELL_LIFE - 6.0, NOVA_SHELL_LIFE, tau)));
                const cooled = mix(u.novaColor, vec3(0.9, 0.1, 0.07), smoothstep(1.5, 11.0, tau).mul(0.8));
                const k = skin.mul(smoothstep(0.3, 0.62, torn.x).mul(0.85).add(0.15)).mul(layers2).mul(fade).mul(u.novaShell.y);
                col.addAssign(cooled.mul(k).mul(0.42).mul(u.iris.sqrt()));
                shells.addAssign(k.mul(0.5));
            });
        });

        // ── A clear's wave crossing the dust, and lighting each old shell as it passes ──
        If(u.wavesLive.greaterThan(0.5), () => {
            const wave = veWaveLight(u, away);
            col.addAssign(wave.rgb.mul(density.mul(0.5).add(threads.mul(0.6)).add(shells.mul(0.9)).add(0.04)).mul(0.4));
            col.addAssign(u.skyLight.mul(wave.w).mul(lit.add(shells.mul(0.5))).mul(reach).mul(0.012));
        });

        // ── Far stars: one per cell of a lattice the sphere of directions cuts through ──
        // Thick along the band, thin off it: the band is made of them.
        const crowd = band.mul(2.3).add(0.5).toVar();
        const starLayer = (scale, chance, size, gain) => {
            const p = q.mul(scale);
            const id = floor(p);
            const h = veHash33(id);
            const f = fract(p).sub(h.xyz.mul(0.6).add(0.2));
            const d = length(f.sub(q.mul(dot(f, q))));
            // Never smaller than a pixel: a sub-pixel star would shimmer as the sky turns.
            const r = max(float(size), pixel.mul(scale).mul(0.8));
            const core = exp(d.mul(d).div(r.mul(r)).mul(-3.0)).mul(float(size).div(r).mul(float(size).div(r)));
            const mag = h.z.mul(h.z).mul(h.z).mul(h.z).mul(0.94)
                .add(0.06);
            const twinkle = sin(u.time.mul(h.y.mul(2.6).add(0.7)).add(h.x.mul(40.0))).mul(0.2).add(0.8);
            // Most take the void's tint; some are old and warm, a few young and blue.
            const warm = mix(u.starTint, vec3(1.0, 0.8, 0.6), smoothstep(0.7, 1.0, h.y));
            const tint = mix(warm, vec3(0.72, 0.84, 1.0), float(1.0).sub(smoothstep(0.0, 0.16, h.y)));
            return tint.mul(core.mul(mag).mul(twinkle).mul(step(h.x, min(chance, 0.94))).mul(gain));
        };
        const LAYERS = [[52.0, 0.3, 0.03, 5.0], [140.0, 0.26, 0.028, 1.9], [310.0, 0.22, 0.026, 0.9]];
        let stars = vec3(0.0);
        for (let i = 0; i < Math.min(layers, LAYERS.length); i++) {
            const [scale, chance, size, gain] = LAYERS[i];
            stars = stars.add(starLayer(scale, crowd.mul(chance), size, gain));
        }
        // The band's own: far suns that stand only where it is thick, each a pixel of light.
        stars = stars.add(starLayer(205.0, band.mul(1.25), 0.026, 6.5));
        if (deep >= 1) {
            // A few bright ones: a hard point, a halo, and the four rays a lens gives a bright
            // point (along the frame's own axes, which the world hands over in the sky's frame).
            const scale = 8.0;
            const p = q.mul(scale);
            const h = veHash33(floor(p).add(vec3(17.0, 5.0, 31.0)));
            const f = fract(p).sub(h.xyz.mul(0.56).add(0.22));
            const perp = f.sub(q.mul(dot(f, q))).toVar();
            const d = length(perp);
            const r = max(float(0.009), pixel.mul(scale).mul(0.9));
            const point = exp(d.mul(d).div(r.mul(r)).mul(-3.0)).mul(float(0.009).div(r).mul(float(0.009).div(r)));
            const halo = float(1.0).div(d.div(0.024).mul(d.div(0.024)).add(1.0));
            const ax = abs(dot(perp, u.skyRight));
            const ay = abs(dot(perp, u.skyUp));
            const thin = r.mul(0.7);
            const rays = exp(ax.div(-0.034)).mul(exp(ay.mul(ay).div(thin.mul(thin)).negate()))
                .add(exp(ay.div(-0.034)).mul(exp(ax.mul(ax).div(thin.mul(thin)).negate())));
            const mag = h.z.mul(h.z).mul(0.85).add(0.15);
            // Slowly variable: each on its own period of a minute or so.
            const vary = sin(u.time.mul(h.x.mul(0.11).add(0.05)).add(h.y.mul(40.0))).mul(0.22).add(0.78);
            const warm = mix(u.starTint, vec3(1.0, 0.74, 0.5), smoothstep(0.62, 1.0, h.y));
            const tint = mix(warm, vec3(0.66, 0.8, 1.0), float(1.0).sub(smoothstep(0.0, 0.3, h.y)));
            stars = stars.add(tint.mul(point.mul(9.0).add(halo.mul(halo).mul(0.04)).add(rays.mul(0.2)))
                .mul(mag.mul(vary).mul(step(h.x, 0.42))));
        }
        // The ember's glare and the thick dust drown the faint ones.
        const glare = smoothstep(1.0, 3.4, away).mul(0.85).add(0.15);
        col.addAssign(stars.mul(glare).mul(float(1.0).sub(density.mul(0.55))).mul(keep));

        return vec4(col.mul(u.breath.mul(0.4).add(0.6)), 1.0);
    })();

    return vePart('VoidEmberSky', geometry, material, 5);
}
