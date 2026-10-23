/**
 * Sunfall Theme — Gameplay & Atmospheric Director
 *
 * Translates Serenity Blocks gameplay events and elapsed time into smoothed
 * optical, hydrological, and botanical uniforms for the Hang Sơn Đoòng doline:
 * - 5 stations (advancing per level + slow diurnal drift) & 4 micro-weathers
 * - Piece Lock -> Flush (anthocyanin leaf flush + mote eddy)
 * - Hard Drop -> Snap (vertical wind-snap down hanging root curtains)
 * - 1–3 Line Clear -> Rim Shower + Row Ripening + New Growth (delayed greening)
 * - 4-Line Clear -> Cataract + Analytic Double Rainbow (`dlBow` at 42°/51°)
 * - Combo -> Inhale / Sevenfold (up to 7 shafts) & Combo End -> Exhale cloud ring
 * - Back-to-Back -> 1–3 Oculus Flood Threads + Far Doline Echo
 * - T-Spin -> The Turning (+15° persistent oculus vine-fringe rotation per line)
 * - Perfect Clear -> Zenith Flush (a crown on the clear still playing, never a clear of its own)
 * - Game Over / New Run -> The Light Leaves / Morning Enters
 *
 * Everything BUILDS with play instead of popping and resetting. Each envelope a stream of events
 * feeds is a Swell (src/themes/shared/swell.js): a new hit adds to what is still lit, so a lock
 * after a quad can only lift the light. A second quad feeds the cataract still pouring (a new
 * front falls over the standing curtain, and the bow is held, never cut to nothing). Each side's
 * strands keep their own kick, so alternating locks sway both curtains harder rather than
 * switching. The oculus fingers ease between counts on fixed homes, and dissolve when a chain
 * ends instead of collapsing to one hole. The true combo comes from a ComboTracker (the bus's
 * COMBO carries a lock's cascade DEPTH, ADR-0011), and each cascade wave opens one more shaft.
 *
 * The crescendo: a GameplaySurge (src/themes/shared/gameplay-surge.js) on the director's clock
 * reads how hot play runs, and the doline answers in its own terms. Warm: rain begins to glitter
 * in the light, the motes thicken, the strands and swiftlets quicken. Hot: the first flood
 * thread pours from the rim, the far doline's shaft wakes, the wet crowns sparkle. Fever: the
 * monsoon — a downpour lit in the beam, all three threads pouring, the pool's crowns flushing in
 * every piece's pigment and the ring of shafts wheeling slowly. The perfect clear crowns it (the
 * beam swings to the zenith, the pool flushes in seven colours, the bow is held) and lets the
 * chain go: the shafts open into the whole sky and the doline exhales. When the hands rest it
 * breathes back to calm, the pool greening over a few seconds (delayed greening).
 */

import { ComboTracker } from '../../core/combo-tracker.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import {
    PIECE_CODES,
    PIECE_SWATCH_RGB,
    SUNFALL_STATIONS,
    SUNFALL_TIMINGS,
    SUNFALL_WEATHERS,
    approach,
    boardCellToDolineWorld,
    cellsFromMatrix,
    clamp,
    clamp01,
    greeningTau,
    lerp,
    mulberry32,
    packCodes,
    sampleStation,
    sampleWeather,
    smooth,
    stationIndexForLevel,
} from './sunfall-core.js';

const DEG2RAD = Math.PI / 180;
/** How long the oculus fingers hold after a chain's last clear before they dissolve. */
const CHAIN_HOLD = 3.2;
/** A cataract fed by quad after quad may stack this high (it pours longer, never brighter). */
const CATARACT_MAX = 1.8;
/** Seconds a pour's leading edge takes to fall from the rim to the pool (sunfall-water.js). */
const CATARACT_FRONT = 1.6;
/** The cataract thins (its envelope × 1.6, clamped) at this rate a second. */
const CATARACT_THIN = 1.6 / SUNFALL_TIMINGS.cataractSeconds;
const DEFAULT_CODES = Object.freeze(['T', 'S', 'Z', 'I']);

/** The column (0..1 of the board's width) at the centre of a piece's cells. */
function centroidU(cells) {
    if (!cells.length) return 0.5;
    let sum = 0;
    for (const cell of cells) sum += cell.col + 0.5;
    return clamp01(sum / cells.length / 10);
}

