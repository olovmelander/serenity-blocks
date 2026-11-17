/**
 * Sunbraid — the towers: pale bedded sandstone standing out of the valley floor, one instanced
 * mesh per shape (sunbraid-monoliths.js: sculpted by script in Blender), all sharing one material.
 *
 * The stones are jointed monoliths: polygonal prisms of flat faces and crisp arrises, split by
 * vertical joints into columns that break off at different heights, stepped in by hard and soft
 * beds, with angular talus at their feet. Under one white light they would be pale stone with
 * faint mineral tints in their beds (cream, ochre, rose, lilac); under three coloured suns every
 * flat face is one clean colour (the suns it faces) and every arris is where two colours meet.
 * Pale dust lies on the flat tops and wears the exposed edges light; the joints and the inner
 * corners of the setbacks are dark. Every tower shadows every other (its own shadow cylinders
 * are left out for its own stone: a face set back inside its tier's cylinder would stand in its
 * own shade).
 *
 * A level-up wakes them: a band of light climbs every tower from its foot, the nearer towers
 * first, in the suns' three colours, and flares at the crown.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cos, dot, exp, float, floor, fract, fwidth, length, max, mix, normalize, normalWorld,
    positionGeometry, positionWorld, smoothstep, step, texture, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { SPIRE_LAYOUT, casterRanges, spireFoot } from './sunbraid-plan.js';
import { MONOLITH_VARIANTS, monolithMesh } from './sunbraid-monoliths.js';
import { drainSteps } from '../shared/build-steps.js';
import { centroidVarying } from '../shared/centroid-varying.js';
import { flatVarying } from '../shared/flat-varying.js';
import {
    SUNS, TAU, haze, landSuns, mist, sbHash21, sunLight, sunVisibility,
} from './sunbraid-tsl.js';

/**
 * The stone's layers (metres): formations (each its own pale sandstone) and the thin beds within
 * them; `rim` the gain of the light grazing round a silhouette seen against the suns; `sky` the
 * dome's fill on a face turned from every sun; `bounce` the glare thrown up off the white floor
 * (it is what shows the stone's own warm colour on a tower seen against the suns).
 */
export const TOWER_BEDS = Object.freeze({
    formation: 34, contrast: 0.8, bed: 3.2, rim: 1.1, sky: 0.4, bounce: 0.5,
});

/**
 * The stone's wear, read from the sculpt's own bake: how much paler an exposed arris is (`crest`),
 * how much darker a joint or crevice (`crevice`), how deep the baked occlusion shades the suns'
 * light (`cavity`: its share at full occlusion; the bake is deep, a quarter of the vertices stand
 * in a joint: a face counts as open from `open` of it; a joint's own wall is nearly dark, or its
 * sliver of a face, lit square to a sun, drew a dotted line down the tower), the dust on a flat
 * top, the stone's own grain (the share of its colour that varies: the floor is grainy, and a
 * tower of flat untextured planes beside it was plastic), and the light an exposed arris catches
 * from a sun beyond it (a tower seen against the suns is edged in their light).
 */
export const TOWER_WEAR = Object.freeze({
    crest: 0.14, crevice: 0.3, cavity: 0.24, open: 0.6, dust: 0.3, lean: 0.35, grain: 0.09, arris: 0.1,
});

/**
 * A level-up's light on the towers: it reaches a tower `reach` metres a second out from the eye,
 * climbs it in `climb` seconds, in a band `band` of its height thick with a `tail` of glow under
 * it, and flares on the crown as it arrives; `turns` how many times the three colours change up a
 * tower (under one: a band is one sun's colour shading into the next, never a rainbow); `gain`
 * its light.
 */
export const TOWER_WAKE = Object.freeze({
    reach: 1700, climb: 1.9, band: 0.034, tail: 0.2, turns: 0.8, gain: 1.45, crown: 1.3,
});

