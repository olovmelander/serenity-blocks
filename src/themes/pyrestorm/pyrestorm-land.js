/**
 * Pyrestorm — the land: a polar fan of the plain round the eye (fine at the eye's feet, coarse at
 * the horizon), the volcano's own finer mesh rising out of it, and the material both share.
 *
 * The rock is near black (fresh basalt, oxidised tephra on the cones, ash on the upper cone) and is
 * lit only by what burns: the lava's glow on the land around each channel, the crater's fountain,
 * the lightning, a little of the night sky. The lava itself is read from the baked fields: a
 * channel's distance field gives a crisp edge at any range, a flow map drags crust along its
 * heading (rafts and plates over an incandescent core, cracks glowing on the levees), and its
 * temperature runs a blackbody ramp. A level-up's surge, a hard drop's tremor, the bombs' splashes
 * and the bolts' strikes all land here.
 *
 * Heights are evaluated once per vertex on the CPU in slices (prepare); normals and the hollows'
 * shade come from the grid's own neighbours.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    abs,
    atan,
    attribute,
    clamp,
    dFdx,
    dFdy,
    dot,
    exp,
    float,
    fract,
    fwidth,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    step,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    DEG, EYE, TAU, VOLCANO, landHeight, plainHeight, satelliteHeight, smooth, volcanoHeight,
} from './pyrestorm-core.js';
import {
    BLUE_FIRE, CRUST, FLANK_VENTS, aerial, fireLightAt, lavaAt, lightningAt, pyBlackbody,
} from './pyrestorm-tsl.js';

/** The crust tile's span (m): CRUST.cells plates across, each about thirty metres. */
export const CRUST_TILE = 480;

/** The fan's bearings (degrees right of the view axis) and reach (m). */
export const FAN = Object.freeze({
    from: -58, to: 52, near: 2.5, far: 82000,
});
/** Where a perfect clear's storm light falls from: above, from the anvil's side (unit, toward the light). */
const STORM_FROM = (() => {
    const v = [0.42, 0.82, -0.38];
    const l = Math.hypot(v[0], v[1], v[2]);
    return Object.freeze(v.map((c) => c / l));
})();
/** The curvature of the earth (with refraction) drops far land: y −= r² × this. */
export const EARTH_DROP = 1 / (2 * 6371000 * 1.15);

/** A fan vertex (bearing i of cols, ring j of rows). */
function fanPoint(i, j, cols, rows, out) {
    const th = (FAN.from + ((FAN.to - FAN.from) * i) / cols) * DEG;
    const r = FAN.near * (FAN.far / FAN.near) ** (j / rows);
    out[0] = EYE.x + Math.sin(th) * r;
    out[2] = EYE.z - Math.cos(th) * r;
    out[1] = plainHeight(out[0], out[2]) - r * r * EARTH_DROP;
    return out;
}

/** The volcano's mesh rings: radius of ring j (dense round the summit). */
const coneRadius = (j, rings) => VOLCANO.radius * 0.998 * (j / rings) ** 1.35;

/**
 * Grid heights, slice by slice (a generator: the caller yields to the page between slices).
 * Returns positions + normals + shade for both meshes.
 *
 * It yields after every row (of the fan, of the cone, of each grid's normals), and the caller's
 * clock decides where a slice ends (pyrestorm-world.js prepareData): a step is a row, never more.
 * Yielding every 24 fan rows and 20 cone rings, with the normals of a grid in one step, a step ran
 * up to 15 ms in node at Extreme, and a slice ran on that long past its budget (2026-10-31).
 */
