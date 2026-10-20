/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE SHAFT — Earth Core's climb, given real walls (Odyssey overhaul, Act I lane, 2026-10-20).
 *
 * From chapter-local 0.15 the camera looks almost straight up the shaft, and the walls it saw
 * were the colonnade: eighteen 5-7-sided cylinders with ONE height segment, merged into a draw.
 * Seen from below in steep perspective every facet was a flat dark plane tens of units long, and
 * the shorter prisms ended in flat caps the climb passed at local 0.45-0.6 — the "flat dark
 * rectangular slabs" of every capture. The vault beyond them is a sphere 250 u out, so between
 * the prisms the shaft had no wall at all.
 *
 * This is one continuous rock wall around the climb, one draw:
 *   - a CHAMBER round the lake (r ~66) that tapers into the shaft (r ~50) and narrows into a
 *     THROAT (r ~22) where the shaft meets the sea floor — the vent the climb bursts out of, at
 *     the world's own seabed height (y ~98.7, see ADR-0017), the steam pouring through it;
 *   - STRATA: broken ledges every 9-16 u that step inward, so looking up the shaft their
 *     undersides catch the lake's light in rings that recede toward the light at the top;
 *     colonnade bands (vertical basalt jointing) alternate with rough tuff and obsidian bands;
 *   - a CAVE MOUTH toward the opening's lake vista, so the opening frame still looks across open
 *     lava to the far shore (the wall only closes above the opening frame's top edge);
 *   - SPOUTS where the lava falls leave the wall (createShaftFalls below), and the falls' light
 *     on the rock behind them.
 *
 * Lit in-shader (MeshBasicNodeMaterial, no light loop): the lake is the key, BELOW, so the faces
 * that look down at it — the ledge undersides the climb sees — carry the light; the falls add
 * their own warm pools; thin heat cracks burn where the lake does not reach and in the throat;
 * the quench (uSeam) cools them. Opaque, depth-writing, fogged by the scene fog like the rest of
 * the cavern (the steam's fog dissolves it into the vapour).
 *
 * Everything is in the chapter group's LOCAL frame (the group is anchored at the path centre).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cross,
    dot,
    exp,
    float,
    length,
    max,
    min,
    mix,
    modelWorldMatrixInverse,
    normalLocal,
    normalize,
    oneMinus,
    pow,
    sin,
    smoothstep,
    sqrt,
    step,
    fract,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { noise2, ridged3 } from './shared/odyssey-tsl-noise.js';
import {
    EARTH_CORE_THROUGH_STEAM_ORDER, basaltRandom, earthCoreNoise01, earthCoreVeilTransmission, magmaSurgeTSL,
} from './earth-core.tsl.js';

const DEG = Math.PI / 180;

/**
 * The shaft's numbers, in units of height above the lake (h) and radius from its axis (r).
 * THROAT_TOP sits at the world's seabed over the shaft (odysseyWorldHeight(-3, 5) ~ 98.7, lake at
 * world -40): the climb leaves the rock exactly where the ocean's floor would be.
 */
export const SHAFT = Object.freeze({
    /** Wall rows run from just under the lake to the vent's lip. */
    H_BOTTOM: -6,
    H_TOP: 146,
    /** Radius of the lake chamber, the shaft, and the vent throat. */
    R_CHAMBER: 66,
    R_SHAFT: 50,
    R_THROAT: 22,
    /** Chamber -> shaft taper, then shaft -> throat. */
    H_TAPER_LO: 34,
    H_TAPER_HI: 98,
    H_THROAT_LO: 90,
    H_THROAT_TOP: 138,
    /** The vent's lip flares out above the throat (seen only from inside the steam). */
    R_LIP: 36,
    /** The cave mouth toward the opening's lake vista: half-angle at the lake, and its crown. */
    MOUTH_HALF_ANGLE: 74 * DEG,
    MOUTH_CROWN_H: 64,
    /** Grid resolution: columns round the axis, rows per unit of height. */
    COLS: 256,
    ROW_STEP: 1.0,
});

/**
 * The lava falls: azimuth round the axis (0 = toward the opening's vista, which is screen-DOWN
 * while climbing; +90 deg = screen-right), the height of the lip above the lake, the lava's width.
 *
 * WHERE A FALL CAN BE SEEN FROM THE CLIMB. The camera looks straight up, so the frame is a cone
 * round the zenith: +-29 deg toward screen top/bottom, +-46 deg toward the sides. A point on the
 * wall at radius R is in frame only while it is more than R / tan(that angle) above the eye — 0.95 R
 * at the sides, 1.8 R at top and bottom. So the falls stand at the SIDES of the frame (azimuth
 * near +-90 deg), the two big ones from the upper shaft (lips ~95-100, R ~47: in frame from the
 * lake to the climb's middle) and two slim ones from the throat (R ~23: in frame almost to the
 * steam), falling free down the shaft — the wall below them steps outward — into the lake. None
 * stands in the opening frame (the cave mouth's azimuths, |az| < 74 deg below h 64).
 */
export const SHAFT_FALLS = Object.freeze([
    Object.freeze({
        azimuth: 88 * DEG, lipH: 100, width: 3.8, seed: 0.13,
    }),
    Object.freeze({
        azimuth: -92 * DEG, lipH: 94, width: 3.4, seed: 0.41,
    }),
    Object.freeze({
        azimuth: 128 * DEG, lipH: 128, width: 2.4, seed: 0.67, length: 44,
    }),
    Object.freeze({
        azimuth: -135 * DEG, lipH: 122, width: 2.6, seed: 0.89, length: 38,
    }),
]);

/** How far inward (toward the axis) a fall is thrown over its whole drop, world units. */
const FALL_THROW = 7.5;
/** The ribbon is drawn this much wider than the lava in it: the rest is its own light. */
const FALL_HALO = 2.4;
/** Rows along a fall ribbon. */
const FALL_SEGMENTS = 40;

const smooth01 = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - (2 * t));
};

