/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE MEADOWS' NEAR LIFE — blossom petals on the wind and butterflies crossing the lens
 * (chapters 3-4; Act II pass, step 5, 2026-10-26).
 *
 * The act's life all keeps its distance: gulls over the surf, swallows ahead of the orbs, a skein
 * across the massif, the eagle on the wall, all specks at a few hundred units, and the air motes
 * are pin-points. Over the meadows nothing living came near the eye. Two kinds now share one
 * draw in the near air (the air motes' technique: an instanced geometry with NO instance data,
 * each one's place following from its index and the clock in the vertex stage, world-anchored in
 * a box that wraps round the eye, so a glide streams through them with real parallax):
 *   - PETALS, pink and white from the blossom grove and the odd gold leaf, carried down the
 *     breeze and sinking slowly, each tumbling (its width turns with the flip, its face darkens
 *     as it turns away from the light);
 *   - BUTTERFLIES, a few, in an erratic flight close to the eye, wings beating in bouts between
 *     glides (the wings fold toward the body on each beat), drawn at about three times life so
 *     one crossing the view reads at the camera's height over the meadow (47-90 u up).
 * Front-lit like the rest of the act (the sun behind the camera's shoulder).
 *
 * OPAQUE with an alpha test, so there is no blend state and no sorting: a petal is a solid shape.
 * Faded in by SIZE near the lens (no big quads in front of the camera) and toward the box's edge
 * (no wrap pops), and collapsed off screen when its kind is out of its window.
 *
 * ZERO-HITCH (ADR-0020): one draw built at board construction (compiled with the presentation
 * group); afterwards only uniforms change. BISECT LEVER (board): `?odysseyNoMeadowLife=1`.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, float, fract, hash,
    instanceIndex, length, max, mix, positionGeometry, select, sin, smoothstep, uniform, varying, vec2, vec3, vec4,
} from 'three/tsl';

/** The two kinds. Boxes are world units round the eye; sizes are half-widths. */
export const ODYSSEY_MEADOW_LIFE = Object.freeze({
    petals: Object.freeze({
        count: 520,
        box: Object.freeze([110, 44, 110]),
        size: Object.freeze([0.16, 0.30]),
        /** The breeze (x/z, the air motes'), its speed range (u/s) and the fall speed. */
        wind: Object.freeze([0.8, 0.6]),
        speed: Object.freeze([1.8, 3.8]),
        fall: Object.freeze([0.35, 0.9]),
        near: 3.0,
        far: 62,
        /** Share of the petals that are gold leaves (the autumn side's). */
        gold: 0.16,
    }),
    butterflies: Object.freeze({
        count: 18,
        box: Object.freeze([60, 26, 60]),
        /** Half the wingspan (world units): about three times life, as a long lens shows it. */
        size: Object.freeze([0.38, 0.52]),
        drift: 0.8,
        near: 3.5,
        far: 42,
    }),
    /** [fade in from, fully in by, fade out from, gone by] in JOURNEY progress, per kind. */
    windows: Object.freeze({
        petals: Object.freeze([0.185, 0.215, 0.335, 0.365]),
        butterflies: Object.freeze([0.200, 0.230, 0.330, 0.360]),
    }),
});

const win = (w, p) => THREE.MathUtils.smoothstep(p, w[0], w[1]) * (1 - THREE.MathUtils.smoothstep(p, w[2], w[3]));

/** Strength of each kind at journey progress `p` (pure; exported for its test). */
export function meadowLifeAt(p, cfg = ODYSSEY_MEADOW_LIFE) {
    return {
        petals: win(cfg.windows.petals, p),
        butterflies: win(cfg.windows.butterflies, p),
    };
}

// Wing colours: an orange, a white, a blue, a sulphur yellow.
const WINGS = [
    [0.96, 0.52, 0.14],
    [0.95, 0.95, 0.90],
    [0.30, 0.55, 0.96],
    [1.00, 0.86, 0.30],
];

/**
 * @param {object} [opts]
 * @param {object} [opts.sunColour] TSL vec3 node: the world's sun colour
 * @param {object} [opts.hazeColour] TSL vec3 node: the world's horizon (the shade's sky light)
 * @param {number} [opts.petals] petal count (the tier decides)
 */
