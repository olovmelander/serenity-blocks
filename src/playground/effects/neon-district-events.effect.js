/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import {
    abs, float, mix, smoothstep, uv, vec3,
} from 'three/tsl';
import { NeonDistrictEvents } from '../../themes/neon-district/neon-district-events.js';

export const meta = {
    id: 'neon-district-events',
    title: 'Neon District — city energy reactions',
    description: 'Pavement ripples, rising canyon energy scans, data sparks and broken holographic orbital arcs.',
};

export function create({ scene, camera, params }) {
    const savedBackground = scene.background;
    const savedFog = scene.fog;
    scene.background = new THREE.Color(0x030713);
    scene.fog = new THREE.FogExp2(0x050b19, 0.0006);
    camera.fov = 70;
    camera.near = 1;
    camera.far = 8000;
    camera.position.set(0, 4, 40);
    camera.lookAt(0, 80, -400);
    camera.updateProjectionMatrix();

    const objects = [];
    const add = (mesh) => { objects.push(mesh); scene.add(mesh); return mesh; };
    const towerGeometry = new THREE.BoxGeometry(1, 1, 1);
    const towerMaterial = new THREE.MeshBasicNodeMaterial();
    const windowX = float(1).sub(smoothstep(0.24, 0.34, abs(uv().x.mul(14).fract().sub(0.5))));
    const windowY = float(1).sub(smoothstep(0.22, 0.34, abs(uv().y.mul(54).fract().sub(0.5))));
    towerMaterial.colorNode = mix(vec3(0.016, 0.022, 0.048), vec3(0.06, 0.15, 0.19), windowX.mul(windowY));
    for (let i = 0; i < 7; i++) {
        for (const side of [-1, 1]) {
            const h = 530 + (i % 3) * 220;
            const tower = add(new THREE.Mesh(towerGeometry, towerMaterial));
            tower.scale.set(130, h, 145);
            tower.position.set(side * (205 + i * 8), h * 0.5, -80 - i * 195);
        }
    }
    const streetMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x080f1c });
    const streetGeometry = new THREE.PlaneGeometry(430, 4000);
    const street = add(new THREE.Mesh(streetGeometry, streetMaterial));
    street.rotation.x = -Math.PI / 2;
    street.position.set(0, 0, -1800);
    const vergeGeometry = new THREE.PlaneGeometry(1.4, 4000);
    const vergeMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x1aa4b9 });
    for (const side of [-1, 1]) {
        const verge = add(new THREE.Mesh(vergeGeometry, vergeMaterial));
        verge.rotation.x = -Math.PI / 2;
        verge.position.set(side * 90, 0.15, -1800);
    }

    const events = new NeonDistrictEvents(scene, {
        quality: params.get('quality') || 'High',
        reducedMotion: params.get('reducedMotion') === '1',
    });
    const event = params.get('event') || 'combo';
    const fire = () => {
        if (event === 'lock') events.triggerLock();
        else if (event === 'clear' || event === 'tetris') events.triggerClear(event === 'tetris' ? 4 : 1);
        else if (event === 'all') {
            events.triggerClear(4);
            events.triggerCombo(7);
        } else events.triggerCombo(Number(params.get('combo') || 7));
    };
    let sought = -1;
    let nextEventTime = 0;
    window.__NEON_DISTRICT_EVENTS__ = events;
    return {
        cameraRadius: 1,
        camera() {},
        seek(time) {
            const phase = Math.max(0, time);
            if (phase === sought) return;
            sought = phase;
            events.reset();
            fire();
            events.update(phase);
        },
        update(time, dt) {
            if (params.has('t')) return;
            if (time >= nextEventTime) { fire(); nextEventTime = time + 5; }
            events.update(dt);
        },
        dispose() {
            if (window.__NEON_DISTRICT_EVENTS__ === events) delete window.__NEON_DISTRICT_EVENTS__;
            events.dispose();
            for (const object of objects) scene.remove(object);
            towerGeometry.dispose();
            towerMaterial.dispose();
            streetGeometry.dispose();
            streetMaterial.dispose();
            vergeGeometry.dispose();
            vergeMaterial.dispose();
            scene.background = savedBackground;
            scene.fog = savedFog;
        },
    };
}
