/**
 * Supernova — prominences: arches of plasma that stand on the star.
 *
 * A prominence is a ribbon along a closed-form arch between two feet on the photosphere. It
 * rises fast, holds, and then rains back: its light breaks into beads that the arch lets go of.
 * The star always has a few of its own; every lock that lands raises one in the piece's colour,
 * where the stream came down.
 *
 * The arch lives in the star's frame, so it turns with the star and scales with it (a collapse
 * takes its prominences in with it). Where an arch passes behind the star it is hidden by
 * testing the star's sphere, since nothing here writes depth.
 *
 * Nothing is created at event time: preallocated slots, always drawn (a dormant slot collapses
 * to zero width). A new arch takes a slot nothing stands in, else the one nearest its end.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    exp,
    float,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    LOOP_LIFE,
    LOOP_SEGMENTS,
    LOOP_SLOTS,
    snFxMaterial,
    snPart,
    snPastStar,
    snRidge,
    snStripGeometry,
} from './supernova-tsl.js';

/** A point of the arch at `s` (0 = one foot, 1 = the other), in the star's frame at radius 1. */
export function loopPoint(mid, tangent, span, height, lean, s, out = [0, 0, 0]) {
    const theta = (s - 0.5) * Math.PI;
    const along = Math.sin(theta);
    const lift = Math.cos(theta);
    const ca = Math.cos(span * along);
    const sa = Math.sin(span * along);
    // The third axis of the arch's own frame.
    const bx = mid[1] * tangent[2] - mid[2] * tangent[1];
    const by = mid[2] * tangent[0] - mid[0] * tangent[2];
    const bz = mid[0] * tangent[1] - mid[1] * tangent[0];
    const r = 1 + height * lift;
    const side = Math.sin(lean) * height * lift;
    out[0] = (mid[0] * ca + tangent[0] * sa) * r + bx * side;
    out[1] = (mid[1] * ca + tangent[1] * sa) * r + by * side;
    out[2] = (mid[2] * ca + tangent[2] * sa) * r + bz * side;
    return out;
}

/**
 * @param {object} u shared uniforms
 * @param {number} [slots]
 */
