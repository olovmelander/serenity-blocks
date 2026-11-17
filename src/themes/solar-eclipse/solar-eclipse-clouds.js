/**
 * Solar Eclipse — the clouds over the salt flat, drawn inside the dome's fragment function.
 *
 * The weather (core.js WEATHERS, the world's u.weather) decides which of four stand, and they are
 * composited back to front over the air:
 *
 *   towers      far cumulus standing beyond the moon's shadow along the horizon: in full sunlight
 *               while everything round the lens is dark, the side toward the sun burning, the lee
 *               side in the band's own light. Their heads run ahead of their feet and boil upward,
 *               so a tower grows, leans and falls apart as it goes.
 *   deck        an altocumulus sheet in rows, 4.6 km up: dark overhead (in the shadow), burning
 *               where it reaches out past the shadow's edge toward the horizon, so the edge of the
 *               shadow is drawn across the sky. Its fields drift slower than its cloudlets, so
 *               cloudlets form and melt.
 *   rows        three rows of long, low bars over the far shore, farthest first: dark bodies whose
 *               undersides the band of light lights from below and whose thin edges let it
 *               through; the farthest is beyond the shadow and burns.
 *   lenticular  a stack of smooth lenses standing over the volcano's summit, sunlit when the
 *               summit is.
 *
 * Every heap is lit with wide ramps round a mid value and drawn with soft edges (a narrow
 * threshold on fBm is a cut-out: gotcha #116), and no cloud ever crosses the black disc.
 */
import {
    If,
    abs,
    atan,
    clamp,
    cos,
    dot,
    exp,
    float,
    length,
    log2,
    max,
    mix,
    normalize,
    pow,
    smoothstep,
    vec2,
} from 'three/tsl';
import {
    CLOUDS, DECK, LENTICULAR, RANGES, TOWERS, UMBRA, cloudRowSpan,
} from './solar-eclipse-core.js';
import { noiseAt, seGauss } from './solar-eclipse-tsl.js';

const VOLCANO = RANGES.find((range) => range.cone).cone;

/**
 * @param {{ u: object, noise: THREE.Texture, tier: object }} env
 * @param {{ d, alt, az, side, plane, sky }} c  the look direction, its altitude and bearing, the
 *   shadow's side term, the point in the sun's plane, and the sky var the clouds are laid over
 */
