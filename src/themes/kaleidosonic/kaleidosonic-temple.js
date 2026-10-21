/**
 * Kaleidosonic — the temple: ONE full-screen material that marches every view ray through the
 * Apollonian field and shades what it meets.
 *
 * The lens first folds the ray through the kaleidoscope's mirrors (a chain opens them), then the
 * march walks the field in the temple's own coordinates (the dive offsets them, so the stone
 * flows past the eye while the core and every strike stay put). What it shades:
 *
 *   jewels    Indra's net: the core's image hangs in the same place in every cell of the
 *             lattice, so the halls recede through glowing jewels, each lighting its own hall and
 *             twinkling on its own phase; a short walk through the cells the ray crosses draws
 *             them (hidden behind stone)
 *   pearl     dark jewel-toned stone, two poles chosen by the orbit trap, lit by the nearest
 *             jewel and by the core (point lights with a wide wrap, shadowed by the light map and
 *             brighter where a beam lands), filled faintly by the air, occluded by the march's
 *             own step count and one tap along the normal
 *   nacre     the pearl's gloss: a soft lustre toward each light, the core and the nearest
 *             jewels mirrored in it, all tinted by a thin film whose thickness changes pearl by
 *             pearl (an oil-slick of the mood's light)
 *   veins     the nodal shells of the nearest source's standing wave cut by the stone: rings
 *             round every jewel and round the core, flowing outward with the breath, broken
 *             into petals by a 3D quasicrystal field (six plane waves on the icosahedron's axes)
 *   mandala   on the floors, the core's own Faraday pattern: twelve-fold, centred under it
 *   strikes   each lock's wavefront: a band of the piece's light where the shell crosses the
 *             stone, ripples at the note's wavelength behind it, a faint shell in the air
 *   harmonic  each clear's spherical standing wave about the core: nodal shells cut the stone in
 *             concentric lines, as many as the clear's lines ask
 *   core      the hero: a white-hot heart, a twelve-petal corona that turns with the pulse, and
 *             sound rings running out of it
 *   beams     the gem's twelve facets each throw a narrow beam, and the gem turns: the core and
 *             every jewel (its image) light the air in shafts, integrated along the ray in closed
 *             form and cut by the light map where pillars stand in them; a dim even glow round
 *             each light; a strike's flash in the mist
 *   air       fog toward the mood's haze
 *
 * Every pixel is opaque (alpha 1); the post tone-maps once.
 *
 * The light map (kaleidosonic-light.js): how far the light reaches in every direction from the
 * jewels' place in the lattice (one map serves the core and every jewel), marched again only
 * when the temple's shape or the core's place changes.
 *
 * The scout: before the frame, a small pass marches one ray per SCOUT_TILE × SCOUT_TILE block of
 * pixels, only for as long as a cone wide enough to hold every ray of the block stays clear of
 * stone (cone marching). Up to where it stops every ray of the block is in open air, so each
 * pixel's march starts there with the scout's step count (the stone's occlusion reads the march's
 * steps): the same picture, about a third of the steps.
 */
import * as THREE from 'three/webgpu';
import {
    Break, Fn, If, Loop, abs, atan, clamp, cos, dot, exp, float, floor, fwidth, int, length, max, min, mix,
    normalize, positionGeometry, select, sign, sin, smoothstep, sqrt, tan, texture, varying, vec2, vec3, vec4,
} from 'three/tsl';
import {
    BEAM_AXES, HARMONIC_ROWS, MOOD_COLOURS, STRIKE_ROWS, TAU, TEMPLE, createTempleField, createTempleTrap, ksHash31,
    ksLensFold, moodColour,
} from './kaleidosonic-tsl.js';
import {
    createLightMap, ksBeamLobe, ksBeams, ksGemFrame, lightVis,
} from './kaleidosonic-light.js';
/** A source's standing wave: radians per unit of distance (nodal shells every π / RING_K). */
const RING_K = 26;
/**
 * The veins' glow away from every light (they glow mostly where a light, a beam or an event
 * excites them, as under black light).
 */
const VEIN_REST = 0.17;
/** The floor mandala's wavenumber and its reach (1/e radius, units). */
const MANDALA_K = 22;
const MANDALA_REACH = 0.6;
/** The march's far limit: the fog has taken everything by then. */
const FAR = 10;
const P = TEMPLE.period;
/** Cells of the lattice a ray's jewel walk visits. */
const JEWEL_CELLS = 10;
/**
 * A cell's jewel hangs at its centre, within half the cell's diagonal of any point of it: once the
 * walk enters a cell this far beyond the stone, that jewel and every later one are hidden.
 */
const JEWEL_HIDDEN = (P * Math.sqrt(3)) / 2 + 0.01;
/** Pixels a side of the block one scout ray stands for. */
export const SCOUT_TILE = 4;
/**
 * The scout's cone, in pixel footprints: the block's farthest pixel centre from its own, the
 * march's hit threshold (1.1) and one footprint of margin. (The kaleidoscope's folds never move
 * two rays further apart, so the block's rays stay inside it after the lens.)
 */
const SCOUT_CONE = ((SCOUT_TILE - 1) / 2) * Math.SQRT2 + 1.1 + 1.0;
/**
 * The light in the air: each light's in-scatter along a view ray, 1 / (r² + r0²) per unit of
 * path (r0 softens the peak at the light) times exp(−(r / reach)²) (the air is dark: the light
 * pools round its source and is gone beyond it; a slower tail, exp(−r / reach), lifted every dark
 * pixel of the frame a little, and after sRGB a little is a veil), times the air's density. The
 * core's and a jewel's strengths are their surface falloffs' numerators (1.3 / 9 and 2.2 / 3)
 * times these.
 */
/**
 * The air in front of the lens is clear for this far (units), as the fog's first half unit is: a
 * beam that points at the eye would otherwise light every ray's first stretch of air, a veil over
 * the whole frame each time the turning gem swept one past the lens.
 */
const AIR_CLEAR = 0.45;
const AIR = Object.freeze({
    coreR02: 0.01,
    jewelR02: 0.02,
    coreReach: 1.25,
    jewelReach: 0.55,
    core: 0.06,
    jewel: 0.0048,
});
/**
 * The gem's beams (kaleidosonic-light.js): how much of a light leaves in every direction (base)
 * and how much more along a facet's beam (gain), on the stone and in the air. The air takes the
 * beams far more than the stone: dark air crossed by shafts, stone lit all round.
 */
const BEAM = Object.freeze({
    stoneBase: 0.6,
    stoneGain: 1.5,
    airBase: 0.028,
    airGain: 5.0,
});

/**
 * A strike's light in the mist: its softening (r0², units²), how far round the struck point it
 * pools (units, across the ray), how fast it fades (per second), a hard drop's extra, its gain and
 * how hard several at once are capped.
 */
