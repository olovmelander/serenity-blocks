/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Rainbow Terraces: the cumulus, in the world (one instanced draw).
 *
 * Every cloud is a heap of camera-facing puffs. Lighting follows the CLOUD's form first (outward
 * from its axis, domed toward its crown) and each puff's own sphere only second, so a cloud reads
 * as one billowing mass, not a stack of balls (the technique of Nimbus Veil's towers, turned for a
 * sun BEHIND the eye): the faces we see are lit full face, so the form comes from the shade under
 * every billow, the darker flat base, the luminous Deep's light thrown up under it, and at the
 * rose and pearl hours the Earth's shadow climbing the cloud until only its crown burns.
 *
 * The clouds are authored as frame anchors (placed from the solved frame, so a phone and an
 * ultrawide compose as well as the landscape): a congestus tower behind the Spring Isle on the
 * shower's bearing, the storm's sunlit crown over its dark body (the storm wall and its rain hang
 * in the dome behind and under it). The far banks along the horizon, the deck and the cirrus are
 * the dome's: hazed or thin, they need no puffs.
 *
 * Puffs are sorted back to front when the frame is placed (the eye only breathes, so the order
 * holds), and blended premultiplied.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, atan, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, dot, exp, float, fract, length, max, mix,
    normalize, positionGeometry, pow, sin, smoothstep, sqrt, texture, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { DEG, mulberry32 } from './rainbow-terraces-core.js';
import { project, unproject } from './rainbow-terraces-frame.js';
import {
    airColour, bowStrokes, cloudLight, optics, scWrap, scWrapPi, skyBase,
} from './rainbow-terraces-tsl.js';

/** Floats per puff in the instance buffer: centre + radius, tone, cloud. */
const STRIDE = 12;

/**
 * The clouds for a solved frame: [{ x, y, z (base centre), W (across), D (deep), H, kind, seed }].
 * kind 0 tower, 1 bank, 2 small, 3 veil. The frame holds the storm's tower and, in landscape, two
 * veils of stratus lying level just under the horizon a few kilometres out, one each side of the
 * board: behind the near isles and in front of everything far (the archipelago, the Far Gate's
 * mesa, the storm's foot), so the distance stands in planes. The sky's other clouds are the
 * dome's (the deck, the cirrus, the far banks), which need no puffs and no sort, and small cumulus
 * scattered in the free sky only read as confetti there.
 */
export function cumulusPlan(frame, showerBearing) {
    const smile = frame.plan === 'smile';
    const out = [];
    // A veil lying level from frame x0 to x1 (at the horizon's height), `dist` metres out, its
    // middle `elevDeg` under the horizon. (Laid before the tower, whose early returns keep them.)
    const veil = (x0, x1, elevDeg, dist, H, seed) => {
        if (!frame.cam || x1 - x0 < 0.08) return;
        const a = unproject(x0, frame.horizon, frame.cam, [0, 0, -1]);
        const b = unproject(x1, frame.horizon, frame.cam, [0, 0, -1]);
        const b0 = Math.atan2(a[0], -a[2]);
        const b1 = Math.atan2(b[0], -b[2]);
        const mid = (b0 + b1) / 2;
        out.push({
            x: Math.sin(mid) * dist,
            y: Math.tan(elevDeg * DEG) * dist,
            z: -Math.cos(mid) * dist,
            W: 2 * dist * Math.tan(Math.abs(b1 - b0) / 2),
            D: dist * 0.18,
            H,
            kind: 3,
            seed,
        });
    };
    if (!smile && frame.cam) {
        const free = frame.free || { left: 0.35, right: 0.75 };
        veil(-0.06, Math.min(0.36, free.left - 0.03), -0.75, 2300, 105, 23);
        veil(Math.max(0.62, free.right + 0.03), 1.08, -0.9, 2900, 120, 37);
    }
    const atBearing = (bearing, dist, elevDeg, W, D, H, kind, seed) => {
        const y = Math.tan(elevDeg * DEG) * dist;
        out.push({
            x: Math.sin(bearing) * dist, y, z: -Math.cos(bearing) * dist, W, D, H, kind, seed,
        });
    };
    // The tower: the storm's crown, its flat base on the storm wall's (the dome's shower base),
    // so the wall's rain hangs under both. It stands clear of the card's edge (a cloud cut by the
    // UI is a tangent): its right flank keeps a few degrees of the wall's dark heart showing.
    if (!smile) {
        const dist = 20000;
        const W = 4000;
        let bearing = showerBearing - 0.035;
        if (frame.cam && frame.free) {
            const card = unproject(frame.free.left, frame.horizon, frame.cam, [0, 0, -1]);
            bearing = Math.min(bearing, Math.atan2(card[0], -card[2]) - Math.atan(W / 2 / dist) - 5 * DEG);
        }
        atBearing(bearing, dist, 3.3, W, 2600, 5800, 0, 11);
        return out;
    }
    // A smile frame shows only a strip of sky over the horizon: a tower whose crown would stand
    // above the frame's top edge is only a slab of its dark foot hanging from the edge. It stands
    // lower and smaller there, its crown inside the frame, or (no room for one) not at all.
    const dist = 17000;
    const base = 1.2;
    const y = Math.tan(base * DEG) * dist;
    const dir = [Math.sin(showerBearing), 0, -Math.cos(showerBearing)];
    let H = 3000;
    if (frame.cam) {
        // The highest elevation a crown may reach on that bearing: a little inside the top edge.
        const p = project(dir, frame.cam);
        const room = unproject(p.x, 0.035, frame.cam, [0, 0, -1]);
        const top = Math.tan(Math.asin(Math.max(-1, Math.min(1, room[1])))) * dist;
        H = Math.min(H, top - y);
    }
    if (H < 900) return out;
    atBearing(showerBearing, dist, base, Math.min(3400, H * 1.2), 2000, H, 0, 11);
    return out;
}

