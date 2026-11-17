/**
 * Starlight — the great comet: a visitor that comes back now and then for a few minutes and
 * stands low over the hills left of the card, its tails rising away from the sun far below the
 * northern horizon. A perfect clear calls it, or makes the one in the sky burst out.
 *
 * One grid laid along the comet on the sky: `s` runs from just ahead of the head (−0.08) to the
 * end of the tails (1), in tail lengths; across it the grid is wide enough for both tails. The
 * fragment draws, in those coordinates:
 *
 *   coma      a green-cyan glow round the head (the gas), a white point at its heart
 *   dust      a broad tail that curves away to one side as it goes, warm white, faintly striated
 *             (the grains drift behind the comet's path)
 *   ion       a thin straight blue tail along the line away from the sun, its streamers running
 *             outward and kinking
 *
 * The world writes the comet's place (a unit world direction), the tail's axis (a unit tangent
 * at the head, away from the sun) and the side the dust bends to, every frame: the comet turns
 * with the sky. It is drawn twice, in the sky and in the lake, and sets behind the hills like a
 * star. It costs nothing while it is away: the meshes are hidden.
 */
import * as THREE from 'three/webgpu';
import {
    abs,
    cameraPosition,
    clamp,
    cos,
    exp,
    max,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SKY_RADIUS, mirrorDir, mirrorShare, ridges, woodsTop,
} from './starlight-tsl.js';

/** Segments along the comet and across it. */
const ALONG = 28;
const ACROSS = 8;
/** Where the grid starts ahead of the head, in tail lengths. */
const LEAD = 0.13;
/** The dust tail's bend (its centre's offset at the tail's end, in tail lengths). */
export const DUST_CURVE = 0.24;

function gridGeometry() {
    const rows = ALONG + 1;
    const cols = ACROSS + 1;
    const position = new Float32Array(rows * cols * 3);
    const index = [];
    for (let i = 0; i < rows; i += 1) {
        for (let j = 0; j < cols; j += 1) {
            const v = (i * cols + j) * 3;
            // Closer together near the head, where the coma needs them.
            const k = i / ALONG;
            position[v] = -LEAD + (1 + LEAD) * k * k;
            position[v + 1] = (j / ACROSS) * 2 - 1;
            position[v + 2] = 0;
        }
    }
    for (let i = 0; i < ALONG; i += 1) {
        for (let j = 0; j < ACROSS; j += 1) {
            const a = i * cols + j;
            index.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setIndex(index);
    return geometry;
}

function cometMaterial({
    u, noise, tier, mirrored,
}) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        side: THREE.DoubleSide,
        fog: false,
    });
    const s = positionGeometry.x;
    const w = positionGeometry.y;
    const head = u.comet.xyz;
    const axis = u.cometTail.xyz;
    const length = u.cometTail.w;
    const side = u.cometSide.xyz;
    // Along the great circle from the head away from the sun, then across it.
    const run = s.mul(length);
    const centre = head.mul(cos(run)).add(axis.mul(sin(run)));
    const ahead = max(s, 0.0);
    const bend = ahead.mul(ahead).mul(DUST_CURVE);
    // Wide enough at the head for the whole coma (a narrower grid clips it into a box).
    const half = ahead.mul(0.2).add(ahead.mul(ahead).mul(0.12)).add(0.11).add(bend.mul(0.5));
    const across = bend.mul(0.5).add(w.mul(half));
    const d = normalize(centre.add(side.mul(across.mul(length))));
    // Behind the hills (or the woods on the near crest) the comet is not drawn, as a star.
    const crest = ridges(noise, d);
    const sees = smoothstep(0.0, 0.004, d.y.sub(max(max(crest.x.add(woodsTop(noise, d)), crest.y), crest.z)));
    let place = d;
    let shown = sees;
    if (mirrored) {
        place = mirrorDir(u, noise, cameraPosition, d, tier);
        shown = sees.mul(mirrorShare(place)).mul(step(place.y, -0.0006)).mul(0.78);
    }
    material.positionNode = cameraPosition.add(place.mul(SKY_RADIUS));
    // (s, across, both in tail lengths; how much of it shows)
    const vAt = varying(vec4(s, across, shown, w));

    const at = vAt.x;
    const a = vAt.y;
    const t = u.time;
    const out = u.cometSide.w;
    // The coma and the nucleus.
    const r2 = at.mul(at).add(a.mul(a));
    const coma = exp(r2.div(0.0007).negate()).add(exp(r2.div(0.0019).negate()).mul(0.3));
    const nucleus = exp(r2.div(0.00004).negate());
    // The ion tail: straight along the axis, thin, its streamers running outward.
    const tail = step(0.0, at);
    const ionW = at.mul(0.022).add(0.005);
    const ionX = a.div(ionW);
    const streamers = sin(at.mul(34.0).sub(t.mul(0.9)).add(a.mul(180.0))).mul(0.3)
        .add(sin(at.mul(13.0).sub(t.mul(0.5))).mul(0.2)).add(0.75);
    const ion = exp(ionX.mul(ionX).negate()).mul(exp(at.div(-0.5))).mul(streamers).mul(tail);
    // The dust tail: broad, bending to its side, fading slower, faintly striated.
    const dustC = at.mul(at).mul(DUST_CURVE);
    const dustW = at.mul(0.17).add(0.012);
    const dustX = a.sub(dustC).div(dustW);
    const striae = sin(a.sub(dustC).mul(70.0).add(at.mul(18.0))).mul(0.12).add(0.9);
    const dust = exp(dustX.mul(dustX).negate()).mul(exp(at.div(-0.62))).mul(smoothstep(0.0, 0.06, at)).mul(striae);
    // The grid's own edges fade out, so no outline of it can show.
    const edges = smoothstep(1.0, 0.82, at).mul(smoothstep(-LEAD, -LEAD * 0.5, at))
        .mul(smoothstep(1.0, 0.8, abs(vAt.w)));
    const burst = out.mul(1.6).add(1.0);
    const light = vec3(0.52, 1.0, 0.78).mul(coma.mul(1.3)).add(vec3(1.0, 1.0, 1.0).mul(nucleus.mul(4.0)))
        .mul(burst)
        .add(vec3(1.0, 0.86, 0.66).mul(dust.mul(0.42)))
        .add(vec3(0.42, 0.62, 1.0).mul(ion.mul(0.36)))
        .mul(edges)
        .mul(vAt.z)
        .mul(u.comet.w);
    material.outputNode = vec4(clamp(light, 0.0, 40.0), 0.0);
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    return material;
}

export function createComet({ u, noise, tier }) {
    const geometry = gridGeometry();
    const build = (mirrored) => {
        const mesh = new THREE.Mesh(geometry, cometMaterial({
            u, noise, tier, mirrored,
        }));
        mesh.frustumCulled = false;
        mesh.renderOrder = mirrored ? 18 : 19;
        mesh.name = mirrored ? 'starlight-comet-mirror' : 'starlight-comet';
        mesh.visible = false;
        return mesh;
    };
    const sky = build(false);
    const lake = build(true);
    const group = new THREE.Group();
    group.name = 'starlight-comet';
    group.add(lake, sky);
    return {
        object: group,
        /** Shown only while the comet is in the sky. */
        setVisible(on) {
            sky.visible = on;
            lake.visible = on;
        },
        dispose() {
            geometry.dispose();
            sky.material.dispose();
            lake.material.dispose();
        },
    };
}
