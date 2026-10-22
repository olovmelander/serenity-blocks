/**
 * Rainbow Terraces: the gliders' flight, in closed form (three-free).
 *
 * The gliders are small darts of folded paper. At rest they circle on the thermals over the falls,
 * banking as they turn (their creases flash), climbing and gliding. When the chain holds, one peels
 * off for each link and flies the bow's arc at a fixed distance, so its screen position lies on the
 * bow: its short trail in the colour of the link is the brush the stroke is painted with. A T-spin
 * sends two up in a double helix; a level up launches a flight of them out over the gulf; while a
 * back-to-back holds, one larger "long-wing" keeps station along the bow's leg. In a fever of play
 * (`ribbon` 0..1, set by the world) every other glider on the thermals trails a ribbon of the
 * colours played (`ribbons`), its paper lit in it: the flock wheels in the chain's colours.
 *
 * Everything is a function of the flight clock (integrated by the world, so a hush can freeze them)
 * and the event times, so any frame can be reproduced by seeking.
 */
import {
    DEG, clamp, clamp01, mulberry32, smooth,
} from './rainbow-terraces-core.js';
import { bowPoint } from './rainbow-terraces-frame.js';

export const PAINT_DISTANCE = 300;
const G = 9.81;

/** A glider's pose: position, heading (unit, horizontal-ish), bank (radians), glow, colour, scale. */
function pose() {
    return {
        pos: [0, 0, 0], vel: [0, 0, -1], bank: 0, glow: 0, colour: [1, 1, 1], scale: 1, mode: 0, trail: 0,
    };
}

export class GliderFlock {
    /**
     * @param {number} capacity  gliders in the air at most
     * @param {number} [seed]
     */
    constructor(capacity, seed = 33) {
        this.capacity = capacity;
        this.rand = mulberry32(seed);
        this.poses = Array.from({ length: capacity }, pose);
        this.thermals = [];
        // Per glider: its thermal, phase, radius factor, speed, climb phase.
        this.traits = Array.from({ length: capacity }, () => ({
            thermal: 0,
            phase: this.rand() * Math.PI * 2,
            radius: 0.7 + this.rand() * 0.6,
            speed: 0.85 + this.rand() * 0.3,
            climb: this.rand() * Math.PI * 2,
            dir: this.rand() < 0.5 ? 1 : -1,
            size: 0.85 + this.rand() * 0.35,
        }));
        this.paint = []; // { glider, stroke, start, end, colour }
        this.helixAt = -1e4;
        this.helixFrom = [0, 0, 0];
        this.launchAt = -1e4;
        this.launchFrom = [0, 0, 0];
        this.longWing = false;
        this.aloft = 1;
        this.bankFlash = -1e4;
        /** How far into a fever play runs (0..1): the thermals' gliders trail the colours played. */
        this.ribbon = 0;
        /** The colours they trail ([r, g, b] each), or null. */
        this.ribbons = null;
    }

    /** The thermals' centres and radii (world), from the plan. */
    setThermals(thermals) {
        this.thermals = thermals.map((t) => ({ pos: t.pos.slice(), radius: t.radius }));
        this.traits.forEach((tr, i) => { tr.thermal = this.thermals.length ? i % this.thermals.length : 0; });
    }

    /** Every glider in the air banks at once (a two-line clear): their creases flash. */
    bank(at) {
        this.bankFlash = at;
    }

    /** Two gliders rise from a point in a double helix (a T-spin). */
    helix(from, at) {
        this.helixFrom = from.slice();
        this.helixAt = at;
    }

    /** A flight of gliders sails out from a point over the gulf (a level up). */
    launch(from, at) {
        this.launchFrom = from.slice();
        this.launchAt = at;
    }

