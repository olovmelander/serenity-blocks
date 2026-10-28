#!/usr/bin/env node
/**
 * Forest — the eagle owl's poses for the Blender design loop.
 *
 * Writes named poses from the theme's own rig (src/themes/forest/forest-owl-rig.js) as JSON that
 * scripts/blender/forest_owl/live.py applies to the model in Blender, so the renders show exactly what
 * the theme will draw:
 *
 *   node scripts/forest/owl-poses.mjs <out.json>
 *
 * Each pose: { bones: { name: [w, x, y, z] (owl frame), "throat%": [sx, sy, sz] ... }, position, rotation }.
 */
import { writeFileSync } from 'node:fs';
import {
    OWL_BONES, OWL_ROOT_HEIGHT, createOwlPose, owlFlightBody, poseOwl,
} from '../../src/themes/forest/forest-owl-rig.js';

const out = process.argv[2] || 'owl-poses.json';

function wings(pose, values) {
    pose.wings.forEach((w) => Object.assign(w, values));
}

const POSES = {
    rest: (p) => {
        wings(p, { fold: 0 });
        p.legs.forEach((l) => Object.assign(l, { grip: 0 }));
    },
    perch: () => {},
    half: (p) => wings(p, { fold: 0.5 }),
    glide: (p) => {
        owlFlightBody(0, 0, 0, p.body);
        wings(p, {
            fold: 0, dihedral: 6, twist: 2, load: 0.4,
        });
        p.head = [0, 62, 0];
        p.tufts = 0.1;
        p.legs.forEach((l) => Object.assign(l, { tuck: 1, grip: 0.6 }));
        p.tail.fan = 1.1;
    },
    down: (p) => {
        owlFlightBody(0, 0, 0, p.body);
        wings(p, {
            fold: 0, dihedral: -30, sweep: -6, twist: -5, load: 1, fan: 1.08,
        });
        p.head = [0, 62, 0];
        p.tufts = 0.1;
        p.legs.forEach((l) => Object.assign(l, { tuck: 1, grip: 0.6 }));
    },
    up: (p) => {
        owlFlightBody(0, 0, 0, p.body);
        wings(p, {
            fold: 0, dihedral: 24, sweep: 8, twist: 6, flex: 0.5, handTwist: 28, fan: 0.88, load: -0.3,
        });
        p.head = [0, 62, 0];
        p.tufts = 0.1;
        p.legs.forEach((l) => Object.assign(l, { tuck: 1, grip: 0.6 }));
    },
    flare: (p) => {
        owlFlightBody(0, 48, 0, p.body);
        wings(p, {
            fold: 0, dihedral: 28, sweep: -20, twist: 24, fan: 1.3, alula: 1, load: 0.6,
        });
        p.head = [0, 14, 0];
        p.tufts = 0.3;
        p.tail = { pitch: -24, yaw: 0, fan: 1.8 };
        p.legs.forEach((l) => Object.assign(l, { reach: 1, spread: 1, grip: 0 }));
    },
    look: (p) => {
        p.head = [120, 10, 8];
        p.blink = [0.5, 0.5];
        p.tufts = 1;
    },
};

const result = {};
Object.entries(POSES).forEach(([name, edit]) => {
    const pose = createOwlPose();
    edit(pose);
    const frame = poseOwl(pose);
    const bones = {};
    frame.rotations.forEach((q, i) => {
        bones[OWL_BONES[i]] = [q[3], q[0], q[1], q[2]].map((v) => +v.toFixed(6));
    });
    Object.entries(frame.scales).forEach(([bone, s]) => {
        bones[`${bone}%`] = s.map((v) => +v.toFixed(5));
    });
    bones['root@'] = frame.root;
    // Flight poses float the owl so its body's centre stays where it was.
    const standing = ['rest', 'perch', 'half', 'look'].includes(name);
    result[name] = { bones, position: [0, standing ? 0 : 0.1, 0] };
});
writeFileSync(out, JSON.stringify(result));
console.log(`wrote ${Object.keys(result).length} poses (${OWL_BONES.length} bones, root at ${OWL_ROOT_HEIGHT} m)`);
