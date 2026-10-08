/**
 * Halcyon Apex — the dawn sky.
 *
 * One dome, drawn last among the solids (depth-tested, so it is shaded only where sky shows):
 * the sanctuary's sky function, the sun's disc and its aureole, and two decks of cloud. Each deck
 * is a plane at its own height, met by the view ray, so the clouds lie in true perspective and
 * close up toward the horizon. A cloud is lit from the sun's side (its density is read once more
 * a step toward the sun), thin edges near the sun burn gold, and its far side keeps the dawn's
 * blue.
 *
 * Gameplay: a chain of clears clears the air (the decks thin and brighten); a four-line clear
 * sends a ring of light out over the sky from the Apex.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    acos,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    max,
    mix,
    normalize,
    positionWorld,
    smoothstep,
    step,
    vec2,
    vec3,
} from 'three/tsl';
import { haBell, haPart, haSkyBase } from './halcyon-apex-tsl.js';

/** Radians a second the four-line ring opens across the sky, and how long it lasts. */
export const SHOCK_SPEED = 0.9;
export const SHOCK_LIFE = 2.6;

/**
 * @param {object} u  shared sanctuary uniforms
 * @param {object} [opts]
 * @param {number} [opts.decks=2]      cloud decks drawn (0 = clear sky, 1 = the low banks only)
 * @param {boolean} [opts.lit=true]    a deck's light costs one more fetch
 */
export function createSky(u, opts = {}) {
    const decks = opts.decks ?? 2;
    const litClouds = opts.lit !== false;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HalcyonApexSky';
    material.fog = false;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = true;

    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const up = max(dir.y, 0.0).toVar();
        const cs = dot(dir, u.sunDir).toVar();
        const toward = max(cs, 0.0);
        const col = haSkyBase(u, dir).toVar();

        // ── The sun: a disc, a hot rim of air round it ──
        const edge = u.sunSize.cos();
        const disc = smoothstep(edge.sub(0.00012), edge.add(0.00004), cs);
        const t16 = toward.pow(16.0);
        const aureole = t16.pow(40.0).mul(0.5).add(t16.pow(6.0).mul(0.085));
        const sunLight = u.sun.mul(disc.mul(5.0).add(aureole)).mul(u.breath).toVar();

        // ── Clouds ──
        const sunFlat = normalize(vec2(u.sunDir.x, u.sunDir.z));
        const veil = float(0.0).toVar();
        const clearing = u.power.mul(0.16);
        if (decks >= 2) {
            // High streaks, combed by the wind: they take the dawn's colour whole.
            const hv = dir.xz.div(up.add(0.11));
            const sv = vec2(hv.x.mul(0.86).add(hv.y.mul(0.5)), hv.y.mul(0.86).sub(hv.x.mul(0.5)));
            const s1 = u.noise(vec2(sv.x.mul(0.11), sv.y.mul(0.5)).add(vec2(u.cloudDrift.mul(0.0011), 0.0))).b;
            const s2 = u.noise(vec2(sv.x.mul(0.31), sv.y.mul(1.3)).add(vec2(u.cloudDrift.mul(0.0019), 0.3))).g;
            const streak = smoothstep(float(0.5).add(clearing), 0.82, s1.mul(0.72).add(s2.mul(0.28))).mul(smoothstep(0.03, 0.22, up));
            const high = mix(u.cloud, u.glow.mul(1.5).add(u.cloud), toward.pow(5.0).mul(0.7)).mul(toward.mul(0.5).add(0.62));
            col.assign(mix(col, high, streak.mul(0.5)));
            veil.addAssign(streak.mul(0.35));
        }
        if (decks >= 1) {
            // Low banks standing on the horizon.
            const lv = dir.xz.div(up.add(0.045)).toVar();
            const drift = vec2(u.cloudDrift.mul(0.0016), u.cloudDrift.mul(0.0006));
            const at = (q) => u.noise(q.mul(0.24).add(drift)).r.mul(0.62).add(u.noise(q.mul(0.83).add(drift.mul(2.3))).g.mul(0.38));
            const here = at(lv).toVar();
            const cover = float(0.49).add(clearing);
            const mass = smoothstep(cover, cover.add(0.2), here).toVar();
            // The banks stand low: they thin out overhead and sink into the haze at the horizon.
            const band = smoothstep(0.0, 0.05, up).mul(float(1.0).sub(smoothstep(0.2, 0.5, up)));
            const opacity = mass.mul(band).toVar();
            const bank = u.cloud.toVar();
            if (litClouds) {
                const sunward = at(lv.add(sunFlat.mul(0.3)));
                const facing = clamp(here.sub(sunward).mul(5.5).add(0.5), 0.0, 1.0);
                bank.assign(mix(u.cloudShade, u.cloud.mul(1.2), facing));
            } else {
                bank.assign(mix(u.cloudShade, u.cloud, 0.6));
            }
            // Thin edges toward the sun burn.
            const lining = float(1.0).sub(mass).mul(mass).mul(4.0)
                .mul(toward.pow(7.0));
            const lowCol = bank.mul(toward.mul(0.35).add(0.8)).add(u.glow.mul(lining).mul(1.6)).mul(u.breath.mul(0.4).add(0.6));
            // Distance hazes a bank toward the sky it stands in.
            col.assign(mix(col, mix(lowCol, col, exp(up.mul(-16.0)).mul(0.75)), opacity.mul(0.92)));
            veil.addAssign(opacity);
        }
        // The sun burns through thin cloud, not through a bank.
        col.addAssign(sunLight.mul(float(1.0).sub(clamp(veil, 0.0, 1.0).mul(0.8))));

        // ── A four-line clear: a ring of light opens over the sky from the Apex ──
        const age = u.time.sub(u.shock.x);
        const toApex = normalize(u.apexPos.sub(cameraPosition));
        const angle = acos(clamp(dot(dir, toApex), -1.0, 1.0));
        const front = age.mul(SHOCK_SPEED);
        const ringLight = haBell(angle.sub(front).div(float(0.035).add(front.mul(0.05)))).mul(exp(age.mul(-1.5))).mul(step(0.0, age))
            .mul(u.shock.y);
        const wash = float(1.0).sub(smoothstep(0.0, 0.4, angle.sub(front).abs())).mul(exp(age.mul(-2.2))).mul(step(0.0, age))
            .mul(u.shock.y);
        col.addAssign(mix(u.ley, vec3(1.0, 0.92, 0.78), 0.55).mul(ringLight.mul(2.2).add(wash.mul(0.07))));
        // The overdrive lifts the whole dawn.
        col.mulAssign(u.surge.mul(0.22).add(1.0));
        return col;
    })();

    const geometry = new THREE.SphereGeometry(9000, 48, 24);
    const part = haPart('HalcyonApexSky', geometry, material, -10);
    return part;
}