const STRIKE_AIR = Object.freeze({
    r02: 0.004,
    reach: 0.22,
    decay: 3.2,
    hard: 0.3,
    gain: 0.014,
    cap: 1.4,
});

/**
 * The stone's gloss (nacre): its reflectance face on (f0), the soft lustre highlight's gain (a
 * broad Blinn lobe toward each light), its roughness (ρ², radians²), the core's and a jewel's highlight
 * peaks, the core's broad sheen (width ρ² and gain), a jewel glow's size (units), the thin film's
 * share of the tint and its glow at the turning edges. (The tier sets how many cells the reflected
 * ray's walk visits for the jewels it mirrors.)
 */
const GLOSS = Object.freeze({
    f0: 0.04,
    lustre: 1.6,
    rough2: 0.004,
    core: 3.0,
    sheen: 0.1,
    sheenW: 0.06,
    jewel: 2.4,
    jewelSize: 0.03,
    film: 0.6,
    edge: 0.06,
});

/** A view ray through a point of the frame (NDC), folded through the kaleidoscope: { lensed, rd }. */
function viewRay(u, ndc) {
    const vh = u.projInv.mul(vec4(ndc, 1.0, 1.0));
    const lensed = ksLensFold(normalize(vh.xyz.div(vh.w)), u.lens, u.lensS).toVar();
    const rd = normalize(u.camWorld.mul(vec4(lensed.xyz, 0.0)).xyz).toVar();
    return { lensed, rd };
}

/** The frame's pixel coordinates (top-left origin, buffer pixels) of a full-screen quad's NDC. */
const framePixel = (ndc, size) => vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5))).mul(size);

/**
 * The scout pass (see the header): a target of one texel per block holding where the block's
 * march may start, as a 1/64 grid value and its remainder (each exact in a half float, so the
 * start is not rounded: a start pulled back by rounding would take a step more and darken the
 * occlusion), and the steps the scout took to get there. A distance beyond FAR: the whole block
 * runs out into the fog. A target that holds zeros (not drawn yet) starts every march at the eye.
 */
function createScout(u, field, steps) {
    const target = new THREE.RenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        generateMipmaps: false,
    });
    target.texture.name = 'Kaleidosonic — scout';
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    material.name = 'Kaleidosonic — scout';
    material.fog = false;
    const vNdc = varying(positionGeometry.xy);
    material.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0);
    material.fragmentNode = Fn(() => {
        // the block this texel stands for, and the ray through its centre
        const block = floor(framePixel(vNdc, u.scout.zw));
        const centre = block.add(0.5).mul(SCOUT_TILE).div(u.scout.xy);
        const { rd } = viewRay(u, vec2(centre.x.mul(2.0).sub(1.0), float(1.0).sub(centre.y.mul(2.0))));
        const roT = u.camWorld.mul(vec4(0.0, 0.0, 0.0, 1.0)).xyz.add(u.dive).toVar();
        const t = float(0.02).toVar();
        const used = float(0).toVar();
        const tSafe = float(0.02).toVar();
        const nSafe = float(0).toVar();
        Loop(steps, () => {
            const h = field(roT.add(rd.mul(t)), u.shape).toVar();
            If(h.lessThan(t.mul(u.pixelAngle).mul(SCOUT_CONE).add(1e-5)), () => {
                Break();
            });
            // the whole block is in open air here
            tSafe.assign(t);
            nSafe.assign(used);
            t.addAssign(h.mul(0.9));
            used.addAssign(1);
            If(t.greaterThan(FAR), () => {
                tSafe.assign(t);
                nSafe.assign(used);
                Break();
            });
        });
        const hi = floor(tSafe.mul(64.0)).div(64.0);
        return vec4(hi, tSafe.sub(hi), nSafe, 1.0);
    })();
    const quad = new THREE.QuadMesh(material);
    quad.name = 'KaleidosonicScout';
    return {
        target,
        material,
        quad,
        setSize(width, height) {
            target.setSize(Math.max(1, Math.ceil(width / SCOUT_TILE)), Math.max(1, Math.ceil(height / SCOUT_TILE)));
        },
        render(renderer) {
            const previous = renderer.getRenderTarget();
            renderer.setRenderTarget(target);
            quad.render(renderer);
            renderer.setRenderTarget(previous);
        },
        // (QuadMesh's geometry is three's own, shared by every QuadMesh: never disposed here)
        dispose() {
            target.dispose();
            material.dispose();
        },
    };
}

/**
 * @param {object} u uniforms from createUniforms()
 * @param {object} tier the quality tier (kaleidosonic-quality.js)
 * @param {object} [options]
 * @param {boolean} [options.scout=true] march from the scout pass's start (render() it before each frame)
 */
