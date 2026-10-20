/**
 * The air between the eye and everything it sees: a cold mist lying on the water and in
 * the valleys, and a thin haze through the whole sky that greys the far range.
 *
 * Both are exponential height layers, integrated in closed form along the straight segment
 * from the eye to the surface being shaded. Every surface — lake, banks, spruces, range and
 * the sky past them — therefore agrees on how much air lies in front of it: no pass, no
 * march, and no seam where a surface meets the sky. The mist is patchy (a drifting noise
 * read where the segment ends low) and glows with the aurora above it, so a pulse that
 * turns a curtain magenta also turns the mist under it.
 *
 * The planar mirror renders the scene from an eye below the water. Heights are taken as
 * absolute values, so that eye sees the same air as the real one above the surface.
 */
import {
    abs, cameraPosition, exp, float, length, max, mix, normalize, select, smoothstep, texture, vec2, vec3,
} from 'three/tsl';
import { AURORA_COLORS } from './aurora-palette.js';

/** Cold mist: scale height (world units above the lake) and density at the water. */
export const MIST = Object.freeze({
    height: 24,
    density: 0.00075,
    /** World units per noise tile; the broad channel holds 8 banks a tile. */
    tile: 1400,
    /** Tiles per second the banks drift. */
    drift: Object.freeze([0.0009, 0.00035]),
    /** Above this height the endpoint no longer decides how patchy the mist in front is. */
    patchHeight: 140,
});

/** Thin haze through the whole air: what turns the far range blue-grey. */
export const HAZE = Object.freeze({
    height: 700,
    density: 0.00016,
});

/** How far above a surface (radians, roughly) the mist looks for the aurora that lights it. */
const LIFT = 0.2;

/**
 * Mean of exp(−h / H) along a straight path whose height runs linearly from h0 to h1,
 * times the path length and the layer's density: the layer's optical depth.
 */
export function layerDepth(h0, h1, pathLength, scaleHeight, density) {
    const a = max(h0, 0).div(scaleHeight).toVar();
    const b = max(h1, 0).div(scaleHeight).toVar();
    const span = b.sub(a).toVar();
    const ea = exp(a.negate()).toVar();
    const level = abs(span).lessThan(1e-3);
    const safe = select(level, float(1e-3), span);
    const mean = select(level, ea.mul(span.mul(-0.5).add(1)), ea.sub(exp(b.negate())).div(safe));
    return mean.mul(pathLength).mul(density);
}

/** CPU twin of `layerDepth`, for tests and tuning. */
export function layerDepthCpu(h0, h1, pathLength, scaleHeight, density) {
    const a = Math.max(h0, 0) / scaleHeight;
    const b = Math.max(h1, 0) / scaleHeight;
    const span = b - a;
    const ea = Math.exp(-a);
    const mean = Math.abs(span) < 1e-3 ? ea * (1 - span * 0.5) : (ea - Math.exp(-b)) / span;
    return mean * pathLength * density;
}

const triple = (rgb) => vec3(rgb[0], rgb[1], rgb[2]);

export class AuroraAtmosphere {
    /**
     * @param {object} options
     * @param {object} options.uniforms shared world uniforms (time, activity, auroraLight)
     * @param {THREE.Texture} options.noiseTexture shared noise tile (not owned)
     * @param {import('./aurora-curtains.js').AuroraCurtains} options.curtains
     */
    constructor({ uniforms, noiseTexture, curtains }) {
        this.uniforms = uniforms;
        this.noiseTexture = noiseTexture;
        this.curtains = curtains;
    }

    /**
     * Aurora radiance a little above the direction of `point` from the eye: the display that
     * stands over a surface, lighting its snow and the mist in front of it.
     */
    auroraAbove(point) {
        const path = point.sub(cameraPosition);
        const reach = length(path.xz).max(1e-3);
        return this.curtains.sample(normalize(vec3(path.x, max(path.y, 0).add(reach.mul(LIFT)), path.z)));
    }

    /**
     * Fog `color` seen at world `point`. `aurora` is the radiance from `auroraAbove(point)`
     * when the caller already has it; `patchy: false` keeps the mist even (the sky dome,
     * whose points lie at infinity).
     */
    apply(color, point, { aurora = null, patchy = true } = {}) {
        const u = this.uniforms;
        const eye = cameraPosition;
        const pathLength = length(point.sub(eye)).toVar();
        const h0 = abs(eye.y);
        const h1 = abs(point.y);
        let mist = layerDepth(h0, h1, pathLength, MIST.height, MIST.density);
        if (patchy) {
            // Banks of mist drift over the water; the read is taken where the path ends, and
            // only counts where that end lies low (in front of a peak the mist is even).
            const at = point.xz.div(MIST.tile).add(vec2(u.time.mul(MIST.drift[0]), u.time.mul(MIST.drift[1])));
            const banks = texture(this.noiseTexture, at);
            const wisps = texture(this.noiseTexture, at.mul(3.1).add(vec2(0.37, 0.71)));
            const patch = smoothstep(0.3, 0.82, banks.b.mul(0.7).add(wisps.a.mul(0.3))).mul(2.6).add(0.04);
            const low = exp(max(point.y, 0).div(-MIST.patchHeight));
            mist = mist.mul(mix(float(1), patch, low));
        }
        const haze = layerDepth(h0, h1, pathLength, HAZE.height, HAZE.density);
        const total = mist.add(haze).toVar();
        const light = aurora ?? this.auroraAbove(point);
        // Mist is lit by the cold sky and by the aurora standing over it; haze mostly by the sky.
        const mistLight = vec3(0.009, 0.017, 0.034)
            .add(u.auroraLight.mul(0.36))
            .add(light.mul(0.12));
        const hazeLight = triple(AURORA_COLORS.skyHorizon).mul(0.85)
            .add(u.auroraLight.mul(0.05))
            .add(light.mul(0.025));
        const scatter = mistLight.mul(mist).add(hazeLight.mul(haze)).div(max(total, 1e-5));
        const transmitted = exp(total.negate());
        return color.mul(transmitted).add(scatter.mul(transmitted.oneMinus()));
    }
}