/** Wrapped angle difference in (-pi, pi]. */
function angleDelta(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d <= -Math.PI) d += Math.PI * 2;
    return d;
}

/**
 * The shaft's base radius at height h above the lake (before rock relief).
 * @param {number} h
 * @returns {number}
 */
export function shaftRadiusAt(h) {
    const S = SHAFT;
    let r = S.R_CHAMBER + ((S.R_SHAFT - S.R_CHAMBER) * smooth01((h - S.H_TAPER_LO) / (S.H_TAPER_HI - S.H_TAPER_LO)));
    // The throat narrows late and fast (an ease-in): the climb meets it as a closing neck.
    const t = Math.min(1, Math.max(0, (h - S.H_THROAT_LO) / (S.H_THROAT_TOP - S.H_THROAT_LO)));
    r += (S.R_THROAT - S.R_SHAFT) * (t * t * (3 - (2 * t)));
    // The lip: above the throat the rock turns outward, a crater rim round the vent.
    const lip = Math.min(1, Math.max(0, (h - S.H_THROAT_TOP) / (S.H_TOP - S.H_THROAT_TOP)));
    r += (S.R_LIP - S.R_THROAT) * lip * lip;
    return r;
}

/**
 * The cave mouth's half-angle at height h (0 above its crown): the wall is open toward the vista
 * while |azimuth| < this, so the opening frame keeps its lake running to the far shore.
 * @param {number} h
 * @returns {number} radians
 */
export function shaftMouthHalfAngle(h) {
    const S = SHAFT;
    if (h >= S.MOUTH_CROWN_H) return 0;
    const k = Math.max(0, h) / S.MOUTH_CROWN_H;
    return S.MOUTH_HALF_ANGLE * Math.sqrt(Math.max(0, 1 - (k * k)));
}

/**
 * Plan the shaft in the chapter group's local frame.
 * @param {object} opts
 * @param {{x:number, z:number}} opts.axis local XZ of the shaft's axis
 * @param {number} opts.lakeY local Y of the lava lake
 * @param {{x:number, z:number}} opts.vista unit XZ toward the opening frame's lake vista
 *   (azimuth 0); screen-right while climbing is its perpendicular (vista.z, -vista.x) negated —
 *   passed explicitly as `right` so the frame is the chapter's own staging basis.
 * @param {{x:number, z:number}} opts.right unit XZ, azimuth +90 deg
 */