export function* landSteps(tier) {
    const { fanCols } = tier;
    const { fanRows } = tier;
    const fanCount = (fanCols + 1) * (fanRows + 1);
    const fan = new Float32Array(fanCount * 3);
    const p = [0, 0, 0];
    for (let j = 0; j <= fanRows; j++) {
        for (let i = 0; i <= fanCols; i++) {
            fanPoint(i, j, fanCols, fanRows, p);
            const o = (j * (fanCols + 1) + i) * 3;
            fan[o] = p[0];
            fan[o + 1] = p[1];
            fan[o + 2] = p[2];
        }
        yield 'fan';
    }
    const rings = tier.coneRings;
    const segs = tier.coneSegs;
    const coneCount = (rings + 1) * (segs + 1);
    const cone = new Float32Array(coneCount * 3);
    for (let j = 0; j <= rings; j++) {
        const r = coneRadius(j, rings);
        for (let i = 0; i <= segs; i++) {
            const a = (i / segs) * Math.PI * 2;
            const x = VOLCANO.x + Math.cos(a) * r;
            const z = VOLCANO.z + Math.sin(a) * r;
            // Skirt: the cone's last rings dip under the plain, which covers the seam.
            const skirt = 9 * smooth(VOLCANO.radius * 0.9, VOLCANO.radius * 0.995, r);
            const o = (j * (segs + 1) + i) * 3;
            cone[o] = x;
            cone[o + 1] = plainHeight(x, z) + volcanoHeight(x, z) + satelliteHeight(x, z) - skirt;
            cone[o + 2] = z;
        }
        yield 'cone';
    }
    const fanNS = yield* gridNormalsSteps(fan, fanCols + 1, fanRows + 1, false);
    const coneNS = yield* gridNormalsSteps(cone, segs + 1, rings + 1, true);
    return {
        fan: {
            positions: fan, normals: fanNS.normals, shade: fanNS.shade, cols: fanCols, rows: fanRows,
        },
        cone: {
            positions: cone, normals: coneNS.normals, shade: coneNS.shade, cols: segs, rows: rings,
        },
    };
}

/**
 * Normals and a hollow/crest shade from a grid's neighbours. `wrapI` joins the last column to
 * the first (the cone's rings close). A generator: it yields after every row (landSteps).
 * @returns {Generator<string, { normals: Float32Array, shade: Float32Array }>}
 */
function* gridNormalsSteps(pos, nx, ny, wrapI) {
    const n = nx * ny;
    const normals = new Float32Array(n * 3);
    const shade = new Float32Array(n);
    const at = (i, j, c) => pos[(j * nx + i) * 3 + c];
    for (let j = 0; j < ny; j++) {
        const j0 = Math.max(0, j - 1);
        const j1 = Math.min(ny - 1, j + 1);
        for (let i = 0; i < nx; i++) {
            let i0 = i - 1;
            let i1 = i + 1;
            if (wrapI) {
                if (i0 < 0) i0 = nx - 2;
                if (i1 > nx - 1) i1 = 1;
            } else {
                i0 = Math.max(0, i0);
                i1 = Math.min(nx - 1, i1);
            }
            const ax = at(i1, j, 0) - at(i0, j, 0);
            const ay = at(i1, j, 1) - at(i0, j, 1);
            const az = at(i1, j, 2) - at(i0, j, 2);
            const bx = at(i, j1, 0) - at(i, j0, 0);
            const by = at(i, j1, 1) - at(i, j0, 1);
            const bz = at(i, j1, 2) - at(i, j0, 2);
            let cx = ay * bz - az * by;
            let cy = az * bx - ax * bz;
            let cz = ax * by - ay * bx;
            if (cy < 0) {
                cx = -cx;
                cy = -cy;
                cz = -cz;
            }
            const l = Math.hypot(cx, cy, cz) || 1;
            const o = (j * nx + i) * 3;
            normals[o] = cx / l;
            normals[o + 1] = cy / l;
            normals[o + 2] = cz / l;
            // Hollows darker, crests lighter: the height against its neighbours' mean, per metre of spacing.
            const mean = (at(i0, j, 1) + at(i1, j, 1) + at(i, j0, 1) + at(i, j1, 1)) * 0.25;
            const span = Math.max(1, (Math.hypot(ax, az) + Math.hypot(bx, bz)) * 0.25);
            shade[j * nx + i] = Math.max(0, Math.min(1, 0.62 + ((at(i, j, 1) - mean) / span) * 2.2));
        }
        yield 'normals';
    }
    return { normals, shade };
}

