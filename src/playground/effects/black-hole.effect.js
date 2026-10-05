import * as THREE from 'three/webgpu';
import { BlackHolePost } from '../../themes/black-hole/black-hole-post.js';
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
 *   event=lock|clear|quad|tspin|perfect|level|combo   gameplay cue to replay under ?t=
 *   eventAge=0.45           seconds between the cue and the captured frame
 *   lines=1  combo=5  column=4.5  row=20  drop=0  color=%23f8b24f
 *   board=1                 draw a stand-in board and launch fed pieces from it
 *   reduce=1                reduced-motion behaviour
 *   icon=1                  the theme-icon framing (iconFov, iconRoll, iconAz, iconEl override it)
 *   disk= ring= heat=       scale what the director set; sky= stars= doppler= bloom= exposure= set
 *                           the term outright — for bisecting a look one term at a time
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

    const piece = () => ({
        x: number('column', 4.5) - 1,
        y: number('row', 20),
        shape: [[0, 1, 0], [1, 1, 1]],
        color: params.get('color') || '#f8b24f',
    });
    const fire = (kind, lines = number('lines', 1)) => {
        const { director } = world;
        if (kind === 'level') {
            director.onLevelUp({ level: 2 });
            return;
        }
        const drop = number('drop', 0);
        if (drop > 0) director.onHardDrop({ distance: drop });
        director.onPieceLock({ piece: piece() });
        if (kind === 'lock') return;
        const count = kind === 'quad' ? 4 : Math.max(1, Math.min(4, kind === 'tspin' ? 2 : lines));
        director.onLineClear({ lineCount: count, clearedRows: Array.from({ length: count }, (_, i) => 23 - i) });
        if (kind === 'tspin') director.onTSpin({ lineCount: count });
        if (kind === 'perfect') director.onPerfectClear({ depth: 1 });
    };

    const lift = params.get('icon') === '1' ? ICON_LIFT : {};
    const overridden = (key) => params.has(key) || lift[key] !== undefined;
    const gain = (key, fallback) => number(key, lift[key] ?? fallback);
    const overrides = [
        ['disk', world.uniforms.diskGain], ['ring', world.uniforms.ringGain], ['sky', world.uniforms.skyGain],
        ['stars', world.uniforms.starGain], ['doppler', world.uniforms.doppler], ['heat', world.uniforms.diskHeat],
    ].filter(([key]) => overridden(key));
    const frame = (time, dt) => {
        world.update(time, dt);
        post.update({ energy: world.director.energy, flash: world.director.flash, ripples: world.ripples });
        // The director drives disk, ring and heat each frame; an override scales what it set.
        for (const [key, target] of overrides) {
            const outright = ['sky', 'stars', 'doppler'].includes(key);
            target.value = outright ? gain(key, target.value) : target.value * gain(key, 1);
        }
        if (params.has('bloom') && post.bloomNode) post.bloomNode.strength.value = number('bloom', 0);
        if (overridden('exposure')) post.uExposure.value = gain('exposure', 1);
    };

    let sought = null;
    const seek = (time) => {
        if (!Number.isFinite(time) || time === sought) return;
        sought = Math.max(0, time);
        world.reset();
        const kind = params.get('event');
        const last = Math.max(0, sought - Math.max(0, number('eventAge', 0.45)));
        // A streak is replayed as real consecutive clears, so the combo is earned.
        const streak = kind === 'combo' ? Math.max(2, Math.floor(number('combo', 5))) : 1;
        const cues = Array.from({ length: streak }, (_, i) => last - (streak - 1 - i) * STREAK_SPACING)
            .filter((at) => at >= 0);
        const steps = Math.max(1, Math.ceil(sought / STEP));
        const dt = sought / steps;
        let next = 0;
        for (let i = 1; i <= steps; i += 1) {
            const t = dt * i;
            while (kind && next < cues.length && t >= cues[next]) {
                fire(kind === 'combo' ? 'clear' : kind);
                next += 1;
            }
            frame(t, dt);
        }
    };

    window.__BLACK_HOLE_ART__ = { world, post, fire };
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
