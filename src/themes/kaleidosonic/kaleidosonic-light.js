/**
 * Kaleidosonic — the light map: how far the core's light reaches in every direction before the
 * stone stops it.
 *
 * The jewels hang at the core's resting place repeated in every cell of the lattice, and the
 * temple is periodic, so ONE map marched from that place holds every jewel's shadows (and the
 * core's, while it rests on its own jewel). It is an octahedral map of directions: each texel
 * marches the field from the light along its direction and stores the distance to the first stone
 * (LIGHT_REACH where none is that near). A point is lit when it is nearer the light than the
 * stone in its direction. The temple reads it for the stone's shadows and for the shafts of light
 * in the air between the pearls.
 *
 * The map only changes with the temple's shape (a refold, the trance's folds) and the core's
 * place, so it is redrawn only then. Until it has really been drawn once (its pipeline may still
 * be building), `u.light.x` stays 0 and the shaders take every point as lit.
 */
import * as THREE from 'three/webgpu';
import {
    Break, Fn, If, Loop, abs, atan, clamp, dot, exp, float, inverseSqrt, length, max, min, normalize, positionGeometry,
    select, sign, smoothstep, sqrt, texture, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { BEAM_AXES, BEAM_K } from './kaleidosonic-core.js';

/** Distance (fractal units) the map looks for stone; beyond it the light is taken as unblocked. */
export const LIGHT_REACH = 3.2;

/**
 * The map's frame: its +z axis toward the eye's side of the lattice (the eye looks down (−1, 0, −1)),
 * so the octahedral map's seams (its −z half's border) lie behind the light, away from the eye.
 */
const FZ = (() => {
    const v = [1, 0.35, 1];
    const l = Math.hypot(...v);
    return v.map((c) => c / l);
})();
const FX = (() => {
    const v = [FZ[2], 0, -FZ[0]];
    const l = Math.hypot(...v);
    return v.map((c) => c / l);
})();
const FY = [
    FZ[1] * FX[2] - FZ[2] * FX[1],
    FZ[2] * FX[0] - FZ[0] * FX[2],
    FZ[0] * FX[1] - FZ[1] * FX[0],
];
const lit3 = (a) => vec3(a[0], a[1], a[2]);

/** A direction (unit, world) → the map's coordinate (texture uv, 0..1). */
export const ksOctUv = /* @__PURE__ */ Fn(([dIn]) => {
    const l = vec3(dot(dIn, lit3(FX)), dot(dIn, lit3(FY)), dot(dIn, lit3(FZ)));
    const n = l.div(max(abs(l.x).add(abs(l.y)).add(abs(l.z)), 1e-6)).toVar();
    const s = vec2(select(n.x.greaterThanEqual(0.0), 1.0, -1.0), select(n.y.greaterThanEqual(0.0), 1.0, -1.0));
    const folded = vec2(float(1).sub(abs(n.y)), float(1).sub(abs(n.x))).mul(s);
    const xy = select(n.z.greaterThanEqual(0.0), n.xy, folded);
    return xy.mul(0.5).add(0.5);
}).setLayout({ name: 'ks_octUv', type: 'vec2', inputs: [{ name: 'dIn', type: 'vec3' }] });

/** The map's coordinate (texture uv, 0..1) → its direction (unit, world). */
export const ksOctDir = /* @__PURE__ */ Fn(([oIn]) => {
    const f = oIn.mul(2.0).sub(1.0);
    const n = vec3(f.x, f.y, float(1).sub(abs(f.x)).sub(abs(f.y))).toVar();
    const t = clamp(n.z.negate(), 0.0, 1.0);
    n.x.addAssign(select(n.x.greaterThanEqual(0.0), t.negate(), t));
    n.y.addAssign(select(n.y.greaterThanEqual(0.0), t.negate(), t));
    const l = normalize(n);
    return normalize(lit3(FX).mul(l.x).add(lit3(FY).mul(l.y)).add(lit3(FZ).mul(l.z)));
}).setLayout({ name: 'ks_octDir', type: 'vec3', inputs: [{ name: 'oIn', type: 'vec2' }] });

/** A direction in the world → the gem's own (turned) frame. */
export const ksGemFrame = /* @__PURE__ */ Fn(([wIn, rot]) => vec3(
    rot.x.mul(wIn.x).add(rot.y.mul(wIn.z)),
    wIn.y,
    rot.x.mul(wIn.z).sub(rot.y.mul(wIn.x)),
)).setLayout({
    name: 'ks_gemFrame', type: 'vec3', inputs: [{ name: 'wIn', type: 'vec3' }, { name: 'rot', type: 'vec2' }],
});

/**
 * The beams' light in a direction from the gem (unit, the gem's own frame): 1 on a facet's axis,
 * falling off over about 14°, the twelve beams summed (they never overlap much).
 */
export const ksBeams = /* @__PURE__ */ Fn(([gIn]) => {
    const sum = float(0).toVar();
    BEAM_AXES.forEach((a) => {
        const d = abs(dot(gIn, vec3(a[0], a[1], a[2])));
        sum.addAssign(exp(d.sub(1.0).mul(BEAM_K)));
    });
    return sum;
}).setLayout({ name: 'ks_beams', type: 'float', inputs: [{ name: 'gIn', type: 'vec3' }] });

/** The least R (see ksBeamLobe) at which a beam's peak along a ray reaches 1/100 of its own. */
const BEAM_REACHES = 1 - Math.log(100) / BEAM_K;

/** erf(x) for any x: Abramowitz & Stegun 7.1.27 (within 5e-4), a polynomial with no exp or sqrt. */
const erfOf = (x) => {
    const z = abs(x);
    const p = z.mul(z.mul(z.mul(z.mul(0.078108).add(0.000972)).add(0.230389)).add(0.278393)).add(1.0);
    const p2 = p.mul(p);
    return sign(x).mul(float(1).sub(float(1).div(p2.mul(p2))));
};

/**
 * One facet's beam (both its ends) along a view ray, in closed form.
 *
 * Seen from a light, the points of a straight ray sweep one arc of directions: the point at angle
 * θ (θ = atan((t − tc) / h), h the ray's closest approach, tc where it is closest) lies in the
 * direction cos θ · ê + sin θ · d (ê toward the closest point, d along the ray), at r = h / cos θ,
 * and the light the air there sends to the eye per unit of θ is the light's own over h. So a
 * beam's light along the ray is an integral over θ of exp(k (|ω · a| − 1)), and with
 * ω · a = R cos(θ − φ) (R, φ from A = ê · a and B = d · a) each end of the beam is a Gaussian in
 * θ about its axis, integrated with erf between where the ray starts (θa) and ends (θb). (Both
 * ends: a long ray's range nears half a turn, and choosing one end would draw a seam where the
 * choice flips.)
 *
 * Returns (the beam's light: the integral over θ, the θ where it is strongest within the range).
 * No noise, at any sharpness: the caller looks up the shadow once, where the beam crosses.
 */
export const ksBeamLobe = /* @__PURE__ */ Fn(([A, B, thA, thB]) => {
    const R = max(sqrt(A.mul(A).add(B.mul(B))), 1e-4).toVar();
    const lobe = vec2(0.0, thA).toVar();
    // A beam whose axis leans far out of the plane of the ray and the light never comes near the
    // ray (its peak along it is exp(k (R − 1))): most of the six, for most rays. Only the rest
    // pay for the integral.
    If(R.greaterThan(BEAM_REACHES), () => {
        // the end along +a peaks at φ, the end along −a half a turn away (both in (−π, π])
        const phi = atan(B, A.add(1e-7)).toVar();
        const phi2 = phi.sub(select(phi.greaterThan(0.0), Math.PI, -Math.PI)).toVar();
        const s = sqrt(R.mul(BEAM_K / 2)).toVar();
        const amp = exp(R.sub(1.0).mul(BEAM_K)).mul(inverseSqrt(R.mul((2 * BEAM_K) / Math.PI))).toVar();
        const w1 = erfOf(thB.sub(phi).mul(s)).sub(erfOf(thA.sub(phi).mul(s))).mul(amp).toVar();
        const w2 = erfOf(thB.sub(phi2).mul(s)).sub(erfOf(thA.sub(phi2).mul(s))).mul(amp).toVar();
        lobe.assign(vec2(w1.add(w2), clamp(select(w1.greaterThan(w2), phi, phi2), thA, thB)));
    });
    return lobe;
}).setLayout({
    name: 'ks_beamLobe',
    type: 'vec2',
    inputs: [
        { name: 'A', type: 'float' }, { name: 'B', type: 'float' },
        { name: 'thA', type: 'float' }, { name: 'thB', type: 'float' },
    ],
});

/**
 * How lit a point is by a light, from the map: `v` the point minus the light (any length), `soft`
 * the half-width of the shadow's edge (units). 1 where nothing stands between, 0 in shadow, and 1
 * wherever the map found no stone within its reach. Inline (it reads the map's texture).
 */
export function lightVis(map, v, soft) {
    const r = length(v).toVar();
    const D = texture(map, ksOctUv(v.div(max(r, 1e-5)))).level(0).x;
    const open = smoothstep(LIGHT_REACH - 0.08, LIGHT_REACH - 0.01, D);
    return max(clamp(D.sub(r).div(soft).add(0.5), 0.0, 1.0), open);
}

/**
 * True when the call drew (three skips a draw whose pipeline is still building; its counters
 * reset only between animation frames). A renderer without the counters is taken at its word.
 */
function drewWith(renderer, render) {
    const stats = renderer?.info?.render;
    const before = stats?.drawCalls;
    render();
    if (typeof before !== 'number' || typeof stats.drawCalls !== 'number') return true;
    return stats.drawCalls !== before;
}

/**
 * @param {object} u uniforms (createUniforms): reads heart, shape; writes light.x (ready)
 * @param {Function} field the temple's field (createTempleField)
 * @param {object} tier quality tier: lightMap (texels a side), lightSteps
 */
export function createLightMap(u, field, tier) {
    const size = Math.max(32, Math.round(tier.lightMap || 256));
    const steps = Math.max(16, Math.round(tier.lightSteps || 48));
    const target = new THREE.RenderTarget(size, size, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
    });
    target.texture.name = 'Kaleidosonic — light map';
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    material.name = 'Kaleidosonic — light map';
    material.fog = false;
    const vNdc = varying(positionGeometry.xy);
    material.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0);
    material.fragmentNode = Fn(() => {
        // the texel's map coordinate in the texture's own convention (v = 0 is the top row)
        const o = vec2(vNdc.x.mul(0.5).add(0.5), float(0.5).sub(vNdc.y.mul(0.5)));
        const dir = ksOctDir(o).toVar();
        // the lattice's jewel in the temple's own coordinates (the core's resting place)
        const C = u.heart.xyz.toVar();
        const t = float(0.004).toVar();
        Loop(steps, () => {
            const h = field(C.add(dir.mul(t)), u.shape).toVar();
            If(h.lessThan(t.mul(0.003).add(0.0006)), () => {
                Break();
            });
            t.addAssign(h.mul(0.95));
            If(t.greaterThan(LIGHT_REACH), () => {
                t.assign(LIGHT_REACH);
                Break();
            });
        });
        return vec4(min(t, LIGHT_REACH), 0.0, 0.0, 1.0);
    })();
    const quad = new THREE.QuadMesh(material);
    quad.name = 'KaleidosonicLightMap';
    /** What the map was last drawn for: the shape and the core's place. */
    const drawnFor = new Float32Array(7).fill(Number.NaN);
    const wanted = new Float32Array(7);
    return {
        target,
        material,
        quad,
        size,
        /** Draws the map when the temple's shape or the core's place changed since it was drawn. */
        render(renderer) {
            const s = u.shape.value;
            const h = u.heart.value;
            wanted.set([s.x, s.y, s.z, s.w, h.x, h.y, h.z]);
            let same = true;
            for (let i = 0; i < 7; i++) if (wanted[i] !== drawnFor[i]) same = false;
            if (same) return;
            const previous = renderer.getRenderTarget();
            const { autoClear } = renderer;
            // the quad covers the whole map: no clear (a clear that lands while the draw is
            // skipped would wipe the map)
            renderer.autoClear = false;
            renderer.setRenderTarget(target);
            const drew = drewWith(renderer, () => quad.render(renderer));
            renderer.setRenderTarget(previous);
            renderer.autoClear = autoClear;
            if (!drew) return;
            drawnFor.set(wanted);
            u.light.value.x = 1;
        },
        dispose() {
            target.dispose();
            material.dispose();
        },
    };
}
