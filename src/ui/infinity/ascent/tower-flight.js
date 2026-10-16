// @ts-check

/**
 * How the view moves when the player looks around Infinity's tower: the pull before the game
 * pauses, the glide while looking, the soft floor and ceiling, the stop at the player's own
 * rows, and the flight home.
 *
 * - The pull. The first scroll moves the view at once, against a spring, while the game keeps
 *   running: a peek. Pull far enough (PULL_COMMIT_ROWS of input) and it gives way: the director
 *   pauses the game and the view is free. Let go before that and it springs back, so a stray
 *   wheel notch is only a peek.
 * - The glide. The view follows its target on a critically damped spring at sub-row precision:
 *   a wheel notch glides, a trackpad follows closely, the stick flies at a speed.
 * - The edges. The last rows before the floor and the top of the grid take more input, and
 *   pushing into the floor is a bump (the director makes it heard and felt).
 * - Home. Scrolling back to the rows the game plays in is a detent: the view clicks into place
 *   and, after a moment, lands. Push on through it to keep looking.
 * - The flight home. After a while without input (a ring fills first), or when asked, the view
 *   flies home: a small lift away first, then an eased descent.
 *
 * Pure: no DOM, no clock (the caller passes `now` in ms), no three. Rows are the board's own: a
 * camera `top` is the first row on screen, and rows grow DOWN the tower (row 0 is the top of the
 * grid). The director (infinity-ascent.js) feeds input and the board's bounds every frame and
 * applies what step() returns to the board's camera.
 */

export const FLIGHT = Object.freeze({
    /** Input rows (wheel or stick) that turn a peek into looking around (the game pauses). */
    PULL_COMMIT_ROWS: 4,
    /** The most the view moves while pulling, whatever the pull: the resistance. */
    PULL_GIVE_ROWS: 2.4,
    /** A pull lets go after this long without input: fine input (trackpad, stick)… */
    PULL_RELEASE_MS_FINE: 170,
    /** …and a wheel notch, which waits a little longer for the next notch. */
    PULL_RELEASE_MS_NOTCH: 430,
    /** The spring that takes a released pull home, and the one the view follows the pull on. */
    PULL_RETURN_OMEGA: 13,
    PULL_FOLLOW_OMEGA: 20,
    /** The stick's pull speed (input rows a second at full deflection). */
    STICK_PULL_SPEED: 18,
    /** Spring rates (1/s) the view follows its target on, by what moved it. */
    OMEGA_NOTCH: 11,
    OMEGA_FINE: 22,
    OMEGA_DRAG: 16,
    OMEGA_STICK: 24,
    /** The stick: dead zone, response curve, top speed (rows a second) and how fast it answers. */
    STICK_DEADZONE: 0.22,
    STICK_CURVE: 1.6,
    STICK_MAX_SPEED: 46,
    STICK_RESPONSE_S: 0.12,
    /** The last rows before the floor or the top of the grid resist. */
    EDGE_ROWS: 3,
    /** The view must come this close to an edge it was pushed into for the bump. */
    EDGE_ARRIVE_ROWS: 0.35,
    /** A nudge against an edge with nothing beyond it is reported at most this often. */
    NUDGE_MS: 450,
    /** Home: the detent's hold before landing, and the push that carries on through it. */
    DOCK_HOLD_MS: 380,
    DOCK_ESCAPE_ROWS: 3,
    /** Idle: the flight home starts after this long without input; the ring fills before it. */
    IDLE_RETURN_MS: 4200,
    RING_MS: 1700,
    /** The flight home: its length (s) and the lift away before it (rows at most). */
    LAND_MIN_S: 0.55,
    LAND_MAX_S: 1.5,
    LAND_QUICK_MAX_S: 0.6,
    LAND_LIFT_ROWS: 0.9,
});

/** @param {number} value @param {number} min @param {number} max */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * One step of a critically damped spring toward a fixed target (exact for any dt, so the
 * motion is the same at 60 and 165 Hz).
 * @param {number} x @param {number} v @param {number} target @param {number} omega @param {number} dt
 * @returns {{x: number, v: number}}
 */
export function springStep(x, v, target, omega, dt) {
    if (!(dt > 0)) return { x, v };
    const decay = Math.exp(-omega * dt);
    const delta = x - target;
    const temp = (v + omega * delta) * dt;
    return { x: target + (delta + temp) * decay, v: (v - omega * temp) * decay };
}

