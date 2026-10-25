import * as THREE from 'three/webgpu';
import { AuroraPost } from '../../themes/aurora/aurora-post.js';
import { AuroraWorld } from '../../themes/aurora/aurora-world.js';

export const meta = {
    id: 'aurora',
    title: 'Aurora — the playable sky',
    description: 'Marched auroral curtains over snow peaks and a mirror lake; locks pluck the sky.',
};

const STEP = 1 / 60;
/** Seconds between the clears of a replayed streak. */
const STREAK_SPACING = 0.9;
/** A hot run into a fever: lines per clearing lock, one lock every STORM_SPACING seconds. */
const STORM_CHAIN = [1, 1, 2, 1, 2, 2, 3, 2, 2, 3, 3, 4];
const STORM_SPACING = 0.64;
const STORM_COLORS = ['#6cf5ff', '#ff88ee', '#ffd166', '#9b8cff', '#7dff9a'];
/** Quick hands: this many locks, one every RUSH_SPACING seconds, none clearing. */
const RUSH_LOCKS = 12;
const RUSH_SPACING = 0.42;
/** The theme-icon lens: vertical field of view and yaw in degrees, horizon as a frame fraction. */
const ICON_LENS = {
    fov: 48, yaw: 7, horizon: 0.29, reach: 60,
};

/**
 * URL parameters (all optional):
 *   quality=High            tier
 *   event=lock|clear|quad|tspin|perfect|level|combo|storm|rush   gameplay cue to replay under ?t=
 *                           (storm: a hot run of twelve clearing locks into a fever;
 *                           rush: twelve quick locks that clear nothing)
 *   eventAge=0.45           seconds between the cue (a streak's or storm's last) and the frame
 *   lines=1  combo=5  column=4.5  drop=0  color=%236cf5ff
 *   board=1                 draw a stand-in board and aim events above it
 *   reduce=1                reduced-motion behaviour
 *   icon=1                  the theme-icon framing: a tighter lens turned to the fold of the
 *                           leading arc (iconFov, iconYaw, iconHorizon override it)
 */