function createSpireMaterial(u, t, level = 'hi') {
    const material = new THREE.MeshBasicNodeMaterial();
    // Per tower: its seed, and the rows of the shadow table that are its own cylinders.
    const tower = attribute('aTower', 'vec3');
    const seedOf = flatVarying(tower.x, 'vSpireSeed');
    const ownRows = flatVarying(tower.yz, 'vSpireRows');
    // How far up the tower a point stands (0 the foot .. 1 the top).
    const heightOf = varying(positionGeometry.y, 'vSpireUp');
    material.colorNode = Fn(() => {
        const P = positionWorld;
        // (Taken inside the triangle: under MSAA a silhouette pixel's centre can lie past a sliver
        // of the rim, and an extrapolated normal lit it in a speck of one sun's colour.)
        const N = normalize(centroidVarying(normalWorld, 'vSpireNormal')).toVar();
        const shade = attribute('aShade', 'vec2');
        // (The sculpt's occlusion is deep: only its lower part shades, a face in the open is open.)
        const ao = smoothstep(0.0, TOWER_WEAR.open, shade.x).toVar();
        const crest = shade.y.toVar();
        const seed = seedOf.toVar();
        const up = heightOf.toVar();
        // The stone comes in formations (units tens of metres thick, each its own pale sandstone:
        // cream, ochre, rose, a little lilac) with thin beds inside them. Each formation's colour
        // shades into the next over a few metres; the beds are fine lines. Both fade to their mean
        // where they would be finer than a few pixels (a random colour a bed, 3 m thick, aliased into
        // rainbow scan lines at a kilometre).
        const B = TOWER_BEDS;
        const sag = texture(t.noise, P.xz.div(900.0)).r.mul(3.0);
        const unitCoord = P.y.div(B.formation).add(sag.mul(0.25)).add(seed.mul(7.0)).toVar();
        const unit = floor(unitCoord);
        const into = fract(unitCoord);
        const pickOf = (k) => sbHash21(vec2(k, floor(seed.mul(97.0))));
        const cream = vec3(0.95, 0.9, 0.8);
        const ochre = vec3(0.93, 0.76, 0.56);
        const rose = vec3(0.94, 0.74, 0.7);
        const lilac = vec3(0.84, 0.82, 0.92);
        const stoneOf = (pick) => {
            const warm = mix(cream, ochre, smoothstep(0.25, 0.45, pick));
            const cool = mix(rose, lilac, smoothstep(0.75, 0.9, pick));
            return mix(warm, cool, smoothstep(0.5, 0.62, pick));
        };
        const meanStone = vec3(0.915, 0.82, 0.74);
        // (Toward the mean a little: at full strength a butte read as a layer cake.)
        const between = mix(stoneOf(pickOf(unit)), stoneOf(pickOf(unit.add(1.0))), smoothstep(0.86, 1.0, into));
        const unitTint = mix(meanStone, between, B.contrast);
        const unitSeen = float(1.0).sub(smoothstep(0.08, 0.25, fwidth(unitCoord)));
        const tint = mix(meanStone, unitTint, unitSeen);
        const bedCoord = P.y.div(B.bed).add(sag).add(seed.mul(13.0));
        const bedRoom = float(1.0).sub(smoothstep(0.12, 0.35, fwidth(bedCoord)));
        const bedLine = smoothstep(0.9, 1.0, fract(bedCoord)).mul(0.05).mul(bedRoom);
        // Streaks run down the cliffs from the ledges. (Read blurred and faint: on a flat face the
        // fine octaves were a stucco, and a face is one colour here.)
        const streak = texture(t.noise, vec2(P.x.add(P.z).div(26.0), P.y.div(420.0))).bias(1.0).b;
        // The stone's grain: blocks a few metres across and a finer mottle, in its colour only
        // (the planes stay planes: no bump), gone where it would be finer than a pixel or two.
        const grainAt = vec2(P.x.sub(P.z).div(34.0), P.y.div(21.0)).toVar();
        const grainRoom = float(1.0).sub(smoothstep(0.02, 0.07, fwidth(grainAt.y)));
        const mottle = texture(t.noise, grainAt).g.sub(0.5).add(texture(t.noise, grainAt.mul(3.7)).b.sub(0.5).mul(0.6));
        const weathering = float(0.95).sub(smoothstep(0.55, 0.8, streak).mul(0.1))
            .add(mottle.mul(TOWER_WEAR.grain * 2).mul(grainRoom));
        // The sculpt's own wear: exposed arrises worn pale, joints and crevices dark and a little warm.
        // (The lean level has no row of vertices beside its arrises: its crest spreads a whole
        // triangle into the faces, so it wears the stone at a third.)
        const W = TOWER_WEAR;
        const wear = level === 'lo' ? W.lean : 1;
        const worn = smoothstep(0.55, 0.95, crest).mul(W.crest * wear);
        const sunk = smoothstep(0.45, 0.1, crest).mul(W.crevice * wear);
        const stone = tint.mul(weathering.sub(bedLine)).mul(float(1.0).add(worn).sub(sunk))
            .mul(mix(vec3(1.0), vec3(1.04, 0.97, 0.9), sunk));
        // Pale dust on the flat tops and ledges.
        const flat = smoothstep(0.9, 0.98, N.y);
        const albedo = mix(stone, vec3(0.9, 0.9, 0.86), flat.mul(W.dust)).toVar();
        const vis = sunVisibility(u, P, t.noise, ownRows).toVar();
        // The suns' light here: in colour, or the one white sun's ahead of the colour's front.
        const suns = landSuns(u, P);
        const cavity = ao.mul(1 - W.cavity).add(W.cavity);
        const lit = sunLight(u, N, vis, 0.1, suns).mul(cavity);
        // (Little sky fill: a face turned from every sun stays dark, so the rims and the lit faces
        // read against it.)
        const sky = mix(u.horizon, u.zenith, N.y.mul(0.5).add(0.5)).mul(N.y.mul(0.35).add(0.65)).mul(B.sky)
            .mul(ao);
        // Light thrown up off the white valley floor onto the cliffs, strongest low down.
        const lowness = smoothstep(260.0, 0.0, P.y.sub(u.groundY));
        const bounce = u.groundLit.mul(B.bounce).mul(float(0.5).sub(N.y.mul(0.5))).mul(ao)
            .mul(lowness.mul(0.6).add(0.4));
        // Looking toward the suns, light grazes round the silhouettes (dust on the stone).
        const V = normalize(P.sub(u.eye)).toVar();
        const edge = float(1.0).sub(max(dot(N, V.negate()), 0.0));
        // (Each sun's rim lies on the side of the silhouette it stands on: a face turned toward it
        // takes it, so a backlit tower is edged in three colours.)
        // (Upright faces only: a ledge's top seen edge-on is grazed too, and drew a bright dash
        // along every ledge.)
        const edge3 = edge.mul(edge).mul(edge).mul(float(1.0).sub(smoothstep(0.35, 0.8, N.y.abs()))).toVar();
        const sheenOf = (S) => {
            const m = max(dot(V, S), 0.0);
            const m2 = m.mul(m);
            const m4 = m2.mul(m2);
            const side = smoothstep(-0.4, 0.3, dot(N, S));
            return m4.mul(m2).mul(edge3).mul(side);
        };
        // An exposed arris catches the light of a sun beyond it (near towers only: farther off
        // an arris is a pixel wide and would crawl).
        const arris = smoothstep(0.72, 0.98, crest).mul(wear * W.arris)
            .mul(smoothstep(3200.0, 1400.0, length(P.sub(u.eye))));
        const beyondOf = (S) => {
            const m = max(dot(V, S), 0.0);
            const m2 = m.mul(m);
            const m4 = m2.mul(m2);
            // (A tight lobe: only a tower that stands against the suns is edged; a wide one drew a
            // white outline round every tower in the valley.)
            return m4.mul(m4).mul(arris);
        };
        const sheen = suns.c0.mul(sheenOf(u.sun0).mul(B.rim).add(beyondOf(u.sun0)).mul(vis.x))
            .add(suns.c1.mul(sheenOf(u.sun1).mul(B.rim).add(beyondOf(u.sun1)).mul(vis.y)))
            .add(suns.c2.mul(sheenOf(u.sun2).mul(B.rim).add(beyondOf(u.sun2)).mul(vis.z)));
        // A level-up's light: a band climbing the tower from its foot (the nearer towers first),
        // the suns' three colours turning up it, a glow trailing under it, a flare on the crown.
        const K = TOWER_WAKE;
        const since = u.wake.sub(length(P.xz.sub(u.eye.xz)).div(K.reach)).toVar();
        const front = since.div(K.climb).toVar();
        const off = up.sub(front).toVar();
        const band = exp(off.mul(off).div(-K.band * K.band))
            .add(smoothstep(-K.tail, 0.0, off).mul(step(off, 0.0)).mul(0.28));
        const arrived = front.sub(1.08);
        const crown = exp(float(1.0).sub(up).max(0.0).div(-0.07)).mul(exp(arrived.mul(arrived).div(-0.045)))
            .mul(K.crown);
        const lives = step(0.0, since).mul(float(1.0).sub(smoothstep(1.0, 1.25, front)));
        const turn = up.mul(K.turns).add(seed).mul(TAU);
        const wakeHue = vec3(...SUNS[0].rgb).mul(cos(turn).mul(0.5).add(0.5))
            .add(vec3(...SUNS[1].rgb).mul(cos(turn.sub(TAU / 3)).mul(0.5).add(0.5)))
            .add(vec3(...SUNS[2].rgb).mul(cos(turn.sub((2 * TAU) / 3)).mul(0.5).add(0.5)));
        const wake = wakeHue.mul(band.mul(lives).add(crown.mul(step(0.0, since)))).mul(crest.mul(0.8).add(0.6))
            .mul(K.gain);
        // (At dusk a tower is a dark shape against the afterglow: it takes little of it.)
        const colour = albedo.mul(lit.add(sky).add(bounce).add(u.afterglow.mul(0.45))).add(sheen).add(wake);
        return vec4(haze(u, mist(u, colour, P, vis), P), 1.0);
    })();
    material.fog = false;
    return material;
}