/**
 * The pull's give: how far the view has moved for a pull of `rows`, never more than
 * PULL_GIVE_ROWS. Steep at first (a peek answers at once), then stiffer.
 * @param {number} rows
 */
export function pullGive(rows) {
    const g = FLIGHT.PULL_GIVE_ROWS;
    return Math.sign(rows) * g * (1 - Math.exp(-Math.abs(rows) / g));
}

/**
 * The flight home's shape: 0 at the start, 1 at home. In the first 40 % the view first eases a
 * little AWAY (lift, a share of the distance), the anticipation before the descent; zero speed at
 * both ends, so it leaves and lands softly.
 * @param {number} p progress 0..1
 * @param {number} lift share of the distance to lift away first (0 = none)
 */
export function landingCurve(p, lift = 0) {
    const t = clamp(p, 0, 1);
    const ease = t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
    const s = t < 0.4 ? Math.sin((Math.PI * t) / 0.4) : 0;
    return ease - lift * s * s;
}

/**
 * The stick's deflection after the dead zone, on a curve (fine control near the centre).
 * @param {number} value -1..1
 * @returns {number} -1..1, 0 inside the dead zone
 */
export function stickResponse(value) {
    const magnitude = Math.abs(Number.isFinite(value) ? value : 0);
    const dz = FLIGHT.STICK_DEADZONE;
    if (magnitude <= dz) return 0;
    return Math.sign(value) * (Math.min(1, (magnitude - dz) / (1 - dz)) ** FLIGHT.STICK_CURVE);
}

/**
 * @typedef {'idle'|'pull'|'free'|'landing'|'landed'} FlightPhase
 * @typedef {{type: string, strength?: number}} FlightEvent
 * @typedef {object} FlightFrame
 * @property {FlightPhase} phase
 * @property {number} top the camera's first row on screen
 * @property {number} offset the peek's offset from the rows the game holds (pull)
 * @property {number} velocity rows a second (+ down the tower)
 * @property {number} ring 0..1, how far the wait before the flight home has run
 * @property {boolean} wantCommit the pull has given way: pause the game and commit()
 * @property {null|'idle'|'home'} wantLand fly home (idle), or land where the view is docked (home)
 * @property {FlightEvent[]} events what happened this step (give, dock, undock, floor, land…)
 */

const OMEGA_BY_KIND = Object.freeze({
    notch: FLIGHT.OMEGA_NOTCH, fine: FLIGHT.OMEGA_FINE, drag: FLIGHT.OMEGA_DRAG, stick: FLIGHT.OMEGA_STICK,
});

export class TowerFlight {
    /** @param {{reducedMotion?: boolean}} [options] */
    constructor({ reducedMotion = false } = {}) {
        this.reducedMotion = Boolean(reducedMotion);
        /** @type {FlightEvent[]} */
        this.events = [];
        /** @type {FlightFrame} */
        this.frame = {
            phase: 'idle', top: 0, offset: 0, velocity: 0, ring: 0, wantCommit: false, wantLand: null, events: [],
        };
        this.min = 0;
        this.max = 0;
        this.home = 0;
        this.followTop = 0;
        this.nudgeAt = -Infinity;
        this.reset();
    }

    /** Back to playing: no pull, no flight. Bounds, home and the follow row are kept. */
    reset() {
        /** @type {FlightPhase} */
        this.phase = 'idle';
        this.pull = 0;
        this.pullVel = 0;
        this.offset = 0;
        this.offsetVel = 0;
        /** @type {'notch'|'fine'|'drag'|'stick'} */
        this.kind = 'fine';
        this.lastInputAt = -Infinity;
        this.top = this.followTop;
        this.vel = 0;
        this.target = this.followTop;
        this.stickValue = 0;
        this.stickVel = 0;
        this.holding = false;
        this.commitAsked = false;
        /** @type {null|{at: number, push: number}} */
        this.dock = null;
        /** @type {null|{from: number, to: number, at: number, ms: number, lift: number}} */
        this.land = null;
        this.edgePush = { floor: 0, ceiling: 0 };
        this.events.length = 0;
    }

    /** @param {boolean} reduced */
    setReducedMotion(reduced) {
        this.reducedMotion = Boolean(reduced);
    }