export class SunfallDirector {
    constructor({
        seed = 0x53554e46,
        level = 1,
        reducedMotion = false,
        maxNewGrowth = 48,
    } = {}) {
        this.seed = seed >>> 0;
        this.rng = mulberry32(this.seed);
        this.reducedMotion = Boolean(reducedMotion);
        this.maxNewGrowth = Math.max(8, maxNewGrowth);

        this.time = 0;
        this.level = Math.max(1, Math.floor(level || 1));

        // Station & weather state
        this.stationTarget = stationIndexForLevel(this.level);
        this.stationCurrent = this.stationTarget;
        this.stationLocked = null;

        this.weatherIndex = 0;
        this.nextWeatherIndex = 1;
        this.weatherMix = 0;
        this.weatherTimer = 64;
        this.weatherLocked = null;

        // Persistent session state (The Turning: +15° per T-Spin line)
        this.fringeAngleTarget = 0;
        this.fringeAngle = 0;
        this.tSpinCount = 0;

        // Gameplay envelopes: every hit adds to what is still lit (see the header).
        this.flushSwell = new Swell({ release: 1.6, ceiling: 1.4, knee: 1 });
        this.flushPulse = 0;
        this.flushColor = [...PIECE_SWATCH_RGB.T];
        this.flushWorldPos = [14, -10, -92];
        this.flushU = 0.5;
        this.flushRow = 12;

        this.snapSwell = new Swell({ release: 0.9, ceiling: 1.4, knee: 1 });
        this.snapPulse = 0;
        this.snapU = 0.5;
        this.snapColor = [...PIECE_SWATCH_RGB.S];

        /** Each side's strands carry their own kick (left, right): a lock never stills the other. */
        this.kickSwells = [
            new Swell({ release: 1.0, ceiling: 1.6, knee: 1 }),
            new Swell({ release: 1.0, ceiling: 1.6, knee: 1 }),
        ];
        this.kickL = 0;
        this.kickR = 0;

        this.showerSwell = new Swell({ release: 1.4, ceiling: 1.5, knee: 1 });
        this.showerPulse = 0;
        this.ripenSwell = new Swell({ release: 1.6, ceiling: 1.2, knee: 0.9 });
        this.ripenPulse = 0;
        this.ripenRow = 12;
        this.ripenCodesPacked = packCodes(['T', 'S', 'Z', 'I']);

        // 4-line Cataract & Analytic Double Rainbow
        this.cataractPulse = 0;
        this.cataractAge = 999;
        /** The curtain already standing when a new pour's front starts falling over it. */
        this.cataractHold = 0;
        this.bowLive = false;
        this.bowStart = -Infinity;
        /** The bow stays full until here, then fades (a later quad or a crown moves it on). */
        this.bowHold = -Infinity;
        this.rainbowStrength = 0;

        // Combo Inhale / Sevenfold / Exhale
        this.comboTracker = new ComboTracker();
        this.comboCount = 0;
        this.comboPeak = 0;
        this.comboTimer = 0;
        this.comboLift = 0;
        /** How many gaps the chain opens (an integer), and the count shown (eased toward it). */
        this.comboColumns = 1;
        this.comboShafts = 1;
        this.sevenfoldPulse = 0;
        this.exhalePulse = 0;
        this.exhaleAge = 999;

        // Back-to-back Flood Threads (1..3) + Far Doline Echo
        this.b2bCount = 0;
        this.b2bLevel = 0;
        /** A plain clear ends a back-to-back chain unless a T-spin of the same lock follows it. */
        this.b2bBreakPending = false;
        this.floodThreads = 0;
        this.echoBoost = 0;

        // T-Spin Turning flash & Perfect Clear Zenith Flush
        this.turningSwell = new Swell({ release: 1.1, ceiling: 1.2, knee: 0.9 });
        this.turningPulse = 0;
        this.zenithSwell = new Swell({
            attack: 0.45, release: 2.6, ceiling: 1.2, knee: 0.9,
        });
        this.zenithPulse = 0;

        // Level-up pan, Game Over cloud close, Morning Enters
        this.levelPanPulse = 0;
        this.gameOverActive = false;
        this.overCloudClose = 0;
        this.morningPulse = 0;

        // The heat of play, and what the doline wears with it.
        this.surge = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this.windClock = 0;
        this.swiftClock = 0;
        this.poolFlush = 0;
        this.gild = 0;
        this.wet = 0;

        // Botanical New-Growth ring buffer (delayed greening shoots)
        this.newGrowthShoots = [];
        this.nextShootCursor = 0;

        // Recent locks and clears, each with a serial, for the world's leaves and rows.
        this.sessionSerial = 0;
        this.lockSerial = 0;
        this.lockEvents = [];
        this.clearSerial = 0;
        this.clearEvents = [];
        this.lastHardDrop = null;

        // Seed 6 initial young shoots so the garden has living botanical colour at t=0
        for (let i = 0; i < 6; i += 1) {
            const code = PIECE_CODES[i % PIECE_CODES.length];
            this._spawnShoot({
                code,
                col: 1.5 + ((i * 1.4) % 7),
                row: 6 + ((i * 2.3) % 12),
                birthTime: -i * 2.8,
            });
        }
    }

    setReducedMotion(flag) {
        this.reducedMotion = Boolean(flag);
    }

    /** The quality tier's cap on New Growth shoots alive at once (never below 8). */
    setNewGrowthLimit(limit) {
        this.maxNewGrowth = Math.max(8, Number.isFinite(limit) ? limit : 48);
        if (this.newGrowthShoots.length > this.maxNewGrowth) this.newGrowthShoots.length = this.maxNewGrowth;
    }

    /**
     * Pin or release a specific solar station (`0..4` or station id).
     * @param {number|string|null} station
     */
    setStation(station) {
        if (station === null || station === undefined || station === '') {
            this.stationLocked = null;
            return;
        }
        if (typeof station === 'number' && Number.isFinite(station)) {
            this.stationLocked = station;
            this.stationCurrent = station;
            this.stationTarget = station;
            return;
        }
        if (typeof station === 'string') {
            const asNum = Number(station);
            if (Number.isFinite(asNum)) {
                this.stationLocked = asNum;
                this.stationCurrent = asNum;
                this.stationTarget = asNum;
                return;
            }
            const found = SUNFALL_STATIONS.findIndex((s) => s.id === station.trim().toLowerCase());
            if (found >= 0) {
                this.stationLocked = found;
                this.stationCurrent = found;
                this.stationTarget = found;
            }
        }
    }

