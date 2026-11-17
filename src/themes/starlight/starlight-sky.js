/**
 * Starlight — the sky and its mirror: the air of the hour, the Milky Way, the far hills, and
 * the lake that repeats them.
 *
 * One dome. A pixel above the horizon reads the night in its own direction; a pixel below it
 * meets the water, is bent by the water's slope there and reads the night in the mirrored
 * direction, so the lake is the same function as the sky and costs the same. Nothing is baked
 * and nothing is marched: the Milky Way is a handful of reads of one noise texture in the
 * galaxy's own coordinates (longitude along the band, latitude across it), turned round the
 * pole by the sky's angle.
 *
 *   the air      zenith → horizon glow of the hour, banded airglow low in the sky
 *   the band     a disc and a bulge (starlight-core.js bandLight), mottled into star clouds
 *   the dust     lanes that keep to the plane and redden what they cover (core's dustAt, so the
 *                catalogue's stars thin out in the same places)
 *   nebulae      emission clouds along the lanes' edges
 *   grain        the unresolved stars, a sparkle that dies away as the shutter opens
 *   the hills    two crests on the horizon, darker than the low sky behind them
 *   the water    the mirror ray, the lake's own dark where it does not mirror, the rings' light
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    asin,
    atan,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    max,
    mix,
    normalize,
    positionWorld,
    pow,
    select,
    sin,
    smoothstep,
    step,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BAND, DUST, GALAXY, NEBULAE, NEBULA_ARC, TAU,
} from './starlight-core.js';
import {
    WOODS_TREE, mirrorShare, noiseSmooth, ridges, ringLight, sized, slGauss, slHash21, slMax3, veilDensity, waterPoint,
    waterSlope, woods,
} from './starlight-tsl.js';

const v3 = (a) => vec3(a[0], a[1], a[2]);

/** The far shore's lamps: (azimuth east of north in radians, brightness) each. */
const LAMPS = Object.freeze([[0.418, 1.0], [0.446, 0.6], [0.503, 0.8], [-0.612, 0.7]]);
const LAMP_COLOUR = vec3(1.0, 0.58, 0.22);
/** The town behind the right-hand lamps: the azimuth of its light dome, and how bright it is. */
const TOWN_AZ = 0.47;
const TOWN_GLOW = 0.02;
/** How thick the mist on the water lies where its bank is deepest (0..1 of what it veils). */
const MIST = 0.86;
/** The zodiacal light's foot (azimuth) and the way it leans as it climbs (unit: azimuth, altitude). */
const ZODIAC_AZ = 0.5;
const ZODIAC_LEAN = Object.freeze([-0.5, 0.866]);
/**
 * Below this height (the sine of the altitude) a direction may meet the hills, the woods or the
 * mist: the tallest far crest stands under 0.125.
 */
const HORIZON_BAND = 0.16;

