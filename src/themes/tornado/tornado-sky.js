/**
 * Tornado — the sky: a supercell's rotating base over a gap of clear evening air.
 *
 * One dome, drawn after the ground so only the pixels that show sky pay for it. Each pixel's ray
 * meets the cloud base (a plane at WORLD.cloudBase): the deck is read there in coordinates wound
 * round the funnel, faster toward the middle, as two cross-faded phases so the winding never
 * runs out. Past the storm's edge the air is clear: the low sun stands in that gap behind rain
 * shafts, shines in under the deck (lobes facing it glow, far cloud on its side burns, cloud on
 * the lee side stays slate) and throws shafts across the frame.
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
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
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
        air.assign(mix(air, u.skyTop, smoothstep(0.12, 0.6, up)));
        // The gap is brightest round the sun and deepens away from it.
        air.mulAssign(s1.mul(0.55).add(0.45));
        air.addAssign(u.sun.mul(s2.mul(0.2).add(s8.mul(0.45)).add(s64.mul(1.1))));

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
            .toVar();
        // The rain core: one heavy curtain that always hangs just left of the sun.
        const sunAz = atan(u.sunDir.x, u.sunDir.z.negate());
        const curtain = tnGauss(az.sub(sunAz.sub(0.125)).div(0.06)).mul(streak.mul(0.55).add(0.45))
            .mul(smoothstep(0.0, 0.025, up).mul(0.4).add(0.6));
        shaft.assign(max(shaft, curtain.mul(0.9)));
        air.assign(air.mul(shaft.mul(-0.78).add(1.0)).add(u.sun.mul(shaft).mul(s4).mul(0.26)));

        // The sun's disc: a hot heart, a coloured limb, veiled where a shaft hangs in front of it.
        const disc = smoothstep(0.99972, 0.99988, sunDot);
        const heart = smoothstep(0.99986, 0.99998, sunDot);
        air.addAssign(u.sun.mul(disc).mul(u.sunPower).mul(heart.mul(0.7).add(0.3)).mul(shaft.mul(-0.7).add(1.0)));

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

            const R = float(WORLD.stormRadius);
            const cover = smoothstep(R.mul(0.84), R.mul(1.03), r.add(dens.sub(0.5).mul(1200.0))).oneMinus();
            const col = mix(u.cloudDark, u.cloudMid, smoothstep(0.28, 0.78, dens)).toVar();

            // The low sun skims in under the deck from its own side.
            const under = max(R.sub(dot(rel, sunXZ)), 0.0);
            const skim = exp(under.div(-1500.0)).toVar();
            const facing = tier.relief ? clamp(relief.mul(3.4).add(0.3), 0.0, 1.0) : smoothstep(0.35, 0.8, dens);
            col.addAssign(u.cloudLit.mul(skim).mul(facing.mul(facing).mul(1.5).add(0.04)).mul(0.95));
            // The thin edge of the anvil catches the light.
            const edge = smoothstep(R.mul(0.55), R, r);
            col.addAssign(u.cloudRim.mul(edge.mul(edge)).mul(skim.mul(0.5).add(0.1)).mul(dens.add(0.4)));
            // The mesocyclone: a dark heart, plates stacked round it, a sick green when the chain runs.
            const meso = tnGauss(r.div(800.0));
            col.mulAssign(meso.mul(-0.5).add(1.0));
            const plates = sin(r.div(85.0).sub(dens.mul(7.0))).mul(0.5).add(0.5);
            col.mulAssign(plates.mul(exp(r.div(-1300.0))).mul(-0.22).add(1.0));
            col.assign(mix(col, col.mul(vec3(0.7, 1.18, 0.9)), u.fury.mul(0.55).mul(exp(r.div(-1500.0)))));
            // Light from inside.
            for (let i = 0; i < FLASHES; i += 1) {
                const f = u.flashes.element(i);
                const lit = exp(length(p.sub(f.xy)).div(max(f.w, 1.0)).negate()).mul(f.z);
                col.addAssign(u.bolt.mul(lit).mul(dens.mul(0.4).add(0.05)));
            }
            const fogged = exp(reach.div(-7000.0)).oneMinus();
            col.assign(mix(col, u.haze.mul(0.8), fogged.mul(0.85)));
            sky.assign(mix(sky, col, cover));
        });

        // Shelter belts on the horizon: a ragged dark line, taller here and there.
        const belt = texture(noise, vec2(ua.mul(23.0), 0.11)).level(0.0).r;
        const twig = texture(noise, vec2(ua.mul(140.0), 0.53)).level(0.0).g;
        const crest = smoothstep(0.44, 0.7, belt).mul(0.0075).add(twig.mul(0.0035)).add(0.002);
        const trees = smoothstep(crest.sub(0.0014), crest, d.y).oneMinus();
        sky.assign(mix(sky, u.haze.mul(0.2).add(u.gapLow.mul(0.06)), trees.mul(0.92)));

        // Shafts of sun under the deck, fanned out from the disc.
        const sr = normalize(vec3(u.sunDir.z.negate(), 0.0, u.sunDir.x));
        const su = sr.cross(u.sunDir);
        const fan = atan(dot(d, su), dot(d, sr)).div(TAU).toVar();
        const rn = texture(noise, vec2(fan.mul(9.0), u.wind.mul(0.004))).level(1.0).r
            .mul(0.65)
            .add(texture(noise, vec2(fan.mul(31.0), 0.7)).level(0.0).g.mul(0.35));
        const rays = smoothstep(0.38, 0.86, rn).mul(s2).mul(s64.oneMinus()).mul(u.rays);
        sky.addAssign(u.sun.mul(rays).mul(0.2));

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
