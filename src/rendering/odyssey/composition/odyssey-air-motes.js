/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE AIR OF ACT II — what floats in it, by altitude: pollen and seed fluff over the shore
 * (chapter 3), thistle down on the alpine meadows (chapter 4), diamond dust high on the climb
 * (chapter 5).
 *
 * The act's air was empty above the water: nothing between the eye and a landscape a kilometre
 * away, so a parked view had no depth cue nearer than the rail and no motion but the clouds. One
 * mesh of camera-facing quads now fills a box of air round the eye (an instanced geometry with NO
 * instance data: each mote's place follows from its index and the clock in the vertex stage, the
 * Spring theme's technique). The motes are WORLD-ANCHORED — the box wraps round the eye, the motes
 * do not ride with it — so a glide between orbs streams through them with real parallax, and a
 * parked view watches them drift downwind and bob.
 *
 * Front-lit like everything in the act (the sun stands behind the camera): down glows white,
 * pollen is a warm speck, dust is a pin-point that glints as it turns. Additive light with the
 * target's alpha left alone (premultiplied, `outputNode = vec4(rgb, 0)`), sized to at least a
 * pixel and a half so far motes neither shimmer away nor glare, faded near the lens (no big quads
 * in front of the camera — the fill-rate trap) and toward the box's edge (no wrap pops).
 *
 * ZERO-HITCH: one draw built at board construction (compiled with the presentation group);
 * afterwards only uniforms change — the three kinds' strengths (0 = that kind draws nothing:
 * its quads collapse off screen in the vertex stage). BISECT LEVER (board): `?odysseyNoAirMotes=1`.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, dot, exp, float, fract, hash,
    instanceIndex, length, max, mix, positionGeometry, screenSize, sin, smoothstep, uniform, varying, vec3, vec4,
} from 'three/tsl';

/** The air box and the motes' look. */
export const ODYSSEY_AIR = Object.freeze({
    count: 900,
    /** The box round the eye (world units): wide and shallow — the air near the eye's height. */
    box: Object.freeze([120, 46, 120]),
    /** Motes fade in from `near` and out by `far` (world units from the eye). */
    near: 2.6,
    far: 54,
    /** The breeze (unit, x/z) and its speed range (u/s); down drifts slower. */
    wind: Object.freeze([0.8, 0.6]),
    speed: Object.freeze([1.6, 4.2]),
    /** World sizes (radius) per kind: pollen, down, dust. */
    size: Object.freeze([0.045, 0.15, 0.03]),
    /**
     * [fade in from, fully in by, fade out from, gone by] in JOURNEY progress, per kind. Pollen
     * over the shore, down on the meadows, dust on the climb — all gone before the departure.
     */
    windows: Object.freeze({
        pollen: Object.freeze([0.138, 0.150, 0.250, 0.275]),
        down: Object.freeze([0.200, 0.235, 0.355, 0.385]),
        dust: Object.freeze([0.420, 0.470, 0.640, 0.680]),
    }),
});

const win = (w, p) => THREE.MathUtils.smoothstep(p, w[0], w[1]) * (1 - THREE.MathUtils.smoothstep(p, w[2], w[3]));

/** Strength of each kind at journey progress `p` (pure; exported for its test). */
export function airMoteKindsAt(p, cfg = ODYSSEY_AIR) {
    return {
        pollen: win(cfg.windows.pollen, p),
        down: win(cfg.windows.down, p),
        dust: win(cfg.windows.dust, p),
    };
}

/**
 * @param {object} [opts]
 * @param {object} [opts.sunColour] TSL vec3 node: the world's sun colour
 * @param {number} [opts.count] motes (the tier decides)
 */
