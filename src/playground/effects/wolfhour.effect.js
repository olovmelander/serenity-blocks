import * as THREE from 'three/webgpu';
import { createWolfhourSky, wolfhourRandom } from '../../themes/wolfhour/wolfhour-sky.js';
import { createWolfhourLandscape } from '../../themes/wolfhour/wolfhour-landscape.js';
import { createWolfhourMist } from '../../themes/wolfhour/wolfhour-mist.js';
import { createWolfhourPack } from '../../themes/wolfhour/wolfhour-wolves.js';
import { createWolfhourHut } from '../../themes/wolfhour/wolfhour-hut.js';
import { createWolfhourSpindrift } from '../../themes/wolfhour/wolfhour-spindrift.js';
import { createWolfhourForest } from '../../themes/wolfhour/wolfhour-forest.js';
import { standWolfhourProps } from '../../themes/wolfhour/wolfhour-props.js';
import { WolfhourGrade } from '../../themes/wolfhour/wolfhour-grade.js';
import { getWolfhourPostProfile } from '../../themes/wolfhour/wolfhour-post.js';
import { createWolfhourMeteor, setWolfhourRibbon } from '../../themes/wolfhour/wolfhour-meteor.js';
import { updateWolfhourCamera } from '../../themes/wolfhour/wolfhour-composition.js';
import { sceneSamples } from '../../themes/shared/scene-antialias.js';

/*
 * URL params: quality, noPost=1, msaa=<n>, board=1, pointerX/pointerY (pin the parallax),
 * event=lock|combo|crash|clear|howl with eventAge=<s> (clear: the lead wolf glances; howl: the
 * pack howls, as on a four-line clear), meteor=1, impactIndex, seed,
 * zoom=<k>&zoomX=<x>&zoomY=<y>  an inspection lens: k times closer, centred on world (x, y)
 *         (to check how the wolves stand on their ridges),
 * icon=1  the theme-icon lens: the pack howls on the left massif's summit ridge against the moon
 *         (iconX = the ridge's local x, iconHalf = half the square frame in world units).
 */
export const meta = {
    id: 'wolfhour',
    title: 'Wolfhour — Moonlit Wilderness',
    description: 'Moonlit snow and granite, valley mist, a lit hut, and a pack that howls on a four-line clear.',
};

