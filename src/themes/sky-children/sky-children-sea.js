/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sky Children — Irisfall: the cloud sea, a kilometre down (one draw).
 *
 * A polar grid under the eye (rings growing geometrically from below the frame's foot out to the
 * haze), displaced by the baked field of rounded cumulus heads (sky noise G, three sizes of Worley
 * cells) swelled and sunk by a broad fBm, so its near domes are real relief with silhouettes and
 * parallax, and where the broad field sinks the sea opens onto the shelves far below.
 *
 * The sun is behind the eye, so the domes we see are lit full face: the light lies in their curve
 * (a wrapped key from the field's slope), the creases between heads stay cool and blue (sky light
 * occluded), the isles' shadows lie across the sea as wedges converging on the antisolar point,
 * and the toll's rings run out across it. The droplet optics (the bow's leg, the fogbow, the
 * opposition glow, the glory) are drawn ON the sea, where the droplets are. Toward the horizon the
 * relief settles and the sea fades into exactly what the dome shows behind it (deepColour), so the
 * two never meet at a seam.
 *
 * Opaque, drawn before the dome: the dome never shades a pixel the sea covers.
 */
import * as THREE from 'three/webgpu';
import {
    Discard, Fn, acos, cameraPosition, clamp, dot, exp, float, length, min, mix, normalize, positionLocal, positionWorld,
    pow, smoothstep, texture, vec2, vec3,
} from 'three/tsl';
import {
    TUNE, antiRays, casterShadow, cloudLight, deepColour, optics, scWrap, skyBase, tollLight, tollRings, windOffset,
} from './sky-children-tsl.js';

/** The sea's shape (metres). */
export const SEA = Object.freeze({
    /** Its mean height below the eye: the first shelf of the Deep. */
    get height() {
        return TUNE.shelves[0];
    },
    /** The domes' relief, and the metres one tile of the baked field spans. */
    amplitude: 420,
    tile: 9000,
    /** The broad swell (sea-level variation) and its tile. */
    swell: 220,
    swellTile: 30000,
    /** Where the grid starts (just under the frame's foot) and ends (deep in the haze). */
    r0: 700,
    r1: 46000,
    /** Bearing half-span round straight ahead (radians): the eye only ever looks ahead. */
    span: 2.0,
    /** The relief settles over this range (it would only shimmer smaller than a pixel). */
    settle: [9000, 26000],
    /** Below this field value the sea opens (a hole onto the shelves). */
    hole: 0.14,
});

/**
 * The polar grid, its rings drawn from the far edge in: farther rings first, so the near domes are
 * painted over the far ones wherever depth would tie.
 */
export function buildSeaGeometry(rings, segments) {
    const { r0, r1, span } = SEA;
    const growth = (r1 / r0) ** (1 / rings);
    const row = segments + 1;
    const position = new Float32Array((rings + 1) * row * 3);
    let v = 0;
    for (let k = 0; k <= rings; k++) {
        const r = r0 * growth ** k;
        for (let s = 0; s <= segments; s++) {
            const a = -span + (2 * span * s) / segments;
            position[v * 3] = Math.sin(a) * r;
            position[v * 3 + 1] = 0;
            position[v * 3 + 2] = -Math.cos(a) * r;
            v += 1;
        }
    }
    const index = [];
    for (let k = rings - 1; k >= 0; k--) {
        for (let s = 0; s < segments; s++) {
            const a = k * row + s;
            const b = a + row;
            index.push(a, a + 1, b, a + 1, b + 1, b);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setIndex(index);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, SEA.height, 0), r1 * 1.01);
    return geometry;
}

/**
 * The baked relief at a sea point (metres, xz): the texel (height, slope u, slope v, crease), and
 * the broad swell (0..1). `lod` reads the base level (the vertex stage has no derivatives).
 */
function seaField(xz, tex, drift, lod) {
    const at = xz.mul(1 / SEA.tile).add(drift);
    const relief = lod ? texture(tex.sea, at).level(0) : texture(tex.sea, at);
    const swellAt = xz.mul(1 / SEA.swellTile).add(vec2(0.53, 0.19)).add(drift.mul(0.25));
    const swell = (lod ? texture(tex.noise, swellAt).level(0) : texture(tex.noise, swellAt)).r;
    return { relief, swell };
}

/** How much of the relief stands at distance `r` (it settles toward the haze). */
function settleAt(r) {
    return float(1.0).sub(smoothstep(SEA.settle[0], SEA.settle[1], r));
}

/** Height above the sea's mean (metres). */
function seaHeight(f, r) {
    return f.relief.x.sub(0.5).mul(SEA.amplitude).add(f.swell.sub(0.5).mul(SEA.swell)).mul(settleAt(r));
}

/**
 * @param {object} p
 * @param {object} p.tier  the quality tier (seaRings, seaSegments, casters)
 * @param {object} p.U     the world's uniforms
 * @param {object} p.tex   { noise, lut }
 */