export function planEarthCoreShaft({
    axis, lakeY, vista, right, seed = 1743,
}) {
    const dirAt = (azimuth) => ({
        x: (Math.cos(azimuth) * vista.x) + (Math.sin(azimuth) * right.x),
        z: (Math.cos(azimuth) * vista.z) + (Math.sin(azimuth) * right.z),
    });
    // Strata: seeded thicknesses, ledge depths and bands, shared by the geometry and the plan.
    const random = basaltRandom(seed);
    const strata = [];
    let base = SHAFT.H_BOTTOM - 4;
    while (base < SHAFT.H_TOP + 20) {
        const thickness = 9 + (random() * 7);
        const ledge = 2.2 + (random() * 3.4);
        // 0 = colonnade (vertical jointing), 1 = tuff (rough, warm), 2 = obsidian (dark glassy)
        let band = 2;
        if (random() < 0.45) band = 0;
        else if (random() < 0.6) band = 1;
        strata.push({
            base,
            thickness,
            ledge,
            band,
            columns: 40 + Math.floor(random() * 26),
            hash: random(),
        });
        base += thickness;
    }
    const falls = SHAFT_FALLS.map((f) => {
        const d = dirAt(f.azimuth);
        const r = shaftRadiusAt(f.lipH) - 3.2; // the lip stands proud of the wall (the spout)
        return {
            ...f,
            dir: d,
            inward: { x: -d.x, z: -d.z },
            lip: { x: axis.x + (d.x * r), y: lakeY + f.lipH, z: axis.z + (d.z * r) },
            // Into the lake (with a little under it, hidden by the opaque lava) — or, for the
            // throat's slim falls, a curtain that breaks into spray before it reaches the climb.
            drop: f.length ?? (f.lipH + 1.5),
            breaks: Boolean(f.length),
        };
    });
    return {
        axis, lakeY, vista, right, dirAt, strata, falls,
    };
}

/** Which stratum a (warped) height falls in. */
function stratumAt(strata, hw) {
    let lo = 0;
    let hi = strata.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (strata[mid].base <= hw) lo = mid;
        else hi = mid - 1;
    }
    return strata[lo];
}

const _rock = new ImprovedNoise();

/**
 * The wall's mesh: an indexed (azimuth x height) grid displaced into rock. Attributes:
 *   position, normal (facing the axis), aStrata = (stratum hash, fraction up the stratum,
 *   ledge amount 0..1, band 0/0.5/1).
 * Triangles inside the cave mouth are dropped (a ragged arch toward the vista).
 * @param {object} plan from planEarthCoreShaft
 * @returns {THREE.BufferGeometry}
 */
