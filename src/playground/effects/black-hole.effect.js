import * as THREE from 'three/webgpu';
import { SHAPES } from '../../core/constants.js';
import { BlackHolePost } from '../../themes/black-hole/black-hole-post.js';
import { BLACK_HOLE_TETROMINOS } from '../../themes/black-hole/black-hole-tetrominos.js';
import { BlackHoleWorld } from '../../themes/black-hole/black-hole-world.js';

export const meta = {
    id: 'black-hole',
    title: 'Black Hole — the hole you feed',
    description: 'A ray-traced Schwarzschild black hole: lensed disk, photon ring and galaxy.',
};

const STEP = 1 / 60;
/**
 * The theme-icon lens: the hole dead centre and nearly edge-on, so the shadow, the arch of
 * the far side over it and the blade of the near side across it all sit inside a circle.
 */
const ICON_POSE = {
    azimuth: 3.42, elevation: 0.205, radius: 1000, frame: 0, up: -8, fov: 27, roll: -0.42,
};
/** A small circle wants a little more light than a full screen: the icon's per-term gains. */
const ICON_LIFT = {
    exposure: 1.18, sky: 2.4, stars: 1.7, disk: 1.08,
};
/** Seconds between the clears of a replayed streak. */
const STREAK_SPACING = 0.9;

/**
 * URL parameters (all optional):
 *   quality=High            tier
 *   az=0.6 el=0.2 dist=1045 hold the camera at this azimuth / elevation (radians) / distance
 *   frame=-0.6 up=0         the hole's place across the frame (NDC) and its lift in world units
 *   event=lock|drop|clear|double|triple|quad|twist|twist0|b2b|perfect|cascade|combo|break|level|over|touch
 *   eventAge=0.45           seconds after the featured cue (the final wave for a cascade)
 *   depth=3                 number of cascade waves, including the first clear (2–8)
 *   lines=1  combo=5  column=4.5  row=20  drop=16  color=%23ac87f4
 *                           drop defaults to 16 rows for event=drop and 0 otherwise
 *   board=1                 draw a stand-in board and launch fed pieces from it
 *   reduce=1                reduced-motion behaviour
 *   level=2                 the game's level: each is one mood forward on top of the clock's
 *                           (t= shows the clock's mood; black-hole-moods.js MOOD_PERIOD)
 *   icon=1                  the theme-icon framing (iconFov, iconRoll, iconAz, iconEl override it)
 *   disk= ring= heat=       scale what the director set; sky= stars= doppler= corona= nebula= bloom=
 *                           exposure= set the term outright — for bisecting a look one term at a time
 */