    /**
     * Pin or release a specific subterranean weather (`clear`, `mist`, `shower`, `cloud`).
     * @param {string|number|null} weather
     */
    setWeather(weather) {
        if (weather === null || weather === undefined || weather === '') {
            this.weatherLocked = null;
            return;
        }
        const resolved = sampleWeather(weather);
        const idx = SUNFALL_WEATHERS.findIndex((w) => w.id === resolved.id);
        if (idx >= 0) {
            this.weatherLocked = idx;
            this.weatherIndex = idx;
            this.nextWeatherIndex = idx;
            this.weatherMix = 0;
        }
    }

    /**
     * Override the persistent oculus vine-fringe angle in degrees (playground `fringe=`).
     * @param {number} degrees
     */
    setFringeDegrees(degrees) {
        if (!Number.isFinite(degrees)) return;
        const rad = degrees * DEG2RAD;
        this.fringeAngleTarget = rad;
        this.fringeAngle = rad;
    }

    /**
     * Piece Lock — Flush: young leaves in the landed zone flush in the piece's colour
     * and sunlit motes swirl upward. `shape`, `col` and `row` place its cells on the visible
     * board (row 0 the top); `u` (0..1 across the board) is its column. `visual: false` (the
     * lock ripple is off) still keeps the combo and the heat of play.
     */
    onPieceLock({
        shape = null,
        code = 'T',
        col = 4,
        row = 12,
        u = null,
        visual = true,
    } = {}) {
        const pieceCode = PIECE_SWATCH_RGB[code] ? code : 'T';
        const cells = cellsFromMatrix(shape, pieceCode, col, row);
        const normU = Number.isFinite(u) ? clamp01(u) : clamp01(cells[0].col / 9);

        // A hard drop already reported this piece (its lock follows in the same tick): it was
        // counted, kicked and planted then. Its real cells replace the drop's guess.
        const drop = this.lastHardDrop;
        if (drop && !drop.claimed && drop.code === pieceCode && this.time - drop.time < 0.3) {
            drop.claimed = true;
            const last = this.lockEvents.find((ev) => ev.serial === drop.serial);
            if (last && Array.isArray(shape)) {
                last.cells = cells.map((c) => ({ col: c.col, row: c.row }));
                last.u = normU;
            }
            return;
        }
        this._lockPiece({
            code: pieceCode, cells, u: normU, hard: false, visual,
        });
    }

    /**
     * Hard Drop — Snap: vertical wind-snap down the hanging root curtains on its side. It is
     * also the piece's lock (the PIECE_LOCK that follows in the same tick is claimed, not
     * counted twice). With a `shape` its cells are the piece's own.
     */
    onHardDrop({
        shape = null,
        code = 'S',
        col = 4.5,
        row = 14,
        u = null,
        distance = 10,
    } = {}) {
        const pieceCode = PIECE_SWATCH_RGB[code] ? code : 'S';
        const scale = clamp(0.65 + (Number(distance) || 10) * 0.025, 0.65, 1.25);
        let cells;
        let normU;
        if (Array.isArray(shape)) {
            cells = cellsFromMatrix(shape, pieceCode, col, row);
            normU = Number.isFinite(u) ? clamp01(u) : centroidU(cells);
        } else {
            normU = Number.isFinite(u) ? clamp01(u) : clamp01(col / 9);
            cells = cellsFromMatrix(null, pieceCode, Math.round(normU * 9), row);
        }
        const event = this._lockPiece({
            code: pieceCode, cells, u: normU, hard: true, strength: scale,
        });
        this.lastHardDrop = {
            code: pieceCode, time: this.time, serial: event ? event.serial : -1, claimed: false,
        };
    }

    /** One piece set down: the combo's bookkeeping, the heat, and (unless muted) its marks. */
    _lockPiece({
        code, cells, u, hard, strength = 1, visual = true,
    }) {
        const t = this.time;
        const before = this.comboTracker.combo;
        if (this.comboTracker.notePieceLocked() === 0 && before >= 2 && this.comboCount > 0) {
            // The chain broke on a lock that cleared nothing: the doline exhales.
            this.releaseCombo(this.comboPeak);
        }
        this.surge.lock({ hardDrop: hard }, t);
        if (!visual) return null;

        const lead = cells[0] || { col: 4, row: 12 };
        this.flushSwell.hit(1, t);
        this.flushPulse = this.flushSwell.valueAt(t);
        this.flushColor = [...PIECE_SWATCH_RGB[code]];
        this.flushWorldPos = boardCellToDolineWorld(u * 9, lead.row);
        this.flushU = u;
        this.flushRow = lead.row;
        const side = u < 0.5 ? 0 : 1;
        this.kickSwells[side].hit(hard ? 0.8 * strength : 0.25, t);
        if (hard) {
            this.snapSwell.hit(strength, t);
            this.snapPulse = this.snapSwell.valueAt(t);
            this.snapU = u;
            this.snapColor = [...PIECE_SWATCH_RGB[code]];
        }
        const event = this._recordLock({
            code, cells, u, hard,
        });
        // A young shoot at the lock site so the garden records the piece.
        this._spawnShoot({
            code,
            col: u * 9,
            row: lead.row,
            birthTime: t,
        });
        return event;
    }