export function buildShaftWallGeometry(plan) {
    const {
        axis, lakeY, strata, falls,
    } = plan;
    const cols = SHAFT.COLS;
    const rows = Math.round((SHAFT.H_TOP - SHAFT.H_BOTTOM) / SHAFT.ROW_STEP) + 1;
    const count = cols * rows;
    const positions = new Float32Array(count * 3);
    const strataAttr = new Float32Array(count * 4);
    const open = new Uint8Array(count);
    const fallAz = falls.map((f) => f.azimuth);

    for (let j = 0; j < rows; j += 1) {
        const h = SHAFT.H_BOTTOM + (j * SHAFT.ROW_STEP);
        const baseR = shaftRadiusAt(h);
        const mouth = shaftMouthHalfAngle(h);
        for (let i = 0; i < cols; i += 1) {
            const azimuth = ((i / cols) * Math.PI * 2) - Math.PI;
            const d = plan.dirAt(azimuth);
            const cx = Math.cos(azimuth);
            const sz = Math.sin(azimuth);
            // Rock relief: broad lumps and mid bulges, read on the unit circle so the ring closes.
            const lumps = _rock.noise(cx * 1.25, (h / 38) + 3.1, sz * 1.25) * 6.5
                + (_rock.noise((cx * 3.4) + 7.7, h / 13, sz * 3.4) * 2.4);
            // Strata undulate a few units round the shaft, so no ledge is a level ring.
            const warp = _rock.noise(cx * 2.1, 0.37, (sz * 2.1) + 11.0) * 3.2;
            const hw = h + warp;
            const st = stratumAt(strata, hw);
            const f = Math.min(1, Math.max(0, (hw - st.base) / st.thickness));
            // Each ledge is BROKEN along its length: only some reaches of it stand out.
            const ledgeRun = smooth01((_rock.noise((cx * 2.6) + (st.hash * 17), st.hash * 31, sz * 2.6) + 0.15) / 0.5);
            const ledgeAmt = smooth01((f - 0.78) / 0.18) * ledgeRun;
            const ledge = st.ledge * ledgeAmt;
            // The face below a ledge leans back a little as it rises.
            const lean = 1.4 * f;
            // Colonnade bands: vertical jointing, a V-groove between flat-faced columns.
            let col = 0;
            if (st.band === 0) {
                const u = ((azimuth / (Math.PI * 2)) * st.columns) + (st.hash * 5.3);
                const tri = Math.abs((u - Math.floor(u)) - 0.5) * 2;
                col = (1 - tri) * 1.5;
            } else if (st.band === 1) {
                col = _rock.noise(cx * 9.0, h / 3.2, sz * 9.0) * 1.1; // rough tuff
            }
            const fine = _rock.noise((cx * 15) + 2.2, h / 4.0, sz * 15) * 0.55;
            // Spouts: the lip juts out where each fall leaves the wall, with a channel cut below it.
            let spout = 0;
            for (let k = 0; k < falls.length; k += 1) {
                const arc = angleDelta(azimuth, fallAz[k]) * baseR;
                const across = Math.exp(-((arc / 5.5) ** 2));
                const dh = h - falls[k].lipH;
                spout += 7.0 * across * Math.exp(-((dh / 3.2) ** 2));
                spout -= 2.6 * Math.exp(-((arc / 3.2) ** 2)) * smooth01(-dh / 8) * smooth01((dh + falls[k].lipH) / 6);
            }
            const r = baseR + lumps + lean - ledge + col + fine - spout;
            const v = (j * cols) + i;
            positions[v * 3] = axis.x + (d.x * r);
            positions[(v * 3) + 1] = lakeY + h;
            positions[(v * 3) + 2] = axis.z + (d.z * r);
            strataAttr[v * 4] = st.hash;
            strataAttr[(v * 4) + 1] = f;
            strataAttr[(v * 4) + 2] = ledgeAmt;
            strataAttr[(v * 4) + 3] = st.band * 0.5;
            // The cave mouth, ragged.
            if (mouth > 0) {
                const jag = _rock.noise(azimuth * 3.0, h / 7, 5.5) * 7 * DEG;
                if (Math.abs(azimuth) < mouth + jag) open[v] = 1;
            }
        }
    }

    const indices = [];
    for (let j = 0; j < rows - 1; j += 1) {
        for (let i = 0; i < cols; i += 1) {
            const a = (j * cols) + i;
            const b = (j * cols) + ((i + 1) % cols);
            const c = ((j + 1) * cols) + i;
            const e = ((j + 1) * cols) + ((i + 1) % cols);
            if (open[a] || open[b] || open[c] || open[e]) continue;
            indices.push(a, c, b, b, c, e);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aStrata', new THREE.BufferAttribute(strataAttr, 4));
    geometry.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    // The wall is seen from INSIDE: its normals must face the axis. Check the winding against the
    // geometry itself rather than trusting the basis' handedness, and flip it if it came out wrong.
    const nrm = geometry.getAttribute('normal');
    let facing = 0;
    for (let v = 0; v < count; v += 97) {
        const px = positions[v * 3] - axis.x;
        const pz = positions[(v * 3) + 2] - axis.z;
        facing += -(nrm.getX(v) * px) - (nrm.getZ(v) * pz);
    }
    if (facing < 0) {
        const idx = geometry.index.array;
        for (let t = 0; t < idx.length; t += 3) {
            const tmp = idx[t + 1];
            idx[t + 1] = idx[t + 2];
            idx[t + 2] = tmp;
        }
        geometry.index.needsUpdate = true;
        geometry.computeVertexNormals();
    }
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    geometry.userData.shaftFacing = facing;
    return geometry;
}

/**
 * The wall's material. Unlit node material that lights itself (see the file header).
 * @param {object} u chapter uniforms: uTime, uPulseIntensity, uSeam, uOpacity, uDescent
 * @param {object} plan from planEarthCoreShaft
 */
export function createShaftWallMaterial(u, plan) {
    const n3 = earthCoreNoise01();
    const { lakeY, falls } = plan;
    const vP = varying(attribute('position', 'vec3'), 'vShaftP');
    const vN = varying(normalLocal, 'vShaftN');
    const vS = varying(attribute('aStrata', 'vec4'), 'vShaftS');

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = Fn(() => {
        const P = vP.toVar();
        const N = normalize(vN).toVar();
        const S = vS.toVar();
        const h = P.y.sub(lakeY).toVar();
        const hPos = max(h, 0.0).toVar();

        // ── Rock: near-black charred basalt; the bands separate by value and a little hue. A fine
        // grain multiplies everything that is lit, so the light lands on a broken surface. ──
        const band = S.w;
        const basalt = vec3(0.016, 0.014, 0.017);
        const tuff = vec3(0.034, 0.021, 0.014);
        const obsidian = vec3(0.008, 0.009, 0.014);
        const bandCol = mix(mix(basalt, tuff, smoothstep(0.25, 0.3, band)), obsidian, smoothstep(0.75, 0.8, band));
        const plates = n3(P.mul(0.06)).toVar();
        const grain = n3(P.mul(2.3)).toVar();
        // A fine grit and broad plates (a coarser grain read as sponge from 50 u away).
        const rough = mix(float(0.82), float(1.18), grain).mul(mix(float(0.72), float(1.15), plates)).toVar();
        const bandValue = S.x.mul(0.6).add(0.7);
        const albedo = bandCol.mul(rough).mul(bandValue);
        // How much of the fire each band gives back: pale tuff, grey basalt, glassy dark obsidian.
        const bandReflect = mix(mix(float(0.85), float(1.3), smoothstep(0.25, 0.3, band)), float(0.5), smoothstep(0.75, 0.8, band))
            .mul(S.x.mul(0.3).add(0.85));

        // ── THE KEY: the lake, below. Only what looks DOWN at it catches it — the ledges'
        // undersides — so looking up the shaft the strata are rings of firelight on dark rock. ──
        const down = clamp(N.y.negate(), 0.0, 1.0);
        const reach = exp(hPos.div(52.0).negate()).add(exp(hPos.div(190.0).negate()).mul(0.16)).toVar();
        const breath = magmaSurgeTSL(u.uTime).mul(0.2).add(0.8);
        const underside = pow(down, 2.2);
        // The lip of each ledge: a thin bright line where the underside turns up into the face.
        const f = S.y;
        const lipLine = smoothstep(0.90, 0.955, f).mul(oneMinus(smoothstep(0.955, 0.995, f))).mul(S.z).toVar();
        const lakeLight = vec3(0.42, 0.13, 0.036).mul(reach).mul(breath)
            .mul(underside.mul(1.5).add(lipLine.mul(1.1)).add(0.025))
            .mul(rough)
            .mul(bandReflect);
        const lit = albedo.mul(0.35).add(lakeLight).toVar();

        // ── The falls light the rock round them (a warm pool behind each, strongest near) ──
        const fallFade = oneMinus(u.uSeam.mul(0.92));
        const flicker = sin(u.uTime.mul(2.3)).mul(0.06).add(sin(u.uTime.mul(5.1)).mul(0.04)).add(1.0);
        const fallLight = vec3(0.0).toVar();
        falls.forEach((fall) => {
            const mid = vec2(fall.lip.x + (fall.inward.x * FALL_THROW * 0.45), fall.lip.z + (fall.inward.z * FALL_THROW * 0.45));
            const off = vec2(P.x, P.z).sub(mid);
            const d2 = dot(off, off);
            const along = smoothstep(float(fall.lip.y + 6.0), float(fall.lip.y - 4.0), P.y)
                .mul(smoothstep(float(lakeY - 2.0), float(lakeY + 12.0), P.y));
            const toFall = off.negate().div(max(sqrt(d2), 1e-3));
            const facing = clamp(dot(N.xz, toFall).mul(0.7).add(0.3), 0.0, 1.0);
            const pool = exp(d2.div(70.0).negate()).mul(0.75).add(exp(d2.div(420.0).negate()).mul(0.12));
            fallLight.addAssign(vec3(1.0, 0.36, 0.08).mul(pool).mul(along).mul(facing)
                .mul(fall.width / 5.0));
        });
        lit.addAssign(fallLight.mul(rough).mul(fallFade).mul(flicker));

        // ── Heat: thin cracks that burn where the lake does not reach, the ledge joints, and the
        // vent's throat, which glows from within like a maw. The quench cools them. ──
        // ridged3 over 3 octaves peaks at 0.875: normalised, so the thresholds mean what they say.
        const crackP = vec3(P.x, P.y.mul(0.55), P.z).mul(0.085);
        const veins = ridged3(crackP.add(vec3(0.0, u.uTime.mul(0.01), 0.0)), 3, n3).div(0.875).toVar();
        const core = smoothstep(0.905, 0.985, veins);
        const halo = smoothstep(0.80, 0.95, veins);
        const throat = smoothstep(90.0, 132.0, h).toVar();
        const heat = exp(hPos.div(36.0).negate()).mul(0.4).add(0.16).add(throat.mul(0.55));
        const darkGate = oneMinus(clamp(reach.mul(1.6), 0.0, 0.85));
        const crackBreath = sin(u.uTime.mul(0.8).add(veins.mul(11.0))).mul(0.22).add(0.78);
        const joint = lipLine.mul(smoothstep(0.35, 0.75, n3(P.mul(0.045).add(vec3(3.1, 0.0, 7.7)))));
        const hot = vec3(1.0, 0.44, 0.12).mul(core).mul(1.3)
            .add(vec3(0.75, 0.16, 0.04).mul(halo).mul(0.12))
            .add(vec3(1.0, 0.36, 0.08).mul(joint).mul(0.45))
            // The throat's own ember glow, broken by the rock's grain.
            .add(vec3(0.20, 0.04, 0.010).mul(throat).mul(halo.mul(0.7).add(0.3)).mul(rough));
        const quenched = vec3(0.26, 0.46, 0.52).mul(core.add(joint.mul(0.4))).mul(0.3);
        const crackLight = mix(hot, quenched, smoothstep(0.2, 0.9, u.uSeam))
            .mul(heat).mul(mix(darkGate, float(1.0), throat)).mul(crackBreath)
            .mul(u.uPulseIntensity.mul(0.25).add(1.0));
        lit.addAssign(crackLight);

        // A warm rim where an edge turns away (silhouettes at the cave mouth and the ledges).
        const rimView = normalize(modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz.sub(P));
        const rim = pow(oneMinus(clamp(abs(dot(N, rimView)), 0.0, 1.0)), 5.0);
        lit.addAssign(vec3(0.22, 0.065, 0.018).mul(rim).mul(reach.mul(0.8).add(0.12)).mul(0.5));

        return min(lit, vec3(1.1, 0.95, 0.8));
    })();
    // Opaque: early-Z for the largest surface in the chapter. The manager's crossfade reaches it
    // through uOpacity (an authored-opaque uniform target), so it is never forced transparent.
    material.uniforms = { uOpacity: u.uOpacity };
    material.side = THREE.FrontSide;
    material.depthWrite = true;
    material.userData.emitsBloom = true;
    return material;
}

/**
 * The wall mesh.
 * @param {object} u chapter uniforms
 * @param {object} plan from planEarthCoreShaft
 */
export function createShaftWall(u, plan) {
    const geometry = buildShaftWallGeometry(plan);
    const material = createShaftWallMaterial(u, plan);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'earth-core-shaft-wall';
    mesh.frustumCulled = false;
    return mesh;
}

/**
 * The lava falls: ONE instanced ribbon draw. Each ribbon leaves its spout on a ballistic curve
 * (thrown a few units inward, accelerating down), turns about its own path to face the camera,
 * and carries a white-hot core in a body of streaks drawn out by its speed, with a halo of its
 * own light (after Cinder Drift's falls). Additive; fades and cools with the quench (uSeam).
 * @param {object} u chapter uniforms (uTime, uSeam, uOpacity, uPulseIntensity)
 * @param {object} plan from planEarthCoreShaft
 */
export function createShaftFalls(u, plan) {
    const { falls } = plan;
    // A strip: (FALL_SEGMENTS + 1) rows x 2 across; uv.x across 0..1, uv.y along 0 (lip)..1 (foot).
    const strip = new THREE.PlaneGeometry(1, 1, 1, FALL_SEGMENTS);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = strip.index;
    geometry.setAttribute('position', strip.getAttribute('position'));
    geometry.setAttribute('uv', strip.getAttribute('uv'));
    geometry.instanceCount = falls.length;
    const aA = new Float32Array(falls.length * 4);
    const aB = new Float32Array(falls.length * 4);
    falls.forEach((f, i) => {
        aA.set([f.lip.x, f.lip.y, f.lip.z, f.width], i * 4);
        // w: the seed, +10 for a fall that breaks into spray before the lake (read back by step).
        aB.set([f.inward.x, f.inward.z, f.drop, f.seed + (f.breaks ? 10 : 0)], i * 4);
    });
    geometry.setAttribute('aFallA', new THREE.InstancedBufferAttribute(aA, 4));
    geometry.setAttribute('aFallB', new THREE.InstancedBufferAttribute(aB, 4));
    strip.dispose();
    // Bounds for instruments (the visibility tests project this box): the whole set of falls.
    const box = new THREE.Box3();
    falls.forEach((f) => {
        box.expandByPoint(new THREE.Vector3(f.lip.x, f.lip.y, f.lip.z));
        box.expandByPoint(new THREE.Vector3(
            f.lip.x + (f.inward.x * FALL_THROW),
            f.lip.y - f.drop,
            f.lip.z + (f.inward.z * FALL_THROW),
        ));
    });
    geometry.boundingBox = box;
    geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());

    const A = attribute('aFallA', 'vec4');
    const B = attribute('aFallB', 'vec4');
    // PlaneGeometry(1,1) rows: v = 1 at the top (+y) -> the lip is v = 1. Flip so s = 0 at the lip.
    const s = oneMinus(uv().y);
    const inward = vec3(B.x, 0.0, B.y);
    const drop = B.z;
    // Thrown inward as it leaves the lip (x ~ sqrt(s): constant horizontal speed while the drop
    // accelerates), a slow sway along its length so no fall is a ruled line.
    const sway = sin(s.mul(5.0).add(u.uTime.mul(0.7)).add(B.w.mul(20.0))).mul(0.7).mul(s);
    const centre = A.xyz
        .add(inward.mul(sqrt(s.add(0.0004)).mul(FALL_THROW).add(sway)))
        .add(vec3(0.0, drop.mul(s).negate(), 0.0));
    const tangent = normalize(inward.mul(float(FALL_THROW * 0.5).div(sqrt(s.add(0.01)))).add(vec3(0.0, drop.negate(), 0.0)));
    const camLocal = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz;
    const side = normalize(cross(tangent, normalize(camLocal.sub(centre))));
    // It spills wide over the lip, narrows as it speeds up, then spreads a little as it drops.
    const spill = oneMinus(smoothstep(0.0, 0.18, s)).mul(0.6);
    const widthNow = A.w.mul(s.mul(0.35).add(0.8).add(spill)).mul(FALL_HALO);
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = centre.add(side.mul(uv().x.sub(0.5).mul(widthNow)));

    const vFall = varying(vec3(s, B.w, length(camLocal.sub(centre))), 'vShaftFall');
    // Through the steam: the fall draws after the quench's shell and dims by its fog.
    const vVeil = varying(u.uVeil ? earthCoreVeilTransmission(u.uVeil, centre) : float(1), 'vShaftFallVeil');
    material.colorNode = Fn(() => {
        const along = clamp(vFall.x, 0.0, 1.0);
        const breaks = step(5.0, vFall.y);
        const seed = fract(vFall.y);
        // A fall that passes near the lens would fill a corner of the frame with one blurred wedge
        // of light: it thins out within ~30 u of the eye.
        const nearFade = smoothstep(10.0, 34.0, vFall.z);
        // Clamped: under MSAA a thin far ribbon's uv is extrapolated past 0..1 (the ley-line trap).
        const across = clamp(uv().x, 0.0, 1.0).sub(0.5).mul(FALL_HALO); // +-0.5 = the lava's edges
        // Time since leaving the lip: the texture stretches as the lava speeds up.
        const tFall = sqrt(along);
        const flow = u.uTime.mul(0.55);
        const n1 = noise2(vec2(across.mul(1.6).add(seed.mul(13.0)), tFall.mul(9.0).sub(flow.mul(2.2))));
        const n2 = noise2(vec2(across.mul(5.5).add(n1.mul(0.7)).add(seed.mul(7.0)), tFall.mul(26.0).sub(flow.mul(5.0))));
        const core = oneMinus(abs(across).mul(2.0));
        // Faded in over the lip's spill, so the fall has no bright comet's head from below.
        const lipIn = smoothstep(0.0, 0.16, along);
        // The throat's curtains break into spray over their last half; the big falls meet the lake.
        const footOut = oneMinus(smoothstep(mix(float(0.90), float(0.45), breaks), 1.0, along));
        const body = smoothstep(0.0, 0.22, core.add(n2.sub(0.5).mul(1.1)).sub(along.mul(0.18)))
            .mul(lipIn).mul(footOut);
        // Hot at the core and at the lip; streaks of cooler skin; it cools a little as it falls.
        const temp = float(0.52).add(max(core, 0.0).mul(0.42)).add(n1.sub(0.5).mul(1.0)).add(n2.sub(0.5).mul(0.45))
            .sub(along.mul(0.2));
        const c0 = vec3(0.16, 0.012, 0.003);
        const c1 = vec3(0.78, 0.13, 0.015);
        const c2 = vec3(1.0, 0.42, 0.07);
        const c3 = vec3(1.0, 0.74, 0.40);
        let lava = mix(c0, c1, smoothstep(0.15, 0.55, temp));
        lava = mix(lava, c2, smoothstep(0.55, 0.95, temp));
        lava = mix(lava, c3, smoothstep(0.95, 1.30, temp));
        // Its own light in the air round it.
        const out = max(abs(across).sub(0.42), 0.0);
        const haloLight = exp(out.mul(-4.2)).mul(oneMinus(smoothstep(1.0, FALL_HALO * 0.5, abs(across))))
            .mul(lipIn).mul(footOut);
        const glow = vec3(0.80, 0.20, 0.04).mul(haloLight).mul(0.16);
        const pulse = u.uPulseIntensity.mul(0.2).add(1.0);
        // The quench: the falls dim and redden as the steam comes, and are gone before the seam.
        const quench = oneMinus(smoothstep(0.0, 0.85, u.uSeam));
        const lit = lava.mul(body).add(glow.mul(oneMinus(body))).mul(pulse).mul(quench)
            .mul(nearFade)
            .mul(vVeil)
            .mul(u.uOpacity);
        return min(lit, vec3(1.15, 1.0, 0.85));
    })();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.forceSinglePass = true;
    // Additive light must not be fogged toward a bright fog colour (it would paint the halo quad
    // in the fog's colour); the quench fades it instead.
    material.fog = false;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity: u.uOpacity };

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'earth-core-shaft-falls';
    mesh.frustumCulled = false;
    mesh.renderOrder = EARTH_CORE_THROUGH_STEAM_ORDER;
    return mesh;
}