    /**
     * The rows the camera may show from: `min` the top of the grid, `max` the floor view.
     * @param {number} min @param {number} max
     */
    setBounds(min, max) {
        if (!Number.isFinite(min) || !Number.isFinite(max)) return;
        this.min = Math.min(min, max);
        this.max = Math.max(min, max);
        this.target = clamp(this.target, this.min, this.max);
        this.home = clamp(this.home, this.min, this.max);
    }

    /** The rows the game plays in (where the view lands). @param {number} top */
    setHome(top) {
        if (Number.isFinite(top)) this.home = clamp(top, this.min, this.max);
    }

    /** Where the game's own camera is (the peek is an offset from it). @param {number} top */
    setFollowTop(top) {
        if (!Number.isFinite(top)) return;
        this.followTop = top;
        if (this.phase === 'idle') {
            this.top = top;
            this.target = top;
        }
    }

    /** Is the view somewhere the game does not put it (peeking, looking or flying home)? */
    get active() {
        return this.phase !== 'idle';
    }

    // ─── Input ───────────────────────────────────────────────────────────────

    /**
     * The wheel or a trackpad. @param {number} rows + down the tower
     * @param {'notch'|'fine'} kind a mouse wheel's notch or fine (trackpad) input
     * @param {number} now ms
     */
    wheel(rows, kind, now) {
        if (!Number.isFinite(rows) || rows === 0) return;
        this.kind = kind === 'notch' ? 'notch' : 'fine';
        this.lastInputAt = now;
        if (this.phase === 'landing') this._abortLanding();
        if (this.phase === 'idle' || this.phase === 'pull') this._pullBy(rows, now);
        else if (this.phase === 'free') this._moveTarget(rows, now);
    }

    /**
     * The stick, every poll. @param {number} value -1..1 (+ down the tower), raw
     * @param {number} now ms
     * @param {boolean} [held] the stick is pressed in (R3): look at once, no pull
     */
    stick(value, now, held = false) {
        const v = stickResponse(value);
        this.stickValue = v;
        if (v !== 0) {
            this.kind = 'stick';
            this.lastInputAt = now;
            if (this.phase === 'landing') this._abortLanding();
        }
        if (held) {
            this.lastInputAt = now;
            this.requestCommit();
        }
    }

    /**
     * The tower map: look at the rows under the pointer (free flight; the map commits first).
     * @param {number} top the camera top the map asks for
     * @param {number} now ms
     */
    dragTo(top, now) {
        if (!Number.isFinite(top)) return;
        this.kind = 'drag';
        this.lastInputAt = now;
        if (this.phase === 'landing') this._abortLanding();
        if (this.phase !== 'free') return;
        this.dock = null;
        this.target = clamp(top, this.min, this.max);
    }

    /**
     * The map is pressed (the view stays where it is: no flight home) or let go.
     * @param {boolean} on @param {number} now
     */
    hold(on, now) {
        this.holding = Boolean(on);
        this.lastInputAt = now;
    }

    /** Ask to look around now, without a pull (the map was pressed, the stick clicked in). */
    requestCommit() {
        if (this.phase === 'idle') this._startPull();
        if (this.phase === 'pull') this.commitAsked = true;
    }

    /**
     * The game paused: the view is free, starting where it is on screen.
     * @param {number} [top] the camera's first row on screen now (the game's row plus the peek)
     */
    commit(top) {
        const start = Number.isFinite(top) ? clamp(/** @type {number} */ (top), this.min, this.max)
            : clamp(this.followTop + this.offset, this.min, this.max);
        const pulled = this.phase === 'pull' ? this.pull : 0;
        const shown = this.phase === 'pull' ? this.offset : 0;
        this.phase = 'free';
        this.top = start;
        this.vel = this.offsetVel;
        // The pull's full length: the view gives way and catches up with the input it held back.
        this.target = clamp(start + (pulled - shown), this.min, this.max);
        this.offset = 0;
        this.offsetVel = 0;
        this.pull = 0;
        this.pullVel = 0;
        this.commitAsked = false;
        this.dock = null;
        this.edgePush.floor = 0;
        this.edgePush.ceiling = 0;
        this.events.push({ type: 'give' });
    }

    /** The commit could not happen (the game ended, a menu opened): let the pull go. */
    cancelPull() {
        this.commitAsked = false;
        this.lastInputAt = -Infinity;
        this.stickValue = 0;
    }

