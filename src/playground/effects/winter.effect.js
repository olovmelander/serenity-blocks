/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Winter — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME WinterWorld and WinterPost the theme ships, with the theme's
 * camera rig, so composition and grade are judged exactly as they will look in game.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay a mock gameplay board + HUD (the solo layout rules); events
 *                            aim at its rects and the post's calm zones read them
 *   statsHud=0               with board=1: board only, no HUD mock
 *   combo=<n>                hold a combo of n (how brightly the fires burn)
 *   level=<n>                rest on level n's hour
 *   locks=<n>                before anything else, play n locks
 *   event=lock|drop|clear|quad|twist|spin|perfect|levelUp|over   fire a gameplay event...
 *   eventAge=<s>             ...and show it <s> seconds later (lines=<n>, row=<r>, u=<0..1>,
 *                            color=<hex>)
 *   power=<0..1>             hold the fires at this charge (overrides the chain)
 *   weather=<name|steps>     hold the weather (snowfall, clear, ice-haze, flurry, soft-flakes, or a
 *                            number of steps into the round: 1.5 is half-way from clear to ice haze)
 *   form=<name|steps>        hold the aurora's form (bands, arcs, rays, curtains, corona, pulsing)
 *   demo=1                   live only: play a looping gameplay script
 *   parts=sky,ground,...     draw only these parts
 *   falseColor=1             post debug view: band the pre-tone-map max channel
 *   noPost=1                 raw scene (no bloom/grade)
 *   bloom=0|1                override the tier's bloom
 *   msaa=<n>                 override the scene pass's samples
 *   px=-1..1&py=-1..1        hold a pointer-parallax offset
 *   still=1                  hold the camera at its rest pose (no drift or breath): what moves is the world
 *   reduce=1                 reduced motion
 *   plan=1                   skip the baked trees and draw the generated stand-ins
 *   fox=0                    do not fetch the fox's body
 *   foxCam=<metres>          a lens that keeps this far from the fox and follows it (foxCamYaw=<deg>
 *                            round it from its front, or `viewer` for the side the game sees;
 *                            foxCamFov=<deg>; foxCamAhead=<metres> and foxCamUp=<metres> move what it
 *                            looks at from the middle of the fox toward its head)
 *   foxAct=<acts>            stop the fox <foxActAge> seconds before the frame and have it do
 *                            these (comma-separated: Sit, or Listen,Pounce,Dig,Shake — `hunt` is that)
 *   foxTurn=<s>              have the fox pull up, look about, and go back the way it came <s>
 *                            seconds before the frame (the visitor does when the fox is in its way)
 *   foxAct=...               also its own acts: Scratch, SnowBath, Sphinx, StandTall, TailChase, PlayBow,
 *                            MouseLeap, HeadTilt, SkyGaze, Twirl, Pronk; `miss` is Listen,MouseLeap,HeadTilt;
 *                            `zoom` is a play bow and a romp (a few dashes this way and that)
 *   foxDo=twirl|gaze|rejoice have the fox answer the board (a twist, a new level, a perfect clear)
 *                            <foxActAge> seconds before the frame
 *   foxPace=walk|trot|lope|bound   hold the fox to one of its paces at rest
 *   visitor=<s>              have the second fox come in from beyond the left of the frame <s> seconds
 *                            before the frame (a few seconds later it is in sight)
 *   foxWho=visitor           foxCam, foxAct, foxDo and foxPace are the second fox's
 *   bear=0                   do not fetch the polar bear's body
 *   bearAt=<s>               put the bear <s> seconds into its own course at the frame (its walk is
 *                            a function of that clock: winter-bear-plan.js); with one of the next
 *                            five, <s> seconds into what that finds. A later seek finds it that
 *                            much further on, so one page gives a strip.
 *   bearLap=<n>              ...into its lap n (each lap is dealt from its seed: who walks it,
 *                            what it does at each stop, its paces)
 *   bearCast=male|female|family   ...into the first lap walked by that bear (family: a female
 *                            with her cub)
 *   bearDo=<act>             ...into the first stop at which it does that (Sit, Rest, Roll, Hunt,
 *                            Dig, Stretch, Upright, Shake, Sniff, Scent, Look); bearCubDo=<act>, the cub
 *                            (Sit, Roll, Pounce, Upright, Look, Scent, Shake, Dig)
 *   bearPace=amble|brisk|lope    ...either side of the middle of the first stretch it goes at that
 *                            pace; bearCubPace=lope, the cub running to catch up
 *   bearSeed=<n>             deal its laps from another seed
 *   bearAct=rear|wonder|lie|rise|scent|glance   have the board make it stand up (four lines), stand
 *                            up and sit down to watch (a perfect clear), lie down, get up again,
 *                            scent the wind (a level) or look to the board (a twist),
 *                            <bearActAge> seconds before the frame
 *   bearCam=<metres>         a lens that keeps this far from the bear and follows it (bearCamYaw=<deg>
 *                            round it from its front, or `viewer` for the side the game sees;
 *                            bearCamFov=<deg>; bearCamOn=cub follows the cub; bearCamAim=head looks
 *                            at its head)
 *   P.<name>=<value>         override a number of the look (LOOK in winter-tsl.js)
 *   icon=1                   the theme-icon framing: a longer lens raised to where the fox of light runs
 *                            (iconFov, iconYaw, iconPitch; capture a square frame)
 */
