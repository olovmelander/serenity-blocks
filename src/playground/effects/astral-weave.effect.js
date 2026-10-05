/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import {
    AstralWeaveWorld, buildAstralRibbonCurve, buildAstralSilkGeometry, getAstralWeaveLayout,
} from '../../themes/astral-weave/astral-weave-world.js';
import {
    createAstralRibbonNodeMaterial, createAstralNexusCoreNodeMaterial, createAstralNexusShellNodeMaterial,
} from '../../themes/astral-weave/astral-weave-materials.js';
import { AstralWeaveFXController } from '../../themes/astral-weave/astral-weave-fx-controller.js';
import { AstralWeavePost, getAstralWeavePostProfile } from '../../themes/astral-weave/astral-weave-post.js';

export const meta = {
    id: 'astral-weave',
    title: 'Astral Weave — the celestial silk loom',
    description: 'Pearlescent woven arcs, a living nebula and cascading stitch, clear and crown reactions.',
};

export function create({
    scene, camera, renderer, params,
}) {
    const saved = {
        fov: camera.fov, far: camera.far, tone: renderer.toneMapping, exposure: renderer.toneMappingExposure,
    };
    const quality = params.get('quality') || 'High';
    const count = {
        Minimal: 4, Low: 6, Medium: 8, High: 10, Ultra: 12, Extreme: 14,
    }[quality] || 10;
    const root = new THREE.Group();
    scene.add(root);
    const origin = new THREE.Vector3(4, 21, -24);
    const world = new AstralWeaveWorld(scene, root, origin).build();
    const materials = [];
    const palette = [
        [0x65e9ef, 0x8464ef, 0xe083bd], [0x8373f3, 0xe083bd, 0x83eff2],
        [0x439acf, 0x79ece3, 0xe8b8ed], [0xc27fe8, 0x6f96f0, 0xe083bd],
    ];
    for (let i = 0; i < count; i += 1) {
        const colors = palette[Math.floor(i / 2) % palette.length].map((hex) => new THREE.Color(hex));
        const data = createAstralRibbonNodeMaterial({
            colorA: colors[0], colorB: colors[1], colorC: colors[2], flowSpeed: 0.42 + i * 0.035, pulseOffset: i * 0.63,
        });
        const geometry = buildAstralSilkGeometry(
            buildAstralRibbonCurve(i, count, origin),
            192,
            1.5 + (i % 3) * 0.7,
            i * 0.7,
        );
        const mesh = new THREE.Mesh(geometry, data.material);
        mesh.frustumCulled = false;
        root.add(mesh);
        materials.push(data);
    }
    const nexus = new THREE.Group();
    nexus.position.copy(origin);
    root.add(nexus);
    const core = createAstralNexusCoreNodeMaterial({
        colorA: new THREE.Color(0x65e9ef),
        colorB: new THREE.Color(0xba8ced),
        colorC: new THREE.Color(0xffd293),
    });
    const shell = createAstralNexusShellNodeMaterial({
        colorA: new THREE.Color(0x79ece3), colorB: new THREE.Color(0xe8b8ed), opacity: 0.22, additive: true,
    });
    nexus.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.75, 3), core.material));
    nexus.add(new THREE.Mesh(new THREE.TorusKnotGeometry(2.95, 0.1, 128, 12, 2, 3), shell.material));
    materials.push(core, shell);
    camera.fov = 48; camera.far = 500;
    camera.position.set(0, 5.6, 34);
    camera.lookAt(0, 3.8, -8);
    camera.updateProjectionMatrix();
    const fx = new AstralWeaveFXController();
    const profile = getAstralWeavePostProfile(quality);
    const post = profile.enabled ? new AstralWeavePost(renderer, scene, camera, {
        ...profile, useMRT: renderer.backend?.isWebGPUBackend === true,
    }) : null;
    renderer.toneMapping = post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.03;
    let overlay;
    if (params.get('board') === '1') {
        overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;left:50%;top:54%;transform:translate(-50%,-50%);'
            + 'width:min(28vw,260px);height:min(68vh,520px);border:1px solid #a6d9ef40;'
            + 'border-radius:14px;background:#061020dc;pointer-events:none;z-index:3';
        document.body.appendChild(overlay);
    }
    const resize = (width, height) => {
        const layout = getAstralWeaveLayout(width / height);
        root.scale.x = layout.span;
        nexus.scale.set(layout.nexusScale / layout.span, layout.nexusScale, layout.nexusScale);
        world.resize(width / height);
        post?.setSize(width, height);
    };
    resize(window.innerWidth, window.innerHeight);
    const update = (time) => {
        const signals = fx.getSignals();
        world.update(time, signals, camera);
        materials.forEach(({ uniforms }) => {
            const values = {
                uTime: time,
                uEnergy: Math.min(2, signals.linePulse + signals.comboEnergy + signals.pieceLockPulse),
                uLinePulse: signals.linePulse,
                uComboEnergy: signals.comboEnergy,
                uLineWaveProgress: signals.lineWaveProgress,
                uWeaveCharge: signals.weaveCharge,
                uCrownPulse: signals.crownPulse,
                uEventHue: signals.eventHue,
            };
            Object.entries(values).forEach(([key, value]) => {
                if (uniforms[key] && Number.isFinite(value)) uniforms[key].value = value;
            });
        });
        nexus.rotation.y = time * 0.08;
        nexus.children[1].rotation.set(0.86, time * 0.08, 0.42);
        post?.updateDynamic({
            time,
            bloomStrength: profile.bloomStrength * (1 + signals.linePulse * 0.1),
            lensingStrength: 0,
        });
    };
    let lastSeek = null;
    return {
        cameraRadius: 1,
        camera() {},
        seek(time) {
            if (lastSeek === time) return;
            fx.reset();
            const age = Math.max(0, Number(params.get('eventAge') || 0.35));
            const event = params.get('event');
            if (event === 'lock') fx.onPieceLock();
            if (event === 'clear' || event === 'tetris') fx.onLineClear(event === 'tetris' ? 4 : 1);
            if (event === 'combo') fx.onCombo(Number(params.get('combo') || 5));
            fx.step(age);
            update(time);
            lastSeek = time;
        },
        update(time, delta) { if (!params.has('t')) { fx.step(Math.min(0.05, delta)); update(time); } },
        render() { if (post) post.render(); else renderer.render(scene, camera); },
        resize,
        getDiagnostics() {
            return {
                quality,
                ribbons: count,
                backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
                signals: fx.getSignals(),
            };
        },
        dispose() {
            overlay?.remove(); post?.dispose(); world.dispose();
            root.traverse((object) => { object.geometry?.dispose(); object.material?.dispose(); });
            root.removeFromParent();
            camera.fov = saved.fov; camera.far = saved.far; camera.updateProjectionMatrix();
            renderer.toneMapping = saved.tone; renderer.toneMappingExposure = saved.exposure;
        },
    };
}
