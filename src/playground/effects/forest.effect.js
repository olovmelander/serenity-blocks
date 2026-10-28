import * as THREE from 'three/webgpu';
import { sceneSamples } from '../../themes/shared/scene-antialias.js';
import { disposeForestAssets, loadForestAssets } from '../../themes/forest/forest-assets.js';
import { ForestWorld } from '../../themes/forest/forest-world.js';
import { ForestReactions } from '../../themes/forest/forest-reactions.js';
import { forestGroundHeight } from '../../themes/forest/forest-terrain.js';
import { forestRidePoint } from '../../themes/forest/forest-plan.js';
import { ForestPost } from '../../themes/forest/forest-post.js';
import { readForestPanelRects } from '../../themes/forest/forest-stage.js';
import { seededRandom } from '../../utils/helpers.js';

export const meta = {
    id: 'forest',
    title: 'Forest — the firefly night',
    description: 'An old spruce wood under a full moon: moonbeams, mist, fireflies and waves of light.',
};

export function create({
    scene, camera, renderer, params,
}) {
    // The theme's own generator and default seed, so a capture shows the forest the game grows.
    const rawSeed = Number(params.get('seed') ?? 419);
    const rng = seededRandom(Number.isFinite(rawSeed) ? rawSeed : 419);
    const saved = {
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        tone: renderer.toneMapping,
        exposure: renderer.toneMappingExposure,
        shadows: renderer.shadowMap.enabled,
    };
    const quality = params.get('quality') || 'High';
    // ?msaa=<n> overrides the scene pass's samples (the theme's own: 4 from High up, else 0 + FXAA).
    const samples = params.has('msaa')
        ? Math.max(0, Math.round(Number(params.get('msaa')) || 0)) : sceneSamples(quality);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    let disposed = false;
    let world = null;
    let post = null;
    let assets = null;
    let pendingSeek = null;
    let sought = null;
    let overlay;
    const randomTape = [];
    let randomIndex = 0;
    const reactions = new ForestReactions({
        quality,
        rng: () => {
            if (randomTape[randomIndex] === undefined) randomTape[randomIndex] = rng();
            randomIndex += 1;
            return randomTape[randomIndex - 1];
        },
    });
    // ?level=<n> sets the level the night is on: every level is one hour on (deep night,
    // the small hours, first light, moonrise, the blue hour, and round again). The clock
    // turns the hours too, so ?t= past 42 s shows one melting into the next.
    const rawLevel = Number(params.get('level') ?? 1);
    const level = Number.isFinite(rawLevel) ? Math.max(1, Math.round(rawLevel)) : 1;
    // ?animal=stag|moose|bear|wolf|owl|... has that one answer every summons (four lines,
    // a perfect clear); without it they come in a shuffled round, as in the game.
    reactions.callFor(params.get('animal'));
    if (params.get('board') === '1') {
        overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
            + 'width:23vw;height:84vh;border:1px solid #b9e9ff40;'
            + 'border-radius:14px;background:#0a1018d9;pointer-events:none;z-index:3';
        document.body.appendChild(overlay);
    }
    // ?panel=1 adds the game's score panel beside the card: no animal is called to stand behind it.
    let panel;
    if (params.get('panel') === '1') {
        panel = document.createElement('div');
        panel.className = 'single-player-stats-bar';
        panel.style.cssText = 'position:fixed;left:calc(50% + 11.5vw + 4.2vh);top:18.8vh;width:26.7vh;height:30.5vh;'
            + 'border:1px solid #b9e9ff40;border-radius:10px;background:#160c2ad9;pointer-events:none;z-index:3';
        document.body.appendChild(panel);
    }
    // ?stand=<n> has every animal stand at that place (0 the usual one, see FOREST_FIGURE_STANDS);
    // without it each takes a place by chance, as in the game.
    const rawStand = params.has('stand') ? Number(params.get('stand')) : NaN;
    const aim = () => {
        if (!world) return;
        world.prepareCamera(camera.aspect);
        world.setPanels(readForestPanelRects());
        // ?icon=1 is the theme icon's lens: from a little way down the ride, low in the ferns, the
        // young spruce stand against the moon (the centre square of a 16:9 capture is the icon).
        if (params.get('icon') === '1') {
            const spot = forestRidePoint(30, 0.6);
            const eye = forestGroundHeight(spot.x, spot.z) + 1.3;
            const far = forestRidePoint(130, 0.6);
            camera.position.set(spot.x, eye, spot.z);
            camera.fov = 21;
            camera.lookAt(far.x, eye + 100 * Math.tan(THREE.MathUtils.degToRad(15.5)), far.z);
            camera.updateProjectionMatrix();
            world.stage.refresh();
            // At 80 px an icon needs deep silhouettes: thinner air and a darker print.
            world.light.uHaze.value = 0.0028;
            world.light.uHazeMoonAmount.value = 0.2;
            if (post) {
                post.exposure = 0.7;
                post.shaftGain = 0.2;
                post.bloomGain = 0.6;
            }
        }
    };
    // ?owlPerch=<perch id> sets the owl on that perch (limbIn, limb, limbOut, lowIn, low, pine, pineLow,
    // pineHigh, log, logEnd, stump) and ?owlHold=1 keeps it there (its acts and the game's cues still play).
    const placeOwl = () => {
        const mind = world?.owlMind;
        if (!mind) return;
        if (params.get('owlPerch')) mind.placeAt(params.get('owlPerch'));
        mind.hold(params.get('owlHold') === '1');
    };
    const ready = loadForestAssets()
        .then((loaded) => {
            if (disposed) {
                disposeForestAssets(loaded);
                return;
            }
            assets = loaded;
            world = new ForestWorld({
                scene, camera, quality, rng, assets,
            }).build();
            world.setLevel(level, { silent: true });
            world.director.callStand(rawStand);
            placeOwl();
            aim();
            post = new ForestPost({
                renderer, scene, camera, quality, light: world.light, samples,
            });
            post.setSize(window.innerWidth, window.innerHeight);
            aim();
        });
    // ?owlCam=<metres> follows the owl with a long lens from that far off, ?owlOrbit=<degrees> round it
    // from the eye's side, ?owlTilt=<degrees> above it (a close look at its plumage and motion).
    const owlCam = params.has('owlCam') ? Math.max(0.4, Number(params.get('owlCam')) || 2) : 0;
    const followOwl = () => {
        if (!owlCam || !world?.owl?.pivot || !world.stage) return;
        const pivot = world.owl.pivot.position;
        // ?owlFocus=<metres> above its feet the lens aims at (0.3 its body, 0.55 its face).
        const centre = new THREE.Vector3(pivot.x, pivot.y + Number(params.get('owlFocus') ?? 0.3), pivot.z);
        const eye = new THREE.Vector3(0, forestGroundHeight(0, 13) + 1.85, 13);
        const away = eye.sub(centre).setY(0).normalize();
        away.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(Number(params.get('owlOrbit') ?? 0)));
        const tilt = THREE.MathUtils.degToRad(Number(params.get('owlTilt') ?? 8));
        away.multiplyScalar(Math.cos(tilt)).setY(Math.sin(tilt));
        camera.position.copy(centre).addScaledVector(away, owlCam);
        camera.fov = 28;
        camera.lookAt(centre);
        camera.updateProjectionMatrix();
    };
    // ?owlTrip= sends the owl out at ?owlAt=<seconds> (default 1): moon, hunt (or catch / miss), visit (to
    // ?owlTo=<perch id>, or one by chance), home, sidle (along its limb, to ?owlTo or the nearest place),
    // turn, or an act on its perch: stretch (?owlTo=wingsUp for the other kind), preen (?owlTo=breast|left|
    // right), doze, tall; away (out of the glade by ?owlTo=left|leftBack|over|rightBack|right, or a gate by
    // chance); or a way of flying to ?owlTo: direct, meander, patrol, overshoot, circle.
    const owlTrip = params.get('owlTrip');
    const owlAt = Number(params.get('owlAt') ?? 1);
    let owlSent = false;
    // ?owlBack=<seconds> brings it back from away at that time (?owlBackBy=<gate> the way it comes in).
    const owlBack = params.has('owlBack') ? Number(params.get('owlBack')) : null;
    let owlBackSent = false;
    const update = (time, dt) => {
        reactions.update(dt);
        const frame = reactions.getFrame();
        if (owlTrip && !owlSent && world?.owlMind && time >= owlAt) {
            owlSent = world.owlMind.send(owlTrip, params.get('owlTo'));
        }
        if (owlBack !== null && !owlBackSent && world?.owlMind && time >= owlBack) {
            owlBackSent = world.owlMind.send('back', params.get('owlBackBy'));
        }
        // ?owlLook=eye (at the player) or ?owlLook=<yaw>,<pitch> holds the perched owl's gaze.
        const look = params.get('owlLook');
        if (look && world?.owlMind?.mode === 'perched' && world.owlMind.gaze.next < 1e8) {
            const mind = world.owlMind;
            const [yaw, pitch] = look === 'eye'
                ? mind.lookToward({ x: 0, y: forestGroundHeight(0, 13) + 1.85, z: 13 })
                : look.split(',').map(Number);
            mind.turnHead(yaw, pitch, 0);
            mind.gaze.next = 1e9;
        }
        world?.update(time, dt, frame);
        followOwl();
        post?.update(frame);
    };
    // ?event=lock|drop|clear|double|triple|quad|combo|streak|spin|perfect|level|over, placed
    // with ?col=0..9 and ?row=0..19 (0 is the top visible row).
    const fire = (event) => {
        const column = Number(params.get('col') ?? 1);
        const row = Number(params.get('row') ?? 15) + 4;
        const piece = {
            shapeKey: 'T', x: column, y: row, shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
        };
        const lines = {
            clear: 1, double: 2, triple: 3, quad: 4,
        }[event];
        if (event === 'lock') reactions.onPieceLock({ piece });
        else if (event === 'drop') {
            reactions.onHardDrop({ piece, distance: 16 });
            reactions.onPieceLock({ piece });
        } else if (lines) {
            reactions.onPieceLock({ piece });
            reactions.onLineClear(lines, { clearedRows: Array.from({ length: lines }, (_, i) => row + 1 - i) });
        } else if (event === 'combo') reactions.onCombo(Number(params.get('combo') || 6));
        else if (event === 'streak') {
            for (let i = 0; i < Number(params.get('combo') || 5); i += 1) {
                reactions.onPieceLock({ piece });
                reactions.onLineClear(1, { clearedRows: [row + 1] });
            }
        } else if (event === 'spin') reactions.onTSpin({ piece });
        else if (event === 'perfect') reactions.onPerfectClear();
        else if (event === 'level') {
            world?.setLevel(world.level + 1);
            reactions.onLevelUp();
        } else if (event === 'over') reactions.onGameOver();
    };
    const seek = (time) => {
        if (!Number.isFinite(time)) return;
        if (!world) {
            pendingSeek = time;
            return;
        }
        if (time === sought) return;
        const target = Math.max(0, time);
        reactions.reset();
        world.resetEffects({ owl: true });
        placeOwl();
        owlSent = false;
        owlBackSent = false;
        world.setLevel(level, { silent: true });
        randomIndex = 0;
        const age = Number(params.get('eventAge') ?? 0.35);
        const eventTime = Math.max(0, target - (Number.isFinite(age) ? Math.max(0, age) : 0.35));
        // ?hold=1 keeps a combo alive by repeating the event every second up to the capture.
        const hold = params.get('hold') === '1';
        const steps = Math.max(1, Math.ceil(target * 60));
        const dt = target / steps;
        let next = eventTime;
        for (let i = 1; i <= steps; i += 1) {
            if (next !== null && i * dt >= next) {
                fire(params.get('event'));
                next = hold ? next + 1 : null;
            }
            update(i * dt, dt);
        }
        sought = time;
    };
    return {
        cameraRadius: 1,
        camera() {},
        seek,
        update(time, dt) {
            if (!params.has('t')) update(time, Math.max(0, Math.min(0.05, dt)));
        },
        render() {
            post?.render();
        },
        async renderAsync() {
            await ready;
            if (disposed || !post) return;
            if (pendingSeek !== null) seek(pendingSeek);
            else update(0, 0);
            // A few frames let async pipelines land and the static shadow map settle.
            for (let i = 0; i < 4; i += 1) post.render();
        },
        resize(width, height) {
            aim();
            post?.setSize(width, height);
        },
        // Live poke for interactive sessions: window.__PLAYGROUND__ users can fire events.
        fire,
        getDiagnostics() {
            return {
                ready: Boolean(world),
                ...(world?.getDiagnostics() || {}),
                ...(post?.getDiagnostics() || {}),
                activeEmitters: reactions.getFrame().emitters.length,
                figure: reactions.getFrame().figure?.kind ?? null,
                // Which of the places an animal may stand the last one took.
                stand: world?.director?.figureAnchor?.stand ?? null,
            };
        },
        dispose() {
            disposed = true;
            overlay?.remove();
            panel?.remove();
            post?.dispose();
            reactions.dispose();
            world?.dispose();
            disposeForestAssets(assets);
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.updateProjectionMatrix();
            renderer.toneMapping = saved.tone;
            renderer.toneMappingExposure = saved.exposure;
            renderer.shadowMap.enabled = saved.shadows;
        },
    };
}
