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
 * - Perfect Clear -> Zenith Flush
 * - Game Over / New Run -> The Light Leaves / Morning Enters
 */

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

        // Gameplay envelopes
        this.flushPulse = 0;
        this.flushColor = [...PIECE_SWATCH_RGB.T];
        this.flushWorldPos = [14, -10, -92];
        this.flushU = 0.5;
        this.flushRow = 12;

        this.snapPulse = 0;
        this.snapU = 0.5;
        this.snapColor = [...PIECE_SWATCH_RGB.S];

        this.showerPulse = 0;
        this.ripenPulse = 0;
        this.ripenRow = 12;
        this.ripenCodesPacked = packCodes(['T', 'S', 'Z', 'I']);

        // 4-line Cataract & Analytic Double Rainbow
        this.cataractPulse = 0;
        this.cataractAge = 999;
        this.rainbowStrength = 0;

        // Combo Inhale / Sevenfold / Exhale
        this.comboCount = 0;
        this.comboPeak = 0;
        this.comboTimer = 0;
        this.comboLift = 0;
        this.comboColumns = 1;
        this.sevenfoldPulse = 0;
        this.exhalePulse = 0;
        this.exhaleAge = 999;

        // Back-to-back Flood Threads (1..3) + Far Doline Echo
        this.b2bCount = 0;
        this.b2bLevel = 0;
        this.floodThreads = 0;
        this.echoBoost = 0;

        // T-Spin Turning flash & Perfect Clear Zenith Flush
        this.turningPulse = 0;
        this.zenithPulse = 0;

        // Level-up pan, Game Over cloud close, Morning Enters
        this.levelPanPulse = 0;
        this.gameOverActive = false;
        this.overCloudClose = 0;
        this.morningPulse = 0;

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
     * and sunlit motes swirl upward.
     */
    onPieceLock({
        shape = null,
        code = 'T',
        col = 4,
        row = 12,
        u = null,
    } = {}) {
        const pieceCode = PIECE_SWATCH_RGB[code] ? code : 'T';
        const cells = cellsFromMatrix(shape, pieceCode, col, row);
        const lead = cells[0] || { col: 4, row: 12, code: pieceCode };
        const normU = Number.isFinite(u) ? clamp01(u) : clamp01(lead.col / 9);
        const worldPos = boardCellToDolineWorld(normU * 9, lead.row);

        this.flushPulse = 1.0;
        this.flushColor = [...PIECE_SWATCH_RGB[pieceCode]];
        this.flushWorldPos = worldPos;
        this.flushU = normU;
        this.flushRow = lead.row;

        // A hard drop already reported this piece (its lock follows within a frame or two).
        const drop = this.lastHardDrop;
        const duplicate = drop && drop.code === pieceCode && this.time - drop.time < 0.3 && !drop.claimed;
        if (duplicate) {
            drop.claimed = true;
            const last = this.lockEvents[this.lockEvents.length - 1];
            if (last && last.serial === drop.serial && Array.isArray(shape)) last.cells = cells;
        } else {
            this._recordLock({
                code: pieceCode, cells, u: normU, hard: false,
            });
        }

        // Spawn a young shoot at the lock site so the garden records the piece
        this._spawnShoot({
            code: pieceCode,
            col: normU * 9,
            row: lead.row,
            birthTime: this.time,
        });
    }

    /**
     * Hard Drop — Snap: vertical wind-snap down the hanging root curtains at column `u`.
     */
    onHardDrop({
        code = 'S',
        col = 4.5,
        row = 14,
        u = null,
        distance = 10,
    } = {}) {
        const pieceCode = PIECE_SWATCH_RGB[code] ? code : 'S';
        const normU = Number.isFinite(u) ? clamp01(u) : clamp01(col / 9);
        const scale = clamp(0.65 + (Number(distance) || 10) * 0.025, 0.65, 1.25);

        this.snapPulse = Math.max(this.snapPulse, scale);
        this.snapU = normU;
        this.snapColor = [...PIECE_SWATCH_RGB[pieceCode]];

        const cells = cellsFromMatrix(null, pieceCode, Math.round(normU * 9), row);
        const event = this._recordLock({
            code: pieceCode, cells, u: normU, hard: true,
        });
        this.lastHardDrop = {
            code: pieceCode, time: this.time, serial: event.serial, claimed: false,
        };
        this.onPieceLock({
            code: pieceCode, col: normU * 9, row, u: normU,
        });
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

    /**
     * Line Clear:
     * - 1–3 lines: Shower from oculus rim + Row Ripening + New Growth shoots
     * - 4 lines: Cataract deluge + delayed Analytic Double Rainbow (`dlBow`)
     */
    onLineClear({
        lines = 1,
        rows = [],
        codes = ['T', 'S', 'Z', 'I'],
        b2b = null,
    } = {}) {
        const count = clamp(Math.round(lines || 1), 1, 4);
        const avgRow = Array.isArray(rows) && rows.length > 0
            ? rows.reduce((a, b) => a + b, 0) / rows.length
            : 12;

        this.ripenPulse = 1.0;
        this.ripenRow = clamp(avgRow, 0, 19);
        this.ripenCodesPacked = packCodes(codes);
        this.clearSerial += 1;
        this.clearEvents.push({
            serial: this.clearSerial,
            rows: Array.isArray(rows) && rows.length ? rows.slice(0, 4) : [Math.round(avgRow)],
            lines: count,
            time: this.time,
        });
        if (this.clearEvents.length > 8) this.clearEvents.shift();

        // Spawn `count` new-growth shoots that undergo delayed greening over ~19 s
        for (let i = 0; i < count; i += 1) {
            const c = codes[i % codes.length] || PIECE_CODES[(this.nextShootCursor + i) % 7];
            const r = Array.isArray(rows) && rows[i] !== undefined ? rows[i] : avgRow;
            this._spawnShoot({
                code: c,
                col: 1 + ((this.nextShootCursor * 2.3 + i * 2.1) % 8),
                row: clamp(r, 0, 19),
                birthTime: this.time,
            });
        }

        if (b2b !== null && b2b !== undefined) {
            this.setB2B(b2b);
        }

        if (count >= 4) {
            // 4-Line Cataract + Analytic Double Rainbow
            this.cataractPulse = 1.0;
            this.cataractAge = 0;
            this.bowLive = true;
            this.showerPulse = 1.0;
            const leadCode = codes[0] && PIECE_SWATCH_RGB[codes[0]] ? codes[0] : 'S';
            this.flushColor = [...PIECE_SWATCH_RGB[leadCode]];
            this.flushPulse = 1.0;
        } else {
            this.showerPulse = Math.max(this.showerPulse, 0.45 + count * 0.18);
        }
    }

    /**
     * Combo — Inhale & Sevenfold:
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

        this.comboCount = c;
        this.comboPeak = Math.max(this.comboPeak, c);
        this.comboTimer = 4.8;

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
     * inversion layer (`y = 28 m`) when a chain of 3+ breaks.
     */
    releaseCombo(peak = this.comboPeak) {
        const p = Math.max(0, Math.floor(peak || 0));
        if (p >= 3) {
            this.exhalePulse = clamp((p - 2) / 5, 0.35, 1.0);
            this.exhaleAge = 0;
        }
        this.comboCount = 0;
        this.comboPeak = 0;
        this.comboTimer = 0;
        this.comboColumns = 1;
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

    /**
     * T-Spin — The Turning:
     * Rotates the oculus vine-fringe stencil by +15° per line (persisting for the session!).
     */
    onTSpin({ lines = 2, isMini = false } = {}) {
        const turns = clamp(Math.round(lines || 1), 1, 3);
        const stepDeg = (isMini ? 0.65 : 1.0) * SUNFALL_TIMINGS.tSpinTurnDeg * turns;
        const stepRad = stepDeg * DEG2RAD;

        this.tSpinCount += 1;
        this.fringeAngleTarget += stepRad;
        if (this.reducedMotion) {
            this.fringeAngle = this.fringeAngleTarget;
        }
        this.turningPulse = 1.0;
        this.showerPulse = Math.max(this.showerPulse, 0.65);
    }

    /**
     * Perfect Clear — Zenith Flush:
     * Beam aligns toward zenith, parts the cloud deck wide open, and flushes every
     * young shoot on the cone in all 7 piece colours.
     */
    onPerfectClear() {
        this.zenithPulse = 1.0;
        // The water pours, but the bow belongs to four lines alone.
        this.cataractPulse = Math.max(this.cataractPulse, 0.85);
        this.cataractAge = 0;
        this.bowLive = false;
        for (let i = 0; i < 7; i += 1) {
            this._spawnShoot({
                code: PIECE_CODES[i],
                col: 1 + i * 1.25,
                row: 4 + ((i * 2) % 14),
                birthTime: this.time,
            });
        }
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
    }

    /**
     * Game Over — The Light Leaves:
     * Cave-cloud deck closes softly across the oculus over 2.6 s; chamber bounce remains.
     */
    onGameOver() {
        this.gameOverActive = true;
        this.morningPulse = 0;
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
        this.b2bCount = 0;
        this.b2bLevel = 0;
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

        // 3. T-Spin persistent vine-fringe rotation
        if (this.reducedMotion) {
            this.fringeAngle = this.fringeAngleTarget;
        } else {
            this.fringeAngle = approach(this.fringeAngle, this.fringeAngleTarget, 0.45, safeDt);
        }

        // 4. Decay transient gameplay envelopes
        const decay = (val, duration) => Math.max(0, val - safeDt / Math.max(0.1, duration));
        this.flushPulse = decay(this.flushPulse, SUNFALL_TIMINGS.lockFlushSeconds);
        this.snapPulse = decay(this.snapPulse, SUNFALL_TIMINGS.hardDropSnapSeconds);
        this.showerPulse = decay(this.showerPulse, SUNFALL_TIMINGS.showerSeconds);
        this.ripenPulse = decay(this.ripenPulse, SUNFALL_TIMINGS.showerSeconds * 1.15);
        this.turningPulse = decay(this.turningPulse, SUNFALL_TIMINGS.tSpinFlashSeconds);
        this.zenithPulse = decay(this.zenithPulse, SUNFALL_TIMINGS.zenithSeconds);
        this.sevenfoldPulse = decay(this.sevenfoldPulse, 3.2);
        this.levelPanPulse = decay(this.levelPanPulse, SUNFALL_TIMINGS.levelPanSeconds);
        this.morningPulse = decay(this.morningPulse, SUNFALL_TIMINGS.morningSeconds);

        // 5. Cataract & delayed Analytic Double Rainbow envelope
        if (this.cataractPulse > 0 || this.cataractAge < SUNFALL_TIMINGS.cataractSeconds + 2) {
            this.cataractAge += safeDt;
            this.cataractPulse = decay(this.cataractPulse, SUNFALL_TIMINGS.cataractSeconds);
            const delay = SUNFALL_TIMINGS.cataractRainbowDelay;
            const fade = SUNFALL_TIMINGS.cataractRainbowFade;
            if (!this.bowLive) {
                this.rainbowStrength = 0;
            } else if (this.cataractAge < delay) {
                this.rainbowStrength = smooth(0, delay, this.cataractAge) * 0.35;
            } else {
                const after = this.cataractAge - delay;
                const rise = smooth(0, 0.45, after);
                const fall = 1 - smooth(0.45, fade, after);
                this.rainbowStrength = clamp01(rise * fall);
            }
        } else {
            this.rainbowStrength = 0;
        }

        // 6. Combo Inhale / Exhale
        if (this.comboCount > 0) {
            this.comboTimer -= safeDt;
            if (this.comboTimer <= 0) {
                this.releaseCombo(this.comboPeak);
            }
        }
        const targetComboLift = clamp01(this.comboCount / 7);
        this.comboLift = approach(this.comboLift, targetComboLift, 0.45, safeDt);

        if (this.exhalePulse > 0) {
            this.exhaleAge += safeDt;
            this.exhalePulse = decay(this.exhalePulse, SUNFALL_TIMINGS.comboExhaleSeconds);
        }

        // 7. Back-to-Back Flood Threads & Far Doline Echo
        const targetFlood = this.b2bLevel / 3;
        this.floodThreads = approach(this.floodThreads, targetFlood, 0.55, safeDt);
        this.echoBoost = approach(
            this.echoBoost,
            clamp01(targetFlood * 0.75 + this.zenithPulse * 0.6 + this.cataractPulse * 0.4),
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

        return this.getSnapshot();
    }

    getSnapshot() {
        const station = sampleStation(this.stationCurrent);
        const weather = this.weatherLocked !== null
            ? sampleWeather(this.weatherLocked)
            : sampleWeather(this.weatherIndex, this.nextWeatherIndex, this.weatherMix);

        // Zenith Flush tilts the beam momentarily toward vertical zenith
        const zMix = smooth(0, 1, this.zenithPulse) * 0.65;
        const sx = lerp(station.sunDir[0], 0.03, zMix);
        const sy = lerp(station.sunDir[1], 0.995, zMix);
        const sz = lerp(station.sunDir[2], -0.08, zMix);
        const sLen = Math.hypot(sx, sy, sz) || 1;
        const sunDir = [sx / sLen, sy / sLen, sz / sLen];

        const cloudHoleOpen = clamp(
            1.0 - this.overCloudClose * 0.86 + this.zenithPulse * 0.35 + this.morningPulse * 0.25,
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
            showerPulse: this.showerPulse,
            ripenPulse: this.ripenPulse,
            ripenRow: this.ripenRow,
            ripenCodesPacked: this.ripenCodesPacked,
            cataractPulse: this.cataractPulse,
            cataractAge: this.cataractAge,
            rainbowStrength: this.rainbowStrength,
            comboCount: this.comboCount,
            comboLift: this.comboLift,
            comboColumns: this.comboColumns,
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
            newGrowthShoots: this.newGrowthShoots,
            sessionSerial: this.sessionSerial,
            lockSerial: this.lockSerial,
            lockEvents: this.lockEvents,
            clearSerial: this.clearSerial,
            clearEvents: this.clearEvents,
        };
    }
}
