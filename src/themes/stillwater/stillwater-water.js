/**
 * Stillwater — the tarn.
 *
 * Black, still water that holds the whole night upside down. The distance (sky, moon, the far
 * wood) is mirrored exactly: the water calls the sky function along its own mirror ray, so the
 * picture in the tarn is as sharp as the one above it and bends with every ripple. What stands
 * IN the scene (the banks, the trunks, the troll, the spirit, every light in flight) comes from
 * a planar reflector() that renders only those things, with alpha, at reduced resolution; the
 * water lays it over the mirrored distance. Lower tiers skip that pass.
 *
 * The lights that live here lie on the water as long columns (the lantern, the spirit, every
 * wisp), which a mirror alone would show only as dots.
 *
 * Gameplay writes onto it: a ring is a real ripple (a packet of wavelets that bends the mirror)
 * and carries its colour on its crest; a clear draws bow strokes across the whole tarn.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    abs,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    int,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    reflect,
    reflector,
    screenUV,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    RING_SLOW,
    RING_SPEED,
    SHORE_SPAN,
    STROKE_GAP,
    STROKE_SPEED,
    TAU,
    swBackdrop,
    swBell,
    swFog,
    swFresnel,
    swPart,
} from './stillwater-tsl.js';

/**
 * @param {object} u  shared uniforms
 * @param {object} [opts]
 * @param {number} [opts.mirrorScale=0]  reflector resolution scale (0 = no pass: mirrored distance only)
 * @param {boolean} [opts.lite=false]    the cut-down sky function in the mirror
 * @param {boolean} [opts.glitter=true]  the fine ripple that breaks bright things into sparks
 * @param {boolean} [opts.columns=true]  the lights' long reflections
 */
