/**
 * Wolfhour's air: falling snow, diamond dust and the snow devil.
 *
 * Snow: flakes drifting down across the whole frame on the wind, in three depths (the near ones
 * larger, faster and fewer). How much falls is the night's weather (`fall` 0..1: a share of the
 * flakes shows, the rest wait); nothing falls on a clear hour.
 *
 * Diamond dust: on the coldest nights the air itself glitters. `dust` (0..1.5) lights tiny ice
 * crystals hanging in the air that catch the moon and go out again, each on its own beat (never
 * smaller than a pixel, so the camera's drift does not make them shimmer). A perfect clear fills
 * the frame with it.
 *
 * The snow devil: a twist whirls the loose snow up into a column that turns, climbs and thins
 * (`whirl(time, x, y, strength)`), one at a time; a second twist while one stands feeds it.
 *
 * Every flake and crystal is a pure function of the time: instanced quads moved in the vertex
 * stage, nothing uploaded per frame. Not built on the lowest tier.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cos, exp, float, fract, mix, positionGeometry, sin, smoothstep, uniform, uv, vec2, vec3,
} from 'three/tsl';
import { flatVarying } from '../shared/flat-varying.js';
import { wolfhourRandom, createWolfhourNightLight } from './wolfhour-sky.js';

/** The box the flakes fall through (world units; it follows the camera) and their numbers by tier. */
const BOX = Object.freeze({ width: 2600, height: 1200 });
const FLAKES = Object.freeze({
    Low: 260, Medium: 520, High: 820, Ultra: 1000, Extreme: 1200,
});
const CRYSTALS = Object.freeze({
    Low: 120, Medium: 260, High: 420, Ultra: 520, Extreme: 640,
});
const DEVIL_MOTES = Object.freeze({
    Low: 60, Medium: 110, High: 150, Ultra: 170, Extreme: 190,
});
/** The snow devil: how long it stands (seconds), how tall and how wide at its top (world units). */
export const SNOW_DEVIL = Object.freeze({
    life: 3.4, height: 330, width: 78, turns: 2.4,
});
/** A feed swells the devil over this long (seconds); a devil handed over fades out over this. */
const DEVIL_FEED = 0.35;
const DEVIL_HANDOVER = 0.25;
const SNOW_LIGHT = vec3(0.3, 0.37, 0.52);
const CRYSTAL_LIGHT = vec3(1.2, 1.35, 1.7);