import * as THREE from 'three/webgpu';
import { WinterWorld } from '../../themes/winter/winter-world.js';
import { WinterPost, POST_LOOK } from '../../themes/winter/winter-post.js';
import { readLayoutRects } from '../../themes/winter/winter-composition.js';
import { planGhosts } from '../../themes/winter/winter-ghosts.js';
import { tuneLook } from '../../themes/winter/winter-tsl.js';
import { AURORA_FORMS, WEATHERS } from '../../themes/winter/winter-weather.js';
import { BearMind } from '../../themes/winter/winter-bear-plan.js';

export const meta = {
    id: 'winter',
    title: 'Winter (full world)',
    description: 'Fox fires: a snowfield in the polar twilight, and an arctic fox whose tail strikes the aurora from the snow.',
};

/** A held place in a round: a row's name, or a number of steps into it (null: its clock has it). */
function heldAt(table, value) {
    if (value === null || value === '') return null;
    const named = table.findIndex((row) => row.name === value);
    if (named >= 0) return named;
    const steps = Number.parseFloat(value);
    return Number.isFinite(steps) ? steps : null;
}

function num(params, key, fallback = 0) {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : fallback;
}

const BOARD_PX = 'min(clamp(220px, 22vw, 300px), (100vh - 250px) / 2)';

/** A stand-in for the real solo layout (public/styles/main.css) with the real class names. */
function mountBoardOverlay(withHud) {
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5';
    const card = document.createElement('div');
    card.className = 'player-card';
    card.dataset.player = 'solo';
    card.style.cssText = [
        'position:absolute', 'left:50%', 'top:50%',
        `width:calc(${BOARD_PX} * 1.19)`,
        `height:calc(2 * ${BOARD_PX} + 158px)`,
        'transform:translate(-50%, -50%)', 'background:rgba(21,26,35,0.866)',
        'border:1px solid rgba(160,190,255,0.4)', 'border-radius:20px',
    ].join(';');
    const board = document.createElement('div');
    board.id = 'single-player-game-canvas';
    board.style.cssText = [
        'position:absolute', 'left:50%', 'bottom:24px', `width:calc(${BOARD_PX})`, `height:calc(2 * ${BOARD_PX})`,
        'transform:translateX(-50%)', 'border:1px solid rgba(255,255,255,0.08)',
    ].join(';');
    card.append(board);
    root.append(card);
    if (withHud) {
        const hud = document.createElement('div');
        hud.className = 'single-player-stats-bar';
        hud.style.cssText = [
            'position:absolute', 'top:25%', 'height:50%',
            'left:calc(50% + min(max(300px, min(35vw, 400px)), (100vh - 200px) / 2) / 2 + 60px)',
            'width:140px',
            'background:rgba(14,16,26,0.8)', 'border:1px solid rgba(150,180,255,0.25)', 'border-radius:10px',
        ].join(';');
        root.append(hud);
    }
    document.body.appendChild(root);
    return root;
}

