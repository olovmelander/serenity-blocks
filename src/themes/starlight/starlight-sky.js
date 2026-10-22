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
    BAND, DUST, GALAXY, TAU,
} from './starlight-core.js';
import {
    WOODS_TREE, mirrorShare, noiseSmooth, ridges, ringLight, sized, slGauss, slHash21, waterPoint, waterSlope,
    woods,
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
            // Emission clouds: a few small knots along the plane, at the lanes' edges, wisped by a
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
            // ── The far hills: two crests, darker than the low sky behind them ──
            const crest = ridges(noise, d).toVar();
            const fuzz = u.texel.mul(1.5);
            const farHill = smoothstep(crest.y.add(fuzz), crest.y.sub(fuzz), d.y);
            const nearHill = smoothstep(crest.x.add(fuzz), crest.x.sub(fuzz), d.y).toVar();
            // Woods along the near crest: a serrated edge of spruce, in stretches.
            If(d.y.lessThan(crest.x.add(WOODS_TREE)), () => {
                nearHill.assign(max(nearHill, woods(noise, d, az, crest.x, u.texel.mul(0.8))));
            });
            // A fireball lights their faces for the moment it is up.
            const lightning = u.bolide.mul(u.flash.w.add(u.flashB.w)).mul(0.006);
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
            const veil = exp(low.div(bank.mul(bank).mul(0.03).add(0.004)).negate())
                .mul(bank.mul(0.75).add(0.25)).toVar();
            if (tier.airglow) {
                // Its own slow curls, drifting the other way.
                const curlAt = vec2(ua.mul(29.0).sub(u.time.mul(0.0015)), low.mul(36.0).add(0.3));
                const curl = texture(noise, curlAt).level(1.0).b;
                veil.mulAssign(curl.mul(0.8).add(0.6));
            }
            const halo = float(0.0).toVar();
            LAMPS.forEach(([lampAz, lampPower]) => {
                halo.addAssign(slGauss(az.sub(lampAz).div(0.03)).mul(lampPower));
            });
            const mistLight = u.horizon.mul(0.85).add(u.mid)
                .add(LAMP_COLOUR.mul(halo).mul(exp(low.div(-0.012))).mul(0.05));
            sky.assign(mix(sky, mistLight, clamp(veil.mul(MIST), 0.0, 0.8)));
        });

        const lampHeight = slGauss(d.y.sub(0.0024).div(0.0017));
        const flicker = sin(u.time.mul(2.3).add(az.mul(700.0))).mul(0.08).add(0.92);
        sky.addAssign(LAMP_COLOUR.mul(lamps).mul(lampHeight).mul(flicker).mul(2.6));

        // ── The water ──
        const share = mirrorShare(view);
        const lake = sky.mul(share).add(u.water.mul(share.oneMinus().mul(2.4).add(0.25)));
        // The rings: each crest carries a line of its piece's colour.
        const rings = vec3(ringLight(u, spot).mul(0.16)).toVar();
        // Each lamp lays a broken path of light toward the lens: bright where the water tilts
        // its way, gone where it tilts off.
        const tilt = clamp(along.mul(420.0).add(0.55), 0.0, 1.0);
        const path = wake.mul(exp(abs(view.y).div(-0.034))).mul(smoothstep(0.0, 0.004, abs(view.y))).mul(tilt);
        rings.addAssign(LAMP_COLOUR.mul(path).mul(0.42));
        // The far shore's mist: the mirror fades into the horizon's glow in its last sliver.
        const shore = exp(abs(view.y).div(-0.006));
        const water = mix(lake.add(rings), u.horizon.mul(0.55).add(u.ridge), shore.mul(0.6));

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