    /**
     * Sample every glider's pose at flight clock `t` (seconds).
     * @param {number} t
     * @param {object} bow   { A, basis, R1, strokes: [{phi0, phi1}], dial, links: [[r,g,b]] }
     * @param {number} aloft  0..1: share of the gliders flying (the rest sleep in the grotto)
     */
    sample(t, bow, aloft = 1) {
        const n = this.capacity;
        const flying = Math.max(2, Math.round(n * clamp01(aloft)));
        const tmp = [0, 0, 0];
        for (let i = 0; i < n; i++) {
            const p = this.poses[i];
            const tr = this.traits[i];
            p.glow = 0;
            p.trail = 0;
            p.mode = 0;
            p.colour[0] = 1; p.colour[1] = 1; p.colour[2] = 1;
            p.scale = tr.size;
            if (i >= flying || !this.thermals.length) {
                // Asleep (or no thermals yet): parked far below the frame, no area.
                p.pos[0] = 0; p.pos[1] = -1e5; p.pos[2] = 0;
                p.scale = 0;
                continue;
            }
            // ── At rest: circling a thermal ──
            const th = this.thermals[tr.thermal];
            const R = th.radius * tr.radius;
            const v = 9 * tr.speed; // m/s
            const w = (v / R) * tr.dir;
            const a = tr.phase + w * t;
            const climb = Math.sin(t * 0.05 + tr.climb) * 12 + Math.sin(t * 0.013 + tr.climb * 2) * 20;
            p.pos[0] = th.pos[0] + Math.cos(a) * R;
            p.pos[1] = th.pos[1] + climb;
            p.pos[2] = th.pos[2] + Math.sin(a) * R;
            p.vel[0] = -Math.sin(a) * v * tr.dir;
            p.vel[1] = Math.cos(t * 0.05 + tr.climb) * 0.6;
            p.vel[2] = Math.cos(a) * v * tr.dir;
            p.bank = Math.atan((v * v) / (R * G)) * tr.dir;
            // A two-line clear: every glider banks hard at once.
            const bf = t - this.bankFlash;
            if (bf >= 0 && bf < 0.6) p.bank += Math.sin((bf / 0.6) * Math.PI) * 0.9 * tr.dir;
            // A fever: every other one trails a ribbon of a colour played, its paper lit in it.
            const { ribbons } = this;
            if (this.ribbon > 0.01 && ribbons && ribbons.length && i % 2 === 1) {
                const c = ribbons[(i >> 1) % ribbons.length];
                p.colour[0] = c[0]; p.colour[1] = c[1]; p.colour[2] = c[2];
                p.trail = this.ribbon * 0.55;
                p.glow = this.ribbon * 0.6;
            }
        }

        // ── Painting the bow: one glider per stroke being painted ──
        if (bow && bow.strokes) {
            const { strokes } = bow;
            for (let s = 0; s < strokes.length; s++) {
                const progress = clamp01(bow.dial - s);
                if (progress <= 0 || progress >= 1) continue;
                const g = (s * 3 + 1) % flying;
                const p = this.poses[g];
                const st = strokes[s];
                const R = s < 7 ? bow.R1 : bow.R2;
                const phi = st.phi0 + (st.phi1 - st.phi0) * progress;
                bowPoint(bow.A, bow.basis, R - 0.6 * DEG, phi, tmp);
                const ahead = st.phi0 + (st.phi1 - st.phi0) * Math.min(1, progress + 0.02);
                const next = bowPoint(bow.A, bow.basis, R - 0.6 * DEG, ahead, [0, 0, 0]);
                p.pos[0] = tmp[0] * PAINT_DISTANCE;
                p.pos[1] = tmp[1] * PAINT_DISTANCE;
                p.pos[2] = tmp[2] * PAINT_DISTANCE;
                p.vel[0] = (next[0] - tmp[0]) * PAINT_DISTANCE * 40;
                p.vel[1] = (next[1] - tmp[1]) * PAINT_DISTANCE * 40;
                p.vel[2] = (next[2] - tmp[2]) * PAINT_DISTANCE * 40;
                p.bank = 0.5;
                p.mode = 1;
                p.glow = 1;
                p.trail = 1;
                p.scale = 1.6;
                const c = bow.links?.[s];
                if (c) { p.colour[0] = c[0]; p.colour[1] = c[1]; p.colour[2] = c[2]; }
            }
        }

        // ── A T-spin: two rise in a double helix ──
        const ht = t - this.helixAt;
        if (ht >= 0 && ht < 2.2 && flying >= 4) {
            for (let k = 0; k < 2; k++) {
                const p = this.poses[flying - 1 - k];
                const u = clamp01(ht / 1.6);
                const turn = u * 1.5 * Math.PI * 2 + k * Math.PI;
                const rise = smooth(0, 1, u) * 140;
                p.pos[0] = this.helixFrom[0] + Math.cos(turn) * 4;
                p.pos[1] = this.helixFrom[1] + rise;
                p.pos[2] = this.helixFrom[2] + Math.sin(turn) * 4;
                p.vel[0] = -Math.sin(turn) * 20;
                p.vel[1] = 30;
                p.vel[2] = Math.cos(turn) * 20;
                p.bank = 0.7 * (k ? 1 : -1);
                p.glow = 1 - smooth(1.6, 2.2, ht);
                p.trail = p.glow;
                p.mode = 2;
                p.colour[0] = 1.0; p.colour[1] = 0.82; p.colour[2] = 0.5;
                p.scale = 1.3;
            }
        }

        // ── A level up: a flight sails out from the Spring Isle over the gulf ──
        const lt = t - this.launchAt;
        if (lt >= 0 && lt < 6.5) {
            const count = Math.min(12, flying);
            for (let k = 0; k < count; k++) {
                const p = this.poses[k];
                const delay = k * 0.12;
                const u = clamp01((lt - delay) / 6);
                if (u <= 0) continue;
                const spread = (k / Math.max(1, count - 1) - 0.5) * 0.9;
                const out = smooth(0, 1, u);
                p.pos[0] = this.launchFrom[0] + (120 + 80 * spread) * out + Math.sin(u * 9 + k) * 6;
                p.pos[1] = this.launchFrom[1] + 40 * Math.sin(out * Math.PI) - 20 * u + spread * 30;
                p.pos[2] = this.launchFrom[2] + (60 + 140 * spread) * out;
                p.vel[0] = 30; p.vel[1] = 2; p.vel[2] = 20 * spread;
                p.bank = Math.sin(u * 6 + k) * 0.4;
                p.glow = 0.4 * (1 - u);
                p.mode = 3;
            }
        }

        // ── Back-to-back: the long-wing keeps station along the bow's leg ──
        if (this.longWing && bow && flying > 2) {
            const p = this.poses[flying - 3];
            const s0 = bow.strokes?.[0];
            if (s0) {
                const u = 0.5 + 0.5 * Math.sin((t / 14) * Math.PI * 2);
                const phi = s0.phi0 + (s0.phi1 - s0.phi0) * u;
                bowPoint(bow.A, bow.basis, bow.R1 - 1.2 * DEG, phi, tmp);
                p.pos[0] = tmp[0] * 260; p.pos[1] = tmp[1] * 260; p.pos[2] = tmp[2] * 260;
                p.vel[0] = 10; p.vel[1] = 4; p.vel[2] = 0;
                p.bank = 0.25;
                p.scale = 2.6;
                p.glow = 0.8;
                p.trail = 0.8;
                p.colour[0] = 1.0; p.colour[1] = 0.86; p.colour[2] = 0.55;
                p.mode = 4;
            }
        }
        return this.poses;
    }
}

export { clamp };
