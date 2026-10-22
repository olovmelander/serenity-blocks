/**
 * Nimbus Veil — towering cumulus rising from the cloud sea.
 *
 * Each tower is ONE camera-facing card drawn as a heap of billows: sphere impostors (a skirt
 * spreading into the deck, a body that tapers and leans downwind, a cauliflower crown) united
 * in the fragment — the outline is the union of their discs, frayed by value noise, and the
 * normal is the soft-max blend of each billow's own sphere normal, bent by the noise's slope.
 * So a tower is lit like one solid cloud, not a stack of balls: gold where its form turns to the
 * low sun, violet in its own shade, darker toward the base, and, when the sun stands behind it,
 * a silver lining where the heap thins at its outline (the method of painted-ages-cumulus.js).
 *
 * The billows of every tower live in one uniform array; each card loops over its own slice
 * (dynamic indexing works on both backends). One draw for all towers, cards ordered far to near
 * (the camera only drifts about a fixed point, so the order holds).
 *
 * The shapes follow towerHalfWidth() (nimbus-veil-tsl.js), the profile the cloud sea uses for
 * the towers' long shadows.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    int,
    log,
    max,
    min,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    sqrt,
    uniformArray,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SUN_DIR,
    TOWERS,
    nvApplyHaze,
    nvDomes,
    nvNoise2,
    rgb,
    towerHalfWidth,
} from './nimbus-veil-tsl.js';
import { SEA_HAZE, ringLight } from './nimbus-veil-cloudsea.js';

/** The billows' soft union sharpness (1 / world units): creases a few units wide. */
const UNION_K = 0.28;

/**
 * A tower's billows in its card frame: [x across (world units, + = the card's right), y up,
 * radius, depth toward the viewer]. `count` is the tier's budget; skirt, body and crown share it.
 */
export function towerBillows(tower, count, rand) {
    const H = tower.h;
    const out = [];
    // The wind blows toward +x; on the card it leans by the card's right·x̂ = cos(bearing).
    const leanX = (yn) => tower.lean * H * yn ** 1.5 * Math.cos(THREE.MathUtils.degToRad(tower.az));
    const skirt = Math.max(4, Math.round(count * 0.18));
    const crown = Math.max(7, Math.round(count * 0.36));
    const body = Math.max(6, count - skirt - crown);
    // Depth: a billow standing out toward the viewer takes the surface over the ones behind.
    const depth = (r) => (rand() - 0.35) * r * 0.5;

    // ── Skirt: a row of broad billows where the tower rises out of the deck ──
    const hw0 = towerHalfWidth(H, 0) * 1.3;
    for (let k = 0; k < skirt; k += 1) {
        const x = -hw0 + (2 * hw0 * (k + 0.5)) / skirt + (rand() - 0.5) * hw0 * 0.15;
        const r = H * (0.11 + 0.06 * rand());
        out.push([x, H * (0.02 + 0.05 * rand()), r, depth(r) * 0.3]);
    }
    // ── Body: overlapping billows climbing a tapering, leaning column, packed so the column is
    // solid while many of them show; the sides bulge where one stands out ──
    for (let k = 0; k < body; k += 1) {
        const yn = 0.06 + 0.72 * ((k + rand()) / body);
        const hw = towerHalfWidth(H, yn);
        const r = hw * 0.48 * (0.75 + 0.5 * rand());
        const x = leanX(yn) + (rand() * 2 - 1) * (hw - r * 0.7);
        out.push([x, yn * H, r, depth(r)]);
    }
    // ── Crown: a dome of billows, turreted: a few rise well above the others ──
    const cy = 0.78 * H;
    const cx = leanX(0.78);
    const rc = towerHalfWidth(H, 0.78);
    const fill = 3;
    for (let k = 0; k < fill; k += 1) {
        const r = rc * (0.5 + 0.1 * rand());
        out.push([cx + (k - 1) * rc * 0.4, cy + (rand() - 0.4) * rc * 0.25, r, depth(r) - r * 0.2]);
    }
    const rim = crown - fill;
    for (let k = 0; k < rim; k += 1) {
        const a = Math.PI * (0.03 + 0.94 * ((k + 0.25 + rand() * 0.5) / rim));
        const turret = rand() < 0.22 ? 1.3 : 1;
        const rr = rc * (0.55 + 0.18 * rand()) * turret;
        const r = rc * (0.24 + 0.16 * rand());
        out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.92, r, depth(r)]);
    }
    return out;
}

/**
 * @param {object} u  shared world uniforms
 * @param {object} opts
 * @param {() => number} opts.rand
 * @param {number} opts.towers         how many towers (prefix of TOWERS)
 * @param {number} opts.billowsPerTower billows per tower
 * @returns {THREE.Mesh|null}
 */
