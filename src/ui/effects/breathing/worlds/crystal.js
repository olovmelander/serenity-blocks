/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Crystal Prism — a quartz point turning in a beam of white light.
 * Inhale: the light fans out into colour. Exhale: the fan folds back into the crystal.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, cos, dot, exp, float, length, max, mix, normalView, normalize, positionViewDirection, positionWorld, pow,
    sin,
    smoothstep, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, starfield,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION } from '../stage/breath-motes.js';

const TAU = Math.PI * 2;
const ICE = vec3(0.62, 0.92, 1.0);
/** A soft spectrum: red at 0 through green to violet at 1. */
const spectrum = (hue) => cos(vec3(0.0, 0.33, 0.67).add(hue.mul(0.8)).mul(TAU)).mul(0.5).add(0.5);

function crystalMaterial(u) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.colorNode = Fn(() => {
        const n = normalize(normalView).toVar();
        const v = normalize(positionViewDirection).toVar();
        const facing = dot(n, v).abs().toVar();
        const edge = pow(float(1).sub(facing), 2.2);
        // Two fixed lamps: as the crystal turns, each facet takes its turn to flare.
        const glint = (lamp, power) => pow(max(dot(n, normalize(lamp.add(v))), 0), power);
        const flares = glint(normalize(vec3(-0.6, 0.5, 0.6)), 70).mul(1.7)
            .add(glint(normalize(vec3(0.7, 0.25, 0.65)), 34).mul(0.7));
        // Each facet shows a different slice of the spectrum from inside the stone.
        const hue = dot(n, vec3(0.7, 0.25, 0.45)).mul(1.5).add(u.time.mul(0.03));
        // Veins of light inside the stone, sliding as it turns.
        const veins = sin(positionWorld.y.mul(26).add(dot(n, vec3(3.0, 1.0, 2.0)).mul(4))).mul(0.5).add(0.5);
        const inner = mix(vec3(0.02, 0.08, 0.13), spectrum(hue), u.breath.mul(0.32).add(0.16))
            .mul(facing.mul(0.5).add(0.22)).mul(veins.mul(0.5).add(0.6)).mul(u.breath.mul(0.6).add(0.45));
        return inner.add(ICE.mul(edge).mul(1.15)).add(vec3(1.0).mul(flares).mul(u.breath.mul(0.9).add(0.6)));
    })();
    return material;
}

export function createCrystalWorld({ u, quality }) {
    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const r = length(p).toVar();
        const col = mix(vec3(0.014, 0.034, 0.056), vec3(0.003, 0.006, 0.018), smoothstep(0.0, 1.7, r)).toVar();
        col.addAssign(starfield(p, u, 0.45).mul(0.6));
        const dust = fbm(p.mul(2.3).add(vec2(u.time.mul(0.02), 3.1)), 3).mul(0.7).add(0.45).toVar();
        const lift = u.breath.mul(0.75).add(0.45).toVar();

        // White light arrives from the left as one narrow beam.
        const axis = p.y.sub(p.x.mul(0.07));
        const beam = exp(axis.mul(axis).div(0.0011).negate()).add(exp(axis.mul(axis).div(0.02).negate()).mul(0.12))
            .mul(fadeOut(-0.08, 0.04, p.x));
        col.addAssign(vec3(0.92, 0.96, 1.0).mul(beam).mul(dust).mul(lift)
            .mul(0.7));

        // It leaves on the right as a fan whose width is the breath.
        const spread = u.breath.mul(0.44).add(0.07).toVar();
        const across = p.y.div(max(p.x, 0.02)).div(spread).toVar();
        const fan = fadeOut(0.5, 1.1, across.abs()).mul(smoothstep(0.04, 0.3, p.x)).mul(exp(p.x.mul(-0.55)));
        const bands = sin(across.mul(11)).mul(0.14).add(0.86);
        col.addAssign(mix(spectrum(across.mul(0.5).add(0.5)), vec3(1.0), 0.22).mul(fan).mul(bands).mul(dust.mul(1.3).sub(0.25))
            .mul(lift)
            .mul(0.5));

        col.addAssign(ICE.mul(exp(r.mul(-3.0))).mul(0.13).mul(lift));
        return col;
    })();

    // A double-terminated quartz point: six sides, flat facets.
    const profile = [[0, 0.66], [0.2, 0.36], [0.2, -0.36], [0, -0.66]].map(([x, y]) => new THREE.Vector2(x, y));
    const lathe = new THREE.LatheGeometry(profile, 6);
    const geometry = lathe.toNonIndexed();
    lathe.dispose();
    geometry.computeVertexNormals();
    const material = crystalMaterial(u);
    const crystal = new THREE.Mesh(geometry, material);
    const tilt = new THREE.Group();
    tilt.rotation.z = 0.2;
    tilt.add(crystal);
    // Splinters keep the stone company and give the turning a sense of depth.
    const shards = [
        [-0.62, 0.42, -0.5, 0.2], [0.55, -0.5, 0.35, 0.16], [-0.48, -0.52, 0.5, 0.13], [0.7, 0.5, -0.7, 0.18],
    ].map(([x, y, z, size], index) => {
        const shard = new THREE.Mesh(geometry, material);
        shard.position.set(x, y, z);
        shard.scale.setScalar(size);
        shard.rotation.set(index * 1.3, index * 0.7, index * 2.1);
        return shard;
    });
    const group = new THREE.Group();
    group.add(tilt, ...shards);

    return {
        backdrop,
        objects: [group],
        motes: {
            motion: MOTE_MOTION.drift,
            count: 70,
            size: 0.02,
            speed: 0.5,
            spread: 0.8,
            depth: 2,
            colorA: [0.7, 0.95, 1.0],
            colorB: [1.0, 0.85, 0.95],
            gain: 0.35,
        },
        bloom: { strength: 0.55, radius: 0.7, threshold: 0.6 },
        exposure: 1.0,
        quality,
        update({ time, breath }) {
            crystal.rotation.y = time * 0.11;
            tilt.scale.setScalar(0.92 + breath * 0.12);
            shards.forEach((shard, index) => {
                shard.rotation.y = time * (0.16 + index * 0.05) + index;
                shard.position.y += Math.sin(time * 0.3 + index * 2) * 0.0004;
            });
        },
    };
}
