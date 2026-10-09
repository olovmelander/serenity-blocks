/**
 * Void Ember — the ember itself: a dying star's photosphere and its corona.
 *
 * The photosphere is a real sphere shaded in the star's own frame, so its markings turn with it
 * and go round the limb. One number, `heat`, decides what it is: at rest a banked coal, more than
 * half of it a dark crust of cooled plates with fire showing in the cracks between; blown on, the
 * crust breaks up and sinks, the convection cells under it brighten from red through gold, and
 * past white-hot the whole face is a furnace. Each piece that lands leaves a flash in its own
 * colour, a ripple that runs out over the surface, and a scar that stays hot for a while.
 *
 * The corona is one camera-facing sheet behind the limb: the fiery fringe of the chromosphere, a
 * tight inner glow, and streamers that reach further and whiter the hotter the star is. The
 * depth test hides it behind anything that crosses in front.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    abs,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
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
    positionGeometry,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    EMBER, IMPACT_FADE, IMPACT_SPEED, veBell, veBlackbody, veFxMaterial, veGlow, vePart, veSolidMaterial,
} from './void-ember-tsl.js';

// ── Photosphere ─────────────────────────────────────────────────────────────────

/** 1 on the half-way contour of a noise field, 0 at its extremes: where a hairline runs. */
const ridge = (n) => float(1.0).sub(abs(n.mul(2.0).sub(1.0)));
const pow8 = (x) => {
    const a = x.mul(x);
    const b = a.mul(a);
    return b.mul(b);
};

/**
 * @param {object} u  shared uniforms
 * @param {object} opts
 * @param {number} [opts.detail=3]     0 = three noise reads, 1 = four, 2 = five, 3 = six
 * @param {number} [opts.segments=96]  sphere tessellation
 */
