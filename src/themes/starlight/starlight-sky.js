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
    mirrorShare, ridges, ringLight, sized, slGauss, slHash21, waterPoint, waterSlope,
} from './starlight-tsl.js';

const v3 = (a) => vec3(a[0], a[1], a[2]);

/** The far shore's lamps: (azimuth east of north in radians, brightness) each. */
const LAMPS = Object.freeze([[0.418, 1.0], [0.446, 0.6], [0.503, 0.8], [-0.612, 0.7]]);
const LAMP_COLOUR = vec3(1.0, 0.58, 0.22);

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

        // Dust: the same reads as starlight-core.js dustAt. Long lanes that keep to the plane.
        // Star clouds: the band is not one smooth glow, but its mottling is soft and broad.
        const clouds = texture(noise, vec2(lu.mul(5.0).add(0.4), b.mul(1.1).add(0.8)))
            .level(soft.mul(0.5).add(1.5)).r.toVar();
        // The lanes are bent by that same broad field (level 0 in the catalogue's copy: near enough).
        const bend = clouds.sub(0.5).mul(DUST.bend);
        const n1 = texture(noise, vec2(lu.mul(DUST.tilesL).add(bend), b.mul(DUST.tilesB).add(0.37).add(bend)))
            .level(soft.mul(0.5).add(1.0)).g.toVar();
        const n2 = texture(noise, vec2(lu.mul(DUST.fineL).add(n1.mul(DUST.warp)), b.mul(DUST.fineB).add(0.11)))
            .level(soft.add(1.0)).b.toVar();
        const lane = b.sub(0.014).sub(sin(l.mul(3.0).add(1.1)).mul(0.024));
        const riftOn = texture(noise, vec2(lu.mul(DUST.riftTiles), 0.15)).level(1.0).r;
        const there = max(smoothstep(0.4, 0.6, riftOn), slGauss(l.div(0.45)));
        const rift = slGauss(lane.div(DUST.riftWidth)).mul(DUST.rift).mul(there);
        const field = n1.mul(0.6).add(n2.mul(0.4)).add(rift).toVar();
        const reach = slGauss(b.div(DUST.reach)).toVar();
        const dust = smoothstep(DUST.lo, DUST.hi, field).mul(reach).toVar();

        const mottle = clouds.mul(0.9).add(0.55);
        // The bulge is old and warm, the disc young and blue: the light takes the colour of
        // whichever gives more of it here.
        const warmth = bulge.div(bulge.add(lit.mul(0.7)).add(0.04));
        const light = mix(u.band, u.core, warmth)
            .mul(lit.mul(mottle).add(bulge.mul(clouds.mul(0.35).add(0.82)))).toVar();

        if (tier.detail) {
            // The band's own fine weave: a soft unevenness, never a speck.
            const n3 = texture(noise, vec2(lu.mul(44.0).add(n2.mul(0.12)), b.mul(9.0).add(0.3))).level(soft.add(2.0)).a;
            light.mulAssign(n3.mul(0.26).add(0.87));
            // Star powder: the band is made of stars. Two grids of cells in the galaxy's own
            // coordinates, at most one star a cell, more of them where the band is bright. They
            // are points, not texels, so they neither blur nor crawl as the sky turns; a long
            // exposure washes them into the glow.
            const dense = clamp(lit.add(bulge).mul(0.5), 0.0, 0.85);
            const powder = (cells, seed, gain) => {
                const size = TAU / cells;
                const g = vec2(l, b).div(size);
                const id = floor(g);
                const at = fract(g).sub(0.5);
                const place = vec2(slHash21(id.add(seed)), slHash21(id.add(seed + 17.3))).sub(0.5).mul(0.56);
                const away = at.sub(place).mul(size);
                const r = sized(u, 0.9, 0.62);
                const point = exp(away.dot(away).div(r.mul(r)).negate());
                const h = slHash21(id.add(seed + 41.9));
                const power = h.mul(h).mul(h).mul(gain).add(gain * 0.045);
                return point.mul(power).mul(step(slHash21(id.add(seed + 77.7)), dense));
            };
            const closed = u.shutter.oneMinus();
            const specks = powder(2800, 3.1, 2.4).add(powder(1150, 9.7, 5.0)).mul(closed.mul(closed));
            light.addAssign(mix(vec3(1.0, 0.86, 0.7), vec3(0.78, 0.87, 1.0), clouds).mul(specks).mul(u.starPower));
        }
        // What the dust covers goes dark and red (blue is taken first)…
        light.mulAssign(exp(vec3(2.0, 2.35, 2.8).mul(dust).negate()));
        // …and the lanes' thin edges glow a little with the light behind them.
        const edge = dust.mul(dust.oneMinus()).mul(4.0);
        light.addAssign(u.core.mul(edge).mul(lit.add(bulge)).mul(0.03));

        if (tier.nebulae) {
            // Emission clouds: a few knots along the plane, at the lanes' edges.
            const nm = texture(noise, vec2(lu.mul(9.0).add(0.27), b.mul(2.4).add(0.63)))
                .level(soft.mul(0.5).add(1.5)).b;
            const knot = smoothstep(0.7, 0.94, nm).mul(slGauss(b.div(0.065))).mul(lit.add(0.2))
                .mul(dust.mul(0.5).add(0.5));
            light.addAssign(u.nebula.mul(knot).mul(0.5).add(vec3(1.0, 0.88, 0.92).mul(knot.mul(knot)).mul(0.3)));
        }

        // The air between: the band drowns in the horizon's glow and thins toward it.
        const through = smoothstep(0.0, 0.2, up).mul(0.82).add(0.18);
        const milky = light.mul(u.bandPower).mul(u.surge.mul(0.75).add(1.0)).mul(through).mul(0.215);
        const sky = air.add(milky).toVar();

        // A fireball lights the air round it, and all of it a little.
        const near = max(dot(d, u.flash.xyz), 0.0);
        const lit2 = pow(near, 60.0).mul(0.2).add(pow(near, 14.0).mul(0.012)).add(0.0012);
        sky.addAssign(u.meteor.mul(u.flash.w).mul(lit2));

        // ── The far hills: two crests, darker than the low sky behind them ──
        const crest = ridges(noise, d).toVar();
        const fuzz = u.texel.mul(1.5);
        const farHill = smoothstep(crest.y.add(fuzz), crest.y.sub(fuzz), d.y);
        const nearHill = smoothstep(crest.x.add(fuzz), crest.x.sub(fuzz), d.y);
        // A fireball lights their faces for the moment it is up.
        const lightning = u.meteor.mul(u.flash.w).mul(0.006);
        const haze = u.horizon.mul(0.2).add(u.ridge).add(lightning.mul(1.6));
        sky.assign(mix(sky, haze, farHill));
        sky.assign(mix(sky, u.ridge.add(lightning), nearHill));

        // The far shore's lamps: a few warm points at the waterline.
        const lampHeight = slGauss(d.y.sub(0.0024).div(0.0017));
        const lamps = float(0.0).toVar();
        const wake = float(0.0).toVar();
        const viewAz = atan(view.x, view.z.negate());
        LAMPS.forEach(([lampAz, lampPower]) => {
            lamps.addAssign(slGauss(az.sub(lampAz).div(0.0019)).mul(lampPower));
            wake.addAssign(slGauss(viewAz.sub(lampAz).div(0.0024)).mul(lampPower));
        });
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