export function createTemple(u, tier, { scout: useScout = true } = {}) {
    const field = createTempleField(tier.folds);
    const trapField = createTempleTrap(tier.folds);
    const steps = Math.max(16, Math.round(tier.steps));
    const scout = useScout ? createScout(u, field, steps) : null;
    const jewelCells = Math.max(3, Math.round(tier.jewelCells ?? JEWEL_CELLS));
    const veinTier = Math.max(0.2, Math.min(1, tier.veins ?? 1));
    const lightMap = createLightMap(u, field, tier);
    const map = lightMap.target.texture;
    const airBeamCells = Math.max(0, Math.round(tier.airBeamCells ?? 5));
    const airCells = Math.min(airBeamCells, Math.max(0, Math.round(tier.airCells ?? 3)));
    const glossCells = Math.max(0, Math.round(tier.glossCells ?? 2));
    const beamAxes = Math.max(1, Math.min(BEAM_AXES.length, Math.round(tier.beamAxes ?? BEAM_AXES.length)));
    const stoneBeams = tier.stoneBeams !== false;

    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    material.name = 'Kaleidosonic — temple';
    material.fog = false;
    const vNdc = varying(positionGeometry.xy);
    material.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0);

    const at = (p) => field(p.add(u.dive), u.shape);

    material.fragmentNode = Fn(() => {
        const mk = u.moodMix;
        const stoneA = moodColour(u, 'stoneA', mk).toVar();
        const stoneB = moodColour(u, 'stoneB', mk).toVar();
        // the moods' three neon colours, mood A and mood B (the shader stages the change by region)
        const row = (key, second) => {
            const index = MOOD_COLOURS.indexOf(key) + (second ? MOOD_COLOURS.length : 0);
            return u.moods.element(int(index)).xyz;
        };
        const neonA1 = row('neonA', false).toVar();
        const neonB1 = row('neonB', false).toVar();
        const neonC1 = row('neonC', false).toVar();
        const neonA2 = row('neonA', true).toVar();
        const neonB2 = row('neonB', true).toVar();
        const neonC2 = row('neonC', true).toVar();
        const heartCol = moodColour(u, 'heart', mk).toVar();
        const haze = moodColour(u, 'haze', mk).toVar();
        const glowCol = moodColour(u, 'glow', mk).toVar();
        const trance = u.state.x.toVar();
        const resonance = u.state.y.toVar();
        const mandala = u.state.z.toVar();
        const sink = u.heartState.z.toVar();
        const lightK = u.heartState.x.mul(float(1).sub(sink.mul(0.6))).toVar();
        // the core itself also takes the events' flare (the stone does not: a lock must not pulse the frame)
        const coreK = u.heartState.x.add(u.heartState.w.mul(1.6)).mul(float(1).sub(sink.mul(0.6))).toVar();
        const { breath } = u;
        // the gem's turn (its facets throw the beams)
        const gemRot = u.gem.xy.toVar();

        // ── the ray, folded through the kaleidoscope ──
        const { lensed, rd } = viewRay(u, vNdc);
        // the kaleidoscope's alternate sectors light their jewels in the mood's other colour
        const other = lensed.w;
        const neonNow = mix(neonA1, neonA2, mk);
        const jewelCol = mix(heartCol, neonNow.mul(1.6), other.mul(0.85)).toVar();
        const ro = u.camWorld.mul(vec4(0.0, 0.0, 0.0, 1.0)).xyz.toVar();

        // ── the march (in the temple's own coordinates: the dive's offset added once), from where
        // the scout found the block still in open air ──
        const roT = ro.add(u.dive).toVar();
        const t = float(0.02).toVar();
        const hit = float(0).toVar();
        const used = float(0).toVar();
        let first = int(0);
        if (scout) {
            const block = floor(framePixel(vNdc, u.scout.xy).div(SCOUT_TILE));
            const start = texture(scout.target.texture, block.add(0.5).div(u.scout.zw)).level(0).toVar();
            t.assign(max(start.x.add(start.y), 0.02));
            used.assign(start.z);
            // a block that runs out into the fog marches no further
            first = int(select(t.greaterThan(FAR), float(steps), used));
        }
        Loop({
            start: first, end: int(steps), type: 'int', condition: '<', name: 'mk',
        }, () => {
            const h = field(roT.add(rd.mul(t)), u.shape).toVar();
            If(h.lessThan(t.mul(u.pixelAngle).mul(1.1).add(1e-5)), () => {
                hit.assign(1);
                Break();
            });
            t.addAssign(h.mul(0.9));
            used.addAssign(1);
            If(t.greaterThan(FAR), () => {
                Break();
            });
        });
        const tEnd = mix(float(FAR), t, hit).toVar();

        // The core (camera-fixed) and the jewels (fixed in the temple: the core's place at rest,
        // repeated in every cell; in the eye's frame they flow with the dive).
        const heartPos = u.heart.xyz.toVar();
        const jewelBase = heartPos.sub(u.dive).toVar();
        const col = vec3(0).toVar();
        const fogK = u.air.x;
        // far air is lit by the countless jewels beyond sight: a faint glow in the haze
        const airGlow = haze.mul(1.3).add(glowCol.mul(0.02)).mul(float(1).sub(sink.mul(0.55))).toVar();
        If(hit.greaterThan(0.5), () => {
            const p = ro.add(rd.mul(t)).toVar();
            const e = max(t.mul(u.pixelAngle).mul(0.6), 2e-5);
            const k = vec2(1, -1);
            const n = normalize(
                k.xyy.mul(at(p.add(k.xyy.mul(e))))
                    .add(k.yyx.mul(at(p.add(k.yyx.mul(e)))))
                    .add(k.yxy.mul(at(p.add(k.yxy.mul(e)))))
                    .add(k.xxx.mul(at(p.add(k.xxx.mul(e))))),
            ).toVar();
            const occ = float(1).sub(used.div(steps)).toVar();
            const tap = at(p.add(n.mul(0.04)));
            const ao = clamp(tap.div(0.04), 0.0, 1.0).mul(occ).mul(occ).toVar();
            // the orbit trap at the hit: (|x|, |z|, r²)
            const trap = trapField(p.add(u.dive), u.shape).toVar();

            // pearl: two poles by the trap's bands (wide ramps, never stripes)
            const band = trap.z.mul(0.7).add(trap.x.mul(1.3));
            const pole = smoothstep(0.2, 0.8, abs(band.sub(floor(band)).mul(2.0).sub(1.0)));
            const albedo = mix(stoneA, stoneB, pole).toVar();
            // the stone's neon: one of the mood's three colours per region of the orbit trap, the
            // next mood's colours arriving region by region (never a straight mix of complements)
            const bandN = trap.z.mul(0.83).add(trap.y.mul(1.71)).add(trap.x.mul(0.37)).fract();
            const m1 = smoothstep(0.28, 0.38, bandN);
            const m2 = smoothstep(0.61, 0.71, bandN);
            const neon1 = mix(mix(neonA1, neonB1, m1), neonC1, m2);
            const neon2 = mix(mix(neonA2, neonB2, m1), neonC2, m2);
            const when = trap.z.mul(0.37).add(trap.x.mul(0.61)).fract().mul(0.7);
            const neon = mix(neon1, neon2, smoothstep(when, when.add(0.3), mk)).toVar();

            // the core's light
            const toH = heartPos.sub(p).toVar();
            const dH = length(toH).toVar();
            const L = toH.div(max(dH, 1e-4)).toVar();
            const fall = float(1.3).div(dH.mul(dH).mul(9.0).add(1.0)).toVar();
            // shadows from the light map, read a hair off the stone (its own face must not shade it)
            const lifted = p.add(n.mul(t.mul(u.pixelAngle).mul(3.0).add(0.004))).toVar();
            const ready = u.light.x;
            const visC = lightVis(map, lifted.sub(heartPos), dH.mul(0.02).add(0.008)).toVar();
            // how far the core's light reaches this point (0 in shadow): its glints follow it too
            const shC = mix(float(1), visC, ready.mul(u.light.y)).toVar();
            fall.mulAssign(shC.mul(0.82).add(0.18));
            // the gem's facets throw part of its light as beams: brighter where one lands
            const beamOn = (toLight) => ksBeams(ksGemFrame(toLight.negate(), gemRot))
                .mul(BEAM.stoneGain)
                .add(BEAM.stoneBase);
            if (stoneBeams) fall.mulAssign(beamOn(L));
            const lit = clamp(dot(n, L).mul(0.75).add(0.25), 0.0, 1.0).mul(fall).toVar();
            // the nearest jewel's light (it gives way where it stands on the core itself)
            const cellJ = floor(p.sub(jewelBase).div(P).add(0.5)).toVar();
            const J = jewelBase.add(cellJ.mul(P)).toVar();
            const toJ = J.sub(p).toVar();
            const dJ = length(toJ).toVar();
            const LJ = toJ.div(max(dJ, 1e-4)).toVar();
            const away = smoothstep(0.04, 0.4, length(J.sub(heartPos)));
            const twinkle = sin(u.pulse.mul(0.7).add(ksHash31(cellJ.add(17.0)).mul(TAU))).mul(0.25).add(0.75);
            const visJ = lightVis(map, lifted.sub(J), dJ.mul(0.02).add(0.008));
            // every jewel is the core's image: its facets throw the same beams
            const beamJ = stoneBeams ? beamOn(LJ) : float(1);
            const fallJ = float(2.2).div(dJ.mul(dJ).mul(3.0).add(1.0)).mul(away).mul(twinkle)
                .mul(mix(float(1), visJ.mul(0.82).add(0.18), ready))
                .mul(beamJ)
                .toVar();
            const litJ = clamp(dot(n, LJ).mul(0.75).add(0.25), 0.0, 1.0).mul(fallJ);

            const f1 = clamp(float(1).add(dot(n, rd)), 0.0, 1.0);
            const rim = f1.mul(f1).mul(f1);
            const sky = haze.mul(n.y.mul(0.35).add(0.65));
            col.assign(albedo.mul(heartCol.mul(lit.add(litJ).mul(lightK)).add(sky.mul(0.8))).mul(ao));
            // lustre: the pearl's soft broad highlight toward the core and the nearest jewel, in the
            // film's colours (below)
            const hv = normalize(L.sub(rd));
            const g = clamp(dot(n, hv), 0.0, 1.0);
            const g2 = g.mul(g);
            const g8 = g2.mul(g2).mul(g2).mul(g2);
            const hvJ = normalize(LJ.sub(rd));
            const gJ = clamp(dot(n, hvJ), 0.0, 1.0);
            const gJ2 = gJ.mul(gJ);
            const gJ8 = gJ2.mul(gJ2).mul(gJ2).mul(gJ2);
            const lustre = heartCol.mul(g8.mul(g8).mul(g8).mul(fall))
                .add(jewelCol.mul(gJ8.mul(gJ8).mul(gJ8).mul(fallJ)))
                .mul(GLOSS.lustre)
                .toVar();
            // fluorescence: as under black light, the pearl's turning edges glow in their own neon
            col.addAssign(neon.mul(rim.mul(0.3).mul(fall.add(fallJ).mul(0.8).add(0.3))).mul(ao.mul(0.6).add(0.4)));

            // ── nacre: the stone's gloss mirrors the core and the nearest jewels, tinted by a
            // thin film whose thickness changes pearl by pearl (the orbit trap) and drifts with
            // the breath: each pearl an oil-slick of the mood's light (Indra's net: every jewel
            // seen in every pearl) ──
            const cosV = clamp(dot(n, rd.negate()), 0.0, 1.0).toVar();
            const grazing = float(1).sub(cosV);
            const grazing2 = grazing.mul(grazing);
            const fres = grazing2.mul(grazing2).mul(grazing).mul(1.0 - GLOSS.f0).add(GLOSS.f0)
                .toVar();
            const refl = rd.sub(n.mul(dot(rd, n).mul(2.0))).toVar();
            // the film's path: thickness × the cosine inside it (index 1.3), in waves
            const cosT = sqrt(max(float(1).sub(float(1).sub(cosV.mul(cosV)).div(1.69)), 0.0));
            const thick = trap.z.mul(2.3).add(trap.x.mul(1.7)).fract().mul(1.4)
                .add(0.8);
            const filmPhase = thick.mul(cosT).mul(TAU * 1.5).add(breath.mul(0.3)).toVar();
            const film = cos(vec3(filmPhase, filmPhase.add(2.094), filmPhase.add(4.189))).mul(0.5).add(0.5);
            const tint = mix(vec3(1.0), film.mul(1.7), GLOSS.film).toVar();
            // the core: a highlight the size of its glow, spread by the gloss's roughness (the
            // peak falls as the spread grows), where its light reaches the stone
            const aC = u.heart.w.mul(3.5).div(max(dH, 0.02));
            const aC2 = aC.mul(aC);
            const wC = aC2.add(GLOSS.rough2).toVar();
            const angC = float(1).sub(dot(refl, L)).mul(2.0);
            const specC = exp(angC.div(wC).negate()).mul(aC2.div(wC)).mul(GLOSS.core)
                .add(exp(angC.div(GLOSS.sheenW).negate()).mul(GLOSS.sheen))
                .mul(shC)
                .mul(coreK);
            const gloss = heartCol.mul(specC).toVar();
            // the jewels: the first cells the reflected ray crosses (a short walk), each jewel a
            // point of its colour
            const g0r = p.sub(jewelBase).div(P).add(0.5).toVar();
            const cellR = floor(g0r).toVar();
            const stepR = sign(refl).toVar();
            const tDR = vec3(P).div(max(abs(refl), vec3(1e-4))).toVar();
            const tMR = cellR.add(max(stepR, vec3(0.0))).sub(g0r).mul(stepR).mul(tDR)
                .toVar();
            if (glossCells > 0) {
                Loop(glossCells, () => {
                    const Jr = jewelBase.add(cellR.mul(P)).toVar();
                    const oj = Jr.sub(p).toVar();
                    const tj = dot(oj, refl).toVar();
                    const dJr = max(length(oj), 0.02).toVar();
                    const onJr = smoothstep(0.02, 0.12, length(Jr.sub(heartPos)));
                    If(tj.greaterThan(0.0).and(onJr.greaterThan(0.001)), () => {
                        const angJ = max(dot(oj, oj).sub(tj.mul(tj)), 0.0).div(dJr.mul(dJr));
                        const aJ = float(GLOSS.jewelSize).div(dJr);
                        const aJ2 = aJ.mul(aJ);
                        const wJ = aJ2.add(GLOSS.rough2);
                        const twR = sin(u.pulse.mul(0.7).add(ksHash31(cellR.add(17.0)).mul(TAU))).mul(0.25).add(0.75);
                        gloss.addAssign(jewelCol.mul(exp(angJ.div(wJ).negate()).mul(aJ2.div(wJ)).mul(GLOSS.jewel)
                            .mul(twR)
                            .mul(onJr)
                            .mul(exp(tj.mul(fogK).negate()))));
                    });
                    If(tMR.x.lessThan(tMR.y).and(tMR.x.lessThan(tMR.z)), () => {
                        cellR.x.addAssign(stepR.x);
                        tMR.x.addAssign(tDR.x);
                    }).ElseIf(tMR.y.lessThan(tMR.z), () => {
                        cellR.y.addAssign(stepR.y);
                        tMR.y.addAssign(tDR.y);
                    }).Else(() => {
                        cellR.z.addAssign(stepR.z);
                        tMR.z.addAssign(tDR.z);
                    });
                });
            }
            // the film's colours at the turning edges, lit by the mood's glow (the old nacre sheen)
            gloss.addAssign(glowCol.mul(film).mul(GLOSS.edge));
            // (occluded as the old glint was: the fractal's deep crevices stay dark)
            col.addAssign(gloss.mul(fres).add(lustre).mul(tint).mul(ao)
                .mul(lightK));

            // ── veins: a mandala of standing waves round every jewel, cut by the stone ──
            // Rings: the nodal shells of the nearest source's sound, flowing outward with the
            // breath (inward as the light sinks). Petals: twelve round the source's vertical axis.
            const srcIsCore = dH.lessThan(dJ);
            const src = mix(J, heartPos, float(srcIsCore)).toVar();
            const dSrc = min(dH, dJ).toVar();
            const vs = p.sub(src);
            const petals = cos(atan(vs.z, vs.x.add(1e-7)).mul(12.0).add(breath.mul(0.5)));
            const petal = smoothstep(-0.35, 0.65, petals);
            const wr = cos(dSrc.mul(RING_K).sub(breath.mul(2.0))).toVar();
            const aa = max(fwidth(wr), 0.02).toVar();
            // where the rings crowd under a pixel they fade instead of tangling
            const legible = float(1).sub(smoothstep(0.35, 1.1, aa));
            const vein = exp(abs(wr).div(aa).mul(-1.8)).mul(petal.mul(0.55).add(0.45)).mul(legible).toVar();
            const droneRings = exp(dH.mul(-2.5)).mul(u.heartState.y).mul(sin(u.pulse.mul(2.0)).mul(0.3).add(0.9));
            const veinGain = float(VEIN_REST).add(fall.mul(3.2)).add(fallJ.mul(2.0)).add(resonance.mul(1.2))
                .add(trance.mul(0.7))
                .add(droneRings.mul(2.5))
                .mul(float(1).sub(sink.mul(0.85)))
                .toVar();

            // ── on the floors and vaults: each source's Chladni figure ──
            // A circular plate's mode under the nearest jewel (or the core): nodal circles crossed
            // by twelve nodal diameters, turning slowly with the breath.
            const fy = abs(p.y.sub(floor(p.y.mul(0.5).add(0.5)).mul(2.0)));
            const onFloor = float(1).sub(smoothstep(0.004, 0.03, fy)).mul(smoothstep(0.86, 0.98, abs(n.y)));
            const fc = p.xz.sub(src.xz).toVar();
            const fr = length(fc).toVar();
            const circles = cos(fr.mul(MANDALA_K).sub(breath.mul(1.5)));
            const diameters = cos(atan(fc.y, fc.x.add(1e-7)).mul(6.0).add(breath.mul(0.15)));
            const wm = circles.mul(diameters).toVar();
            const aaM = max(fwidth(wm), 0.015);
            const mandalaLine = exp(abs(wm).div(aaM).mul(-1.4)).mul(float(1).sub(smoothstep(0.35, 1.1, aaM)))
                .mul(exp(fr.div(-MANDALA_REACH))).mul(float(1.1).add(mandala.mul(2.0)));
            vein.assign(mix(vein, mandalaLine.add(vein.mul(0.25)), onFloor));
            veinGain.assign(mix(veinGain, veinGain.add(0.1), onFloor));
            col.addAssign(neon.mul(vein).mul(veinGain).mul(ao.mul(0.55).add(0.45)).mul(veinTier));

            // ── strikes: each lock's wavefront crossing the stone (their light gathered, then
            // capped softly: many at once must not wash the frame white) ──
            const evCol = vec3(0).toVar();
            Loop({
                start: int(0), end: int(u.counts.x), type: 'int', condition: '<', name: 'sk',
            }, ({ sk }) => {
                const A = u.strikes.element(sk.mul(STRIKE_ROWS));
                const B = u.strikes.element(sk.mul(STRIKE_ROWS).add(1));
                const C = u.strikes.element(sk.mul(STRIKE_ROWS).add(2));
                const age = A.w;
                const r = age.mul(C.y);
                const dist = length(p.sub(A.xyz));
                const x = dist.sub(r);
                const width = float(0.035).add(C.z.mul(0.025));
                const front = exp(x.div(width).mul(x.div(width)).negate());
                // the note rings on where the front has passed: concentric ripples at its own
                // wavelength round the struck point, breathing outward and dying away (its cymatic
                // signature, longer than the front)
                const behind = smoothstep(0.0, 0.03, x.negate());
                const ripple = sin(dist.div(C.x).sub(age.mul(3.0)).mul(TAU)).mul(0.5).add(0.5);
                const r3 = ripple.mul(ripple).mul(ripple);
                const rings = r3.mul(exp(dist.mul(-3.0))).mul(exp(age.mul(-0.8))).mul(behind).mul(B.w);
                const fade = exp(age.mul(-1.05)).mul(B.w);
                const near = float(1).div(dist.mul(dist).mul(1.5).add(1.0));
                const light = front.mul(2.4).add(vein.mul(front).mul(3.0)).mul(fade).mul(near.mul(0.7).add(0.3))
                    .add(rings.mul(1.6));
                evCol.addAssign(B.xyz.mul(light).mul(ao.mul(0.5).add(0.5)));
                // the struck point floods the stone round it with the piece's light for an instant
                const toS = A.xyz.sub(p);
                const ds2 = max(dot(toS, toS), 1e-6);
                const Ls = toS.div(sqrt(ds2));
                const fallS = float(1).div(ds2.mul(10.0).add(0.25));
                const flood = clamp(dot(n, Ls).mul(0.75).add(0.25), 0.0, 1.0).mul(fallS).mul(exp(age.mul(-3.0)))
                    .mul(B.w);
                const takes = albedo.mul(8.0).add(rim.mul(0.5)).add(0.02);
                evCol.addAssign(B.xyz.mul(flood).mul(takes).mul(ao.mul(0.6).add(0.4)));
            });

            // ── harmonics: a clear's spherical standing wave about the core ──
            Loop({
                start: int(0), end: int(u.counts.y), type: 'int', condition: '<', name: 'hm',
            }, ({ hm }) => {
                const H0 = u.harmonics.element(hm.mul(HARMONIC_ROWS));
                const H1 = u.harmonics.element(hm.mul(HARMONIC_ROWS).add(1));
                const reach = H0.x;
                const mode = H0.z;
                const strength = H0.w;
                const inside = smoothstep(reach, reach.sub(0.35), dH);
                const phase = dH.mul(mode.mul(5.5).add(4.0)).sub(H0.y.mul(2.0));
                const node = abs(cos(phase.mul(Math.PI)));
                const shell = exp(node.div(max(fwidth(phase).mul(Math.PI), 0.03)).mul(-1.0));
                // the chord's front crosses every hall's stone, lighting its veins as it passes
                const xf = dH.sub(reach).div(0.06);
                const front = exp(xf.mul(xf).negate());
                const wave = shell.mul(inside).add(vein.mul(inside).mul(0.6)).add(front.mul(vein.mul(3.0).add(0.6)));
                evCol.addAssign(H1.xyz.mul(wave).mul(strength).mul(ao.mul(0.5).add(0.5)));
            });

            // fog thickens with distance (the first half unit is clear)
            const evPeak = max(evCol.x, max(evCol.y, evCol.z));
            col.addAssign(evCol.div(evPeak.mul(0.35).add(1.0)));
            col.assign(mix(col, airGlow, float(1).sub(exp(max(t.sub(0.5), 0.0).mul(fogK).negate()))));
        }).Else(() => {
            col.assign(airGlow);
        });

        // ── the jewels the ray passes on its way (a walk through the lattice's cells) ──
        const g0 = ro.sub(jewelBase).div(P).add(0.5).toVar();
        const cell = floor(g0).toVar();
        const stepDir = sign(rd).toVar();
        const inv = vec3(1.0).div(max(abs(rd), vec3(1e-4))).toVar();
        const tDelta = inv.mul(P).toVar();
        const firstEdge = cell.add(max(stepDir, vec3(0.0))).sub(g0).mul(stepDir).toVar();
        const tMax = firstEdge.mul(tDelta).toVar();
        const jewels = vec3(0).toVar();
        // the light in the air reaches as far as the stone (or the fog's end)
        const tAir = min(tEnd, FAR).toVar();
        const airLight = vec3(0).toVar();
        const airGain = u.light.z.mul(lightK).toVar();
        // the ray in the gem's own (turned) frame: the beams' axes are fixed in it
        const rdG = ksGemFrame(rd, gemRot).toVar();
        /**
         * A light's beams along the ray between a and b (ksBeamLobe: each facet's beam in closed
         * form), per unit of the light's strength over h. `oc` and `tc` place the light (from the
         * eye; where the ray passes closest); `shadowK` how far the light map shadows them (0: not
         * at all, and no lookup), looked up once where each beam crosses.
         */
        const beamsAlong = (oc, tc, a, b, reach, shadowK) => {
            const q = rd.mul(tc).sub(oc).toVar();
            const hr = max(length(q), 1e-4).toVar();
            const eG = ksGemFrame(q.div(hr), gemRot).toVar();
            const thA = atan(a.sub(tc).div(hr)).toVar();
            const thB = atan(b.sub(tc).div(hr)).toVar();
            const sum = float(0).toVar();
            // one loop over the facets' axes (a table: unrolled, six beams at two sites were 15 KB)
            Loop({
                start: int(0), end: int(beamAxes), type: 'int', condition: '<', name: 'bx',
            }, ({ bx }) => {
                const ax = u.beamAxes.element(bx).xyz;
                const lobe = ksBeamLobe(dot(eG, ax), dot(rdG, ax), thA, thB).toVar();
                If(lobe.x.greaterThan(1e-4), () => {
                    const ts = tc.add(hr.mul(tan(lobe.y))).toVar();
                    const v = rd.mul(ts).sub(oc).toVar();
                    const r = length(v).toVar();
                    const rr = r.div(reach);
                    const carried = exp(rr.mul(rr).add(max(ts.sub(0.5), 0.0).mul(fogK)).negate());
                    const vis = float(1).toVar();
                    If(shadowK.greaterThan(0.0), () => {
                        vis.assign(mix(float(1), lightVis(map, v, ts.mul(0.01).add(0.015)), shadowK));
                    });
                    sum.addAssign(lobe.x.mul(vis).mul(carried));
                });
            });
            return sum;
        };
        // where the walk entered the current cell
        const tEnter = float(0).toVar();
        Loop(jewelCells, ({ i: walked }) => {
            If(tEnter.greaterThan(tEnd.add(JEWEL_HIDDEN)), () => {
                Break();
            });
            const image = jewelBase.add(cell.mul(P)).toVar();
            const oc = image.sub(ro).toVar();
            const tc = dot(oc, rd).toVar();
            const d2 = max(dot(oc, oc).sub(tc.mul(tc)), 0.0).toVar();
            const onCore = smoothstep(0.02, 0.12, length(image.sub(heartPos))).toVar();
            const seen = smoothstep(0.0, 0.04, tEnd.sub(tc)).mul(smoothstep(0.0, 0.04, tc)).mul(onCore);
            const tw = sin(u.pulse.mul(0.7).add(ksHash31(cell.add(17.0)).mul(TAU))).mul(0.25).add(0.75).toVar();

            // ── this cell's jewel lights the air the ray crosses inside the cell (the cells are
            // centred on their jewels, so where one jewel's air ends the next one's matches it):
            // its dim even glow and its beams, both in closed form; the near cells' beams are
            // shadowed by the light map where each crosses the ray, the furthest cells keep only
            // the glow ──
            const tExit = min(tMax.x, min(tMax.y, tMax.z));
            const a = max(tEnter, AIR_CLEAR).toVar();
            const b = min(tExit, tAir).toVar();
            If(b.greaterThan(a).and(onCore.greaterThan(0.001)), () => {
                const hj = sqrt(d2.add(AIR.jewelR02)).toVar();
                const span = atan(b.sub(tc).div(hj)).sub(atan(a.sub(tc).div(hj)));
                // the glow is carried through the dark air and the fog as at the ray's nearest point
                const tn = clamp(tc, a, b);
                const along = tn.sub(tc);
                const carried = exp(along.mul(along).add(d2).div(-(AIR.jewelReach ** 2))
                    .sub(max(tn.sub(0.5), 0.0).mul(fogK)));
                const beams = float(0).toVar();
                if (airBeamCells > 0) {
                    If(walked.lessThan(int(airBeamCells)), () => {
                        const shadowJ = select(walked.lessThan(int(airCells)), u.light.x, float(0)).toVar();
                        beams.assign(beamsAlong(oc, tc, a, b, AIR.jewelReach, shadowJ));
                    });
                }
                const light = span.mul(carried).mul(BEAM.airBase).add(beams.mul(BEAM.airGain)).div(hj);
                airLight.addAssign(jewelCol.mul(light.mul(tw).mul(onCore).mul((2.2 / 3) * AIR.jewel)));
            });
            const glow = exp(d2.div(0.0012).negate()).mul(3.2).add(exp(sqrt(d2).mul(-11.0)).mul(0.3));
            // sympathetic resonance: a passing wavefront rings the jewel in its own colour
            const xs = length(image.sub(u.pingStrike.xyz)).sub(u.pingStrike.w).div(0.14);
            const ringS = exp(xs.mul(xs).negate()).mul(u.pingStrikeCol.w);
            const xh = length(image.sub(heartPos)).sub(u.pingHarm.x).div(0.16);
            const ringH = exp(xh.mul(xh).negate()).mul(u.pingHarm.y);
            const tint = jewelCol.add(u.pingStrikeCol.xyz.mul(ringS.mul(5.0)))
                .add(u.pingHarmCol.xyz.mul(ringH.mul(4.0)));
            jewels.addAssign(tint.mul(glow.mul(seen).mul(tw).mul(exp(tc.mul(fogK).mul(-0.85)))));
            // the next cell: across whichever wall the ray reaches first
            If(tMax.x.lessThan(tMax.y).and(tMax.x.lessThan(tMax.z)), () => {
                tEnter.assign(tMax.x);
                cell.x.addAssign(stepDir.x);
                tMax.x.addAssign(tDelta.x);
            }).ElseIf(tMax.y.lessThan(tMax.z), () => {
                tEnter.assign(tMax.y);
                cell.y.addAssign(stepDir.y);
                tMax.y.addAssign(tDelta.y);
            }).Else(() => {
                tEnter.assign(tMax.z);
                cell.z.addAssign(stepDir.z);
                tMax.z.addAssign(tDelta.z);
            });
        });
        col.addAssign(jewels.mul(lightK.mul(0.55)));

        // ── the core lights the air: its dim even glow and its beams, both in closed form, the
        // beams shadowed by the light map where each crosses the ray (the pearls round the core
        // cut them into shafts) ──
        const ocC = heartPos.sub(ro).toVar();
        const tcC = dot(ocC, rd).toVar();
        const d2C = max(dot(ocC, ocC).sub(tcC.mul(tcC)), 0.0).toVar();
        const hC = sqrt(d2C.add(AIR.coreR02)).toVar();
        const spanC = max(atan(tAir.sub(tcC).div(hC)).sub(atan(float(AIR_CLEAR).sub(tcC).div(hC))), 0.0);
        const tnC = clamp(tcC, AIR_CLEAR, max(tAir, AIR_CLEAR));
        const alongC = tnC.sub(tcC);
        const carriedC = exp(alongC.mul(alongC).add(d2C).div(-(AIR.coreReach ** 2))
            .sub(max(tnC.sub(0.5), 0.0).mul(fogK)));
        const shadowC = u.light.x.mul(u.light.y).toVar();
        const beamsC = beamsAlong(ocC, tcC, float(AIR_CLEAR), max(tAir, AIR_CLEAR), AIR.coreReach, shadowC);
        const lightC = spanC.mul(carriedC).mul(BEAM.airBase).add(beamsC.mul(BEAM.airGain)).div(hC);
        airLight.addAssign(heartCol.mul(lightC.mul((1.3 / 9) * AIR.core)));
        col.addAssign(airLight.mul(airGain));

        // ── the air: the strikes' shells, faintly, where the ray passes through them ──
        const strikeAir = vec3(0).toVar();
        Loop({
            start: int(0), end: int(u.counts.x), type: 'int', condition: '<', name: 'sa',
        }, ({ sa }) => {
            const A = u.strikes.element(sa.mul(STRIKE_ROWS));
            const B = u.strikes.element(sa.mul(STRIKE_ROWS).add(1));
            const C = u.strikes.element(sa.mul(STRIKE_ROWS).add(2));
            const r = A.w.mul(C.y);
            const oc = A.xyz.sub(ro);
            const tc = dot(oc, rd);
            const dc2 = max(dot(oc, oc).sub(tc.mul(tc)), 0.0);
            const inside = r.mul(r).sub(dc2);
            const reach = sqrt(max(inside, 0.0));
            // the near crossing of the shell, if the ray meets it at all and before the stone
            const tn = tc.sub(reach);
            const seen = smoothstep(0.0, 0.05, tEnd.sub(tn)).mul(smoothstep(0.0, 0.05, tn))
                .mul(smoothstep(0.0, 0.0004, inside));
            // only the thinnest rim of the wavefront shows in the air, and only while it is young
            const graze = exp(reach.div(max(r, 0.05)).mul(-28.0));
            const fade = exp(A.w.mul(-2.6)).mul(B.w).mul(exp(r.mul(-2.0)));
            col.addAssign(B.xyz.mul(graze.mul(seen).mul(fade).mul(0.7)));
            // the strike lights the mist round it for an instant (in closed form, up to the stone:
            // the stone in front of it hides it, the stone behind it stands out against it), the
            // light pooling close round the struck point
            const hS = sqrt(dc2.add(STRIKE_AIR.r02));
            const glowS = atan(tEnd.sub(tc).div(hS)).sub(atan(tc.negate().div(hS))).div(hS)
                .mul(exp(sqrt(dc2).div(-STRIKE_AIR.reach)));
            const flashS = exp(A.w.mul(-STRIKE_AIR.decay)).mul(B.w).mul(C.z.mul(STRIKE_AIR.hard).add(1.0));
            strikeAir.addAssign(B.xyz.mul(glowS.mul(flashS).mul(exp(max(tc.sub(0.5), 0.0).mul(fogK).negate()))));
            // the struck point itself: a lotus of eight petals in the piece's colour that opens,
            // turns a little and closes (a new jewel born), round a white-hot first instant
            const age = A.w;
            const pc = ro.add(rd.mul(tc)).sub(A.xyz);
            const dS = sqrt(dc2);
            const right = u.camWorld.mul(vec4(1.0, 0.0, 0.0, 0.0)).xyz;
            const up = u.camWorld.mul(vec4(0.0, 1.0, 0.0, 0.0)).xyz;
            const bloomR = float(0.009).add(age.mul(0.03)).mul(C.z.mul(0.5).add(1.0));
            const xs = dS.div(bloomR);
            const ang = atan(dot(pc, up), dot(pc, right).add(1e-7));
            const lobe = cos(ang.mul(8.0).add(age.mul(2.5))).mul(0.5).add(0.5);
            const xr = xs.div(lobe.mul(1.1).add(0.7));
            const petals = exp(xr.mul(xr).negate()).mul(2.2);
            const bud = exp(xs.mul(xs).mul(-6.0)).mul(3.0);
            const lotus = petals.add(bud).mul(exp(age.mul(-3.4)));
            const whiteHot = exp(xs.mul(xs).mul(-9.0)).mul(exp(age.mul(-14.0))).mul(5.0);
            const sparkSeen = smoothstep(0.0, 0.03, tEnd.sub(tc)).mul(smoothstep(0.0, 0.03, tc));
            col.addAssign(B.xyz.mul(lotus).add(vec3(whiteHot)).mul(sparkSeen).mul(B.w));
        });

        // the strikes' light in the mist, gathered and capped softly (several at once must not
        // wash the frame white)
        strikeAir.mulAssign(STRIKE_AIR.gain);
        col.addAssign(strikeAir.div(max(strikeAir.x, max(strikeAir.y, strikeAir.z)).mul(STRIKE_AIR.cap).add(1.0)));

        // ── the clears' standing waves leave the core as shells of light in the air ──
        Loop({
            start: int(0), end: int(u.counts.y), type: 'int', condition: '<', name: 'ha',
        }, ({ ha }) => {
            const H0 = u.harmonics.element(ha.mul(HARMONIC_ROWS));
            const H1 = u.harmonics.element(ha.mul(HARMONIC_ROWS).add(1));
            const r = H0.x;
            const oc = heartPos.sub(ro);
            const tc = dot(oc, rd);
            const inside = r.mul(r).sub(max(dot(oc, oc).sub(tc.mul(tc)), 0.0));
            const reach = sqrt(max(inside, 0.0));
            const tn = tc.sub(reach);
            const seen = smoothstep(0.0, 0.05, tEnd.sub(tn)).mul(smoothstep(0.0, 0.05, tn))
                .mul(smoothstep(0.0, 0.0004, inside));
            const graze = exp(reach.div(max(r, 0.05)).mul(-24.0));
            col.addAssign(H1.xyz.mul(graze.mul(seen).mul(H0.w).mul(0.6)));
        });

        // ── the core: a white-hot heart, a turning corona of twelve petals, sound rings ──
        const toC = heartPos.sub(ro);
        const tcH = max(dot(toC, rd), 0.0);
        const off = ro.add(rd.mul(tcH)).sub(heartPos).toVar();
        const dcH = length(off).toVar();
        const visible = smoothstep(0.0, 0.03, tEnd.sub(tcH));
        const radius = u.heart.w;
        const camRight = u.camWorld.mul(vec4(1.0, 0.0, 0.0, 0.0)).xyz;
        const camUp = u.camWorld.mul(vec4(0.0, 1.0, 0.0, 0.0)).xyz;
        const theta = atan(dot(off, camUp), dot(off, camRight).add(1e-7));
        const x = dcH.div(radius).toVar();
        // a lotus of twelve lobes: the corona's reach swells and narrows round the gem
        const lobes = cos(theta.mul(12.0).add(u.pulse.mul(0.25))).mul(0.5).add(0.5);
        const reachC = lobes.mul(1.1).add(1.7);
        const xc = x.div(reachC);
        const corona = exp(xc.mul(xc).mul(-1.0)).mul(0.55).add(exp(xc.mul(-2.4)).mul(0.18));
        const soundRings = cos(x.mul(1.4).sub(u.pulse.mul(1.6))).mul(0.5).add(0.5);
        const rings = soundRings.mul(soundRings).mul(soundRings).mul(exp(x.mul(-0.5))).mul(0.25);
        const halo = exp(dcH.mul(-16.0)).mul(0.07);
        const drone = u.heartState.y;
        col.addAssign(jewelCol.mul(corona.add(rings).add(halo).add(drone.mul(halo).mul(2.0))).mul(visible).mul(coreK));

        // the gem itself: a sphere cut into twelve facets (the icosahedron's vertices), lit from
        // within in the core's colour and its neons, its facet edges sparkling white
        const gemR = radius.mul(1.35);
        const og = ro.sub(heartPos);
        const bq = dot(og, rd);
        const disc = bq.mul(bq).sub(dot(og, og).sub(gemR.mul(gemR)));
        const tg = bq.negate().sub(sqrt(max(disc, 0.0)));
        const onGem = smoothstep(0.0, gemR.mul(gemR).mul(0.02), disc).mul(smoothstep(0.0, 0.02, tEnd.sub(tg)))
            .mul(visible)
            .toVar();
        // a facet edge's width in the facets' own measure: one pixel turns the gem's normal by about
        // pixelAngle · distance / radius (worked out here, not by derivatives inside the branch)
        const edgeW = max(u.pixelAngle.mul(max(tg, 0.01)).div(gemR).mul(1.2), 1e-4).toVar();
        If(onGem.greaterThan(0.001), () => {
            // in the gem's own (turned) frame: its facets are the beams' axes
            const ns = ksGemFrame(normalize(ro.add(rd.mul(tg)).sub(heartPos)), gemRot).toVar();
            const best = float(-1).toVar();
            const second = float(-1).toVar();
            const facetN = vec3(0, 1, 0).toVar();
            const facetK = float(0).toVar();
            BEAM_AXES.forEach((a, j) => {
                const d = dot(ns, vec3(a[0], a[1], a[2]));
                const ad = abs(d).toVar();
                If(ad.greaterThan(best), () => {
                    second.assign(best);
                    best.assign(ad);
                    facetN.assign(vec3(a[0], a[1], a[2]).mul(sign(d)));
                    facetK.assign(float(j).add(sign(d).mul(0.5).add(0.5).mul(6.0)));
                }).ElseIf(ad.greaterThan(second), () => {
                    second.assign(ad);
                });
            });
            // facet colours: the core's own and its neons, by facet
            const k3 = facetK.sub(floor(facetK.div(3.0)).mul(3.0));
            const facetA = mix(jewelCol, neonNow.mul(1.4), smoothstep(0.5, 1.5, k3));
            const facetCol = mix(facetA, mix(neonB1, neonB2, mk).mul(1.4), smoothstep(1.5, 2.5, k3));
            const face = clamp(dot(facetN, rdG.negate()), 0.0, 1.0);
            // bright enough to glow, held under white so every facet keeps its colour
            const inner = float(0.32).add(face.mul(face).mul(0.55));
            const edge = exp(best.sub(second).div(edgeW).mul(-1.5));
            const glint = face.mul(face).mul(face).mul(face).mul(face)
                .mul(face)
                .mul(1.4);
            const gem = facetCol.mul(inner).add(vec3(1.0, 0.95, 1.0).mul(edge.mul(1.2).add(glint)));
            col.assign(mix(col, gem.mul(coreK), onGem));
        });
        // a four-line or perfect flash, coloured by the core
        col.addAssign(heartCol.mul(u.state.w.mul(0.08)));
        return vec4(max(col, vec3(0.0)).mul(u.exposure), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'KaleidosonicTemple';
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    return {
        mesh,
        material,
        geometry,
        scout,
        lightMap,
        /** The drawing buffer's size (pixels): the scout's blocks are laid over it. */
        setViewport(width, height) {
            const w = Math.max(1, Math.round(width));
            const h = Math.max(1, Math.round(height));
            scout?.setSize(w, h);
            u.scout.value.set(w, h, Math.ceil(w / SCOUT_TILE), Math.ceil(h / SCOUT_TILE));
        },
        /** Before each frame (only while the temple is drawn): the light map when it is stale, the scout. */
        prerender(renderer) {
            if (!mesh.visible) return;
            lightMap.render(renderer);
            if (scout) scout.render(renderer);
        },
        dispose() {
            geometry.dispose();
            material.dispose();
            scout?.dispose();
            lightMap.dispose();
        },
    };
}