export function create({ scene, renderer, params }) {
    const quality = params.get('quality') || 'High';
    const aspect = window.innerWidth / window.innerHeight;
    const camera = new THREE.OrthographicCamera(-500 * aspect, 500 * aspect, 500, -500, 0.1, 10000);
    camera.position.set(0, 0, 1000);
    camera.lookAt(0, 0, 0);
    const previousToneMapping = renderer.toneMapping;
    const previousBackground = scene.background;
    scene.background = new THREE.Color(0x000000);
    const sky = createWolfhourSky({ scene, quality, aspect });
    const landscape = createWolfhourLandscape({ scene, quality, seed: 73013 });
    const mist = createWolfhourMist({ scene, quality, noiseMap: sky.noiseMap });
    const pack = createWolfhourPack({ quality, noiseMap: sky.noiseMap });
    const hut = createWolfhourHut({ quality, noiseMap: sky.noiseMap });
    const spindrift = createWolfhourSpindrift({ quality, noiseMap: sky.noiseMap });
    const iconLens = params.get('icon') === '1';
    const iconX = Number(params.get('iconX') || -800);
    const iconHalf = Number(params.get('iconHalf') || 150);
    const MASSIF_RESPONSE = 0.48;
    const forest = createWolfhourForest({ quality });
    const props = standWolfhourProps(landscape, {
        pack: iconLens ? null : pack, hut, spindrift, forest,
    });
    let settleIcon = () => {};
    if (iconLens) {
        // Playground-only: the pack on the left massif's summit ridge, the moon right behind it;
        // the summit's spindrift would cross them, so it is left out of this lens.
        for (const plume of spindrift.plumes) plume.visible = false;
        const scale = 1.55;
        pack.group.scale.set(scale, scale, 1);
        landscape.addProp(1, pack.group, { x: iconX, depth: 12 });
        settleIcon = () => {
            const stretch = landscape.group.scale.x || 1;
            const base = landscape.crestPoint(1, iconX).y;
            pack.settle((dx) => (landscape.crestPoint(1, iconX + (dx * scale) / stretch).y - base) / scale);
        };
    }
    const profile = getWolfhourPostProfile(quality);
    const bloomStrength = ({
        Minimal: 0, Low: 0, Medium: 0.3, High: 0.5, Ultra: 0.6, Extreme: 0.8,
    })[quality] ?? 0.5;
    const post = profile.enabled && params.get('noPost') !== '1'
        ? new WolfhourGrade(renderer, scene, camera, {
            ...profile,
            useMRT: false,
            bloomStrength,
            samples: params.has('msaa') ? Number(params.get('msaa')) : sceneSamples(quality),
        }) : null;
    renderer.toneMapping = post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    let board;
    if (params.get('board') === '1') {
        board = document.createElement('div');
        board.style.cssText = [
            'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%)',
            'width:min(34vh,360px);height:68vh;border:1px solid #b9c4d240;border-radius:10px',
            'background-color:#080a0edb;pointer-events:none;box-shadow:0 0 40px #0005',
            'background-image:linear-gradient(#c7d1de0a 1px,transparent 1px),'
                + 'linear-gradient(90deg,#c7d1de0a 1px,transparent 1px)',
            'background-size:10% 5%',
        ].join(';');
        document.body.appendChild(board);
    }
    const event = params.get('event');
    const eventAge = Number(params.get('eventAge') || 0.35);
    const crashPreview = event === 'crash';
    const meteor = (event === 'combo' || crashPreview || params.get('meteor') === '1')
        ? createWolfhourMeteor({ impact: crashPreview }) : null;
    if (meteor) scene.add(meteor);
    const impactRandom = wolfhourRandom(Number(params.get('seed') || 73013));
    let impactLocalX = null;
    const impactOffset = new THREE.Vector3();
    const state = { mountainPulse: 0, mountainShockwave: 0, nebulaDefinition: 0 };
    let pointerX = Number(params.get('pointerX') || 0);
    let pointerY = Number(params.get('pointerY') || 0);
    let smoothX = pointerX;
    let smoothY = pointerY;
    const pinnedPointer = params.has('pointerX') || params.has('pointerY');
    const pointerMove = (pointerEvent) => {
        if (pinnedPointer || pointerEvent.pointerType === 'touch') return;
        pointerX = (pointerEvent.clientX / window.innerWidth) * 2 - 1;
        pointerY = (pointerEvent.clientY / window.innerHeight) * 2 - 1;
    };
    const resetPointer = () => { if (!pinnedPointer) { pointerX = 0; pointerY = 0; } };
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('blur', resetPointer);
    let lastTime = null;
    let howled = false;
    const update = (time) => {
        const delta = lastTime === null ? 0 : Math.max(0, Math.min(1 / 30, time - lastTime));
        lastTime = time;
        const damping = 1 - Math.exp(-delta * 2.8);
        smoothX += (pointerX - smoothX) * damping;
        smoothY += (pointerY - smoothY) * damping;
        updateWolfhourCamera(camera, time, window.innerWidth / window.innerHeight, smoothX, smoothY);
        const zoom = Number(params.get('zoom') || 0);
        if (zoom > 1 && !iconLens) {
            // Shift the view window, not the camera: the layers' parallax stays as in the game.
            const a = window.innerWidth / window.innerHeight;
            const half = 500 / zoom;
            const dx = Number(params.get('zoomX') || 0) - camera.position.x;
            const dy = Number(params.get('zoomY') || 0) - camera.position.y;
            camera.left = dx - half * a; camera.right = dx + half * a;
            camera.top = dy + half; camera.bottom = dy - half;
            camera.updateProjectionMatrix();
        }
        if (iconLens) {
            // The massif moves (1 - response) of the camera, so the camera that centres the pack
            // solves cam = crest + (1 - response) * cam.
            const crest = landscape.crestPoint(1, iconX);
            const stretch = landscape.group.scale.x || 1;
            const camX = (crest.x * stretch) / MASSIF_RESPONSE;
            const camY = (crest.y + iconHalf * 0.3) / MASSIF_RESPONSE;
            camera.position.set(camX, camY, 1000);
            const a = window.innerWidth / window.innerHeight;
            camera.left = -iconHalf * a; camera.right = iconHalf * a;
            camera.top = iconHalf; camera.bottom = -iconHalf;
            camera.updateProjectionMatrix();
            const leadX = camX;
            const ground = camY - iconHalf * 0.3;
            // The moon rests behind the lead wolf's raised head (the sky layer moves 0.915 of the camera).
            sky.resize(a, {
                moonX: leadX - 14 - camX * 0.915,
                moonY: ground + 58 - camY * 0.915,
                moonScale: Number(params.get('iconMoon') || 0.42),
            });
        }
        sky.applyParallax?.(camera);
        landscape.applyParallax?.(camera);
        mist.applyParallax(camera);
        const energy = event && event !== 'howl' && event !== 'clear' ? Math.exp(-eventAge * 2.2) : 0;
        if (event === 'howl' && !howled) howled = pack.howl(time - eventAge);
        if (event === 'clear' && !howled) { pack.glance(time - eventAge); howled = true; }
        pack.update(time);
        hut.update(time);
        spindrift.update(time);
        state.mountainPulse = energy;
        state.mountainShockwave = event === 'lock' ? energy : 0;
        state.nebulaDefinition = energy;
        sky.update(time, state);
        landscape.update(time, state);
        mist.update(time, energy * 0.6 + pack.howlLevel(time) * 0.5);
        if (event) {
            sky.moonHaloNodeData.pulseValues[0].set(time - eventAge, 1 / 1.9, 0.8, event === 'combo' ? 0.75 : 0.12);
            sky.moonNodeData.uniforms.uPulse.value = energy * 0.5;
        }
        if (meteor) {
            const d = meteor.userData;
            if (crashPreview) {
                landscape.getImpactOffset(impactOffset);
                const maxAbsX = Math.max(1, camera.right - Math.abs(camera.position.x) - 36);
                if (impactLocalX === null) {
                    const index = Math.min(20, Math.max(0, Number(params.get('impactIndex')) || 0));
                    for (let i = 0; i <= index; i++) {
                        const target = landscape.randomImpactTarget(impactRandom, { maxAbsX });
                        impactLocalX = (target.x - impactOffset.x) / landscape.group.scale.x;
                    }
                }
                const target = landscape.impactTarget(impactLocalX * landscape.group.scale.x + impactOffset.x);
                const direction = target.x < 0 ? -1 : 1;
                const angle = direction > 0 ? -0.85 : -Math.PI + 0.85;
                setWolfhourRibbon(d.trail.geometry, target.x, target.y, target.z + 15, angle, 1, 300);
                d.head.position.set(target.x, target.y, target.z + 15);
            } else {
                setWolfhourRibbon(d.trail.geometry, 280, 280, -2200, -0.38, 1, 235);
                d.head.position.set(280, 280, -2200);
            }
            d.trailNodeData.uniforms.uProgress.value = 0.3;
        }
        post?.updateDynamic({ time });
    };
    const resize = (w, h) => {
        const a = w / h;
        camera.left = -500 * a; camera.right = 500 * a;
        camera.updateProjectionMatrix();
        sky.resize(a); landscape.resize?.(a); props.settle(); settleIcon();
        post?.setSize(w, h);
    };
    resize(window.innerWidth, window.innerHeight);
    return {
        update,
        seek: update,
        camera() {},
        render() { if (post) post.render(); else renderer.render(scene, camera); },
        async renderAsync() {
            await renderer.compileAsync(scene, camera);
            if (post) post.render(); else renderer.render(scene, camera);
        },
        resize,
        getRendererCounters() {
            return { calls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles };
        },
        dispose() {
            window.removeEventListener('pointermove', pointerMove);
            window.removeEventListener('blur', resetPointer);
            board?.remove(); post?.dispose(); pack.dispose(); hut.dispose(); spindrift.dispose(); forest.dispose();
            mist.dispose(); sky.dispose(); landscape.dispose();
            meteor?.removeFromParent();
            meteor?.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
            renderer.toneMapping = previousToneMapping;
            scene.background = previousBackground;
        },
    };
}
