/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE CLOUD BANK — the ch5 -> ch6 occlusion moment. Summit into cosmos.
 *
 * The second of the two act-edge occlusion moments the plan asks for ("cloud banks that
 * conform to terrain ... fog as a traversable object, not a post effect — this IS the
 * Ch5->Ch6 occlusion moment"). Same architecture as the steam quench and for the same
 * reason: an occlusion moment must actually occlude, and only a volume the camera is INSIDE
 * can do that. Same hard-won construction rules too — alpha and brightness are DECOUPLED
 * (alpha goes opaque as density rises; ALL structure lives in the colour term, because
 * billow-driven alpha punches holes the sky shows through), and noise frequency is set by
 * the radius, not by taste.
 *
 * Where it deliberately differs from the quench:
 *
 *  - IT IS A BANK, NOT A BALL. The mesh is a sphere scaled to [1, 0.35, 1] — a stratus
 *    lens the climb punches through vertically. The scale also stretches the local-space
 *    noise horizontally for free, which is exactly what layered cloud looks like.
 *  - THE COLOUR RAMP RUNS DOWN, NOT THROUGH WHITE. The quench flashes white because fire
 *    meets water; nothing collides here. Climbing out of the summit's daylight, the bank
 *    darkens through the AUTHORED handoff tone — `SEAM_56_AURORA_BRIDGE`'s deep teal, the
 *    very colour the player already sees at this edge — and breaks out into ch6's
 *    near-black void. Building the ramp THROUGH the bridge palette makes the moment
 *    continuous with the shipped seam by construction, rather than competing with it;
 *    the bridge itself STAYS (build first — it colours what is visible around the bank).
 *  - A faint aurora tint lifts the brightest billows inside the dense half, so the bank
 *    reads as the aurora seen from within rather than as grey murk.
 */
import * as THREE from 'three/webgpu';
import {
    clamp,
    float,
    mix,
    positionLocal,
    smoothstep,
    uniform,
    vec3,
} from 'three/tsl';
import { fbm3 } from '../chapter-environments/shared/odyssey-tsl-noise.js';
import { SEAM_56_AURORA_BRIDGE } from '../chapter-environments/shared/seam-bridges.js';

/** World radius of the bank (before the Y squash). The journey's largest transition. */
export const CLOUD_BANK_RADIUS = 150;
/** Vertical squash — a stratus lens, not a sphere. */
export const CLOUD_BANK_Y_SCALE = 0.35;

/** Entry side: Ch5's bright cloud-cathedral daylight. */
const BANK_DAYLIT = new THREE.Color(0xdfeaf6);
/** The authored handoff tone — the bank's midpoint IS the bridge fog colour. */
const BANK_BRIDGE = new THREE.Color(SEAM_56_AURORA_BRIDGE.fogColor);
/** Exit side: ch6's near-black vacuum. */
const BANK_VOID = new THREE.Color(0x05060f);
/** Aurora lift on the bright billows in the dense half (the bridge's ambient teal). */
const BANK_AURORA = new THREE.Color(SEAM_56_AURORA_BRIDGE.ambientLight);

/**
 * @param {object} [opts]
 * @param {number} [opts.radius]
 * @returns {{ mesh: THREE.Mesh, update: (t:number, seamT:number) => void, dispose: () => void }}
 *   `seamT` is 0 approaching the boundary (late ch5), 0.5 at it, 1 leaving it (early ch6).
 */
export function createCloudBank({ radius = CLOUD_BANK_RADIUS } = {}) {
    const uTime = uniform(0);
    const uDensity = uniform(0);
    // 0 = summit side of the window, 1 = space side. Drives the daylight->void ramp.
    const uAltitude = uniform(0);
    const uDaylit = uniform(BANK_DAYLIT);
    const uBridge = uniform(BANK_BRIDGE);
    const uVoid = uniform(BANK_VOID);
    const uAurora = uniform(BANK_AURORA);

    // Frequency set by the radius (the quench's lesson: 0.028 at r=110 was three cells of
    // flat blur across the whole volume). r=150 -> 0.07 gives ~10 cells across the view.
    // The mesh's Y squash stretches this field horizontally into strata for free.
    const p = positionLocal.mul(0.07);
    const slow = fbm3(p.add(vec3(0.0, uTime.mul(0.02), 0.0)), 4);
    const fast = fbm3(p.mul(3.1).add(vec3(uTime.mul(0.06), 0.0, uTime.mul(0.045))), 3);
    const billowRaw = clamp(slow.mul(0.72).add(fast.mul(0.42)), 0.0, 1.0);
    const billow = smoothstep(0.22, 0.78, billowRaw);
    const veil = smoothstep(0.28, 0.86, billow);

    // Alpha: billow-shaped only while thin; fully opaque at peak. Structure lives in colour.
    const d = clamp(uDensity, 0.0, 1.0);
    const alphaShape = mix(veil, float(1.0), d);
    const opacity = clamp(alphaShape.mul(d).mul(1.25), 0.0, 1.0);

    // COLOUR: daylight -> bridge teal -> void, a ramp DOWNWARD in luminance. The first half
    // of the crossing eases into the authored bridge tone; the second half falls to vacuum.
    const a = clamp(uAltitude, 0.0, 1.0);
    const toBridge = smoothstep(0.0, 0.55, a);
    const toVoid = smoothstep(0.45, 1.0, a);
    const base = mix(mix(uDaylit, uBridge, toBridge), uVoid, toVoid);
    // Aurora on the bright billows, strongest mid-crossing where the bank is densest — the
    // aurora seen from inside the weather rather than painted on a dome behind it.
    const auroraAmt = billow.mul(d).mul(smoothstep(0.15, 0.6, a).mul(smoothstep(1.0, 0.6, a))).mul(0.55);
    const colour = mix(base, uAurora, auroraAmt)
        // Interior form in the colour term, never the alpha (the torn-curtain lesson).
        .mul(float(0.42).add(billow.mul(0.72)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colour;
    material.opacityNode = opacity;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.BackSide;
    // Sits exactly where the 5->6 fog lerp is mid-flight; it carries its own ramp. The
    // scene-fog trap has cost this repo four sessions — this volume must not join them.
    material.fog = false;
    material.toneMapped = true;

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), material);
    mesh.scale.set(1, CLOUD_BANK_Y_SCALE, 1);
    mesh.name = 'odyssey-cloud-bank';
    mesh.frustumCulled = false; // the camera flies through it
    mesh.renderOrder = 12;

    return {
        mesh,
        /** @param {number} time seconds @param {number} seamT 0 -> 0.5 boundary -> 1 */
        update(time, seamT) {
            uTime.value = time;
            const t = Math.max(0, Math.min(1, Number.isFinite(seamT) ? seamT : 0));
            const tri = 1 - Math.abs((t * 2) - 1);
            // Squared, as the quench: the approach stays open, then the bank closes.
            uDensity.value = tri * tri;
            uAltitude.value = t;
        },
        dispose() {
            mesh.geometry.dispose();
            material.dispose();
        },
    };
}
