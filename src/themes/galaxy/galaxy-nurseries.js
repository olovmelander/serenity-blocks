/**
 * Galaxy — the star nurseries, and the light they hold.
 *
 * Knots of glowing gas along the trailing edge of both arms: one instanced draw of camera-facing
 * quads. They are the instrument the board plays. A lock's seed lands in one: it ignites in the
 * piece's colour, a ring leaves it through the gas, and it KEEPS some of that light (it fades
 * over half a minute). A clear lets everything go: as the wave from the nucleus passes a nursery
 * its stored light goes nova — a white flash, a shell in the colour it held — and it is dark
 * again. So the more of the galaxy the player has lit, the more a clear sets off.
 *
 * Per-nursery state is two instanced attributes written only when gameplay happens:
 *   aHold  (epoch, flash time, flash amount, flash kind)
 *          the light held is ONE number, the moment it would have been lit at full strength:
 *          held(t) = e^(−(t − epoch)/STORE_HOLD), so nothing is written per frame;
 *          kind 0 = an ignition (a seed landing), 1 = a nova
 *   aTint  (colour held, seed)
 * Events are queued with the time they happen at (a seed's landing, a wave front's passing) and
 * applied on the frame that reaches it, so a nova can never run ahead of its wave, and whether
 * a nursery has anything to let go is decided when the wave gets there.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    cos,
    exp,
    float,
    length,
    max,
    min,
    mix,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uv,
    varyingProperty,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    NOVA_LIFE, PULSE_FADE, STORE_HOLD, STORE_MAX, epochFor, gxArmAngle, gxFxMaterial, gxMax3, gxPart,
    gxQuadGeometry, gxWaveLight, heldAt, wavePassTime,
} from './galaxy-tsl.js';

/** How far a nova's shell runs, in nursery radii. */
const NOVA_REACH = 1.3;
const NOVA_TAU = 0.25;
/** Never drawn smaller than this many pixels across (half-extent). */
const MIN_PX = 3;
const NO_LIGHT = -1e5;

/**
 * @param {object} u      shared galaxy uniforms
 * @param {Array} sites   the plan's nurseries
 * @param {number} count  nurseries drawn (a prefix of the plan)
 */