export function createOdysseyMeadowLife({
    sunColour = null, hazeColour = null, petals = ODYSSEY_MEADOW_LIFE.petals.count,
} = {}) {
    const P = ODYSSEY_MEADOW_LIFE.petals;
    const B = ODYSSEY_MEADOW_LIFE.butterflies;
    const nPetals = Math.max(1, Math.round(petals));
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.getAttribute('position'));
    geometry.instanceCount = nPetals + B.count;

    const uTime = uniform(0);
    // Strengths of the petals and the butterflies (x, y).
    const uKinds = uniform(new THREE.Vector2(0, 0));
    const sun = sunColour ?? vec3(1.0, 0.96, 0.88);
    const sky = hazeColour ?? vec3(0.72, 0.82, 0.93);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OdysseyMeadowLife';
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.alphaTest = 0.5;
    // x kind (0 petal, 1 butterfly), y seed, z light, w beat (the butterfly's wing fold)
    const vMeta = varying(vec4(0.0), 'mlMeta');
    const vTint = varying(vec3(0.0), 'mlTint');
    material.vertexNode = Fn(() => {
        const i = instanceIndex.toFloat();
        const isFly = i.greaterThanEqual(float(nPetals)).toVar();
        const flyF = select(isFly, float(1), float(0)).toVar();
        const h1 = hash(i.add(0.5)).toVar();
        const h2 = hash(i.add(1337.5)).toVar();
        const h3 = hash(i.add(2741.5)).toVar();
        const h4 = hash(i.add(4099.5)).toVar();
        const h5 = hash(i.add(5813.5)).toVar();
        const t = uTime;

        // ── where it is: a world-anchored home carried by its own motion; the box wraps ──
        const box = mix(vec3(...P.box), vec3(...B.box), flyF);
        const home = vec3(h1, h2, h3).mul(box);
        // Petals: down the breeze, sinking, swaying across it.
        const wind = vec3(P.wind[0], 0.0, P.wind[1]);
        const across = vec3(-P.wind[1], 0.0, P.wind[0]);
        const petalSpeed = mix(float(P.speed[0]), float(P.speed[1]), h4);
        const sway = sin(t.mul(mix(0.4, 1.0, h2)).add(h1.mul(40.0))).mul(mix(0.8, 2.4, h3));
        const petalMove = wind.mul(t.mul(petalSpeed))
            .add(across.mul(sway))
            .add(vec3(0.0, t.mul(mix(float(P.fall[0]), float(P.fall[1]), h5)).negate(), 0.0));
        // Butterflies: a slow drift with the breeze and an erratic weave in three axes.
        const weave = vec3(
            sin(t.mul(mix(0.7, 1.3, h2)).add(h1.mul(30.0))).mul(2.6)
                .add(sin(t.mul(mix(2.1, 3.3, h3)).add(h4.mul(20.0))).mul(0.8)),
            sin(t.mul(mix(1.1, 1.9, h4)).add(h2.mul(25.0))).mul(1.2)
                .add(sin(t.mul(mix(3.0, 4.6, h1)).add(h3.mul(9.0))).mul(0.4)),
            cos(t.mul(mix(0.6, 1.2, h3)).add(h5.mul(35.0))).mul(2.6)
                .add(cos(t.mul(mix(1.9, 3.1, h5)).add(h2.mul(14.0))).mul(0.8)),
        );
        const flyMove = wind.mul(t.mul(B.drift)).add(weave);
        const q = home.add(mix(petalMove, flyMove, flyF));
        const rel = fract(q.sub(cameraPosition).div(box).add(0.5)).sub(0.5).mul(box);
        const centre = cameraPosition.add(rel).toVar();

        // ── how much of it: its kind's window, near the lens and toward the box's edge ──
        const near = mix(float(P.near), float(B.near), flyF);
        const far = mix(float(P.far), float(B.far), flyF);
        const toEye = length(rel);
        const strength = mix(uKinds.x, uKinds.y, flyF);
        const fade = smoothstep(near, near.mul(2.0), toEye)
            .mul(float(1).sub(smoothstep(far.mul(0.7), far, toEye)))
            .mul(strength)
            .toVar();

        // ── its shape on screen ──
        // A petal tumbles: it turns in the view plane and its width follows the flip; a butterfly
        // beats in bouts (a glide between them), each beat folding the wings toward the body.
        const spin = t.mul(mix(0.6, 1.8, h3)).add(h1.mul(30.0));
        const flip = cos(t.mul(mix(1.4, 3.2, h4)).add(h2.mul(50.0))).toVar();
        const bout = smoothstep(-0.2, 0.4, sin(t.mul(mix(0.35, 0.6, h5)).add(h3.mul(20.0))));
        const beat = abs(cos(t.mul(mix(18.0, 26.0, h2)).add(h4.mul(10.0)))).mul(bout)
            .add(float(1).sub(bout).mul(0.92))
            .toVar();
        const size = mix(
            mix(float(P.size[0]), float(P.size[1]), h2),
            mix(float(B.size[0]), float(B.size[1]), h2),
            flyF,
        ).mul(fade.mul(0.5).add(0.5));
        const roll = mix(spin, sin(t.mul(0.9).add(h3.mul(12.0))).mul(0.35), flyF);
        const width = mix(max(abs(flip), 0.12), max(beat, 0.10), flyF);
        // A petal is taller than it is wide; a butterfly wider than it is tall.
        const local = vec2(
            positionGeometry.x.mul(width).mul(mix(float(0.7), float(1.0), flyF)),
            positionGeometry.y.mul(mix(float(1.0), float(0.72), flyF)),
        );
        const c = cos(roll);
        const s = sin(roll);
        const turned = vec2(local.x.mul(c).sub(local.y.mul(s)), local.x.mul(s).add(local.y.mul(c)));
        const view = cameraViewMatrix.mul(vec4(centre, 1.0));
        const lifted = view.add(vec4(turned.mul(size.mul(2.0)), 0.0, 0.0));

        // ── its colour ──
        // Petals: pink or white blossom, or a gold leaf; light by how squarely the face turns to
        // the light (the flip), never black — the far side of a petal glows through.
        const pink = mix(vec3(0.98, 0.68, 0.78), vec3(1.0, 0.95, 0.94), smoothstep(0.55, 0.75, h4));
        const petal = mix(pink, vec3(0.96, 0.72, 0.26), select(h5.lessThan(P.gold), float(1), float(0)));
        const pick = h4.mul(WINGS.length);
        const wing = mix(
            mix(vec3(...WINGS[0]), vec3(...WINGS[1]), smoothstep(0.98, 1.02, pick)),
            mix(vec3(...WINGS[2]), vec3(...WINGS[3]), smoothstep(2.98, 3.02, pick)),
            smoothstep(1.98, 2.02, pick),
        );
        vTint.assign(mix(petal, wing, flyF));
        const light = mix(abs(flip).mul(0.45).add(0.55), beat.mul(0.25).add(0.75), flyF);
        vMeta.assign(vec4(flyF, h1, light, beat));
        return fade.greaterThan(0.002).select(cameraProjectionMatrix.mul(lifted), vec4(0.0, 0.0, -2.0, 1.0));
    })();
    // The shapes, cut by the alpha test: a petal is a teardrop with a notch at its broad end; a
    // butterfly is two wing pairs (fore and hind) either side of a dark body.
    const shape = Fn(() => {
        const p = positionGeometry.xy.mul(2.0); // -1..1 over the quad
        // Petal: a teardrop pointing down the quad, notched at the top.
        const py = p.y.mul(0.5).add(0.5);
        const halfW = py.mul(float(1).sub(py)).mul(2.2).add(py.mul(py).mul(0.35));
        const notch = smoothstep(0.0, 0.18, abs(p.x)).add(float(1).sub(smoothstep(0.82, 0.92, py)));
        const petalIn = float(1).sub(smoothstep(halfW.sub(0.05), halfW.add(0.05), abs(p.x)))
            .mul(smoothstep(-0.98, -0.85, p.y))
            .mul(clamp(notch, 0.0, 1.0));
        // Butterfly: fore wings above, hind wings below, mirrored about the body.
        const ax = abs(p.x);
        const fore = float(1).sub(length(vec2(ax.sub(0.52), p.y.sub(0.30)).div(vec2(0.48, 0.52))));
        const hind = float(1).sub(length(vec2(ax.sub(0.40), p.y.add(0.42)).div(vec2(0.36, 0.40))));
        const wings = smoothstep(0.0, 0.08, max(fore, hind)).mul(smoothstep(0.02, 0.06, ax));
        const body = float(1).sub(smoothstep(0.03, 0.07, ax))
            .mul(float(1).sub(smoothstep(0.6, 0.75, abs(p.y.add(0.05)))));
        return mix(petalIn, max(wings, body), vMeta.x);
    });
    const shapeNode = shape();
    material.opacityNode = shapeNode;
    material.colorNode = Fn(() => {
        const p = positionGeometry.xy.mul(2.0);
        const ax = abs(p.x);
        // The wings darken at their edge and toward the body; the body is dark.
        const edge = smoothstep(0.55, 0.95, length(vec2(ax.sub(0.45), p.y.mul(0.8))));
        const body = float(1).sub(smoothstep(0.03, 0.07, ax));
        const flyCol = mix(vTint.mul(mix(float(1), float(0.55), edge)), vec3(0.08, 0.06, 0.05), body);
        // A petal: a little deeper at its base.
        const petalCol = vTint.mul(mix(float(0.86), float(1.0), smoothstep(-0.9, 0.2, p.y)));
        const albedo = mix(petalCol, flyCol, vMeta.x);
        const lit = albedo.mul(mix(sky.mul(0.55), sun.mul(1.02), vMeta.z));
        return vec4(lit, 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-meadow-life';
    mesh.frustumCulled = false;
    mesh.renderOrder = 11;
    mesh.visible = false;

    return {
        mesh,
        uniforms: { uTime, uKinds },
        /**
         * @param {number} time board clock (s)
         * @param {number} progress journey progress
         */
        update(time, progress) {
            const k = meadowLifeAt(progress);
            uKinds.value.set(k.petals, k.butterflies);
            uTime.value = time;
            mesh.visible = (k.petals + k.butterflies) > 0.002;
        },
        dispose() {
            geometry.dispose();
            plane.dispose();
            material.dispose();
            mesh.removeFromParent();
        },
    };
}