export function create({
    scene, camera, renderer, params,
}) {
    const quality = params.get('quality') || 'High';
    const world = new AuroraWorld({ scene, camera, quality });
    const post = new AuroraPost({
        renderer, scene, camera, preset: world.preset,
    });
    world.setReducedMotion(params.get('reduce') === '1');
    const size = new THREE.Vector2();
    let board = null;
    if (params.get('board') === '1') {
        board = document.createElement('div');
        // Sized like the real single-player playfield: a fifth of the width, most of the height.
        board.style.cssText = 'position:fixed;left:50%;top:52.5%;transform:translate(-50%,-50%);'
            + 'width:19.5vw;height:81vh;border:1px solid #9fe8d544;'
            + 'border-radius:12px;background:#0b1020ee;pointer-events:none;z-index:3';
        document.body.appendChild(board);
    }
    const number = (key, fallback) => {
        const value = Number(params.get(key) ?? fallback);
        return Number.isFinite(value) ? value : fallback;
    };
    const iconPose = params.get('icon') === '1';
    const aimIcon = () => {
        camera.fov = number('iconFov', ICON_LENS.fov);
        camera.updateProjectionMatrix();
        const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
        const pitch = Math.atan((1 - 2 * number('iconHorizon', ICON_LENS.horizon)) * Math.tan(halfFov));
        const yaw = THREE.MathUtils.degToRad(number('iconYaw', ICON_LENS.yaw));
        const { rest, rig } = world;
        rig.setFocus(
            rest.x + Math.sin(yaw) * Math.cos(pitch) * ICON_LENS.reach,
            rest.y + Math.sin(pitch) * ICON_LENS.reach,
            rest.z - Math.cos(yaw) * Math.cos(pitch) * ICON_LENS.reach,
        );
        rig.apply(0, rest);
    };
    const syncViewport = () => {
        renderer.getDrawingBufferSize(size);
        world.prepareCamera(window.innerWidth / window.innerHeight);
        if (iconPose) aimIcon();
        world.setViewport(size.x, size.y);
        post.setSize(window.innerWidth, window.innerHeight);
        if (board) {
            const rect = board.getBoundingClientRect();
            world.setBoardSpan(0, rect.left / window.innerWidth, rect.right / window.innerWidth);
        }
    };
    syncViewport();

    const piece = (color = params.get('color') || '#6cf5ff') => ({
        x: number('column', 4.5) - 1.5,
        y: 18,
        shape: [[1, 1, 1, 1]],
        color,
    });
    const fire = (kind, lines = number('lines', 1), color = undefined) => {
        const { director } = world;
        if (kind === 'level') {
            director.onLevelUp({ level: 2 });
            return;
        }
        const drop = number('drop', 0);
        if (drop > 0) director.onHardDrop({ distance: drop });
        director.onPieceLock({ piece: piece(color) });
        if (kind === 'lock') return;
        const count = kind === 'quad' ? 4 : Math.max(1, Math.min(4, kind === 'tspin' ? 2 : lines));
        director.onLineClear({ lineCount: count, clearedRows: Array.from({ length: count }, (_, i) => 23 - i) });
        if (kind === 'tspin') director.onTSpin({ lineCount: count });
        if (kind === 'perfect') director.onPerfectClear({ depth: 1 });
    };
    const frame = (time, dt) => {
        world.update(time, dt);
        const { director } = world;
        post.update({
            activity: director.activity, surge: director.surge, heat: director.heatLevel, fever: director.heatFever,
        });
    };

    let sought = null;
    const seek = (time) => {
        if (!Number.isFinite(time) || time === sought) return;
        sought = Math.max(0, time);
        world.reset();
        const kind = params.get('event');
        const last = Math.max(0, sought - Math.max(0, number('eventAge', 0.45)));
        // A streak is replayed as real consecutive clears, so the combo is earned; a storm
        // as a hot run of them, so the fever is earned too; a rush as quick locks alone.
        const storm = kind === 'storm';
        const rush = kind === 'rush';
        const streak = kind === 'combo' ? Math.max(2, Math.floor(number('combo', 5))) : 1;
        let count = streak;
        if (storm) count = STORM_CHAIN.length;
        else if (rush) count = RUSH_LOCKS;
        let spacing = STREAK_SPACING;
        if (storm) spacing = STORM_SPACING;
        else if (rush) spacing = RUSH_SPACING;
        const cues = Array.from({ length: count }, (_, i) => last - (count - 1 - i) * spacing);
        const steps = Math.max(1, Math.ceil(sought / STEP));
        const dt = sought / steps;
        let next = 0;
        while (next < cues.length && cues[next] < 0) next += 1;
        for (let i = 1; i <= steps; i += 1) {
            const t = dt * i;
            while (kind && next < cues.length && t >= cues[next]) {
                if (storm) fire('clear', STORM_CHAIN[next], STORM_COLORS[next % STORM_COLORS.length]);
                else if (rush) fire('lock', 0, STORM_COLORS[next % STORM_COLORS.length]);
                else fire(kind === 'combo' ? 'clear' : kind);
                next += 1;
            }
            frame(t, dt);
        }
    };

    window.__AURORA_ART__ = { world, post, fire };
    return {
        cameraRadius: 1,
        camera() {},
        seek,
        update(time, dt) { if (!params.has('t')) frame(time, Math.min(0.05, Math.max(0, dt))); },
        render() {
            world.renderBuffers(renderer);
            post.render();
        },
        resize: syncViewport,
        getDiagnostics() { return { ...world.getDiagnostics(), post: post.getDiagnostics() }; },
        dispose() {
            post.dispose();
            world.dispose();
            board?.remove();
            delete window.__AURORA_ART__;
        },
    };
}
