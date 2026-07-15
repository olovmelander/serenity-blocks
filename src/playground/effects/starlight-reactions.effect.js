/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Starlight — Reaction SHOWCASE (full-screen combo abundance).
//
// Drives the REAL production reaction path — createReactionAdapters + the
// StarlightReactionDirector + the real shockwave / meteor / constellation systems —
// through a scripted sequence of locks, line clears, a quad (four-line clear), a combo-7 escalation,
// a combo-10 apex, and a perfect clear. It exists to verify that a combo fans effects
// across the WHOLE canopy (rings + shooting stars + star signs in the 8 sky lanes),
// not just one spot. stardustSim is null here (no compute → impulses no-op, which are
// invisible dust nudges anyway); the visible abundance is rings/meteors/signs/seal.
//
//   /playground.html?effect=starlight-reactions&orbit=0&t=3.2   (quad burst)
//   /playground.html?effect=starlight-reactions&orbit=0&t=5.3   (combo-10 apex)
import { createNebulaSky } from '../../themes/starlight/rendering/nebula-sky.js';
import { createDeepStarfield } from '../../themes/starlight/rendering/deep-starfield.js';
import { createStellarSeal, SEAL_LIFETIME } from '../../themes/starlight/rendering/stellar-seal.js';
import { ShockwaveSystem } from '../../themes/starlight/sim/shockwave-system.js';
import { createShockwaveRenderer } from '../../themes/starlight/rendering/shockwave-renderer.js';
import { MeteorSystem } from '../../themes/starlight/sim/meteor-system.js';
import { createMeteorRenderer } from '../../themes/starlight/rendering/meteor-renderer.js';
import { ConstellationController } from '../../themes/starlight/sim/constellations.js';
import { createConstellationRenderer } from '../../themes/starlight/rendering/constellation-lines.js';
import { StarlightReactionDirector } from '../../themes/starlight/sim/starlight-reaction-director.js';
import { createReactionAdapters } from '../../themes/starlight/sim/starlight-reaction-adapters.js';

export const meta = {
    id: 'starlight-reactions',
    title: 'Starlight — Reaction showcase',
    description: 'Scripted locks/clears/quad/combo/apex driving the real director — full-canopy abundance.',
};

const SEAL_SIZE = 0.42 * 1.15;
const LOOP_PERIOD = 7.0;

// A T-piece (shape rows top→bottom) near the board bottom for the lock beat.
const T_PIECE = {
    shape: [[0, 1, 0], [1, 1, 1]], x: 4, y: 20, accent: [1.0, 0.74, 0.42],
};

// Scripted resolutions (phase seconds). Combo events fire in the SAME step as their
// clear so the director coalesces them (combo escalates the clear, no double-fire).
const SCRIPT = [
    { t: 0.5, kind: 'lock', piece: T_PIECE },
    {
        t: 1.3, kind: 'clear', lineCount: 1, clearedRows: [18],
    },
    {
        t: 2.1, kind: 'clear', lineCount: 2, clearedRows: [17, 18], combo: 4,
    },
    { t: 3.0, kind: 'tetris', clearedRows: [16, 17, 18, 19] },
    {
        t: 4.1, kind: 'clear', lineCount: 1, clearedRows: [18], combo: 7,
    },
    {
        t: 5.1, kind: 'clear', lineCount: 2, clearedRows: [17, 18], combo: 10,
    }, // apex
    { t: 6.1, kind: 'perfect' },
];

