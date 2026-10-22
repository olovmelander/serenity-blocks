/**
 * Stellar Velocity — the canyon and the sky behind it.
 *
 * The canyon of cloud the course runs down is painted once per frame into a reduced-resolution
 * target: gas is soft, so it does not need the screen's pixels. It is walked along the view ray,
 * front to back, with steps that grow with distance. What makes it read as a canyon lit from its
 * far end, and not as fog, is the light:
 *   - the sun stands at the end of the course, so every cloud is lit from BEHIND: a tap or two of
 *     the cloud toward the sun says how much of its light reaches a sample. Gas the light
 *     reaches glows in the palette's `glow`; gas in the cloud's own shade is dim, in its `deep`;
 *   - looking toward the sun, lit gas scatters the sun's own light forward: the silver edges;
 *   - the billows are dust: they glow less and hide more, so the heads of the walls stand dark
 *     against the lit gas behind them;
 *   - far cloud is taken by the haze the sun makes of the canyon's whole length;
 *   - every hoop on the course is a ring of light in the canyon, and every front (a lock's
 *     pulse, a clear's fronts, a level's) is a sheet of light that comes down it toward us and
 *     lights the walls as it passes.
 *
 * The backdrop then lays the target over the deep sky at the screen's own resolution: the far
 * stars (bunched forward and shifted through the starbow at speed), the sun, and, in a jump, the
 * tunnel. It reads the target through a small tent, which is what hides the march's steps: each
 * pixel of the target starts its walk at a different place, and neighbours average out.
 */

import * as THREE from 'three/webgpu';
import {
    Break,
    Fn,
    If,
    Loop,
    atan,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    positionGeometry,
    pow,
    screenCoordinate,
    screenUV,
    sin,
    smoothstep,
    sqrt,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CANYON,
    CANYON_CODE_PEAK,
    CROWN_FIRE,
    FRONT_SLOTS,
    HOOP_LIGHTS,
    TAU,
    svHash23,
    svPart,
    svPassMaterial,
    svBowShift,
    svShift,
    svStarbow,
    svTarget,
    svTrueRay,
    svViewRay,
} from './stellar-velocity-tsl.js';

/** Canyon units of full cloud that put out 63% of the light behind them (gas, and dust). */
const EXTINCTION_GAS = 0.95;
const EXTINCTION_DUST = 0.26;
/** How far toward the sun the two shading taps reach (canyon units). */
const LIGHT_NEAR = 0.9;
const LIGHT_FAR = 3.2;
/** How steeply the cloud comes on past its edge (with the fine read, and without). */
const EDGE_FINE = 7.5;
const EDGE_COARSE = 4.0;
/** How far (in tiles) the slow field bends the place the cloud is read at. */
const WARP = 0.26;
/** The share of a lattice cell a far star spans on a desktop frame: what its light is set for. */
const STAR_SPREAD = 0.23;
/** The share of the sky's bunching the near cloud is shown with (all of it would be a fisheye). */
const CANYON_WARP = 0.5;

/**
 * @param {object} u  shared uniforms
 * @param {object} options
 * @param {number} options.march    steps along a ray
 * @param {boolean} options.detail  the second, finer read that frays the cloud's edges
 * @param {number} options.taps     reads of the cloud toward the sun per lit sample (0..2)
 * @param {boolean} options.lights  light the cloud with the hoops and the fronts
 * @param {number} options.skyLayers  lattices of far stars
 */
