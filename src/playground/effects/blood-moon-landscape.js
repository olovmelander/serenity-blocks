/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, clamp, exp, float, max, mix, sin, smoothstep, texture, vec2, vec3, vec4,
} from 'three/tsl';

/** Both plates are linear material data, authored by scripts/blender/blood_moon_range.py. */
export function loadBloodMoonLandscape() {
    const loader = new THREE.TextureLoader();
    let remaining = 2;
    let finished;
    const ready = new Promise((resolve) => { finished = resolve; });
    const settle = () => {
        remaining -= 1;
        if (remaining === 0) finished();
    };
    const range = loader.load('./textures/blood-moon/caldera-relief.png', settle, undefined, settle);
    const salt = loader.load('./textures/blood-moon/salt-relief.png', settle, undefined, settle);
    range.colorSpace = THREE.NoColorSpace;
    salt.colorSpace = THREE.NoColorSpace;
    salt.wrapS = THREE.RepeatWrapping;
    salt.wrapT = THREE.RepeatWrapping;
    return { range, salt, ready };
}

// Twelve salt polygons across the plate. The baked edge distance is in cell units;
// green and blue hold its direction toward the raised crest, alpha the mineral content.
export const mineralRim = Fn(([s]) => vec4(s.r.mul(0.78), s.gb.mul(2).sub(1), s.a))
    .setLayout({ name: 'bmMineralRim', type: 'vec4', inputs: [{ name: 's', type: 'vec4' }] });

export function mountainRange(U, atlas, az, el, air) {
    const u = az.sub(U.volcanoAz).div(U.volcanoWidth).add(7).div(10);
    const v = el.div(U.volcanoHeight.mul(1.46));
    const plate = texture(atlas, vec2(u, v)).toVar();
    const flank = plate.r;
    const snow = plate.g;
    const distance = plate.b;
    // A violet fill in the gullies keeps the folds readable as night terrain.
    // Moonlight catches the exposed basalt faces, then the higher snow ledges.
    const shade = mix(vec3(0.009, 0.0038, 0.010), vec3(0.016, 0.008, 0.017), snow);
    const direct = U.moonLight.mul(115).mul(flank).mul(snow.mul(0.46).add(0.18));
    const stone = shade.mul(U.exposure).add(direct)
        .add(vec3(0.028, 0.012, 0.028).mul(flank).mul(snow).mul(U.exposure));
    // The close black foothills cut into progressively paler ridges. Ground mist
    // fills their distant valleys, so the nearest shore keeps a dark waterline.
    const lifted = smoothstep(0.11, 0.96, distance);
    const mist = lifted.mul(lifted).mul(0.46).add(lifted.mul(exp(max(el, 0).mul(-42))).mul(0.12));
    const range = stone.mul(smoothstep(0, 0.40, distance).mul(0.44).add(0.56));
    return { colour: mix(range, air, mist), coverage: plate.a };
}

/** Crosswind across the thin lake, in packets separated by stretches of glass. */
export function windOnFlat(U, p, footprint, waves) {
    const beat = sin(U.time.mul(0.028).sub(0.2)).mul(0.5).add(0.5);
    const patch = sin(p.x.mul(0.49).add(p.y.mul(0.22)).sub(U.time.mul(0.13)))
        .mul(0.42).add(0.58).mul(beat.mul(0.72).add(0.28));
    const sway = sin(p.x.mul(0.91).add(p.y.mul(0.64)).sub(U.time.mul(0.26))).toVar();
    const swell = sin(p.y.mul(4.8).add(p.x.mul(0.86)).add(sway.mul(1.8)).add(U.time.mul(0.90)))
        .mul(0.0065);
    const nx = sin(p.x.mul(1.4).sub(p.y.mul(0.68)).add(U.time.mul(0.69))).mul(0.0029);
    const nz = swell.toVar();
    if (waves > 1) {
        // A second, finer wave train is filtered out before foreshortening aliases it.
        const capillary = sin(p.y.mul(19).sub(p.x.mul(1.31)).add(sway.mul(3.8)).sub(U.time.mul(1.55)));
        nz.addAssign(capillary.mul(0.0048).mul(float(1).sub(smoothstep(0.04, 0.20, footprint))));
    }
    return vec2(nx, nz).mul(patch.mul(1.18).add(0.35)).mul(U.agitation.mul(1.9).add(1))
        .mul(float(1).sub(smoothstep(0.35, 1.85, footprint)));
}

/** Horizontal facets return light even where the perfectly flat surface misses the disk. */
export function lunarRoad(U, p, footprint, moonPlane, rim, near) {
    const across = exp(moonPlane.x.mul(moonPlane.x).mul(-1.8));
    const along = exp(abs(moonPlane.y).mul(-0.50));
    const envelope = across.mul(along).mul(smoothstep(0.30, 1.25, abs(moonPlane.y)));
    const fold = sin(p.x.mul(1.13).add(p.y.mul(0.44)).sub(U.time.mul(0.38)));
    const train = sin(p.y.mul(19).sub(p.x.mul(1.31)).add(fold.mul(3.8)).sub(U.time.mul(1.55)));
    const crests = smoothstep(0.35, 0.94, train);
    const streak = mix(0.18, crests, float(1).sub(smoothstep(0.05, 0.21, footprint)))
        .mul(fold.mul(0.30).add(0.64));
    const wet = float(1).sub(rim.mul(near).mul(0.82));
    return U.moonLight.mul(178).mul(envelope).mul(streak).mul(wet)
        .mul(U.agitation.mul(U.eventFlash).mul(0.42).add(0.57));
}

/** A broken copper edge and its cool salt shoulder, following the same warped cell boundary. */
export function saltVeins(U, rimM, ridgeWidth, footprint, cell, near, groundLight, ringLight) {
    const pixel = clamp(footprint, 0.002, 0.12);
    const edge = float(1).sub(smoothstep(0.003, pixel.mul(0.75).add(0.022), rimM));
    const halo = exp(rimM.div(ridgeWidth).mul(-2.9));
    const facing = clamp(cell.yz.dot(U.moonDir.xz).mul(-0.55).add(0.50), 0.12, 1);
    const mineral = cell.w.mul(0.55).add(0.45);
    const spill = edge.mul(facing.mul(0.72).add(0.28)).add(halo.mul(0.20));
    const tint = vec3(0.041, 0.0044, 0.008).mul(U.exposure).add(groundLight.mul(vec3(0.45, 0.50, 0.66)));
    return tint.mul(spill).mul(mineral).mul(near).mul(clamp(ringLight, 0, 1).mul(0.75).add(1));
}