export function create({
    scene, camera, renderer, sizes,
}) {
    const nebula = createNebulaSky();
    const starfield = createDeepStarfield({ count: 9000 });
    const shockwaves = new ShockwaveSystem();
    const shockwaveRenderer = createShockwaveRenderer(shockwaves);
    const meteors = new MeteorSystem(28);
    const meteorRenderer = createMeteorRenderer(meteors, { intensity: 1.0 });
    const constellations = new ConstellationController({ ambient: false }); // combo-driven for the demo
    const constellationRenderer = createConstellationRenderer(constellations);
    const seal = createStellarSeal({ intensity: 1.15 });
    scene.add(nebula.mesh);
    scene.add(starfield.mesh);
    scene.add(shockwaveRenderer.mesh);
    scene.add(meteorRenderer.mesh);
    scene.add(constellationRenderer.group);
    scene.add(seal.mesh);

    let camFov = 0;
    let camDolly = 0;
    let camShake = 0;
    let camShakeDecay = 0;

    // A theme-shaped facade so the REAL createReactionAdapters binds to these subsystems.
    const mockTheme = {
        starfield,
        stardustSim: null, // no compute in this effect → impulses no-op (invisible dust)
        shockwaves,
        meteors,
        constellations,
        cameraDirector: {
            fovPunch: (a) => { camFov += a; },
            dolly: (a) => { camDolly += a; },
            vertigo: (a) => { camDolly += 0.3 * a; },
            shake: (amp, dur) => {
                if (amp <= camShake) return; // don't accumulate cascading shakes
                camShake = amp;
                camShakeDecay = amp / Math.max(16, dur);
            },
        },
        aurora: { surge: () => {} }, // no aurora band mesh in this lean showcase
        fxState: {
            bloomPunch: 0, flashPunch: 0, chromaPunch: 0, vignettePunch: 0,
        },
    };
    const { adapters, resolvers } = createReactionAdapters(mockTheme);
    // Wire the seal (production seal adapter is a deferred no-op) to the seal renderer.
    adapters.seal = (cells, opts) => seal.ignite(cells, {
        accent: opts?.accent, size: SEAL_SIZE, strength: opts?.strength ?? 1,
    });
    const director = new StarlightReactionDirector({ adapters, resolvers });

    let phase = 0;
    let firedIdx = 0;

    const setProj = () => {
        const dpr = typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 1;
        const h = ((sizes && sizes.height) || window.innerHeight) * dpr;
        starfield.setProjection(h, camera.projectionMatrix.elements[5]);
    };

    const fire = (a) => {
        if (a.kind === 'lock') { director.onPieceLock({ piece: a.piece }); return; }
        if (a.kind === 'tetris') { director.onLineClear({ lineCount: 4, clearedRows: a.clearedRows }); return; }
        if (a.kind === 'perfect') { director.onPerfectClear({ depth: 0 }); return; }
        if (a.kind === 'clear') {
            if (a.combo) director.onCombo({ comboCount: a.combo });
            director.onLineClear({ lineCount: a.lineCount, clearedRows: a.clearedRows });
        }
    };

    const fireActionsUpTo = (p) => {
        while (firedIdx < SCRIPT.length && SCRIPT[firedIdx].t <= p) {
            fire(SCRIPT[firedIdx]);
            firedIdx += 1;
        }
    };

    const runStep = (p, dt, absTime) => {
        fireActionsUpTo(p);
        director.update(dt);
        seal.update(p);
        shockwaves.update(dt, p);
        shockwaveRenderer.update(p);
        meteors.update(dt);
        meteorRenderer.update();
        constellations.update(dt);
        constellationRenderer.update();
        nebula.update(absTime);
        starfield.update(absTime);
    };

    const resetCues = () => {
        director.reset();
        seal.clear();
        if (shockwaves.birth) { shockwaves.birth.fill(-1000); shockwaves.maxRadius.fill(0); }
        phase = 0;
        firedIdx = 0;
        camFov = 0;
        camDolly = 0;
    };

    setProj();

    return {
        cameraRadius: 14,

        update(time, dt) {
            const d = Number.isFinite(dt) ? dt : 0.016;
            if (d <= 0) { seal.update(phase); nebula.update(time); starfield.update(time); return; }
            let remaining = d;
            while (remaining > 1e-9) {
                const room = LOOP_PERIOD - phase;
                const step = Math.min(remaining, room);
                phase += step;
                remaining -= step;
                runStep(phase, step, time);
                if (phase >= LOOP_PERIOD - 1e-9) resetCues();
            }
            const k = Math.exp(-6 * d);
            camFov *= k;
            camDolly *= k;
            camShake = Math.max(0, camShake - camShakeDecay * (d * 1000));
            setProj();
        },

        // Deterministic-ish replay for a fixed ?t= capture (meteor/sign scatter uses
        // Math.random so exact pixels vary, but the abundance/placement is representative).
        seek(time) {
            resetCues();
            const target = ((time % LOOP_PERIOD) + LOOP_PERIOD) % LOOP_PERIOD;
            const STEP = 1 / 120;
            let p = 0;
            while (p < target - 1e-9) {
                const step = Math.min(STEP, target - p);
                p += step;
                runStep(p, step, p);
            }
            phase = target;
            setProj();
        },

        camera(time, cam) {
            const fov = 40 + camFov;
            if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
            let sx = 0;
            let sy = 0;
            if (camShake > 0.0001) {
                sx = (Math.random() - 0.5) * camShake * 2;
                sy = (Math.random() - 0.5) * camShake * 2;
            }
            cam.position.set(sx, 0.4 + sy, 14 - camDolly);
            cam.lookAt(0, 0, 0);
        },

        resize() { setProj(); },

        getCaptureMeta() {
            return {
                loopPeriod: LOOP_PERIOD,
                sealLifetime: SEAL_LIFETIME,
                script: SCRIPT.map((a) => ({ t: a.t, kind: a.kind, combo: a.combo })),
                recommendedCaptureTimes: [3.2, 5.3],
            };
        },

        getDiagnostics() {
            return { phase, firedIdx, director: director.getDiagnostics() };
        },

        dispose() {
            director.dispose();
            [nebula.mesh, starfield.mesh, shockwaveRenderer.mesh, meteorRenderer.mesh, seal.mesh]
                .forEach((m) => scene.remove(m));
            scene.remove(constellationRenderer.group);
            nebula.dispose();
            starfield.dispose();
            shockwaveRenderer.dispose();
            meteorRenderer.dispose();
            constellationRenderer.dispose();
            seal.dispose();
            meteors.dispose();
            shockwaves.dispose();
            constellations.dispose();
        },
    };
}