export function createCanyon(u, {
    march = 36, detail = true, taps = 2, lights = true, skyLayers = 3,
} = {}) {
    const {
        tile, stretch, clear, wall, outer, near, reach,
    } = CANYON;
    const texel = uniform(new THREE.Vector2(1 / 960, 1 / 540));

    /**
     * A world point in the canyon's own frame: wound round the course by a T-spin, slid by how
     * far we have come, shifted by a jump. One unit is one tile of the cloud, which is drawn out
     * along the course: the walls are streamers, not puffs.
     */
    const frame = (p) => {
        const turn = u.twist.mul(p.z.negate());
        const c = cos(turn);
        const s = sin(turn);
        return vec3(
            p.x.mul(c).sub(p.y.mul(s)),
            p.x.mul(s).add(p.y.mul(c)),
            p.z.sub(u.travel).div(stretch),
        ).add(u.shift).div(tile);
    };
    /**
     * How much more cloud there is at a point than the canyon needs before it shows: nothing
     * reaches into the open channel round the course, the walls stand off it, a slow field
     * opens them into separate masses with the deep sky between, and past them there is nothing.
     */
    const fieldOf = (base, slow, radius) => {
        const shape = base.r.mul(0.58).add(base.b.mul(0.42));
        const open = smoothstep(clear * 0.5, wall, radius);
        const beyond = smoothstep(wall + 0.8, outer, radius);
        const need = mix(float(1.2), float(0.57), open).add(beyond.mul(0.8)).sub(slow.sub(0.5).mul(1.05));
        return shape.sub(need);
    };

    const paint = Fn(() => {
        const st = uv();
        const seenRay = svViewRay(u, st).toVar();
        // The canyon bunches forward with the sky, but less: it is near.
        const ray = svTrueRay(seenRay, u.warp.mul(CANYON_WARP)).toVar();
        const toSun = vec3(0.0, 0.0, -1.0);
        // Forward scatter: how nearly this ray looks into the sun.
        const cosSun = max(ray.z.negate(), 0.0).toVar();
        const toward = pow(cosSun, 12.0).mul(0.85).add(cosSun.mul(cosSun).mul(0.15)).toVar();
        // Interleaved gradient noise: a different start per pixel hides the steps.
        const jitter = fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189)).toVar();
        // What the sun makes of the canyon's whole length: far cloud is taken by it, dim
        // away from the sun and bright round it.
        // The glow at full strength: the hue the gas answers a front in.
        const glowTone = u.glow.div(max(max(u.glow.x, u.glow.y), max(u.glow.z, 1e-3))).mul(1.15).toVar();
        const haze = u.deep.mul(0.035).add(u.glow.mul(0.05))
            .add(u.glow.mul(toward.mul(0.75)))
            .add(mix(u.accent, u.sunCol, 0.5).mul(toward.mul(toward).mul(toward).mul(0.28)))
            .toVar();

        // Cloud only stands between the open channel and the canyon's outer edge, so a ray is
        // walked from where it leaves the one to where it leaves the other: every step then
        // takes it the same share further from the course, whichever way it looks.
        const aside = max(length(ray.xy), 0.004).toVar();
        const t0 = clamp(float(clear * 0.5 - 0.2).div(aside), near, reach * 0.45).toVar();
        const t1 = min(float(outer).div(aside), reach).toVar();
        const ratio = pow(t1.div(t0), 1 / march).toVar();

        const col = vec3(0.0).toVar();
        const trans = float(1.0).toVar();
        const t = t0.mul(pow(ratio, jitter)).toVar();

        Loop(march, () => {
            const ds = t.mul(ratio.sub(1.0)).toVar();
            const p = u.camPos.add(ray.mul(t)).toVar();
            const depth = p.z.negate().toVar();
            const radius = length(p.xy).toVar();
            const n0 = frame(p).toVar();
            // A slow read of the far volume bends the place the cloud is read at (so its masses
            // curl instead of standing as puffs) and says where the walls open.
            const slow = u.cloudFar(n0.mul(0.5)).toVar();
            const n = n0.add(slow.rgb.sub(0.5).mul(WARP)).toVar();
            // A step longer than the cloud's finest features reads the volume that has none.
            const blur = smoothstep(0.3, 1.05, ds).toVar();
            const base = vec4(0.0).toVar();
            If(blur.lessThan(0.02), () => {
                base.assign(u.cloud(n));
            }).ElseIf(blur.greaterThan(0.98), () => {
                base.assign(u.cloudFar(n));
            }).Else(() => {
                base.assign(mix(u.cloud(n), u.cloudFar(n), blur));
            });
            const field = fieldOf(base, slow.a, radius).toVar();
            let threads = null;
            if (detail) {
                // Streamers: fine filaments that run along the course. They are read from the
                // mipped grain in the canyon's own cylinder (round the course, out from it, and
                // slowly along it), at a level as coarse as the step is long: nothing aliases.
                const round = atan(n.y, n.x).div(TAU);
                const lod = clamp(ds.mul(2.2).log2().add(1.0), 0.0, 5.0).toVar();
                const grain = u.fbmLod(
                    vec2(round.mul(3.0).add(n.z.mul(0.5)), radius.mul(0.16).add(n.z.mul(1.0))),
                    lod,
                ).toVar();
                field.addAssign(grain.r.sub(0.5).mul(0.3).add(grain.g.sub(0.5).mul(0.14)));
                // Where the third field crosses its middle, a thread of glowing gas drawn out
                // along the course: the walls stream past. The ridge of a blurred read is lit
                // everywhere, so the threads fade out where the step is too long to hold them.
                const ridge = float(1.0).sub(grain.b.mul(2.0).sub(1.0).abs());
                threads = pow(ridge, 7.0).mul(float(1.0).sub(smoothstep(1.2, 3.2, lod))).toVar();
            }
            If(field.greaterThan(detail ? -0.09 : 0.001), () => {
                const d = clamp(field.mul(EDGE_COARSE), 0.0, 1.0).toVar();
                if (detail) {
                    // Filaments ride on the masses and fray their edges, where a step is short
                    // enough to see them.
                    const room = float(1.0).sub(blur);
                    If(room.greaterThan(0.01), () => {
                        const fine = u.cloud(n.mul(3.0).add(base.rgb.sub(0.5).mul(0.2)));
                        const fray = fine.g.sub(0.4).mul(0.3).add(fine.b.sub(0.5).mul(0.16)).mul(room);
                        d.assign(clamp(field.add(fray).mul(mix(float(EDGE_COARSE), float(EDGE_FINE), room)), 0.0, 1.0));
                    });
                }
                If(d.greaterThan(0.004), () => {
                    // ── How much of the sun's light reaches this sample ──
                    let lit = float(0.4);
                    if (taps > 0) {
                        const toward1 = toSun.mul(LIGHT_NEAR / (tile * stretch));
                        let shade = clamp(fieldOf(u.cloudFar(n.add(toward1)), slow.a, radius).mul(EDGE_COARSE), 0.0, 1.0).mul(1.7);
                        if (taps > 1) {
                            const toward2 = toSun.mul(LIGHT_FAR / (tile * stretch));
                            shade = shade.add(
                                clamp(fieldOf(u.cloudFar(n.add(toward2)), slow.a, radius).mul(EDGE_COARSE), 0.0, 1.0).mul(2.6),
                            );
                        } else shade = shade.mul(2.3);
                        lit = exp(shade.negate()).toVar();
                    }
                    // The canyon ahead stands between the sun and the gas deep in its walls: only
                    // what faces the open channel, and what stands where the walls open, is lit.
                    const buried = smoothstep(clear * 0.9, wall + 0.6, radius).mul(smoothstep(0.25, 0.65, slow.a));
                    lit = lit.mul(float(1.0).sub(buried.mul(0.72))).toVar();
                    // The billows are dust: dark heads on the walls.
                    const dusty = smoothstep(0.5, 0.86, base.b).mul(smoothstep(0.25, 0.9, d)).toVar();
                    const clean = float(1.0).sub(dusty.mul(0.9)).toVar();
                    // The gas is lit from behind: what the sun reaches burns in the glow, the more
                    // the nearer the ray looks into the sun (the walls seen side-on are dark);
                    // what it does not is the nebula's own shade, lit only by the gas round it.
                    const phase = cosSun.mul(cosSun).mul(0.45).add(toward.mul(1.1)).add(0.1);
                    const sunlit = u.glow.mul(lit.mul(phase)).mul(1.35);
                    const hot = smoothstep(0.3, 0.85, base.a).toVar();
                    const shaded = u.deep.mul(float(1.0).sub(lit).mul(0.12).add(0.035)).mul(hot.mul(1.2).add(0.35));
                    // Ionised gas glows by itself: where the slow field runs hot in the glow, where
                    // it runs cool in the shade's colour, so the walls are zoned like a nebula. (Not
                    // in the third colour: laid over the glow, a complement greys it.)
                    const own = mix(u.deep.mul(1.3), u.glow, hot).mul(hot.mul(0.1).add(0.035));
                    // The sun's own light, scattered forward by the gas it reaches most, in the
                    // third colour: the canyon is warm round the sun and cool away from it.
                    const silver = mix(u.accent, u.sunCol, 0.3).mul(lit.mul(lit).mul(lit)).mul(toward)
                        .mul(u.sunGain.mul(0.4).add(0.6))
                        .mul(1.6);
                    // Where the light grazes a dark head, its rim burns in that colour too.
                    const rim = u.accent.mul(lit.mul(dusty).mul(toward.mul(1.2).add(0.07)));
                    // The threads glow in the glow, whiter where the sun reaches them.
                    const strands = threads
                        ? mix(u.glow, u.sunCol.mul(0.7), lit.mul(0.35)).mul(threads)
                            .mul(lit.mul(0.6).add(0.15))
                            .mul(0.55)
                        : vec3(0.0);
                    const glowing = sunlit.add(shaded).add(own).add(silver).add(strands);
                    const light = glowing.mul(clean).add(rim).toVar();
                    if (lights) {
                        const cast = vec3(0.0).toVar();
                        const swept = vec3(0.0).toVar();
                        // Every hoop is a ring of light standing in the canyon, and every front a
                        // sheet of light coming down it. Their slots are unrolled, each behind a
                        // branch on the live count (the same for every pixel, so idle slots cost
                        // nothing): a loop nested in the march was miscompiled on ANGLE's D3D11
                        // path, which washed the WebGL2 canyon in the hoops' colours.
                        for (let k = 0; k < HOOP_LIGHTS; k++) {
                            If(u.hoopLightCount.greaterThan(k), () => {
                                const a = u.hoopLights.element(k * 2);
                                const c = u.hoopLights.element(k * 2 + 1);
                                const dz = depth.sub(a.x);
                                const dr = radius.sub(a.y);
                                const fall = float(1.0).div(float(1.0).add(dz.mul(dz).add(dr.mul(dr)).mul(1.5)));
                                cast.addAssign(c.rgb.mul(a.z.mul(fall).mul(fall)));
                            });
                        }
                        for (let k = 0; k < FRONT_SLOTS; k++) {
                            If(u.frontCount.greaterThan(k), () => {
                                const a = u.fronts.element(k * 2);
                                const c = u.fronts.element(k * 2 + 1);
                                const x = depth.sub(a.x).div(a.y);
                                swept.addAssign(c.rgb.mul(a.z.mul(exp(x.mul(x).negate()))));
                            });
                        }
                        // The gas answers a hoop in the hoop's colour, a little in its own; a
                        // front excites it, so it answers mostly in its own glow (a white front
                        // answered in white is a grey veil over the canyon).
                        light.addAssign(cast.mul(mix(vec3(1.0), u.glow.add(u.deep).mul(1.4), 0.3)).mul(clean).mul(0.6));
                        light.addAssign(swept.mul(mix(vec3(1.0), glowTone, 0.62)).mul(clean).mul(0.6));
                    }
                    light.assign(mix(light, haze, smoothstep(7.0, reach * 0.85, t).mul(0.66)));
                    light.mulAssign(u.breath.mul(0.75).add(0.25));
                    const extinction = mix(float(EXTINCTION_GAS), float(EXTINCTION_DUST), dusty);
                    const a = float(1.0).sub(exp(d.mul(ds).div(extinction).negate()));
                    col.addAssign(light.mul(trans).mul(a));
                    trans.mulAssign(float(1.0).sub(a));
                });
            });
            t.mulAssign(ratio);
            If(trans.lessThan(0.015), () => {
                Break();
            });
        });
        // In a jump there is no canyon: we have left it.
        const there = float(1.0).sub(u.jump.mul(0.97));
        const light = col.mul(there);
        const through = mix(float(1.0), trans, there);
        if (!u.floatTarget) return vec4(sqrt(clamp(light.div(CANYON_CODE_PEAK), 0.0, 1.0)), through);
        return vec4(light, through);
    });

    const material = svPassMaterial('StellarVelocityCanyonPass', paint());
    const quad = new THREE.QuadMesh(material);
    quad.name = 'StellarVelocityCanyonPass';
    let target = svTarget(4, 4, 'stellar-velocity-canyon-target', u.floatTarget);
    u.targetTex.value = target.texture;

    // ── The backdrop: the deep sky, the sun, the canyon laid over them, the tunnel ──

    /** Far stars on one lattice of the sky: light summed over the cell a direction falls in. */
    const starLayer = (dir, scale, seed, spread) => {
        const p = dir.mul(scale).add(seed);
        const cell = floor(p);
        const f = fract(p).sub(0.5);
        const h = svHash23(cell.xy.add(cell.z.mul(vec2(37.0, 17.0))));
        const g = svHash23(cell.xy.add(cell.z.mul(vec2(-11.0, 53.0))).add(4.7));
        const at = vec3(h.x, h.y, g.x).sub(0.5).mul(0.7);
        const away = length(f.sub(at));
        // A few bright ones, a great many faint ones.
        const mag = pow(h.z, 9.0).mul(2.6).add(pow(g.y, 3.0).mul(0.16));
        const core = float(1.0).sub(smoothstep(0.0, spread, away));
        return vec4(mix(vec3(1.0, 0.86, 0.72), vec3(0.74, 0.86, 1.0), g.z), core.mul(core).mul(mag));
    };

    /** The canyon's target through a small tent: neighbours start their walks at different places. */
    const canyonSoft = (st) => {
        const o = texel.mul(0.6);
        return u.canyonAt(st.add(vec2(o.x, o.y)))
            .add(u.canyonAt(st.add(vec2(o.x.negate(), o.y))))
            .add(u.canyonAt(st.add(vec2(o.x, o.y.negate()))))
            .add(u.canyonAt(st.sub(vec2(o.x, o.y))))
            .mul(0.25);
    };

    const backdropFn = Fn(() => {
        const st = screenUV;
        const seenRay = svViewRay(u, st).toVar();
        const seen = clamp(seenRay.z.negate(), -1.0, 1.0).toVar();
        const beta = u.warp;
        const trueRay = svTrueRay(seenRay, beta).toVar();
        // log2 of the Doppler factor: what the starbow is read from. The sky is squeezed by the
        // factor itself, so a star keeps its size on screen by growing with it in the lattice.
        const shift = svShift(seen, beta).toVar();
        const factor = pow(float(2.0), shift).toVar();

        // ── The deep sky and its far stars ──
        const around = atan(trueRay.y, trueRay.x).div(TAU);
        const far = u.fbm(vec2(around.mul(2.0), trueRay.z.mul(0.7)));
        // A few faint clouds of the nebula's own colours, far beyond the canyon.
        const sky = u.skyCol.mul(far.r.mul(1.6).add(0.7))
            .add(u.deep.mul(smoothstep(0.52, 0.9, far.g).mul(0.022)))
            .add(u.glow.mul(smoothstep(0.6, 0.95, far.b).mul(0.012)))
            .toVar();
        const stars = vec3(0.0).toVar();
        const bow = svStarbow(svBowShift(seen, beta)).toVar();
        const tinted = smoothstep(0.04, 0.5, beta);
        for (let i = 0; i < skyLayers; i++) {
            const scale = [150, 96, 62][i];
            // A star is a pixel and a bit wide whatever the buffer's size. On a small buffer (a
            // phone, a scaled-down frame) that is a large share of its lattice cell: it is held
            // inside the cell, and its light is spread over the larger pixels it now covers, or
            // the sky fills with snow.
            const want = u.pixelAngle.mul(scale * 1.25).mul(max(factor, 0.5));
            const spread = min(want, 0.4);
            const thin = min(float(STAR_SPREAD).div(want), 1.0);
            const s = starLayer(trueRay, scale, vec3(11.3 * (i + 1), 7.1 * (i + 2), 3.7 * (i + 3)), spread);
            stars.addAssign(mix(s.rgb.mul(u.starTint), bow, tinted).mul(s.a.mul(thin).mul(thin)));
        }
        // Light piles up ahead and thins out behind.
        // At speed the far stars are squeezed into a haze of points: they give way to the
        // near stars' trails and to the starbow.
        stars.mulAssign(clamp(factor, 0.5, 2.0).mul(float(1.0).sub(smoothstep(0.08, 0.6, beta).mul(0.88))));
        // Starlight too faint and too many to count: at speed it is the starbow itself.
        // A soft ring of it stands round the sun, every band in its place.
        const band = svBowShift(seen, beta);
        const hush = bow.mul(beta.mul(beta)).mul(exp(band.mul(band).mul(-1.1))).mul(0.17);

        // ── The sun ──
        const off = sqrt(max(float(2.0).sub(seen.mul(2.0)), 0.0)).toVar(); // radians off the course, about
        const disc = exp(off.mul(off).mul(-12000.0)).mul(70.0);
        const halo = float(1.0).div(float(1.0).add(off.mul(off).mul(1400.0))).mul(0.9);
        const air = float(1.0).div(float(1.0).add(off.mul(off).mul(30.0))).mul(0.03);
        // Its corona: fine rays round the disc, turning slowly, reaching out a few degrees (and
        // read only there: past them it has faded to nothing).
        const corona = float(0.0).toVar();
        If(off.lessThan(0.22), () => {
            const about = atan(seenRay.y, seenRay.x).div(TAU);
            const fan = u.fbmLod(vec2(about.mul(11.0).add(u.time.mul(0.003)), off.mul(1.5).sub(u.time.mul(0.01))), 0);
            const rays = pow(fan.r, 3.0).mul(1.8).add(pow(fan.g, 6.0).mul(2.4)).add(0.4);
            const fade = float(1.0).sub(smoothstep(0.12, 0.22, off));
            corona.assign(rays.mul(float(1.0).div(float(1.0).add(off.mul(off).mul(1800.0)))).mul(fade).mul(0.24));
        });
        const sun = u.sunCol.mul(disc.add(halo)).add(mix(u.sunCol, u.glow.mul(2.0), 0.35).mul(corona))
            .add(mix(u.sunCol, u.glow.mul(2.0), 0.5).mul(air))
            .mul(u.sunGain);

        const canyon = canyonSoft(st).toVar();
        const behind = sky.add(stars.add(hush).mul(u.breath)).add(sun.mul(u.breath.mul(0.8).add(0.2)));
        const out = behind.mul(canyon.a).add(canyon.rgb).toVar();

        // ── The jump: a tunnel of light running out of the sun ──
        If(u.jump.greaterThan(0.002), () => {
            const round = atan(seenRay.y, seenRay.x).div(TAU);
            // How far off the course, as a depth down the tunnel: its mouth is the sun.
            const down = float(1.0).div(max(off, 0.02));
            const run = u.jumpClock;
            const a1 = u.fbmLod(vec2(round.mul(3.0), down.mul(0.045).add(run.mul(0.9))), 0);
            const a2 = u.fbmLod(vec2(round.mul(9.0).add(0.37), down.mul(0.11).add(run.mul(1.7))), 0);
            const a3 = u.fbmLod(vec2(round.mul(24.0).add(0.71), down.mul(0.2).add(run.mul(2.6))), 1);
            const ropes = pow(clamp(a1.r.mul(0.6).add(a2.g.mul(0.4)), 0.0, 1.0), 4.0);
            const threads = pow(a3.b, 8.0).mul(a2.r.add(0.3));
            // Wider off the course: the walls of the tunnel are near us.
            const wallness = smoothstep(0.0, 0.9, off);
            // The tunnel is made of the nebula we left: its two glows in broad lanes round the
            // course, its third colour in streaks, and starlight in the threads.
            const lane = mix(u.glow, u.deep.mul(1.5), smoothstep(0.38, 0.62, a1.b)).mul(3.2);
            const tint = mix(lane, u.accent.mul(1.8), smoothstep(0.62, 0.86, a2.b));
            // A perfect clear crowns the jump: the mouth flares and the threads burn gold.
            const crown = min(u.crown, 1.0);
            const mouth = u.sunCol.mul(float(1.0).div(float(1.0).add(off.mul(off).mul(220.0)))).mul(1.5)
                .add(u.glow.mul(float(1.0).div(float(1.0).add(off.mul(off).mul(12.0)))).mul(0.55))
                .mul(crown.mul(1.1).add(1.0));
            const thread = mix(tint, mix(u.sunCol, vec3(...CROWN_FIRE), crown), crown.mul(0.3).add(0.6));
            const walls = tint.mul(ropes.mul(2.4)).add(thread.mul(threads.mul(crown.mul(6.0).add(6.0))))
                .mul(wallness.mul(0.92).add(0.08));
            out.assign(mix(out, walls.add(mouth), u.jump));
        });
        return vec4(max(out, vec3(0.0)), 1.0);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const backdrop = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    backdrop.name = 'StellarVelocityBackdrop';
    backdrop.fog = false;
    backdrop.vertexNode = vec4(positionGeometry.xy, 1.0, 1.0);
    backdrop.colorNode = backdropFn();
    const part = svPart('StellarVelocityBackdrop', geometry, backdrop, -100);

    part.pass = { quad, material };
    /** Size the target for a drawing buffer and a tier's scale. Returns true if it was rebuilt. */
    part.resize = (bufferWidth, bufferHeight, scale) => {
        const w = Math.max(2, Math.round(bufferWidth * scale));
        const h = Math.max(2, Math.round(bufferHeight * scale));
        if (target.width === w && target.height === h) return false;
        target.dispose();
        target = svTarget(w, h, 'stellar-velocity-canyon-target', u.floatTarget);
        u.targetTex.value = target.texture;
        texel.value.set(1 / w, 1 / h);
        return true;
    };
    /** Paint the canyon for this frame (the camera uniforms must be current). */
    part.render = (renderer) => {
        if (!renderer || typeof renderer.setRenderTarget !== 'function') return false;
        const previous = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
        renderer.setRenderTarget(target);
        quad.render(renderer);
        renderer.setRenderTarget(previous);
        return true;
    };
    part.target = () => target;
    part.dispose = () => {
        target.dispose();
        material.dispose();
    };
    part.march = march;
    return part;
}
