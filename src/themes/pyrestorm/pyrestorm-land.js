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
    aerial, fireLightAt, lavaAt, lightningAt, pyBlackbody,
} from './pyrestorm-tsl.js';

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
        // Crust dragged along the flow: rafts (tens of metres) and plates (a few), each by two
        // phases of a flow map crossfaded, so the crust drifts downstream without stretching.
        const { dir } = lava;
        const ph1 = fract(u.flow.mul(0.045));
        const ph2 = fract(u.flow.mul(0.045).add(0.5));
        const wPh = abs(ph1.mul(2.0).sub(1.0));
        const rafts = mix(
            texture(t.noise, P.xz.div(430.0).sub(dir.mul(ph1.mul(0.5)))).g,
            texture(t.noise, P.xz.div(430.0).sub(dir.mul(ph2.mul(0.5))).add(vec2(0.37, 0.19))).g,
            wPh,
        );
        const plates = mix(
            texture(t.noise, P.xz.div(90.0).sub(dir.mul(ph1.mul(2.3)))).b,
            texture(t.noise, P.xz.div(90.0).sub(dir.mul(ph2.mul(2.3))).add(vec2(0.61, 0.43))).b,
            wPh,
        );
        const aaPlates = smoothstep(0.35, 1.2, length(fwidth(P.xz.div(90.0))));
        const aaRafts = smoothstep(0.35, 1.2, length(fwidth(P.xz.div(430.0))));
        const crustN = mix(rafts, float(0.5), aaRafts).mul(0.58).add(mix(plates, float(0.5), aaPlates).mul(0.42)).toVar();
        // Hot lava has little crust; the centre of a channel runs hottest and fastest.
        const coreK = float(1.0).sub(smoothstep(0.0, 1.0, lava.dc.div(lava.hw.max(1.0))));
        const edge = mix(float(0.36), float(0.52), heat.mul(0.5).add(coreK.mul(0.5))).sub(u.tremor.mul(0.1));
        const crustAmt = smoothstep(edge.sub(0.04), edge.add(0.04), crustN).toVar();
        // Seams between plates glow (the crust tearing open as it moves).
        const seam = float(1.0).sub(smoothstep(0.0, 0.026, abs(crustN.sub(edge)))).mul(smoothstep(0.3, 0.7, heat));
        // The levees: the channel's skin by its banks runs cooler.
        const bank = smoothstep(-0.45, 0.0, sd.div(lava.hw.max(1.0)));
        // A thread too thin to show its crust beads instead: brighter and dimmer along its length.
        const beads = texture(t.noise, vec2(lava.arc.mul(1.7).sub(u.flow.mul(0.012)), lava.kind.mul(0.31))).r;
        const thin = float(1.0).sub(smoothstep(1.0, 3.0, lava.hw.mul(2.0).div(pw)));
        // A surge of fresh lava down every channel (a level-up), and the fissure always fresh.
        const behind = u.pulse.x.sub(lava.arc);
        const surge = exp(behind.div(0.55).mul(behind.div(0.55)).negate())
            .add(float(1.0).sub(smoothstep(0.0, 2.8, behind)).mul(step(0.0, behind)).mul(0.45))
            .mul(u.pulse.y);
        // The fissure (kind 3) runs fresh; breakouts (kind 4) are their own, cooler toes.
        const fissure = smoothstep(2.5, 3.0, lava.kind).mul(float(1.0).sub(smoothstep(3.5, 4.0, lava.kind)));
        const molten = coreK.mul(0.38).add(0.62).mul(float(1.0).sub(crustAmt.mul(0.78))).mul(float(1.0).sub(bank.mul(0.35)));
        const T = heat.mul(molten.add(seam.mul(0.45)))
            .mul(mix(float(1.0), beads.mul(0.7).add(0.55), thin))
            .add(surge.mul(0.2))
            .add(u.tremor.mul(0.12))
            .add(fissure.mul(0.18))
            .mul(u.activity.mul(0.55).add(0.45))
            .min(0.82)
            .toVar();
        const emit = pyBlackbody(T).mul(cover).toVar();
        // Cracks glow on the crust beside the channel (levees, older lobes), red and fine.
        if (tier.landDetail > 1) {
            const fineCrust = texture(t.noise, P.xz.div(38.0)).b;
            const crack = smoothstep(0.03, 0.0, abs(fineCrust.sub(0.5))).mul(exp(sd.max(0.0).div(-26.0)))
                .mul(float(1.0).sub(inside));
            emit.addAssign(pyBlackbody(heat.mul(0.45)).mul(crack).mul(0.8));
        }
        // St Elmo's fire on the summit (a back-to-back run): a violet corona round the rim.
        const rim = exp(length(P.xz.sub(vec2(VOLCANO.x, VOLCANO.z))).div(-520.0))
            .mul(smoothstep(VOLCANO.height - 700.0, VOLCANO.height - 60.0, P.y));
        emit.addAssign(u.bolt.mul(rim.mul(u.corona).mul(0.35)));
        // The crater's throat glows on the rock inside the breach.
        const throat = exp(length(P.xz.sub(vec2(VOLCANO.x, VOLCANO.z))).div(-260.0))
            .mul(smoothstep(VOLCANO.height - 520.0, VOLCANO.height - 140.0, P.y));
        emit.addAssign(pyBlackbody(float(0.78)).mul(throat).mul(u.fountain.mul(0.4).add(0.6)).mul(u.activity));

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
