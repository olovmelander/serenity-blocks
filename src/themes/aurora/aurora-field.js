/**
 * Aurora curtain geometry, shared by the CPU and the GPU.
 *
 * A real auroral arc is a thin luminous sheet that hangs along the magnetic field: almost
 * identical at every altitude, endlessly folded sideways. So the whole display is defined
 * by FOOTPRINT curves on a horizontal plane (kilometres, observer at the origin looking
 * down −z) and extruded upward along a slightly leaning field line. The march in
 * aurora-curtains.js walks a view ray through that extrusion; this module owns the numbers
 * it bakes in, and mirrors the parts gameplay needs on the CPU:
 *
 *   - where on an arc a screen direction lands (so a lock plucks the curtain above the
 *     piece that caused it), and
 *   - the excitation map: a tiny RGBA strip per arc, in arc coordinates, that the director
 *     paints travelling pulses into. Its colour takes over the curtain where a pulse passes.
 *
 * No three, no DOM: everything here runs in plain node.
 */

export const AURORA_GEOMETRY = Object.freeze({
    /** Altitude of the sharp lower border, km. */
    baseAltitude: 100,
    /** Excited rays dig this far below the resting border, km. */
    floorMargin: 14,
    /** March ceiling, km. Tall rays and the red crown live up here. */
    topAltitude: 400,
    /** Earth radius, km — distant arcs set behind the curved horizon instead of hovering. */
    earthRadius: 6371,
    /** Field-line lean: horizontal km (x, z) gained per km of altitude. */
    leanX: 0.0,
    leanZ: -0.2,
    /** The excitation map spans this many km along each arc, centred on the observer. */
    spanKm: 2400,
});

/**
 * Sideways folds shared by every arc: displacement = amp · sin(κ·s + μ·q + ω·τ + phase).
 * `shear` (μ) leans the wave across the sheet; once sway · amp · shear exceeds 1 the fold
 * overturns into an S-curl, which is why the curtains visibly knot up as activity climbs.
 * Wavelengths stay above ~140 km so the march's sample spacing can resolve them.
 */
export const AURORA_MEANDERS = Object.freeze([
    {
        amp: 84, wavelength: 1180, shear: 0.0, speed: 0.032, phase: 0.6, envelope: 2600,
    },
    {
        amp: 44, wavelength: 540, shear: 0.006, speed: -0.055, phase: 2.1, envelope: 1700,
    },
    {
        amp: 30, wavelength: 268, shear: 0.023, speed: 0.1, phase: 4.4, envelope: 1100,
    },
    {
        amp: 17, wavelength: 152, shear: 0.034, speed: -0.16, phase: 1.3, envelope: 760,
    },
].map((term) => Object.freeze({
    ...term,
    kappa: (Math.PI * 2) / term.wavelength,
    envelopeKappa: (Math.PI * 2) / term.envelope,
})));

/**
 * The arcs, most important first (cheaper tiers march only the leading ones). `distance`
 * is how far north the resting line sits, `angle` rotates it about the vertical (negative
 * = nearer on the left), `width` is the sheet's half-thickness, `sway` scales the folds
 * (near arcs fold less in kilometres, or they would sweep through the zenith) and `rays`
 * scales the ray pattern (a near arc shows finer rays). The main
 * arc towers on the left and falls to the right horizon; the cross arc weaves under it. The corona arc is always
 * last: it passes almost overhead, so its rays converge on the magnetic zenith, and it
 * only lights during a storm.
 */
export const AURORA_ARCS = Object.freeze([
    {
        id: 'main', distance: 120, angle: -1.0, width: 3.6, gain: 1.0, height: 1.0, sway: 0.42, rays: 2.4, seed: 0.0, drift: 1,
    },
    {
        id: 'cross', distance: 260, angle: 0.9, width: 5.0, gain: 0.72, height: 0.95, sway: 0.85, rays: 1.5, seed: 5.13, drift: -1,
    },
    {
        id: 'far', distance: 620, angle: -0.05, width: 8.0, gain: 0.5, height: 0.85, sway: 1.3, rays: 1, seed: 2.71, drift: 1,
    },
    {
        id: 'corona', distance: 46, angle: 0.06, width: 3.4, gain: 0, height: 1.55, sway: 0.26, rays: 3, seed: 8.37, drift: -1,
    },
].map((arc, index) => {
    const tangentX = Math.cos(arc.angle);
    const tangentZ = Math.sin(arc.angle);
    const normalX = Math.sin(arc.angle);
    const normalZ = -Math.cos(arc.angle);
    return Object.freeze({
        ...arc,
        index,
        tangentX,
        tangentZ,
        normalX,
        normalZ,
        leanAlong: AURORA_GEOMETRY.leanX * tangentX + AURORA_GEOMETRY.leanZ * tangentZ,
        leanAcross: AURORA_GEOMETRY.leanX * normalX + AURORA_GEOMETRY.leanZ * normalZ,
    });
}));