    _recordLock({
        code, cells, u, hard,
    }) {
        this.lockSerial += 1;
        const event = {
            serial: this.lockSerial,
            code,
            cells: cells.map((c) => ({ col: c.col, row: c.row })),
            u,
            hard,
            time: this.time,
        };
        this.lockEvents.push(event);
        if (this.lockEvents.length > 16) this.lockEvents.shift();
        return event;
    }

    /** The pigments of the last few pieces set down (the ones a clear is made of). */
    _recentCodes() {
        const n = this.lockEvents.length;
        if (n === 0) return DEFAULT_CODES;
        const codes = [];
        for (let i = n - 1; i >= 0 && codes.length < 4; i -= 1) codes.push(this.lockEvents[i].code);
        return codes;
    }

    /**
     * Line Clear (one call per cascade wave):
     * - 1–3 lines: Shower from oculus rim + Row Ripening + New Growth shoots
     * - 4 lines: Cataract deluge + delayed Analytic Double Rainbow (`dlBow`)
     * `rows` are visible board rows (0 the top). `cascade` is the wave's depth (each wave
     * builds on the last: heavier rain, one more shaft); `combo` an explicit combo that may
     * raise the one the director counts. A legacy `b2b` count sets the flood threads.
     */
    onLineClear({
        lines = 1,
        rows = [],
        codes = null,
        b2b = null,
        cascade = 1,
        combo = null,
    } = {}) {
        const t = this.time;
        const count = clamp(Math.round(lines || 1), 1, 4);
        const depth = Math.max(1, Math.round(Number(cascade) || 1));
        const pigments = Array.isArray(codes) && codes.length ? codes : this._recentCodes();
        const hasRows = Array.isArray(rows) && rows.length > 0;
        const avgRow = hasRows ? rows.reduce((a, b) => a + b, 0) / rows.length : 12;

        this.ripenSwell.hit(1, t);
        this.ripenPulse = this.ripenSwell.valueAt(t);
        this.ripenRow = clamp(avgRow, 0, 19);
        this.ripenCodesPacked = packCodes(pigments);
        this.clearSerial += 1;
        this.clearEvents.push({
            serial: this.clearSerial,
            rows: hasRows ? rows.slice(0, 4) : [Math.round(avgRow)],
            lines: count,
            time: t,
        });
        if (this.clearEvents.length > 8) this.clearEvents.shift();

        // Spawn `count` new-growth shoots that undergo delayed greening over ~19 s
        for (let i = 0; i < count; i += 1) {
            const c = pigments[i % pigments.length] || PIECE_CODES[(this.nextShootCursor + i) % 7];
            const r = hasRows && rows[i] !== undefined ? rows[i] : avgRow;
            this._spawnShoot({
                code: c,
                col: 1 + ((this.nextShootCursor * 2.3 + i * 2.1) % 8),
                row: clamp(r, 0, 19),
                birthTime: t,
            });
        }

        // The combo: only a lock's first clearing wave advances it; later waves are depth.
        const trueCombo = this.comboTracker.noteLineClear();
        const comboNow = Math.max(trueCombo, Number.isFinite(combo) ? Math.floor(combo) : 0);
        if (depth <= 1) {
            this.surge.clear({ lines: count, combo: comboNow }, t);
        } else {
            this.surge.wave(t);
        }
        // Each wave of a cascade opens one more shaft than the chain alone.
        this._setChain(Math.max(this.comboCount, comboNow + depth - 1));

        if (b2b !== null && b2b !== undefined) {
            this.setB2B(b2b);
        } else if (count < 4 && depth <= 1) {
            this.b2bBreakPending = true;
        }

        // Rain from the rim: every clear adds to the shower still falling, each wave more.
        this.showerSwell.hit(0.45 + count * 0.18 + (depth - 1) * 0.12, t);
        this.showerPulse = this.showerSwell.valueAt(t);
        if (count >= 4) {
            // 4-Line Cataract + Analytic Double Rainbow (a second quad feeds the first).
            this._pour(1);
            this._holdBow(0);
            const leadCode = pigments[0] && PIECE_SWATCH_RGB[pigments[0]] ? pigments[0] : 'S';
            this.flushColor = [...PIECE_SWATCH_RGB[leadCode]];
            this.flushSwell.hit(0.6, t);
            this.flushPulse = this.flushSwell.valueAt(t);
        }
    }

    /**
     * Water from the rim. A fall already pouring is fed (it pours longer), never restarted:
     * once its front has reached the pool a new front falls over the standing curtain.
     */
    _pour(amount) {
        const pouring = this.cataractPulse > 0.01;
        if (!pouring) {
            this.cataractAge = 0;
            this.cataractHold = 0;
            this.cataractPulse = Math.max(this.cataractPulse, amount);
            return;
        }
        if (this.cataractAge >= CATARACT_FRONT) {
            this.cataractHold = Math.max(this.cataractHold, clamp01(this.cataractPulse * 1.6));
            this.cataractAge = 0;
        }
        this.cataractPulse = Math.min(CATARACT_MAX, Math.max(amount, this.cataractPulse + amount * 0.8));
    }