/** The game's piece colours (winter-tetrominos.js). */
const PIECE_COLORS = ['#5df2a6', '#eaf6ff', '#6de0ff', '#ff9ccf', '#b79bff', '#ffe2a0', '#4a9fd8'];

/** A looping script of locks and clears for the live demo (seconds into the loop). */
const DEMO_LOOP = 36;
const DEMO_SCRIPT = [
    [1.0, 'lock', { rows: [19], u: 0.2 }], [2.1, 'lock', { rows: [19, 18], u: 0.75 }],
    [3.2, 'lock', { rows: [18, 17], u: 0.4, hardDrop: true }], [4.3, 'lock', { rows: [17], u: 0.85 }],
    [5.4, 'lock', { rows: [19], u: 0.55 }],
    [5.4, 'clear', { rows: [19], lines: 1, combo: 1 }], [6.6, 'lock', { rows: [19, 18], u: 0.3 }],
    [6.6, 'clear', { rows: [19], lines: 1, combo: 2 }], [7.8, 'lock', { rows: [19, 18, 17], u: 0.8, hardDrop: true }],
    [7.8, 'clear', { rows: [19, 18], lines: 2, combo: 3 }], [9.0, 'lock', { rows: [19], u: 0.1 }],
    [9.0, 'clear', { rows: [19], lines: 1, combo: 4 }], [10.2, 'lock', { rows: [19, 18], u: 0.6 }],
    [10.2, 'clear', { rows: [19, 18, 17], lines: 3, combo: 5 }], [11.4, 'lock', { rows: [19], u: 0.5 }],
    [11.4, 'clear', { rows: [19], lines: 1, combo: 6 }],
    [13.6, 'lock', { rows: [19, 18], u: 0.15 }], [14.6, 'lock', { rows: [18, 17], u: 0.85 }],
    [15.6, 'lock', { rows: [17, 16], u: 0.35 }], [16.6, 'lock', { rows: [16, 15], u: 0.6, hardDrop: true }],
    [17.6, 'lock', { rows: [15, 14], u: 0.9 }], [18.6, 'lock', { rows: [14, 13], u: 0.05 }],
    [19.6, 'lock', { rows: [19, 18, 17, 16], u: 0.95, hardDrop: true }],
    [19.6, 'clear', { rows: [19, 18, 17, 16], lines: 4, combo: 1 }],
    [28.0, 'lock', { rows: [19], u: 0.45 }], [29.0, 'lock', { rows: [19, 18], u: 0.7 }],
    [30.0, 'lock', { rows: [18], u: 0.25, hardDrop: true }],
    [30.0, 'clear', {
        rows: [19, 18], lines: 2, twist: true, combo: 1,
    }],
    [32.0, 'lock', { rows: [19], u: 0.5 }],
];