export function drawClouds(env, c) {
    const { u, noise, tier } = env;
    const {
        d, alt, az, side, plane, sky, day,
    } = c;
    const clock = u.cloudClock;
    // Shared by every layer, so pinned before their branches.
    // The shadow ends nearest toward its bright side, and its reach breathes with the clock.
    const edgeKm = float(1.0).sub(side.mul(UMBRA.lean)).mul(u.shadowReach).toVar();
    // No cloud ever crosses the black sun: its disc stays the darkest thing in the sky.
    const clear = smoothstep(1.04, 1.4, length(plane.xy)).toVar();
    const airBehind = sky.toVar();
    const shade = u.ridge.mul(1.6).add(u.mid.mul(0.9)).add(u.horizon.mul(0.1)).toVar();
    const sunlit = u.alpen.mul(u.alpenPower).toVar();
    // The sun's bearing and altitude (it lights what stands beyond the shadow).
    const sunAz = atan(u.sunDir.x, u.sunDir.z.negate()).toVar();
    const sunAlt = u.sunDir.y.toVar();

    // ── The towers beyond the shadow ──
    // The uneclipsed sun stands behind them (beyond the shadow, up and toward the black sun's
    // bearing): their cores stand dark, the face that turns toward the sun burns, and their thin
    // edges glow with the light scattered forward through them, brightest near the sun's bearing.
    if (tier.towers) {
        If(u.weather.y.greaterThan(0.01).and(alt.greaterThan(-0.004)).and(alt.lessThan(TOWERS.top + 0.012)), () => {
            const { span } = TOWERS;
            const uu = az.mul(span).toVar();
            const vv = alt.mul(span).toVar();
            // The heads run ahead of their feet and boil upward.
            const uHead = uu.add(clock.mul(TOWERS.drift[0])).toVar();
            const vHead = vv.add(0.21).sub(clock.mul(TOWERS.boil)).toVar();
            const fineLod = clamp(log2(max(u.texel.mul(span * 256 * 2.4), 1.0)).add(0.6), 0.0, 5.0).toVar();
            const stand = noiseAt(noise, vec2(uu.add(clock.mul(TOWERS.drift[1])).mul(0.9), 0.37), 0).r;
            // Toward the sun, in this plane, one short step: the face of each heap that turns
            // toward it is where the field thins in that direction.
            const toSun = normalize(vec2(sunAz.sub(az), sunAlt.sub(alt).mul(0.8)).add(vec2(1e-4, 0.0))).toVar();
            const stepUv = toSun.mul(0.035);
            const heap = (du, dv) => {
                const h = noiseAt(noise, vec2(uHead.add(du), vHead.add(dv)), 0.4).g;
                const billowAt = vec2(uHead.add(du).mul(2.4).add(0.37), vHead.add(dv).mul(2.4));
                const billow = noiseAt(noise, billowAt, fineLod).b;
                return h.sub(0.5).mul(0.8).add(billow.sub(0.5).mul(0.2));
            };
            // They sink away toward the sun's bearing (masked at an outline they would end in
            // straight walls either side of the sun).
            const stoop = smoothstep(0.4, 1.8, abs(az.sub(sunAz)).div(TOWERS.sunGate)).mul(0.72).add(0.28).toVar();
            const lines = smoothstep(0.2, 0.64, stand).mul(0.55).add(0.45).toVar();
            const rise = float(1.0).div(stoop.mul(TOWERS.top * span));
            const depth = lines.mul(0.66).add(heap(0, 0)).sub(vv.mul(rise)).toVar();
            const body = smoothstep(0.0, 0.11, depth).mul(smoothstep(-0.003, 0.004, alt)).mul(u.weather.y)
                .mul(clear)
                .toVar();
            If(body.greaterThan(0.002), () => {
                const ahead = lines.mul(0.66).add(heap(stepUv.x, stepUv.y)).sub(vv.add(stepUv.y).mul(rise));
                // A low gain round a mid value: a form, never flat lit patches.
                const facing = clamp(depth.sub(ahead).mul(5.0).add(0.4), 0.0, 1.0);
                const heart = smoothstep(0.05, 0.42, depth);
                // Forward scattering: the nearer the sun's bearing, the brighter the thin parts.
                const off = az.sub(sunAz).div(0.6);
                const forward = seGauss(off).mul(0.65).add(0.35);
                const core = u.mid.mul(1.3).add(u.belt.mul(0.7)).add(u.horizon.mul(0.22)).add(sunlit.mul(0.02));
                const face = sunlit.mul(0.34);
                const tower = mix(core, face, facing.mul(heart.mul(0.4).add(0.6))).toVar();
                tower.addAssign(sunlit.mul(float(1.0).sub(heart)).mul(forward).mul(0.55));
                // Their feet stand in the haze of the far horizon.
                const aired = mix(tower, airBehind, exp(alt.mul(-40.0)).mul(0.55).add(0.1));
                sky.assign(mix(sky, aired, body.mul(0.96)));
            });
        });
    }

    // ── The altocumulus deck ──
    if (tier.deck) {
        If(u.weather.z.greaterThan(0.01).and(alt.greaterThan(DECK.fadeLow[0])), () => {
            const sinA = max(d.y, 0.008).toVar();
            // Its point over the ground (km) and how far that is.
            const P = vec2(d.x, d.z).mul(float(DECK.height).div(sinA)).toVar();
            const dist = length(P).toVar();
            const head = vec2(Math.cos(DECK.heading), Math.sin(DECK.heading));
            const across = vec2(-Math.sin(DECK.heading), Math.cos(DECK.heading));
            // The cloudlets drift with the wind; the fields they gather in drift slower and the
            // other way a little, so cloudlets form and melt as they go.
            // Kilometres a pixel spans there (mostly along the line of sight): where the rows would
            // turn faster than about a radian a pixel they fade to their mean (a veil, never
            // moiré), and every read takes the mip level its footprint asks for.
            const kmPerPx = dist.div(sinA).mul(u.texel).mul(sinA.mul(0.6).add(0.4)).toVar();
            const lodFor = (tileKm) => clamp(log2(max(kmPerPx.mul(256 / tileKm), 1.0)), 0.0, 6.0);
            const at = P.add(head.mul(clock.mul(DECK.drift[0]))).toVar();
            const fieldAt = P.add(vec2(clock.mul(DECK.drift[1]), clock.mul(-DECK.drift[1] * 0.6))).div(DECK.field);
            const field = noiseAt(noise, fieldAt.mul(0.25), lodFor(DECK.field * 4)).r;
            const bendAt = at.div(DECK.field * 0.7).add(vec2(0.31, 0.17));
            const bend = noiseAt(noise, bendAt, lodFor(DECK.field * 0.7)).g.sub(0.5);
            const phase = dot(at, head).mul((Math.PI * 2) / DECK.wave).add(bend.mul(7.0));
            const breakAt = vec2(dot(at, across).div(DECK.wave * 2.6), dot(at, head).div(DECK.wave * 1.1));
            const breaks = noiseAt(noise, breakAt.mul(0.25).add(vec2(0.57, 0.11)), lodFor(DECK.wave * 4.4)).b;
            const turn = kmPerPx.mul((Math.PI * 2) / DECK.wave);
            const seen = smoothstep(1.6, 0.5, turn).toVar();
            const ripple = mix(float(0.5), cos(phase).mul(0.5).add(0.5), seen);
            const cells = ripple.mul(0.6).add(breaks.mul(0.75)).toVar();
            const cover = smoothstep(0.32, 0.64, field).toVar();
            // Wide ramps: the cloudlets swell and fade, the extinction draws their edges. Where the
            // rows are too fine to see the deck closes into the veil it is from afar (its mean
            // falls below a cloudlet's threshold, so the threshold falls with it).
            const veil = float(1.0).sub(seen).mul(0.36);
            const lo = float(1.02).sub(cover.mul(0.32)).sub(veil);
            const hi = float(1.32).sub(cover.mul(0.3)).sub(veil);
            const dens = smoothstep(lo, hi, cells)
                .mul(cover)
                .toVar();
            // Near the sun the deck thins, so the corona's inner crown stays clean.
            const nearSun = smoothstep(1.8, 4.5, length(plane.xy));
            const amount = dens.mul(smoothstep(DECK.fadeLow[0], DECK.fadeLow[1], alt))
                .mul(u.weather.z).mul(nearSun.mul(0.8).add(0.2)).mul(clear)
                .toVar();
            If(amount.greaterThan(0.002), () => {
                // Beyond the shadow's edge the deck stands in the sunlight and burns; the edge is a
                // soft band a tenth of its distance wide.
                const lit = smoothstep(edgeKm.mul(0.93), edgeKm.mul(1.12), dist);
                const thick = smoothstep(0.1, 0.7, dens);
                // In the shadow: dark cloudlets, their thin fringes lit from below by the band.
                const fringe = float(1.0).sub(thick).mul(exp(alt.mul(-14.0)));
                const dark = shade.mul(0.85).add(u.horizon.mul(fringe.mul(0.5))).add(u.glow.mul(fringe.mul(0.05)));
                const burnt = sunlit.mul(0.36).mul(ripple.mul(0.4).add(0.6)).mul(float(1.0).sub(thick.mul(0.25)));
                const colour = mix(dark, burnt, lit).toVar();
                // Far cloudlets sink into the air behind them.
                colour.assign(mix(colour, airBehind, float(1.0).sub(exp(dist.div(-150.0))).mul(0.55)));
                sky.assign(mix(sky, colour, amount.mul(0.92)));
            });
        });
    }

    // ── The rows of bars low over the far shore, farthest first ──
    // Each row is the face it turns to the lens, read in (bearing, height above its base). Seen
    // this low a cloud is a long bar far wider than it is tall: a row of them, gaps between.
    if (tier.clouds) {
        const lowest = cloudRowSpan(CLOUDS.rows[0]).base - 0.004;
        const highest = CLOUDS.rows.reduce((m, row) => Math.max(m, cloudRowSpan(row).top), 0);
        If(u.weather.x.greaterThan(0.01).and(alt.greaterThan(lowest)).and(alt.lessThan(highest)), () => {
            CLOUDS.rows.forEach((row, k) => {
                const span = cloudRowSpan(row);
                If(alt.greaterThan(span.base - 0.003).and(alt.lessThan(span.top)), () => {
                    const unit = row.lump * 4;
                    const per = row.distance / unit;
                    const lod = clamp(log2(max(u.texel.mul(per * 256), 1.0)), 0.0, 6.0);
                    const x = az.mul(per).add(clock.mul(row.wind / unit)).add(0.11 + k * 0.37).toVar();
                    // The base wavers a little bar to bar.
                    const waver = noiseAt(noise, vec2(x.mul(0.21), 0.13 + k * 0.29), lod).g.sub(0.5);
                    const h = alt.mul(row.distance).sub(CLOUDS.base).sub(waver.mul(row.depth * 0.25)).toVar();
                    // Squashed: each heap reads far wider than it is tall. The heaps themselves
                    // boil slowly through the field, so a bar thickens, thins and breaks.
                    const y = h.div(unit).mul(row.squash * 2.6).add(k * 0.53).toVar();
                    const boilAt = vec2(x.add(clock.mul(0.0007)), y.sub(clock.mul(0.0009)));
                    const mass = noiseAt(noise, boilAt, lod).r.toVar();
                    const under = noiseAt(noise, boilAt.sub(vec2(0.0, 0.05)), lod).r;
                    // Broad gaps along the row: whole reaches of the band stand clear, opening
                    // and closing slowly on their own.
                    const gapAt = vec2(x.mul(0.09).add(k * 0.71).add(clock.mul(0.00035)), 0.62);
                    const gap = noiseAt(noise, gapAt, lod).b;
                    const rise = clamp(h.div(row.depth), 0.0, 1.6).toVar();
                    const thr = pow(rise, 1.4).mul(0.3)
                        .add(float(1.0).sub(smoothstep(0.28, 0.58, gap)).mul(0.32))
                        .add(0.42 - (row.cover - 0.5) * 0.35)
                        .toVar();
                    const pxKm = u.texel.mul(row.distance);
                    // A wide ramp: its edges are soft, never a cut-out.
                    const inside = smoothstep(thr.sub(0.03), thr.add(0.2), mass);
                    const based = smoothstep(pxKm.mul(-1.5), pxKm.mul(2.5).add(row.depth * 0.05), h);
                    const cloud = inside.mul(based).mul(clear).mul(CLOUDS.opacity).mul(u.weather.x)
                        .toVar();
                    If(cloud.greaterThan(0.002), () => {
                        const thick = smoothstep(thr, thr.add(0.3), mass);
                        // Lit with a low gain round a mid value (a large gain is 0 or 1 nearly
                        // everywhere: flat patches with hard edges).
                        const below = clamp(mass.sub(under).mul(4.0).add(0.45), 0.0, 1.0);
                        const lit = smoothstep(edgeKm.mul(0.85), edgeKm.mul(1.18), float(row.distance));
                        // In sunlight: lit from above, the tops brightest; the creases take the
                        // cool light of the sky.
                        const crease = u.belt.mul(0.8).add(u.mid.mul(1.4)).add(u.horizon.mul(0.3));
                        const sunward = float(1.0).sub(below).mul(0.6).add(clamp(rise, 0.0, 1.0).mul(0.4));
                        const burn = mix(crease, sunlit.mul(0.7), sunward).mul(float(1.0).sub(thick.mul(0.2)));
                        // In the shadow: a dark body, its underside lit from below by the band of
                        // light all round, warm and soft.
                        const underLight = u.glow.mul(0.16).add(u.horizon.mul(0.35)).mul(below)
                            .mul(exp(max(h, 0.0).div(-row.depth * 0.5)));
                        const colour = mix(shade.add(underLight), burn, lit).toVar();
                        // Thin cloud lets the light behind it through: a lining.
                        colour.assign(mix(colour, airBehind.mul(1.25), thick.oneMinus().mul(0.5)));
                        colour.assign(mix(colour, airBehind, row.aerial));
                        colour.addAssign(u.haze.mul(day.mul(0.8)));
                        sky.assign(mix(sky, colour, cloud));
                    });
                });
            });
        });
    }

    // ── The cap over the volcano ──
    if (tier.lenticular) {
        const centre = VOLCANO.az + LENTICULAR.az;
        const alt0 = VOLCANO.peak + LENTICULAR.over;
        const reach = LENTICULAR.halfHeight * (LENTICULAR.plates + 1.5);
        If(u.weather.w.greaterThan(0.01).and(abs(alt.sub(alt0)).lessThan(reach))
            .and(abs(az.sub(centre)).lessThan(LENTICULAR.halfWidth * 1.3)), () => {
            const x = az.sub(centre).div(LENTICULAR.halfWidth).toVar();
            const glide = noiseAt(noise, vec2(x.mul(0.6).add(clock.mul(0.0006)), 0.83), 0).r.sub(0.5);
            const lens = float(0.0).toVar();
            const top = float(0.0).toVar();
            for (let i = 0; i < LENTICULAR.plates; i += 1) {
                // A stack of plates, each a little narrower and fainter than the one under it.
                const w = 1 - i * 0.2;
                const layer = alt0 + (i - 0.6) * LENTICULAR.halfHeight * 1.35;
                const yi = alt.sub(layer).div(LENTICULAR.halfHeight * (1 - i * 0.12))
                    .sub(glide.mul(0.5));
                const xi = x.div(w);
                const shape = xi.mul(xi).add(yi.mul(yi).mul(xi.mul(xi).mul(0.6).add(1.0)));
                const plate = smoothstep(1.0, 0.5, shape).mul(1 - i * 0.22);
                lens.assign(max(lens, plate));
                // Its upper face, toward the sun.
                top.assign(max(top, plate.mul(smoothstep(-0.3, 0.6, yi))));
            }
            const amount = lens.mul(u.weather.w).mul(0.9).toVar();
            If(amount.greaterThan(0.002), () => {
                // Sunlit when the summit is (it stands just above it), else dark with the band's
                // light along its underside.
                const burnt = sunlit.mul(0.5).mul(top.mul(0.6).add(0.4));
                const dark = shade.mul(1.1).add(u.horizon.mul(0.28).mul(float(1.0).sub(top)));
                const colour = mix(dark, burnt, u.summitLit).toVar();
                colour.addAssign(u.belt.mul(seGauss(x.mul(1.4)).mul(0.2)));
                sky.assign(mix(sky, colour, amount));
            });
        });
    }
}