    /** The double bow in the spray: it rises once, and every quad (or crown) holds it longer. */
    _holdBow(extra) {
        const fadeLen = SUNFALL_TIMINGS.cataractRainbowFade - 0.45;
        if (!this.bowLive || this.time > this.bowHold + fadeLen) this.bowStart = this.time;
        this.bowHold = Math.max(this.bowHold, this.time + SUNFALL_TIMINGS.cataractRainbowDelay + 0.45 + extra);
        this.bowLive = true;
    }

    /**
     * Combo — Inhale & Sevenfold (the visual chain; playground and Serenity clicks set it):
     * - 2–3: upward draft, motes spiral up
     * - 4–6: beam splits into 3–5 faceted shafts, swifts tighten orbit
     * - 7+: Sevenfold — 7 piece-tinted shafts ring the main sunfall pillar
     */
    onCombo(count = 0) {
        const c = Math.max(0, Math.floor(count || 0));
        if (c <= 0) {
            if (this.comboCount >= 3) {
                this.releaseCombo(this.comboPeak || this.comboCount);
            }
            this.comboCount = 0;
            return;
        }
        this._setChain(c);
    }

    _setChain(c) {
        this.comboCount = c;
        this.comboPeak = Math.max(this.comboPeak, c);
        this.comboTimer = CHAIN_HOLD;
        if (c >= 7) {
            this.comboColumns = 7;
            this.sevenfoldPulse = 1.0;
        } else if (c >= 4) {
            this.comboColumns = Math.min(5, c - 1);
        } else if (c >= 2) {
            this.comboColumns = 2;
        } else {
            this.comboColumns = 1;
        }
    }

    /**
     * Combo End — Exhale: condenses a soft silver-gold cloud ring at the mid-chamber
     * inversion layer (`y = 28 m`) when a chain of 3+ breaks. A cloud still rising gathers the
     * new mist (it never drops back to the deck). The fingers dissolve where they stand.
     */
    releaseCombo(peak = this.comboPeak) {
        const p = Math.max(0, Math.floor(peak || 0));
        if (p >= 3) {
            const pulse = clamp((p - 2) / 5, 0.35, 1.0);
            if (this.exhalePulse > 0.05) {
                this.exhalePulse = Math.min(1, Math.max(this.exhalePulse, this.exhalePulse * 0.5 + pulse));
            } else {
                this.exhalePulse = pulse;
                this.exhaleAge = 0;
            }
        }
        this.comboCount = 0;
        this.comboPeak = 0;
        this.comboTimer = 0;
    }

    /**
     * Back-to-Back — Flood Threads & Echo:
     * Sustains 1–3 sunlit waterfall threads from the oculus rim and brightens the far doline.
     */
    setB2B(count = 0) {
        const c = Math.max(0, Math.floor(count || 0));
        this.b2bCount = c;
        this.b2bLevel = clamp(c, 0, 3);
    }

    /** A back-to-back difficult clear (EVENTS.B2B): one more thread pours, the bow holds. */
    onB2B() {
        this.b2bBreakPending = false;
        this.setB2B(this.b2bCount + 1);
        this.surge.b2b(this.time);
        if (this.bowLive) this._holdBow(1.2);
    }

    /**
     * T-Spin — The Turning:
     * Rotates the oculus vine-fringe stencil by +15° per line (persisting for the session!).
     * A T-spin that clears nothing turns it half a step.
     */
    onTSpin({ lines = 2, isMini = false } = {}) {
        const n = Math.round(Number(lines) || 0);
        const turns = n > 0 ? clamp(n, 1, 3) : 0.5;
        const stepDeg = (isMini ? 0.65 : 1.0) * SUNFALL_TIMINGS.tSpinTurnDeg * turns;
        const stepRad = stepDeg * DEG2RAD;
        const t = this.time;

        this.b2bBreakPending = false;
        this.tSpinCount += 1;
        this.fringeAngleTarget += stepRad;
        if (this.reducedMotion) {
            this.fringeAngle = this.fringeAngleTarget;
        }
        this.turningSwell.hit(1, t);
        this.turningPulse = this.turningSwell.valueAt(t);
        this.showerSwell.hit(n > 0 ? 0.5 : 0.3, t);
        this.showerPulse = this.showerSwell.valueAt(t);
        if (n > 0) this.surge.tspin(t);
        else this.surge.spin(t);
    }

    /**
     * Perfect Clear — Zenith Flush, the crown on the clear still playing: the beam swings
     * toward the zenith, the deck parts wide, every young shoot flushes in all 7 piece colours,
     * the water pours on (a bow already standing is held) — and the chain is let go.
     */
    onPerfectClear() {
        const t = this.time;
        this.zenithSwell.hit(1, t);
        this.zenithPulse = this.zenithSwell.valueAt(t);
        // The water pours, but the bow belongs to four lines alone.
        this._pour(0.85);
        if (this.bowLive) this._holdBow(1.6);
        for (let i = 0; i < 7; i += 1) {
            this._spawnShoot({
                code: PIECE_CODES[i],
                col: 1 + i * 1.25,
                row: 4 + ((i * 2) % 14),
                birthTime: t,
            });
        }
        this.surge.crown(t);
        if (this.comboCount > 0) this.releaseCombo(Math.max(this.comboPeak, this.comboCount));
    }