/**
 * The puffs of one cloud (world space), appended to `puffs`. A cloud is drawn as its outline:
 * heads along its edge (big at the foot, smaller and more crowded up toward the crown, so the top
 * is cauliflower), a row along the flat base, and a few large ones behind to fill it. A tower
 * stands on steep sides that narrow as it climbs; a bank or a small cumulus is a low dome.
 */
function cloudPuffs(c, count, puffs) {
    const rand = mulberry32(c.seed * 977 + 13);
    const len = Math.hypot(c.x, c.z);
    // Across the view and along it (the cloud is wider than it is deep, as seen).
    const ax = -c.z / len;
    const az = c.x / len;
    const dx = c.x / len;
    const dz = c.z / len;
    const tower = c.kind === 0;
    const add = (u, v, h, r) => {
        const hf = Math.max(0, Math.min(1, h / c.H));
        puffs.push({
            x: c.x + ax * u + dx * v,
            y: c.y + h,
            z: c.z + az * u + dz * v,
            r,
            hf,
            seed: rand() * 100,
            ox: u / (c.W * 0.5),
            oz: v / (c.D * 0.5),
            base: c.y,
            H: c.H,
            kind: c.kind,
        });
    };
    // The outline: half-width at a height (a tower narrows and rounds over at the crown).
    const halfW = c.W * 0.5;
    const edge = (phi) => {
        // phi from -pi/2 (left foot) over the top (0) to +pi/2 (right foot)
        const t = Math.cos(phi) ** [0.28, 0.45, 0.7][c.kind];
        const w = Math.sin(phi) * halfW * (tower ? 1 - 0.42 * t : 1);
        return [w, t * c.H];
    };
    // A tower's crown is a few turrets at their own heights, the tallest a little off centre.
    const turrets = tower ? [[-0.34, 0.8, 0.36], [0.04, 1.0, 0.42], [0.38, 0.7, 0.3]] : [];
    const crownAt = (w) => turrets.reduce((top, [cx, ht, rw]) => {
        const d = (w / halfW - cx) / rw;
        return Math.max(top, d * d < 1 ? ht * c.H * (0.62 + 0.38 * Math.sqrt(1 - d * d)) : 0);
    }, 0);
    // A tower keeps its outline to a few dozen big heads (more would melt into one smooth edge)
    // and spends the rest on its face: heads standing out of it, each its own billow.
    const nBase = Math.max(2, Math.round(count * (tower ? 0.08 : 0.2)));
    const nEdge = tower ? Math.min(46, Math.max(16, Math.round(count * 0.24))) : Math.max(3, Math.round(count * 0.6));
    const nFace = tower ? Math.round(count * 0.34) : 0;
    const nFill = Math.max(1, count - nBase - nEdge - nFace);
    const size = (t) => c.H * (tower ? 0.2 - 0.09 * t : 0.5 - 0.16 * t);
    // Behind first (they are drawn first anyway: the sort is by distance), filling the body up
    // into the crown.
    for (let i = 0; i < nFill; i++) {
        const t = 0.15 + 0.8 * rand();
        const r = size(t) * (1.15 + rand() * 0.4);
        const w = (rand() - 0.5) * 1.1 * halfW * (1 - (tower ? 0.5 : 0.4) * t);
        add(w, c.D * (0.1 + rand() * 0.3), Math.max(r * 0.5, t * c.H * 0.86), r);
    }
    // The face: billows standing out of the tower's front, smaller up toward the crown.
    for (let i = 0; i < nFace; i++) {
        const t = Math.min(0.95, 0.08 + 0.92 * Math.sqrt(rand()));
        const span = halfW * (1 - 0.42 * t) * 0.8;
        const w = (rand() * 2 - 1) * span;
        const top = Math.min(c.H * t, crownAt(w) * 0.94);
        const r = size(top / c.H) * (0.7 + rand() * 0.5);
        add(w, -c.D * (0.2 + rand() * 0.25), Math.max(r * 0.5, top - r * 0.3), r);
    }
    // The flat base: a row of heads whose bottoms the shader cuts flat.
    for (let i = 0; i < nBase; i++) {
        const f = nBase > 1 ? i / (nBase - 1) : 0.5;
        const r = size(0) * (0.85 + rand() * 0.3);
        add((f - 0.5) * 2 * (halfW - r * 0.6), (rand() - 0.5) * c.D * 0.4, r * 0.55, r);
    }
    // The edge, the crown's heads crowding in smaller.
    for (let i = 0; i < nEdge; i++) {
        const s = (i + 0.5 + (rand() - 0.5) * 0.6) / nEdge;
        const phi = (s - 0.5) * Math.PI;
        const [w, h0] = edge(phi);
        // The tower's top follows its turrets.
        const h = tower && h0 > c.H * 0.6 ? Math.max(c.H * 0.6, Math.min(h0, crownAt(w))) : h0;
        const t = h / c.H;
        const r = size(t) * (tower ? 0.95 + rand() * 0.5 : 0.65 + rand() * 0.7);
        // In from the outline by most of a radius, so the heads' rims make the edge; the crown's
        // heads stand at their own heights (turrets), the sides' bulge out and in.
        const cx = 0;
        const cy = c.H * 0.42;
        const nx = cx - w;
        const ny = cy - h;
        const k = 1 / Math.max(1e-3, Math.hypot(nx, ny));
        const turret = t > 0.8 ? (rand() - 0.35) * r * (tower ? 0.9 : 0.5) : (rand() - 0.5) * r * 0.2;
        add(w + nx * k * r * 0.62, (rand() - 0.6) * c.D * 0.35, Math.max(r * 0.5, h + ny * k * r * 0.62 + turret), r);
    }
}