export function createWater(u, opts = {}) {
    const mirrorScale = opts.mirrorScale ?? 0;
    const lite = opts.lite === true;
    const glitter = opts.glitter !== false;
    const columns = opts.columns !== false;
    const reflection = mirrorScale > 0
        ? reflector({ resolutionScale: mirrorScale, bounces: false, generateMipmaps: false })
        : null;
    if (reflection) {
        reflection.target.rotateX(-Math.PI / 2);
        reflection.target.name = 'StillwaterReflectorTarget';
    }

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StillwaterWater';
    material.fog = false;
    material.toneMapped = false;

    material.fragmentNode = Fn(() => {
        const p = positionWorld;
        const rel = p.sub(cameraPosition).toVar();
        const dist = length(rel).toVar();
        const V = rel.div(dist).toVar();
        const st = p.xz.toVar();

        // ── The surface's slope: all but still, a breath of air in patches ──
        // (The noise is never magnified far: a stretched texel shows in a mirror as a facet.)
        const w1 = u.noise(st.mul(0.047).add(vec2(u.drift.mul(0.0031), u.drift.mul(0.0019)))).toVar();
        const w2 = u.noise(st.mul(0.19).sub(vec2(u.drift.mul(0.0093), u.drift.mul(-0.0057)))).toVar();
        const patch = smoothstep(0.44, 0.74, u.noise(st.mul(0.011).add(vec2(0.37, u.drift.mul(0.0007)))).b).toVar();
        const slope = w1.rg.sub(0.5).mul(0.2)
            .add(w2.ba.sub(0.5).mul(patch.mul(0.5).add(0.08)))
            .toVar();
        if (glitter) {
            const w3 = u.noise(st.mul(0.83).add(vec2(u.drift.mul(0.023), u.drift.mul(0.017))));
            slope.addAssign(w3.rg.sub(0.5).mul(patch.mul(0.34).add(0.03)));
        }
        slope.mulAssign(u.wind.mul(0.065).add(0.008).mul(u.ruffle));

        // ── Rings: a packet of wavelets behind a crisp front, shorter the further behind ──
        const eventLight = vec3(0.0).toVar();
        Loop({
            start: int(0), end: int(u.counts.x), type: 'int', condition: '<', name: 'rg',
        }, ({ rg }) => {
            const A = u.rings.element(rg.mul(2));
            const C = u.rings.element(rg.mul(2).add(1));
            const age = u.time.sub(A.z).toVar();
            const radius = float(RING_SPEED * RING_SLOW).mul(float(1.0).sub(exp(age.div(-RING_SLOW)))).mul(C.w).toVar();
            const o = st.sub(A.xy).toVar();
            const d = max(length(o), 1e-3).toVar();
            /** Metres behind the front. */
            const back = radius.sub(d).toVar();
            const live = step(0.0, age).mul(exp(age.mul(-0.38))).mul(A.w).div(radius.mul(0.16).add(1.0))
                .toVar();
            const packet = smoothstep(-0.22, 0.0, back).mul(exp(max(back, 0.0).mul(-0.62))).mul(live).toVar();
            const phase = back.mul(back.mul(0.42).add(3.4));
            slope.addAssign(o.div(d).mul(sin(phase)).mul(packet).mul(0.2));
            // The colour rides the first crest and the two behind it.
            const crest = swBell(back.sub(0.08).div(0.17)).add(cos(phase).mul(0.5).add(0.5).mul(0.14)).mul(packet);
            eventLight.addAssign(C.xyz.mul(crest).mul(0.75));
        });

        // ── A clear's swells: fronts that leave the tarn's heart (behind the card) for the banks ──
        Loop({
            start: int(0), end: int(u.counts.y), type: 'int', condition: '<', name: 'sk',
        }, ({ sk }) => {
            const A = u.strokes.element(sk.mul(2));
            const C = u.strokes.element(sk.mul(2).add(1));
            const age = u.time.sub(A.x).toVar();
            const o = st.sub(u.heartAt.xz).toVar();
            const from = max(length(o), 1e-3).toVar();
            const back = age.mul(STROKE_SPEED).sub(from).toVar();
            const inside = step(0.0, back).mul(step(back, A.y.mul(STROKE_GAP))).mul(step(0.0, age));
            const fade = exp(age.mul(-0.45)).mul(A.z).mul(inside).toVar();
            const phase = back.div(STROKE_GAP).toVar();
            slope.addAssign(o.div(from).mul(sin(phase.mul(TAU))).mul(fade).mul(0.13));
            // Each front carries a thread of light on its crest.
            const crest = swBell(phase.fract().sub(0.25).div(0.11)).mul(fade);
            eventLight.addAssign(C.xyz.mul(crest).mul(A.w.mul(0.5).add(0.38)));
        });

        // ── The mirror ──
        const N = normalize(vec3(slope.x.negate(), 1.0, slope.y.negate())).toVar();
        const cosT = clamp(dot(V, N).negate(), 0.0, 1.0).toVar();
        // Peat-black water mirrors more than clear water does: what is not mirrored is dark.
        const fres = clamp(swFresnel(cosT, 0.02).mul(0.62).add(0.4), 0.0, 1.0).toVar();
        const R = reflect(V, N).toVar();
        const Rup = normalize(vec3(R.x, max(R.y, 0.0).add(0.002), R.z)).toVar();
        const mirror = swBackdrop(u, Rup, { lite, soft: 2.2 }).toVar();
        const shoreM = u.shore(st).sub(0.5).mul(SHORE_SPAN * 2).toVar();
        if (!reflection) {
            // No pass to mirror the banks: the water under them still takes the wood's dark.
            const under = smoothstep(-6.0, -0.4, shoreM).mul(0.72);
            mirror.assign(mix(mirror, u.forest.mul(0.7).add(mirror.mul(0.12)), under));
        }
        if (reflection) {
            // Far water is seen edge-on: its slopes shift the mirror less on screen.
            const reach = float(1.0).div(dist.mul(0.05).add(1.0));
            // (However many rings cross, the picture in the water is bent, never torn.)
            const bend = clamp(vec2(slope.x, slope.y.mul(1.8)), vec2(-0.09), vec2(0.09));
            const ruv = screenUV.flipX().add(bend.mul(reach).mul(1.3));
            const held = vec4(reflection.sample(ruv)).toVar();
            mirror.assign(mirror.mul(float(1.0).sub(clamp(held.a, 0.0, 1.0))).add(max(held.rgb, vec3(0.0))));
        }

        // ── The water's own colour: black, brown-gold where the bed comes up to the bank ──
        const depth = max(shoreM.negate(), 0.0).mul(0.34);
        const shallow = exp(depth.mul(-3.2));
        const bed = u.ground.mul(u.skyAmb.mul(1.6).add(u.moonLight.mul(0.2))).mul(1.4);
        const body = mix(u.deep.mul(0.75), bed, shallow.mul(0.55)).toVar();
        const col = mix(body, mirror, fres).mul(u.breath.mul(0.25).add(0.75)).toVar();

        // ── The gold heart on the tarn's bed: when a chain has woken it, its light comes up through
        // the water in a net of bright threads, strongest over the heart itself ──
        If(u.heartAt.w.greaterThan(0.004), () => {
            const toHeart = st.sub(u.heartAt.xz).toVar();
            const spread = exp(dot(toHeart, toHeart).mul(-0.0075));
            const n1 = u.noise(st.mul(0.11).add(vec2(u.drift.mul(0.006), u.drift.mul(-0.004))).add(slope.mul(1.5)));
            const n2 = u.noise(st.mul(0.23).sub(vec2(u.drift.mul(0.009), u.drift.mul(0.007))).add(slope.mul(2.0)));
            const net = float(1.0).sub(abs(n1.r.mul(2.0).sub(1.0))).mul(float(1.0).sub(abs(n2.g.mul(2.0).sub(1.0))));
            const threads = net.mul(net).mul(net).mul(3.2).add(0.3);
            col.addAssign(u.heart.mul(u.heartAt.w).mul(spread).mul(threads).mul(float(1.0).sub(fres.mul(0.45)))
                .mul(0.85));
        });

        // ── The lights' long reflections ──
        if (columns) {
            const eye = cameraPosition;
            const column = (at, power, colour, spread) => {
                const ground = at.xz;
                const toLight = ground.sub(eye.xz);
                const span = max(length(toLight), 1e-2);
                const axis = toLight.div(span);
                // Where a flat mirror would show the light…
                const h = max(at.y, 0.02);
                const image = eye.xz.add(toLight.mul(eye.y.div(eye.y.add(h))));
                const off = st.sub(image);
                // …and how the ripples draw it out: a long way toward the viewer, a little beyond.
                const along = dot(off, axis).add(slope.y.mul(9.0));
                const across = dot(off, vec2(axis.y.negate(), axis.x)).add(slope.x.mul(7.0));
                const reachNear = h.mul(2.2).add(1.4).mul(spread);
                const reachFar = h.mul(0.5).add(0.5).mul(spread);
                const a = along.div(mix(reachNear, reachFar, step(0.0, along)));
                const w = span.mul(0.006).add(0.05).mul(spread);
                const b = across.div(w);
                return colour.mul(exp(a.mul(a).negate()).mul(exp(b.mul(b).negate())).mul(power));
            };
            const lights = vec3(0.0).toVar();
            lights.addAssign(column(u.lanternAt.xyz, u.lanternAt.w.mul(1.1), u.lantern, 0.9));
            lights.addAssign(column(u.spiritAt.xyz, u.spiritAt.w.mul(0.6), u.spirit, 1.1));
            Loop({
                start: int(0), end: int(u.counts.z), type: 'int', condition: '<', name: 'wp',
            }, ({ wp }) => {
                const A = u.wisps.element(wp.mul(2));
                const C = u.wisps.element(wp.mul(2).add(1));
                lights.addAssign(column(A.xyz, A.w.mul(0.42), C.xyz, 0.5));
            });
            col.addAssign(lights.mul(fres).mul(u.breath));

            // The moon's road on the water: flecks of its light between its image and the viewer.
            const flat = max(length(u.moonDir.xz), 1e-3);
            const axis = u.moonDir.xz.div(flat);
            const image = eye.xz.add(axis.mul(eye.y.mul(flat).div(max(u.moonDir.y, 0.03))));
            const off = st.sub(image);
            const along = dot(off, axis);
            const across = dot(off, vec2(axis.y.negate(), axis.x)).add(slope.x.mul(14.0));
            // (It runs from the moon's image a good part of the way to the viewer, never under their feet.)
            const reachTo = length(image.sub(eye.xz));
            const road = exp(across.mul(across).mul(-3.2)).mul(smoothstep(0.8, -0.6, along))
                .mul(smoothstep(reachTo.mul(-0.85), reachTo.mul(-0.25), along));
            // Short dashes lying across the line of sight, coming and going.
            // (Their grid shrinks toward the viewer, so a fleck is a fleck at any range.)
            const grid = vec2(across.mul(1.5), along.mul(5.5)).mul(float(9.0).div(max(dist, 2.0)));
            const f1 = u.noise(grid.mul(0.31).add(vec2(u.drift.mul(0.009), u.drift.mul(0.027)))).r;
            const f2 = u.noise(grid.mul(0.77).sub(vec2(u.drift.mul(0.015), u.drift.mul(0.021)))).g;
            const fleck = smoothstep(0.52, 0.72, f1.mul(f2).mul(2.5));
            col.addAssign(u.moon.mul(road).mul(fleck).mul(fres).mul(u.breath)
                .mul(0.3));
        }

        // ── Gameplay light riding the water itself ──
        col.addAssign(eventLight.mul(u.breath).mul(0.9));

        // A thread of light where the water meets the bank.
        const edge = swBell(shoreM.add(0.05).div(0.09)).mul(0.5);
        col.addAssign(u.skyAmb.mul(edge).mul(0.5));

        return vec4(swFog(u, col, p, 0.8), 1.0);
    })();

    const geometry = new THREE.PlaneGeometry(900, 900, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -300);
    const part = swPart('StillwaterWater', geometry, material, 30);
    part.reflection = reflection;
    part.reflectorTarget = reflection ? reflection.target : null;
    return part;
}