    /**
     * Fly home. @param {number} now ms @param {number} [home] the rows to land on
     * @param {{quick?: boolean}} [options] quick: a short flight (a game key asked)
     */
    beginLanding(now, home = this.home, { quick = false } = {}) {
        const to = Number.isFinite(home) ? clamp(home, this.min, this.max) : this.home;
        const from = this.top;
        const distance = Math.abs(to - from);
        const seconds = quick
            ? clamp(0.26 + 0.05 * Math.sqrt(distance), 0.26, FLIGHT.LAND_QUICK_MAX_S)
            : clamp(0.5 + 0.12 * Math.sqrt(distance), FLIGHT.LAND_MIN_S, FLIGHT.LAND_MAX_S);
        const liftRows = this.reducedMotion || quick || distance < 1
            ? 0 : Math.min(FLIGHT.LAND_LIFT_ROWS, 0.06 * distance);
        this.phase = 'landing';
        this.land = {
            from, to, at: now, ms: seconds * 1000, lift: distance > 0 ? liftRows / distance : 0,
        };
        this.dock = null;
        this.stickVel = 0;
    }

    // ─── Step ────────────────────────────────────────────────────────────────

    /**
     * Advance by `dt` seconds. @param {number} dt @param {number} now ms
     * @returns {FlightFrame} reused between calls
     */
    step(dt, now) {
        const step = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
        /** @type {null|'idle'|'home'} */
        let wantLand = null;
        if (this.phase === 'pull') this._stepPull(step, now);
        else if (this.phase === 'free') wantLand = this._stepFree(step, now);
        else if (this.phase === 'landing') this._stepLanding(step, now);

        const f = this.frame;
        const peeking = this.phase === 'pull' || this.phase === 'idle';
        f.phase = this.phase;
        f.top = peeking ? this.followTop + this.offset : this.top;
        f.offset = this.phase === 'pull' ? this.offset : 0;
        f.velocity = this.phase === 'pull' ? this.offsetVel : this.vel;
        f.ring = this.phase === 'free' ? this._ring(now) : 0;
        f.wantCommit = this.phase === 'pull' && this.commitAsked;
        f.wantLand = wantLand;
        f.events = this.events.splice(0);
        return f;
    }

    // ─── Inside ──────────────────────────────────────────────────────────────

    _startPull() {
        this.phase = 'pull';
        this.pull = 0;
        this.pullVel = 0;
        this.commitAsked = false;
    }

    /** @param {number} rows @param {number} now */
    _pullBy(rows, now) {
        if (this.phase === 'idle') this._startPull();
        // Nothing to see that way (the floor view, or the top of the grid): no peek.
        const room = rows > 0 ? this.max - this.followTop : this.followTop - this.min;
        if (room < 0.5) {
            if (now - this.nudgeAt > FLIGHT.NUDGE_MS) {
                this.nudgeAt = now;
                this.events.push({ type: rows > 0 ? 'floor-nudge' : 'ceiling-nudge' });
            }
            return;
        }
        this.pull += rows;
        this.pullVel = 0;
        if (Math.abs(this.pull) >= FLIGHT.PULL_COMMIT_ROWS) this.commitAsked = true;
    }

    /** @param {number} dt @param {number} now */
    _stepPull(dt, now) {
        if (this.stickValue !== 0) this._pullBy(this.stickValue * FLIGHT.STICK_PULL_SPEED * dt, now);
        const releaseMs = this.kind === 'notch' ? FLIGHT.PULL_RELEASE_MS_NOTCH : FLIGHT.PULL_RELEASE_MS_FINE;
        const released = !this.commitAsked && this.stickValue === 0 && now - this.lastInputAt > releaseMs;
        if (released) {
            const s = springStep(this.pull, this.pullVel, 0, FLIGHT.PULL_RETURN_OMEGA, dt);
            this.pull = s.x;
            this.pullVel = s.v;
        }
        const goal = clamp(pullGive(this.pull), this.min - this.followTop, this.max - this.followTop);
        const o = springStep(this.offset, this.offsetVel, goal, FLIGHT.PULL_FOLLOW_OMEGA, dt);
        this.offset = o.x;
        this.offsetVel = o.v;
        if (released && Math.abs(this.pull) < 0.01 && Math.abs(this.offset) < 0.004) {
            this.phase = 'idle';
            this.pull = 0;
            this.offset = 0;
            this.offsetVel = 0;
            this.top = this.followTop;
            this.target = this.followTop;
        }
    }

