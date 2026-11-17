/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// CHAPTER 7 — THE FOLD'S PLACES bench (masterpiece pass, 2026-11-17).
//
// The fold's eight places (chapter-environments/odyssey-fold-places.tsl.js) on a sphere round the
// eye, through the Odyssey's own post (chapter 7's bloom and grade: a place judged without them
// is two stops too bright), with nothing else: no hole, no path. For composing one place at a
// time, the wave one room opens through another by, and the clock's moods and happenings. The
// real framing (the rail camera, the orbs) is `effect=ch7-fall&p=` and the game.
//
// URL params:
//   ?effect=ch7-fold-places&place=0..7&t=8
//   placeB=<0..7>&morph=<0..1>   the next room, and how far it has opened through this one
//   door=<x>,<y>                 where it opens from (tangents of the view angle; default 0,0)
//   straight=<0..1>&pour=<0..1>  the hall: straightened into the city's grid; the city's light
//   event=<0..1>&age=<s>         hold a happening at this strength and age (default: the clock's)
//   mood=<a>,<b>,<c>             hold the three moods (default: the clock's)
//   turns=<n>                    hold the quarter turns made
//   speed=<n>                    travel: phase per second (default 1: the parked cruise)
//   steps=<n>                    walk steps (default 32: High)
//   fov=<deg>                    the lens (default 66)
//   look=<yawDeg>,<pitchDeg>     turn the eye in the room
//   post=0                       without the Odyssey post (the raw linear picture)
import * as THREE from 'three/webgpu';
import {
    Fn, normalize, positionLocal, uniform,
} from 'three/tsl';
import {
    createFoldRoomUniforms,
    foldSpaceColour,
} from '../../rendering/odyssey/chapter-environments/odyssey-fold-space.tsl.js';
import { resolveFoldClock } from '../../rendering/odyssey/transitions/odyssey-fold-clock.js';
import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';
import { OdysseyDirector } from '../../rendering/odyssey/composition/OdysseyDirector.js';
import { OdysseyTslPipeline } from '../../rendering/odyssey/odyssey-post/odyssey-tsl-pipeline.js';
import { getActiveOdysseyChapterPositions } from '../../rendering/odyssey/path-utils.js';
import { resolveChapterBlendState } from '../../rendering/odyssey/ChapterEnvironmentManager.js';

export const meta = {
    id: 'ch7-fold-places',
    title: 'Ch7 the fold: eight places',
    description: 'The eight places inside the hole, one at a time or one opening through another (no hole or path).',
};

const num = (params, key, dflt) => {
    const value = Number.parseFloat(params.get(key));
    return Number.isFinite(value) ? value : dflt;
};
const list = (params, key) => (params.get(key) ?? '').split(',').map(Number).filter(Number.isFinite);

export function create({
    scene, camera, params, renderer, sizes,
}) {
    const uTime = uniform(0);
    const uPhase = uniform(0);
    const room = createFoldRoomUniforms();
    const steps = Math.max(8, Math.min(64, Math.round(num(params, 'steps', 32))));
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = Fn(() => foldSpaceColour({
        ray: normalize(positionLocal), time: uTime, phase: uPhase, steps, room,
    }))();
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.fog = false;
    const geometry = new THREE.SphereGeometry(50, 48, 32);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);

    room.placeA.value = num(params, 'place', 0);
    room.placeB.value = num(params, 'placeB', room.placeA.value);
    room.morph.value = num(params, 'morph', 0);
    room.straight.value = num(params, 'straight', 1);
    room.pour.value = num(params, 'pour', 0);
    const door = list(params, 'door');
    room.door.value.set(door[0] ?? 0, door[1] ?? 0, 1).normalize();
    const heldMood = list(params, 'mood');
    const heldEvent = params.has('event') ? num(params, 'event', 0) : null;
    const heldTurns = params.has('turns') ? num(params, 'turns', 0) : null;
    const speed = num(params, 'speed', 1);
    const look = list(params, 'look');

    // Chapter 7's own grade and bloom, from the director's state in the middle of the chapter.
    const positions = getActiveOdysseyChapterPositions();
    const progress = positions[6] + ((positions[7] - positions[6]) * 0.55);
    const director = new OdysseyDirector({ chapterPositions: positions });
    const blend = resolveChapterBlendState(progress, CHAPTER_CONFIGS, positions);
    let directorState = director.update(1 / 60, { ascentProgress: progress, blendState: blend });
    let post = null;
    if (params.get('post') !== '0') {
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        post = new OdysseyTslPipeline(renderer, scene, camera, {
            enableBloom: true, bloomStrength: 0.32, bloomThreshold: 0.85, bloomRadius: 0.7, sceneSamples: 4,
        });
        post.setSize(Math.max(1, sizes?.width || 1280), Math.max(1, sizes?.height || 720));
    }

    return {
        cameraRadius: 0.001,
        camera() {
            camera.position.set(0, 0, 0);
            const rad = THREE.MathUtils.degToRad;
            camera.rotation.set(rad(look[1] ?? 0), rad(-(look[0] ?? 0)), 0, 'YXZ');
            camera.fov = num(params, 'fov', 66);
            camera.updateProjectionMatrix();
        },
        update(time) {
            uTime.value = time;
            uPhase.value = time * speed;
            const clock = resolveFoldClock(time);
            const mood = heldMood.length === 3 ? heldMood : clock.mood;
            room.mood.value.set(mood[0], mood[1], mood[2]);
            room.event.value.set(
                heldEvent ?? clock.event,
                params.has('age') ? num(params, 'age', 0) : clock.eventAge,
                clock.eventSeed,
                heldTurns ?? clock.turns,
            );
            // (The director smooths by dt: a fixed ?t= frame would never settle on delta 0.)
            directorState = director.update(1 / 60, { ascentProgress: progress, blendState: blend });
            post?.update(1 / 60, directorState);
        },
        render() {
            if (post) post.render();
            else renderer.render(scene, camera);
        },
        resize(w, h) {
            post?.setSize(Math.max(1, w), Math.max(1, h));
        },
        dispose() {
            scene.remove(mesh);
            geometry.dispose();
            material.dispose();
            post?.dispose();
            director.dispose();
        },
    };
}