    /**
     * Level Up — The Light Walks:
     * Advances the sun station by +1.0 over `6.5` s (instant under reducedMotion).
     */
    onLevelUp(newLevel = this.level + 1) {
        const lv = Math.max(1, Math.floor(newLevel || 1));
        this.level = lv;
        if (this.stationLocked === null) {
            this.stationTarget += SUNFALL_TIMINGS.levelAdvance;
            if (this.reducedMotion) {
                this.stationCurrent = this.stationTarget;
            }
        }
        this.levelPanPulse = 1.0;
        this.surge.levelUp(this.time);
    }

    /**
     * Game Over — The Light Leaves:
     * Cave-cloud deck closes softly across the oculus over 2.6 s; chamber bounce remains.
     */
    onGameOver() {
        this.gameOverActive = true;
        this.morningPulse = 0;
    }

    /** A new run (any mode start, Play again included): morning, the session afresh, level 1. */
    startRun() {
        this.resetSession();
        this.level = 1;
    }

    /**
     * New Run / Reset Session — Morning Enters:
     * Cloud deck parts open, resets session T-spin rotation, and pours fresh morning light in.
     */
    resetSession() {
        // A session starts the cave's weather clock and its random stream afresh, so a replay
        // of the same events (a seek) draws the same frame.
        this.rng = mulberry32(this.seed);
        this.weatherIndex = 0;
        this.nextWeatherIndex = 1;
        this.weatherMix = 0;
        this.weatherTimer = 64;
        this.gameOverActive = false;
        this.overCloudClose = 0;
        this.morningPulse = 1.0;
        this.fringeAngleTarget = 0;
        this.fringeAngle = 0;
        this.tSpinCount = 0;
        this.comboCount = 0;
        this.comboPeak = 0;
        this.comboColumns = 1;
        this.comboShafts = 1;
        this.comboTracker.reset();
        this.b2bCount = 0;
        this.b2bLevel = 0;
        this.b2bBreakPending = false;
        [this.flushSwell, this.snapSwell, ...this.kickSwells, this.showerSwell, this.ripenSwell,
            this.turningSwell, this.zenithSwell].forEach((swell) => swell.reset());
        this.surge.reset();
        this.bowLive = false;
        this.bowStart = -Infinity;
        this.bowHold = -Infinity;
        this.cataractHold = 0;
        this.sessionSerial += 1;
        this.lockSerial = 0;
        this.clearSerial = 0;
        this.lockEvents = [];
        this.clearEvents = [];
        this.lastHardDrop = null;
    }

    _spawnShoot({
        code = 'T',
        col = 4.5,
        row = 12,
        birthTime = this.time,
    } = {}) {
        const pieceCode = PIECE_SWATCH_RGB[code] ? code : 'T';
        const codeIndex = Math.max(0, PIECE_CODES.indexOf(pieceCode));
        const worldPos = boardCellToDolineWorld(col, row);
        const shoot = {
            slot: this.nextShootCursor % this.maxNewGrowth,
            code: pieceCode,
            codeIndex,
            swatch: PIECE_SWATCH_RGB[pieceCode],
            worldPos,
            col,
            row,
            birthTime,
            tau: greeningTau(this.rng()),
        };
        if (this.newGrowthShoots.length < this.maxNewGrowth) {
            this.newGrowthShoots.push(shoot);
        } else {
            this.newGrowthShoots[shoot.slot] = shoot;
        }
        this.nextShootCursor += 1;
    }