function gridGeometry(data) {
    const { cols, rows } = data;
    const nx = cols + 1;
    const index = new Uint32Array(cols * rows * 6);
    let k = 0;
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            const a = j * nx + i;
            const b = a + 1;
            const c = a + nx;
            const d = c + 1;
            // Counter-clockwise seen from above (the ground faces up).
            index[k++] = a;
            index[k++] = b;
            index[k++] = c;
            index[k++] = b;
            index[k++] = d;
            index[k++] = c;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute('aShade', new THREE.BufferAttribute(data.shade, 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
    return geometry;
}

/** The land's material (both meshes). */
export function createLandMaterial(u, t, tier) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PyrestormLand';
    material.fog = false;
    const nrm = attribute('normal', 'vec3');
    const shadeAttr = attribute('aShade', 'float');
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const N = normalize(nrm).toVar();
        const toEye = length(P.sub(u.eye)).toVar();
        // The land's grain where its grid cannot hold it. On the cone: gullies and ribs running
        // down the fall line (noise read round the axis and far out along it), which shade the
        // rock and turn its face a little to one side or the other, so a raking light finds them.
        const axisOff = P.xz.sub(vec2(VOLCANO.x, VOLCANO.z));
        const round = atan(axisOff.y, axisOff.x).div(TAU);
        const outAxis = length(axisOff);
        // (One read: two of the noise's bands, eighty broad ribs round the cone and a finer set.)
        const ribRead = texture(t.noise, vec2(round.mul(5.0), outAxis.div(9000.0)));
        const ribs = ribRead.g.mul(0.62).add(ribRead.b.mul(0.38)).toVar();
        const coneK = smoothstep(620.0, 1500.0, P.y).mul(float(1.0).sub(smoothstep(VOLCANO.radius * 0.8, VOLCANO.radius, outAxis))).toVar();
        const sideways = normalize(vec3(axisOff.y.negate(), 0.0, axisOff.x).add(vec3(1e-4, 0.0, 0.0)));
        N.assign(normalize(N.add(sideways.mul(ribs.sub(0.5)).mul(coneK).mul(0.75))));
        // On the eye's own slope: the tephra's lumps and hollows (two scales of noise as a height).
        If(toEye.lessThan(900.0), () => {
            const nearB = float(1.0).sub(smoothstep(220.0, 900.0, toEye));
            // (One read a tap: two bands of the noise, lumps a metre and a half across and half that.)
            const lumps = (p) => {
                const read = texture(t.noise, p.div(24.0)).level(0.0);
                return read.g.add(read.b.mul(0.5));
            };
            const h0 = lumps(P.xz);
            const hx = lumps(P.xz.add(vec2(1.1, 0.0)));
            const hz = lumps(P.xz.add(vec2(0.0, 1.1)));
            N.assign(normalize(N.add(vec3(h0.sub(hx), 0.0, h0.sub(hz)).mul(nearB.mul(2.6)))));
        });
        const lava0 = lavaAt(t, P.xz);
        // The eruption's phase swells the channels over their banks, or lets them shrink back.
        const lava = { ...lava0, hw: lava0.hw.mul(u.lavaFlux).toVar() };

        // ── The rock ──
        const n1 = texture(t.noise, P.xz.div(900.0)).r;
        const n2 = texture(t.noise, P.xz.div(170.0)).g;
        const fine = tier.landDetail > 1 ? texture(t.noise, P.xz.div(26.0)).b : float(0.5);
        const basalt = vec3(0.024, 0.023, 0.026);
        const tephra = vec3(0.062, 0.036, 0.028);
        const ash = vec3(0.046, 0.043, 0.045);
        const cone = smoothstep(800.0, 2600.0, P.y);
        const rock = mix(basalt, tephra, smoothstep(0.42, 0.78, n1.mul(0.7).add(n2.mul(0.3)))).toVar();
        rock.assign(mix(rock, ash, cone.mul(0.7)));
        // Steep faces show darker, fresher rock; flats gather ash.
        rock.mulAssign(mix(float(0.75), float(1.12), smoothstep(0.55, 0.92, N.y)));
        rock.mulAssign(fine.mul(0.5).add(0.75));
        rock.mulAssign(mix(float(1.0), ribs.mul(1.15).add(0.42), coneK));
        // Near the eye: tephra grain.
        const nearK = float(1.0).sub(smoothstep(60.0, 700.0, toEye));
        rock.mulAssign(mix(float(1.0), texture(t.noise, P.xz.div(2.6)).a.mul(0.7).add(0.65), nearK));
        const shade = shadeAttr.mul(0.7).add(0.3);

        // ── Light on it ──
        const sky = u.ambient.mul(N.y.mul(0.45).add(0.55)).mul(1.8);
        // The lava's own light on the land beside it (and the country's wide glow).
        const glow = u.fireColour.mul(lava.glow.mul(lava.glow).mul(1.5).add(lava.glow.mul(0.45)).add(lava.wide.mul(0.14)))
            .mul(N.y.mul(0.3).add(0.7)).mul(u.activity);
        // Low fire light from the plain in front rims the near crags and boulders.
        // The rivers below throw their light up the eye's own slope: a warm rim on the brow and its
        // boulders (the near ground reads as land, not as black).
        const nearRim = float(1.0).sub(smoothstep(80.0, 1400.0, toEye));
        const front = u.fireColour.mul(clamp(dot(N, normalize(vec3(0.15, 0.32, -1.0))), 0.0, 1.0).mul(0.3).mul(nearRim).mul(u.activity));
        const crater = fireLightAt(u, P, N).mul(u.activity);
        const bolts = lightningAt(u, P, N);
        // The anvil overhead, lit orange from below, lights the land a little from above.
        const bounce = u.fireColour.mul(u.activity.mul(0.008).add(u.charge.mul(0.004))).mul(N.y.max(0.0));
        // The night's key light (the moon's; at dusk the afterglow's) rakes the land: slopes turned
        // to it show, cool against the fire, and the country has a shape even where nothing burns.
        const raked = clamp(dot(N, u.rake), 0.0, 1.0);
        // (Held back on the eye's own slope: the near ground is the picture's dark foot.)
        const key = u.moon.mul(raked.mul(0.9).add(N.y.max(0.0).mul(0.1))).mul(float(1.0).sub(nearK.mul(0.45)));
        // A perfect clear: the whole storm lights at once, and the land stands in its light.
        const storm = u.stormLight.mul(clamp(dot(N, vec3(STORM_FROM[0], STORM_FROM[1], STORM_FROM[2])), 0.0, 1.0).mul(0.8).add(0.2));
        const light = sky.add(glow).add(front).add(crater).add(bounce)
            .add(key)
            .add(storm)
            .mul(shade)
            .add(bolts);
        const col = rock.mul(light).toVar();

        // ── The lava ──
        const sd = lava.dc.sub(lava.hw).toVar();
        const pw = max(fwidth(sd), lava.cell.mul(0.18)).max(0.6).toVar();
        const inside = clamp(float(0.5).sub(sd.div(pw)), 0.0, 1.0).toVar();
        // A channel narrower than a pixel still burns: as a line of its own width's share.
        // (A breakout's toe is let go when it is under a pixel: seen edge-on from the ridge, those
        // drew as short red dashes on the plain.)
        const toeK = smoothstep(3.5, 4.0, lava.kind).toVar();
        const line = clamp(lava.hw.mul(2.0).div(pw), 0.0, 1.0).mul(exp(lava.dc.div(pw).mul(lava.dc.div(pw)).negate()))
            .mul(float(1.0).sub(toeK.mul(0.85)));
        const cover = max(inside, line).toVar();
        const heat = lava.heat.mul(u.lavaHeat).mul(smoothstep(0.02, 0.12, lava.heat)).toVar();
        // Across the channel: 0 on its centreline, 1 at its banks; along it, km from its source.
        const across = lava.dc.div(lava.hw.max(1.0)).toVar();
        const arc = lava.arc.toVar();
        const widePx = lava.hw.mul(2.0).div(pw).toVar();
        // A thread too thin to show its crust burns steady.
        const thin = float(1.0).sub(smoothstep(1.0, 3.0, widePx)).toVar();
        // Nine pixels in ten of the land hold no lava, so the crust below (five texture reads and
        // two blackbody ramps) is worked out only under a channel: a per-pixel branch, which may
        // hold no derivative of its own (SKILL #300). What it reads by one is differentiated here
        // and handed to its reads as explicit gradients: the same mip levels, the same picture.
        const crustUV = P.xz.div(CRUST_TILE).toVar();
        const crustDx = dFdx(crustUV).toVar();
        const crustDy = dFdy(crustUV).toVar();
        // How many plates a pixel spans: where the network is finer than the eye, its average.
        const platesPerPx = length(abs(crustDx).add(abs(crustDy))).mul(CRUST.cells).toVar();
        const streakUV = vec2(arc.mul(0.55).sub(u.flow.mul(0.008)), across.mul(1.3)).toVar();
        const streakDx = dFdx(streakUV).toVar();
        const streakDy = dFdy(streakUV).toVar();
        const emit = vec3(0.0).toVar();
        If(cover.greaterThan(0.0002), () => {
            const { dir } = lava;
            const coreK = float(1.0).sub(smoothstep(0.0, 1.0, across)).toVar();
            // A river wide on screen shows its cross-section: an open core running hot between
            // crusted banks. The core swells and pinches along the river (never a ruler line down
            // its middle), and slugs of hotter lava ride down it. A thread a few pixels wide keeps
            // its even look.
            const section = smoothstep(7.0, 26.0, widePx).toVar();
            const coreW = sin(arc.mul(4.3).sub(u.flow.mul(0.021))).mul(0.16)
                .add(sin(arc.mul(11.7).add(1.7)).mul(0.08)).add(0.62);
            const core = float(1.0).sub(smoothstep(coreW.mul(0.3), coreW, across)).mul(section).toVar();
            const slug = sin(arc.mul(6.1).sub(u.flow.mul(0.16))).mul(0.5).add(0.5)
                .mul(sin(arc.mul(2.3).sub(u.flow.mul(0.05)).add(2.1)).mul(0.5).add(0.5))
                .toVar();
            // Flow lines: the open lava is drawn out in streaks along its run, carried downstream.
            const streak = texture(t.noise, streakUV).grad(streakDx, streakDy).b.toVar();
            // The fissure (kind 3) runs fresh; breakouts (kind 4) are their own, cooler toes.
            const fissure = smoothstep(2.5, 3.0, lava.kind).mul(float(1.0).sub(toeK)).toVar();
            // The crust: plates of a baked network (pyrestorm-bake.js, bakeCrust) dragged downstream
            // by a two-phase flow map (each phase fades out before it has dragged its plates far),
            // faster in the channel's middle than by its banks, so the crust shears as it goes.
            const ph1 = fract(u.flow.mul(0.045));
            const ph2 = fract(u.flow.mul(0.045).add(0.5));
            const wPh = abs(ph1.mul(2.0).sub(1.0)).toVar();
            const drag = dir.mul(coreK.mul(0.55).add(0.45)).mul(0.4).toVar();
            const cA = texture(t.crust, crustUV.sub(drag.mul(ph1))).grad(crustDx, crustDy).toVar();
            const cB = texture(t.crust, crustUV.sub(drag.mul(ph2)).add(vec2(0.37, 0.61))).grad(crustDx, crustDy).toVar();
            const detail = float(1.0).sub(smoothstep(0.2, 0.65, platesPerPx)).toVar();
            // How far the cracks open (R is about 1 at a plate's middle): hotter lava opens more of
            // the crust, the middle of a channel more than its sides; a hard drop's tremor tears it
            // open.
            const open = heat.mul(coreK.mul(0.6).add(0.4)).mul(0.24).add(0.035).add(u.tremor.mul(0.14))
                .add(fissure.mul(0.14))
                .add(core.mul(heat.mul(0.3).add(0.16)).add(core.mul(slug).mul(0.12)))
                .sub(section.mul(float(1.0).sub(core)).mul(0.05))
                .max(0.03)
                .toVar();
            const aa = platesPerPx.mul(0.8).add(0.02).toVar();
            const crackOf = (r) => float(1.0).sub(smoothstep(open.sub(aa), open.add(aa), r));
            const crack = mix(crackOf(cA.r), crackOf(cB.r), wPh);
            const smallK = mix(open.mul(1.7).min(1.0), crack, detail);
            // Rafts: crust four times the plates' size floats in lanes of open lava (it keeps a flow
            // mottled where its plates are finer than a pixel). Same flow map, slower: rafts drag.
            const raftUV = crustUV.mul(0.25).add(vec2(0.19, 0.53));
            const raftDx = crustDx.mul(0.25);
            const raftDy = crustDy.mul(0.25);
            const rA = texture(t.crust, raftUV.sub(drag.mul(ph1).mul(0.2))).grad(raftDx, raftDy).r;
            const rB = texture(t.crust, raftUV.sub(drag.mul(ph2).mul(0.2)).add(vec2(0.41, 0.17))).grad(raftDx, raftDy).r;
            const raftPerPx = platesPerPx.mul(0.25);
            const raftDetail = float(1.0).sub(smoothstep(0.2, 0.65, raftPerPx));
            const lane = heat.mul(coreK.mul(0.6).add(0.4)).mul(0.24).add(0.05).add(u.tremor.mul(0.12))
                .add(fissure.mul(0.16))
                .add(core.mul(heat.mul(0.34).add(0.2)))
                .sub(section.mul(float(1.0).sub(core)).mul(0.07))
                .max(0.03)
                .toVar();
            const raa = raftPerPx.mul(0.8).add(0.03);
            const laneOf = (r) => float(1.0).sub(smoothstep(lane.sub(raa), lane.add(raa), r));
            const lanes = mix(lane.mul(1.7).min(1.0), mix(laneOf(rA), laneOf(rB), wPh), raftDetail).toVar();
            // Open in the lanes; on a raft only its own cracks, narrower.
            const crackK = lanes.add(float(1.0).sub(lanes).mul(smallK).mul(0.6));
            // A plate glows dull at its rim (the crust thins there), its hairline cracks faintly,
            // and each plate has its own age.
            const rimOf = (r) => exp(r.sub(open).max(0.0).div(0.1).negate());
            const plateRim = mix(rimOf(cA.r), rimOf(cB.r), wPh).mul(detail);
            const hairOf = (r) => float(1.0).sub(smoothstep(0.0, aa.mul(2.5).add(0.06), r));
            const hair = mix(hairOf(cA.a), hairOf(cB.a), wPh).mul(detail).mul(smoothstep(0.25, 0.7, heat));
            const plateAge = mix(cA.g, cB.g, wPh);
            // The banks: a bright seam where the moving lava shears against its levees, only where
            // the channel is wide on screen (at a few pixels two seams read as rails, not as lava).
            const bankSeam = exp(across.sub(0.84).div(0.08).mul(across.sub(0.84).div(0.08)).negate())
                .mul(smoothstep(24.0, 60.0, widePx));
            // A surge of fresh lava down every channel (a level-up), and the fissure always fresh.
            const behind = u.pulse.x.sub(arc);
            const surge = exp(behind.div(0.55).mul(behind.div(0.55)).negate())
                .add(float(1.0).sub(smoothstep(0.0, 2.8, behind)).mul(step(0.0, behind)).mul(0.45))
                .mul(u.pulse.y);
            // A perfect clear gilds the lava: a front of gold runs down every channel from its
            // source and leaves the whole network burning brighter behind it for a few seconds.
            const past = u.gild.x.sub(arc);
            const gilt = exp(past.div(0.7).mul(past.div(0.7)).negate())
                .add(float(1.0).sub(smoothstep(0.0, 4.5, past)).mul(step(0.0, past)).mul(0.55))
                .mul(u.gild.y).mul(smoothstep(0.3, 0.55, lava.heat))
                .toVar();
            const warm = surge.mul(0.2).add(u.tremor.mul(0.08)).add(fissure.mul(0.12)).add(gilt.mul(0.2))
                .toVar();
            // (A mountain sunk to a glow at a run's end crusts over: its rivers go to a dull red.)
            const act = u.activity.mul(0.8).add(0.2).toVar();
            // The light is mixed, not the temperatures: a crust of dark plates parted by bright
            // cracks averages, far off, to a dimmer orange, never to a dull red. The open core runs
            // hotter than the lanes between the bank's plates (toward yellow where the river is
            // fresh); a slug brightens it as it passes.
            const Topen = heat.mul(coreK.mul(0.26).add(0.6)).add(bankSeam.mul(heat).mul(0.14)).add(warm)
                .add(core.mul(heat.sqrt().mul(0.15).add(slug.mul(0.05))).mul(streak.mul(0.5).add(0.72)))
                .mul(act)
                .min(0.875);
            const Tplate = heat.mul(plateAge.mul(0.12).add(0.06).add(plateRim.mul(0.32)).add(hair.mul(0.2)))
                .add(warm.mul(0.6))
                .mul(act).min(0.86);
            const channelLight = mix(pyBlackbody(Tplate), pyBlackbody(Topen), crackK);
            // (A thread swells a little as pulses run down it.)
            const pulse = sin(arc.mul(2.3).sub(u.flow.mul(0.35))).mul(0.05).add(0.95);
            const Tthin = heat.mul(0.66).mul(pulse).add(warm).mul(act)
                .min(0.86);
            emit.assign(mix(channelLight, pyBlackbody(Tthin), thin).mul(cover)
                .add(vec3(1.0, 0.7, 0.26).mul(gilt).mul(cover).mul(0.85)));
        });
        // A back-to-back run: sulphur burns blue along the lava's banks (the whole of a thread too
        // thin to have banks), licking up and dying down along each channel.
        // (Branched out while no run burns: a uniform's branch, so the whole frame takes one side.)
        const flame = float(0.0).toVar();
        If(u.blue.greaterThan(0.002), () => {
            const lick = texture(t.noise, vec2(arc.mul(5.3).add(u.time.mul(0.17)), u.time.mul(0.083).add(across.mul(0.35)))).g;
            const lick2 = texture(t.noise, vec2(arc.mul(19.0).sub(u.time.mul(0.31)), across.mul(0.9).add(u.time.mul(0.12)))).b;
            // Tongues: where two scales of flicker agree, reaching in from the bank by as much as they do.
            flame.assign(smoothstep(0.42, 0.68, lick.mul(0.6).add(lick2.mul(0.4))));
            const bank = smoothstep(float(0.96).sub(flame.mul(0.42)), 0.97, across);
            const blueK = mix(bank.mul(flame), flame.mul(flame).mul(0.3), thin).mul(smoothstep(0.12, 0.3, heat));
            emit.addAssign(vec3(BLUE_FIRE[0], BLUE_FIRE[1], BLUE_FIRE[2]).mul(blueK).mul(cover).mul(u.blue)
                .mul(1.25));
        });
        // Flank vents (a level-up tears one open): a fissure on the cone's face and the stream it
        // sends down the fall line, its toe bright where it advances, cooling behind.
        const fromAxis = P.xz.sub(vec2(VOLCANO.x, VOLCANO.z)).toVar();
        for (let i = 0; i < FLANK_VENTS; i++) {
            const fa = u.flank.element(i * 2);
            const fb = u.flank.element(i * 2 + 1);
            // (A slot with no vent in it costs a comparison: its row's heat is zero.)
            If(fb.y.greaterThan(0.01), () => {
                const out = dot(fromAxis, fa.xy).toVar();
                const run = out.sub(fa.z).toVar();
                // The stream wanders off the straight fall line once it is clear of the vent.
                const wander = sin(out.div(230.0).add(fb.z.mul(6.28))).mul(46.0).add(sin(out.div(83.0).add(fb.z.mul(17.0))).mul(13.0))
                    .mul(smoothstep(0.0, 500.0, run));
                const aside = fromAxis.x.mul(fa.y).sub(fromAxis.y.mul(fa.x)).sub(wander).toVar();
                const hwF = fb.x.mul(smoothstep(-40.0, 900.0, run).mul(0.6).add(0.4));
                const sdF = aside.abs().sub(hwF);
                const pwF = fwidth(sdF).max(0.6);
                const inF = clamp(float(0.5).sub(sdF.div(pwF)), 0.0, 1.0);
                const lineF = clamp(hwF.mul(2.0).div(pwF), 0.0, 1.0).mul(exp(aside.div(pwF).mul(aside.div(pwF)).negate()));
                const ahead = out.sub(fa.w);
                const lengthways = smoothstep(-30.0, 30.0, run).mul(float(1.0).sub(smoothstep(-90.0, 0.0, ahead)));
                const toe = exp(ahead.div(120.0).mul(ahead.div(120.0)).negate());
                const Tf = fb.y.mul(float(0.84).sub(smoothstep(0.0, 3000.0, run).mul(0.2))).add(toe.mul(0.1)).min(0.92);
                emit.addAssign(pyBlackbody(Tf).mul(max(inF, lineF)).mul(lengthways));
            });
        }
        // The levees and older lobes beside a channel crack in cooling joints that glow red near it.
        if (tier.landDetail > 1) {
            const jointUV = P.xz.div(CRUST_TILE * 0.55);
            const joints = texture(t.crust, jointUV.add(vec2(0.23, 0.71))).r;
            const jaa = length(fwidth(jointUV)).mul(CRUST.cells).mul(0.8).add(0.02);
            const joint = float(1.0).sub(smoothstep(0.0, jaa.add(0.05), joints))
                .mul(float(1.0).sub(smoothstep(0.2, 0.6, jaa)));
            const nearBank = exp(sd.max(0.0).div(-30.0)).mul(float(1.0).sub(inside));
            emit.addAssign(pyBlackbody(heat.mul(0.42)).mul(joint).mul(nearBank).mul(0.7));
        }
        // St Elmo's fire on the summit (a back-to-back run): a violet corona round the rim.
        const rim = exp(length(P.xz.sub(vec2(VOLCANO.x, VOLCANO.z))).div(-520.0))
            .mul(smoothstep(VOLCANO.height - 700.0, VOLCANO.height - 60.0, P.y));
        emit.addAssign(u.bolt.mul(rim.mul(u.corona).mul(0.35)));
        emit.addAssign(vec3(BLUE_FIRE[0], BLUE_FIRE[1], BLUE_FIRE[2]).mul(rim).mul(u.blue).mul(flame.mul(0.8).add(0.2))
            .mul(1.2));
        // The crater's throat glows on the rock inside the breach.
        const fromVent = length(P.xz.sub(vec2(VOLCANO.x, VOLCANO.z))).toVar();
        const throat = exp(fromVent.div(-260.0))
            .mul(smoothstep(VOLCANO.height - 520.0, VOLCANO.height - 140.0, P.y));
        // The fountain's fallout: an apron of fresh spatter round the crater, glowing in clots
        // (wider as the fountain climbs), cooling to a dull red at its edge.
        const apronR = u.fountain.mul(170.0).add(430.0);
        const apron = exp(fromVent.div(apronR).mul(fromVent.div(apronR)).negate())
            .mul(smoothstep(VOLCANO.height - 1100.0, VOLCANO.height - 300.0, P.y))
            .toVar();
        // (Only round the crater: its two reads take their gradients from the ground's own.)
        If(apron.greaterThan(0.002), () => {
            const groundDx = crustDx.mul(CRUST_TILE);
            const groundDy = crustDy.mul(CRUST_TILE);
            const clotsA = texture(t.noise, P.xz.div(70.0)).grad(groundDx.div(70.0), groundDy.div(70.0)).b;
            const clotsB = texture(t.noise, P.xz.div(23.0).add(vec2(0.37, 0.71))).grad(groundDx.div(23.0), groundDy.div(23.0)).g;
            const clot = smoothstep(0.5, 0.78, clotsA.mul(0.65).add(clotsB.mul(0.35)).add(apron.mul(0.12))).toVar();
            const apronHeat = u.fountain.mul(0.5).add(0.5).add(u.burst.mul(0.4)).mul(u.activity);
            const clotT = clot.mul(0.16).add(apron.mul(0.2)).add(0.36);
            emit.addAssign(pyBlackbody(clotT).mul(clot.mul(apron)).mul(apronHeat).mul(0.55));
        });
        const throatHeat = u.fountain.mul(0.4).add(0.6).add(u.burst.mul(0.5));
        emit.addAssign(pyBlackbody(float(0.78)).mul(throat).mul(throatHeat).mul(u.activity));

        // ── Hits: bomb splashes and bolt strikes ──
        Loop({
            start: int(0), end: u.hitCount, type: 'int', condition: '<', name: 'hi',
        }, ({ hi }) => {
            const a = u.hits.element(hi.mul(2));
            const b = u.hits.element(hi.mul(2).add(1));
            const age = u.time.sub(a.w);
            const d = length(P.sub(a.xyz));
            // kind (b.w): 0 a bomb's splash (small, hot, cooling), 1 a bolt's strike (scorch).
            const r = mix(float(26.0), float(60.0), b.w);
            const spot = exp(d.div(r).mul(d.div(r)).negate());
            const cool = exp(age.max(0.0).mul(mix(float(-0.5), float(-1.4), b.w)));
            const temp = mix(float(0.85), float(0.6), b.w).mul(cool);
            emit.addAssign(pyBlackbody(temp).mul(b.xyz).mul(spot).mul(age.greaterThan(0.0).select(1.0, 0.0)));
        });

        col.addAssign(emit);
        return vec4(aerial(u, t, P, col), 1.0);
    })();
    return material;
}

/** The land part: the fan and the cone, one material. */
export function createLand(u, t, tier, data) {
    const fanGeometry = gridGeometry(data.fan);
    const coneGeometry = gridGeometry(data.cone);
    const material = createLandMaterial(u, t, tier);
    const fan = new THREE.Mesh(fanGeometry, material);
    fan.name = 'PyrestormPlain';
    fan.frustumCulled = false;
    fan.renderOrder = 1;
    const cone = new THREE.Mesh(coneGeometry, material);
    cone.name = 'PyrestormVolcano';
    cone.frustumCulled = false;
    cone.renderOrder = 0;
    return {
        mesh: fan,
        meshes: [cone, fan],
        dispose() {
            fanGeometry.dispose();
            coneGeometry.dispose();
            material.dispose();
        },
    };
}

/** The land's height for event placement (the CPU twin of the meshes, without the earth's drop). */
export const groundAt = (x, z) => landHeight(x, z);
export { min };
