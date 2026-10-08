/**
 * Cinder Drift — the lake.
 *
 * A lake of lava under a drifting crust. The crust is a mosaic of plates (a baked Voronoi with
 * true edge distances) that rides the flow from the great fall toward the viewer's right; the
 * seams between the plates are open lava. ONE number decides how much shows: the heat at a
 * point. Cold, the seams are hairlines; warmer, they open and the plates shrink to rafts; hot,
 * the lake stands open and white. Heat comes from the fall, from the shores, from slow
 * upwellings, from the chamber's pressure (a chain of clears), from the rings and waves the board
 * sends through it, and from the lake's own memory: every lock melts a pool that drifts with the
 * plates and takes a quarter of a minute to skin over.
 *
 * Far away the plates are smaller than a pixel, so the lake fades from the drawn seams to the
 * fraction of it that stands open at that heat: the glow keeps its energy to the far wall.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
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
    reflect,
    sin,
    smoothstep,
    texture,
    vec2,
    vec3,
} from 'three/tsl';
import {
    DRIFT_DIR, LAKE, PLATE_TILE, cdAtmosphere, cdClear, cdCurtain, cdGlowGain, cdHaze, cdHeatColor, cdPart, cdRings,
} from './cinder-drift-tsl.js';

/**
 * @param {object} u  shared uniforms
 * @param {object} [options]
 * @param {boolean} [options.fine=true]   hairline cracks inside the plates, ragged raft edges
 * @param {boolean} [options.glint=true]  the fall mirrored in the crust
 */
