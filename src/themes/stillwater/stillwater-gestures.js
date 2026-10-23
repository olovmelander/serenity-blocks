/* eslint-disable max-lines -- two books of small gestures, each a few lines; they read best side by side */
/**
 * Stillwater — the two figures' gestures (CPU only, three-free).
 *
 * A gesture is a short act laid over whatever the body is doing: a wave, a scratch behind the ear,
 * a bow, a stone thrown, a twirl on the water. Each is a pose as a function of its own clock
 * (`k` 0..1 through it, `t` seconds into it, `len` its length): how far it bends the spine, the
 * chest, the neck and the head (radians, as Euler x pitch forward, y turn to the left, z roll to
 * the right), how far it moves the hips (metres), where it puts a hand (a point relative to a
 * bone of the posed body, so a hand on the chest stays on the chest through a bow) and which way
 * that elbow bends, and anything it does to the staff or the turn of her body.
 *
 * Every gesture comes in and goes out on its own envelope; and a gesture cut short (play called
 * them away) fades out over a moment in `GestureSlots`, so nothing a gesture does ever jumps.
 *
 * Frames: the troll's model frame (x his left, y up, z his front, one unit = 2.9 m, his soles at
 * y = -0.5, his head at about (0, 0.2, 0.13)); the spirit's (x her left, y up, z her front, one
 * unit = 1.72 m, her hem at 0, her head at about (0, 0.87, 0)).
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const sstep = (a, b, v) => {
    const t = clamp01((v - a) / (b - a || 1e-6));
    return t * t * (3 - 2 * t);
};
/** In over the first `a` of the gesture, out over the last `r`. */
export const envelope = (k, a = 0.2, r = 0.25) => sstep(0, a, k) * (1 - sstep(1 - r, 1, k));
/** A smooth 0 → 1 → 0 across [a, b]. */
const bump = (a, b, k) => {
    if (k <= a || k >= b) return 0;
    const x = (k - a) / (b - a);
    return Math.sin(Math.PI * x) ** 2;
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const zero = (a) => {
    if (!a) return [0, 0, 0];
    a[0] = 0;
    a[1] = 0;
    a[2] = 0;
    return a;
};

/** A fresh pose for one gesture to write into (its arrays reused). */
export function emptyPose(out = {}) {
    out.spine = zero(out.spine);
    out.chest = zero(out.chest);
    out.neck = zero(out.neck);
    out.head = zero(out.head);
    out.clav = 0;
    out.hips = zero(out.hips);
    /** How much of the look the head keeps (a bow ducks the head whatever it was watching). */
    out.look = 1;
    /** A hand: { bone, p: [x, y, z], w (0..1), pole: [x, y, z] | null } or null. */
    out.R = null;
    out.L = null;
    out.staff = null;
    /** Her turn about herself (radians; a whole twirl ends on a whole turn), and her gown's flare. */
    out.spin = 0;
    out.flare = 0;
    /** Moments (k) at which the gesture touches something (a fingertip in the water...). */
    out.marks = null;
    return out;
}

const hand = (bone, p, w = 1, pole = null) => ({
    bone, p, w, pole,
});

// ── His ─────────────────────────────────────────────────────────────────────────

export const TROLL_GESTURES = Object.freeze({
    /** A big slow wave across the water, his right hand up above his head (where it shows past him). */
    wave(k, t, len, o) {
        const e = envelope(k, 0.2, 0.22);
        const sway = Math.sin(t * Math.PI * 2 * 0.85) * e;
        const at = [-0.22 + sway * 0.09, 0.37 + Math.abs(sway) * 0.015, 0.25 - sway * 0.03];
        o.R = hand('chest', at, e, [-1, -0.35, 0.1]);
        o.head[2] = 0.06 * e;
        o.chest[2] = -0.04 * e;
        o.clav = 0.04 * e;
    },
    /**
     * Rubbing his big nose, a little sheepish (in front of his face, where his right hand shows
     * past him: from the game's eye we see his left side). Head frame: his nose's tip is about
     * (0, 0.02, 0.22) from the head's joint.
     */
    scratch(k, t, len, o) {
        const e = envelope(k, 0.22, 0.25);
        const s = Math.sin(t * Math.PI * 2 * 2.6) * sstep(0.2, 0.3, k) * (1 - sstep(0.7, 0.8, k));
        o.R = hand('head', [-0.035, 0.035 + s * 0.018, 0.27 + Math.abs(s) * 0.006], e, [-0.8, -0.8, 0.2]);
        o.head[0] = 0.12 * e;
        o.head[2] = 0.08 * e;
        o.neck[2] = 0.05 * e;
        o.clav = 0.03 * e;
        o.look = 1 - 0.4 * e;
    },
    /** He strokes his beard down, slowly, thinking. */
    beard(k, t, len, o) {
        const e = envelope(k, 0.18, 0.2);
        const stroke = (1 - Math.cos(t * Math.PI * 2 * 0.55)) * 0.5;
        o.R = hand('head', [-0.01, -0.03 - stroke * 0.1, 0.2 + stroke * 0.015], e, [-0.8, -0.7, 0.2]);
        o.head[0] = 0.06 * e;
        o.head[2] = -0.05 * e;
        o.spine[0] = 0.03 * e;
    },
    /** Up from his seat or where he stands: the right arm high, the back arched, the head back (a yawn). */
    stretch(k, t, len, o) {
        const e = envelope(k, 0.32, 0.32);
        const reach = sstep(0.1, 0.45, k) * (1 - sstep(0.62, 0.95, k));
        o.R = hand('chest', [-0.23, 0.44, 0.03], reach, [-1, 0.1, -0.4]);
        o.chest[0] = -0.2 * reach;
        o.spine[0] = -0.08 * reach;
        o.neck[0] = -0.12 * reach;
        o.head[0] = -0.22 * reach;
        o.clav = 0.12 * reach;
        o.chest[2] = 0.05 * Math.sin(k * Math.PI);
        o.look = 1 - 0.7 * e;
    },
    /** A deep, slow troll's bow, his hand on his heart. */
    bow(k, t, len, o) {
        const e = sstep(0.05, 0.38, k) * (1 - sstep(0.68, 0.98, k));
        o.spine[0] = 0.42 * e;
        o.chest[0] = 0.22 * e;
        o.neck[0] = 0.18 * e;
        o.head[0] = 0.28 * e;
        o.hips[2] = -0.06 * e;
        o.R = hand('chest', [-0.06, 0.0, 0.18], envelope(k, 0.18, 0.2), [-0.9, -0.6, 0]);
        o.look = 1 - 0.8 * e;
    },
    /** A nod (two dips of the head). */
    nod(k, t, len, o) {
        const e = envelope(k, 0.1, 0.15);
        const dip = (1 - Math.cos(k * Math.PI * 4)) * 0.5;
        o.head[0] = 0.2 * dip * e;
        o.neck[0] = 0.07 * dip * e;
    },
    /** Bending to the ground for something before his right foot, and up again with it. */
    pick(k, t, len, o) {
        const down = sstep(0.05, 0.42, k) * (1 - sstep(0.62, 0.95, k));
        o.hips[1] = -0.32 * down;
        o.hips[2] = -0.04 * down;
        o.spine[0] = 0.5 * down;
        o.chest[0] = 0.22 * down;
        o.head[0] = 0.15 * down;
        const reach = sstep(0.18, 0.45, k);
        const up = sstep(0.6, 0.9, k);
        const w = envelope(k, 0.18, 0.12) * Math.max(reach, up);
        o.R = hand('model', mix([-0.22, -0.46, 0.34], [-0.14, -0.08, 0.26], up), w, [-0.9, 0.2, -0.5]);
        o.look = 1 - 0.5 * down;
    },
    /** A stone skipped side-arm across the water: wind up to the right, sweep through, follow on. */
    throw(k, t, len, o) {
        const wind = sstep(0.0, 0.42, k) * (1 - sstep(0.42, 0.56, k));
        const through = sstep(0.42, 0.6, k) * (1 - sstep(0.75, 1, k));
        o.chest[1] = -0.42 * wind + 0.38 * through;
        o.spine[1] = -0.18 * wind + 0.16 * through;
        o.spine[0] = 0.12 * (wind + through);
        o.hips[1] = -0.1 * (wind + through);
        let p;
        if (k < 0.42) p = mix([-0.3, -0.12, 0.2], [-0.4, -0.12, -0.14], sstep(0.05, 0.42, k));
        else if (k < 0.6) p = mix([-0.4, -0.12, -0.14], [-0.16, -0.1, 0.46], sstep(0.42, 0.56, k));
        else p = mix([-0.16, -0.1, 0.46], [0.02, -0.14, 0.3], sstep(0.56, 0.72, k));
        o.R = hand('model', p, envelope(k, 0.1, 0.25), [-0.6, -0.8, -0.3]);
        o.look = 1 - 0.3 * wind;
    },
    /** Crouched at the water: a scoop of it to his mouth, twice. */
    drink(k, t, len, o) {
        const cycle = (k * 2) % 1;
        const down = bump(0.0, 0.5, cycle);
        const up = bump(0.4, 1.0, cycle);
        const e = envelope(k, 0.08, 0.1);
        const water = [-0.14, -0.5, 0.44];
        const mouth = [-0.01, -0.02, 0.2];
        o.R = up > down
            ? hand('head', mouth, e * up, [-0.8, -0.8, 0])
            : hand('model', water, e * down, [-0.8, 0.2, -0.4]);
        o.head[0] = (0.22 * down - 0.12 * up) * e;
        o.chest[0] = 0.1 * down * e;
        o.marks = [0.25, 0.75];
        o.look = 1 - 0.6 * up;
    },
    /** Trimming his lantern: it held before his face, his right hand at its door. */
    tend(k, t, len, o) {
        const e = envelope(k, 0.25, 0.25);
        o.staff = 'tend';
        const fiddle = Math.sin(t * Math.PI * 2 * 1.6) * sstep(0.3, 0.4, k) * (1 - sstep(0.7, 0.8, k));
        const at = [-0.05 + fiddle * 0.01, -0.02 + fiddle * 0.008, -0.04];
        o.R = hand('lantern', at, e * sstep(0.2, 0.4, k), [-1, -0.6, 0]);
        o.head[0] = 0.05 * e;
        o.chest[0] = 0.04 * e;
    },
    /** Swaying to her song, side to side, slow. */
    sway(k, t, len, o) {
        const e = envelope(k, 0.2, 0.2);
        const s = Math.sin(t * Math.PI * 2 * 0.36);
        o.chest[2] = 0.07 * s * e;
        o.spine[2] = 0.03 * s * e;
        o.head[2] = 0.07 * Math.sin(t * Math.PI * 2 * 0.36 - 0.6) * e;
        o.hips[0] = 0.02 * s * e;
    },
    /** A belly laugh: shoulders shaking, head back, a hand on his belly. */
    laugh(k, t, len, o) {
        const e = envelope(k, 0.12, 0.3);
        const shake = Math.abs(Math.sin(t * Math.PI * 2 * 3.3));
        o.clav = 0.06 * shake * e;
        o.chest[0] = (-0.08 - 0.03 * shake) * e;
        o.head[0] = (-0.16 - 0.05 * shake) * e;
        o.R = hand('chest', [-0.05, -0.15, 0.26], e, [-0.9, -0.6, 0]);
        o.look = 1 - 0.4 * e;
    },
    /** The turn of his own made him dizzy: a lurch to the side, an arm out, and he catches himself. */
    stagger(k, t, len, o) {
        const lurch = sstep(0.0, 0.3, k) * (1 - sstep(0.45, 1, k));
        o.hips[0] = -0.14 * lurch;
        o.spine[2] = -0.16 * lurch;
        o.chest[2] = 0.08 * lurch;
        o.head[2] = 0.14 * lurch;
        o.spine[0] = 0.1 * lurch;
        o.R = hand('chest', [-0.46, 0.02, 0.09], lurch, [0, -1, -0.3]);
        o.look = 1 - 0.6 * lurch;
    },
    /** Turning about himself as she did, his right arm out, heavily. */
    spin(k, t, len, o) {
        const e = envelope(k, 0.12, 0.15);
        const bob = Math.abs(Math.sin(t * Math.PI * 2 * 0.9));
        o.R = hand('chest', [-0.44, bob * 0.03, 0.11], e, [0, -1, -0.3]);
        o.head[2] = 0.08 * Math.sin(t * 2.4) * e;
        o.hips[1] = -0.03 * bob * e;
    },
    /** Carrying something small and precious before him in his right hand. */
    carry(k, t, len, o) {
        const e = sstep(0, Math.min(1, 0.5 / Math.max(0.5, len)), k);
        o.R = hand('chest', [-0.04, -0.12, 0.31], e, [-0.9, -0.7, -0.1]);
        o.head[0] = 0.12 * e;
    },
    /** Crouched at the water, setting what he carried down on it. */
    set(k, t, len, o) {
        const down = sstep(0.0, 0.5, k) * (1 - sstep(0.62, 1, k));
        // (From before his belly, where he carried it, down to the water before him.)
        o.R = k < 0.5
            ? hand('chest', mix([-0.04, -0.12, 0.31], [-0.1, -0.32, 0.4], sstep(0.05, 0.5, k)), 1, [-0.8, 0, -0.5])
            : hand('model', [-0.12, -0.52, 0.44], 1 - sstep(0.62, 1, k), [-0.8, 0, -0.5]);
        o.head[0] = 0.2 * down;
        o.spine[0] = 0.12 * down;
        o.marks = [0.52];
    },
    /** Knocking his staff on the water before him: twice, to call across to her. */
    thump(k, t, len, o) {
        o.staff = 'thump';
        const strike = bump(0.22, 0.46, k) + bump(0.55, 0.8, k);
        o.chest[0] = 0.1 * strike;
        o.spine[0] = 0.06 * strike;
        o.head[0] = 0.04 * strike;
    },
    /** Looking far up (the moon): leaning back on his staff, his chest lifted, his hand on his belly. */
    lookout(k, t, len, o) {
        const e = envelope(k, 0.2, 0.22);
        o.R = hand('chest', [-0.06, -0.15, 0.26], e, [-0.9, -0.6, 0]);
        o.chest[0] = -0.1 * e;
        o.spine[0] = -0.05 * e;
        o.hips[2] = 0.03 * e;
    },
    /** A sound in the wood: he goes still, his head cocked to it, leaning a little toward it. */
    listen(k, t, len, o) {
        const e = envelope(k, 0.2, 0.25);
        o.head[2] = -0.16 * e;
        o.neck[2] = -0.05 * e;
        o.chest[0] = 0.04 * e;
    },
});

// ── Hers ────────────────────────────────────────────────────────────────────────

export const SPIRIT_GESTURES = Object.freeze({
    /** Her right hand lifted to him across the water, waving gently. */
    wave(k, t, len, o) {
        const e = envelope(k, 0.2, 0.22);
        const s = Math.sin(t * Math.PI * 2 * 1.05) * e;
        o.R = hand('chest', [-0.19 + s * 0.04, 0.27, 0.086 - s * 0.01], e, [-1, -0.5, 0]);
        o.L = hand('chest', [0.01, -0.03, 0.08], e * 0.8, null);
        o.head[2] = 0.08 * e;
        o.chest[2] = -0.04 * e;
    },
    /** A curtsy: her gown held out, a dip, her head bowed. */
    curtsy(k, t, len, o) {
        const e = sstep(0.05, 0.4, k) * (1 - sstep(0.68, 0.98, k));
        const hold = envelope(k, 0.2, 0.2);
        o.L = hand('chest', [0.17, -0.2, 0.086], hold, [1, -0.3, -0.2]);
        o.R = hand('chest', [-0.17, -0.2, 0.086], hold, [-1, -0.3, -0.2]);
        o.hips[1] = -0.07 * e;
        o.spine[0] = 0.16 * e;
        o.neck[0] = 0.12 * e;
        o.head[0] = 0.24 * e;
        o.flare = 0.35 * hold;
        o.look = 1 - 0.7 * e;
    },
    /** A turn about herself on the water, her arms lifted and out, her gown flaring. */
    twirl(k, t, len, o) {
        const e = envelope(k, 0.15, 0.2);
        const turn = sstep(0.08, 0.92, k);
        o.spin = Math.PI * 2 * turn;
        // (How fast she turns, for the gown: the derivative of the ease, in turns a second.)
        const kk = clamp01((k - 0.08) / 0.84);
        const rate = 6 * kk * (1 - kk);
        o.flare = (0.55 * rate) / 1.5;
        // (Open and lifted in a soft curve, the elbows low: a dancer's arms, not a startled one's.)
        o.L = hand('chest', [0.33, 0.15, 0.07], e, [1, -1, -0.3]);
        o.R = hand('chest', [-0.33, 0.15, 0.07], e, [-1, -1, -0.3]);
        o.head[0] = -0.1 * e;
        o.head[2] = 0.1 * Math.sin(k * Math.PI * 2) * e;
        o.chest[0] = -0.05 * e;
        o.hips[1] = 0.012 * Math.sin(k * Math.PI) * e;
        o.look = 1 - 0.85 * e;
    },
    /** Reaching up to catch a firefly, and drawing it down into her cupped hands. */
    gather(k, t, len, o) {
        const up = sstep(0.05, 0.45, k) * (1 - sstep(0.55, 0.9, k));
        const cup = sstep(0.55, 0.95, k);
        o.R = hand('chest', mix([-0.1, 0.37, 0.156], [-0.045, -0.08, 0.176], cup), Math.max(up, cup), [-1, -0.5, 0]);
        o.L = hand('chest', [0.045, -0.08, 0.176], cup, null);
        o.head[0] = -0.08 * up;
    },
    /** Lifting her cupped hands and opening them: the light goes up. */
    release(k, t, len, o) {
        const lift = sstep(0.0, 0.3, k);
        const open = sstep(0.25, 0.55, k);
        const down = sstep(0.6, 1, k);
        const y = -0.08 + 0.36 * lift * (1 - down * 0.9);
        const x = 0.045 + 0.15 * open * (1 - down * 0.6);
        o.L = hand('chest', [x, y, 0.176 - 0.07 * open], 1 - sstep(0.75, 1, k), [1, -0.5, 0]);
        o.R = hand('chest', [-x, y, 0.176 - 0.07 * open], 1 - sstep(0.75, 1, k), [-1, -0.5, 0]);
        o.head[0] = -0.12 * lift * (1 - down);
    },
    /** Her cupped hands to her lips, then opened out toward him: she sends the light across. */
    send(k, t, len, o) {
        const lips = sstep(0.0, 0.25, k) * (1 - sstep(0.4, 0.55, k));
        const out = sstep(0.42, 0.6, k) * (1 - sstep(0.8, 1, k));
        const e = Math.max(lips, out);
        o.L = hand('chest', out > lips ? [0.07, 0.1, 0.276] : [0.025, 0.15, 0.106], e, [1, -0.6, -0.2]);
        o.R = hand('chest', out > lips ? [-0.07, 0.1, 0.276] : [-0.025, 0.15, 0.106], e, [-1, -0.6, -0.2]);
        o.chest[0] = 0.06 * out - 0.04 * lips;
        o.head[0] = 0.08 * lips;
    },
    /** Singing to the night: her hands at her breast, her head lifted, swaying a little. */
    sing(k, t, len, o) {
        const e = envelope(k, 0.15, 0.15);
        const s = Math.sin(t * Math.PI * 2 * 0.33);
        o.L = hand('chest', [-0.022, 0, 0.086], e, null);
        o.R = hand('chest', [0.028, -0.025, 0.091], e, null);
        o.chest[0] = -0.06 * e;
        o.head[2] = 0.08 * s * e;
        o.chest[2] = -0.04 * s * e;
        o.hips[0] = 0.012 * s * e;
    },
    /** Smoothing her hair back behind her ear, twice. */
    brush(k, t, len, o) {
        const e = envelope(k, 0.15, 0.2);
        const cycle = (k * 2) % 1;
        const sweep = sstep(0.1, 0.75, cycle);
        o.R = hand('head', mix([-0.045, 0.035, 0.06], [-0.07, 0.015, -0.05], sweep), e, [-1, -0.2, 0.1]);
        o.head[2] = 0.12 * e;
        o.head[0] = -0.04 * e;
    },
    /** Laughing behind her hands. */
    laugh(k, t, len, o) {
        const e = envelope(k, 0.12, 0.25);
        const shake = Math.abs(Math.sin(t * Math.PI * 2 * 2.8));
        o.L = hand('head', [0.014, -0.05, 0.07], e, [1, -0.8, 0]);
        o.R = hand('head', [-0.014, -0.05, 0.07], e, [-1, -0.8, 0]);
        o.clav = 0.04 * shake * e;
        o.chest[0] = (-0.04 - 0.03 * shake) * e;
        o.head[0] = (-0.1 - 0.04 * shake) * e;
        o.head[2] = 0.08 * e;
    },
    /** Three soft claps. */
    clap(k, t, len, o) {
        const e = envelope(k, 0.15, 0.2);
        const beat = sstep(0.15, 0.25, k) * (1 - sstep(0.8, 0.9, k));
        const apart = beat ? (1 + Math.cos(t * Math.PI * 2 * 2.3)) * 0.5 : 1;
        const gap = 0.012 + 0.07 * apart;
        o.L = hand('chest', [gap, 0.0, 0.14], e, [1, -0.6, -0.2]);
        o.R = hand('chest', [-gap, 0.0, 0.14], e, [-1, -0.6, -0.2]);
        o.head[0] = 0.04 * (1 - apart) * beat;
    },
    /** Caught looking: she turns her face away and down, her hand to her breast. */
    shy(k, t, len, o) {
        const e = envelope(k, 0.15, 0.35);
        o.R = hand('chest', [-0.02, 0.0, 0.08], e, null);
        o.head[2] = 0.12 * e;
        o.head[1] = -0.35 * e;
        o.chest[1] = -0.12 * e;
        o.look = 1 - 0.5 * e;
    },
    /** A fond tilt of her head. */
    tilt(k, t, len, o) {
        const e = envelope(k, 0.25, 0.3);
        o.head[2] = 0.18 * e;
        o.neck[2] = 0.05 * e;
        o.hips[0] = 0.01 * e;
    },
    /** A nod. */
    nod(k, t, len, o) {
        const e = envelope(k, 0.1, 0.15);
        const dip = (1 - Math.cos(k * Math.PI * 4)) * 0.5;
        o.head[0] = 0.16 * dip * e;
    },
    /** Her hands clasped at her breast. */
    clasp(k, t, len, o) {
        const e = envelope(k, 0.18, 0.2);
        o.L = hand('chest', [0.012, 0.05, 0.106], e, [1, -0.8, -0.2]);
        o.R = hand('chest', [-0.012, 0.05, 0.106], e, [-1, -0.8, -0.2]);
        o.chest[0] = -0.03 * e;
    },
    /** Kneeling, a fingertip set down on the water (to answer him). */
    dip(k, t, len, o) {
        const down = bump(0.15, 0.85, k);
        o.R = hand('water', [-0.04, 0.012, 0.3], down, [-1, -0.2, -0.4]);
        o.spine[0] = 0.08 * down;
        o.head[0] = 0.1 * down;
        o.marks = [0.42];
    },
});

/**
 * Gestures made to follow one another, each ending where the next begins: he carries the light and
 * sets it down; she catches the firefly in her cupped hands (and holds it there a while) and lets it
 * go. The rest begin and end with the body as it was.
 */
export const HANDOVERS = Object.freeze([
    Object.freeze({ who: 'troll', from: 'carry', to: 'set' }),
    Object.freeze({ who: 'spirit', from: 'gather', to: 'release' }),
]);

/**
 * The gestures a body is making, each with how much of it shows (0..1): the one asked for comes in
 * over `fadeIn` seconds, any other (cut short, or done) goes out over `fadeOut`.
 */
export class GestureSlots {
    constructor() {
        this.slots = [];
    }

    reset() {
        this.slots.length = 0;
    }

    /** Ask for `g` ({ name, start, length }) or nothing; returns the slots, their weights stepped. */
    step(g, time, dt, fadeIn = 0.22, fadeOut = 0.35) {
        let active = null;
        if (g && time >= g.start) {
            active = this.slots.find((s) => s.name === g.name && s.start === g.start) || null;
            if (!active) {
                active = {
                    name: g.name, start: g.start, length: g.length, w: dt > 0 ? 0 : 1, fired: 0,
                };
                this.slots.push(active);
            }
            active.length = g.length;
        }
        for (let i = 0; i < this.slots.length; i++) {
            const s = this.slots[i];
            // (A gesture past its end goes out too, asked for or not.)
            const live = s === active && time - s.start < s.length;
            s.live = live;
            if (!(dt > 0)) continue;
            if (live) s.w = Math.min(1, s.w + dt / fadeIn);
            else s.w = Math.max(0, s.w - dt / fadeOut);
        }
        for (let i = this.slots.length - 1; i >= 0; i--) {
            if (this.slots[i].w <= 0 && this.slots[i] !== active) this.slots.splice(i, 1);
        }
        if (this.slots.length > 3) this.slots.splice(0, this.slots.length - 3);
        return this.slots;
    }
}

/** How much a slot shows: its weight, eased. */
export const slotWeight = (s) => sstep(0, 1, s.w);