/**
 * The puffs of a veil: long, low heads overlapping along its length (each drawn `stretch` times as
 * wide as it is tall), higher and fuller toward its middle and thinning to wisps at its ends, in
 * two loose rows so it has a front and a back.
 */
function veilPuffs(c, count, puffs) {
    const rand = mulberry32(c.seed * 613 + 5);
    const len = Math.hypot(c.x, c.z);
    const ax = -c.z / len;
    const az = c.x / len;
    const dx = c.x / len;
    const dz = c.z / len;
    for (let i = 0; i < count; i++) {
        const f = (i + 0.5 + (rand() - 0.5) * 0.7) / count;
        const u = (f - 0.5) * c.W;
        // Fullest in its middle, a wisp at either end (a long sine, nudged by the seed).
        const body = Math.sin(Math.PI * Math.min(1, Math.max(0, f))) ** 0.7 * (0.75 + 0.25 * Math.sin(f * 9.1 + c.seed));
        const r = c.H * (0.45 + 0.55 * body) * (0.8 + rand() * 0.4);
        const v = (i % 2 === 0 ? 0.25 : -0.2) * c.D + (rand() - 0.5) * c.D * 0.3;
        const h = c.H * (0.15 + 0.5 * body) + (rand() - 0.5) * c.H * 0.25;
        puffs.push({
            x: c.x + ax * u + dx * v,
            y: c.y + h,
            z: c.z + az * u + dz * v,
            r,
            hf: Math.max(0, Math.min(1, 0.35 + h / c.H)),
            seed: rand() * 100,
            ox: u / (c.W * 0.5),
            oz: v / (c.D * 0.5),
            // (Its base well under every head: a veil has no flat base, it thins out downward.)
            base: c.y - c.H * 2,
            H: c.H,
            kind: 3,
            stretch: 2.6 + rand() * 1.6,
        });
    }
}

