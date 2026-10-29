/**
 * Ice Temple — the architecture: every column, rib, icicle and crystal, as ONE merged,
 * flat-shaded geometry and one material.
 *
 * The geometry is faceted on purpose (a hexagonal prism with bevelled corners is the temple's
 * module, as it is the ice crystal's): each face carries its own normal, so each face mirrors its
 * own piece of sky. Next to the face normal every vertex carries a smooth normal (radial from
 * the piece's axis), which gives the shader the chord a view ray travels through the body.
 *
 * The ice is not lit by a light. It is shaded as what ice is: a body that absorbs red and lets
 * blue through (Beer–Lambert over the chord), that scatters the Great Crystal's light forward
 * when the crystal stands behind it, that carries fracture veils inside (three parallax layers
 * of the baked noise, shifted along the refracted view ray), that mirrors the sky on its faces
 * (Fresnel), and that is frosted white at its foot and snow-capped on every ledge. Gameplay
 * lights the fractures from within.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    cross,
    dot,
    exp,
    float,
    floor,
    length,
    max,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    pow,
    reflect,
    refract,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
} from 'three/tsl';
import { sessionGeometry } from '../shared/session-geometry.js';
import { sessionArchitectureArrays } from './ice-temple-bakes.js';
import {
    MOON,
    itAtmosphere,
    itClearLight,
    itHash21,
    itHeartLight,
    itLobes,
    itLockLight,
    itMax3,
    itMoonDir,
    itMoonShadow,
    itPart,
    itResonance,
    itSaturate,
    itSky,
} from './ice-temple-tsl.js';

/** A mesh over the architecture's arrays (ice-temple-bake-data.js), the arrays themselves. */
function architectureGeometry(d) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
    geometry.setAttribute('aSmooth', new THREE.BufferAttribute(d.smooth, 3));
    geometry.setAttribute('aInfo', new THREE.BufferAttribute(d.info, 4));
    geometry.setAttribute('aSt', new THREE.BufferAttribute(d.st, 2));
    return { geometry, triangles: d.triangles };
}

/**
 * @param {object} u       shared temple uniforms
 * @param {object} plan    buildPlan()
 * @param {object} [opts]
 * @param {number} [opts.veils=3]  parallax layers of fracture veils inside the ice (1..3)
 * @param {string} [opts.sessionKey]  names the plan (its seed): the ice it builds is kept for the
 *   session under it (shared/session-geometry.js), 30-50 ms of main thread on every start before
 */
