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
    Loop,
    abs,
    attribute,
    clamp,
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
    DEG, EYE, VOLCANO, landHeight, plainHeight, satelliteHeight, smooth, volcanoHeight,
} from './pyrestorm-core.js';
import {
    CRUST, aerial, fireLightAt, lavaAt, lightningAt, pyBlackbody,
} from './pyrestorm-tsl.js';

/** The crust tile's span (m): CRUST.cells plates across, each about thirty metres. */
export const CRUST_TILE = 480;

/** The fan's bearings (degrees right of the view axis) and reach (m). */
export const FAN = Object.freeze({
    from: -58, to: 52, near: 2.5, far: 82000,
});
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
        if (j % 24 === 23) yield 'fan';
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
        if (j % 20 === 19) yield 'cone';
    }
    const fanNS = gridNormals(fan, fanCols + 1, fanRows + 1, false);
    yield 'normals';
    const coneNS = gridNormals(cone, segs + 1, rings + 1, true);
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
 * the first (the cone's rings close).
 */
function gridNormals(pos, nx, ny, wrapI) {
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
        const lava = lavaAt(t, P.xz);

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
        // Near the eye: tephra grain.
        const nearK = float(1.0).sub(smoothstep(60.0, 700.0, toEye));
        rock.mulAssign(mix(float(1.0), texture(t.noise, P.xz.div(2.6)).a.mul(0.7).add(0.65), nearK));
        const shade = shadeAttr.mul(0.7).add(0.3);

        // ── Light on it ──
        const sky = u.ambient.mul(N.y.mul(0.45).add(0.55)).mul(1.8);
        // The lava's own light on the land beside it (and the country's wide glow).
        const glow = u.fireColour.mul(lava.glow.mul(0.6).add(lava.wide.mul(0.14))).mul(N.y.mul(0.3).add(0.7)).mul(u.activity);
        // Low fire light from the plain in front rims the near crags and boulders.
        // The rivers below throw their light up the eye's own slope: a warm rim on the brow and its
        // boulders (the near ground reads as land, not as black).
        const nearRim = float(1.0).sub(smoothstep(80.0, 1400.0, toEye));
        const front = u.fireColour.mul(clamp(dot(N, normalize(vec3(0.15, 0.32, -1.0))), 0.0, 1.0).mul(0.3).mul(nearRim).mul(u.activity));
        const crater = fireLightAt(u, P, N).mul(u.activity);
        const bolts = lightningAt(u, P, N);
        // The anvil overhead, lit orange from below, lights the land a little from above.
        const bounce = u.fireColour.mul(u.activity.mul(0.008).add(u.charge.mul(0.004))).mul(N.y.max(0.0));
        const light = sky.add(glow).add(front).add(crater).add(bounce)
            .mul(shade)
            .add(bolts);
        const col = rock.mul(light).toVar();

        // ── The lava ──
        const sd = lava.dc.sub(lava.hw);
        const pw = max(fwidth(sd), lava.cell.mul(0.18)).max(0.6);
        const inside = clamp(float(0.5).sub(sd.div(pw)), 0.0, 1.0);
        // A channel narrower than a pixel still burns: as a line of its own width's share.
        const line = clamp(lava.hw.mul(2.0).div(pw), 0.0, 1.0).mul(exp(lava.dc.div(pw).mul(lava.dc.div(pw)).negate()));
        const cover = max(inside, line).toVar();
        const heat = lava.heat.mul(u.lavaHeat).mul(smoothstep(0.02, 0.12, lava.heat)).toVar();
        const { dir } = lava;
        // Across the channel: 0 on its centreline, 1 at its banks.
        const across = lava.dc.div(lava.hw.max(1.0)).toVar();
        const coreK = float(1.0).sub(smoothstep(0.0, 1.0, across)).toVar();
        // The fissure (kind 3) runs fresh; breakouts (kind 4) are their own, cooler toes.
        const fissure = smoothstep(2.5, 3.0, lava.kind).mul(float(1.0).sub(smoothstep(3.5, 4.0, lava.kind)));
        // The crust: plates of a baked network (pyrestorm-bake.js, bakeCrust) dragged downstream by
        // a two-phase flow map (each phase fades out before it has dragged its plates far), faster
        // in the channel's middle than by its banks, so the crust shears as it goes.
        const ph1 = fract(u.flow.mul(0.045));
        const ph2 = fract(u.flow.mul(0.045).add(0.5));
        const wPh = abs(ph1.mul(2.0).sub(1.0));
        const crustUV = P.xz.div(CRUST_TILE);
        const drag = dir.mul(coreK.mul(0.55).add(0.45)).mul(0.4);
        const cA = texture(t.crust, crustUV.sub(drag.mul(ph1)));
        const cB = texture(t.crust, crustUV.sub(drag.mul(ph2)).add(vec2(0.37, 0.61)));
        // How many plates a pixel spans: where the network is finer than the eye, its average.
        const platesPerPx = length(fwidth(crustUV)).mul(CRUST.cells);
        const detail = float(1.0).sub(smoothstep(0.2, 0.65, platesPerPx)).toVar();
        // How far the cracks open (R is about 1 at a plate's middle): hotter lava opens more of the
        // crust, the middle of a channel more than its sides; a hard drop's tremor tears it open.
        const open = heat.mul(coreK.mul(0.6).add(0.4)).mul(0.24).add(0.035).add(u.tremor.mul(0.14))
            .add(fissure.mul(0.14))
            .toVar();
        const aa = platesPerPx.mul(0.8).add(0.02);
        const crackOf = (r) => float(1.0).sub(smoothstep(open.sub(aa), open.add(aa), r));
        const crack = mix(crackOf(cA.r), crackOf(cB.r), wPh);
        const smallK = mix(open.mul(1.7).min(1.0), crack, detail);
        // Rafts: crust four times the plates' size floats in lanes of open lava (it keeps a flow
        // mottled where its plates are finer than a pixel). Same flow map, slower: rafts drag.
        const raftUV = crustUV.mul(0.25).add(vec2(0.19, 0.53));
        const rA = texture(t.crust, raftUV.sub(drag.mul(ph1).mul(0.2))).r;
        const rB = texture(t.crust, raftUV.sub(drag.mul(ph2).mul(0.2)).add(vec2(0.41, 0.17))).r;
        const raftPerPx = platesPerPx.mul(0.25);
        const raftDetail = float(1.0).sub(smoothstep(0.2, 0.65, raftPerPx));
        const lane = heat.mul(coreK.mul(0.6).add(0.4)).mul(0.24).add(0.05).add(u.tremor.mul(0.12))
            .add(fissure.mul(0.16));
        const raa = raftPerPx.mul(0.8).add(0.03);
        const laneOf = (r) => float(1.0).sub(smoothstep(lane.sub(raa), lane.add(raa), r));
        const lanes = mix(lane.mul(1.7).min(1.0), mix(laneOf(rA), laneOf(rB), wPh), raftDetail);
        // Open in the lanes; on a raft only its own cracks, narrower.
        const crackK = lanes.add(float(1.0).sub(lanes).mul(smallK).mul(0.6)).toVar();
        // A plate glows dull at its rim (the crust thins there), its hairline cracks faintly, and
        // each plate has its own age.
        const rimOf = (r) => exp(r.sub(open).max(0.0).div(0.1).negate());
        const plateRim = mix(rimOf(cA.r), rimOf(cB.r), wPh).mul(detail);
        const hairOf = (r) => float(1.0).sub(smoothstep(0.0, aa.mul(2.5).add(0.06), r));
        const hair = mix(hairOf(cA.a), hairOf(cB.a), wPh).mul(detail).mul(smoothstep(0.25, 0.7, heat));
        const plateAge = mix(cA.g, cB.g, wPh);
        // The banks: a bright seam where the moving lava shears against its levees, only where the
        // channel is wide on screen (at a few pixels two seams read as rails, not as lava).
        const bankSeam = exp(across.sub(0.84).div(0.08).mul(across.sub(0.84).div(0.08)).negate())
            .mul(smoothstep(24.0, 60.0, lava.hw.mul(2.0).div(pw)));
        // A surge of fresh lava down every channel (a level-up), and the fissure always fresh.
        const behind = u.pulse.x.sub(lava.arc);
        const surge = exp(behind.div(0.55).mul(behind.div(0.55)).negate())
            .add(float(1.0).sub(smoothstep(0.0, 2.8, behind)).mul(step(0.0, behind)).mul(0.45))
            .mul(u.pulse.y);
        const warm = surge.mul(0.2).add(u.tremor.mul(0.08)).add(fissure.mul(0.12)).toVar();
        const act = u.activity.mul(0.55).add(0.45).toVar();
        // The light is mixed, not the temperatures: a crust of dark plates parted by bright cracks
        // averages, far off, to a dimmer orange, never to a dull red.
        const Topen = heat.mul(coreK.mul(0.26).add(0.6)).add(bankSeam.mul(heat).mul(0.14)).add(warm).mul(act)
            .min(0.86);
        const Tplate = heat.mul(plateAge.mul(0.12).add(0.06).add(plateRim.mul(0.32)).add(hair.mul(0.2)))
            .add(warm.mul(0.6))
            .mul(act).min(0.86);
        const channelLight = mix(pyBlackbody(Tplate), pyBlackbody(Topen), crackK);
        // A thread too thin to show its crust burns steady, swelling a little as pulses run down it.
        const thin = float(1.0).sub(smoothstep(1.0, 3.0, lava.hw.mul(2.0).div(pw)));
        const pulse = sin(lava.arc.mul(2.3).sub(u.flow.mul(0.35))).mul(0.05).add(0.95);
        const Tthin = heat.mul(0.66).mul(pulse).add(warm).mul(act)
            .min(0.86);
        const emit = mix(channelLight, pyBlackbody(Tthin), thin).mul(cover).toVar();
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
        // The crater's throat glows on the rock inside the breach.
        const fromVent = length(P.xz.sub(vec2(VOLCANO.x, VOLCANO.z))).toVar();
        const throat = exp(fromVent.div(-260.0))
            .mul(smoothstep(VOLCANO.height - 520.0, VOLCANO.height - 140.0, P.y));
        // The fountain's fallout: an apron of fresh spatter round the crater, glowing in clots
        // (wider as the fountain climbs), cooling to a dull red at its edge.
        const apronR = u.fountain.mul(170.0).add(430.0);
        const apron = exp(fromVent.div(apronR).mul(fromVent.div(apronR)).negate())
            .mul(smoothstep(VOLCANO.height - 1100.0, VOLCANO.height - 300.0, P.y));
        const clotsA = texture(t.noise, P.xz.div(70.0)).b;
        const clotsB = texture(t.noise, P.xz.div(23.0).add(vec2(0.37, 0.71))).g;
        const clot = smoothstep(0.5, 0.78, clotsA.mul(0.65).add(clotsB.mul(0.35)).add(apron.mul(0.12)));
        const apronHeat = u.fountain.mul(0.5).add(0.5).add(u.burst.mul(0.4)).mul(u.activity);
        const clotT = clot.mul(0.16).add(apron.mul(0.2)).add(0.36);
        emit.addAssign(pyBlackbody(clotT).mul(clot.mul(apron)).mul(apronHeat).mul(0.55));
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
