/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Starlight — Lock / Reaction-grammar validation effect (plan §3, §4.7, §10).
//
// Proves the ORDINARY-LOCK cue in isolation: a static board mock + a scripted,
// seeded action sequence drives the real StarlightReactionDirector, which coalesces
// each PIECE_LOCK into ONE dominant cue — a cell-centered stellar seal (ignite →
// crisp hot core → one thin outline) plus a single shallow release wave into the
// sky ~220 ms later. No independent effect storm; every seal originates at the
// piece's actual cell centers.
//
// The script then lands a 6-chain double clear, and the REAL theme CameraDirector
// drives the camera — so the impact-shake ladder (a faint lock tap vs a combo slam)
// is provable here instead of only in numbers.
//
// Deterministic: implements seek(time) (phase-locked replay from 0) and reset(rng)
// so ?t= captures are pixel-reproducible within a session — the camera director's
// idle float and shake phase are both seeded, never Math.random(). The director's
// full grammar (line clears / Tetris / T-spin / B2B / combo / perfect clear) is
// proven renderer-free in tests/unit/starlight-reaction-director.test.js. Kept
// intentionally lean (backdrop + seal, no compute/shockwave/meteor pools) so it is
// a single TDR-safe capture.
//
//   /playground.html?effect=starlight-lock-combo&orbit=0&t=0.75  (lock seal)
//   /playground.html?effect=starlight-lock-combo&orbit=0&t=2.31  (combo shake peak)
//   /playground.html?effect=starlight-lock-combo&orbit=0&t=2.80  (settled A/B pair)
import * as THREE from 'three';
import { createNebulaSky } from '../../themes/starlight/rendering/nebula-sky.js';
import { createDeepStarfield } from '../../themes/starlight/rendering/deep-starfield.js';
import { createStellarSeal, SEAL_LIFETIME } from '../../themes/starlight/rendering/stellar-seal.js';
import { StarlightReactionDirector } from '../../themes/starlight/sim/starlight-reaction-director.js';
import { CameraDirector } from '../../themes/starlight/composition/camera-director.js';

export const meta = {
    id: 'starlight-lock-combo',
    title: 'Starlight — Lock / Reaction grammar',
    description: 'Scripted piece locks driving the reaction director: cell-centered stellar seal + release wave.',
};

// ── static board mock (board-space → world) ──────────────────────────────────
const COLS = 10;
const ROWS = 20;
const CELL = 0.42; // world units per cell → a 4.2×8.4 board centered at the origin
const SEAL_SIZE = CELL * 1.15; // halos overlap slightly → the piece reads as one connected glyph
const LOOP_PERIOD = 3.0; // the scripted sequence repeats every 3 s (live viewing)

function cellToWorld(col, row) {
    return {
        x: (col + 0.5 - COLS / 2) * CELL,
        y: (ROWS / 2 - (row + 0.5)) * CELL,
        z: 0,
    };
}

function centroid(cells) {
    if (!cells.length) return { x: 0, y: 0, z: 0 };
    const s = cells.reduce((a, c) => ({ x: a.x + c.x, y: a.y + c.y, z: a.z + c.z }), { x: 0, y: 0, z: 0 });
    return { x: s.x / cells.length, y: s.y / cells.length, z: s.z / cells.length };
}

// Pieces use a restrained stellar temperature accent each (plan §4.7): amber-warm
// vs blue-white — no rainbow. Board cells are {col,row}; accent is [r,g,b] linear-ish.
const PIECE_T = {
    cells: [{ col: 5, row: 17 }, { col: 4, row: 18 }, { col: 5, row: 18 }, { col: 6, row: 18 }],
    accent: [1.0, 0.74, 0.42], // amber-warm
};
const PIECE_L = {
    cells: [{ col: 1, row: 16 }, { col: 1, row: 17 }, { col: 1, row: 18 }, { col: 2, row: 18 }],
    accent: [0.72, 0.85, 1.0], // blue-white
};