/** Creates the snow (no renderer); null on the lowest tier. */
export function createWolfhourSnow({ quality = 'High', nightLight = createWolfhourNightLight() } = {}) {
    if (quality === 'Minimal') return null;
    const group = new THREE.Group();
    group.name = 'Wolfhour snow';
    const uTime = uniform(0);
    const uFall = uniform(0);
    const uDust = uniform(0);
    const uWind = uniform(new THREE.Vector2(-22, -46));
    const uCamera = uniform(new THREE.Vector2(0, 0));
    const random = wolfhourRandom(40961);
    const owned = [];

    /* ── falling snow ── */
    const flakeCount = FLAKES[quality] ?? FLAKES.High;
    const flakeGeometry = new THREE.PlaneGeometry(1, 1);
    const flakeSeeds = new Float32Array(flakeCount * 4);
    for (let i = 0; i < flakeCount; i++) {
        flakeSeeds[i * 4] = random();
        flakeSeeds[i * 4 + 1] = random();
        // Depth 0 far .. 1 near (near flakes are few), and its order in the fall.
        flakeSeeds[i * 4 + 2] = random() ** 1.8;
        flakeSeeds[i * 4 + 3] = (i + 0.5) / flakeCount;
    }
    flakeGeometry.setAttribute('aFlake', new THREE.InstancedBufferAttribute(flakeSeeds, 4));
    const flakeMaterial = new THREE.MeshBasicNodeMaterial({
        name: 'Wolfhour falling snow', transparent: true, depthWrite: false, depthTest: false,
    });
    const flake = attribute('aFlake', 'vec4');
    const flakeShown = flatVarying(smoothstep(0, 0.12, uFall.sub(flake.w)), 'wolfhourFlakeShown');
    const flakeDepth = flatVarying(flake.z, 'wolfhourFlakeDepth');
    flakeMaterial.positionNode = Fn(() => {
        const depth = flake.z;
        const speed = depth.mul(0.9).add(0.55);
        // Fall on the wind, swaying; wrapped into the box, which follows the camera.
        const sway = sin(uTime.mul(flake.x.mul(0.7).add(0.5)).add(flake.y.mul(40))).mul(depth.mul(10).add(6));
        const x = fract(flake.x.add(uTime.mul(uWind.x).mul(speed).div(BOX.width))).sub(0.5).mul(BOX.width).add(sway);
        const y = fract(flake.y.add(uTime.mul(uWind.y).mul(speed).div(BOX.height))).sub(0.5).mul(BOX.height);
        const size = depth.mul(5.4).add(2.1);
        return vec3(
            positionGeometry.x.mul(size).add(x).add(uCamera.x),
            positionGeometry.y.mul(size).add(y).add(uCamera.y),
            depth.mul(300).add(-250),
        );
    })();
    const fp = uv().sub(0.5).mul(2);
    flakeMaterial.colorNode = SNOW_LIGHT.mul(nightLight.uMoon).mul(flakeDepth.mul(0.5).add(0.75));
    flakeMaterial.opacityNode = exp(fp.dot(fp).mul(-2.6)).mul(float(1).sub(fp.dot(fp)).max(0))
        .mul(flakeShown).mul(mix(0.62, 0.95, flakeDepth));
    const flakes = new THREE.InstancedMesh(flakeGeometry, flakeMaterial, flakeCount);
    flakes.name = 'Wolfhour falling snow';
    flakes.frustumCulled = false;
    flakes.visible = false;
    group.add(flakes);
    owned.push(flakeGeometry, flakeMaterial, flakes);

    /* ── diamond dust ── */
    const crystalCount = CRYSTALS[quality] ?? CRYSTALS.High;
    const crystalGeometry = new THREE.PlaneGeometry(1, 1);
    const crystalSeeds = new Float32Array(crystalCount * 4);
    for (let i = 0; i < crystalCount; i++) {
        crystalSeeds[i * 4] = random();
        crystalSeeds[i * 4 + 1] = random();
        crystalSeeds[i * 4 + 2] = random();
        crystalSeeds[i * 4 + 3] = (i + 0.5) / crystalCount;
    }
    crystalGeometry.setAttribute('aCrystal', new THREE.InstancedBufferAttribute(crystalSeeds, 4));
    const crystalMaterial = new THREE.MeshBasicNodeMaterial({
        name: 'Wolfhour diamond dust',
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
    });
    const crystal = attribute('aCrystal', 'vec4');
    // Each crystal turns on its own beat: it catches the moon for a moment and goes out.
    const beat = uTime.mul(crystal.z.mul(0.5).add(0.35)).add(crystal.x.mul(17));
    const flash = sin(beat).max(0).pow(7);
    const crystalShown = flatVarying(
        flash.mul(smoothstep(0, 0.25, uDust.mul(1.05).sub(crystal.w))).mul(uDust.min(1).mul(0.6).add(0.4)),
        'wolfhourCrystalShown',
    );
    crystalMaterial.positionNode = Fn(() => {
        // They hang and drift, slowly sinking.
        const x = fract(crystal.x.add(uTime.mul(-0.004)).add(sin(uTime.mul(0.21).add(crystal.z.mul(30))).mul(0.004)))
            .sub(0.5).mul(BOX.width);
        const y = fract(crystal.y.add(uTime.mul(-0.006))).sub(0.5).mul(BOX.height);
        const size = crystal.z.mul(8).add(8);
        return vec3(
            positionGeometry.x.mul(size).add(x).add(uCamera.x),
            positionGeometry.y.mul(size).add(y).add(uCamera.y),
            60,
        );
    })();
    const cp = uv().sub(0.5).mul(2);
    // A point with a short cross: a crystal's glint.
    const core = exp(cp.dot(cp).mul(-26));
    const cross = exp(cp.x.mul(cp.x).mul(-220)).mul(exp(cp.y.mul(cp.y).mul(-5)))
        .add(exp(cp.y.mul(cp.y).mul(-220)).mul(exp(cp.x.mul(cp.x).mul(-5))));
    crystalMaterial.colorNode = CRYSTAL_LIGHT.mul(nightLight.uMoon);
    crystalMaterial.opacityNode = core.add(cross.mul(0.5)).mul(crystalShown).min(1);
    const crystals = new THREE.InstancedMesh(crystalGeometry, crystalMaterial, crystalCount);
    crystals.name = 'Wolfhour diamond dust';
    crystals.frustumCulled = false;
    crystals.visible = false;
    group.add(crystals);
    owned.push(crystalGeometry, crystalMaterial, crystals);

    /* ── the snow devil ── */
    const moteCount = DEVIL_MOTES[quality] ?? DEVIL_MOTES.High;
    const moteGeometry = new THREE.PlaneGeometry(1, 1);
    const moteSeeds = new Float32Array(moteCount * 4);
    for (let i = 0; i < moteCount; i++) {
        moteSeeds[i * 4] = random();
        moteSeeds[i * 4 + 1] = random();
        moteSeeds[i * 4 + 2] = random();
        moteSeeds[i * 4 + 3] = random();
    }
    moteGeometry.setAttribute('aMote', new THREE.InstancedBufferAttribute(moteSeeds, 4));
    const uDevil = uniform(new THREE.Vector4(0, 0, -1e3, 0));
    const moteMaterial = new THREE.MeshBasicNodeMaterial({
        name: 'Wolfhour snow devil', transparent: true, depthWrite: false, depthTest: false,
    });
    const mote = attribute('aMote', 'vec4');
    const devilAge = uTime.sub(uDevil.z).div(SNOW_DEVIL.life);
    const moteLight = flatVarying(Fn(() => {
        const age = devilAge.clamp(0, 1);
        // Each mote climbs the column in its own time; the column rises, stands and thins.
        const climb = fract(mote.x.add(age.mul(mote.y.mul(0.9).add(0.9))));
        const envelope = smoothstep(0, 0.12, age).mul(float(1).sub(smoothstep(0.55, 1, age)));
        const turn = mote.z.mul(6.283).add(age.mul(SNOW_DEVIL.turns * 6.283).mul(mote.w.mul(0.6).add(0.7)));
        // In front of the column a mote is bright, behind it dim.
        return vec2(envelope.mul(float(1).sub(climb).mul(0.75).add(0.25)).mul(uDevil.w), cos(turn));
    })(), 'wolfhourMoteLight');
    moteMaterial.positionNode = Fn(() => {
        const age = devilAge.clamp(0, 1).toVar();
        const climb = fract(mote.x.add(age.mul(mote.y.mul(0.9).add(0.9)))).toVar();
        const turn = mote.z.mul(6.283).add(age.mul(SNOW_DEVIL.turns * 6.283).mul(mote.w.mul(0.6).add(0.7)));
        // A cone standing on its point, leaning with the wind as it climbs, its waist wandering.
        const radius = climb.pow(0.7).mul(SNOW_DEVIL.width).mul(mote.w.mul(0.5).add(0.6)).add(4);
        const lean = climb.mul(climb).mul(-46).add(sin(climb.mul(7).add(age.mul(9))).mul(9));
        const height = climb.mul(SNOW_DEVIL.height).mul(smoothstep(0, 0.35, age).mul(0.7).add(0.3));
        const size = mote.y.mul(9).add(5).mul(climb.mul(1.2).add(0.8));
        return vec3(
            positionGeometry.x.mul(size).add(uDevil.x).add(sin(turn).mul(radius)).add(lean),
            positionGeometry.y.mul(size).add(uDevil.y).add(height),
            80,
        );
    })();
    const mp = uv().sub(0.5).mul(2);
    moteMaterial.colorNode = SNOW_LIGHT.mul(nightLight.uMoon).mul(moteLight.y.mul(0.45).add(1.15));
    moteMaterial.opacityNode = exp(mp.dot(mp).mul(-2.8)).mul(float(1).sub(mp.dot(mp)).max(0)).mul(moteLight.x)
        .mul(0.95);
    const devil = new THREE.InstancedMesh(moteGeometry, moteMaterial, moteCount);
    devil.name = 'Wolfhour snow devil';
    devil.frustumCulled = false;
    devil.visible = false;
    group.add(devil);
    owned.push(moteGeometry, moteMaterial, devil);

    // The devil's strength eases from `from` to `to` over `over` seconds from `at` (a feed swells
    // it, a hand-over fades it out); a twist that comes while it is fading waits in `next`.
    const state = {
        devilAt: -Infinity,
        strength: {
            from: 0, to: 0, at: -Infinity, over: 1,
        },
        /** @type {{ at: number, x: number, y: number, s: number } | null} */
        next: null,
    };
    const strengthAt = (t) => {
        const eased = state.strength;
        const c = Math.min(1, Math.max(0, (t - eased.at) / eased.over));
        return eased.from + (eased.to - eased.from) * c * c * (3 - 2 * c);
    };
    const ease = (t, to, over) => {
        state.strength.from = strengthAt(t);
        state.strength.to = to;
        state.strength.at = t;
        state.strength.over = over;
    };
    const rise = (at, x, y, s) => {
        state.devilAt = at;
        state.strength.from = s;
        state.strength.to = s;
        state.strength.at = at;
        uDevil.value.set(x, y, at, s);
    };
    return {
        group,
        flakes,
        crystals,
        devil,
        /**
         * How strongly the snow devil shows at `time` (0: none): its strength under the column's
         * own rise and thinning (the motes' envelope). It eases; it never steps.
         */
        devilStrength(time) {
            const a = (time - state.devilAt) / SNOW_DEVIL.life;
            if (!Number.isFinite(time) || !(a >= 0 && a <= 1)) return 0;
            const step = (from, to, x) => {
                const c = Math.min(1, Math.max(0, (x - from) / (to - from)));
                return c * c * (3 - 2 * c);
            };
            return strengthAt(time) * step(0, 0.12, a) * (1 - step(0.55, 1, a));
        },
        /** How long the snow devil still stands at `time` (seconds; 0: gone). */
        devilLeft(time) {
            return Math.max(0, SNOW_DEVIL.life - (time - state.devilAt));
        },
        /**
         * A twist: the snow devil rises at world (x, y). While one still stands in its first half
         * it is fed instead (it swells stronger where it is); in its second half it fades out
         * over DEVIL_HANDOVER and the new one rises as it goes (never cut off). `strength` 0..1.
         */
        whirl(time, x, y, strength = 1) {
            if (!Number.isFinite(time) || !Number.isFinite(x) || !Number.isFinite(y)) return;
            const s = Math.min(1, Math.max(0.3, strength));
            if (state.next) {
                state.next.s = Math.max(state.next.s, s);
                return;
            }
            const age = time - state.devilAt;
            if (age >= 0 && age < SNOW_DEVIL.life * 0.5) {
                ease(time, Math.min(1.25, state.strength.to + s * 0.4), DEVIL_FEED);
                return;
            }
            if (age >= 0 && age < SNOW_DEVIL.life && strengthAt(time) > 0.01) {
                ease(time, 0, DEVIL_HANDOVER);
                state.next = {
                    at: time + DEVIL_HANDOVER, x, y, s,
                };
                return;
            }
            rise(time, x, y, s);
        },
        applyParallax(camera) {
            const cameraX = Number.isFinite(camera?.position?.x) ? camera.position.x : 0;
            const cameraY = Number.isFinite(camera?.position?.y) ? camera.position.y : 0;
            // The air moves with the eye (the box is the frame's).
            uCamera.value.set(cameraX, cameraY);
        },
        /**
         * `fall` 0..1 how much snow falls, `dust` 0..1.5 how much the air glitters, `wind` 0..1.2
         * how hard it blows (the flakes slant with it).
         */
        update(time, { fall = 0, dust = 0, wind = 0 } = {}) {
            const t = Number.isFinite(time) ? time : 0;
            uTime.value = t;
            uFall.value = Math.max(0, Math.min(1, Number.isFinite(fall) ? fall : 0));
            uDust.value = Math.max(0, Math.min(1.5, Number.isFinite(dust) ? dust : 0));
            const blow = Math.max(0, Math.min(1.2, Number.isFinite(wind) ? wind : 0));
            uWind.value.set(-22 - blow * 70, -46 - blow * 10);
            flakes.visible = uFall.value > 0.004;
            crystals.visible = uDust.value > 0.004;
            // A twist waiting for the last devil to fade rises once it has.
            const { next } = state;
            if (next && t >= next.at) {
                state.next = null;
                rise(next.at, next.x, next.y, next.s);
            }
            uDevil.value.w = strengthAt(t);
            const age = t - state.devilAt;
            devil.visible = age >= 0 && age < SNOW_DEVIL.life && uDevil.value.w > 0;
        },
        dispose() {
            group.removeFromParent();
            for (const item of owned) item.dispose?.();
            group.clear();
        },
    };
}
