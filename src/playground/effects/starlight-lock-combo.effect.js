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
// Deterministic: implements seek(time) (phase-locked replay from 0) and reset(rng)
// so ?t= captures are pixel-reproducible within a session. The director's full
// grammar (line clears / Tetris / T-spin / B2B / combo / perfect clear) is proven
// renderer-free in tests/unit/starlight-reaction-director.test.js; this effect proves
// the lock VISUAL. Kept intentionally lean (backdrop + seal, no compute/shockwave/
// meteor pools) so it is a single TDR-safe capture.
//
//   /playground.html?effect=starlight-lock-combo&orbit=0&t=0.75
import { createNebulaSky } from '../../themes/starlight/rendering/nebula-sky.js';
import { createDeepStarfield } from '../../themes/starlight/rendering/deep-starfield.js';
import { createStellarSeal, SEAL_LIFETIME } from '../../themes/starlight/rendering/stellar-seal.js';
import { StarlightReactionDirector } from '../../themes/starlight/sim/starlight-reaction-director.js';

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

// Scripted resolution sequence (phase-relative seconds). Locks only → proves the
// ordinary-lock cue; timings chosen so t≈0.75 lands on the first seal's hot core.
const SCRIPT = [
    { t: 0.55, kind: 'lock', piece: PIECE_T },
    { t: 1.70, kind: 'lock', piece: PIECE_L },
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

    // Camera-punch offsets (delta-normalized decay), applied in camera(). The lock cue
    // never punches, but the director may request one for non-lock cues.
    let camFov = 0;
    let camDolly = 0;

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
        camera: (kind, amount) => {
            if (kind === 'fovPunch') camFov += amount;
            else if (kind === 'dolly' || kind === 'vertigo') camDolly += amount;
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
            if (a.kind === 'lock') director.onPieceLock({ piece: a.piece });
        }
    };

    // One integration step: `p` drives the cue systems, `absTime` the backdrop drift.
    const runStep = (p, dt, absTime) => {
        fireActionsUpTo(p);
        director.update(dt);
        seal.update(p);
        nebula.update(absTime);
        starfield.update(absTime);
    };

    const resetCues = () => {
        director.reset();
        seal.clear();
        phase = 0;
        firedIdx = 0;
        camFov = 0;
        camDolly = 0;
        _fx.bloomPunch = 0; _fx.flashPunch = 0; _fx.chromaPunch = 0; _fx.vignettePunch = 0;
    };

    const decayCam = (dt) => {
        const k = Math.exp(-6 * dt); // delta-normalized settle
        camFov *= k;
        camDolly *= k;
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
            decayCam(d);
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

        camera(time, cam) {
            const fov = 40 + camFov;
            if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
            cam.position.set(0, 0.4, 14 - camDolly);
            cam.lookAt(0, 0, 0);
        },

        resize() { setProj(); },

        getCaptureMeta() {
            return {
                board: { cols: COLS, rows: ROWS, cell: CELL },
                loopPeriod: LOOP_PERIOD,
                sealLifetime: SEAL_LIFETIME,
                script: SCRIPT.map((a) => ({ t: a.t, kind: a.kind })),
                recommendedCaptureTimes: [0.7, 1.85],
            };
        },

        getDiagnostics() {
            return {
                phase, firedIdx, fx: { ..._fx }, director: director.getDiagnostics(),
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
