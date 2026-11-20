/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Nimbus Veil — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME NimbusWorld and NimbusVeilPost the theme ships, with the theme's lens,
 * camera rig and composition solver, so composition and grade are judged exactly as they will
 * look in game.
 *
 * URL params:
 *   quality=High|Ultra|...   content + post tier (default High)
 *   board=0                  no mock board (default: a mock gameplay board + HUD, the solo
 *                            layout rules from public/styles/main.css; the composition solver
 *                            reads its rect exactly as in game). board=0 → the centred menu shot
 *   hud=0                    board without the HUD mock
 *   event=<name>             play a gameplay event...
 *   eventAge=<s>             ...and show it <s> seconds after it began. Names: lock, hard,
 *                            clear (lines=<n>), quad, combo (a cascade of combo=<n> waves),
 *                            chain (chain=<n> clears in a row), chainEnd, twist, twist0 (no
 *                            lines), b2b (streak=<n>), perfect, levelUp, over (the run ends),
 *                            dawn (the run ends, and 4 s later the next begins), fever
 *   air=<name>               hold one air: fair, tails, mackerel, beams, mist (default: the clock's)
 *   happen=<kind>            hold one happening in every slot: skein, glitter, boil, meteor,
 *                            flicker (its age is t modulo the slot's 36 s)
 *   happenings=0             no happenings
 *   parts=sky,sea,...        draw only these parts (sky sea cumulus fx)
 *   noPost=1                 raw scene (no bloom/grade)
 *   pointerX / pointerY      hold a pointer-parallax offset (-1..1)
 *   level=<n>                the game's level: each is one mood forward on top of the clock's
 *                            (t=<s> shows the clock's mood; nimbus-veil-moods.js MOOD_PERIOD)
 */
import * as THREE from 'three/webgpu';
import { RIG } from '../../themes/nimbus-veil/nimbus-veil-tsl.js';
import { NimbusWorld, readBoardRect } from '../../themes/nimbus-veil/nimbus-veil-world.js';
import { NimbusVeilPost, POST_LOOK } from '../../themes/nimbus-veil/nimbus-veil-post.js';

export const meta = {
    id: 'nimbus-veil',
    title: 'Nimbus Veil (full world)',
    description: 'The shipping world + post: a golden sea of clouds, towering cumulus, rays, veils.',
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

    const world = new NimbusWorld({ scene, quality, random: rng || Math.random }).build();
    world.setLevel(num(params, 'level', 1), { silent: true });
    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));

    const usePost = params.get('noPost') !== '1';
    const look = POST_LOOK[quality] || POST_LOOK.High;
    const post = usePost ? new NimbusVeilPost(renderer, scene, camera, { look }) : null;
    const overlay = params.get('board') === '0' ? null : mountBoardOverlay(params.get('hud') !== '0');

    const pointerX = num(params, 'pointerX');
    const pointerY = num(params, 'pointerY');
    const eventName = params.get('event');
    const eventAge = num(params, 'eventAge', 0.4);
    const airParam = params.get('air');
    if (airParam) world.setAir(airParam);
    const happenParam = params.get('happen');
    world.setHappenings(params.get('happenings') !== '0', happenParam);

    /** The event as a script: [seconds after its start, what happens then], in order. */
    const eventScript = () => {
        const list = [];
        const at = (offset, fn) => list.push([offset, fn]);
        if (eventName === 'lock') at(0, () => world.onPieceLock());
        else if (eventName === 'hard') at(0, () => { world.onHardDrop(); world.onPieceLock(); });
        else if (eventName === 'clear') at(0, () => world.onLineClear(num(params, 'lines', 2)));
        else if (eventName === 'quad') at(0, () => world.onLineClear(4));
        else if (eventName === 'combo') {
            const waves = Math.max(2, num(params, 'combo', 4));
            at(0, () => world.onLineClear(2, { cascade: 1 }));
            for (let k = 2; k <= waves; k += 1) {
                at((k - 1) * 0.36, () => { world.onLineClear(1, { cascade: k }); world.onCombo(k); });
            }
        } else if (eventName === 'chain' || eventName === 'chainEnd') {
            const n = Math.max(2, num(params, 'chain', 5));
            for (let k = 1; k <= n; k += 1) {
                at((k - 1) * 0.7, () => {
                    world.onPieceLock({ chain: k - 1 });
                    world.onLineClear(1, { combo: k, chainStep: true });
                });
            }
            if (eventName === 'chainEnd') at(n * 0.7, () => world.onPieceLock({ chain: n }));
        } else if (eventName === 'twist') at(0, () => { world.onLineClear(2); world.onTwist(2); });
        else if (eventName === 'twist0') at(0, () => world.onTwist(0));
        else if (eventName === 'b2b') {
            const streak = Math.max(1, num(params, 'streak', 1));
            for (let k = 0; k < streak; k += 1) at(k * 2.2, () => { world.onLineClear(4); world.onB2B(); });
        } else if (eventName === 'perfect') {
            at(0, () => world.onLineClear(4));
            at(0.36, () => world.onPerfectClear());
        } else if (eventName === 'levelUp') {
            at(0, () => { world.setLevel(world.level + 1); world.onLevelUp(); });
        } else if (eventName === 'over') at(0, () => world.onGameOver());
        else if (eventName === 'dawn') {
            at(0, () => world.onGameOver());
            at(4, () => world.onSessionStart());
        } else if (eventName === 'fever') {
            for (let k = 0; k < 60; k += 1) {
                at(k * 0.4, () => {
                    world.onHardDrop();
                    world.onPieceLock({ chain: k });
                    world.onLineClear(1 + (k % 3), { combo: k + 1, chainStep: true });
                });
            }
        }
        return list;
    };

    const size = new THREE.Vector2();
    const sunUv = new THREE.Vector2();
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
        const vis = world.getSunScreen(camera, sunUv);
        const state = world.postState();
        post.update({
            time,
            sun: sunUv,
            sunVis: vis,
            bloomBoost: state.bloomBoost,
            rays: state.rays,
            exposure: state.exposure,
            dusk: state.dusk,
        });
    };
    const step = (time, dt) => {
        world.updateCamera(camera, sim(time, dt));
        world.update(sim(time, dt));
        pushPost(time);
    };
    // Seek: rebuild the event state at (t − age) so every capture of `t` is identical.
    const seekTo = (time) => {
        const t0 = Math.max(0, time - (eventName ? eventAge : 0));
        world.seek(t0);
        step(t0, 0);
        if (eventName) {
            world.setLevel(num(params, 'level', 1), { silent: true });
            const script = eventScript();
            const steps = Math.max(1, Math.round(eventAge * 60));
            const dt = eventAge / steps;
            let next = 0;
            for (let i = 0; i <= steps; i += 1) {
                const age = i * dt;
                if (i > 0) step(t0 + age, dt);
                while (next < script.length && script[next][0] <= age + 1e-6) {
                    script[next][1]();
                    next += 1;
                }
            }
        }
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
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.up.copy(saved.up);
            camera.updateProjectionMatrix();
        },
    };
}