export function createSky({ u, noise, tier }) {
    const geometry = new THREE.SphereGeometry(6000, 32, 16);
    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });

    material.fragmentNode = Fn(() => {
        const view = normalize(positionWorld.sub(cameraPosition)).toVar();
        const wet = view.y.lessThan(0.0);

        // ── The mirror ray ──
        const below = vec3(view.x, view.y.min(-1e-4), view.z);
        const spot = waterPoint(cameraPosition, below).toVar();
        const slope = waterSlope(u, noise, spot, tier).toVar();
        const along = dot(slope, normalize(view.xz.add(vec2(1e-5, 0.0))));
        const bent = vec3(
            view.x.add(slope.x.mul(view.y).mul(2.0)),
            max(view.y.negate().add(along.mul(2.0)), 0.0008),
            view.z.add(slope.y.mul(view.y).mul(2.0)),
        );
        const d = normalize(select(wet, bent, view)).toVar();
        const up = clamp(d.y, 0.0, 1.0).toVar();

        // ── The air of the hour ──
        const air = mix(u.zenith, u.mid, exp(up.div(-0.42))).toVar();
        const glow = exp(up.div(u.glowHeight).negate()).toVar();
        air.addAssign(u.horizon.mul(glow));
        const az = atan(d.x, d.z.negate()).toVar();
        if (tier.airglow) {
            // Airglow: a banded veil low in the sky, its ripples drifting.
            const ua = az.div(TAU);
            const drift = texture(noise, vec2(ua.mul(3.0).add(u.time.mul(0.0011)), up.mul(1.7).add(0.4))).level(1.0).r;
            const waves = sin(az.mul(13.0).add(up.mul(46.0)).add(drift.mul(7.0)).add(u.time.mul(0.022)))
                .mul(0.5).add(0.5);
            const veil = slGauss(up.sub(0.12).div(0.075)).mul(waves.mul(0.6).add(0.4)).mul(drift.mul(0.9).add(0.35));
            air.addAssign(u.airglow.mul(veil).mul(0.5));
        } else {
            air.addAssign(u.airglow.mul(slGauss(up.sub(0.12).div(0.075))).mul(0.33));
        }

        // ── Airglow in waves (the air's `waves`) ──
        // Oxygen glowing ninety kilometres up: long bands of green light rippling across the
        // sky, a red fringe above them. The layer is flat and seen from below, so its bands crowd
        // toward the horizon, where it is seen edge-on and glows brightest. ONE train of crests,
        // bent by a slow broad warp and shown in patches (two trains at two angles cross into a
        // plaid the eye locks onto: gotcha #1400). Every pixel takes the same side of the branch.
        If(u.air.x.greaterThan(0.002), () => {
            const deck = d.xz.div(up.add(0.09)).toVar();
            const bend = texture(noise, deck.mul(0.035).add(vec2(u.time.mul(0.0007), 0.31))).level(2).g;
            // Fine ripples (bold, widely spaced bands read as an aurora's curtains, not airglow).
            const phase = dot(deck, vec2(0.62, 0.78)).mul(19.0).add(bend.mul(14.0)).sub(u.time.mul(0.22));
            const crest = sin(phase).mul(0.5).add(0.5).toVar();
            const patches = smoothstep(
                0.3,
                0.72,
                texture(noise, deck.mul(0.022).add(vec2(0.53, u.time.mul(-0.0005)))).level(2).r,
            ).toVar();
            // Brightest seen edge-on, low; the crests fade into an even glow where they would
            // crowd below a few pixels apart.
            const edgeOn = exp(up.div(-0.32)).mul(0.75).add(0.25);
            const resolved = smoothstep(0.05, 0.2, up);
            // A broad sheen in patches, the ripples a modest swing on it: a glow with a grain of
            // waves in it, green-gold low, a dull red high up.
            const sheen = patches.mul(0.7).add(0.3);
            const bands = crest.mul(crest).mul(patches).mul(resolved);
            const green = vec3(0.09, 0.3, 0.1).mul(bands.mul(0.75).add(sheen.mul(0.45)))
                .mul(edgeOn);
            const red = vec3(0.24, 0.05, 0.05).mul(smoothstep(0.15, 0.6, up)).mul(sheen).mul(0.45);
            air.addAssign(green.add(red).mul(u.air.x).mul(0.1));
        });

        // ── The Milky Way ──
        // The direction in the sky's frame (the pole is z), turned back by the sky's angle…
        const px = dot(d, u.poleUp);
        const py = dot(d, u.poleWest);
        const ca = cos(u.skyAngle);
        const sa = sin(u.skyAngle);
        const s = vec3(px.mul(ca).add(py.mul(sa)), py.mul(ca).sub(px.mul(sa)), dot(d, u.pole)).toVar();
        // …then in the galaxy's own.
        const b = asin(clamp(dot(s, v3(GALAXY.north)), -1.0, 1.0)).toVar();
        const l = atan(dot(s, v3(GALAXY.east)), dot(s, v3(GALAXY.centre))).toVar();
        const lu = l.div(TAU).toVar();
        // A long exposure smears the fine structure: read it softer as the shutter opens.
        const soft = u.shutter.mul(2.2);

        const bb = b.add(sin(l.mul(2.0).add(0.7)).mul(BAND.warp)).toVar();
        const thick = float(BAND.thin).add(slGauss(l.div(BAND.swellWidth)).mul(BAND.swell)).toVar();
        const arms = slGauss(l.div(BAND.falloff)).mul(1 - BAND.floor).add(BAND.floor)
            .add(slGauss(l.sub(BAND.armA[0]).div(BAND.armA[1])).mul(BAND.armA[2]))
            .add(slGauss(l.sub(BAND.armB[0]).div(BAND.armB[1])).mul(BAND.armB[2]));
        const spine = exp(abs(bb).div(thick).negate()).mul(1 - BAND.skirt)
            .add(slGauss(bb.div(thick.mul(BAND.skirtWidth))).mul(BAND.skirt));
        const lit = spine.mul(arms).toVar();
        const bl = l.div(BAND.bulgeL);
        const bw = bb.div(BAND.bulgeB);
        const bulge = exp(bl.mul(bl).add(bw.mul(bw)).negate())
            .mul(BAND.bulge).toVar();

        // Star clouds: the band is not one smooth glow, but its mottling is soft and broad.
        const clouds = noiseSmooth(noise, vec2(lu.mul(5.0).add(0.4), b.mul(1.1).add(0.8)), 2).r.toVar();

        // Dust: the same reads as starlight-core.js dustTau. Its edges are drawn by extinction
        // (exp(−τ) of a depth that varies strongly), never by a narrow threshold: a cut-out of
        // fBm reads as torn paper or as cotton. It keeps to the plane, so the reads are skipped
        // wherever it cannot reach (most of the sky: the branch is coherent over wide regions).
        const tau = float(0.0).toVar();
        If(abs(b).lessThan(DUST.reach * 2.6), () => {
            // The dark clouds are bent by the same broad field.
            const bend = clouds.sub(0.5).mul(DUST.bend);
            const cloudAt = vec2(lu.mul(DUST.tilesL).add(bend), b.mul(DUST.tilesB).add(0.37).add(bend));
            const n1 = noiseSmooth(noise, cloudAt, 1).g.toVar();
            const fineAt = vec2(lu.mul(DUST.fineL).add(n1.mul(DUST.warp)), b.mul(DUST.fineB).add(0.11));
            const n2 = noiseSmooth(noise, fineAt, 0).b;
            const patch = n1.mul(0.68).add(n2.mul(0.32)).toVar();
            const clump = smoothstep(DUST.lo, DUST.hi, patch);
            tau.assign(clump.mul(clump).mul(DUST.patch));
            // The Great Rift: a lane along the plane that wanders a little and is widest at the
            // core, there for about half the band's length.
            const wander = noiseSmooth(noise, vec2(lu.mul(4.0), 0.62), 1).r.sub(0.5);
            const lane = b.sub(0.014).sub(sin(l.mul(3.0).add(1.1)).mul(0.024)).sub(wander.mul(DUST.wander)).toVar();
            const riftOn = noiseSmooth(noise, vec2(lu.mul(DUST.riftTiles), 0.15), 1).r;
            const there = max(smoothstep(0.38, 0.62, riftOn), slGauss(l.div(0.45))).toVar();
            const width = n1.mul(0.9).add(0.55).mul(DUST.riftWidth).mul(slGauss(l.div(0.6)).mul(0.7).add(1.0))
                .toVar();
            if (tier.dustDetail) {
                // Its edges are torn by a fine read, and threads drawn out along the band run off
                // the clouds: ridges of a smooth field, their sharpness the shader's own.
                const frayAt = vec2(lu.mul(DUST.frayL).add(n1.mul(0.25)), b.mul(DUST.frayB).add(0.53));
                const fray = noiseSmooth(noise, frayAt, 1).a;
                lane.addAssign(fray.sub(0.5).mul(width).mul(DUST.fray));
                // The threads run along the band (the read is drawn out 6:1), bend round the
                // clouds, and a second field switches each one on and off along its length.
                const strandAt = vec2(lu.mul(DUST.threadL), b.mul(DUST.threadB).add(n1.mul(0.35)).add(0.29));
                const strand = noiseSmooth(noise, strandAt, 2).b;
                // Cubed: a soft strand of smoke a few pixels wide, not a hairline crack.
                const ridge = abs(strand.mul(2.0).sub(1.0)).oneMinus();
                const runs = noiseSmooth(noise, vec2(lu.mul(9.0).add(0.71), b.mul(3.2).add(0.17)), 1).r;
                const near = smoothstep(0.3, 0.6, patch.add(there.mul(0.18))).mul(smoothstep(0.42, 0.62, runs));
                tau.addAssign(ridge.mul(ridge).mul(ridge).mul(near).mul(DUST.thread));
            }
            tau.addAssign(slGauss(lane.div(width)).mul(DUST.rift).mul(there));
            tau.mulAssign(slGauss(b.div(DUST.reach)));
        });
        // The share of the band's light the dust takes (the catalogue thins its stars by it).
        const dust = exp(tau.negate()).oneMinus().toVar();

        // Star clouds: where the broad field is high the disc is crowded with stars, and bright.
        const crowd = smoothstep(0.3, 0.78, clouds).toVar();
        const mottle = crowd.mul(crowd).mul(1.25).add(0.42);
        // The bulge is old and warm, the disc young and blue: the light takes the colour of
        // whichever gives more of it here, and a crowded star cloud is a warm white between them.
        const warmth = bulge.div(bulge.add(lit.mul(0.7)).add(0.04));
        const disc = mix(u.band, mix(u.band, u.core, 0.5), crowd.mul(0.7));
        const light = mix(disc, u.core, warmth)
            .mul(lit.mul(mottle).add(bulge.mul(clouds.mul(0.35).add(0.82)))).toVar();

        if (tier.detail) {
            // The band's own fine weave: a soft unevenness, never a speck.
            const weaveAt = vec2(lu.mul(44.0).add(clouds.mul(0.12)), b.mul(9.0).add(0.3));
            const n3 = texture(noise, weaveAt).level(soft.add(2.0)).a;
            light.mulAssign(n3.mul(0.3).add(0.85));
            // Star powder: the band is made of stars. Two grids of cells in the galaxy's own
            // coordinates, at most one star a cell, more of them where the band is crowded. They
            // are points, not texels, so they neither blur nor crawl as the sky turns; a long
            // exposure washes them into the glow. Most are faint (a steep share of bright ones),
            // so they read as the band's grain, not as salt over it.
            const dense = clamp(lit.mul(mottle).add(bulge).mul(0.5), 0.0, 0.9).toVar();
            const powder = (cells, seed, gain, floorShare, share) => {
                const size = TAU / cells;
                const g = vec2(l, b).div(size);
                const id = floor(g);
                const at = fract(g).sub(0.5);
                const place = vec2(slHash21(id.add(seed)), slHash21(id.add(seed + 17.3))).sub(0.5).mul(0.56);
                const away = at.sub(place).mul(size);
                const r = sized(u, 0.9, 0.62);
                const point = exp(away.dot(away).div(r.mul(r)).negate());
                const h = slHash21(id.add(seed + 41.9));
                const h3 = h.mul(h).mul(h);
                const power = h3.mul(h3).mul(h3).mul(gain).add(gain * floorShare);
                return point.mul(power).mul(step(slHash21(id.add(seed + 77.7)), dense.mul(share)));
            };
            const closed = u.shutter.oneMinus();
            // A fine grain nearly everywhere the band is crowded, and a sparse scatter of resolved
            // stars; none at all where the band is too thin to hold any.
            If(dense.greaterThan(0.004), () => {
                const specks = powder(3000, 3.1, 1.8, 0.03, 1.0).add(powder(1100, 9.7, 7.0, 0.0, 0.4))
                    .mul(closed.mul(closed));
                light.addAssign(mix(vec3(1.0, 0.86, 0.7), vec3(0.78, 0.87, 1.0), clouds).mul(specks).mul(u.starPower));
            });
        }
        // What the dust covers goes dark and red (blue is taken first).
        light.mulAssign(exp(vec3(1.0, 1.2, 1.45).mul(tau).negate()));

        if (tier.nebulae) {
            // The great nebulae (starlight-core.js NEBULAE): rose hydrogen clouds round the core
            // and along the arms, a blue reflection cloud and a golden glow above the core, a faint
            // arc of hydrogen bowing out below the band. Each is a soft body; two reads shared by
            // all of them cut it into filaments and a mottled cloud, read only where one is near
            // (every one of them lies inside |b| < 0.3 and |l| < 0.85: tests/unit/starlight-living).
            If(abs(b).lessThan(0.3).and(abs(l).lessThan(0.95)), () => {
                const rose = float(0.0).toVar();
                const blue = float(0.0).toVar();
                const gold = float(0.0).toVar();
                const heart = float(0.0).toVar();
                NEBULAE.forEach(([nl, nb, size, kind, power]) => {
                    const dl = l.sub(nl).div(size);
                    const db = b.sub(nb).div(size * 0.8);
                    const r2 = dl.mul(dl).add(db.mul(db));
                    const body = exp(r2.negate()).mul(power);
                    if (kind === 0) {
                        rose.addAssign(body);
                        heart.addAssign(exp(r2.mul(-5.0)).mul(power));
                    } else if (kind === 1) blue.addAssign(body);
                    else gold.addAssign(body);
                });
                const [arcL, arcB, arcR, arcW, arcSpan] = NEBULA_ARC;
                const ax = l.sub(arcL);
                const ay = b.sub(arcB);
                const round = atan(ax, ay.negate());
                rose.addAssign(slGauss(vec2(ax, ay).length().sub(arcR).div(arcW))
                    .mul(smoothstep(arcSpan, arcSpan * 0.5, abs(round))).mul(0.14));
                If(rose.add(blue).add(gold).greaterThan(0.004), () => {
                    // Both reads are of SMOOTH fields at mip 2 (a texel at least a pixel at the
                    // widest lens; the fine octaves of a level-0 or level-1 read stipple the cloud
                    // like fabric): the body, and the filaments warped by it.
                    const body = noiseSmooth(noise, vec2(lu.mul(24.0).add(0.13), b.mul(7.0).add(0.71)), 2).g.toVar();
                    const fine = noiseSmooth(noise, vec2(lu.mul(64.0).add(body.mul(0.3)), b.mul(19.0).add(0.4)), 2).r;
                    // Filaments: the ridge of a smooth field, sharpened in the shader; dark
                    // globules where the body read is lowest inside a cloud.
                    const ridge = abs(fine.mul(2.0).sub(1.0)).oneMinus().toVar();
                    const strands = ridge.mul(ridge).mul(ridge).mul(ridge);
                    const cloud = smoothstep(0.18, 0.82, body).toVar();
                    const globule = smoothstep(0.3, 0.14, body).mul(0.7).oneMinus();
                    // The cloud read draws each outline: a body reaches out where it is high and
                    // falls short where it is low, so no nebula is a round blob.
                    const shape = cloud.mul(1.3).add(0.3);
                    rose.assign(smoothstep(0.0, 1.0, rose.mul(shape)));
                    blue.assign(smoothstep(0.0, 1.0, blue.mul(shape)));
                    gold.assign(smoothstep(0.0, 1.0, gold.mul(shape)));
                    const shine = cloud.mul(0.5).add(strands.mul(0.95)).add(0.18).mul(globule);
                    // Part of the dust lies in front of them.
                    const veiled = exp(tau.mul(-0.45));
                    const hot = clamp(heart.mul(cloud.add(0.2)), 0.0, 1.0);
                    // Hydrogen is a deep rose; only the hottest heart pales toward white.
                    const hydrogen = mix(u.nebula, vec3(1.0, 0.12, 0.3), 0.35);
                    const roseLight = mix(hydrogen, vec3(1.0, 0.72, 0.82), hot.mul(hot).mul(0.6))
                        .mul(rose.mul(shine).add(heart.mul(cloud).mul(1.2)));
                    const blueLight = vec3(0.22, 0.42, 1.0).mul(blue).mul(cloud.mul(0.75).add(0.3));
                    const goldLight = vec3(1.0, 0.5, 0.16).mul(gold).mul(cloud.mul(0.5).add(0.45));
                    // A rose cloud outshines the band's grey behind it a little, so it reads as
                    // colour, not as pink paint over beige.
                    light.mulAssign(rose.mul(0.3).add(gold.mul(0.15)).oneMinus().max(0.55));
                    light.addAssign(roseLight.mul(1.75).add(blueLight.mul(1.5)).add(goldLight.mul(1.2)).mul(veiled));
                });
            });
            // Emission knots: a few small ones along the plane, at the lanes' edges, wisped by a
            // finer read (Medium and up) so each is a cloud with a bright heart, not a smudge.
            If(abs(b).lessThan(0.2), () => {
                const nm = noiseSmooth(noise, vec2(lu.mul(14.0).add(0.27), b.mul(3.6).add(0.63)), 1).b.toVar();
                const wisp = tier.detail
                    ? noiseSmooth(noise, vec2(lu.mul(40.0).add(nm.mul(0.4)), b.mul(10.0).add(0.41)), 0).a
                    : float(0.62);
                const knot = smoothstep(0.73, 0.96, nm).mul(slGauss(b.div(0.06))).mul(lit.add(0.25))
                    .mul(dust.mul(0.6).add(0.4))
                    .mul(wisp.mul(wisp).mul(1.6).add(0.25))
                    .toVar();
                light.addAssign(u.nebula.mul(knot).mul(0.62).add(vec3(1.0, 0.86, 0.9).mul(knot.mul(knot)).mul(0.34)));
            });
        }

        // The air between: the band drowns in the horizon's glow and thins toward it.
        const through = smoothstep(0.0, 0.2, up).mul(0.82).add(0.18);
        const milky = light.mul(u.bandPower).mul(u.surge.mul(0.75).add(1.0)).mul(through).mul(0.215);
        const sky = air.add(milky).toVar();

        // A fireball lights the air round it (a tight lobe: the light stays its own, it never tints
        // a third of the sky), and all of it a little. Two can be up at once (a great clear on the
        // heels of another): each keeps its own light until it has landed.
        const fireLight = (flash) => {
            const near = max(dot(d, flash.xyz), 0.0);
            return pow(near, 60.0).mul(0.2).add(pow(near, 40.0).mul(0.012)).add(0.0012)
                .mul(flash.w);
        };
        sky.addAssign(u.bolide.mul(fireLight(u.flash).add(fireLight(u.flashB))));

        // The zodiacal light: a cone of sunlit dust leaning up off the right-hand horizon along the
        // ecliptic, wide and warm at its foot, narrowing and fading as it climbs.
        const zx = az.sub(ZODIAC_AZ);
        const zAlong = zx.mul(ZODIAC_LEAN[0]).add(up.mul(ZODIAC_LEAN[1]));
        const zAcross = zx.mul(ZODIAC_LEAN[1]).sub(up.mul(ZODIAC_LEAN[0]));
        const zWide = exp(max(zAlong, 0.0).div(-0.42)).mul(0.17).add(0.05);
        const cone = slGauss(zAcross.div(zWide)).mul(exp(max(zAlong, 0.0).div(-0.5)))
            .mul(smoothstep(-0.02, 0.06, zAlong));
        sky.addAssign(mix(u.core, u.horizon, 0.3).mul(cone).mul(u.zodiac).mul(0.085));

        // The far shore's town: a faint warm dome of light over its lamps, behind the hills.
        sky.addAssign(LAMP_COLOUR.mul(slGauss(az.sub(TOWN_AZ).div(0.2)).mul(exp(up.div(-0.07)))).mul(TOWN_GLOW));

        // ── The high veil (the air's `veil`) ──
        // Cirrus drifting over (veilDensity: two layers of fibres at two speeds, so it forms and
        // melts as it goes). Lit from below by the hour's glow and, over the right-hand shore, by
        // the town: darker than the band it hides, paler than the dark sky round it. The stars
        // read the same density (starlight-stars.js), so they hide in it and shine in its gaps.
        If(u.air.y.greaterThan(0.002), () => {
            const dense = veilDensity(u, noise, d);
            const town = slGauss(az.sub(TOWN_AZ).div(0.35)).mul(exp(up.div(-0.2)));
            const under = u.mid.mul(4.2).add(u.horizon.mul(exp(up.div(-0.3))).mul(0.95))
                .add(LAMP_COLOUR.mul(town).mul(0.035));
            sky.assign(mix(sky, under, dense.mul(0.86)));
        });

        // ── Noctilucent cloud (the air's `shine`) ──
        // Silver-blue fibres low over the horizon, lit by a sun far below it. ONE read stretched
        // about ten to one along the horizon (long fibres, no two alike), its domain bent by a
        // slow warp, billows of one train only inside patches, and the sky MIXED toward the silver
        // (added to a rose afterglow it turns the pink white: gotcha #1400).
        If(u.shine.greaterThan(0.002).and(up.lessThan(0.3)), () => {
            // Its own deck, eighty kilometres up: seen from below its fibres lie along the horizon
            // and crowd toward it. The fibres are the RIDGES of a smooth field read about ten to
            // one along the horizon (thin bright threads, not blotches), bent by a slow warp.
            const deck = d.xz.div(up.add(0.02)).toVar();
            const warp = texture(noise, deck.mul(vec2(0.012, 0.04)).add(vec2(u.time.mul(0.0005), 0.27)))
                .level(2).b.toVar();
            const field = texture(noise, vec2(
                deck.x.mul(0.035).add(warp.mul(0.25)).sub(u.time.mul(0.0012)),
                deck.y.mul(0.34).add(warp.mul(0.9)).add(0.6),
            )).level(1).g;
            const ridge = abs(field.mul(2.0).sub(1.0)).oneMinus();
            const threads = ridge.mul(ridge).mul(ridge);
            // Where the layer is thick, and billows of one train across the threads in patches.
            const layer = texture(noise, deck.mul(vec2(0.02, 0.09)).add(vec2(0.4, 0.8))).level(2).r;
            const dense = smoothstep(0.38, 0.7, layer);
            const billows = sin(deck.x.mul(2.6).add(deck.y.mul(0.8)).add(warp.mul(6.0))).mul(0.5).add(0.5);
            const body = threads.mul(dense).mul(billows.mul(0.5).add(0.6)).add(dense.mul(0.12));
            const band = smoothstep(0.014, 0.045, up).mul(smoothstep(0.26, 0.09, up)).mul(slGauss(az.div(0.95)));
            const silver = vec3(0.52, 0.78, 1.0).mul(u.dusk.mul(0.17).add(0.055));
            sky.assign(mix(sky, silver, clamp(body.mul(band).mul(u.shine).mul(1.1), 0.0, 0.88)));
        });

        // ── A level-up's front ──
        // The next hour's light rolls up the sky as a front of airglow: green at its head, red
        // where it has passed, rippled like a curtain, a glow left behind it that fades with it.
        If(u.front.z.greaterThan(0.002), () => {
            const x = up.sub(u.front.x).div(u.front.y);
            const head = exp(x.mul(x).negate());
            const passed = smoothstep(0.6, -2.5, x).mul(0.22);
            const ripple = sin(az.mul(22.0).add(up.mul(70.0)).sub(u.time.mul(1.4))).mul(0.3).add(0.7);
            // In the colour of the hour it brings (its glow and airglow, at one brightness), so
            // every level's front is its own: teal, green, gold, rose, violet, cobalt.
            const hue = u.horizon.mul(0.6).add(u.airglow.mul(1.4));
            const tone = hue.div(max(slMax3(hue), 0.001)).mul(mix(1.0, 0.7, smoothstep(-0.4, -2.2, x)));
            sky.addAssign(tone.mul(head.mul(ripple).add(passed)).mul(u.front.z).mul(0.075));
        });

        // The far shore's lamps: a few warm points at the waterline, and the paths they lay on the
        // water (read along the view ray, below).
        const lamps = float(0.0).toVar();
        const wake = float(0.0).toVar();
        const viewAz = atan(view.x, view.z.negate());
        LAMPS.forEach(([lampAz, lampPower]) => {
            lamps.addAssign(slGauss(az.sub(lampAz).div(0.0019)).mul(lampPower));
            wake.addAssign(slGauss(viewAz.sub(lampAz).div(0.0024)).mul(lampPower));
        });

        // Everything that stands on the horizon or lies on the water is low: the hills, the woods
        // and the mist are read only there.
        If(d.y.lessThan(HORIZON_BAND), () => {
            // ── The horizon at three depths: a distant range, the far hills, the near crest ──
            const crest = ridges(noise, d).toVar();
            const fuzz = u.texel.mul(1.5);
            const range = smoothstep(crest.z.add(fuzz), crest.z.sub(fuzz), d.y).toVar();
            const farHill = smoothstep(crest.y.add(fuzz), crest.y.sub(fuzz), d.y);
            const nearHill = smoothstep(crest.x.add(fuzz), crest.x.sub(fuzz), d.y).toVar();
            // Woods along the near crest: a serrated edge of spruce, in stretches.
            If(d.y.lessThan(crest.x.add(WOODS_TREE)), () => {
                nearHill.assign(max(nearHill, woods(noise, d, az, crest.x, u.texel.mul(0.8))));
            });
            // A fireball lights their faces for the moment it is up.
            const lightning = u.bolide.mul(u.flash.w.add(u.flashB.w)).mul(0.006);
            // The range is the palest (the most air in front of it), and fades into the glow at
            // its foot. (A lit band along its tops reads as a neon outline: no snow line.)
            const foot = smoothstep(0.0, 0.03, d.y);
            const distant = u.horizon.mul(foot.mul(-0.12).add(0.4)).add(u.mid.mul(0.6)).add(u.ridge.mul(0.8))
                .add(lightning.mul(2.2));
            sky.assign(mix(sky, distant, range.mul(0.92)));
            const haze = u.horizon.mul(0.2).add(u.ridge).add(lightning.mul(1.6));
            sky.assign(mix(sky, haze, farHill));
            sky.assign(mix(sky, u.ridge.add(lightning), nearHill));

            // ── The mist on the water ──
            // A low bank on the lake and in the far shore's hollows, in front of the hills: thicker
            // in places, drifting slowly along the shore, lit by the hour's glow on the horizon
            // and, round each lamp, by the lamp. The lake mirrors it with everything else.
            const ua = az.div(TAU);
            const bank = noiseSmooth(noise, vec2(ua.mul(7.0).add(u.time.mul(0.0008)), 0.83), 1).g.toVar();
            const low = max(d.y, 0.0).toVar();
            // The air's mist lifts the bank higher and thickens it.
            const rise = u.air.z.mul(3.4).add(1.0);
            const veil = exp(low.div(bank.mul(bank).mul(0.03).mul(rise).add(u.air.z.mul(0.005))
                .add(0.004)).negate())
                .mul(bank.mul(0.75).add(0.25)).toVar();
            if (tier.airglow) {
                // Its own slow curls, drifting the other way.
                const curlAt = vec2(ua.mul(29.0).sub(u.time.mul(0.0015)), low.mul(36.0).add(0.3));
                const curl = texture(noise, curlAt).level(1.0).b;
                veil.mulAssign(curl.mul(0.8).add(0.6));
            }
            const halo = float(0.0).toVar();
            LAMPS.forEach(([lampAz, lampPower]) => {
                halo.addAssign(slGauss(az.sub(lampAz).div(u.air.z.mul(0.03).add(0.03))).mul(lampPower));
            });
            const lampGlow = exp(low.div(u.air.z.mul(-0.02).sub(0.012))).mul(u.air.z.mul(0.04).add(0.05));
            const mistLight = u.horizon.mul(0.85).add(u.mid).add(LAMP_COLOUR.mul(halo).mul(lampGlow));
            const thickness = clamp(veil.mul(MIST).mul(u.air.z.mul(0.35).add(1.0)), 0.0, u.air.z.mul(0.12).add(0.8));
            sky.assign(mix(sky, mistLight, thickness));
        });

        const lampHeight = slGauss(d.y.sub(0.0024).div(0.0017));
        const flicker = sin(u.time.mul(2.3).add(az.mul(700.0))).mul(0.08).add(0.92);
        sky.addAssign(LAMP_COLOUR.mul(lamps).mul(lampHeight).mul(flicker).mul(2.6));

        // ── The water ──
        const share = mirrorShare(view);
        const lake = sky.mul(share).add(u.water.mul(share.oneMinus().mul(2.4).add(0.25)));
        // The rings: each crest carries a faint line of its piece's colour (the bend it gives
        // the mirror does most of the drawing; a bright crest reads as a hoop laid on the water).
        const rings = vec3(ringLight(u, spot).mul(0.042)).toVar();
        // Each lamp lays a broken path of light toward the lens: bright where the water tilts
        // its way, gone where it tilts off.
        const tilt = clamp(along.mul(420.0).add(0.55), 0.0, 1.0);
        const path = wake.mul(exp(abs(view.y).div(-0.034))).mul(smoothstep(0.0, 0.004, abs(view.y))).mul(tilt);
        rings.addAssign(LAMP_COLOUR.mul(path).mul(0.42));
        // The far shore's mist: the mirror fades into the horizon's glow in its last sliver.
        const shore = exp(abs(view.y).div(-0.006));
        const water = mix(lake.add(rings), u.horizon.mul(0.55).add(u.ridge), shore.mul(0.6)).toVar();
        // The air's mist breathes over the water too, thickest far out.
        If(u.air.z.greaterThan(0.002), () => {
            const breath = exp(abs(view.y).div(-0.05)).mul(u.air.z).mul(0.42);
            water.assign(mix(water, u.horizon.mul(0.7).add(u.mid.mul(1.2)), breath));
        });

        return vec4(select(wet, water, sky), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    mesh.name = 'starlight-sky';

    return {
        object: mesh,
        update(camera) {
            mesh.position.copy(camera.position);
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