// Scripted resolution sequence (phase-relative seconds). Two ordinary locks, then a
// 6-chain double clear — so the effect covers both halves of its name and the camera
// shake ladder (lock tap vs combo slam) can be compared at phase-locked times.
// t≈0.75 lands on the first seal's hot core; t≈2.31 lands on the combo's shake peak.
const SCRIPT = [
    { t: 0.55, kind: 'lock', piece: PIECE_T },
    { t: 1.70, kind: 'lock', piece: PIECE_L },
    {
        t: 2.30, kind: 'combo', comboCount: 6, lineCount: 2, clearedRows: [17, 18],
    },
];

export function create({
    scene, camera, renderer, sizes,
}) {
    const nebula = createNebulaSky();
    const starfield = createDeepStarfield({ count: 9000 });
    const seal = createStellarSeal({ intensity: 1.15 });
    scene.add(nebula.mesh);
    scene.add(starfield.mesh);
    scene.add(seal.mesh);

    // The REAL theme camera director drives the camera here (same rest framing the
    // theme uses), so camera cues — above all the impact shake — are proven by this
    // effect rather than approximated. idlePhase is pinned for reproducible captures.
    const cameraDirector = new CameraDirector(camera, new THREE.Vector3(0, 0, 0), { idlePhase: 0 });
    cameraDirector.snapToRest();

    // Adapters: the director talks to the world only through these. For the lean lock
    // proof, `seal` + `wave` are the live paths; the rest are lightweight/tracked so a
    // scripted non-lock cue would still resolve without a heavy pool in this effect.
    const _fx = {
        bloomPunch: 0, flashPunch: 0, chromaPunch: 0, vignettePunch: 0,
    };
    const adapters = {
        seal: (cells, opts) => seal.ignite(cells, {
            accent: opts?.accent, size: SEAL_SIZE, strength: opts?.strength ?? 1,
        }),
        wave: (origin, opts) => starfield.triggerWave(origin, opts),
        impulse: () => {}, // no stardust compute in this lean effect (seal shows the gather)
        ring: () => {},
        echo: () => {},
        meteor: () => {},
        sign: () => {},
        // Mirrors the production bridge in starlight-reaction-adapters.js.
        camera: (kind, amount, extra) => {
            if (kind === 'fovPunch') cameraDirector.fovPunch(amount);
            else if (kind === 'vertigo') cameraDirector.vertigo(amount);
            else if (kind === 'shake') cameraDirector.shake(amount, extra ?? 120);
            else cameraDirector.dolly(amount);
        },
        fx: (field, value) => { if (field in _fx) _fx[field] = Math.max(_fx[field], value); },
        aurora: () => {},
    };

    const resolvers = {
        lockCells: (piece) => (piece?.cells || []).map((c) => cellToWorld(c.col, c.row)),
        lockOrigin: (piece) => centroid((piece?.cells || []).map((c) => cellToWorld(c.col, c.row))),
        rowsOrigin: (rows) => cellToWorld(COLS / 2 - 0.5, (rows?.[0] ?? ROWS - 1)),
        rowOrigins: (rows) => (rows || []).map((r) => cellToWorld(COLS / 2 - 0.5, r)),
    };

    const director = new StarlightReactionDirector({ adapters, resolvers });

    // ── clocks ──
    let phase = 0; // cue-system clock (wraps at LOOP_PERIOD)
    let firedIdx = 0; // next SCRIPT action to fire

    const setProj = () => {
        const dpr = typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 1;
        const h = ((sizes && sizes.height) || window.innerHeight) * dpr;
        starfield.setProjection(h, camera.projectionMatrix.elements[5]);
    };

    const fireActionsUpTo = (p) => {
        while (firedIdx < SCRIPT.length && SCRIPT[firedIdx].t <= p) {
            const a = SCRIPT[firedIdx];
            firedIdx += 1;
            if (a.kind === 'lock') {
                director.onPieceLock({ piece: a.piece });
            } else if (a.kind === 'combo') {
                director.onCombo({ comboCount: a.comboCount });
                director.onLineClear({ lineCount: a.lineCount, clearedRows: a.clearedRows });
            }
        }
    };

    // One integration step: `p` drives the cue systems, `absTime` the backdrop drift.
    // The camera director advances here (not in camera()) because the harness calls
    // camera() BEFORE update()/seek() — so the shake would lag a frame otherwise.
    const runStep = (p, dt, absTime) => {
        fireActionsUpTo(p);
        director.update(dt);
        cameraDirector.update(dt);
        seal.update(p);
        nebula.update(absTime);
        starfield.update(absTime);
    };

    const resetCues = () => {
        director.reset();
        seal.clear();
        cameraDirector.snapToRest();
        phase = 0;
        firedIdx = 0;
        _fx.bloomPunch = 0; _fx.flashPunch = 0; _fx.chromaPunch = 0; _fx.vignettePunch = 0;
    };

    // Seed one deterministic frame so a t=0 (or first) screenshot isn't empty-black.
    setProj();

    return {
        cameraRadius: 14,

        update(time, dt) {
            const d = Number.isFinite(dt) ? dt : 0.016;
            if (d <= 0) { // capture hold with no seek delegate shouldn't happen (we have seek), but be safe
                seal.update(phase);
                nebula.update(time);
                starfield.update(time);
                return;
            }
            let remaining = d;
            // Sub-step across the loop boundary so a wrap never skips the reset.
            while (remaining > 1e-9) {
                const room = LOOP_PERIOD - phase;
                const step = Math.min(remaining, room);
                phase += step;
                remaining -= step;
                runStep(phase, step, time); // backdrop on monotonic global time (smooth live drift)
                if (phase >= LOOP_PERIOD - 1e-9) resetCues();
            }
            setProj();
        },

        // Deterministic phase-locked replay: reset, then step from 0 to (t mod period).
        seek(time) {
            resetCues();
            const target = ((time % LOOP_PERIOD) + LOOP_PERIOD) % LOOP_PERIOD;
            const STEP = 1 / 120;
            let p = 0;
            while (p < target - 1e-9) {
                const step = Math.min(STEP, target - p);
                p += step;
                runStep(p, step, p); // backdrop on phase too → fully reproducible capture
            }
            phase = target; // keep the outer clock consistent if the live loop resumes
            setProj();
        },

        reset() {
            // Re-init deterministic state (RNG threading is a no-op here — the effect is scripted).
            resetCues();
            nebula.update(0);
            starfield.update(0);
        },

        // Present so the harness skips its default orbit rig; the camera itself is
        // written by cameraDirector.update() inside runStep().
        camera() {},

        resize() { setProj(); },

        getCaptureMeta() {
            return {
                board: { cols: COLS, rows: ROWS, cell: CELL },
                loopPeriod: LOOP_PERIOD,
                sealLifetime: SEAL_LIFETIME,
                script: SCRIPT.map((a) => ({ t: a.t, kind: a.kind })),
                // 0.7 = first seal's hot core; 2.31 = the combo's shake peak;
                // 2.80 = the same scene fully settled (the shake A/B pair).
                recommendedCaptureTimes: [0.7, 1.85, 2.31, 2.8],
            };
        },

        getDiagnostics() {
            return {
                phase,
                firedIdx,
                fx: { ..._fx },
                director: director.getDiagnostics(),
                shakeAmplitude: cameraDirector.currentShakeAmplitude(),
                cameraPosition: {
                    x: camera.position.x, y: camera.position.y, z: camera.position.z,
                },
                cameraQuaternion: {
                    x: camera.quaternion.x,
                    y: camera.quaternion.y,
                    z: camera.quaternion.z,
                    w: camera.quaternion.w,
                },
            };
        },

        dispose() {
            director.dispose();
            scene.remove(nebula.mesh);
            scene.remove(starfield.mesh);
            scene.remove(seal.mesh);
            nebula.dispose();
            starfield.dispose();
            seal.dispose();
        },
    };
}