export function createOdysseyAirMotes({ sunColour = null, count = ODYSSEY_AIR.count } = {}) {
    const n = Math.max(1, Math.round(count));
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.getAttribute('position'));
    geometry.instanceCount = n;

    const uTime = uniform(0);
    // Strengths of pollen, down and dust (x, y, z).
    const uKinds = uniform(new THREE.Vector3(0, 0, 0));
    const sun = sunColour ?? vec3(1.0, 0.96, 0.88);
    const A = ODYSSEY_AIR;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OdysseyAirMotes';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.fog = false;
    const vGlow = varying(vec4(0.0), 'airGlow');
    material.vertexNode = Fn(() => {
        const i = instanceIndex.toFloat();
        const h1 = hash(i.add(0.5)).toVar();
        const h2 = hash(i.add(1337.5)).toVar();
        const h3 = hash(i.add(2741.5)).toVar();
        const h4 = hash(i.add(4099.5)).toVar();
        const h5 = hash(i.add(5813.5)).toVar();
        // Kind: a third each, scaled by the kind's live strength (a kind at 0 draws nothing).
        const kindPick = h5.mul(3.0);
        const isPollen = float(1).sub(smoothstep(0.98, 1.0, kindPick));
        const isDust = smoothstep(1.98, 2.0, kindPick);
        const isDown = float(1).sub(isPollen).sub(isDust);
        const strength = isPollen.mul(uKinds.x).add(isDown.mul(uKinds.y)).add(isDust.mul(uKinds.z)).toVar();

        // A world-anchored lattice of homes, carried downwind (constant rates: no phase trap),
        // wobbling across the wind and bobbing; the box wraps round the eye.
        const wind = vec3(A.wind[0], 0.0, A.wind[1]);
        const across = vec3(A.wind[1] * -1, 0.0, A.wind[0]);
        const speed = mix(float(A.speed[0]), float(A.speed[1]), h4).mul(mix(float(1), float(0.55), isDown));
        const t = uTime;
        const wobble = sin(t.mul(mix(0.35, 0.9, h2)).add(h1.mul(40.0))).mul(mix(0.6, 2.2, isDown));
        const bob = sin(t.mul(mix(0.5, 1.1, h3)).add(h2.mul(30.0))).mul(mix(0.25, 0.9, isDown))
            // Dust falls slowly through the air; down and pollen rise a little on the warm air.
            .add(t.mul(mix(float(0.12), float(-0.35), isDust)));
        const box = vec3(A.box[0], A.box[1], A.box[2]);
        const home = vec3(h1, h2, h3).mul(box);
        const q = home.add(wind.mul(t.mul(speed))).add(across.mul(wobble)).add(vec3(0.0, bob, 0.0));
        const rel = fract(q.sub(cameraPosition).div(box).add(0.5)).sub(0.5).mul(box);
        const centre = cameraPosition.add(rel).toVar();

        const toEye = length(rel);
        const fade = smoothstep(float(A.near), float(A.near * 2.2), toEye)
            .mul(float(1).sub(smoothstep(float(A.far * 0.65), float(A.far), toEye)))
            .mul(strength)
            .toVar();

        // On screen: at least ~1.5 px wide; its light spread thinner when drawn wider than it is.
        const view = cameraViewMatrix.mul(vec4(centre, 1.0));
        const depth = max(view.z.negate(), 0.01);
        const pixelAngle = float(2.0).div(cameraProjectionMatrix.element(1).y.mul(max(screenSize.y, 1.0)));
        const size = isPollen.mul(A.size[0]).add(isDown.mul(A.size[1])).add(isDust.mul(A.size[2]))
            .mul(mix(float(0.7), float(1.3), h2));
        const drawn = max(size, depth.mul(pixelAngle).mul(1.5));
        const cover = size.div(drawn);
        const lifted = view.add(vec4(positionGeometry.xy.mul(drawn.mul(2.0)), 0.0, 0.0));

        // Light: front-lit matter. Down a white tuft, pollen a warm speck that flickers as it turns,
        // dust a pin-point that glints now and then.
        const turn = sin(t.mul(mix(3.0, 8.0, h3)).add(h2.mul(60.0)));
        const glint = max(cos(t.mul(mix(1.5, 4.0, h4)).add(h1.mul(70.0))), 0.0);
        const g2 = glint.mul(glint);
        const g4 = g2.mul(g2);
        const sparkle = g4.mul(g4).mul(3.0);
        const pollenCol = vec3(1.0, 0.84, 0.50).mul(turn.mul(0.3).add(0.7)).mul(0.55);
        const downCol = vec3(1.0, 0.99, 0.96).mul(0.85);
        const dustCol = vec3(0.86, 0.94, 1.0).mul(sparkle.add(0.18));
        const tone = pollenCol.mul(isPollen).add(downCol.mul(isDown)).add(dustCol.mul(isDust));
        const glow = tone.mul(sun).mul(fade).mul(cover.mul(cover).mul(0.7).add(0.3)).mul(0.42);
        vGlow.assign(vec4(glow, isDown));
        return fade.greaterThan(0.002).select(cameraProjectionMatrix.mul(lifted), vec4(0.0, 0.0, -2.0, 1.0));
    })();
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = Fn(() => {
        const corner = positionGeometry.xy.mul(2.0);
        const r2 = dot(corner, corner);
        const speck = exp(r2.mul(-3.4));
        const tuft = exp(r2.mul(-2.0)).mul(0.7).add(exp(r2.mul(-8.0)).mul(0.5));
        return vec4(vGlow.xyz.mul(mix(speck, tuft, clamp(vGlow.w, 0.0, 1.0))), 0.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-air-motes';
    mesh.frustumCulled = false;
    mesh.renderOrder = 30;
    mesh.visible = false;

    return {
        mesh,
        uniforms: { uTime, uKinds },
        /**
         * @param {number} time board clock (s)
         * @param {number} progress journey progress
         */
        update(time, progress) {
            const k = airMoteKindsAt(progress);
            uKinds.value.set(k.pollen, k.down, k.dust);
            uTime.value = time;
            mesh.visible = (k.pollen + k.down + k.dust) > 0.002;
        },
        dispose() {
            geometry.dispose();
            plane.dispose();
            material.dispose();
            mesh.removeFromParent();
        },
    };
}
