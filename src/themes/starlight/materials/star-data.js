/**
 * Starlight — CPU Star Catalog Generator
 *
 * Builds the per-instance attribute arrays for the deep starfield. Runs ONCE at
 * theme setup (the only CPU-heavy spawn step). No Three.js / TSL here — pure data.
 *
 * The catalog encodes an idealized-but-believable night sky:
 *   - Stars distributed across a few concentric depth SHELLS (perspective gives
 *     parallax for free as the camera floats — far shells are dimmer/desaturated).
 *   - Density biased toward a tilted Milky Way band (great-circle plane).
 *   - Density reduced in the central board column so gameplay reads first.
 *   - Color TEMPERATURE skewed toward white / blue-white with a gold/red minority.
 *   - Brightness follows a steep power law (a few bright anchors, many faint).
 *
 * Output arrays (length = count, except positions = count*3):
 *   positions[i*3..]  world-space position on a shell
 *   temp[i]           0..1 color temperature (0 cool-red → 1 hot-blue)
 *   mag[i]            0..1 brightness/magnitude
 *   twPhase[i]        0..2π twinkle phase offset
 *   twFreq[i]         twinkle angular frequency
 *   seed[i]           0..1 per-star random (drives hero-star glints, etc.)
 */

const TAU = Math.PI * 2;

function normalize3(x, y, z) {
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
}

/**
 * @param {number} count
 * @param {object} [opts]
 * @param {Array<{r:number,brightness:number,saturation:number}>} [opts.shells]
 * @param {[number,number,number]} [opts.milkyWayNormal] tilted band plane normal
 * @param {number} [opts.bandBias] 0..1 — how strongly density clumps to the band
 * @param {number} [opts.boardColumnReduce] 0..1 — central-column density cut
 */
export function generateStarCatalog(count, opts = {}) {
    const shells = opts.shells || [
        { r: 150, brightness: 0.55, saturation: 0.7 }, // far, dim, desaturated
        { r: 105, brightness: 0.8, saturation: 0.85 },
        { r: 65, brightness: 1.0, saturation: 1.0 }, // near, bright
    ];
    const bandNormal = normalize3(...(opts.milkyWayNormal || [0.35, 0.5, 0.79]));
    const bandBias = opts.bandBias ?? 0.65;
    const boardColumnReduce = opts.boardColumnReduce ?? 0.55;

    const positions = new Float32Array(count * 3);
    const temp = new Float32Array(count);
    const mag = new Float32Array(count);
    const twPhase = new Float32Array(count);
    const twFreq = new Float32Array(count);
    const seed = new Float32Array(count);

    const [nx, ny, nz] = bandNormal;

    for (let i = 0; i < count; i += 1) {
        // ── Pick a direction with Milky-Way + board-column biased rejection ──
        let dx = 0;
        let dy = 0;
        let dz = 0;
        for (let tries = 0; tries < 8; tries += 1) {
            // Uniform point on the unit sphere.
            const u = Math.random() * 2 - 1; // cos(phi)
            const theta = Math.random() * TAU;
            const s = Math.sqrt(Math.max(0, 1 - u * u));
            const cx = s * Math.cos(theta);
            const cy = u;
            const cz = s * Math.sin(theta);

            // Band proximity: 1 near the galactic plane, →0 at the poles.
            const planeDist = Math.abs(cx * nx + cy * ny + cz * nz); // 0..1
            const bandProx = 1 - Math.min(1, planeDist / 0.5);
            let accept = (1 - bandBias) + bandBias * bandProx;

            // Central-column reduction: dim density for stars that sit roughly
            // in front of the camera near screen-x center (camera looks down -z).
            const inFront = cz < 0 ? 1 : 0;
            const nearCenterX = 1 - Math.min(1, Math.abs(cx) / 0.22);
            const colPenalty = inFront * nearCenterX * boardColumnReduce;
            accept *= (1 - colPenalty);

            if (Math.random() <= accept || tries === 7) {
                dx = cx; dy = cy; dz = cz;
                break;
            }
        }

        // ── Assign a shell (more stars on the nearer/brighter shells) ──
        const shellRoll = Math.random();
        let shellIdx = 0;
        if (shellRoll < 0.45) {
            shellIdx = shells.length - 1;
        } else if (shellRoll < 0.78) {
            shellIdx = Math.max(0, shells.length - 2);
        }
        const shell = shells[shellIdx];

        positions[i * 3] = dx * shell.r;
        positions[i * 3 + 1] = dy * shell.r;
        positions[i * 3 + 2] = dz * shell.r;

        // ── Brightness: power law (many faint, few bright) × shell dim. Floor
        // raised + curve softened vs astrophysical reality so more stars read as
        // a dense magical canopy (over a near-black sky they'd otherwise vanish).
        const m = Math.random() ** 2.2;
        mag[i] = (0.14 + 0.86 * m) * shell.brightness;

        // ── Temperature: skew toward white/blue-white (approx gaussian ~0.62) ──
        const g = (Math.random() + Math.random() + Math.random()) / 3; // ~0.5 mean
        let tval = 0.62 + (g - 0.5) * 0.9;
        // Desaturate far shells toward white by pulling temp toward 0.65.
        tval = 0.65 + (tval - 0.65) * shell.saturation;
        temp[i] = Math.min(1, Math.max(0, tval));

        twPhase[i] = Math.random() * TAU;
        twFreq[i] = 0.3 + Math.random() * 1.3;
        seed[i] = Math.random();
    }

    return {
        count, positions, temp, mag, twPhase, twFreq, seed,
    };
}