export const CORONA_ARC_INDEX = AURORA_ARCS.findIndex((arc) => arc.id === 'corona');

/** Sum of fold amplitudes: how far a sheet can wander from its resting line at sway 1. */
export const MEANDER_REACH = AURORA_MEANDERS.reduce((sum, term) => sum + term.amp, 0);

/** Excitation encoding shared with the shader. */
export const EXCITATION = Object.freeze({
    width: 256,
    /** Tint energy at byte 255. */
    maxGlow: 2,
});

/**
 * Billows: travelling waves in the fabric itself, a derivative-of-Gaussian wavelet (one
 * crest, one trough, no net shift). They are evaluated analytically on both sides, so
 * the march's spline follows them exactly.
 */
export const BILLOW = Object.freeze({
    /** Waves an arc can carry at once. */
    slots: 2,
    /** Largest crest, km. */
    maxAmplitude: 34,
    /** Scales −x·exp(−x²) to a unit crest. */
    normalise: Math.sqrt(2 * Math.E),
});

/** Sideways shift, km, a billow gives the sheet at an arc coordinate. */
export function billowShift(along, centre, amplitude, inverseWidth) {
    const reach = (along - centre) * inverseWidth;
    return -reach * Math.exp(-reach * reach) * amplitude * BILLOW.normalise;
}

/** Phase of one fold term on one arc — the single place both sides read it from. */
export function meanderPhase(term, arc) {
    return term.phase + arc.seed * (1 + term.wavelength * 0.0011);
}

/** Phase of a fold term's slow amplitude envelope on one arc. */
export function envelopePhase(term, arc) {
    return term.phase * 1.7 + arc.seed * 2.3;
}

/**
 * Evaluate an arc's fold field at a footprint point. `out` receives `along` (s), `across`
 * (q, signed distance to the resting line), `level` (zero on the sheet) and `distance`
 * (km to the sheet, signed). Mirrors the shader's field exactly, minus the excitation.
 */
export function evaluateArcField(arc, x, z, tau = 0, sway = 1, out = {}) {
    const along = x * arc.tangentX + z * arc.tangentZ;
    const across = x * arc.normalX + z * arc.normalZ - arc.distance;
    let level = across;
    let gradAcross = 1;
    let gradAlong = 0;
    for (const term of AURORA_MEANDERS) {
        const envelope = 0.72 + 0.28 * Math.sin(along * term.envelopeKappa + envelopePhase(term, arc));
        const amplitude = sway * arc.sway * term.amp * envelope;
        const argument = along * term.kappa + across * term.shear + tau * term.speed + meanderPhase(term, arc);
        const cosine = Math.cos(argument);
        level += amplitude * Math.sin(argument);
        gradAcross += amplitude * term.shear * cosine;
        gradAlong += amplitude * term.kappa * cosine;
    }
    out.along = along;
    out.across = across;
    out.level = level;
    out.distance = level / Math.sqrt(Math.max(0.08, gradAcross * gradAcross + gradAlong * gradAlong));
    return out;
}

/**
 * Arc coordinate (km along the arc) directly beneath a viewing azimuth, measured from
 * straight ahead (−z), positive to the right. Returns null when the line of sight never
 * meets the arc's resting line.
 */
export function arcCoordinateForAzimuth(arc, azimuth) {
    const relative = azimuth - arc.angle;
    if (!Number.isFinite(relative) || Math.cos(relative) <= 0.12) return null;
    return arc.distance * Math.tan(relative);
}

/**
 * Kilometres of arc per radian of view azimuth at that azimuth: how far a pulse must run
 * along the arc to cross a given angle of sky. Null where the arc is out of sight.
 */