export function createCumulus(u, { rand, towers, billowsPerTower }) {
    if (!towers || !billowsPerTower) return null;
    const list = TOWERS.slice(0, towers).map((tower) => ({
        tower,
        billows: towerBillows(tower, billowsPerTower, rand),
    }));
    // Far to near from the rest camera: the cards blend in that order.
    list.sort((a, b) => b.tower.d - a.tower.d);

    const rows = [];
    const positions = [];
    const uvs = [];
    const cards = [];
    const rects = [];
    const index = [];
    list.forEach(({ tower, billows }) => {
        const start = rows.length;
        let xMin = Infinity;
        let xMax = -Infinity;
        let yMax = -Infinity;
        for (const [x, y, r, z] of billows) {
            rows.push(new THREE.Vector4(x, y, r, z));
            xMin = Math.min(xMin, x - r);
            xMax = Math.max(xMax, x + r);
            yMax = Math.max(yMax, y + r);
        }
        const margin = tower.h * 0.04;
        xMin -= margin;
        xMax += margin;
        yMax += margin;
        const yMin = -10;
        const a = THREE.MathUtils.degToRad(tower.az);
        // The card faces the rest camera: its right is the horizontal tangent of the bearing.
        const rx = Math.cos(a);
        const rz = Math.sin(a);
        const base = positions.length / 3;
        for (const [sx, sy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
            const lx = xMin + (xMax - xMin) * sx;
            positions.push(tower.x + rx * lx, yMin + (yMax - yMin) * sy, tower.z + rz * lx);
            uvs.push(sx, sy);
            cards.push(start, billows.length, tower.h, a);
            rects.push(xMin, yMin, xMax - xMin, yMax - yMin);
        }
        index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aCard', new THREE.Float32BufferAttribute(cards, 4));
    geometry.setAttribute('aRect', new THREE.Float32BufferAttribute(rects, 4));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();

    const billowRows = uniformArray(rows, 'vec4');
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NimbusCumulus';
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.fog = false;

    const card = attribute('aCard', 'vec4'); // first billow, billow count, tower height, bearing
    const rect = attribute('aRect', 'vec4'); // card frame: x min, y min, width, height
    const st = attribute('uv', 'vec2');
    material.colorNode = Fn(() => {
        // Per-card values arrive as varyings: integers are rounded back before indexing.
        const start = int(floor(card.x.add(0.5))).toVar();
        const count = int(floor(card.y.add(0.5))).toVar();
        const H = card.z.toVar();
        const bearing = card.w.toVar();
        const p = vec2(rect.x.add(st.x.mul(rect.z)), rect.y.add(st.y.mul(rect.w))).toVar();

        // ── Fray: the outline lumps both ways, cauliflower on cauliflower, drifting slowly ──
        const seed = bearing.mul(41.3);
        const np = p.div(H.mul(0.06)).add(vec2(seed, u.time.mul(0.03)));
        const n1 = nvNoise2(np).toVar();
        const n2 = nvNoise2(np.mul(2.7).add(5.1)).toVar();
        const fray = n1.sub(0.5).mul(H.mul(0.05)).add(n2.sub(0.5).mul(H.mul(0.022))).toVar();
        // Cauliflower: small domes swell and shrink every billow a little (so no billow's edge is
        // a circle) and bend the light. Domes, not value noise: value noise's slope dies along
        // every cell edge and draws blocks.
        const bump = nvDomes(p.div(H.mul(0.07)).add(vec2(seed.mul(0.7), 0.0)), 1e4).toVar();
        const swell = bump.x.sub(0.45).mul(0.16).add(1.0).toVar();

        // ── The union: the outline is the deepest billow's signed distance; the light is the
        // soft-max blend of the billows' sphere normals ──
        const sum = float(0.0).toVar();
        const nrmSum = vec3(0.0).toVar();
        const sd = float(-1e4).toVar();
        // Outward direction from the nearest billow: the light for the fray past the outline.
        const outward = vec2(0.0, 1.0).toVar();
        Loop({
            start: int(0), end: count, type: 'int', condition: '<',
        }, ({ i }) => {
            const b = billowRows.element(start.add(i)).toVar();
            const d = p.sub(b.xy).toVar();
            const dd = dot(d, d);
            const rb = b.z.mul(swell);
            const r2 = rb.mul(rb);
            const z = sqrt(max(r2.sub(dd), 0.0)).toVar();
            const sdi = rb.sub(sqrt(dd)).toVar();
            outward.assign(sdi.greaterThan(sd).select(d.div(max(sqrt(dd), 1e-3)), outward));
            sd.assign(max(sd, sdi));
            // The billow's surface stands at its depth offset in front of the card.
            const front = z.add(b.w).add(rb.mul(0.5));
            const w = exp(min(front.mul(UNION_K), 60.0)).mul(dd.lessThan(r2).select(1.0, 0.0));
            sum.addAssign(w);
            nrmSum.addAssign(vec3(d, max(z, 0.5)).div(rb).mul(w));
        });
        // The heap's thickness toward the viewer (0 at the outline).
        const top = log(max(sum, 1.0)).div(UNION_K).toVar();

        const soft = H.mul(0.008).add(0.6);
        const alpha = smoothstep(soft.negate(), soft, sd.add(fray))
            // The base sinks into the deck's mist.
            .mul(smoothstep(-4.0, 10.0, p.y)).toVar();

        // Past every billow's rim (the fray), the surface turns away from the view along the
        // nearest billow's outward direction.
        const nrm0 = sum.greaterThan(0.0).select(normalize(nrmSum), normalize(vec3(outward, 0.15)));
        const nrm = normalize(nrm0.add(vec3(bump.yz.mul(-0.12), 0.0))).toVar();

        // ── Light, in the card's frame: right, up, out toward the eye ──
        const right = vec3(cos(bearing), 0.0, sin(bearing));
        const out = vec3(sin(bearing).negate(), 0.0, cos(bearing));
        const L = vec3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);
        const N = right.mul(nrm.x).add(vec3(0.0, nrm.y, 0.0)).add(out.mul(nrm.z)).toVar();
        const height = clamp(p.y.div(H), 0.0, 1.0);
        const diff = clamp(dot(N, L).mul(0.9).add(0.18), 0.0, 1.0);
        const sunCol = rgb(0xffc48c, 1.85);
        // The shade is the sky's light scattered inside the cloud: violet low, lavender-blue
        // where the form turns up to the zenith and higher up the tower.
        // The violet deepens as the crowns burn (u.blaze.y), so the fire reads against it.
        const shade = mix(rgb(0x6a62a2, 0.4), rgb(0x9496d8, 0.52), clamp(N.y.mul(0.5).add(height.mul(0.6)), 0.0, 1.0))
            .mul(float(1.0).sub(min(u.blaze.y, 1.2).mul(0.25)));
        // Creases and the deep base see less sky.
        const ao = mix(float(0.62), float(1.0), smoothstep(0.0, H.mul(0.05), top))
            .mul(mix(float(0.7), float(1.0), smoothstep(0.0, 0.35, height)));
        const col = shade.mul(ao).add(sunCol.mul(diff.mul(diff))).toVar();
        // Light leaks through: the shade side of a sunlit crown is never dead.
        col.addAssign(sunCol.mul(0.05).mul(smoothstep(0.45, 1.0, height)));
        // Silver lining: with the sun behind, the heap glows where it is thin (its outline).
        const behind = clamp(dot(L, out.negate()), 0.0, 1.0);
        const b2 = behind.mul(behind);
        const thin = exp(max(sd.add(fray), 0.0).div(H.mul(0.03)).negate());
        col.addAssign(sunCol.mul(thin).mul(b2.mul(b2).mul(2.2).add(0.1)).mul(u.sunPulse.mul(0.4).add(1.0)));
        // Thin edges pass light from any side: the frayed outline never darkens against the sky.
        col.addAssign(sunCol.mul(thin.mul(0.3).mul(diff.mul(0.6).add(0.4))));
        // A light wave (line clear / level up) lights the tower as it rolls through it; the
        // band is widened here so the whole heap glows for a moment, not a sliver of it.
        const rel = positionWorld.sub(cameraPosition);
        const dist = sqrt(rel.x.mul(rel.x).add(rel.z.mul(rel.z)));
        // Overlapping bands light a tower no more than about one does; a hot band lights the
        // faces that turn to the sun and leaves the shade side violet.
        const wave = ringLight(u.rings, dist, 2.5, 0.45, 0.35);
        col.addAssign(mix(sunCol, rgb(0xff9450, 1.9), wave.heat).mul(wave.sum)
            .mul(diff.mul(0.5).add(float(0.35).sub(wave.heat.mul(0.22)))));
        // Hot play sets the crowns burning (u.blaze.y): the outline turns to a burning amber
        // lining and the faces that turn to the sun catch fire; the rest stays violet.
        const upper = smoothstep(0.35, 0.95, height);
        const fire = rgb(0xff7438, 2.0).mul(thin).add(rgb(0xff8c4e, 0.8).mul(smoothstep(0.45, 0.85, diff)));
        col.addAssign(fire.mul(upper).mul(u.blaze.y));
        // A perfect clear (u.blaze.w) lights every crown at once: its top and its outline.
        col.addAssign(rgb(0xffa458, 1.3).mul(smoothstep(0.5, 1.0, height))
            .mul(diff.mul(0.7).add(thin.mul(0.8)).add(0.1))
            .mul(u.blaze.w));
        col.mulAssign(float(1.0).add(u.seaGlow.mul(0.15)));
        const lit = nvApplyHaze(col, rel, float(SEA_HAZE * 0.9), u.sunPulse);
        return vec4(lit, alpha.mul(0.98));
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NimbusCumulus';
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    return mesh;
}