export function createArchitecture(u, plan, opts = {}) {
    const veils = Math.max(1, Math.min(3, opts.veils ?? 3));
    const build = () => architectureGeometry(sessionArchitectureArrays(plan, opts.sessionKey));
    const { geometry, triangles } = opts.sessionKey === undefined
        ? build()
        : sessionGeometry(null, `ice-temple:architecture:${opts.sessionKey}`, build);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'IceTempleArchitecture';
    material.fog = false;

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const N = normalize(normalWorld).toVar();
        const Ns = normalize(attribute('aSmooth', 'vec3')).toVar();
        const info = attribute('aInfo', 'vec4');
        const st = attribute('aSt', 'vec2');
        const kind = info.z;
        const isHeart = step(1.5, kind).mul(step(kind, 2.5));
        const isIcicle = step(2.5, kind);

        const rel = p.sub(cameraPosition);
        const dist = length(rel);
        const Vd = rel.div(max(dist, 1e-3)).toVar();
        const ndv = itSaturate(dot(N, Vd.negate()));
        const ndvS = itSaturate(dot(Ns, Vd.negate())).toVar();

        // ── The body: how far the ray travels through it, and what survives ──
        const thick = info.x.mul(ndvS.mul(1.65).add(0.35));
        const absorb = exp(thick.mul(vec3(-0.62, -0.16, -0.05)));
        const Rf = normalize(refract(Vd, N, 0.763).add(Vd.mul(0.001))).toVar();
        const behind = itSky(u, Rf, 0.1).add(itLobes(u, p, Rf).mul(0.8));

        // ── The light that reaches it ──
        const toHeart = u.heartPos.sub(p);
        const heartDir = toHeart.div(max(length(toHeart), 1.0)).toVar();
        const heart = itHeartLight(u, p).toVar();
        // Ice throws light forward: it burns when the Great Crystal stands behind it.
        const through = pow(itSaturate(dot(Vd, heartDir)), 5.0);
        const wrap = itSaturate(dot(Ns, heartDir).mul(0.5).add(0.5));
        const moonDir = itMoonDir();
        const shadow = itMoonShadow(p).toVar();
        const moon = u.moonColor.mul(u.ambient).mul(shadow).toVar();
        const sky = u.skyHorizon.mul(u.ambient)
            .add(u.auroraA.mul(u.auroraGain).mul(Ns.y.mul(0.5).add(0.5)).mul(0.012))
            .toVar();
        // The lake carries the heart's light: it wells up into whatever stands on it.
        const well = u.lightColor.mul(u.ambient).mul(exp(max(p.y, 0.0).mul(-0.085))).mul(0.085);

        // ── Gameplay ──
        const lock = itLockLight(u, p);
        const clear = itClearLight(u, p.z).toVar();
        const fill = float(1.0).sub(smoothstep(u.resLevel.sub(3.0), u.resLevel.add(0.5), p.y));
        const pulse = lock.mul(1.2)
            .add(clear.rgb.mul(1.3))
            .add(u.lightColor.mul(clear.w).mul(0.1))
            .add(itResonance(u, p).mul(fill).mul(0.62))
            .toVar();
        // Four fronts arriving together must light the ice, not white it out.
        pulse.assign(pulse.div(itMax3(pulse).mul(0.3).add(1.0)));

        // ── Inside. Gauzy fracture sheets at three depths along the refracted ray; a milky core
        // where the eye looks through the thick middle; the faint strata of ice laid down in
        // layers. All of it the baked noise read along the piece. ──
        const Ts = normalize(cross(vec3(0.0, 1.0, 0.0), Ns).add(vec3(1e-3, 0.0, 0.0)));
        const slide = vec2(dot(Rf, Ts), Rf.y);
        const c0 = st.add(vec2(info.y.mul(37.0), info.y.mul(11.0)));
        const veil = float(0.0).toVar();
        const depths = [[0.15, 0.5], [0.5, 0.32], [1.0, 0.2]];
        for (let i = 0; i < veils; i++) {
            const [d, w] = depths[i];
            const q = c0.add(slide.mul(info.x.mul(d))).mul(vec2(0.56 - i * 0.08, 0.021)).add(d * 0.37);
            const n = u.noise(q);
            const sheet = float(1.0).sub(smoothstep(0.0, 0.075, n.r.sub(0.5).abs()))
                .mul(smoothstep(0.5, 0.74, n.g));
            veil.addAssign(sheet.mul(w));
        }
        const grainIn = u.noise(c0.add(slide.mul(info.x.mul(0.4))).mul(vec2(3.3, 0.28))).toVar();
        veil.mulAssign(grainIn.b.mul(0.9).add(0.5));
        const wisp = u.noise(c0.add(slide.mul(info.x.mul(0.7))).mul(vec2(0.47, 0.04)).add(3.1)).toVar();
        const cloud = smoothstep(0.36, 0.82, wisp.a).mul(ndvS.mul(ndvS));
        const strata = smoothstep(0.9, 1.0, sin(st.y.mul(2.3).add(wisp.b.mul(5.0)).add(info.y.mul(40.0)))).mul(0.12);
        const inner = veil.mul(0.75).add(cloud.mul(0.55)).add(strata).toVar();

        // ── Compose the ice ──
        const tint = vec3(0.34, 0.72, 1.0);
        // (Clear ice scatters little: most of what it shows is what is behind it, darkened and
        // turned blue, and the light caught on its fractures and edges. A uniform milky fill is
        // what makes ice read as frosted plastic.)
        const milky = float(1.0).sub(exp(thick.mul(-0.4))).mul(wisp.b.mul(0.7).add(0.4)).mul(0.62);
        const scatter = heart.mul(through.mul(2.6).add(wrap.mul(0.12)))
            .add(moon.mul(itSaturate(dot(Ns, moonDir).mul(0.7).add(0.3))).mul(0.12))
            .add(sky.mul(0.28))
            .add(well.mul(0.8))
            .mul(tint)
            .mul(milky);
        // Thin ice at the silhouette lets the most through.
        const rim = pow(float(1.0).sub(ndvS), 3.0);
        const edge = heart.mul(through.mul(1.6).add(0.1))
            .add(moon.mul(itSaturate(dot(Ns, moonDir).mul(0.5).add(0.5))).mul(0.42))
            .add(sky.mul(0.7))
            .add(well.mul(1.1))
            .mul(tint)
            .mul(rim);
        // The arrises: light trapped in the ice runs to a prism's edges and leaves there (where
        // the face normal turns away from the piece's radial one), so every edge burns thin.
        const turn = itSaturate(dot(N, Ns));
        const arris = float(1.0).sub(smoothstep(0.93, 0.975, turn)).mul(smoothstep(0.55, 0.8, turn))
            .mul(float(1.0).sub(step(0.5, N.y.abs())));
        const arrisLight = heart.mul(through.mul(1.4).add(0.35))
            .add(moon.mul(itSaturate(dot(N, moonDir).mul(0.6).add(0.4))).mul(0.5))
            .add(sky.mul(0.9))
            .add(well.mul(1.2))
            .mul(vec3(0.62, 0.86, 1.0))
            .mul(arris)
            // (Chipped: an edge is never lit evenly down its length.)
            .mul(u.noise(vec2(st.x.mul(0.9).add(info.y.mul(13.0)), st.y.mul(0.07))).g.mul(1.1).add(0.45));
        const body = behind.mul(absorb).add(scatter).add(edge).add(arrisLight);
        // (The fractures catch the light the fill no longer spreads: brighter, against a darker body.)
        const lit = body.add(scatter.mul(2.2).add(well.mul(tint).mul(1.9)).add(sky.mul(1.1)).add(heart.mul(wrap.mul(0.2)).mul(tint))
            .mul(inner))
            // The pulses light the ice from within: the fracture sheets most of all.
            // (Through the fractures and the edges, not as a fill: a front must not white out a
            // near column, it must run through it.)
            .add(pulse.mul(inner.mul(1.9).add(rim.mul(0.7)).add(arris.mul(1.2)).add(milky.mul(0.12))
                .add(0.03))
                .mul(vec3(0.75, 0.92, 1.0)))
            .toVar();

        // ── The faces: a mirror for the aurora (Fresnel, pushed a little past what ice gives,
        // so every facet carries a moving sheen), and the long glints a prism's faces throw —
        // a face lights from top to bottom when it turns the moon or the heart to the eye ──
        const Rl = reflect(Vd, N).toVar();
        const fres = float(0.05).add(float(0.95).mul(pow(float(1.0).sub(ndv), 4.0)));
        const mirror = itSky(u, Rl, 0.34).add(itLobes(u, p, Rl));
        const flatR = Rl.xz.div(max(length(Rl.xz), 1e-3));
        const upright = float(1.0).sub(N.y.abs());
        const moonGlint = pow(itSaturate(dot(flatR, vec2(MOON.flat[0], MOON.flat[1]))), 90.0)
            .mul(itSaturate(Rl.y.add(0.35)));
        const heartFlat = heartDir.xz.div(max(length(heartDir.xz), 1e-3));
        const heartGlint = pow(itSaturate(dot(flatR, heartFlat)), 60.0);
        const glint = moon.mul(moonGlint).mul(1.5)
            .add(heart.mul(heartGlint).mul(0.9))
            .mul(upright);
        const col = lit.mul(float(1.0).sub(fres))
            .add(mirror.mul(fres))
            .add(glint.mul(fres.mul(4.0).add(0.2)))
            .toVar();

        // ── Frost at the foot, snow on every ledge ──
        const grain = u.noise(p.xz.mul(0.29).add(vec2(p.y.mul(0.17), p.y.mul(0.11)))).toVar();
        const cap = smoothstep(0.46, 0.8, N.y.add(grain.r.mul(0.3)).sub(0.12));
        const foot = float(1.0).sub(smoothstep(0.1, grain.g.mul(2.6).add(1.3), p.y)).mul(0.7);
        const frost = max(cap, foot).mul(float(1.0).sub(isHeart)).mul(float(1.0).sub(isIcicle.mul(0.7)));
        const frostLight = moon.mul(itSaturate(dot(N, moonDir).mul(0.8).add(0.2))).mul(0.6)
            .add(heart.mul(itSaturate(dot(N, heartDir).mul(0.7).add(0.3))).mul(0.55))
            .add(sky.mul(1.6))
            .add(well.mul(0.8))
            .add(pulse.mul(0.9));
        // Frost sparkles: a crystal face here and there turns to the eye.
        const cell = floor(p.mul(42.0));
        const spark = step(0.988, itHash21(cell.xz.add(cell.y.mul(7.13))))
            .mul(pow(sin(dot(Vd, vec3(41.0, 23.0, 37.0)).add(itHash21(cell.xy)).mul(6.283)).mul(0.5).add(0.5), 6.0));
        col.assign(mix(col, frostLight.mul(vec3(0.82, 0.92, 1.0)).mul(spark.mul(6.0).add(0.85)), frost));

        // ── The Great Crystal burns from within ──
        const core = u.heartColor.mul(u.heartPower).mul(ndvS.mul(ndvS).mul(1.3).add(inner.mul(1.8)).add(0.28));
        col.addAssign(core.mul(isHeart).mul(clear.w.mul(0.35).add(1.0)));

        return itAtmosphere(u, col, p);
    })();

    const part = itPart('IceTempleArchitecture', geometry, material, 0, true);
    part.triangles = triangles;
    return part;
}
