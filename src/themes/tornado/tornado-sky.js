/**
 * Tornado — the sky: a supercell's rotating base over a gap of clear evening air.
 *
 * One dome, drawn after the ground so only the pixels that show sky pay for it. Each pixel's ray
 * meets the cloud base (a plane at WORLD.cloudBase): the deck is read there in coordinates wound
 * round the funnel, faster toward the middle, as two cross-faded phases so the winding never
 * runs out. Past the storm's edge the air is clear: the low sun stands in that gap behind rain
 * shafts, shines in under the deck (lobes facing it glow, far cloud on its side burns, cloud on
 * the lee side stays slate) and throws shafts across the frame.
 *
 * The storm has a structure: round its heart the base is stacked in TIERS (rings whose sunward
 * slopes the low sun catches), and out under the anvil hang fields of MAMMATUS, lit from below.
 * And it has weather of its own (u.weather, tornado-core.js weatherAt): the rain core drifts
 * along the horizon, the storm's edge breathes so the bright gap opens and narrows, the mammatus
 * comes and goes, a squall hazes the far deck. A perfect clear parts the deck from the sun's side
 * (u.open); four lines send a ring of light out through it from the heart (u.pulse).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    length,
    max,
    min,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    step,
    sqrt,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { TAU, WORLD } from './tornado-core.js';
import { FLASHES, tnGauss } from './tornado-tsl.js';

/** Radians the deck's middle winds through in one cross-fade phase. */
const WINDING = 4.4;

const rot = (v, ang) => {
    const c = cos(ang);
    const s = sin(ang);
    return vec2(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)));
};