export function createPhotosphere(u, { detail = 3, segments = 96 } = {}) {
    const geometry = new THREE.SphereGeometry(1, segments, Math.round(segments * 0.6));
    const material = veSolidMaterial('VoidEmberPhotosphere');

    material.colorNode = Fn(() => {
        // The point in the star's own frame, and how squarely it faces the camera.
        const p = normalize(positionLocal).toVar();
        const N = normalize(positionWorld.sub(u.centre)).toVar();
        const V = normalize(cameraPosition.sub(positionWorld));
        const mu = clamp(dot(N, V), 0.0, 1.0).toVar();
        const heat = u.heat.toVar();

        // ── What the surface is made of ──
        // A slow warp carries every pattern: plates and cells are torn, never round.
        const warp = detail >= 1
            ? u.noise3(p.mul(2.6).add(vec3(3.1, u.boil.mul(0.03), 7.7))).toVar()
            : vec2(0.5, 0.5).toVar();
        const pw = p.add(vec3(warp.x.sub(0.5), warp.y.sub(0.5), warp.x.sub(warp.y)).mul(0.3)).toVar();
        // The crust: plates whose coast is broken at every scale (octaves of the lattice).
        const o1 = u.noise3(pw.mul(2.1).add(vec3(11.3, 4.1, u.boil.mul(0.01)))).toVar();
        const o2 = u.noise3(pw.mul(5.3).add(vec3(u.boil.mul(0.022), 21.0, 5.3))).toVar();
        const o3 = detail >= 2
            ? u.noise3(pw.mul(12.7).add(vec3(1.7, u.boil.mul(0.05), 33.0))).toVar()
            : vec2(0.5, 0.5).toVar();
        const field = o1.x.mul(0.56).add(o2.x.mul(0.29)).add(o3.x.mul(0.15)).toVar();
        // Heat decides how much of the star the crust still covers.
        const edge = mix(float(0.56), float(0.26), smoothstep(0.15, 1.1, heat)).toVar();
        const crust = float(1.0).sub(smoothstep(edge.sub(0.035), edge.add(0.035), field)).toVar();
        // Fire in the cracks between the plates: hairline ridges at two scales.
        // (Without the third octave its ridge would be a constant 1: fire all over the crust.)
        const hairlines = detail >= 2 ? max(pow8(ridge(o2.y)), pow8(ridge(o3.y)).mul(0.8)) : pow8(ridge(o2.y));
        const cracks = hairlines.mul(smoothstep(0.12, 0.55, o1.y)).toVar();

        // Convection cells: bright tops parted by a net of thin dark lanes.
        const g1 = u.noise3(pw.mul(o1.y.mul(10.0).add(27.0)).add(vec3(0.0, 0.0, u.boil.mul(0.16)))).toVar();
        const lx = ridge(g1.x);
        const ly = ridge(g1.y);
        const lanes = max(lx.mul(lx).mul(lx), ly.mul(ly).mul(ly).mul(0.7)).toVar();
        if (detail >= 3) {
            const g2 = u.noise3(pw.mul(71.0).add(vec3(u.boil.mul(0.3), 9.0, 0.0)));
            const lf = ridge(g2.x);
            lanes.assign(max(lanes, lf.mul(lf).mul(0.45)).add(g2.y.sub(0.5).mul(0.16)));
        }
        const cells = float(1.0).sub(lanes.mul(0.92));

        // ── Its temperature ──
        const shore = veBell(field.sub(edge).div(0.07));
        const hot = heat.add(cells.sub(0.66).mul(0.7)).add(o1.y.sub(0.5).mul(0.26)).add(shore.mul(0.12));
        const cold = heat.mul(0.5).sub(0.085).add(cracks.mul(heat.mul(0.6).add(0.44))).add(o3.x.sub(0.5).mul(0.05));
        const T = mix(hot, cold, crust).toVar();

        // ── What the board has done to it ──
        const struck = vec3(0.0).toVar();
        Loop({
            start: int(0), end: u.impactCount, type: 'int', condition: '<', name: 'hit',
        }, ({ hit }) => {
            const A = u.impacts.element(hit.mul(2));
            const C = u.impacts.element(hit.mul(2).add(1));
            const age = max(u.time.sub(A.w), 0.0).toVar();
            const born = step(A.w, u.time).mul(C.w);
            // Chord from the site: the same as the arc while it is small.
            const d = length(p.sub(A.xyz)).toVar();
            const flash = exp(d.mul(d).div(age.mul(0.02).add(0.005)).negate()).mul(exp(age.div(-0.22)));
            const front = d.sub(age.mul(IMPACT_SPEED));
            const ring = veBell(front.div(age.mul(0.06).add(0.08))).mul(exp(age.mul(-IMPACT_FADE)));
            const rim = veBell(front.div(age.mul(0.012).add(0.022))).mul(exp(age.mul(-IMPACT_FADE)));
            const scar = exp(d.mul(d).mul(-46.0)).mul(exp(age.div(-7.0)));
            T.addAssign(ring.mul(0.4).add(scar.mul(0.3)).add(flash.mul(0.5)).mul(born));
            // White-hot where it struck and the piece's colour round it; the ripple itself is the
            // star's own fire brightening, with only a breath of that colour at its front.
            struck.addAssign(C.rgb.mul(flash.mul(2.8).add(rim.mul(0.2)))
                .add(vec3(1.0, 0.9, 0.74).mul(flash.mul(flash).mul(4.5)))
                .mul(born));
        });

        // The limb is cooler and dimmer: the eye reads the ball from it.
        const rim = float(1.0).sub(mu);
        T.subAssign(rim.mul(rim).mul(0.34));
        const light = veGlow(T).mul(mu.pow(0.7).mul(0.74).add(0.26));
        const col = veBlackbody(T).mul(light).add(struck.mul(mu.mul(0.6).add(0.4))).toVar();
        return vec4(col.mul(u.breath), 1.0);
    })();

    const part = vePart('VoidEmberPhotosphere', geometry, material, 0);
    part.mesh.matrixAutoUpdate = false;
    return part;
}

// ── Corona ──────────────────────────────────────────────────────────────────────