export function arcRateForAzimuth(arc, azimuth) {
    const cosine = Math.cos(azimuth - arc.angle);
    if (!Number.isFinite(cosine) || cosine <= 0.12) return null;
    return arc.distance / (cosine * cosine);
}

/** Arc coordinates [left, right] of the stretch an observer can see across the view. */
export function arcViewSpan(arc, halfAngle = 0.72) {
    const limit = AURORA_GEOMETRY.spanKm / 2 - 120;
    const at = (azimuth) => {
        const relative = Math.max(-1.4, Math.min(1.4, azimuth - arc.angle));
        return Math.max(-limit, Math.min(limit, arc.distance * Math.tan(relative)));
    };
    return [at(-halfAngle), at(halfAngle)];
}

/** Texture u for an arc coordinate. */
export function excitationCoordinate(along) {
    return along / AURORA_GEOMETRY.spanKm + 0.5;
}

/**
 * The excitation map. `rows` is the number of arcs it carries. Each simulation step calls
 * `begin()` and then `accumulate()` once per live pulse; `commit()` quantises that frame
 * into `data` (RGBA8, row-major) and reports whether the bytes changed, so an idle sky
 * never re-uploads.
 */
export class ExcitationMap {
    constructor(rows = AURORA_ARCS.length) {
        this.width = EXCITATION.width;
        this.rows = Math.max(1, Math.floor(rows));
        this.data = new Uint8Array(this.width * this.rows * 4);
        this.scratch = new Float32Array(this.width * this.rows * 4);
        this.clear();
    }

    clear() {
        this.scratch.fill(0);
        for (let i = 0; i < this.data.length; i += 4) {
            this.data[i] = 0;
            this.data[i + 1] = 0;
            this.data[i + 2] = 0;
            this.data[i + 3] = 255;
        }
        /** `data` must reach the GPU even though no pulse changed it. */
        this.dirty = true;
        /** The frame being painted holds at least one pulse. */
        this.touched = false;
        /** The painted frame differs from what `data` was last quantised from. */
        this.pending = false;
    }

    /**
     * Start painting a new frame. Every simulation step repaints from nothing, so however
     * often (or seldom) the frame is committed, the map holds exactly one step of pulses.
     */
    begin() {
        if (!this.touched) return;
        this.scratch.fill(0);
        this.touched = false;
        this.pending = true;
    }

    /** Add a pulse of tint centred on `centre` km: a Gaussian `sigma` km wide. */
    accumulate(row, centre, sigma, red, green, blue) {
        if (row < 0 || row >= this.rows || !(sigma > 0)) return;
        const { width, scratch } = this;
        const kmPerTexel = AURORA_GEOMETRY.spanKm / width;
        const centreTexel = excitationCoordinate(centre) * width - 0.5;
        const reach = Math.ceil((sigma * 3.2) / kmPerTexel);
        // The first and last texel stay dark: the sampler clamps to them off the map.
        const first = Math.max(1, Math.floor(centreTexel - reach));
        const last = Math.min(width - 2, Math.ceil(centreTexel + reach));
        if (last < first) return;
        const offset = row * width * 4;
        for (let texel = first; texel <= last; texel += 1) {
            const x = ((texel - centreTexel) * kmPerTexel) / sigma;
            const bell = Math.exp(-x * x);
            const index = offset + texel * 4;
            scratch[index] += red * bell;
            scratch[index + 1] += green * bell;
            scratch[index + 2] += blue * bell;
        }
        this.touched = true;
        this.pending = true;
    }

    /** Quantise the painted frame into `data`; returns true when the bytes changed. */
    commit() {
        const { data, scratch } = this;
        let changed = this.dirty;
        this.dirty = false;
        if (!this.pending) return changed;
        this.pending = false;
        const glowScale = 255 / EXCITATION.maxGlow;
        for (let i = 0; i < data.length; i += 4) {
            const red = Math.min(255, Math.round(Math.max(0, scratch[i]) * glowScale));
            const green = Math.min(255, Math.round(Math.max(0, scratch[i + 1]) * glowScale));
            const blue = Math.min(255, Math.round(Math.max(0, scratch[i + 2]) * glowScale));
            if (data[i] !== red || data[i + 1] !== green || data[i + 2] !== blue) {
                data[i] = red;
                data[i + 1] = green;
                data[i + 2] = blue;
                changed = true;
            }
        }
        return changed;
    }
}