    /**
     * @param {number} dt @param {number} now
     * @returns {null|'idle'|'home'} whether it is time to land
     */
    _stepFree(dt, now) {
        if (this.stickValue !== 0 || this.stickVel !== 0) {
            const wanted = this.stickValue * FLIGHT.STICK_MAX_SPEED;
            this.stickVel += (wanted - this.stickVel) * (1 - Math.exp(-dt / FLIGHT.STICK_RESPONSE_S));
            if (this.stickValue === 0 && Math.abs(this.stickVel) < 0.05) this.stickVel = 0;
            if (this.stickVel !== 0) this._moveTarget(this.stickVel * dt, now);
        }
        const s = springStep(this.top, this.vel, this.target, OMEGA_BY_KIND[this.kind] || FLIGHT.OMEGA_FINE, dt);
        this.top = s.x;
        this.vel = s.v;
        this._edges();
        if (this.dock) return now - this.dock.at > FLIGHT.DOCK_HOLD_MS ? 'home' : null;
        const idle = !this.holding && this.stickValue === 0 && this.stickVel === 0
            && now - this.lastInputAt >= FLIGHT.IDLE_RETURN_MS;
        return idle ? 'idle' : null;
    }

    /** The bump: the view arrives at an edge it was pushed into. */
    _edges() {
        const near = FLIGHT.EDGE_ARRIVE_ROWS;
        if (this.edgePush.floor > 0 && this.target >= this.max && this.max - this.top < near) {
            this.events.push({ type: 'floor', strength: Math.min(1, this.edgePush.floor / 6) });
            this.edgePush.floor = 0;
        }
        if (this.edgePush.ceiling > 0 && this.target <= this.min && this.top - this.min < near) {
            this.events.push({ type: 'ceiling', strength: Math.min(1, this.edgePush.ceiling / 6) });
            this.edgePush.ceiling = 0;
        }
    }

    /** @param {number} now */
    _ring(now) {
        if (this.holding || this.stickValue !== 0 || this.dock) return 0;
        const idle = now - this.lastInputAt;
        return clamp((idle - (FLIGHT.IDLE_RETURN_MS - FLIGHT.RING_MS)) / FLIGHT.RING_MS, 0, 1);
    }

    /** @param {number} rows + down the tower @param {number} now */
    _moveTarget(rows, now) {
        if (!Number.isFinite(rows) || rows === 0) return;
        let delta = rows;
        // Soft edges: the last rows toward the floor or the top of the grid take more input.
        const toBound = delta > 0 ? this.max - this.target : this.target - this.min;
        if (toBound < FLIGHT.EDGE_ROWS) delta *= Math.max(0.18, (Math.max(0, toBound) / FLIGHT.EDGE_ROWS) ** 0.6);
        const before = this.target;
        let next = before + delta;
        if (next > this.max) {
            this.edgePush.floor += next - this.max;
            next = this.max;
        } else if (next < this.min) {
            this.edgePush.ceiling += this.min - next;
            next = this.min;
        } else if (delta > 0) {
            this.edgePush.ceiling = 0;
        } else {
            this.edgePush.floor = 0;
        }
        // Home is a detent: reaching it docks; push on through to keep looking.
        if (this.dock) {
            this.dock.push += rows;
            this.dock.at = now;
            if (Math.abs(this.dock.push) > FLIGHT.DOCK_ESCAPE_ROWS) {
                next = clamp(this.home + this.dock.push, this.min, this.max);
                this.dock = null;
                this.events.push({ type: 'undock' });
            } else {
                next = this.home;
            }
        } else if (before !== this.home && (before - this.home) * (next - this.home) <= 0) {
            this.dock = { at: now, push: next - this.home };
            next = this.home;
            this.events.push({ type: 'dock' });
        }
        this.target = next;
    }

    /** @param {number} dt @param {number} now */
    _stepLanding(dt, now) {
        const { land } = this;
        if (!land) return;
        const p = land.ms > 0 ? clamp((now - land.at) / land.ms, 0, 1) : 1;
        const before = this.top;
        this.top = land.from + (land.to - land.from) * landingCurve(p, land.lift);
        this.vel = dt > 0 ? (this.top - before) / dt : 0;
        if (p >= 1) {
            this.top = land.to;
            this.vel = 0;
            this.phase = 'landed';
            this.events.push({ type: 'land' });
        }
    }

    _abortLanding() {
        this.phase = 'free';
        this.target = this.top;
        this.vel = 0;
        this.land = null;
    }
}
