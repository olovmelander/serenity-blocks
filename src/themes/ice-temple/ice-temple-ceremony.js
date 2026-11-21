/**
 * Cut glass that forms in the open side aisles. The patterns are built once: their small
 * diamond-shaped panes share a draw and one table of clocks. The pane is shaded across its four
 * bevels, with an indigo body, silver seams and a sliver of colour on the edge opposite the key.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cos, exp, float, int, max, min, mix, positionGeometry,
    sin, smoothstep, step, uniform, uniformArray, uv, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import { cardUnion } from './ice-temple-composition.js';
import {
    REST_RIG, TAU, itFxMaterial, itPart, itQuadGeometry, mulberry32,
} from './ice-temple-tsl.js';

// Order also sets precedence when several awards are delivered in one cascade.
const FIGURES = Object.freeze({
    triple: 0, cascade: 1, twist: 2, level: 3, perfect: 4, ending: 5,
});
const LIFETIMES = [1.55, 2.0, 2.35, 3.6, 4.3, 3.8];
// Vertical centre and height of each pattern in its own coordinates. A narrow phone fits a
// single figure in the lintel above the well instead of trying to fit two in its thin margins.
const VERTICAL_BOUNDS = [[1.8, 4.1], [3.9, 9.6], [0, 5.4], [4.0, 8.6], [0, 6.0], [1, 7]];

function glassPatterns() {
    const places = [];
    const cuts = [];
    const cues = [];
    const motion = [];
    let kind;
    let height;
    let depth;
    let twist;
    let rise;
    let fall;
    function group(name, centre, z, turn, lift, settle) {
        kind = FIGURES[name]; height = centre; depth = z;
        twist = turn; rise = lift; fall = settle;
    }
    // The middle of a cut is broad. Its two acute tips meet the adjacent cuts like lead came.
    function pane(x, y, angle, length, width, delay, hue, dz = 0) {
        for (const side of [-1, 1]) {
            places.push(x, y, depth + dz, side);
            cuts.push(angle, length, width, hue);
            cues.push(kind, delay, height, twist);
            motion.push(rise, fall, ...VERTICAL_BOUNDS[kind]);
        }
    }
    function link(ax, ay, bx, by, width, delay, hue) {
        const dx = bx - ax;
        const dy = by - ay;
        pane((ax + bx) / 2, (ay + by) / 2, Math.atan2(dy, dx), Math.hypot(dx, dy), width, delay, hue);
    }
    const polar = (radius, angle) => [Math.cos(angle) * radius, Math.sin(angle) * radius];

    // Three lines fan open like a palmette springing from the foot of the nearest pillar.
    group('triple', 0.22, -11, 0.18, 0.18, 0.35);
    for (let i = -3; i <= 3; i++) {
        const a = Math.PI / 2 + i * 0.23;
        const len = 3.45 - Math.abs(i) * 0.38;
        const tip = polar(len, a);
        link(0, 0, ...tip, 0.21, Math.abs(i) * 0.045, (i + 3) / 6);
        pane(tip[0] * 1.09, tip[1] * 1.09, a, 0.23, 0.095, Math.abs(i) * 0.045 + 0.2, 0.7);
    }

    // Each successive wave steps out of the sanctuary, toward the player and down to the ice.
    group('cascade', 1.2, -12, 0, 1.4, 0.8);
    for (let i = 0; i < 8; i++) {
        const k = i / 7;
        const x = (1 - k) * -1.9;
        const y = (1 - k) ** 1.4 * 7.0;
        const z = (1 - k) * -18;
        pane(x, y, Math.PI / 2 + 0.25, 1.42, 0.48, k * 0.7, k, z);
        pane(x - 0.38, y - 0.42, Math.PI / 2 - 0.3, 0.75, 0.18, k * 0.7 + 0.04, 1 - k, z);
        pane(x + 0.22, y + 0.82, Math.PI / 2 + 0.25, 0.31, 0.12, k * 0.7 + 0.085, 0.85, z);
    }

    // A twist winds three counter-curved ice fronds around a single bright hub.
    group('twist', 5.0, -13.5, 1.55, 0.2, 0.45);
    for (let arm = 0; arm < 3; arm++) {
        const startAngle = (arm * TAU) / 3;
        let previous = polar(0.15, startAngle);
        for (let i = 1; i <= 12; i++) {
            const k = i / 12;
            const a = startAngle + k * 2.65;
            const next = polar(0.15 + k * 2.35, a);
            link(...previous, ...next, 0.13 + 0.13 * Math.sin(k * Math.PI), k * 0.38, arm / 2);
            if (i % 3 === 1) {
                const leaf = polar(0.37 * (0.5 + k), a - 0.4);
                link(...next, next[0] + leaf[0], next[1] + leaf[1], 0.105, k * 0.38 + 0.07, k);
            }
            previous = next;
        }
    }
    pane(0, 0, Math.PI / 2, 0.75, 0.46, 0, 0.5);

    // At the level change two ranks of organ pipes rise from their stone line.
    group('level', 0.18, -14, 0, 1.6, 0.35);
    for (let i = -5; i <= 5; i++) {
        const h = 7.7 - Math.abs(i) * 0.98 + (Math.abs(i) % 2) * 0.44;
        const x = i * 0.34;
        const delay = (i + 5) * 0.065;
        pane(x, h * 0.51, Math.PI / 2, h, 0.29, delay, (i + 5) / 10);
        pane(x, h + 0.31, Math.PI / 2, 0.47, 0.16, delay + 0.28, 0.85);
    }

    // A perfect clear lights two rose windows. Eight pointed petals surround the boss, each
    // infilled with a broad pane and joined to the next by its narrow perimeter cuts.
    group('perfect', 5.6, -15, 0.13, 0.15, 0.15);
    for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8;
        const root = polar(0.52, a);
        const l = polar(1.63, a - 0.25);
        const r = polar(1.63, a + 0.25);
        const tip = polar(2.55, a);
        const tint = (i % 4) / 3;
        link(...root, ...l, 0.135, 0.12, tint);
        link(...root, ...r, 0.135, 0.12, tint);
        link(...l, ...tip, 0.14, 0.32, tint);
        link(...r, ...tip, 0.14, 0.32, tint);
        pane(...polar(1.48, a), a, 1.68, 0.45, 0.2, tint);
        link(...polar(2.66, a), ...polar(2.66, a + TAU / 8), 0.09, 0.53, 1 - tint);
        pane(...polar(2.78, a), a, 0.36, 0.14, 0.6, 0.9);
        link(...polar(0.53, a), ...polar(0.53, a + TAU / 8), 0.13, 0, 0.85);
    }
    pane(0, 0, Math.PI / 2, 0.89, 0.54, 0, 1);

    // The final chord falls out of tune: uneven, separated splinters sinking toward the floor.
    const rand = mulberry32(0x1ce73);
    group('ending', 4.7, -14.5, 0, 0.12, 4.4);
    for (let i = 0; i < 22; i++) {
        pane(
            (rand() - 0.5) * 4.1,
            rand() * 3.8,
            Math.PI / 2 + (rand() - 0.5) * 0.4,
            0.45 + rand() * 1.32,
            0.1 + rand() * 0.13,
            rand() * 0.64,
            rand() * 0.43,
            -rand() * 3,
        );
    }
    return itQuadGeometry(places.length / 4, {
        aPane: [new Float32Array(places), 4],
        aCut: [new Float32Array(cuts), 4],
        aCue: [new Float32Array(cues), 4],
        aMotion: [new Float32Array(motion), 4],
    });
}

export function createCeremonialIce(u) {
    const geometry = glassPatterns();
    const material = itFxMaterial('IceTempleCeremonialIce');
    const rows = LIFETIMES.map(() => new THREE.Vector4(-100, 0, 1, -100));
    const clocks = uniformArray(rows, 'vec4');
    // Side aisle centres (screen fractions) and their free width. Recomputed at layout changes.
    const aisles = uniform(new THREE.Vector4(0.2, 0.81, 0.38, 0.34));
    const lintel = uniform(new THREE.Vector2(0.5, 0));
    const place = attribute('aPane', 'vec4');
    const cut = attribute('aCut', 'vec4');
    const cue = attribute('aCue', 'vec4');
    const motion = attribute('aMotion', 'vec4');
    const vLight = varyingProperty('vec2', 'itPaneLight');
    const vTint = varyingProperty('vec3', 'itPaneTint');
    material.positionNode = Fn(() => {
        const clock = clocks.element(int(cue.x)).toVar();
        const age = u.time.sub(clock.x).sub(cue.y).toVar();
        const timeLeft = clock.w.sub(u.time).toVar();
        const appear = smoothstep(0, 0.34, age).toVar();
        const visible = step(0, age).mul(step(0, timeLeft)).mul(step(0.001, clock.y)).toVar();
        const swell = appear.mul(smoothstep(0, 0.65, timeLeft)).toVar();
        const right = step(0, place.w).toVar();
        const overhead = step(0.001, lintel.y).toVar();
        const anchor = mix(mix(aisles.x, aisles.y, right), lintel.x, overhead).mul(2).sub(1);
        const depth = float(REST_RIG.z).sub(place.z).toVar();
        // The first piers stand 12 m away. Keep the glass in front of them, at the same angular
        // size and elevation as the full-size drawing. A receding cascade retains its ordering.
        const near = float(6.8).add(depth.mul(0.065)).toVar();
        const perspective = near.div(depth).toVar();
        const screenHeight = near.div(u.projScale).toVar();
        const screenWidth = screenHeight.mul(u.viewport.x).div(u.viewport.y).toVar();
        // Clip the physical size to the available aisle on a narrow or multiplayer layout.
        const sideSize = min(perspective, mix(aisles.z, aisles.w, right).mul(screenWidth).div(6.5));
        const topSize = min(screenWidth.mul(0.62).div(6), lintel.y.mul(screenHeight).mul(0.82).div(motion.w));
        const size = mix(sideSize, topSize, overhead).toVar();
        const ease = float(1).sub(exp(max(age, 0).mul(-2.5))).toVar();
        const turn = cue.w.mul(float(1).sub(ease)).mul(clock.z).toVar();
        const axis = cut.x.add(turn).toVar();
        const active = visible.mul(float(1).sub(overhead.mul(right))).toVar();
        const stretch = mix(float(1), appear, clock.z).mul(active);
        const local = positionGeometry.xy.mul(vec2(cut.y.mul(stretch), cut.z.mul(active)));
        const px = place.x.mul(cos(turn)).sub(place.y.mul(sin(turn)))
            .add(local.x.mul(cos(axis))).sub(local.y.mul(sin(axis)));
        const py = place.x.mul(sin(turn)).add(place.y.mul(cos(turn)))
            .add(local.x.mul(sin(axis))).add(local.y.mul(cos(axis)));
        const sink = smoothstep(0.1, 3.6, age).mul(motion.y);
        const dy = float(1).sub(ease).mul(motion.x).add(sink)
            .mul(clock.z);
        const sideY = float(REST_RIG.height).add(cue.z.sub(REST_RIG.height).mul(perspective));
        const rayY = float(0.5).sub(lintel.y.mul(0.51)).div(u.projScale);
        const pitch = Math.tan(REST_RIG.pitch);
        const topY = float(REST_RIG.height).add(near.mul(rayY.add(pitch)).div(float(1).sub(rayY.mul(pitch))))
            .sub(motion.z.mul(size));
        const y = mix(sideY, topY, overhead).add(py.sub(dy).mul(size));
        const z = float(REST_RIG.z).sub(near);
        const enamel = mix(vec3(0.1, 0.49, 0.93), vec3(0.62, 0.37, 0.92), smoothstep(0.35, 0.78, cut.w));
        const opal = mix(enamel, vec3(0.76, 0.96, 0.76), smoothstep(0.72, 1.0, cut.w));
        vTint.assign(mix(opal, u.auroraB, 0.2));
        vLight.assign(vec2(swell.mul(clock.y), ease));
        return vec3(anchor.mul(screenWidth).mul(0.5).add(px.mul(size).mul(place.w)), y, z);
    })();
    material.fragmentNode = Fn(() => {
        const q = uv().sub(0.5).mul(2).toVar();
        const d = abs(q.x).add(abs(q.y)).toVar();
        const rim = smoothstep(0.63, 0.93, d).toVar();
        const mask = float(1).sub(smoothstep(0.92, 1, d));
        const exposure = vLight.x.mul(mask).toVar();
        const face = smoothstep(-0.04, 0.04, q.y).mul(0.61)
            .add(smoothstep(-0.055, 0.055, q.x).mul(0.29)).toVar();
        const ridge = exp(abs(q.y).mul(-21)).toVar();
        const hue = mix(vTint, vec3(0.79, 0.93, 1), rim.mul(0.65).add(ridge.mul(0.29)));
        const glass = hue.mul(face.mul(0.78).add(0.13).add(rim.mul(1.15)).add(ridge.mul(0.65)));
        const gleam = exp(abs(q.x.sub(vLight.y.mul(2.8).sub(1.25))).mul(-9)).mul(0.8);
        const alpha = exposure.mul(float(0.45).add(rim.mul(0.13)));
        return vec4(glass.add(hue.mul(gleam)).mul(exposure), min(alpha, 0.83));
    })();
    const part = itPart('IceTempleCeremonialIce', geometry, material, 27, false);
    part.setLayout = (layout) => {
        const card = cardUnion(layout);
        if (!card) return;
        const hud = layout.cardCount > 0 ? layout.hud : null;
        let leftSpace = Math.max(0, Math.min(1, card.x0));
        let rightStart = Math.max(0, Math.min(1, card.x1));
        if (hud && hud.x1 > 0 && hud.x0 < 1) {
            if (hud.x0 >= card.x1 - 0.01) rightStart = Math.max(rightStart, Math.min(1, hud.x1));
            if (hud.x1 <= card.x0 + 0.01) leftSpace = Math.min(leftSpace, Math.max(0, hud.x0));
        }
        const rightSpace = 1 - rightStart;
        aisles.value.set(leftSpace * 0.56, 1 - rightSpace * 0.56, leftSpace, rightSpace);
        const aspect = u.viewport.value.x / Math.max(1, u.viewport.value.y);
        const headroom = Math.max(0, Math.min(0.43, card.y0, hud && hud.x0 < 0.5 && hud.x1 > 0.5 ? hud.y0 : 1));
        const narrow = Math.max(leftSpace, rightSpace) * aspect < 0.13;
        lintel.value.set(0.5, narrow && headroom > 0.035 ? headroom : 0);
    };
    part.fire = (kind, time, strength = 1, reducedMotion = false) => {
        const id = FIGURES[kind];
        if (id === undefined) return;
        // One main figure can hold the aisle. A four-line clear followed immediately by a small
        // cascade keeps its rose, while a perfect clear grows through a fading lesser figure.
        if (rows.some((row, other) => other > id && row.w > time + 0.35)) return;
        for (let i = 0; i < id; i++) rows[i].w = Math.min(rows[i].w, time + 0.33);
        const row = rows[id];
        if (row.w <= time + 0.01) row.x = time;
        row.y = Math.max(0, Math.min(1.4, strength));
        row.z = reducedMotion ? 0.06 : 1;
        row.w = time + LIFETIMES[id];
    };
    part.reset = () => { for (const row of rows) row.set(-100, 0, 1, -100); };
    return part;
}