    /**
     * Advance all envelopes and return the current frame snapshot for `SunfallWorld`.
     * @param {number} dt - Frame delta in seconds
     */
    step(dt = 1 / 60) {
        const safeDt = clamp(Number.isFinite(dt) ? dt : 1 / 60, 0, 0.25);
        this.time += safeDt;
        const now = this.time;
        const motion = this.reducedMotion ? 0.25 : 1;

        // 0. The heat of play, and a back-to-back chain a plain clear ended.
        const sample = this.surge.sample(now);
        const { heat } = this;
        heat.punch = sample.punch;
        heat.level = sample.level;
        heat.fever = sample.fever;
        heat.stage = sample.stage;
        if (this.b2bBreakPending) {
            this.b2bBreakPending = false;
            this.setB2B(0);
        }

        // 1. Solar Station progression
        if (this.stationLocked !== null) {
            this.stationCurrent = this.stationLocked;
        } else {
            if (!this.reducedMotion) {
                this.stationTarget += safeDt / SUNFALL_TIMINGS.stationSeconds;
            }
            const tau = this.reducedMotion ? 0.001 : SUNFALL_TIMINGS.levelPanSeconds * 0.38;
            this.stationCurrent = approach(this.stationCurrent, this.stationTarget, tau, safeDt);
        }

        // 2. Micro-weather cycle
        if (this.weatherLocked === null && !this.reducedMotion) {
            this.weatherTimer -= safeDt;
            if (this.weatherTimer <= 0) {
                this.weatherIndex = this.nextWeatherIndex;
                this.nextWeatherIndex = (this.weatherIndex + 1 + Math.floor(this.rng() * 2)) % SUNFALL_WEATHERS.length;
                this.weatherMix = 0;
                this.weatherTimer = lerp(
                    SUNFALL_TIMINGS.weatherHoldMin,
                    SUNFALL_TIMINGS.weatherHoldMax,
                    this.rng(),
                );
            } else if (this.weatherTimer < SUNFALL_TIMINGS.weatherCrossfade) {
                this.weatherMix = clamp01(1 - this.weatherTimer / SUNFALL_TIMINGS.weatherCrossfade);
            }
        }

        // 3. T-Spin persistent vine-fringe rotation; a fever wheels the ring of shafts slowly.
        if (!this.reducedMotion) this.fringeAngleTarget += safeDt * heat.fever * 0.1;
        if (this.reducedMotion) {
            this.fringeAngle = this.fringeAngleTarget;
        } else {
            this.fringeAngle = approach(this.fringeAngle, this.fringeAngleTarget, 0.45, safeDt);
        }

        // 4. Transient gameplay envelopes: swells read on the clock, the rest decay.
        const decay = (val, duration) => Math.max(0, val - safeDt / Math.max(0.1, duration));
        this.flushPulse = this.flushSwell.valueAt(now);
        this.snapPulse = this.snapSwell.valueAt(now);
        this.kickL = this.kickSwells[0].valueAt(now) * motion;
        this.kickR = this.kickSwells[1].valueAt(now) * motion;
        this.showerPulse = this.showerSwell.valueAt(now);
        this.ripenPulse = this.ripenSwell.valueAt(now);
        this.turningPulse = this.turningSwell.valueAt(now);
        this.zenithPulse = this.zenithSwell.valueAt(now);
        this.sevenfoldPulse = decay(this.sevenfoldPulse, 3.2);
        this.levelPanPulse = decay(this.levelPanPulse, SUNFALL_TIMINGS.levelPanSeconds);
        this.morningPulse = decay(this.morningPulse, SUNFALL_TIMINGS.morningSeconds);

        // 5. Cataract & delayed Analytic Double Rainbow envelope
        if (this.cataractPulse > 0 || this.cataractAge < SUNFALL_TIMINGS.cataractSeconds + 2) {
            this.cataractAge += safeDt;
            this.cataractPulse = decay(this.cataractPulse, SUNFALL_TIMINGS.cataractSeconds);
        }
        // The standing curtain holds while the new front falls over it, then thins with it.
        if (this.cataractAge >= CATARACT_FRONT) {
            this.cataractHold = Math.max(0, this.cataractHold - safeDt * CATARACT_THIN);
        }
        let bow = 0;
        if (this.bowLive) {
            const delay = SUNFALL_TIMINGS.cataractRainbowDelay;
            const fadeLen = SUNFALL_TIMINGS.cataractRainbowFade - 0.45;
            const a = now - this.bowStart;
            const rise = a < delay ? smooth(0, delay, a) * 0.35 : 0.35 + 0.65 * smooth(0, 0.45, a - delay);
            bow = clamp01(rise * (1 - smooth(0, fadeLen, now - this.bowHold)));
            if (now > this.bowHold + fadeLen) this.bowLive = false;
        }
        // Up a little behind the envelope (a held bow comes back up, never in a frame).
        this.rainbowStrength = bow > this.rainbowStrength ? approach(this.rainbowStrength, bow, 0.12, safeDt) : bow;

        // 6. Combo Inhale / Exhale
        if (this.comboCount > 0) {
            this.comboTimer -= safeDt;
            if (this.comboTimer <= 0) {
                this.releaseCombo(this.comboPeak);
            }
        }
        const targetComboLift = clamp01((this.comboCount - 1) / 6);
        this.comboLift = approach(this.comboLift, targetComboLift, 0.45, safeDt);
        if (this.comboLift < 0.02) {
            // Nothing shows: a forming chain opens its gaps where they belong, at once.
            this.comboShafts = this.comboCount > 0 ? this.comboColumns : 1;
            if (this.comboCount === 0) this.comboColumns = 1;
        } else {
            this.comboShafts = approach(this.comboShafts, this.comboColumns, 0.35, safeDt);
        }

        if (this.exhalePulse > 0) {
            this.exhaleAge += safeDt;
            this.exhalePulse = decay(this.exhalePulse, SUNFALL_TIMINGS.comboExhaleSeconds);
        }

        // 7. Back-to-Back Flood Threads & Far Doline Echo; hot play opens a thread, a fever all
        // three, and wakes the far doline.
        const hot = smooth(0.45, 0.8, heat.level);
        const targetFlood = Math.max(this.b2bLevel / 3, hot * 0.34 + heat.fever * 0.66);
        this.floodThreads = approach(this.floodThreads, targetFlood, 0.55, safeDt);
        this.echoBoost = approach(
            this.echoBoost,
            clamp01((this.b2bLevel / 3) * 0.75 + this.zenithPulse * 0.3 + Math.min(1, this.cataractPulse) * 0.4
                + heat.level * 0.15 + heat.fever * 0.3),
            0.5,
            safeDt,
        );

        // 8. Game Over cloud close vs Morning Enters
        const targetOver = this.gameOverActive ? 1.0 : 0.0;
        this.overCloudClose = approach(
            this.overCloudClose,
            targetOver,
            SUNFALL_TIMINGS.gameOverSeconds * 0.45,
            safeDt,
        );

        // 9. The doline with the heat: the air and the swiftlets quicken (on their own clocks,
        // so a change of pace never jumps them), the pool flushes in fever and greens back
        // slowly, the crowns stay wet.
        this.windClock += safeDt * (1 + (heat.level * 0.5 + heat.fever * 0.7) * motion);
        this.swiftClock += safeDt * (1 + (heat.level * 0.6 + heat.fever * 0.9) * motion);
        const flushTarget = clamp01(heat.fever * 0.75 + smooth(0.5, 0.9, heat.level) * 0.12);
        this.poolFlush = approach(this.poolFlush, flushTarget, flushTarget > this.poolFlush ? 0.8 : 5, safeDt);
        // The sunfall warms toward gold as play heats and burns gold in a fever and at the crown;
        // when the hands rest the gold lingers a few seconds, like the end of an afternoon.
        const gildTarget = clamp01(smooth(0.3, 0.8, heat.level) * 0.4 + heat.fever * 0.4 + this.zenithPulse * 0.3);
        this.gild = approach(this.gild, gildTarget, gildTarget > this.gild ? 0.6 : 3, safeDt);
        const wetTarget = Math.max(Math.min(1, this.cataractPulse), this.showerPulse * 0.6, heat.fever * 0.7);
        this.wet = Math.max(this.wet * Math.exp(-safeDt / 3.3), wetTarget);

        return this.getSnapshot();
    }