export function createSpires(u, t, tier, casters = null) {
    return drainSteps(createSpiresSteps(u, t, tier, casters));
}

/**
 * `createSpires` as steps (the world's build breathes between them): the material, then each
 * shape's mesh (decoded once a page) and its instances. `casters` is the land plan's shadow list
 * (sunbraid-plan.js spireCasters): each tower is told which rows of it are its own.
 */
export function* createSpiresSteps(u, t, tier, casters = null) {
    const material = createSpireMaterial(u, t, tier.monolith);
    const meshes = [];
    const geometries = [];
    const foot = [0, 0, 0];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    const ranges = casterRanges(casters);
    for (let v = 0; v < MONOLITH_VARIANTS; v++) {
        const members = SPIRE_LAYOUT.map((spire, index) => ({ spire, index }))
            .filter(({ spire }) => spire.variant === v);
        if (!members.length) continue;
        const shape = monolithMesh(v, tier.monolith);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(shape.position, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(shape.normal, 3));
        geometry.setAttribute('aShade', new THREE.BufferAttribute(shape.shade, 2));
        geometry.setIndex(new THREE.BufferAttribute(shape.index, 1));
        const towers = new Float32Array(members.length * 3);
        const mesh = new THREE.InstancedMesh(geometry, material, members.length);
        members.forEach(({ spire, index }, k) => {
            spireFoot(spire, foot);
            q.setFromAxisAngle(Y, spire.twist);
            s.setScalar(spire.h);
            p.set(foot[0], foot[1], foot[2]);
            m.compose(p, q, s);
            mesh.setMatrixAt(k, m);
            const own = ranges[index] || { first: -1, count: 0 };
            towers[k * 3] = (index * 0.6180339) % 1;
            towers[k * 3 + 1] = own.first;
            towers[k * 3 + 2] = own.count;
        });
        geometry.setAttribute('aTower', new THREE.InstancedBufferAttribute(towers, 3));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.name = `Sunbraid towers ${v}`;
        mesh.frustumCulled = false;
        mesh.renderOrder = 5;
        meshes.push(mesh);
        geometries.push(geometry);
        yield `towers ${v}`;
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
