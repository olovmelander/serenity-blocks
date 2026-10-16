/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Infinity's ascent sky in isolation: the layer the game lays between the theme and the board
 * while the player looks around the tower (src/ui/infinity/ascent/ascent-sky-world.js, the
 * same class), drawn here over a stand-in theme (a dusk valley that sinks or lifts as the game's
 * theme layer does) and under a stand-in well, so the composition can be judged.
 *
 * URL (all optional):
 *   ascentRise=<rows>      the view above the player's rows (negative: below), default 14
 *   ascentSpeed=<rows/s>   how fast it moves, + rising (motes stream and streak), default 0
 *   ascentPresence=<0..1>  how present the look is, default 1
 *   ascentTheme=<id>       borrow that theme's colours from its icon (as the game does)
 *   ascentBoard=0          leave the stand-in well out
 *   ascentMotion=0         reduced motion (no streaks, sway or twinkle)
 *   ascentQuality=High|Medium|Low   the sky's tier, default High
 *   t=<s>
 */

import * as THREE from 'three/webgpu';
import {
    Fn, abs, clamp, float, floor, fract, hash, length, max, mix, positionGeometry, sin, smoothstep,
    uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { AscentSkyWorld } from '../../ui/infinity/ascent/ascent-sky-world.js';
import { themeShift, viewMetrics } from '../../ui/infinity/ascent/ascent-model.js';
import { loadThemeTints } from '../../ui/infinity/ascent/ascent-tints.js';

export const meta = {
    id: 'infinity-ascent',
    title: 'Infinity Ascent',
    description: 'The sky between the theme and the board while the player looks around Infinity\'s tower',
};

/** The stand-in tower: its grid, the rows the player plays in, the board's share of the screen. */
const BOARD_ROWS = 140;
const VISIBLE = 20;
const HOME = 76;
const BOARD_SHARE = 0.78;

const num = (params, name, fallback) => {
    const value = Number(params.get(name));
    return params.has(name) && Number.isFinite(value) ? value : fallback;
};

/** A dusk valley in display values, sunk by `sink` (screen fraction, + down). */
function createBackdrop(u) {
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    material.blending = THREE.NoBlending;
    material.vertexNode = vec4(positionGeometry.xy.mul(2), 0.5, 1);
    material.fragmentNode = Fn(() => {
        const p = uv();
        const x = p.x.sub(0.5).mul(u.aspect);
        const y = float(1).sub(p.y).sub(u.sink);
        const horizon = float(0.57);
        const dusk = smoothstep(0.0, 0.6, y);
        const sky = mix(vec3(0.13, 0.19, 0.38), vec3(0.9, 0.59, 0.48), dusk.mul(dusk));
        const sun = smoothstep(0.16, 0.0, length(vec2(x.sub(0.42), y.sub(0.52)))).mul(0.55);
        const far = horizon.sub(0.07).sub(sin(x.mul(3.1).add(1)).mul(0.035)).sub(sin(x.mul(7.7)).mul(0.012));
        const near = horizon.add(0.02).sub(sin(x.mul(2.2).add(4)).mul(0.03)).sub(sin(x.mul(9.1)).mul(0.008));
        const colour = sky.add(vec3(1, 0.78, 0.55).mul(sun)).toVar();
        colour.assign(mix(colour, vec3(0.32, 0.25, 0.36), smoothstep(far, far.add(0.004), y)));
        colour.assign(mix(colour, vec3(0.16, 0.12, 0.2), smoothstep(near, near.add(0.004), y)));
        const lake = smoothstep(horizon.add(0.1), horizon.add(0.104), y);
        const mirrored = mix(vec3(0.62, 0.42, 0.42), vec3(0.2, 0.22, 0.36), smoothstep(0.67, 1.0, y));
        colour.assign(mix(colour, mirrored, lake));
        // Above the world's top edge (it has sunk): nothing, the sky covers it.
        return vec4(colour.mul(smoothstep(-0.002, 0.0, y)), 1);
    })();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    return mesh;
}

/** The well: dark glass between aqua walls, a tower of blocks that scrolls with the view. */
function createWell(u) {
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    material.transparent = true;
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    material.vertexNode = vec4(positionGeometry.xy.mul(2), 0.5, 1);
    material.fragmentNode = Fn(() => {
        const p = uv();
        const x = p.x.sub(0.5).mul(u.aspect);
        const y = float(1).sub(p.y);
        const half = float(BOARD_SHARE / 4);
        const top = float(0.16);
        const bottom = top.add(BOARD_SHARE);
        const inside = smoothstep(half.add(0.002), half, abs(x)).mul(smoothstep(top, top.add(0.002), y))
            .mul(smoothstep(bottom.add(0.002), bottom, y));
        const wall = smoothstep(0.004, 0.0, abs(abs(x).sub(half))).mul(smoothstep(top.add(0.15), top.add(0.4), y))
            .mul(smoothstep(bottom.add(0.004), bottom, y));
        // Cells: a row is BOARD_SHARE / VISIBLE of the screen; the camera's top row scrolls them.
        const rowH = float(BOARD_SHARE / VISIBLE);
        const row = floor(y.sub(top).div(rowH).add(u.top));
        const col = floor(x.add(half).div(half.mul(2)).mul(10));
        const built = smoothstep(u.summit.sub(0.5), u.summit, row);
        const filled = hash(row.add(4096).mul(16).add(col)).lessThan(float(0.62).mul(built));
        const cellUv = fract(vec2(x.add(half).div(half.mul(2)).mul(10), y.sub(top).div(rowH).add(u.top)));
        const bevel = smoothstep(0.0, 0.12, cellUv.x).mul(smoothstep(1.0, 0.88, cellUv.x))
            .mul(smoothstep(0.0, 0.12, cellUv.y)).mul(smoothstep(1.0, 0.88, cellUv.y));
        const pick = hash(row.mul(7).add(col.mul(3)).add(9001));
        const cool = mix(vec3(0.62, 0.55, 1.0), vec3(0.62, 0.91, 0.93), smoothstep(0.2, 0.5, pick));
        const palette = mix(cool, vec3(1.0, 0.82, 0.55), smoothstep(0.6, 0.9, pick));
        const glass = vec3(0.035, 0.03, 0.095);
        const cell = filled.select(float(1), float(0)).mul(bevel);
        const colour = mix(glass, palette.mul(0.85), cell);
        const alpha = max(inside.mul(mix(float(0.88), float(1), cell)), wall.mul(0.9));
        const wallLight = clamp(wall.mul(float(1).sub(inside)).add(wall.mul(0.6)), 0, 1);
        const rgb = mix(colour, vec3(0.83, 0.96, 0.97), wallLight);
        return vec4(rgb.mul(alpha), alpha);
    })();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    return mesh;
}

export function create({
    scene, renderer, params, sizes,
}) {
    const previousColorSpace = renderer.outputColorSpace;
    // The ascent is authored in display values, as the game's own canvas writes them.
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    const asked = params.get('ascentQuality');
    const quality = ['High', 'Medium', 'Low'].includes(asked) ? asked : 'High';
    const world = new AscentSkyWorld({ quality, over: true }).build(scene);
    const u = {
        aspect: uniform(16 / 9),
        sink: uniform(0),
        top: uniform(HOME),
        summit: uniform(BOARD_ROWS - 62),
    };
    const backdrop = createBackdrop(u);
    scene.add(backdrop);
    const well = params.get('ascentBoard') === '0' ? null : createWell(u);
    if (well) scene.add(well);

    const rise = num(params, 'ascentRise', 14);
    const speed = num(params, 'ascentSpeed', 0);
    const presence = Math.min(1, Math.max(0, num(params, 'ascentPresence', 1)));
    const motion = params.get('ascentMotion') === '0' ? 0 : 1;
    const themeId = params.get('ascentTheme');
    if (themeId) loadThemeTints(themeId).then((tints) => { if (tints) world.setTints(tints); });

    let viewport = { width: sizes?.width || 1600, height: sizes?.height || 900 };
    const resize = (width, height) => {
        viewport = { width, height };
        world.setViewport(width, height);
        u.aspect.value = width / height;
    };
    resize(viewport.width, viewport.height);

    let state = null;
    const update = (time) => {
        // The view sits `rise` rows above the player's rows and moves at `speed`: the sky and the
        // depths follow the place, the motes the moving camera.
        const top = HOME - rise;
        const m = viewMetrics({
            top, home: HOME, visibleRows: VISIBLE, boardLength: BOARD_ROWS, summitRow: BOARD_ROWS - 62,
        });
        const rowPx = (viewport.height * BOARD_SHARE) / VISIBLE;
        const rowScreen = rowPx / viewport.height;
        const shift = motion * presence * themeShift(m.riseRows, rowPx, viewport.height);
        const moving = top - speed * time;
        u.sink.value = shift / viewport.height;
        u.top.value = moving;
        state = {
            presence,
            sky: m.sky,
            deep: m.deep,
            dim: 0.12,
            gapTop: shift > 0 ? shift / viewport.height : 0,
            gapBottom: shift < 0 ? -shift / viewport.height : 0,
            scroll: moving * rowScreen,
            speed: Math.max(-1, Math.min(1, speed / 40)),
            flow: -speed * rowScreen,
            time,
            motion,
        };
        world.setState(state);
    };

    return {
        update(time) { update(time); },
        seek(time) { update(time); },
        resize,
        getDiagnostics() {
            return {
                backend: renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2', tier: world.tierName, state,
            };
        },
        dispose() {
            world.dispose();
            backdrop.removeFromParent();
            backdrop.geometry.dispose();
            backdrop.material.dispose();
            if (well) {
                well.removeFromParent();
                well.geometry.dispose();
                well.material.dispose();
            }
            renderer.outputColorSpace = previousColorSpace;
        },
    };
}
