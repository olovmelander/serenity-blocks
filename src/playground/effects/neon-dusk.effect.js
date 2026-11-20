/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Neon Dusk — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME NeonDuskWorld and NeonDuskPost the theme ships, with the theme's lens, camera
 * rig and composition solver, so composition and grade are judged exactly as they will look in
 * game.
 *
 * URL params:
 *   quality=High|Ultra|...   content + post tier (default High)
 *   board=0                  no mock board (default: a mock gameplay board + HUD, the solo
 *                            layout rules from public/styles/main.css; the composition solver
 *                            reads its rect exactly as in game). board=0 → the centred menu shot
 *   hud=0                    board without the HUD mock
 *   event=lock|hardDrop|clear|combo|quad|twist|b2b|perfect|levelUp|gameOver|sunrise
 *                            fire a gameplay event...
 *   eventAge=<s>             ...and show it <s> seconds later (combo=<n>, lines=<n>, piece=<T..>,
 *                            streak=<n> back-to-backs in a row; sunrise = a run's end, then the
 *                            next run's start `eventAge` ago)
 *   event=locks              a run of `count` locks (default 6), one every `every` s (default
 *                            1), each piece and column in turn; eventAge is the last one's age
 *   event=chain              `count` clearing locks in a row (default 5), one every `every` s:
 *                            the combo's meter in the sun's slits, the heat building
 *   air=<0..4>               hold one air (default: the clock's): 0 clear, 1 cloud bars, 2 deep
 *                            sky, 3 haze, 4 lattice (neon-dusk-clock.js AIRS)
 *   happenings=0             none of the sky's visitors
 *   happen=meteors|comet|satellite|racers|flight   begin that happening...
 *   happenAge=<s>            ...and show it <s> seconds in (default 2)
 *   planetAt=<s>             pin the planet's round at that time (PLANET.period long)
 *   expose=1                 window.__NEON_DUSK__ = the world (diagnostics)
 *   parts=sky,mountains,...  draw only these parts (sky mountains ridges floor fx)
 *   noPost=1                 raw scene (no bloom/grade)
 *   reflect=<scale> blur=<mip> msaa=<n> chroma=0 bloom=0 dust=<n>   A/B overrides
 *   pointerX / pointerY      hold a pointer-parallax offset (-1..1)
 *   level=<n>                the game's level: each is one mood forward on top of the clock's
 *                            (t=<s> shows the clock's mood; neon-dusk-moods.js MOOD_PERIOD)
 */
import * as THREE from 'three/webgpu';
import { RIG } from '../../themes/neon-dusk/neon-dusk-tsl.js';
import { NeonDuskWorld, readBoardRect } from '../../themes/neon-dusk/neon-dusk-world.js';
import { flashScale } from '../../utils/photosensitivity.js';
import { NeonDuskPost, POST_LOOK } from '../../themes/neon-dusk/neon-dusk-post.js';

export const meta = {
    id: 'neon-dusk',
    title: 'Neon Dusk (full world)',
    description: 'The shipping world + post: the great sun sinking into a neon mountain pass over a glass floor.',
};

function num(params, key, fallback = 0) {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : fallback;
}

/**
 * A stand-in for the real solo layout (public/styles/main.css): the board is
 * min(clamp(220px, 22vw, 300px), (100vh − 250px)/2) wide and twice as tall, the HUD sits right
 * of it. The board carries the real selector so readBoardRect() finds it.
 */
function mountBoardOverlay(withHud) {
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5';
    const board = document.createElement('div');
    board.className = 'player-card';
    board.dataset.player = 'solo';
    board.style.cssText = [
        'position:absolute', 'left:50%', 'top:50%',
        'width:calc(min(clamp(220px, 22vw, 300px), (100vh - 250px) / 2) + 24px)',
        'height:calc(2 * min(clamp(220px, 22vw, 300px), (100vh - 250px) / 2) + 24px)',
        'transform:translate(-50%, -50%)', 'background:rgba(21,26,35,0.866)',
        'border:1px solid rgba(139,92,246,0.45)', 'border-radius:20px',
    ].join(';');
    root.append(board);
    if (withHud) {
        const hud = document.createElement('div');
        hud.className = 'single-player-stats-bar';
        hud.style.cssText = [
            'position:absolute', 'top:25%', 'height:50%',
            'left:calc(50% + min(clamp(220px, 22vw, 300px), (100vh - 250px) / 2) / 2 + 60px)',
            'width:min(clamp(120px, 12vw, 160px), 18vh)',
            'background:rgba(14,11,26,0.8)', 'border:1px solid rgba(150,110,255,0.25)', 'border-radius:10px',
        ].join(';');
        root.append(hud);
    }
    document.body.appendChild(root);
    return root;
}

export function create({
    scene, camera, renderer, params, rng,
}) {
    const quality = params.get('quality') || 'High';
    const saved = {
        fov: camera.fov, near: camera.near, far: camera.far, up: camera.up.clone(),
    };
    camera.near = RIG.near;
    camera.far = RIG.far;
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();

    const overrides = {};
    if (params.has('reflect')) overrides.reflection = num(params, 'reflect', 0.5);
    if (params.has('dust')) overrides.dust = num(params, 'dust', 180);
    if (params.has('blur')) overrides.reflectionBlur = num(params, 'blur', 1.6);
    const world = new NeonDuskWorld({
        scene, quality, random: rng || Math.random, overrides,
    }).build();
    world.bindCamera(camera);
    world.setLevel(num(params, 'level', 1), { silent: true });
    if (params.has('air')) world.tune.air = Math.round(num(params, 'air', 0));
    world.tune.happenings = params.get('happenings') !== '0';
    if (params.has('planetAt')) world.tune.planetTime = num(params, 'planetAt', 0);
    if (params.get('expose') === '1' && typeof window !== 'undefined') window.__NEON_DUSK__ = world;
    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));

    const usePost = params.get('noPost') !== '1';
    const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
    if (params.has('chroma')) look.chroma = params.get('chroma') !== '0';
    if (params.has('msaa')) look.msaa = num(params, 'msaa', look.msaa);
    if (params.has('bloom')) look.bloom = params.get('bloom') !== '0';
    const post = usePost ? new NeonDuskPost(renderer, scene, camera, { look }) : null;
    const overlay = params.get('board') === '0' ? null : mountBoardOverlay(params.get('hud') !== '0');

    const pointerX = num(params, 'pointerX');
    const pointerY = num(params, 'pointerY');
    const eventName = params.get('event');
    const eventAge = num(params, 'eventAge', 0.4);
    const happenName = params.get('happen');
    const happenAge = num(params, 'happenAge', 2);
    const fireEvent = () => {
        if (eventName === 'lock' || eventName === 'hardDrop') {
            if (eventName === 'hardDrop') world.onHardDrop();
            world.onPieceLock({
                type: params.get('piece') || 'T', x: num(params, 'x', 2), rotation: num(params, 'rot', 0),
            });
        } else if (eventName === 'combo') world.onCombo(num(params, 'combo', 4));
        else if (eventName === 'clear') world.onLineClear(num(params, 'lines', 2));
        else if (eventName === 'quad') world.onLineClear(4);
        else if (eventName === 'levelUp') world.onLevelUp();
        else if (eventName === 'perfect') world.onPerfectClear();
        else if (eventName === 'twist') world.onTwist(num(params, 'lines', 0));
        else if (eventName === 'b2b') {
            const streak = Math.max(1, Math.round(num(params, 'streak', 1)));
            for (let k = 0; k < streak; k += 1) world.onB2B(true);
        } else if (eventName === 'gameOver' || eventName === 'sunrise') world.onGameOver();
    };

    const size = new THREE.Vector2();
    const syncViewport = () => {
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        world.setLayout(aspect, overlay ? readBoardRect() : null, { immediate: true });
        camera.fov = world.lens.vfov;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        renderer.getDrawingBufferSize(size);
        post?.setSize(window.innerWidth, window.innerHeight, size.x, size.y);
    };
    syncViewport();

    const sim = (time, delta) => ({
        time, delta, pointerX, pointerY,
    });
    const pushPost = (time) => {
        if (!post) return;
        post.update({
            time,
            bloomBoost: Math.min(1, world.sunPulse),
            glitch: world.glitch * flashScale(),
            exposure: world.drive.exposure,
            bloomGain: world.drive.bloomGain,
        });
    };
    const step = (time, dt) => {
        world.updateCamera(camera, sim(time, dt));
        world.update(sim(time, dt));
        pushPost(time);
    };
    // A run of locks as a quick hand plays them: the pieces and columns in turn.
    const RUN = [['T', 1, 0], ['I', 7, 0], ['S', 3, 1], ['O', 8, 0], ['L', 0, 2], ['Z', 5, 0], ['J', 2, 3]];
    const lockRun = (time) => {
        const count = Math.max(1, Math.round(num(params, 'count', 6)));
        const every = Math.max(0.05, num(params, 'every', 1));
        let t = Math.max(0, time - eventAge - (count - 1) * every);
        world.seek(t);
        step(t, 0);
        for (let k = 0; k < count; k += 1) {
            const [type, x, rotation] = RUN[k % RUN.length];
            world.onPieceLock({ type, x, rotation });
            const span = k < count - 1 ? every : eventAge;
            const steps = Math.max(1, Math.round(span * 60));
            for (let i = 1; i <= steps; i += 1) step(t + (i * span) / steps, span / steps);
            t += span;
        }
        step(time, 0);
    };

    // A chain: clearing locks in a row, as a hot hand plays them.
    const chainRun = (time) => {
        const count = Math.max(1, Math.round(num(params, 'count', 5)));
        const every = Math.max(0.05, num(params, 'every', 0.7));
        let t = Math.max(0, time - eventAge - (count - 1) * every);
        world.seek(t);
        step(t, 0);
        for (let k = 0; k < count; k += 1) {
            const [type, x, rotation] = RUN[k % RUN.length];
            world.onHardDrop();
            world.onPieceLock({ type, x, rotation });
            world.onLineClear(1 + (k % 3), { cascade: 1 });
            const span = k < count - 1 ? every : eventAge;
            const steps = Math.max(1, Math.round(span * 60));
            for (let i = 1; i <= steps; i += 1) step(t + (i * span) / steps, span / steps);
            t += span;
        }
        step(time, 0);
    };

    // Seek: rebuild the event state at (t − age) so every capture of `t` is identical.
    const seekTo = (time) => {
        if (eventName === 'locks') {
            lockRun(time);
            return;
        }
        if (eventName === 'chain') {
            chainRun(time);
            return;
        }
        // A sunrise needs the night first: the run ends 9 s before the next one starts.
        const lead = eventName === 'sunrise' ? 9 : 0;
        const eAge = eventName ? eventAge : 0;
        const hAge = happenName ? happenAge : 0;
        const t0 = Math.max(0, time - Math.max(eAge + lead, hAge));
        world.seek(t0);
        step(t0, 0);
        const run = (from, to) => {
            if (!(to > from)) return;
            const steps = Math.max(1, Math.round((to - from) * 60));
            for (let i = 1; i <= steps; i += 1) step(from + ((to - from) * i) / steps, (to - from) / steps);
        };
        // The marks along the way, in the order they come.
        const marks = [];
        if (happenName) marks.push([time - hAge, () => world.startHappening(happenName, Math.max(0, time - hAge))]);
        if (eventName) marks.push([time - eAge - lead, fireEvent]);
        if (lead) marks.push([time - eAge, () => world.onSessionStart()]);
        marks.sort((a, b) => a[0] - b[0]);
        let at = t0;
        for (const [when, fire] of marks) {
            const due = Math.max(t0, when);
            run(at, due);
            at = Math.max(at, due);
            fire();
        }
        run(at, time);
        step(time, 0);
    };

    return {
        cameraRadius: 1,
        camera(time, cam) {
            world.updateCamera(cam, sim(time, 0));
        },
        update(time, dt) {
            step(time, dt);
        },
        seek(time) {
            seekTo(time);
        },
        render() {
            if (post) post.render();
            else renderer.render(scene, camera);
        },
        resize() {
            syncViewport();
        },
        dispose() {
            overlay?.remove();
            post?.dispose();
            world.dispose();
            camera.layers.set(0);
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.up.copy(saved.up);
            camera.updateProjectionMatrix();
        },
    };
}