export function create({
    scene, camera, renderer, params,
}) {
    const quality = params.get('quality') || 'High';
    const world = new BlackHoleWorld({ scene, camera, quality });
    const post = new BlackHolePost({
        renderer, scene, camera, preset: world.preset, tone: params.get('tone') || undefined,
    });
    world.setReducedMotion(params.get('reduce') === '1');
    if (params.has('level')) world.setLevel(Number(params.get('level')), { silent: true });
    const number = (key, fallback) => {
        const value = Number(params.get(key) ?? fallback);
        return Number.isFinite(value) ? value : fallback;
    };
    if (params.get('icon') === '1') {
        world.pose = {
            ...ICON_POSE,
            azimuth: number('iconAz', ICON_POSE.azimuth),
            elevation: number('iconEl', ICON_POSE.elevation),
            fov: number('iconFov', ICON_POSE.fov),
            roll: number('iconRoll', ICON_POSE.roll),
        };
    } else if (params.has('az') || params.has('el') || params.has('dist')) {
        world.pose = {
            azimuth: number('az', 0),
            elevation: number('el', 0.2),
            radius: number('dist', 1045),
            frame: number('frame', 0),
            up: number('up', 0),
        };
    }
    let board = null;
    if (params.get('board') === '1') {
        board = document.createElement('div');
        // Sized like the real single-player playfield: a fifth of the width, most of the height.
        board.style.cssText = 'position:fixed;left:50%;top:52.5%;transform:translate(-50%,-50%);'
            + 'width:19.5vw;height:81vh;border:1px solid #c4d1ff44;'
            + 'border-radius:12px;background:#07080fee;pointer-events:none;z-index:3';
        document.body.appendChild(board);
    }
    const size = new THREE.Vector2();
    const syncViewport = () => {
        renderer.getDrawingBufferSize(size);
        world.prepareCamera(window.innerWidth / window.innerHeight);
        world.setViewport(size.x, size.y);
        post.setSize(window.innerWidth, window.innerHeight);
        if (board) {
            const rect = board.getBoundingClientRect();
            world.setBoardRect(0, {
                left: rect.left / window.innerWidth,
                right: rect.right / window.innerWidth,
                top: rect.top / window.innerHeight,
                bottom: rect.bottom / window.innerHeight,
            });
        }
    };
    syncViewport();

    const order = ['T', 'L', 'Z', 'I', 'O', 'S', 'J'];
    let locks = 0;
    const dispatch = ({ kind, lines, depth }) => {
        const { director } = world;
        if (kind === 'touch') {
            director.onTouch(0.25, 0.55);
            return;
        }
        if (kind === 'level') {
            const level = world.gameLevel + 1;
            world.setLevel(level);
            director.onLevelUp({ level });
            return;
        }
        if (kind === 'over') {
            director.endRun();
            return;
        }
        if (kind === 'crown') {
            director.onPerfectClear({ depth: 1 });
            return;
        }
        if (kind !== 'wave') {
            const drop = number('drop', kind === 'drop' ? 16 : 0);
            if (drop > 0) director.onHardDrop({ distance: drop });
            const type = kind.startsWith('twist') ? 'T' : order[locks % order.length];
            locks += 1;
            director.onPieceLock({
                piece: {
                    x: number('column', 4.5) - 1,
                    y: number('row', 20),
                    shape: SHAPES[type],
                    color: params.get('color') || BLACK_HOLE_TETROMINOS.colors[type],
                },
            });
        }
        if (kind === 'drop' || kind === 'lock') return;
        if (kind === 'twist0') {
            director.onTwist({ lineCount: 0 });
            return;
        }
        const count = {
            quad: 4, b2b: 4, triple: 3, double: 2, twist: 2,
        }[kind] ?? lines;
        director.onLineClear({
            lineCount: count, clearedRows: Array.from({ length: count }, (_, i) => 23 - i), cascadeCount: depth,
        });
        if (kind === 'twist') director.onTwist({ lineCount: count });
        if (kind === 'b2b') director.onBackToBack({ active: true });
        if (kind === 'wave') director.onCascade({ comboCount: depth });
    };

    // Offsets are relative to the featured beat: eventAge starts at the actual crown, B2B,
    // final cascade wave, or the lock that reveals a broken streak.
    const sequence = (kind, lineCount) => {
        const lines = Math.min(4, Math.max(1, Math.round(lineCount)));
        const cue = (type, offset = 0, depth = 1) => ({
            kind: type, offset, lines, depth,
        });
        if (kind === 'combo' || kind === 'break') {
            const count = Math.min(16, Math.max(kind === 'break' ? 4 : 2, Math.floor(number('combo', 5))));
            const lead = kind === 'break' ? 1.2 : 0;
            const list = Array.from({ length: count }, (_, i) => cue('clear', (i + 1 - count) * STREAK_SPACING - lead));
            if (kind === 'break') list.push(cue('lock', -0.6), cue('lock'));
            return list;
        }
        if (kind === 'cascade') {
            const count = Math.min(8, Math.max(2, Math.floor(number('depth', 3))));
            return Array.from({ length: count }, (_, i) => cue(i ? 'wave' : 'clear', (i + 1 - count) * 0.45, i + 1));
        }
        if (kind === 'b2b') return [cue('quad', -1.6), cue('b2b')];
        if (kind === 'perfect') return [cue('clear', -0.38), cue('crown')];
        if (kind === 'over') return [cue('quad', -1.2), cue('over')];
        return ['lock', 'drop', 'clear', 'double', 'triple', 'quad', 'twist', 'twist0', 'level', 'touch'].includes(kind)
            ? [cue(kind)] : [];
    };
    let scheduled = [];
    const fire = (kind, lines = number('lines', 1)) => {
        const cues = sequence(kind, lines);
        if (!cues.length) return;
        dispatch(cues[0]);
        for (const cue of cues.slice(1)) {
            scheduled.push({ ...cue, at: world.time + cue.offset - cues[0].offset });
        }
        scheduled.sort((a, b) => a.at - b.at);
    };
    const lift = params.get('icon') === '1' ? ICON_LIFT : {};
    const overridden = (key) => params.has(key) || lift[key] !== undefined;
    const gain = (key, fallback) => number(key, lift[key] ?? fallback);
    const overrides = [
        ['disk', world.uniforms.diskGain], ['ring', world.uniforms.ringGain], ['sky', world.uniforms.skyGain],
        ['stars', world.uniforms.starGain], ['doppler', world.uniforms.doppler], ['heat', world.uniforms.diskHeat],
        ['corona', world.uniforms.coronaGain], ['nebula', world.uniforms.nebulaGain],
    ].filter(([key]) => overridden(key));
    const frame = (time, dt) => {
        while (scheduled.length && scheduled[0].at <= time) dispatch(scheduled.shift());
        world.update(time, dt);
        const { director } = world;
        post.update({
            energy: director.energy, flash: director.flash, iris: director.iris, ripples: world.ripples,
        });
        // The director drives disk, ring and heat each frame; an override scales what it set.
        for (const [key, target] of overrides) {
            const outright = ['sky', 'stars', 'doppler', 'corona', 'nebula'].includes(key);
            target.value = outright ? gain(key, target.value) : target.value * gain(key, 1);
        }
        if (params.has('bloom') && post.bloomNode) post.bloomNode.strength.value = number('bloom', 0);
        if (overridden('exposure')) post.uExposure.value = gain('exposure', 1);
    };

    let sought = null;
    const replay = (time, kind, age) => {
        sought = Math.max(0, time);
        world.reset();
        world.setLevel(number('level', 1), { silent: true });
        locks = 0;
        const last = Math.max(0, sought - Math.max(0, age));
        scheduled = sequence(kind, number('lines', 1))
            .map((cue) => ({ ...cue, at: last + cue.offset })).filter((cue) => cue.at >= 0);
        const steps = Math.max(1, Math.ceil(sought / STEP));
        const dt = sought / steps;
        for (let i = 1; i <= steps; i += 1) {
            const t = dt * i;
            frame(t, dt);
        }
    };
    const seek = (time) => {
        if (!Number.isFinite(time) || time === sought) return;
        replay(time, params.get('event'), number('eventAge', 0.45));
    };

    if (params.has('event') && !params.has('t')) fire(params.get('event'));
    window.__BLACK_HOLE_ART__ = {
        world,
        post,
        fire,
        preview(kind, age = 0.55, time = number('t', 12)) {
            replay(time, kind, age);
            post.render();
        },
    };
    return {
        cameraRadius: 1,
        camera() {},
        seek,
        update(time, dt) { if (!params.has('t')) frame(time, Math.min(0.05, Math.max(0, dt))); },
        render() { post.render(); },
        resize: syncViewport,
        getDiagnostics() { return { ...world.getDiagnostics(), post: post.getDiagnostics() }; },
        dispose() {
            post.dispose();
            world.dispose();
            board?.remove();
            delete window.__BLACK_HOLE_ART__;
        },
    };
}