export function createLake(u, { fine = true, glint = true } = {}) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        LAKE.x0, 0, LAKE.z1, LAKE.x1, 0, LAKE.z1, LAKE.x1, 0, LAKE.z0, LAKE.x0, 0, LAKE.z0,
    ], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'CinderLake';
    material.fog = false;

    const D = vec2(DRIFT_DIR[0], DRIFT_DIR[1]);

    material.colorNode = Fn(() => {
        const p = positionWorld.toVar();
        const xz = p.xz.toVar();
        const rel = cameraPosition.sub(p).toVar();
        const dist = length(rel).toVar();
        const V = rel.div(dist).toVar();

        // ── Plate space: where the crust holds still ──
        const q = u.plateSpace(xz).toVar();
        // A T-spin turns the crust round the foot of the board: a whirl that winds up and lets go.
        const wRel = xz.sub(u.whirl.xy);
        const wAge = max(u.time.sub(u.whirl.z), 0.0);
        const wind = u.whirl.w.mul(exp(wAge.div(-1.7))).mul(float(1.0).sub(exp(wAge.mul(-5.0))))
            .mul(exp(dot(wRel, wRel).div(-380.0)));
        const cw = cos(wind);
        const sw = sin(wind);
        q.addAssign(vec2(wRel.x.mul(cw).sub(wRel.y.mul(sw)), wRel.x.mul(sw).add(wRel.y.mul(cw))).sub(wRel));
        // The chamber bends the mosaic as it passes (anchored to the world, not to the plates).
        const bend = u.noise(xz.mul(1 / 97)).rg.sub(0.5).mul(7.0);
        const qp = q.add(bend).toVar();
        const plate = texture(u.plateTex, qp.div(PLATE_TILE)).toVar();

        // ── Heat ──
        const shore = u.shore(xz);
        const nearRock = float(1.0).sub(smoothstep(0.0, 0.17, shore));
        const toFall = length(xz.sub(u.fallFoot.xz));
        const fallHeat = exp(toFall.div(-20.0)).mul(0.95).mul(u.fallGain).add(exp(toFall.div(-6.0)).mul(1.0));
        // Upwellings: slow patches of hotter lava that ride with the plates.
        const upwell = smoothstep(0.5, 0.8, u.noise(q.mul(1 / 67).add(vec2(u.flow.mul(0.003), 0.0))).b).mul(0.6);
        const memory = u.memory(q);

        const ringHeat = float(0.0).toVar();
        const ringTint = vec3(0.0).toVar();
        const ringFlash = vec3(0.0).toVar();
        If(u.ringsLive.greaterThan(0.5), () => {
            const rings = cdRings(u, p);
            ringHeat.assign(rings.heat);
            ringTint.assign(rings.tint);
            ringFlash.assign(rings.flash);
        });
        const wave = vec3(0.0).toVar();
        const afterglow = float(0.0).toVar();
        If(u.clearLive.greaterThan(0.5), () => {
            const c = cdClear(u, p);
            wave.assign(c.xyz);
            afterglow.assign(c.w);
        });
        const front = max(wave.x, max(wave.y, wave.z));

        const heat = float(0.16).add(upwell).add(fallHeat).add(nearRock.mul(0.42))
            .add(memory)
            .add(u.power.mul(0.4))
            .add(u.surge.mul(0.25))
            .add(ringHeat.mul(0.6))
            .add(afterglow.mul(0.22))
            .add(front.mul(0.5))
            .toVar();

        // ── How much of the lake stands open ──
        // The seam's half-width in the texture's edge units: a hairline cold, a river hot.
        const hot = max(heat.sub(0.75), 0.0);
        const width = float(0.014).add(heat.mul(0.082)).add(hot.mul(hot).mul(0.5)).add(front.mul(0.03))
            .toVar();
        const ragged = fine ? u.noise(qp.mul(1 / 5.3)).a.sub(0.5).mul(0.075) : float(0.0);
        const edge = plate.r.add(ragged).toVar();
        const open = float(1.0).sub(smoothstep(width.mul(0.5), width, edge));
        const closed = float(1.0).sub(clamp(width.div(0.84), 0.0, 1.0));
        const cover = float(1.0).sub(closed.mul(closed));
        const farAway = smoothstep(60.0, 180.0, dist).toVar();
        const molten = mix(open, cover, farAway).toVar();

        // ── Open lava: its skin flows faster than the crust rides ──
        const flowA = u.noise(xz.mul(1 / 12).sub(D.mul(u.flow.mul(0.045)))).r;
        const flowB = u.noise(xz.mul(1 / 4.4).sub(D.mul(u.flow.mul(0.1))).add(vec2(flowA.mul(0.12), 0.0))).g;
        const skin = flowA.mul(0.6).add(flowB.mul(0.4));
        const inSeam = float(1.0).sub(clamp(edge.div(max(width, 1e-3)), 0.0, 1.0));
        // Open lava is never a flat sheet: it skins over in small dark plates as fast as it is
        // exposed, and the skin tears along a finer net of bright cracks.
        const net = fine ? texture(u.plateTex, qp.div(PLATE_TILE / 3.3).add(vec2(0.37, 0.11))).r.toVar() : float(0.0);
        const skinned = fine
            ? smoothstep(0.07, 0.3, net).mul(smoothstep(0.35, 0.62, skin.add(heat.mul(-0.12)).add(0.22))).mul(float(1.0).sub(farAway))
            : float(0.0);
        const temp = float(0.46).add(heat.min(1.25).mul(0.3)).add(inSeam.mul(0.2)).add(skin.sub(0.5).mul(0.7))
            .sub(skinned.mul(0.42))
            .add(ringHeat.mul(0.4))
            .add(front.mul(0.3));
        const lava = cdHeatColor(u, temp).add(ringTint.mul(1.2)).add(wave.mul(1.1));

        // ── The crust ──
        const tilt = vec2(plate.g.sub(0.5), plate.a.sub(0.5));
        const grain = u.noise(qp.mul(1 / 2.9)).rg.sub(0.5);
        const n = normalize(vec3(
            tilt.x.mul(0.2).add(grain.x.mul(0.1)),
            1.0,
            tilt.y.mul(0.2).add(grain.y.mul(0.1)),
        )).toVar();
        // Heat soaks into a plate from its seams.
        const soak = exp(max(edge.sub(width), 0.0).mul(hot.mul(70.0).add(19.0)).negate());
        const glow = cdHeatColor(u, float(0.2).add(heat.min(1.0).mul(0.34)).add(front.mul(0.5))).mul(soak).mul(front.mul(1.5).add(0.95)).toVar();
        if (fine) {
            // A finer net of cracks inside every plate, alight where the lake is warm.
            const hair = float(1.0).sub(smoothstep(0.035, heat.mul(0.05).add(0.095), net))
                .mul(plate.g.mul(0.75).add(0.25))
                .mul(smoothstep(0.1, 0.34, edge));
            glow.addAssign(cdHeatColor(u, float(0.26).add(heat.mul(0.42))).mul(hair).mul(0.5));
        }
        // Basalt: glassy where it skinned over fast, dusted with ash toward the plate's heart.
        const albedo = u.rock.mul(plate.g.mul(0.9).add(0.45)).mul(grain.x.mul(0.3).add(1.0));
        const toKey = u.fallPos.sub(p);
        const keyDist2 = dot(toKey, toKey);
        const key = u.mid.mul(0.75).add(u.hot.mul(0.25)).mul(u.fallGain).mul(float(2400.0).div(keyDist2.add(900.0)));
        const lit = key.mul(max(dot(n, toKey.div(keyDist2.sqrt())), 0.0))
            .add(cdHaze(u, vec3(V.x.negate(), 0.2, V.z.negate()), 2.0).mul(0.8))
            .add(u.cool.mul(0.05))
            .add(cdCurtain(u, p, n))
            .add(ringFlash.mul(3.0));
        // The crust itself lights along a ring's front: the rock is being broken there.
        const crust = albedo.mul(lit).add(glow).add(u.mid.mul(ringHeat).mul(0.5)).add(ringTint.mul(0.5))
            .toVar();

        // The chamber mirrored in the glassy skin: its glow at a grazing angle, and the fall as a
        // long streak of light across the plates.
        const R = reflect(V.negate(), n);
        const cosV = clamp(dot(V, n), 0.0, 1.0);
        const m = float(1.0).sub(cosV);
        const fresnel = m.mul(m).mul(m).mul(m).mul(m)
            .mul(0.96)
            .add(0.04);
        const sheen = u.haze.mul(cdGlowGain(u)).mul(fresnel).mul(0.32).toVar();
        if (glint) {
            const toFoot = u.fallFoot.xz.sub(xz);
            const footDist = length(toFoot);
            const flat = max(length(R.xz), 1e-3);
            const aim = clamp(dot(R.xz.div(flat), toFoot.div(max(footDist, 1e-3))), 0.0, 1.0);
            const a2 = aim.mul(aim);
            const a8 = a2.mul(a2).mul(a2).mul(a2);
            const streak = a8.mul(a8).mul(a8).mul(a8).mul(a8)
                .mul(a8);
            const rise = R.y.div(flat);
            const tall = u.fallPos.y.mul(3.2).div(max(footDist, 1.0));
            const within = smoothstep(0.0, 0.02, rise).mul(float(1.0).sub(smoothstep(tall.mul(0.7), tall.mul(1.25), rise)));
            // (Only the plates that skinned over glassy mirror it.)
            const glassy = smoothstep(0.5, 0.85, plate.a);
            sheen.addAssign(u.mid.mul(0.7).add(u.hot.mul(0.3)).mul(streak.mul(within).mul(fresnel).mul(glassy).mul(u.fallGain)
                .mul(1.1)));
        }
        crust.addAssign(sheen.mul(float(1.0).sub(farAway.mul(0.6))));

        const col = mix(crust, lava, molten).mul(u.breath.mul(0.85).add(0.15));
        return cdAtmosphere(u, col, p);
    })();

    return cdPart('CinderLake', geometry, material, 2);
}