export function createSea({ tier, U, tex }) {
    const geometry = buildSeaGeometry(tier.seaRings ?? 64, tier.seaSegments ?? 128);
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'sky-children-sea';
    // The sea drifts slowly under the eye on the sky's one wind, the slowest of the layers.
    const drift = windOffset(U, 0.22).mul(1 / SEA.tile);

    material.positionNode = Fn(() => {
        const p = positionLocal;
        const r = length(p.xz);
        const f = seaField(p.xz, tex, drift, true);
        return vec3(p.x, seaHeight(f, r), p.z);
    })();

    material.colorNode = Fn(() => {
        const { light } = U;
        const P = positionWorld.toVar();
        const rel = P.sub(cameraPosition).toVar();
        const dist = length(rel).toVar();
        const V = rel.div(dist).toVar();
        const r = length(P.xz).toVar();
        const f = seaField(P.xz, tex, drift, false);
        const relief = f.relief.toVar();
        // A hole where the heads and the swell both sink: the shelves far below show through.
        const cover = relief.x.mul(0.7).add(f.swell.mul(0.6)).sub(0.15).toVar();
        Discard(cover.lessThan(SEA.hole));
        // The baked slope (height per tile) in metres per metre, relaxed toward up far away.
        const k = settleAt(r).mul(SEA.amplitude / SEA.tile);
        const n0 = normalize(vec3(relief.y.mul(k).negate(), 1.0, relief.z.mul(k).negate()));
        const N = normalize(mix(n0, vec3(0.0, 1.0, 0.0), smoothstep(6000.0, 24000.0, r))).toVar();

        // Lit full face by the sun behind the eye: the light lies in the domes' curve.
        const key = scWrap(dot(N, U.key), float(0.3));
        const heads = relief.x;
        // The creases between heads are sky-occluded: cooler, darker; the crowns catch the light.
        const crease = smoothstep(0.52, 0.9, relief.w).mul(settleAt(r));
        const occl = mix(float(0.66), float(1.0), smoothstep(0.1, 0.75, heads)).mul(float(1.0).sub(crease.mul(0.2)));
        const shade = mix(light.mistShade.mul(0.8), light.mistShade, smoothstep(0.2, 0.6, heads));
        // The clouds' one light (the sky's, the cumulus'); at the rose and pearl hours the far sea
        // lies in the Earth's shadow, blue under the pink belt, the near domes still lit.
        const farShade = smoothstep(5000.0, 26000.0, r).mul(0.85);
        const lit = cloudLight(U, pow(key, 1.4), float(0.0), farShade, { shade, gain: 0.48 }).mul(occl).toVar();
        // Sky light from above, and the crown of each head a touch brighter.
        lit.addAssign(skyBase(vec3(0.0, 1.0, 0.0), U).mul(N.y.mul(0.1)));
        // Each head's limb, turned from the eye, falls a little into shade: the domes stand apart.
        lit.mulAssign(mix(float(0.78), float(1.0), smoothstep(0.05, 0.55, dot(N, V.negate()))));
        // Cloud is never plastic: a fine fuzz of brighter and duller wisps over every head.
        const fuzz = texture(tex.noise, P.xz.mul(1 / 900).add(drift.mul(3.0))).a;
        lit.mulAssign(fuzz.sub(0.5).mul(float(0.22).mul(settleAt(r))).add(1.0));
        // The isles' shadows: wedges across the sea converging on the antisolar point.
        const shadow = casterShadow(P, U, tier.casters);
        lit.mulAssign(float(1.0).sub(shadow.mul(U.shadowDepth)));
        // …and the shadows of the clouds behind us: lanes across the sea converging on A, the
        // anticrepuscular rays come down to the cloud tops (the eye follows them in to A).
        if (tier.rays) {
            const thetaA = acos(clamp(dot(V, U.A), -1.0, 1.0));
            lit.mulAssign(float(1.0).sub(antiRays(V, thetaA, U, tex, { surface: true }).mul(0.9)));
        }
        // The toll's rings run out across the domes.
        lit.addAssign(tollLight(U).mul(tollRings(P, U)).mul(key.mul(0.6).add(0.4)));

        // The droplets: the bow's leg, the fogbow, the opposition glow, the glory, on the sea.
        const opt = optics(V, U, tex, { rain: float(1.0), deep: true, deepMist: float(1.0) });
        lit.mulAssign(float(1.0).sub(opt.w));
        lit.addAssign(opt.xyz);

        // The air between: the sea fades into what the dome shows behind it, exactly at its edge.
        const behind = deepColour(V, U, tex, { from: 1, shelves: tier.shelves, casters: 0 }).colour;
        const air = float(1.0).sub(exp(dist.div(-TUNE.hazeReach * 1.15))).mul(0.85)
            .add(smoothstep(SEA.r1 * 0.5, SEA.r1 * 0.95, r).mul(0.15));
        // The rims of the holes thin into the depth below them.
        const rim = smoothstep(SEA.hole, SEA.hole + 0.22, cover);
        return mix(behind, lit, rim.mul(float(1.0).sub(min(air, 1.0))));
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sky-children-sea';
    mesh.position.set(0, SEA.height, 0);
    mesh.frustumCulled = false;
    mesh.renderOrder = 40;
    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
