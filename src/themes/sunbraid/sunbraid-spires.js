/**
 * Sunbraid — the towers: pale bedded sandstone standing out of the valley floor, one instanced
 * mesh per shape (sunbraid-spire-shape.js), all sharing one material.
 *
 * The stone is pale with faint mineral tints in its beds (blush, ivory, lilac, sage): under one
 * white light they would barely show, under three coloured suns every cliff takes the colour of the
 * suns it faces and its corners are where those colours meet. Streaks run down the faces from the
 * ledges, the beds show as fine lines, pale turf grows on the flat tops and ledges, and the stone is
 * darker in the inner corners of its setbacks. Every tower shadows every other, and itself.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cross, dFdx, dFdy, dot, float, floor, fract, fwidth, length, max, mix, normalize, normalWorld,
    positionWorld, select, sign, smoothstep, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { SPIRE_LAYOUT, spireFoot } from './sunbraid-plan.js';
import { SPIRE_VARIANTS, buildSpireMesh } from './sunbraid-spire-shape.js';
import {
    haze, mist, sbHash21, sunLight, sunVisibility,
} from './sunbraid-tsl.js';

function createSpireMaterial(u, t) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const Ng = normalize(normalWorld).toVar();
        // Relief: blocks and grain in the stone, read on the two vertical planes and the top, as a
        // bump (the surface gradient from screen derivatives), fading out where it would alias.
        const wx = Ng.x.abs();
        const wz = Ng.z.abs();
        const wy = Ng.y.abs();
        const plane = (scale, channel) => texture(t.noise, P.zy.div(scale))[channel].mul(wx)
            .add(texture(t.noise, P.xy.div(scale))[channel].mul(wz))
            .add(texture(t.noise, P.xz.div(scale))[channel].mul(wy));
        const bumpH = plane(64.0, 'b').mul(1.2).add(plane(14.0, 'a').mul(0.3)).toVar();
        const dpdx = dFdx(P);
        const dpdy = dFdy(P);
        const r1 = cross(dpdy, Ng);
        const r2 = cross(Ng, dpdx);
        const det = dot(dpdx, r1);
        const grad = r1.mul(dFdx(bumpH)).add(r2.mul(dFdy(bumpH))).mul(sign(det));
        const near = smoothstep(4200.0, 900.0, length(P.sub(u.eye)));
        const bumped = Ng.mul(abs(det)).sub(grad.mul(near)).toVar();
        const N = select(length(bumped).greaterThan(1e-9), normalize(bumped), Ng).toVar();
        const shape = attribute('aSpire', 'vec2');
        const ao = shape.y;
        const seed = attribute('aSeed', 'float');
        // The beds: a few metres thick, each a faintly different pale stone.
        // Beds a metre to a few metres thick: cream, ochre, rose and a little lilac, pale.
        const bedCoord = P.y.div(3.2).add(texture(t.noise, P.xz.div(900.0)).r.mul(3.0)).add(seed.mul(13.0));
        const bed = floor(bedCoord);
        const pick = sbHash21(vec2(bed, floor(seed.mul(97.0))));
        const cream = vec3(0.95, 0.9, 0.8);
        const ochre = vec3(0.93, 0.79, 0.6);
        const rose = vec3(0.94, 0.78, 0.74);
        const lilac = vec3(0.86, 0.84, 0.92);
        const warm = mix(cream, ochre, smoothstep(0.25, 0.45, pick));
        const cool = mix(rose, lilac, smoothstep(0.75, 0.9, pick));
        const tint = mix(warm, cool, smoothstep(0.5, 0.62, pick));
        const bedRoom = float(1.0).sub(smoothstep(0.12, 0.35, fwidth(bedCoord)));
        const bedLine = smoothstep(0.9, 1.0, fract(bedCoord)).mul(0.05).mul(bedRoom);
        // Streaks run down the cliffs from the ledges; fine grain over everything.
        const streak = texture(t.noise, vec2(P.x.add(P.z).div(26.0), P.y.div(420.0))).b;
        const grain = texture(t.noise, vec2(P.x.sub(P.z).div(8.0), P.y.div(5.0))).a;
        const weathering = float(0.88).add(grain.mul(0.1)).sub(smoothstep(0.55, 0.8, streak).mul(0.12));
        const stone = tint.mul(weathering.sub(bedLine));
        // Pale turf on the flat tops and ledges (silver-green, in tufts).
        const flat = smoothstep(0.82, 0.95, N.y);
        const tuft = texture(t.noise, P.xz.div(14.0)).g;
        const turf = mix(vec3(0.78, 0.84, 0.74), vec3(0.62, 0.72, 0.6), smoothstep(0.4, 0.7, tuft));
        const albedo = mix(stone, turf, flat.mul(smoothstep(0.3, 0.5, tuft).mul(0.6).add(0.3))).toVar();
        const vis = sunVisibility(u, P, t.noise);
        const cavity = ao.mul(0.4).add(0.6);
        const lit = sunLight(u, N, vis, 0.18).mul(cavity);
        const sky = mix(u.horizon, u.zenith, N.y.mul(0.5).add(0.5)).mul(N.y.mul(0.35).add(0.65)).mul(0.45).mul(ao);
        // Light thrown up off the white valley floor onto the cliffs, strongest low down.
        const lowness = smoothstep(260.0, 0.0, P.y.sub(u.groundY));
        const bounce = u.groundLit.mul(0.3).mul(float(0.5).sub(N.y.mul(0.5))).mul(ao).mul(lowness.mul(0.7).add(0.3));
        // Looking toward the suns, light grazes round the silhouettes (dust on the stone).
        const V = normalize(P.sub(u.eye));
        const edge = float(1.0).sub(max(dot(N, V.negate()), 0.0));
        const edge2 = edge.mul(edge);
        const sheenOf = (S) => {
            const m = max(dot(V, S), 0.0);
            const m2 = m.mul(m);
            const m4 = m2.mul(m2);
            return m4.mul(m4).mul(edge2);
        };
        const sheen = u.col0.mul(sheenOf(u.sun0).mul(vis.x)).add(u.col1.mul(sheenOf(u.sun1).mul(vis.y)))
            .add(u.col2.mul(sheenOf(u.sun2).mul(vis.z))).mul(0.32);
        const colour = albedo.mul(lit.add(sky).add(bounce)).add(sheen);
        return vec4(haze(u, mist(u, colour, P, vis), P), 1.0);
    })();
    material.fog = false;
    return material;
}

export function createSpires(u, t, tier) {
    const material = createSpireMaterial(u, t);
    const meshes = [];
    const geometries = [];
    const foot = [0, 0, 0];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    for (let v = 0; v < SPIRE_VARIANTS; v++) {
        const members = SPIRE_LAYOUT.map((spire, index) => ({ spire, index }))
            .filter(({ spire }) => spire.variant === v);
        if (!members.length) continue;
        const shape = buildSpireMesh(v, tier.spire.segs, tier.spire.rings);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(shape.position, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(shape.normal, 3));
        geometry.setAttribute('aSpire', new THREE.BufferAttribute(shape.spire, 2));
        geometry.setIndex(new THREE.BufferAttribute(shape.index, 1));
        const seeds = new Float32Array(members.length);
        const mesh = new THREE.InstancedMesh(geometry, material, members.length);
        members.forEach(({ spire, index }, k) => {
            spireFoot(spire, foot);
            q.setFromAxisAngle(Y, spire.twist);
            s.setScalar(spire.h);
            p.set(foot[0], foot[1], foot[2]);
            m.compose(p, q, s);
            mesh.setMatrixAt(k, m);
            seeds[k] = (index * 0.6180339) % 1;
        });
        geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.name = `Sunbraid towers ${v}`;
        mesh.frustumCulled = false;
        mesh.renderOrder = 5;
        meshes.push(mesh);
        geometries.push(geometry);
    }
    return {
        mesh: meshes[0],
        meshes,
        material,
        dispose() {
            geometries.forEach((g) => g.dispose());
            material.dispose();
        },
    };
}