    getSnapshot() {
        const station = sampleStation(this.stationCurrent);
        const weather = this.weatherLocked !== null
            ? sampleWeather(this.weatherLocked)
            : sampleWeather(this.weatherIndex, this.nextWeatherIndex, this.weatherMix);
        const { heat } = this;
        const motion = this.reducedMotion ? 0.25 : 1;

        // Zenith Flush tilts the beam toward vertical zenith (it swings there and back)
        const zMix = smooth(0, 1, this.zenithPulse) * 0.45;
        const sx = lerp(station.sunDir[0], 0.03, zMix);
        const sy = lerp(station.sunDir[1], 0.995, zMix);
        const sz = lerp(station.sunDir[2], -0.08, zMix);
        const sLen = Math.hypot(sx, sy, sz) || 1;
        const sunDir = [sx / sLen, sy / sLen, sz / sLen];

        const cloudHoleOpen = clamp(
            1.0 - this.overCloudClose * 0.86 + this.zenithPulse * 0.12 + this.morningPulse * 0.25,
            0.14,
            1.35,
        );

        return {
            time: this.time,
            level: this.level,
            reducedMotion: this.reducedMotion,
            station,
            weather,
            sunDir,
            fringeAngle: this.fringeAngle,
            fringeDegrees: this.fringeAngle / DEG2RAD,
            cloudHoleOpen,
            flushPulse: this.flushPulse,
            flushColor: this.flushColor,
            flushWorldPos: this.flushWorldPos,
            flushU: this.flushU,
            flushRow: this.flushRow,
            snapPulse: this.snapPulse,
            snapU: this.snapU,
            snapColor: this.snapColor,
            kickL: this.kickL,
            kickR: this.kickR,
            // Rain in the light: the showers, and a downpour as play heats.
            showerPulse: this.showerPulse + smooth(0.15, 0.6, heat.level) * 0.3 + heat.fever * 0.5,
            ripenPulse: this.ripenPulse,
            ripenRow: this.ripenRow,
            ripenCodesPacked: this.ripenCodesPacked,
            cataractPulse: this.cataractPulse,
            cataractAge: this.cataractAge,
            cataractHold: this.cataractHold,
            rainbowStrength: this.rainbowStrength,
            comboCount: this.comboCount,
            comboLift: this.comboLift,
            comboColumns: this.comboColumns,
            comboShafts: this.comboShafts,
            sevenfoldPulse: this.sevenfoldPulse,
            exhalePulse: this.exhalePulse,
            exhaleAge: this.exhaleAge,
            b2bCount: this.b2bCount,
            b2bLevel: this.b2bLevel,
            floodThreads: this.floodThreads,
            echoBoost: this.echoBoost,
            turningPulse: this.turningPulse,
            zenithPulse: this.zenithPulse,
            levelPanPulse: this.levelPanPulse,
            overCloudClose: this.overCloudClose,
            morningPulse: this.morningPulse,
            heat,
            windClock: this.windClock,
            windGain: 1 + (heat.level * 0.35 + heat.fever * 0.5) * motion,
            swiftClock: this.swiftClock,
            // Pollen in the light: the chain, the heat, and a glint on each event.
            moteGain: 1 + this.comboLift + heat.level * 0.6 + heat.fever * 0.9 + heat.punch * 0.5,
            poolFlush: this.poolFlush,
            wet: this.wet,
            // The colour of a fever: the rain and the motes in the light catch the pieces'
            // pigments, the sunfall burns gold, and the light floods back between the fingers.
            prism: clamp01(heat.fever * 0.85 + heat.level * 0.15 + this.zenithPulse * 0.4),
            gild: this.gild,
            fingerFloor: 0.14 + smooth(0.3, 0.9, heat.level) * 0.16 + heat.fever * 0.2,
            newGrowthShoots: this.newGrowthShoots,
            sessionSerial: this.sessionSerial,
            lockSerial: this.lockSerial,
            lockEvents: this.lockEvents,
            clearSerial: this.clearSerial,
            clearEvents: this.clearEvents,
        };
    }
}