export function createNurseries(u, sites, count) {
    const n = Math.max(1, Math.min(sites.length, Math.round(count)));
    const aSite = new Float32Array(n * 4);
    const aHold = new Float32Array(n * 4);
    const aTint = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
        const s = sites[i];
        aSite.set([s.radius, s.offset, s.y, s.size], i * 4);
        aHold.set([NO_LIGHT, -100, 0, 0], i * 4);
        aTint.set([1, 1, 1, s.seed], i * 4);
    }
    const geometry = gxQuadGeometry(n, { aSite: [aSite, 4], aHold: [aHold, 4], aTint: [aTint, 4] });
    geometry.getAttribute('aHold').setUsage(THREE.DynamicDrawUsage);
    geometry.getAttribute('aTint').setUsage(THREE.DynamicDrawUsage);
    const site = attribute('aSite', 'vec4');
    const hold = attribute('aHold', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = gxFxMaterial('GalaxyNurseries');
    /** (held light, flash age, flash amount, flash kind) and (quad half-extent in radii, wave gain). */
    const vState = varyingProperty('vec4', 'gxNurseryState');
    const vShape = varyingProperty('vec2', 'gxNurseryShape');
    const vTint = varyingProperty('vec4', 'gxNurseryTint');
    material.vertexNode = Fn(() => {
        const radius = site.x;
        const angle = gxArmAngle(radius, u.winding).add(site.y);
        const local = vec3(cos(angle).mul(radius), site.z, sin(angle).mul(radius)).toVar();
        const waveGain = float(0.0).toVar();
        If(u.wavesLive.greaterThan(0.5), () => {
            const wave = gxWaveLight(u, radius).toVar();
            local.y.addAssign(gxMax3(wave.rgb).mul(2.4));
            waveGain.assign(gxMax3(wave.rgb).mul(1.2).add(wave.a.mul(0.3)));
        });
        const world = u.frame.mul(vec4(local, 1.0)).xyz;
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0)).toVar();

        const age = u.time.sub(hold.y);
        const held = min(float(STORE_MAX), exp(u.time.sub(hold.x).div(-STORE_HOLD)));
        const nova = step(0.5, hold.w).mul(step(0.0, age)).mul(step(age, NOVA_LIFE));
        const shell = float(NOVA_REACH).mul(float(1.0).sub(exp(max(age, 0.0).div(-NOVA_TAU)))).mul(nova);
        // Room for the cloud, the spikes of a lit nursery and a nova's shell.
        const extent = max(max(float(2.3), held.mul(1.5).add(2.3)), shell.mul(2.0).add(2.3));
        const px = max(site.w.mul(extent).div(max(clip.w, 1.0).mul(u.pixelAngle)), MIN_PX);
        vState.assign(vec4(held, age, hold.z, hold.w));
        vShape.assign(vec2(extent, waveGain));
        vTint.assign(tint);
        const half = u.viewport.mul(0.5);
        return vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    })();

    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0).toVar();
        const p = q.mul(vShape.x).toVar();
        const rho2 = p.dot(p).toVar();
        const edge = float(1.0).sub(smoothstep(0.82, 1.0, length(q)));
        const held = vState.x;
        const age = vState.y;
        const amount = vState.z;
        const isNova = step(0.5, vState.w);
        const seed = vTint.w;
        const white = vec3(1.0, 0.97, 0.95);

        // At rest: the nursery's own glow, breathing.
        const breathe = sin(u.time.mul(seed.mul(1.3).add(0.5)).add(seed.mul(50.0))).mul(0.16).add(0.84);
        const col = u.nursery.mul(exp(rho2.mul(-1.5)).mul(0.17).mul(breathe))
            .add(u.nursery.mul(0.55).add(0.45).mul(exp(rho2.mul(-24.0)).mul(0.42)))
            .toVar();

        // The light it holds: a small cloud in the piece's colour, a hot heart, four long spikes.
        const cloud = exp(rho2.mul(-2.4)).mul(0.32).add(exp(rho2.mul(-8.0)).mul(0.7));
        const heart = exp(rho2.mul(-80.0)).mul(5.0);
        const spikes = exp(abs(p.y).mul(-42.0)).mul(exp(abs(p.x).mul(-2.3)))
            .add(exp(abs(p.x).mul(-42.0)).mul(exp(abs(p.y).mul(-2.3))))
            .toVar();
        col.addAssign(vTint.rgb.mul(held).mul(cloud.add(spikes.mul(min(held, 1.6)).mul(0.6))));
        col.addAssign(mix(vTint.rgb, white, 0.62).mul(held).mul(heart));

        const live = step(0.0, age);
        const t = max(age, 0.0);
        // A seed lands: a starburst (the ring it sends out is the gas's own: galaxy-disc.js).
        const strike = float(1.0).sub(isNova).mul(amount).mul(exp(t.div(-PULSE_FADE)))
            .mul(live);
        col.addAssign(mix(vTint.rgb, white, 0.55).mul(strike)
            .mul(exp(rho2.mul(-3.2)).mul(2.0).add(spikes.mul(1.4)).add(exp(rho2.mul(-0.8)).mul(0.5))));

        // A wave passes: what it held goes nova — a white starburst, a quick swell of its colour,
        // and an ember that lingers.
        const nova = isNova.mul(amount).mul(live).mul(step(age, NOVA_LIFE));
        const reach = float(NOVA_REACH).mul(float(1.0).sub(exp(t.div(-NOVA_TAU)))).add(0.45);
        const swell = exp(rho2.div(reach.mul(reach)).negate()).mul(exp(t.div(-0.3)));
        col.addAssign(white.mul(nova).mul(exp(t.div(-0.1))).mul(exp(rho2.mul(-6.0)).mul(4.0).add(spikes.mul(2.5))));
        col.addAssign(vTint.rgb.mul(nova).mul(swell.mul(1.1).add(exp(t.div(-0.8)).mul(exp(rho2.mul(-2.5))).mul(0.45))));

        return vec4(col.mul(vShape.y.add(1.0)).mul(edge).mul(u.breath), 0.0);
    })();

    const part = gxPart('GalaxyNurseries', geometry, material, 10);
    part.count = n;
    part.sites = sites;

    /** Events waiting for their moment, soonest first. */
    const pending = [];
    const queue = (event) => {
        let at = pending.length;
        while (at > 0 && pending[at - 1].time > event.time) at -= 1;
        pending.splice(at, 0, event);
    };
    /** Apply one event; false when it changed nothing (a wave passing a dark nursery). */
    const apply = (event) => {
        const o = event.index * 4;
        const before = heldAt(aHold[o], event.time);
        if (event.kind === 1) {
            const amount = Math.max(event.floor, before > 0.06 ? 0.35 + before * 0.5 : 0);
            if (amount <= 0) return false;
            aHold.set([NO_LIGHT, event.time, amount, 1], o);
            event.amount = amount;
            event.held = before;
            return true;
        }
        // An ignition: its colour joins what the nursery already holds.
        const total = before + event.amount;
        const k = total > 1e-4 ? event.amount / total : 1;
        for (let c = 0; c < 3; c++) aTint[o + c] += (event.rgb[c] - aTint[o + c]) * k;
        aHold.set([epochFor(Math.min(STORE_MAX, total), event.time), event.time, event.amount, 0], o);
        return true;
    };

    /** A seed carrying `amount` of light in `rgb` lands in nursery `index` at `time`. */
    part.strike = (index, rgb, time, amount) => {
        if (!(index >= 0 && index < n) || !Number.isFinite(time)) return;
        queue({
            time, index, kind: 0, amount, rgb: [rgb[0], rgb[1], rgb[2]],
        });
    };

    /**
     * A clear wave born at `birth`: every nursery is asked to let go as the wave passes it.
     * Whether it has anything to let go is decided at that moment, not now (a seed may still
     * be on its way, an earlier wave may empty it first). `floor` > 0 sets off the dark ones
     * too (a four-line clear). `rgb` and `sparks` ride along for whoever answers the nova: the
     * wave's own colour, and this nova's share of the debris pool.
     */
    part.release = (birth, { floor = 0, rgb = null, sparks = 0 } = {}) => {
        if (!Number.isFinite(birth)) return;
        for (let i = 0; i < n; i++) {
            queue({
                time: birth + wavePassTime(aSite[i * 4]), index: i, kind: 1, floor, rgb, sparks,
            });
        }
    };

    const applied = [];
    /**
     * Apply everything whose moment has come. Returns what happened, soonest first (a reused
     * array): `{ kind: 0, index, time, amount, rgb }` for a seed that landed,
     * `{ kind: 1, index, time, amount, held, rgb, sparks }` for a nova.
     */
    part.update = (time) => {
        applied.length = 0;
        while (pending.length && pending[0].time <= time) {
            const event = pending.shift();
            if (apply(event)) applied.push(event);
        }
        if (applied.length) {
            geometry.getAttribute('aHold').needsUpdate = true;
            geometry.getAttribute('aTint').needsUpdate = true;
        }
        return applied;
    };

    part.heldAt = (index, time) => heldAt(aHold[index * 4], time);
    part.totalHeld = (time) => {
        let sum = 0;
        for (let i = 0; i < n; i++) sum += heldAt(aHold[i * 4], time);
        return sum;
    };
    /** How many nurseries hold light worth a nova at `time`. */
    part.litCount = (time) => {
        let lit = 0;
        for (let i = 0; i < n; i++) {
            if (heldAt(aHold[i * 4], time) > 0.06) lit += 1;
        }
        return lit;
    };
    part.pendingCount = () => pending.length;
    /** The colour a nursery holds (or last held). */
    part.tintOf = (index) => [aTint[index * 4], aTint[index * 4 + 1], aTint[index * 4 + 2]];

    part.reset = () => {
        pending.length = 0;
        for (let i = 0; i < n; i++) {
            aHold.set([NO_LIGHT, -100, 0, 0], i * 4);
            aTint.set([1, 1, 1], i * 4);
        }
        geometry.getAttribute('aHold').needsUpdate = true;
        geometry.getAttribute('aTint').needsUpdate = true;
    };
    return part;
}