export function createSky({ u, noise, tier }) {
    const geometry = new THREE.SphereGeometry(8000, 32, 16);
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });

    /** The deck at a wound point: (coarse body, full density). */
    const deck = (q) => {
        const a = texture(noise, q.div(5200.0)).r;
        const b = texture(noise, q.div(1300.0).add(a.mul(0.15))).g;
        const coarse = a.mul(0.6).add(b.mul(0.4));
        if (!tier.detail) return { coarse, full: coarse };
        const c = texture(noise, q.div(310.0)).a;
        return { coarse, full: a.mul(0.52).add(b.mul(0.34)).add(c.mul(0.14)) };
    };

    material.fragmentNode = Fn(() => {
        const d = normalize(positionWorld.sub(cameraPosition)).toVar();
        const up = clamp(d.y, 0.0, 1.0).toVar();
        const sunDot = dot(d, u.sunDir).toVar();
        const s1 = clamp(sunDot, 0.0, 1.0).toVar();
        const s2 = s1.mul(s1).toVar();
        const s4 = s2.mul(s2).toVar();
        const s8 = s4.mul(s4).toVar();
        const s64 = s8.mul(s8).mul(s8).mul(s8).mul(s8)
            .mul(s8)
            .mul(s8)
            .mul(s8)
            .toVar();

        // ── Clear air beyond the storm ──
        const air = mix(u.gapLow, u.gapHigh, smoothstep(0.0, 0.16, up)).toVar();
        air.assign(mix(air, u.skyTop, smoothstep(0.07, 0.42, up)));
        // The gap is brightest round the sun and deepens away from it.
        air.mulAssign(s1.mul(0.55).add(0.45));
        air.addAssign(u.sun.mul(s2.mul(0.2).add(s8.mul(0.45)).add(s64.mul(1.1))));
        // High cirrus, far above the storm: what the sky shows where the deck has parted.
        const cirrusAt = d.xz.div(d.y.add(0.22)).mul(0.19).add(vec2(u.wind.mul(0.0006), 0.0));
        const cirrus = smoothstep(0.5, 0.82, texture(noise, cirrusAt).r).mul(smoothstep(0.03, 0.2, up));
        air.addAssign(u.cloudLit.mul(0.6).add(u.cloudRim.mul(0.4)).mul(cirrus).mul(s1.mul(0.6).add(0.18))
            .mul(0.55));

        // Rain shafts hanging in the gap, thickest between the funnel and the sun.
        const az = atan(d.x, d.z.negate()).toVar();
        const ua = az.div(TAU).toVar();
        const broad = texture(noise, vec2(ua.mul(5.0).add(u.wind.mul(0.0015)), 0.31)).level(1.0).r;
        const falling = vec2(ua.mul(70.0).sub(up.mul(7.0)), up.mul(1.2).add(u.wind.mul(0.03)));
        const streak = texture(noise, falling).level(0.0).g;
        const shaft = smoothstep(0.4, 0.68, broad).mul(streak.mul(0.5).add(0.5))
            .mul(mix(0.3, 1.0, smoothstep(-0.05, 0.25, az)))
            .mul(smoothstep(0.0, 0.05, up).mul(0.5).add(0.5))
            .mul(u.fury.mul(0.4).add(0.8))
            .mul(u.weather.y)
            .toVar();
        // The rain core: a heavy curtain that hangs left of the sun and drifts along the horizon
        // with the weather, and a second, wider one out toward the funnel.
        const sunAz = atan(u.sunDir.x, u.sunDir.z.negate());
        const veiled = streak.mul(0.55).add(0.45).mul(smoothstep(0.0, 0.025, up).mul(0.4).add(0.6)).toVar();
        const core = az.sub(sunAz).add(0.15).sub(u.weather.x).toVar();
        const curtain = tnGauss(core.div(0.065)).add(tnGauss(core.add(0.5).div(0.15)).mul(0.6));
        shaft.assign(max(shaft, curtain.mul(veiled).mul(u.weather.y).mul(0.9)).min(1.0));
        // A squall over the lens veils the whole gap.
        shaft.assign(max(shaft, u.squall.mul(veiled).mul(0.62)));
        air.assign(air.mul(shaft.mul(-0.78).add(1.0)).add(u.sun.mul(shaft).mul(s4).mul(0.3)));

        // The sun's disc: a clean limb, darker toward it, a hot heart, barred by thin strata low
        // in the air and veiled where a shaft hangs in front of it.
        const disc = smoothstep(0.99982, 0.99988, sunDot);
        const heart = smoothstep(0.99985, 0.99999, sunDot);
        const strata = smoothstep(0.52, 0.7, texture(noise, vec2(ua.mul(2.0), d.y.mul(26.0).add(u.wind.mul(0.0011)))).level(0.0).r);
        air.addAssign(u.sun.mul(disc).mul(u.sunPower).mul(heart.mul(0.55).add(0.45))
            .mul(strata.mul(-0.42).add(1.0))
            .mul(shaft.mul(-0.75).add(1.0)));

        const sky = vec3(air).toVar();

        // ── The cloud base ──
        If(d.y.greaterThan(0.004), () => {
            const reach = float(WORLD.cloudBase).sub(cameraPosition.y).div(d.y).toVar();
            const p = cameraPosition.xz.add(d.xz.mul(reach)).toVar();
            const rel = p.sub(u.axis.xz).toVar();
            const r = length(rel).toVar();
            const sunXZ = normalize(u.sunDir.xz).toVar();
            const omega = float(1.0).div(r.div(650.0).mul(r.div(650.0)).add(1.0)).toVar();

            const dens = float(0.0).toVar();
            const relief = float(0.0).toVar();
            const read = (phase, weight) => {
                const ang = u.deckTurn.add(phase.sub(0.5).mul(WINDING).mul(omega)).toVar();
                const q = rot(rel, ang).toVar();
                const here = deck(q);
                dens.addAssign(here.full.sub(0.5).mul(weight));
                if (tier.relief) {
                    const toward = deck(q.add(rot(sunXZ, ang).mul(150.0)));
                    relief.addAssign(here.coarse.sub(toward.coarse).mul(weight));
                }
            };
            if (tier.shear) {
                const ph1 = u.deck.fract().toVar();
                const ph2 = u.deck.add(0.5).fract().toVar();
                const w1 = abs(ph1.mul(2.0).sub(1.0)).oneMinus().toVar();
                const w2 = w1.oneMinus().toVar();
                read(ph1, w1);
                read(ph2, w2);
                // Two fields averaged lose contrast: put it back.
                const norm = sqrt(w1.mul(w1).add(w2.mul(w2)));
                dens.assign(dens.div(norm));
                relief.assign(relief.div(norm));
            } else {
                read(float(0.5), float(1.0));
            }
            dens.addAssign(0.5);

            // The storm's edge breathes with the weather; a perfect clear parts the deck from the
            // sun's side, back toward the funnel.
            const R = float(WORLD.stormRadius).mul(u.weather.z).toVar();
            const radial = rel.div(max(r, 1.0)).toVar();
            const sunward = dot(radial, sunXZ).toVar();
            const parted = u.open.mul(smoothstep(-0.55, 0.7, sunward)).mul(1750.0);
            const cover = smoothstep(R.mul(0.84), R.mul(1.03), r.add(parted).add(dens.sub(0.5).mul(1200.0))).oneMinus();
            const col = mix(u.cloudDark, u.cloudMid, smoothstep(0.28, 0.78, dens)).toVar();

            // The low sun skims in under the deck from its own side.
            const under = max(R.sub(dot(rel, sunXZ)), 0.0);
            const skim = exp(under.div(-1500.0)).toVar();
            const facing = tier.relief ? clamp(relief.mul(3.4).add(0.3), 0.0, 1.0) : smoothstep(0.35, 0.8, dens);
            col.addAssign(u.cloudLit.mul(skim).mul(facing.mul(facing).mul(1.5).add(0.04)).mul(0.95));
            // The thin edge of the anvil catches the light.
            const edge = smoothstep(R.mul(0.55), R, r);
            col.addAssign(u.cloudRim.mul(edge.mul(edge)).mul(skim.mul(0.5).add(0.1)).mul(dens.add(0.4)));
            // The mesocyclone: a dark heart, and round it the base stacked in TIERS: smooth rings
            // whose slopes toward the low sun burn and whose lee slopes fall into shade (which
            // side is which turns over across the heart), sharper as the storm winds up.
            const meso = tnGauss(r.div(800.0));
            col.mulAssign(meso.mul(-0.5).add(1.0));
            const tierAt = r.div(19.0).add(sin(r.div(83.0)).mul(1.5)).sub(dens.mul(8.0)).toVar();
            // (Uneven spacing, and broken into arcs by the deck's own lobes: even rings out to
            // the storm's edge read as a pressed record.)
            const tiered = smoothstep(260.0, 620.0, r).mul(exp(r.div(-900.0)))
                .mul(smoothstep(0.34, 0.62, dens).mul(0.75).add(0.25))
                .mul(u.fury.mul(0.6).add(0.8))
                .toVar();
            const tierLit = cos(tierAt).mul(sunward).toVar();
            col.mulAssign(sin(tierAt).mul(0.5).add(0.5).mul(tiered)
                .mul(-0.3)
                .add(1.0));
            col.addAssign(u.cloudLit.mul(max(tierLit, 0.0)).mul(tiered).mul(skim.mul(0.85).add(0.07)).mul(0.9));
            col.mulAssign(min(tierLit, 0.0).mul(tiered).mul(0.45).add(1.0));
            if (tier.detail) {
                // Mammatus: pouches hanging under the base on the sun's side of the storm's heart,
                // in fields that come and go, each lit on the side the low sun reaches (a second
                // read a little toward it). A flat deck seen from the side is all streaks: the
                // pouches are the one thing overhead that is round.
                const qm = rot(rel, u.deckTurn).div(560.0).toVar();
                const pouch = texture(noise, qm).bias(1.7).b.toVar();
                const field = smoothstep(330.0, 760.0, r).mul(smoothstep(-0.35, 0.4, sunward)).mul(u.weather.w)
                    .mul(smoothstep(0.36, 0.56, texture(noise, qm.mul(0.17).add(0.37)).r))
                    .toVar();
                const hang = smoothstep(0.3, 0.74, pouch).toVar();
                const shade = tier.relief
                    ? clamp(pouch.sub(texture(noise, qm.add(rot(sunXZ, u.deckTurn).mul(0.07))).bias(1.7).b).mul(3.4).add(0.4), 0.0, 1.0)
                    : hang;
                // Dark creases between the pouches, each pouch a lit belly.
                col.assign(mix(col, col.mul(hang.mul(0.55).add(0.4))
                    .add(u.cloudLit.mul(shade.mul(hang)).mul(skim.mul(1.3).add(0.14)).mul(0.62))
                    .add(u.cloudRim.mul(shade.mul(shade)).mul(hang).mul(skim.add(0.05)).mul(0.16)), field));
            }
            col.assign(mix(col, col.mul(vec3(0.7, 1.18, 0.9)), u.fury.mul(0.55).mul(exp(r.div(-1500.0)))));
            // Four lines: a ring of light runs out through the base from the storm's heart.
            const ring = tnGauss(r.sub(u.pulse.x).div(u.pulse.z)).mul(u.pulse.y);
            col.addAssign(u.pulseRgb.mul(ring).mul(dens.mul(0.9).add(0.25)));
            // A wound-up storm: the colours the funnel holds burn in the deck round its heart,
            // brightest in the thick lobes (nothing at rest: the charge is zero).
            col.addAssign(u.charge.mul(exp(r.div(-1100.0))).mul(dens.mul(0.9).add(0.15)));
            // Light from inside.
            for (let i = 0; i < FLASHES; i += 1) {
                const f = u.flashes.element(i);
                const lit = exp(length(p.sub(f.xy)).div(max(f.w, 1.0)).negate()).mul(f.z);
                col.addAssign(u.bolt.mul(lit).mul(dens.mul(0.4).add(0.05)));
            }
            const fogged = exp(reach.div(u.squall.mul(-4200.0).add(7000.0)).negate()).oneMinus();
            col.assign(mix(col, u.haze.mul(0.8), fogged.mul(0.85)));
            sky.assign(mix(sky, col, cover));
        });

        // Shelter belts on the horizon, two lines of them. A single row of smoothed bumps read as a
        // row of identical tents: each belt is now trees, rounded crowns of their own heights in
        // stretches broken by open fields, the far one lower, fainter and lost in the haze.
        const px = u.pixelAngle.mul(1.2).max(0.0004).toVar();
        const hash = (k) => sin(k.mul(12.9898)).mul(43758.5453).fract();
        const beltLine = (count, seedShift, base, tall, stretch) => {
            // Two sets of crowns of different spacing, merged: trees of many widths overlapping.
            const tree = (n, shift) => {
                const x = ua.mul(n).add(shift).toVar();
                const k = x.floor();
                const f = x.fract().mul(2.0).sub(1.0);
                const crown = float(1.0).sub(f.mul(f)).max(0.0).sqrt();
                // Most are broad crowns, a few tall poplars, some missing.
                const kind = hash(k.add(71.0));
                const height = hash(k).mul(0.55).add(0.45)
                    .mul(mix(float(1.0), float(1.8), step(0.9, kind)))
                    .mul(step(0.12, kind));
                return crown.mul(height);
            };
            const crowns = max(tree(count, float(seedShift)), tree(count.mul(1.73), float(seedShift + 0.41)).mul(0.85));
            // Twigs and leaves along the top edge.
            const ragged = texture(noise, vec2(ua.mul(count.mul(0.9)), 0.61)).level(0.0).a.sub(0.5).mul(0.35);
            const present = smoothstep(0.34, 0.5, texture(noise, vec2(ua.mul(stretch).add(seedShift), 0.37)).level(0.0).r);
            return crowns.add(ragged.mul(crowns.min(1.0))).mul(tall).add(base).mul(present);
        };
        const farCrest = beltLine(float(1900.0), 0.31, 0.0016, 0.0042, 9.0);
        const farTrees = smoothstep(farCrest.sub(px), farCrest, d.y).oneMinus().mul(step(0.0002, farCrest));
        sky.assign(mix(sky, mix(sky, u.haze.mul(0.45).add(u.gapLow.mul(0.12)), 0.6), farTrees));
        const nearCrest = beltLine(float(1000.0), 0.77, 0.003, 0.012, 6.0);
        const nearTrees = smoothstep(nearCrest.sub(px), nearCrest, d.y).oneMinus().mul(step(0.0002, nearCrest));
        sky.assign(mix(sky, u.haze.mul(0.2).add(u.gapLow.mul(0.06)), nearTrees.mul(0.92)));

        // Shafts of sun under the deck, fanned out from the disc.
        const sr = normalize(vec3(u.sunDir.z.negate(), 0.0, u.sunDir.x));
        const su = sr.cross(u.sunDir);
        const fan = atan(dot(d, su), dot(d, sr)).div(TAU).toVar();
        // Broad shafts with a few fine ones in them, strongest low over the field and gone high
        // under the deck (a fan of thin spokes across the whole frame read as a lens filter).
        const rn = texture(noise, vec2(fan.mul(5.0), u.wind.mul(0.004))).level(1.0).r
            .mul(0.72)
            .add(texture(noise, vec2(fan.mul(19.0), u.wind.mul(0.0023).add(0.7))).level(0.0).g.mul(0.28));
        const rays = smoothstep(0.42, 0.9, rn).mul(s2).mul(s64.oneMinus()).mul(u.rays)
            .mul(exp(up.mul(-2.6)).mul(0.85).add(0.15));
        sky.addAssign(u.sun.mul(rays).mul(0.26));

        return vec4(sky, 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 30;
    mesh.name = 'tornado-sky';

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
