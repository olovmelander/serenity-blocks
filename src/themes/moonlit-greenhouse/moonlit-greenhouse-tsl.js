/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — shared TSL: the moonlight through the glazing, the sky beyond the glass,
 * and the lights every surface in the house shades itself with.
 *
 * The one idea every material shares is `mgMoonlight(p, moon, soft)`: the share of the moon's
 * light that reaches a point inside the house. The house is a closed shape (a pointed vault of
 * two circular arcs over straight side walls), so the place where a ray from the point toward
 * the moon leaves it is a closed form (two circle exits and a plane), and the iron there (ribs,
 * glazing bars, purlins, the ridge, the walls' mullions and transoms) is a handful of line masks
 * in the glass's own coordinates. Each bar's shadow softens with the distance it is thrown (the
 * moon is a disc), so a near bar draws a crisp line and a far one a soft band. The floor, the
 * leaves, the water, the motes and the post stack's march through the mist all read it, which is
 * why every beam in the air carries the lattice and lands on its own pattern on the floor. The
 * CPU twin is houseExit() + glazingAt() in moonlit-greenhouse-core.js.
 *
 * Laid-out functions here are pure (they read only their arguments and constants); the
 * builders that read uniforms or the noise texture are inline and called inside a material's Fn.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, abs, acos, atan, clamp, dot, exp, float, floor, fract, int, length, max, min, mix, normalize, round,
    select, sin, smoothstep, sqrt, texture, vec2, vec3, vec4,
} from 'three/tsl';
import {
    ARC, BLINDS, GLAZING, HOUSE, NIGHT_COLOURS, bakeGardenNoise,
} from './moonlit-greenhouse-core.js';

/**
 * The look's numbers, in one place. The playground can override any of them from the URL
 * (`P.<name>=<value>`) before the world is built; the theme ships these.
 */
export const TUNE = {
    // The moon: its disc's brightness, its tight aureole and its wide glow in the air.
    moonDisc: 1.55,
    moonAureole: 0.9,
    moonGlow: 0.16,
    // Stars: how many (a hash threshold) and how bright.
    starDensity: 0.1,
    starGain: 3.0,
    // Cloud beyond the glass: noise tiles per unit of the cloud plane, and its brightness.
    cloudScale: 0.42,
    cloudLight: 0.22,
    // The trees outside, seen low through the side walls.
    treeLine: 0.12,
};

/** Apply overrides (numbers, or comma lists for the array entries) to TUNE. */
export function tune(overrides) {
    if (!overrides) return;
    Object.keys(overrides).forEach((key) => {
        if (!(key in TUNE)) return;
        const current = TUNE[key];
        const raw = overrides[key];
        if (Array.isArray(current)) {
            const list = String(raw).split(',').map(Number);
            if (list.length === current.length && list.every(Number.isFinite)) TUNE[key] = list;
        } else if (Number.isFinite(Number(raw))) {
            TUNE[key] = Number(raw);
        }
    });
}

/** The garden's noise as a texture (see bakeGardenNoise): repeat, mipmapped, linear data. */
export function createGardenNoise(size = 256) {
    const map = new THREE.DataTexture(bakeGardenNoise(size), size, size, THREE.RGBAFormat);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.anisotropy = 8;
    map.colorSpace = THREE.NoColorSpace;
    map.needsUpdate = true;
    map.name = 'moonlit-greenhouse-noise';
    return map;
}

/**
 * The night's colours as nodes: one uniform row each (moonlit-greenhouse-core.js NIGHT_COLOURS),
 * which the world rewrites as the night drifts. `rows` is a uniformArray of vec4.
 */
export function createNight(rows) {
    return Object.freeze(Object.fromEntries(NIGHT_COLOURS.map((name, i) => [name, rows.element(i).xyz])));
}

export const mgLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
export const mgMax3 = (c) => max(c.x, max(c.y, c.z));