export function createLoops(u, slots = LOOP_SLOTS) {
    const count = Math.max(1, Math.min(LOOP_SLOTS, slots));
    const aFoot = new Float32Array(count * 4);
    const aArc = new Float32Array(count * 4);
    const aLook = new Float32Array(count * 4);
    const aMisc = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        aFoot.set([0, 1, 0, -100], i * 4);
        aArc.set([1, 0, 0, 0.3], i * 4);
        aMisc.set([0, 0, LOOP_LIFE, 0], i * 4);
    }
    const geometry = snStripGeometry(count, LOOP_SEGMENTS, {
        aFoot: [aFoot, 4], aArc: [aArc, 4], aLook: [aLook, 4], aMisc: [aMisc, 4],
    });
    ['aFoot', 'aArc', 'aLook', 'aMisc'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const foot = attribute('aFoot', 'vec4');
    const arc = attribute('aArc', 'vec4');
    const look = attribute('aLook', 'vec4');
    const misc = attribute('aMisc', 'vec4');

    const material = snFxMaterial('SupernovaLoops');
    const age = u.time.sub(foot.w);
    const lifetime = max(misc.z, 0.1);
    const spent = age.div(lifetime);
    const alive = step(0.0, age).mul(step(spent, 1.0));
    // It leaps up and settles; near the end it sags back toward the surface.
    const rise = float(1.0).sub(exp(max(age, 0.0).mul(-3.2)));
    const sag = float(1.0).sub(smoothstep(0.7, 1.0, spent).mul(0.35));
    const reach = look.w.mul(rise).mul(sag);
    const third = cross(foot.xyz, arc.xyz);
    const archAt = (s) => {
        const theta = s.sub(0.5).mul(Math.PI);
        const along = sin(theta);
        const lift = cos(theta);
        const turn = arc.w.mul(along);
        const radial = foot.xyz.mul(cos(turn)).add(arc.xyz.mul(sin(turn)));
        return radial.mul(float(1.0).add(reach.mul(lift))).add(third.mul(sin(misc.x).mul(reach).mul(lift)));
    };
    const s = positionGeometry.x;
    const local = archAt(s);
    const ahead = archAt(s.add(0.02));
    const world = u.centre.add(u.starRot.mul(local).mul(u.starR));
    const worldAhead = u.centre.add(u.starRot.mul(ahead).mul(u.starR));
    const along = normalize(worldAhead.sub(world).add(vec3(1e-6, 0.0, 0.0)));
    const side = normalize(cross(along, world.sub(cameraPosition)).add(vec3(0.0, 1e-6, 0.0)));
    // Thick over the top of the arch, drawn in to a point at each foot.
    const top = cos(s.sub(0.5).mul(Math.PI));
    const girth = misc.y.mul(u.starR).mul(float(0.7).add(top.mul(1.5))).mul(alive);
    const placed = world.add(side.mul(positionGeometry.y).mul(girth));
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(placed, 1.0));

    const vWorld = varying(placed, 'snLoopWorld');
    const vAlong = varying(s, 'snLoopS');
    const vAcross = varying(positionGeometry.y, 'snLoopY');
    const vLife = varying(spent, 'snLoopLife');
    const vTint = varying(look.rgb, 'snLoopTint');
    const vSeed = varying(misc.w, 'snLoopSeed');
    const vAlive = varying(alive, 'snLoopAlive');

    material.colorNode = Fn(() => {
        const y = clamp(vAcross, -1.0, 1.0);
        const sAlong = clamp(vAlong, 0.0, 1.0);
        // Plasma running along the arch, from one foot toward the other.
        const flow = u.noise(vec3(
            sAlong.mul(0.9).sub(u.time.mul(0.11)).add(vSeed),
            y.mul(0.07).add(vSeed.mul(1.7)),
            vSeed.mul(3.1).add(u.time.mul(0.03)),
        )).toVar();
        const strand = snRidge(flow.r);
        const strands = strand.mul(strand).mul(0.9).add(flow.g.mul(0.5)).add(0.15);
        // The arch is a braid, not a hoop: three fibres wander across the ribbon's width as they
        // go, each on a slow field of its own, inside a faint sheath.
        const sway = u.noise(vec3(
            sAlong.mul(0.5).add(vSeed.mul(1.3)),
            vSeed.mul(2.3),
            u.time.mul(0.03).add(vSeed.mul(5.0)),
        )).toVar();
        const fibre = (where, tightness) => {
            const off = y.sub(where.sub(0.5).mul(1.9));
            return exp(off.mul(off).mul(tightness).negate());
        };
        const braid = fibre(sway.r, 70.0).add(fibre(sway.g, 110.0).mul(0.8)).add(fibre(sway.b, 45.0).mul(0.55));
        const within = float(1.0).sub(y.mul(y));
        const core = braid.add(exp(y.mul(y).mul(-3.0)).mul(0.1)).mul(within.mul(within));
        // At the end the arch rains: its light breaks into beads.
        const rain = smoothstep(0.55, 0.95, vLife);
        const beads = smoothstep(rain.mul(0.75), rain.mul(0.75).add(0.2), flow.b.add(0.12));
        const fade = smoothstep(0.0, 0.05, vLife).mul(float(1.0).sub(smoothstep(0.82, 1.0, vLife)));
        // White where it has just risen, its own colour as it stands, embers as it falls.
        const young = float(1.0).sub(smoothstep(0.0, 0.16, vLife));
        const tint = mix(mix(vTint, u.starDeep, rain.mul(0.5)), vec3(1.0, 0.96, 0.9), young.mul(0.7));
        const feet = smoothstep(0.0, 0.05, sAlong).mul(smoothstep(0.0, 0.05, float(1.0).sub(sAlong)));
        // Brightest where it leaves the surface, thinning over the top.
        const over = sAlong.mul(float(1.0).sub(sAlong)).mul(4.0);
        const gain = strands.mul(core).mul(beads).mul(fade).mul(feet)
            .mul(float(1.0).sub(over.mul(over).mul(0.72)))
            .mul(float(1.9).add(young.mul(3.0)));
        const seen = snPastStar(u, vWorld);
        return vec4(tint.mul(gain).mul(seen).mul(vAlive).mul(u.starGain), 0.0);
    })();

    const part = snPart('SupernovaLoops', geometry, material, 30);
    const names = ['aFoot', 'aArc', 'aLook', 'aMisc'];
    // Ten slots of sixteen numbers: the whole of each buffer goes up when a slot changes.
    const touch = () => names.forEach((name) => {
        geometry.getAttribute(name).needsUpdate = true;
    });
    /**
     * Raise a prominence. `mid` and `tangent` are unit vectors of the star's frame (the middle of
     * the arch on the surface, and the way its feet lie apart), `span` the half-angle between
     * the feet, `height` in star radii.
     */
    part.spawn = ({
        mid, tangent, span = 0.32, height = 0.6, lean = 0, width = 0.09, rgb = [1, 0.5, 0.2], time = 0,
        life = LOOP_LIFE, seed = 0,
    }) => {
        // A slot no arch is standing in; else the arch with the least of its life left.
        let slot = 0;
        let least = Infinity;
        for (let i = 0; i < count; i++) {
            const left = aFoot[i * 4 + 3] + aMisc[i * 4 + 2] - time;
            if (left < least) {
                least = left;
                slot = i;
            }
        }
        aFoot.set([mid[0], mid[1], mid[2], time], slot * 4);
        aArc.set([tangent[0], tangent[1], tangent[2], span], slot * 4);
        aLook.set([rgb[0], rgb[1], rgb[2], height], slot * 4);
        aMisc.set([lean, width, life, seed], slot * 4);
        touch();
        return slot;
    };
    part.reset = () => {
        for (let i = 0; i < count; i++) {
            aFoot[i * 4 + 3] = -100;
            aMisc[i * 4 + 2] = LOOP_LIFE;
        }
        touch();
    };
    /** How many arches are standing at `time`. */
    part.standing = (time) => {
        let n = 0;
        for (let i = 0; i < count; i++) {
            const lived = (time - aFoot[i * 4 + 3]) / Math.max(0.1, aMisc[i * 4 + 2]);
            if (lived >= 0 && lived <= 1) n += 1;
        }
        return n;
    };
    part.count = count;
    return part;
}