/**
 * @param {object} p
 * @param {object} p.tier  the quality tier (cumulusPuffs)
 * @param {object} p.U     the world's uniforms
 * @param {object} p.tex   { noise }
 */
export function createCumulus({ tier, U, tex }) {
    const capacity = tier.cumulusPuffs ?? 220;
    const base = new THREE.PlaneGeometry(2, 2);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.getAttribute('position'));
    const data = new Float32Array(capacity * STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(data, STRIDE);
    geometry.setAttribute('iPuff', new THREE.InterleavedBufferAttribute(buffer, 4, 0)); // xyz, radius
    geometry.setAttribute('iTone', new THREE.InterleavedBufferAttribute(buffer, 4, 4)); // heightFrac, seed, ox, oz
    geometry.setAttribute('iCloud', new THREE.InterleavedBufferAttribute(buffer, 4, 8)); // baseY, H, kind, stretch
    geometry.instanceCount = 0;

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    material.name = 'rainbow-terraces-cumulus';
    const puff = attribute('iPuff', 'vec4');
    const tone = attribute('iTone', 'vec4');
    const cloud = attribute('iCloud', 'vec4');
    const vLocal = varying(vec2(0.0), 'vCuLocal');
    const vWorld = varying(vec3(0.0), 'vCuWorld');
    // The bow's strokes at each corner of a puff (the stroke loops run per vertex, as the spray's).
    const vStrokes = varying(vec4(0.0), 'vCuStrokes');
    const vThread = varying(vec3(0.0), 'vCuThread');
    const vThread2 = varying(vec3(0.0), 'vCuThread2');
    material.vertexNode = Fn(() => {
        // A veil's heads drift slowly to and fro along the wind (never away: the frame is composed).
        const veil = smoothstep(2.5, 3.5, cloud.z);
        const sway = sin(U.mistClock.mul(0.004).add(tone.y)).mul(cloud.y.mul(0.9)).mul(veil);
        const centre = puff.xyz.add(vec3(sway, 0.0, sway.mul(0.3)));
        const view = cameraViewMatrix.mul(vec4(centre, 1.0));
        const g = positionGeometry.xy;
        vLocal.assign(g);
        // (A veil's heads are long and low: drawn `stretch` times as wide as they are tall.)
        const span = vec2(puff.w.mul(max(cloud.w, 1.0)), puff.w);
        const at = view.xyz.add(vec3(g.mul(span), 0.0));
        // The point's world position (the billboard turned back into the world).
        const world = centre.add(cameraViewMatrix.transpose().mul(vec4(g.mul(span), 0.0, 0.0)).xyz).toVar();
        vWorld.assign(world);
        const thread = vec3(0.0).toVar();
        const thread2 = vec3(0.0).toVar();
        vStrokes.assign(bowStrokes(normalize(world.sub(cameraPosition)), U, thread, thread2));
        vThread.assign(thread);
        vThread2.assign(thread2);
        return cameraProjectionMatrix.mul(vec4(at, 1.0));
    })();
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = Fn(() => {
        const { light } = U;
        const local = vLocal;
        const r2 = dot(local, local);
        const nz = sqrt(max(float(1.0).sub(r2), 0.0));
        const hf = tone.x;
        const inv = cameraViewMatrix.transpose();
        const camRight = inv.mul(vec4(1.0, 0.0, 0.0, 0.0)).xyz;
        const camUp = inv.mul(vec4(0.0, 1.0, 0.0, 0.0)).xyz;
        const camBack = inv.mul(vec4(0.0, 0.0, 1.0, 0.0)).xyz;
        // The tower is the storm's crown; the others are fair-weather cumulus.
        const tower = max(float(1.0).sub(cloud.z), 0.0);
        // The cloud's form: outward from its axis, turning up toward the crown. The puff's offsets
        // are in the cloud's own frame (ox across the view, oz along it, away from the eye), so
        // the face standing toward the eye (oz < 0) turns toward it.
        const deep = normalize(puff.xz.add(vec2(0.0, -1e-3)));
        const across = vec2(deep.y.negate(), deep.x);
        const out = across.mul(tone.z.mul(2.2)).add(deep.mul(tone.w.mul(1.2)));
        const formN = normalize(vec3(out.x, hf.mul(1.6).sub(0.45), out.y).add(camBack.mul(0.35)));
        const puffN = camRight.mul(local.x).add(camUp.mul(local.y)).add(camBack.mul(nz));
        const N = normalize(formN.add(puffN.mul(1.5))).toVar();
        // Lit full face by the sun behind the eye; each billow's underside in its own mass's
        // shade, the foot darker still, sky light on the tops.
        const lit = pow(scWrap(dot(N, U.shadeKey), float(0.35)), 1.2)
            .mul(float(1.0).sub(float(1.0).sub(smoothstep(-0.9, 0.35, local.y)).mul(0.5)))
            .mul(mix(float(0.6), float(1.0), smoothstep(0.0, 0.5, hf)));
        // The rose and pearl hours: the Earth's shadow climbs the cloud; only the crown burns.
        const line = cloud.x.add(cloud.y.mul(U.twilight.mul(0.7)));
        const inShadow = float(1.0).sub(smoothstep(line.sub(cloud.y.mul(0.06)), line.add(cloud.y.mul(0.06)), vWorld.y));
        const col = cloudLight(U, lit, max(N.y.negate(), 0.0).mul(0.8).add(0.1), inShadow, { gain: U.cloudGain }).toVar();
        col.addAssign(skyBase(vec3(0.0, 1.0, 0.0), U).mul(max(N.y, 0.0).mul(0.1)));
        // The tower's lower body is the storm itself: dark slate in its own rain and shade, the
        // billows still showing; only the crown stands in the sun.
        // (By the point's own height, so the dark climbs the tower smoothly across the puffs.)
        // (Measured mostly by the billow's own height, a little by the point's, so the dark climbs
        // the tower billow by billow along a cauliflower edge, never across it in a level band.)
        const jitter = fract(tone.y.mul(0.618)).sub(0.5).mul(0.14);
        const rise = mix(vWorld.y.sub(cloud.x).div(cloud.y), tone.x.add(jitter), 0.65);
        // (And across its form: the flank toward the storm's heart turns slate over its last
        // billows, so the lit crown grades into the dark wall, never a white cut-out against it.)
        const shower = smoothstep(0.15, 0.55, U.showerAmt);
        const storm = max(
            float(1.0).sub(smoothstep(0.2, 0.5, rise)),
            smoothstep(0.25, 0.8, tone.z).mul(float(1.0).sub(smoothstep(0.7, 0.95, rise))).mul(0.8),
        ).mul(tower).mul(shower);
        // Each billow of the storm's body shows by its lighter brow over a darker underside.
        const brow = smoothstep(-0.7, 0.75, local.y).mul(lit);
        const slate = light.shower.mul(mix(float(0.5), float(1.4), brow)).add(light.mistLit.mul(max(N.y.negate(), 0.0).mul(0.03)));
        col.assign(mix(col, slate, storm));
        // The air between: far clouds stand only a few shades off it.
        const rel = vWorld.sub(cameraPosition);
        const dist = length(rel);
        const V = rel.div(dist);
        // The shower's rain hangs in front of the tower: the bow is painted on it there.
        const bearing = scWrapPi(atan(V.x, V.z.negate()).sub(U.shower.x)).div(U.shower.y);
        const rain = exp(bearing.mul(bearing).mul(-1.2)).mul(U.showerAmt).mul(tower)
            .mul(float(1.0).sub(smoothstep(0.35, 0.9, hf)).mul(0.6).add(0.4));
        const opt = optics(V, U, tex, {
            rain, deep: false, deepMist: float(0.0), strokes: { masks: vStrokes, thread: vThread, thread2: vThread2 },
        });
        col.assign(col.mul(float(1.0).sub(opt.w)).add(opt.xyz));
        // (The air under the storm lies in its shadow: little airlight before its dark body.)
        const air = float(1.0).sub(exp(dist.div(-26000.0))).mul(float(1.0).sub(storm.mul(0.8)));
        col.assign(mix(col, airColour(V, U), air.mul(0.82)));
        // A torn, billowing edge (each puff its own noise): crisp on the crown, softer in the
        // storm's foot where the rain blurs it; and a flat base.
        const p = local.mul(0.3).add(vec2(tone.y.mul(0.137), tone.y.mul(0.071)))
            .add(vec2(U.mistClock.mul(0.0015), 0.0));
        const n = texture(tex.noise, p).g.mul(0.6).add(texture(tex.noise, p.mul(2.3).add(0.31)).a.mul(0.4));
        // A veil is thin vapour: its heads torn deeper at the edge, soft all round, thinning out
        // downward, and broken along its length into drifts and gaps fixed in the air it lies in
        // (so the heads drift through them), its lower half taking the light the sea throws up.
        const veil = smoothstep(2.5, 3.5, cloud.z);
        const edge = length(local).add(n.sub(0.5).mul(mix(mix(float(0.45), float(0.7), storm), float(1.05), veil)));
        const soft = mix(mix(float(0.74), float(0.45), storm), float(0.12), veil);
        // The tower's base is the storm's: level, but sagging and torn along its run (the puff's
        // own noise and a broad one across the cloud), and its foot thins out into the rain.
        const sagN = texture(tex.noise, vec2(vWorld.x.mul(1 / 3200), vWorld.z.mul(1 / 3200)).add(0.29)).r;
        const baseLine = cloud.x.sub(cloud.y.mul(sagN.sub(0.5).mul(0.07).add(n.sub(0.5).mul(0.04))));
        const flat = smoothstep(baseLine.sub(cloud.y.mul(0.02)), baseLine.add(cloud.y.mul(0.06)), vWorld.y);
        const body = float(1.0).sub(smoothstep(soft, 0.92, edge));
        const drift = texture(tex.noise, vWorld.xz.mul(1 / 1400).add(vec2(0.37, U.mistClock.mul(0.00002)))).r;
        const gaps = smoothstep(0.36, 0.7, drift.add(n.sub(0.5).mul(0.3)));
        const thin = mix(float(0.97), smoothstep(-1.0, 0.5, local.y).mul(gaps).mul(0.4), veil);
        col.assign(mix(col, col.add(light.mistLit.mul(0.08)), veil.mul(float(1.0).sub(smoothstep(-0.6, 0.3, local.y)))));
        const alpha = body.mul(flat).mul(thin);
        return vec4(col.mul(alpha), alpha);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'rainbow-terraces-cumulus';
    mesh.frustumCulled = false;
    mesh.renderOrder = 52;

    return {
        mesh,
        capacity,
        /** Lay the clouds out for a solved frame (sorted back to front from the eye). */
        place(frame, showerBearing) {
            const clouds = cumulusPlan(frame, showerBearing);
            // Puffs shared by size: the tower takes the most.
            const weight = clouds.map((c) => c.W * c.H * (c.kind === 0 ? 1.6 : 1));
            // A veil takes a fixed share of the buffer (its puffs are few and long); the tower and
            // the rest share what is left by size.
            const perVeil = Math.max(10, Math.round(capacity * 0.08));
            const veils = clouds.filter((c) => c.kind === 3).length;
            const shared = capacity - veils * perVeil;
            const total = clouds.reduce((sum, c, i) => sum + (c.kind === 3 ? 0 : weight[i]), 0) || 1;
            const counts = clouds.map((c, i) => (c.kind === 3 ? perVeil
                : Math.max(c.kind === 2 ? 12 : 10, Math.floor((shared * weight[i]) / total))));
            // Never more than the buffer holds (the sort below would drop the nearest).
            const over = counts.reduce((a, b) => a + b, 0) / capacity;
            const puffs = [];
            clouds.forEach((c, i) => {
                const n = over > 1 ? Math.floor(counts[i] / over) : counts[i];
                (c.kind === 3 ? veilPuffs : cloudPuffs)(c, n, puffs);
            });
            puffs.sort((a, b) => Math.hypot(b.x, b.y, b.z) - Math.hypot(a.x, a.y, a.z));
            const n = Math.min(capacity, puffs.length);
            for (let i = 0; i < n; i++) {
                const q = puffs[i];
                data.set([q.x, q.y, q.z, q.r, q.hf, q.seed, q.ox, q.oz, q.base, q.H, q.kind, q.stretch ?? 1], i * STRIDE);
            }
            geometry.instanceCount = n;
            buffer.needsUpdate = true;
            return n;
        },
        dispose() {
            base.dispose();
            geometry.dispose();
            material.dispose();
        },
    };
}