/** A hash of a 2D point, 0..1 (no sine: stable for large inputs). */
export const mgHash21 = Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'mg_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** A hash of a 3D point to three values, 0..1. */
export const mgHash33 = Fn(([pIn]) => {
    const p3 = fract(pIn.mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
}).setLayout({ name: 'mg_hash33', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec3' }] });

/** The pane hash of the CPU's hash2(a, b) (the same formula; integer inputs). */
export const mgPaneHash = Fn(([a, b]) => fract(sin(a.mul(12.9898).add(b.mul(78.233))).mul(43758.5453)))
    .setLayout({
        name: 'mg_paneHash', type: 'float', inputs: [{ name: 'a', type: 'float' }, { name: 'b', type: 'float' }],
    });

/** 1 on a line `width` wide on every multiple of `every`, 0 off it; edges `soft` metres wide. */
export const mgLine = Fn(([x, every, width, soft]) => {
    const f = x.div(every);
    const d = abs(f.sub(round(f))).mul(every);
    const half = width.mul(0.5);
    const w = max(soft, 1e-4).mul(0.5);
    return float(1.0).sub(smoothstep(half.sub(w), half.add(w), d));
}).setLayout({
    name: 'mg_line',
    type: 'float',
    inputs: [
        { name: 'x', type: 'float' }, { name: 'every', type: 'float' }, { name: 'width', type: 'float' },
        { name: 'soft', type: 'float' },
    ],
});

/**
 * Where a ray from inside the house toward `d` (d.y > 0) leaves it, and the glass coordinates
 * there: vec4(t, along, s, w). `s` is metres of arc from the spring up the vault (on a side
 * wall, negative metres below the spring); `w` is 1 for a side wall, 0 for the vault left of the
 * ridge and −1 right of it. Twin of houseExit().
 */
export const mgHouseExit = Fn(([p, d]) => {
    const S = float(HOUSE.spring);
    const R2 = float(ARC.radius * ARC.radius);
    const dy = p.y.sub(S);
    const a = max(d.x.mul(d.x).add(d.y.mul(d.y)), 1e-6);
    // The left arc's circle is centred at +offset, the right arc's at −offset.
    const dxL = p.x.sub(ARC.offset);
    const bL = dxL.mul(d.x).add(dy.mul(d.y)).mul(2.0);
    const cL = dxL.mul(dxL).add(dy.mul(dy)).sub(R2);
    const tL = bL.negate().add(sqrt(max(bL.mul(bL).sub(a.mul(cL).mul(4.0)), 0.0))).div(a.mul(2.0));
    const dxR = p.x.add(ARC.offset);
    const bR = dxR.mul(d.x).add(dy.mul(d.y)).mul(2.0);
    const cR = dxR.mul(dxR).add(dy.mul(dy)).sub(R2);
    const tR = bR.negate().add(sqrt(max(bR.mul(bR).sub(a.mul(cR).mul(4.0)), 0.0))).div(a.mul(2.0));
    const left = tL.lessThanEqual(tR);
    const tV = min(tL, tR).toVar();
    const hx = p.x.add(d.x.mul(tV));
    const hy = p.y.add(d.y.mul(tV));
    const cx = select(left, float(ARC.offset), float(-ARC.offset));
    const ang = atan(hy.sub(S), select(left, hx.sub(cx), cx.sub(hx)));
    const sV = float(ARC.radius).mul(float(Math.PI).sub(ang));
    // The side wall on the ray's side.
    const dxSafe = select(abs(d.x).lessThan(1e-4), float(1e-4), d.x);
    const wx = select(d.x.lessThan(0.0), float(-HOUSE.halfSpan), float(HOUSE.halfSpan));
    const tW = wx.sub(p.x).div(dxSafe);
    const sW = p.y.add(d.y.mul(tW)).sub(S);
    const onWall = hy.lessThan(S).and(abs(d.x).greaterThan(1e-4));
    const t = select(onWall, tW, tV);
    // w: 1 a side wall, 0 the vault left of the ridge, −1 right of it.
    const w = select(onWall, float(1.0), select(left, float(0.0), float(-1.0)));
    return vec4(t, p.z.add(d.z.mul(t)), select(onWall, sW, sV), w);
}).setLayout({
    name: 'mg_houseExit', type: 'vec4', inputs: [{ name: 'p', type: 'vec3' }, { name: 'd', type: 'vec3' }],
});

/**
 * How much light the lath blind over a point of the vault lets by (1 = none there). `side` is −1
 * left of the ridge, +1 right. Twin of blindAt().
 */
export const mgBlind = Fn(([along, side, s, soft]) => {
    const bay = floor(along.div(GLAZING.ribEvery));
    const h = mgPaneHash(bay.mul(3.0).add(11.0), side.mul(7.0).add(5.0));
    const pick = mgPaneHash(bay.add(31.0), side.mul(3.0).sub(2.0));
    const extent = mix(float(BLINDS.reach[0]), float(BLINDS.reach[1]), pick);
    const from = float(ARC.length).mul(float(1.0).sub(extent));
    const e = soft.mul(0.5).add(0.02);
    const cover = smoothstep(from.sub(e), from.add(e), s);
    const f = s.div(BLINDS.slat);
    const d = abs(f.sub(round(f)));
    const w = max(soft.div(BLINDS.slat), 0.04);
    const gap = float(1.0).sub(smoothstep(float(BLINDS.open * 0.5).sub(w), float(BLINDS.open * 0.5).add(w), d));
    const ruled = mix(gap, float(BLINDS.open), smoothstep(0.4, 1.6, soft.div(BLINDS.slat)));
    const blinded = mix(float(1.0), ruled.mul(0.96).add(0.04), cover);
    return select(h.greaterThan(BLINDS.share), float(1.0), blinded);
}).setLayout({
    name: 'mg_blind',
    type: 'float',
    inputs: [
        { name: 'along', type: 'float' }, { name: 'side', type: 'float' }, { name: 's', type: 'float' },
        { name: 'soft', type: 'float' },
    ],
});

/**
 * How much light the glazing passes at glass coordinates (along, s) on the vault (wall = 0 left
 * of the ridge, −1 right of it) or a side wall (wall = 1): each pane its own (old glass, a fogged
 * pane, a vent propped open), nothing where the iron stands, and the blinds' laths where a blind
 * is down; every edge `soft` metres wide. Twin of glazingAt().
 */
export const mgGlazing = Fn(([along, s, wall, soft]) => {
    const g = GLAZING;
    // The vault.
    const rib = mgLine(along, float(g.ribEvery), float(g.ribWidth), soft);
    const bar = mgLine(along, float(g.barEvery), float(g.barWidth), soft);
    const purlin = mgLine(s, float(g.purlinEvery), float(g.purlinWidth), soft);
    const hs = soft.mul(0.5);
    const ridge = smoothstep(float(ARC.length - g.ridgeWidth).sub(hs), float(ARC.length - g.ridgeWidth).add(hs), s);
    const springBeam = float(1.0).sub(smoothstep(float(0.16).sub(hs), float(0.16).add(hs), s));
    const ironV = max(max(rib, bar), max(max(purlin, ridge), springBeam));
    // The side walls.
    const h = s.add(HOUSE.spring);
    const mullion = mgLine(along, float(g.mullionEvery), float(g.barWidth * 1.4), soft);
    const tw = float(g.transomWidth * 0.5);
    const transom = max(
        float(1.0).sub(smoothstep(tw, tw.add(soft), abs(h.sub(g.transoms[0])))),
        float(1.0).sub(smoothstep(tw, tw.add(soft), abs(h.sub(g.transoms[1])))),
    );
    const plinth = float(1.0).sub(smoothstep(float(HOUSE.plinth).sub(hs), float(HOUSE.plinth).add(hs), h));
    const head = smoothstep(float(HOUSE.spring - 0.18).sub(hs), float(HOUSE.spring - 0.18).add(hs), h);
    const ironW = max(max(mullion, transom), max(plinth, head));
    const isWall = wall.greaterThan(0.5);
    const iron = select(isWall, ironW, ironV);
    // The pane's own glass.
    const pi = select(isWall, floor(along.div(g.mullionEvery)), floor(along.div(g.barEvery)));
    const upper = select(h.lessThan(g.transoms[1]), float(-2.0), float(-1.0));
    const band = select(h.lessThan(g.transoms[0]), float(-3.0), upper);
    const pj = select(isWall, band, floor(s.div(g.purlinEvery)));
    const hp = mgPaneHash(pi, pj);
    const clear = float(0.8).add(mgPaneHash(pj.add(17.0), pi.sub(5.0)).mul(0.15));
    const pane = select(hp.lessThan(0.025), float(1.0), select(hp.lessThan(0.0875), float(0.55), clear));
    // The blinds (the vault only): w 0 is left of the ridge, −1 right of it.
    const side = select(wall.lessThan(-0.5), float(1.0), float(-1.0));
    const blind = select(isWall, float(1.0), mgBlind(along, side, s, soft));
    return pane.mul(float(1.0).sub(iron)).mul(blind);
}).setLayout({
    name: 'mg_glazing',
    type: 'float',
    inputs: [
        { name: 'along', type: 'float' }, { name: 's', type: 'float' }, { name: 'wall', type: 'float' },
        { name: 'soft', type: 'float' },
    ],
});

/**
 * The moonlight that reaches `p` through the glazing (0..1), for a moon in direction `moon`.
 * `extraSoft` widens every shadow edge by that many metres (a pixel's footprint, a march step).
 */
export const mgMoonlight = Fn(([p, moon, extraSoft]) => {
    const e = mgHouseExit(p, moon).toVar();
    const soft = e.x.mul(GLAZING.penumbra).add(extraSoft).add(0.004);
    const lit = mgGlazing(e.y, e.z, e.w, soft);
    return select(moon.y.greaterThan(0.02), lit, float(0.0));
}).setLayout({
    name: 'mg_moonlight',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec3' }, { name: 'moon', type: 'vec3' }, { name: 'extraSoft', type: 'float' }],
});

/**
 * Stars on a 3D lattice of directions (round everywhere on the sphere, no seam): one star a cell
 * at a hashed place, present where a hash is under `density`. Returns their light.
 */
const starLayer = (dir, scale, density, sharp, time) => {
    const q = dir.mul(scale);
    const cell = floor(q);
    const h = mgHash33(cell);
    const star = cell.add(h.mul(0.56).add(0.22));
    const d = length(q.sub(star));
    const present = smoothstep(density, density.sub(0.04), h.z.mul(0.7).add(h.x.mul(0.3)));
    const bright = h.y.mul(h.y).mul(0.9).add(0.1);
    const twinkle = sin(time.mul(h.x.mul(3.0).add(1.2)).add(h.z.mul(40.0))).mul(0.3).add(0.7);
    return exp(d.mul(d).mul(sharp).negate()).mul(present).mul(bright).mul(twinkle);
};

/**
 * The sky beyond the glass along `dir` (unit): the night's air from its horizon colour to its
 * zenith, the moon's wide glow and tight aureole, the disc itself with its seas, the stars, a
 * little cloud drifting (silvered where it nears the moon), and the dark tops of the garden's
 * trees low down through the side walls. `disc` (vec2) is the point's place on the moon's disc
 * in units of its radius, built by the caller (the glass builds it in the lens's image plane so
 * the disc stays round anywhere in the frame; the water about the moon's direction). Inline:
 * it reads uniforms and the noise.
 */
export function mgSky(dir, disc, U, noise, { stars = 2, clouds = true, trees = true } = {}) {
    const { night } = U;
    const up = clamp(dir.y, 0.0, 1.0);
    const toMoon = dot(dir, U.moon);
    const away = max(float(1.0).sub(toMoon), 0.0);
    // The air.
    const air = mix(night.horizon, night.zenith, smoothstep(0.0, 0.55, up).sqrt());
    const veil = float(1.0).sub(U.moonCover.mul(0.75));
    const glow = night.moonlight.mul(
        exp(away.mul(-1.0 / 0.11)).mul(TUNE.moonGlow).add(exp(away.mul(-1.0 / 0.0045)).mul(TUNE.moonAureole)),
    ).mul(veil);
    let colour = air.add(glow);
    // A perfect clear rings the moon with a corona: the coloured rings that a veil of fine droplets
    // draws a few degrees round it, blue-white inside, red on each ring's outer edge.
    const deg = acos(clamp(toMoon, -1.0, 1.0)).mul(180 / Math.PI);
    const band = (r, w) => exp(deg.sub(r).div(w).mul(deg.sub(r).div(w)).negate());
    const corona = vec3(
        band(4.6, 0.55).add(band(8.4, 0.8).mul(0.55)),
        band(4.1, 0.5).add(band(7.8, 0.75).mul(0.5)),
        band(3.6, 0.5).add(band(7.2, 0.7).mul(0.45)),
    ).add(vec3(0.7, 0.8, 1.0).mul(exp(deg.negate().div(1.6))));
    colour = colour.add(night.moonlight.mul(corona).mul(U.queen.w.mul(U.queen.y)).mul(0.45));
    // Cloud: a thin deck drifting, lit from the moon's side.
    let cloudDensity = float(0.0);
    if (clouds) {
        const plane = vec2(dir.x, dir.z).div(dir.y.add(0.16)).mul(TUNE.cloudScale).add(U.cloudDrift);
        const n1 = texture(noise, plane).level(1.0);
        const n2 = texture(noise, plane.mul(2.7).add(vec2(0.31, 0.17))).level(1.0);
        const shape = n1.x.mul(0.65).add(n2.w.mul(0.35)).add(n1.z.mul(0.3)).sub(0.15);
        cloudDensity = smoothstep(float(1.02).sub(U.cloud.mul(0.6)), float(1.22).sub(U.cloud.mul(0.6)), shape)
            .mul(smoothstep(0.02, 0.2, dir.y));
        const lining = exp(away.mul(-1.0 / 0.05)).mul(2.6).add(0.12);
        const cloudColour = mix(night.horizon.mul(0.9), night.moonlight.mul(TUNE.cloudLight), lining.min(1.0))
            .add(night.moonlight.mul(lining.mul(0.3)).mul(float(1.0).sub(cloudDensity)));
        colour = mix(colour, cloudColour, cloudDensity.mul(0.85));
    }
    // Stars: dimmed near the moon and behind cloud.
    if (stars > 0) {
        const sky = U.stars.mul(float(1.0).sub(cloudDensity))
            .mul(smoothstep(0.02, 0.12, away)).mul(smoothstep(0.0, 0.08, up));
        let light = starLayer(dir, float(150.0), float(TUNE.starDensity), float(70.0), U.time);
        if (stars > 1) {
            const fine = starLayer(dir, float(320.0), float(TUNE.starDensity * 1.3), float(90.0), U.time);
            light = light.add(fine.mul(0.55));
        }
        colour = colour.add(vec3(0.85, 0.9, 1.0).mul(light).mul(sky).mul(TUNE.starGain));
    }
    // The disc: limb-darkened, its dark seas and bright-rimmed craters from the noise, kept
    // under the tone curve's shoulder so its face survives the grade (the bloom gives the glow).
    const r = length(disc);
    const inside = float(1.0).sub(smoothstep(0.97, 1.03, r)).mul(smoothstep(0.0, 0.05, toMoon));
    const maria = texture(noise, disc.mul(0.3).add(vec2(0.37, 0.61))).level(0.0);
    const seas = smoothstep(0.44, 0.66, maria.x.mul(0.65).add(maria.z.mul(0.35)));
    const pits = texture(noise, disc.mul(1.15).add(vec2(0.13, 0.29))).level(0.0).y;
    const rims = smoothstep(0.08, 0.26, pits).mul(float(1.0).sub(smoothstep(0.32, 0.7, pits)));
    const floors = smoothstep(0.62, 0.92, pits);
    const limb = sqrt(max(float(1.0).sub(r.mul(r)), 0.0)).mul(0.4).add(0.6);
    const albedo = float(1.0).sub(seas.mul(0.46)).add(rims.mul(0.12)).sub(floors.mul(0.14));
    const face = night.moonDisc.mul(albedo).mul(limb).mul(TUNE.moonDisc);
    colour = mix(colour, face.mul(veil.mul(veil)), inside.mul(float(1.0).sub(cloudDensity.mul(0.8))));
    // The garden's trees outside, low through the side walls: a broad line of woods, crowns
    // rounded as canopies are (cells of the bead field read along the bearing) and a few tall
    // poplars and cypresses standing out of it.
    if (trees) {
        const bearing = atan(dir.x, dir.z.negate());
        const broad = texture(noise, vec2(bearing.mul(0.45), 0.37)).level(1.0);
        const crowns = texture(noise, vec2(bearing.mul(2.6), 0.71)).level(0.0);
        const spires = smoothstep(0.62, 0.9, texture(noise, vec2(bearing.mul(1.3), 0.13)).level(0.0).z);
        const top = float(TUNE.treeLine).add(broad.x.sub(0.5).mul(0.07)).add(crowns.y.mul(0.035)).add(spires.mul(0.09));
        const tree = float(1.0).sub(smoothstep(top.sub(0.003), top.add(0.003), dir.y));
        colour = mix(colour, night.horizon.mul(0.1), tree);
    }
    return colour;
}

/**
 * The warm light the hanging lanterns throw on a surface at `p` facing `n`: each lantern row is
 * vec4(position, strength); `count` live rows. Wrapped diffuse, a soft inverse square.
 */
export function mgLanterns(p, n, U) {
    const sum = vec3(0.0).toVar();
    Loop({
        start: int(0), end: int(U.lanternCount), type: 'int', condition: '<', name: 'lantern',
    }, ({ lantern }) => {
        const row = U.lanternRows.element(lantern);
        const toL = row.xyz.sub(p);
        const d2 = dot(toL, toL);
        const wrap = clamp(dot(n, toL.mul(float(1.0).div(sqrt(d2).add(1e-4)))).mul(0.6).add(0.4), 0.0, 1.0);
        sum.addAssign(vec3(row.w.mul(wrap).div(d2.mul(0.9).add(1.0))));
    });
    return sum.mul(U.night.lantern).mul(U.lanternGain);
}

/**
 * The light the open blooms throw round them: rows in pairs, vec4(position, strength) then
 * vec4(colour, radius); `count` live blooms. The hue is the strongest bloom's and the level is
 * capped, so many blooms together never wash to white (ocStains, Ocean's rebuild).
 */
export function mgBloomLight(p, n, U) {
    const hue = vec3(0.0).toVar();
    const weight3 = float(0.0).toVar();
    const level = float(0.0).toVar();
    Loop({
        start: int(0), end: int(U.bloomLightCount), type: 'int', condition: '<', name: 'bloom',
    }, ({ bloom }) => {
        const a = U.bloomLights.element(bloom.mul(2));
        const b = U.bloomLights.element(bloom.mul(2).add(1));
        const toB = a.xyz.sub(p);
        const d = length(toB);
        const facing = clamp(dot(n, toB.div(d.add(1e-4))).mul(0.5).add(0.5), 0.0, 1.0);
        const w = a.w.mul(facing).div(d.mul(d).div(b.w.mul(b.w)).add(1.0));
        const w3 = w.mul(w).mul(w);
        hue.addAssign(b.xyz.mul(w3));
        weight3.addAssign(w3);
        level.addAssign(w);
    });
    return hue.div(max(weight3, 1e-6)).mul(level.div(level.add(1.0))).mul(2.0);
}

/** A colour's saturation pulled toward its luma by `k` (0 keeps it, 1 grey). */
export const mgDesaturate = (c, k) => mix(c, vec3(mgLuma(c)), k);

/**
 * The palms' crowns between a point and the moon: the share of moonlight their fronds let by
 * (1 = none in the way). Each crown row pair is vec4(centre, radius) then vec4(fronds, twist,
 * seed, 0) (moonlit-greenhouse-plan.js palmCrownCentre / palmFrondAngle): where the ray toward
 * the moon crosses the crown's height, the fronds are a fan of narrowing blades made of leaflets,
 * so the beams under the palms are dappled and every frond lays its comb of shadow on what is
 * below. Inline: it reads the crowns' table.
 */
export function mgCanopy(p, moon, U) {
    const shade = float(1.0).toVar();
    Loop({
        start: int(0), end: int(U.crownCount), type: 'int', condition: '<', name: 'crown',
    }, ({ crown }) => {
        const a = U.crowns.element(crown.mul(2));
        const b = U.crowns.element(crown.mul(2).add(1));
        const h = a.y.sub(p.y);
        const q = p.xz.add(moon.xz.mul(h.div(max(moon.y, 0.05))));
        const d = q.sub(a.xz);
        const r = length(d).div(a.w);
        const sector = atan(d.y, d.x).sub(b.y).mul(b.x).div(Math.PI * 2);
        const k = round(sector);
        // The frond's own hash turn (palmFrondAngle's jitter), in sectors.
        const jitter = sin(b.z.mul(97.13).add(k.mul(12.9898)).mul(43.7)).mul(0.12).mul(b.x).div(Math.PI * 2);
        const f = abs(sector.sub(k).sub(jitter));
        const width = mix(float(0.34), float(0.1), r);
        const soft = h.mul(0.004).div(max(r.mul(a.w), 0.3)).add(0.03);
        const blade = float(1.0).sub(smoothstep(width.sub(soft), width.add(soft), f));
        const leaflets = smoothstep(0.18, 0.42, abs(fract(r.mul(15.0).add(f.mul(2.5))).sub(0.5)).mul(2.0));
        const reach = float(1.0).sub(smoothstep(0.85, 1.05, r)).mul(smoothstep(0.03, 0.12, r));
        const below = select(h.greaterThan(0.0), float(0.88), float(0.0));
        const hit = blade.mul(mix(float(1.0), leaflets, 0.55)).mul(reach).mul(below);
        shade.mulAssign(float(1.0).sub(hit));
    });
    return shade;
}

/**
 * How a surface in the house is lit, the same for every part, so the iron, the floor, the plants
 * and the blooms agree on the night: `albedo` lit by
 *   the moon through the glazing and between the palms' fronds (wrapped diffuse), with the
 *   colour drained out of what it lights (moonlight is nearly colourless to the eye);
 *   light through a thin leaf when the moon is behind it (`translucency` 0..1; it glows in the
 *   night's leafLit colour);
 *   the sky's dim light through the glass from above;
 *   the lanterns, the open blooms and the fireflies, which give the colour back.
 * `soft` widens the lattice's edges (pass the pixel's footprint in metres). `ao` (0..1) darkens
 * the ambient terms (crevices, the underside of a crown). Returns scene-linear light.
 */
export function mgSurface(p, n, albedo, U, {
    translucency = 0, soft = float(0.01), ao = float(1.0), canopy = true, view = null,
} = {}) {
    const { night } = U;
    const { moon } = U;
    let vis = mgMoonlight(p, moon, soft);
    if (canopy) vis = vis.mul(mgCanopy(p, moon, U));
    const ndl = dot(n, moon);
    const wrap = clamp(ndl.mul(0.78).add(0.22), 0.0, 1.0);
    const grey = mgDesaturate(albedo, 0.55);
    const moonlight = night.moonlight.mul(U.moonLight).mul(vis);
    let colour = grey.mul(moonlight).mul(wrap).mul(0.62);
    if (translucency) {
        const v = view || normalize(p.sub(U.eye));
        // Light through the leaf: the moon behind it, the eye in front.
        const through = clamp(dot(v, moon), 0.0, 1.0);
        const back = clamp(ndl.negate().mul(0.6).add(0.4), 0.0, 1.0);
        const glow = through.mul(through).mul(0.7).add(0.3).mul(back);
        colour = colour.add(night.leafLit.mul(moonlight).mul(glow).mul(float(translucency).mul(0.42)));
    }
    const sky = mix(night.horizon, night.zenith, n.y.mul(0.5).add(0.5)).mul(1.4).mul(ao);
    const lamps = mgLanterns(p, n, U).mul(0.55);
    const blooms = mgBloomLight(p, n, U).mul(0.12);
    const flies = night.firefly.mul(U.fireflyGlow).mul(0.018).mul(ao);
    return colour.add(albedo.mul(sky.add(lamps).add(blooms).add(flies)));
}