export function create({
    scene, camera, renderer, params,
}) {
    const quality = params.get('quality') || 'High';
    // P.<name>=<value> overrides a number of the look (LOOK in winter-tsl.js) before the build.
    const lookOverrides = {};
    params.forEach((value, key) => {
        if (key.startsWith('P.')) lookOverrides[key.slice(2)] = value;
    });
    tuneLook(lookOverrides);
    const saved = {
        fov: camera.fov, near: camera.near, far: camera.far, toneMapping: renderer.toneMapping,
    };
    const world = new WinterWorld({
        scene,
        quality,
        capture: true,
        renderer,
        ghosts: params.get('plan') === '1' ? planGhosts() : null,
        fox: params.get('fox') !== '0',
        bear: params.get('bear') !== '0',
    });
    world.holdWeather(heldAt(WEATHERS, params.get('weather')));
    world.holdForm(heldAt(AURORA_FORMS, params.get('form')));
    const noPost = params.get('noPost') === '1';
    const overlay = params.get('board') === '1' ? mountBoardOverlay(params.get('statsHud') !== '0') : null;
    const pointer = { x: num(params, 'px'), y: num(params, 'py') };
    const still = params.get('still') === '1';
    const iconPose = params.get('icon') === '1';
    const foxCam = num(params, 'foxCam', 0);
    const foxAct = (params.get('foxAct') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const foxDo = (params.get('foxDo') || '').trim();
    const foxPace = (params.get('foxPace') || '').trim();
    /** The fox the fox parameters speak of: the one on its round, or the visitor. */
    const actor = () => (params.get('foxWho') === 'visitor' ? world.visitorMind : world.mind);
    const foxLook = new THREE.Vector3();
    const bearCam = num(params, 'bearCam', 0);
    const bearAct = (params.get('bearAct') || '').trim();
    const bearAt = params.has('bearAt') ? num(params, 'bearAt') : null;
    if (params.has('bearSeed')) world.bearMind = new BearMind(16 / 9, { seed: Math.round(num(params, 'bearSeed')) >>> 0 });
    let bearAnchor = null;
    /** Where on its own clock the bear is asked to be at the frame (null: where the world's clock has it). */
    const bearClock = () => {
        const mind = world.bearMind;
        const seconds = bearAt ?? 0;
        const cast = params.get('bearCast');
        if (params.has('bearDo')) return mind.clockWhen(params.get('bearDo'), { seconds });
        if (params.has('bearCubDo')) return mind.clockWhen(params.get('bearCubDo'), { cub: true, seconds });
        if (params.has('bearPace')) return mind.clockWhen(params.get('bearPace'), { seconds });
        if (params.has('bearCubPace')) return mind.clockWhen(params.get('bearCubPace'), { cub: true, seconds });
        if (cast) return mind.clockOf({ holds: (deal) => (deal.family ? 'family' : deal.kind) === cast, seconds });
        if (params.has('bearLap')) return mind.clockOf({ lap: Math.max(0, Math.round(num(params, 'bearLap'))), seconds });
        return bearAt;
    };
    const size = new THREE.Vector2(1, 1);
    let post = null;
    let built = false;
    let disposed = false;
    let pendingSeek = null;

    const syncViewport = () => {
        if (!built) return;
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        renderer.getDrawingBufferSize(size);
        world.setViewport(size.x, size.y, aspect);
        post?.setSize(window.innerWidth, window.innerHeight, size.x, size.y);
        const rects = overlay ? readLayoutRects() : null;
        world.setLayout(rects, aspect);
        post?.setCalmRects(rects ? [...rects.cards, rects.hud].filter(Boolean) : [], rects ? 1 : 0);
    };

    const sim = (time, delta) => ({
        time, delta, pointerX: pointer.x, pointerY: pointer.y,
    });
    const pushPost = (time) => {
        post?.update({ ...world.getPostState(), time });
    };
    const holdPower = params.has('power') ? num(params, 'power') : null;
    const frame = (time, delta) => {
        if (holdPower !== null) world.holdPower(holdPower);
        world.updateCamera(camera, sim(time, delta));
        if (still) {
            const rest = world.restCamera();
            camera.position.copy(rest.position);
            camera.quaternion.copy(rest.quaternion);
            camera.updateMatrixWorld();
            world.projectMoon(camera);
        }
        world.update(sim(time, delta), camera);
        if (foxCam > 0) {
            // A lens on the fox: round it from its front by foxCamYaw (or on the side the game's
            // camera sees it from), a little above its back.
            const { pose } = actor();
            const around = params.get('foxCamYaw') === 'viewer'
                ? Math.atan2(-pose.x, -pose.z)
                : pose.heading + num(params, 'foxCamYaw', 40) * (Math.PI / 180);
            const ahead = num(params, 'foxCamAhead', 0);
            foxLook.set(
                pose.x + Math.sin(pose.heading) * ahead,
                pose.y + pose.lift + 0.5 + num(params, 'foxCamUp', 0),
                pose.z + Math.cos(pose.heading) * ahead,
            );
            camera.position.set(
                foxLook.x + Math.sin(around) * foxCam,
                foxLook.y + foxCam * 0.22 + 0.15,
                foxLook.z + Math.cos(around) * foxCam,
            );
            camera.fov = num(params, 'foxCamFov', 30);
            camera.up.set(0, 1, 0);
            camera.lookAt(foxLook);
            camera.updateProjectionMatrix();
            camera.updateMatrixWorld();
            world.projectMoon(camera);
        }
        if (bearCam > 0) {
            // A lens on the bear: round it from its front by bearCamYaw (or on the side the game's
            // camera sees it from), a little above its back.
            const grown = world.bearMind.pose;
            const pose = params.get('bearCamOn') === 'cub' && grown.cub.present ? grown.cub : grown;
            const around = params.get('bearCamYaw') === 'viewer'
                ? Math.atan2(-pose.x, -pose.z)
                : pose.heading + num(params, 'bearCamYaw', 60) * (Math.PI / 180);
            // (At its middle, or with bearCamAim=head at its head: that far ahead of its middle.)
            const ahead = params.get('bearCamAim') === 'head' ? 1.75 * pose.size : 0;
            foxLook.set(
                pose.x + Math.sin(pose.heading) * ahead,
                pose.y + (ahead ? 1.3 : 1.1) * pose.size,
                pose.z + Math.cos(pose.heading) * ahead,
            );
            camera.position.set(
                foxLook.x + Math.sin(around) * bearCam,
                foxLook.y + bearCam * 0.15 + 0.3,
                foxLook.z + Math.cos(around) * bearCam,
            );
            camera.fov = num(params, 'bearCamFov', 30);
            camera.up.set(0, 1, 0);
            camera.lookAt(foxLook);
            camera.updateProjectionMatrix();
            camera.updateMatrixWorld();
            world.projectMoon(camera);
        }
        if (iconPose) {
            camera.fov = num(params, 'iconFov', 30);
            camera.rotateY(num(params, 'iconYaw', 0.13));
            camera.rotateX(num(params, 'iconPitch', 0.27));
            camera.updateProjectionMatrix();
            camera.updateMatrixWorld();
            // The lens's glare hangs on where the moon is in THIS frame.
            world.projectMoon(camera);
        }
    };
    const stepTo = (from, to, dt) => {
        const steps = Math.max(1, Math.round((to - from) / dt));
        const h = (to - from) / steps;
        for (let i = 1; i <= steps; i++) frame(from + i * h, h);
    };

    const onScreen = (mind) => {
        const { pose, rig } = mind;
        foxLook.set(pose.x, pose.y + pose.lift + 0.3 * rig.scale, pose.z).project(camera);
        const x = foxLook.x * 0.5 + 0.5;
        const y = 0.5 - foxLook.y * 0.5;
        const behind = foxLook.z > 1;
        foxLook.set(pose.x, pose.y + pose.lift + 0.65 * rig.scale, pose.z).project(camera);
        const top = 0.5 - foxLook.y * 0.5;
        foxLook.set(pose.x, pose.y + pose.lift, pose.z).project(camera);
        return {
            x, y, tall: Math.abs(0.5 - foxLook.y * 0.5 - top) * window.innerHeight, behind,
        };
    };

    const eventName = params.get('event');
    const eventAge = num(params, 'eventAge', 0.4);
    const holdCombo = Math.max(0, Math.round(num(params, 'combo', 0)));
    const level = Math.max(1, Math.round(num(params, 'level', 1)));
    const warmLocks = Math.max(0, Math.round(num(params, 'locks', 0)));
    const colorParam = params.get('color');
    const eventColor = colorParam ? `#${colorParam.replace('#', '')}` : PIECE_COLORS[3];
    const fireEvent = () => {
        const row = Math.round(num(params, 'row', 12));
        const u = num(params, 'u', 0.3);
        const lines = Math.max(1, Math.min(4, Math.round(num(params, 'lines', 2))));
        const bottom = (n) => Array.from({ length: n }, (_, i) => 19 - i);
        if (eventName === 'lock') world.onLock({ rows: [row, row - 1], u, color: eventColor });
        else if (eventName === 'drop') {
            world.onLock({
                rows: [row, row - 1], u, hardDrop: true, color: eventColor,
            });
        } else if (eventName === 'clear') world.onClear({ rows: bottom(lines), lines });
        else if (eventName === 'quad') world.onClear({ rows: bottom(4), lines: 4 });
        else if (eventName === 'twist') {
            // (A twist is a piece that locked and cleared: the whirl takes its colour and its side.)
            world.onLock({ rows: [19, 18], u, color: eventColor });
            world.onClear({ rows: bottom(2), lines: 2, twist: true });
        } else if (eventName === 'spin') {
            world.onLock({ rows: [19, 18], u, color: eventColor });
            world.onSpin();
        } else if (eventName === 'perfect') {
            // (As the game sends it: the clear, and the crown that settles a moment after it.)
            world.onClear({ rows: bottom(4), lines: 4 });
            world.onClear({ crown: true });
        } else if (eventName === 'levelUp') world.levelUp(num(params, 'eventLevel', level + 1));
        else if (eventName === 'over') world.onGameOver();
    };

    const seekTo = (time) => {
        // (Long enough before the frame for anything asked to happen before it.)
        const asked = Math.max(
            eventName ? eventAge : 0,
            params.has('foxTurn') ? num(params, 'foxTurn', 2) : 0,
            params.has('visitor') ? num(params, 'visitor', 12) : 0,
        );
        const lead = asked + 9 + warmLocks * 0.5;
        const start = Math.max(0, time - lead);
        world.seek(start);
        if (foxPace) actor().keepPace(foxPace);
        // (Its clock runs with the world's from here: at the first frame asked for it stands where
        // it was asked to, and a later seek finds it that much further on.)
        const asks = bearClock();
        if (asks !== null) {
            bearAnchor ??= time;
            world.bearMind.offset = asks - bearAnchor;
        }
        if (level > 1) world.levelUp(level, { silent: true });
        if (holdCombo > 0) world.onCombo(holdCombo);
        frame(start, 0);
        let cursor = start;
        for (let i = 0; i < warmLocks; i++) {
            const at = start + 0.5 + i * 0.5;
            stepTo(cursor, at, 0.1);
            cursor = at;
            world.onLock({
                rows: [19 - (i % 9), 18 - (i % 9)],
                u: ((i * 0.37) % 1) * 0.9 + 0.05,
                color: PIECE_COLORS[i % PIECE_COLORS.length],
                hardDrop: i % 4 === 3,
            });
        }
        // Two things may be asked for before the frame, each its own time before it: the fox
        // stopped to do something (foxAct, foxActAge) and an event (event, eventAge). They are
        // played in the order they fall, on one clock.
        const marks = [];
        if (foxAct.length) {
            marks.push({
                at: Math.max(cursor, time - num(params, 'foxActAge', 1)),
                fine: 1 / 60,
                play: (at) => {
                    if (foxAct[0] === 'zoom') actor().playZoom(at);
                    else if (foxAct[0] === 'hunt') actor().rehearse(['Listen', 'Pounce', 'Dig', 'Shake'], at);
                    else if (foxAct[0] === 'miss') actor().rehearse(['Listen', 'MouseLeap', 'HeadTilt'], at);
                    else actor().rehearse(foxAct, at);
                },
            });
        }
        if (foxDo) {
            marks.push({
                at: Math.max(cursor, time - num(params, 'foxActAge', 1)),
                fine: 1 / 60,
                play: (at) => actor()[foxDo]?.(at),
            });
        }
        if (params.has('visitor')) {
            marks.push({
                at: Math.max(cursor, time - num(params, 'visitor', 12)),
                fine: 1 / 30,
                play: (at) => world.visitorMind.arrive(at, 0),
            });
        }
        if (params.has('foxTurn')) {
            marks.push({
                at: Math.max(cursor, time - num(params, 'foxTurn', 2)),
                fine: 1 / 60,
                play: (at) => world.mind.turnHere?.(at),
            });
        }
        if (eventName) marks.push({ at: Math.max(cursor, time - eventAge), fine: 1 / 120, play: fireEvent });
        if (bearAct) {
            const age = num(params, 'bearActAge', 2);
            marks.push({
                at: Math.max(cursor, time - age - (bearAct === 'rise' ? 8 : 0)),
                fine: 1 / 30,
                play: (at) => {
                    const verb = bearAct === 'rise' ? 'lie' : bearAct;
                    if (['rear', 'wonder', 'lie', 'scent', 'glance'].includes(verb)) world.bearMind[verb](at);
                },
            });
            if (bearAct === 'rise') {
                marks.push({ at: Math.max(cursor, time - age), fine: 1 / 30, play: (at) => world.bearMind.rise(at) });
            }
        }
        marks.sort((a, b) => a.at - b.at);
        let step = 0.1;
        marks.forEach((mark) => {
            if (mark.at > cursor) stepTo(cursor, mark.at, step);
            cursor = mark.at;
            mark.play(mark.at);
            step = Math.min(step, mark.fine);
        });
        if (time > cursor) stepTo(cursor, time, step);
        frame(time, 0);
        pushPost(time);
    };

    const demo = params.get('demo') === '1';
    let demoCursor = 0;
    let demoLoop = -1;
    let demoPiece = 0;
    const runDemo = (time) => {
        const loop = Math.floor(time / DEMO_LOOP);
        if (loop !== demoLoop) {
            demoLoop = loop;
            demoCursor = 0;
            world.resetSession();
        }
        const local = time - loop * DEMO_LOOP;
        while (demoCursor < DEMO_SCRIPT.length && DEMO_SCRIPT[demoCursor][0] <= local) {
            const [, verb, detail] = DEMO_SCRIPT[demoCursor];
            if (verb === 'lock') {
                demoPiece += 1;
                world.onLock({ ...detail, color: PIECE_COLORS[demoPiece % PIECE_COLORS.length] });
            } else {
                world.onClear(detail);
                world.onCombo(detail.combo);
            }
            demoCursor += 1;
        }
        // A chain that is not continued breaks on the next lock that clears nothing.
        if (local > 13.6 && local < 19.6 && world.combo > 0) world.onCombo(0);
        if (local > 21 && local < 30 && world.combo > 0) world.onCombo(0);
        if (local > 32 && world.combo > 0) world.onCombo(0);
    };

    const ready = world.load().then(async () => {
        if (disposed) return;
        world.build();
        // A capture shows the fox every time: wait for its body (but not for long).
        await Promise.race([
            Promise.all([world.foxReady, world.bearReady]),
            new Promise((resolve) => { setTimeout(resolve, 6000); }),
        ]);
        if (disposed) return;
        world.bindCamera(camera);
        world.setReducedMotion(params.get('reduce') === '1');
        const partsParam = params.get('parts');
        if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));
        const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
        if (params.has('bloom')) look.bloom = params.get('bloom') === '1';
        if (params.has('msaa')) look.msaa = Math.max(0, Math.round(num(params, 'msaa')));
        post = noPost ? null : new WinterPost(renderer, scene, camera, {
            look,
            falseColor: params.get('falseColor') === '1',
        });
        if (noPost) renderer.toneMapping = THREE.AgXToneMapping;
        built = true;
        syncViewport();
    });

    return {
        cameraRadius: 1,
        camera(time, cam) {
            if (built) world.updateCamera(cam, sim(time, 0));
        },
        update(time, dt) {
            if (!built) return;
            if (demo) runDemo(time);
            frame(time, dt);
            pushPost(time);
        },
        seek(time) {
            if (!built) {
                pendingSeek = time;
                return;
            }
            seekTo(time);
        },
        render() {
            if (!built) return;
            if (post) post.render();
            else renderer.render(scene, camera);
        },
        async renderAsync() {
            await ready;
            if (disposed || !built) return;
            if (pendingSeek !== null) seekTo(pendingSeek);
            else {
                frame(0, 0);
                pushPost(0);
            }
            // A few frames let the async pipelines land.
            for (let i = 0; i < 3; i++) {
                if (post) post.render();
                else renderer.render(scene, camera);
            }
        },
        resize() {
            syncViewport();
        },
        getDiagnostics() {
            return {
                backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
                built,
                calls: renderer.info?.render?.calls ?? null,
                triangles: renderer.info?.render?.triangles ?? null,
                ...(built ? world.getState() : {}),
                // Where each fox is on screen (fractions; y down) and how tall (pixels): a capture can crop to it.
                ...(built ? { foxScreen: onScreen(world.mind), visitorScreen: onScreen(world.visitorMind) } : {}),
            };
        },
        dispose() {
            disposed = true;
            overlay?.remove();
            post?.dispose();
            world.dispose();
            renderer.toneMapping = saved.toneMapping;
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.updateProjectionMatrix();
        },
    };
}