/**
 * @param {object} u
 * @param {object} opts
 * @param {number} [opts.detail=2]  0 = one noise read, 1 = two, 2 = three
 */
export function createCorona(u, { detail = 2 } = {}) {
    const reach = EMBER.coronaReach;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = veFxMaterial('VoidEmberCorona');
    const uniforms = {
        /** Where the limb stands in the sheet's own units (perspective makes it a hair wider). */
        limb: uniform(1.016),
        /** The star's axis as the camera sees it, in the sheet. */
        axis: uniform(new THREE.Vector2(0, 1)),
        /** How far the streamers reach (0..1) and how bright the whole corona is. */
        reach: uniform(0.3),
        gain: uniform(0.4),
    };

    // A sheet through the star's centre, square to the line of sight.
    const viewCentre = cameraViewMatrix.mul(vec4(u.centre, 1.0)).xyz;
    const size = u.radius.mul(reach * 2);
    material.vertexNode = cameraProjectionMatrix.mul(vec4(
        viewCentre.add(vec3(positionGeometry.xy.mul(size), 0.0)),
        1.0,
    ));

    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(reach * 2).toVar();
        const b = max(length(q).div(uniforms.limb), 1e-4).toVar();
        const out = max(b.sub(1.0), 0.0).toVar();
        const dir = q.div(length(q).add(1e-5)).toVar();
        // A T-spin winds the corona into a pinwheel: the further out, the further round.
        const turn = u.twist.mul(out);
        const cs = cos(turn);
        const sn = sin(turn);
        const d2 = vec2(dir.x.mul(cs).sub(dir.y.mul(sn)), dir.x.mul(sn).add(dir.y.mul(cs))).toVar();
        const { heat } = u;

        // Streamers: noise that changes fast round the star and slowly along the ray, streaming out.
        const wide = u.noise3(vec3(d2.mul(2.1), out.mul(0.42).sub(u.flow.mul(0.03)).add(5.0))).toVar();
        let fine = float(0.5);
        if (detail >= 1) {
            fine = u.noise3(vec3(d2.mul(7.5), out.mul(1.3).sub(u.flow.mul(0.1)))).x;
        }
        let hair = float(0.5);
        if (detail >= 2) {
            hair = u.noise3(vec3(d2.mul(23.0), out.mul(3.2).sub(u.flow.mul(0.3)).add(u.boil.mul(0.2)))).x;
        }
        // The long ones stand off the star's equator; fine plumes at its poles.
        const lat = abs(dot(d2, uniforms.axis));
        const belt = float(1.0).sub(lat.mul(lat).mul(0.62));
        const stream = wide.x.mul(wide.x).mul(wide.x).mul(2.6).mul(belt)
            .add(fine.mul(fine).mul(0.55))
            .toVar();

        // The fringe of fire at the limb, the tight inner glow, the long reach.
        const fringe = exp(out.mul(-34.0)).mul(hair.mul(1.5).add(0.35)).mul(heat.mul(1.5).add(0.5));
        const inner = exp(out.mul(mix(float(12.0), float(9.0), uniforms.reach)).negate());
        const far = float(1.0).div(float(1.0).add(out.mul(mix(float(3.4), float(1.25), uniforms.reach))).pow(3.0));
        const body = inner.mul(stream.mul(0.6).add(0.4)).mul(0.6).add(far.mul(stream).mul(uniforms.reach.mul(2.2).add(0.14)));
        const k = body.mul(uniforms.gain).add(fringe.mul(0.5))
            .mul(smoothstep(0.93, 1.0, b))
            .mul(float(1.0).sub(smoothstep(reach * 0.62, reach * 0.98, b)));
        // Hot at the limb, cooling as it thins.
        const T = heat.mul(0.92).add(0.12).sub(out.mul(0.085)).add(stream.mul(0.07));
        const col = veBlackbody(T).mul(k);
        return vec4(col.mul(u.breath), 0.0);
    })();

    const part = vePart('VoidEmberCorona', geometry, material, 10);
    part.uniforms = uniforms;
    return part;
}
