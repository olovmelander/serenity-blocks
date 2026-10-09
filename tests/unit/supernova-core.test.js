import { describe, expect, it } from 'vitest';
import {
    BLAST_SHELLS, COLLAPSED_SIZE, COLLAPSE_HOLD, FRONT_SLOTS, IMPACT_SLOTS, LOOP_SLOTS, NEBULA, NOVA_REARM,
    PALETTE_DRIFT, PALETTE_HOLD, PALETTE_KEYS, REKINDLE, RING, ROW_FLIGHT, SHELL_ROWS, SHELL_STRIDE, STANDING_MAX,
    STAR, STREAM_FLIGHT, STREAM_SLOTS, SUPERNOVA_PALETTES, approach, blastRadius, clamp01, collapseScale,
    frontPassTime, frontRadius, heatForCombo, lerp, linRGB, mulberry32, paletteDrift, pieceColor, pulsarGain,
    shellGain, shellPhase, shellRadius, smooth, starAnchors,
} from '../../src/themes/supernova/supernova-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/supernova/supernova-quality.js';
import { SUPERNOVA_TETROMINOS } from '../../src/themes/supernova/supernova-tetrominos.js';
import { fallbackLayout } from '../../src/themes/supernova/supernova-composition.js';

/** Evenly spaced samples of [from, to], both ends included. */
const samples = (from, to, count) => Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));

describe('supernova core: small maths', () => {
    it('closes the same share of a gap whatever the frame step', () => {
        expect(approach(3, 0)).toBe(0);
        expect(approach(3, 100)).toBeCloseTo(1, 12);
        // Four quarter steps close what one whole step closes.
        const whole = approach(2.6, 0.1);
        const quarter = approach(2.6, 0.025);
        expect(1 - (1 - quarter) ** 4).toBeCloseTo(whole, 12);
        expect(approach(9, 0.016)).toBeGreaterThan(approach(1, 0.016));
    });

    it('clamps, mixes and steps', () => {
        expect([clamp01(-2), clamp01(0.3), clamp01(7)]).toEqual([0, 0.3, 1]);
        expect(lerp(2, 6, 0.25)).toBe(3);
        expect(smooth(1, 3, 0)).toBe(0);
        expect(smooth(1, 3, 1)).toBe(0);
        expect(smooth(1, 3, 2)).toBeCloseTo(0.5, 12);
        expect(smooth(1, 3, 3)).toBe(1);
        expect(smooth(1, 3, 9)).toBe(1);
        const ramp = samples(1, 3, 41).map((v) => smooth(1, 3, v));
        for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeGreaterThanOrEqual(ramp[i - 1]);
    });

    it('draws the same numbers from the same seed, in [0, 1)', () => {
        const a = mulberry32(1987);
        const b = mulberry32(1987);
        const c = mulberry32(1988);
        const first = Array.from({ length: 2000 }, () => a());
        expect(Array.from({ length: 2000 }, () => b())).toEqual(first);
        expect(Array.from({ length: 2000 }, () => c())).not.toEqual(first);
        expect(Math.min(...first)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...first)).toBeLessThan(1);
        const mean = first.reduce((sum, v) => sum + v, 0) / first.length;
        expect(mean).toBeGreaterThan(0.45);
        expect(mean).toBeLessThan(0.55);
        // A seed of nothing is still a generator, and each call makes its own.
        const zero = mulberry32(0);
        expect(zero()).not.toBe(zero());
        expect(mulberry32(0)()).toBe(mulberry32(1)());
        expect(mulberry32(7)()).toBe(mulberry32(7)());
    });
});

describe('supernova core: the nebula\'s shells', () => {
    it('spreads the standing shells evenly through their life and wraps them round', () => {
        for (const count of [2, 3, 4, 5]) {
            for (const time of [0, 37.5, 380, 1234.56, 99999.9]) {
                const phases = Array.from({ length: count }, (_, k) => shellPhase(k, count, time));
                for (const phase of phases) {
                    expect(phase).toBeGreaterThanOrEqual(0);
                    expect(phase).toBeLessThan(1);
                }
                const sorted = [...phases].sort((a, b) => a - b);
                for (let i = 1; i < count; i++) expect(sorted[i] - sorted[i - 1]).toBeCloseTo(1 / count, 9);
                // The gap across the wrap is the same as every other.
                expect(sorted[0] + 1 - sorted[count - 1]).toBeCloseTo(1 / count, 9);
            }
        }
        // A shell is born on the cycle's first instant, ages with the clock and is replaced a cycle on.
        expect(shellPhase(0, 4, 0)).toBe(0);
        expect(shellPhase(0, 4, NEBULA.cycle * 0.25)).toBeCloseTo(0.25, 12);
        expect(shellPhase(1, 4, 100)).toBeCloseTo(shellPhase(1, 4, 100 + NEBULA.cycle * 3), 9);
        expect(shellPhase(0, 4, 50, 100)).toBeCloseTo(0.5, 12);
        // No shells asked for is not a division by zero.
        expect(Number.isFinite(shellPhase(0, 0, 12))).toBe(true);
    });

    it('grows a shell from the inner radius to the outer by the same factor every moment', () => {
        expect(shellRadius(0)).toBeCloseTo(NEBULA.inner, 12);
        expect(shellRadius(1)).toBeCloseTo(NEBULA.outer, 9);
        expect(NEBULA.inner).toBeGreaterThan(STAR.radius);
        expect(NEBULA.outer).toBeGreaterThan(NEBULA.inner);
        const step = 0.05;
        const factor = (NEBULA.outer / NEBULA.inner) ** step;
        for (const phase of samples(0, 0.95, 20)) {
            expect(shellRadius(phase + step) / shellRadius(phase)).toBeCloseTo(factor, 9);
        }
    });

    it('lets a shell fade in after it is thrown off and out before it is replaced', () => {
        expect(shellGain(0)).toBe(0);
        expect(shellGain(1)).toBe(0);
        for (const phase of samples(0, 1, 101)) {
            const gain = shellGain(phase);
            expect(gain).toBeGreaterThanOrEqual(0);
            expect(Number.isFinite(gain)).toBe(true);
        }
        for (const phase of samples(0.05, 0.95, 19)) expect(shellGain(phase), `phase ${phase}`).toBeGreaterThan(0);
        // Nothing pops as a shell wraps: both ends are dark, and the way there is gradual.
        expect(shellGain(0.002)).toBeLessThan(0.01);
        expect(shellGain(0.998)).toBeLessThan(0.01);
    });

    it('runs a front out from the star fast, then ever slower, to its reach', () => {
        expect(frontRadius(0)).toBe(STAR.radius);
        expect(frontRadius(-3)).toBe(STAR.radius);
        for (const [reach, tau] of [[21, 1.15], [20, 0.7], [26, 0.8], [16, 1.6]]) {
            const ages = samples(0.01, 8, 80);
            const radii = ages.map((age) => frontRadius(age, reach, tau));
            for (let i = 1; i < radii.length; i++) {
                expect(radii[i]).toBeGreaterThan(radii[i - 1]);
                // It covers less ground in every later step.
                if (i > 1) expect(radii[i] - radii[i - 1]).toBeLessThan(radii[i - 1] - radii[i - 2]);
            }
            expect(radii[radii.length - 1]).toBeLessThan(STAR.radius + reach);
        }
    });

    it('tells when a front passes a radius: the inverse of how far it has run', () => {
        for (const [reach, tau] of [[21, 1.15], [20, 0.7], [25, 0.91]]) {
            for (const age of samples(0.02, 5, 50)) {
                expect(frontPassTime(frontRadius(age, reach, tau), reach, tau)).toBeCloseTo(age, 7);
            }
            for (const radius of samples(STAR.radius + 0.1, STAR.radius + reach - 0.1, 30)) {
                expect(frontRadius(frontPassTime(radius, reach, tau), reach, tau)).toBeCloseTo(radius, 9);
            }
            // It has already passed the star's own surface, and never gets past its reach.
            expect(frontPassTime(STAR.radius, reach, tau)).toBe(0);
            expect(frontPassTime(0.2, reach, tau)).toBe(0);
            expect(frontPassTime(STAR.radius + reach, reach, tau)).toBe(Infinity);
            expect(frontPassTime(STAR.radius + reach + 5, reach, tau)).toBe(Infinity);
        }
        // The defaults of the two agree.
        expect(frontPassTime(frontRadius(1.3))).toBeCloseTo(1.3, 9);
    });

    it('swells a detonation\'s fireball without ever drawing it back in', () => {
        const start = blastRadius(0);
        expect(start).toBeGreaterThan(0);
        expect(start).toBeLessThan(STAR.radius);
        expect(blastRadius(-5)).toBe(start);
        const radii = samples(0, 25, 251).map((age) => blastRadius(age));
        for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
        // It begins where it stood: no jump at the flash.
        expect(blastRadius(1e-6) - start).toBeLessThan(1e-3);
    });

    it('keeps the shell table as large as everything it can hold at once', () => {
        expect(SHELL_ROWS).toBe(STANDING_MAX + FRONT_SLOTS + BLAST_SHELLS);
        const sizes = [SHELL_STRIDE, IMPACT_SLOTS, STREAM_SLOTS, LOOP_SLOTS, FRONT_SLOTS, BLAST_SHELLS, STANDING_MAX];
        for (const size of sizes) {
            expect(Number.isInteger(size)).toBe(true);
            expect(size).toBeGreaterThan(0);
        }
        // No tier asks for more standing shells, or more prominences, than there is room for.
        for (const name of QUALITY_NAMES) {
            expect(QUALITY[name].shells, name).toBeGreaterThanOrEqual(1);
            expect(QUALITY[name].shells, name).toBeLessThanOrEqual(STANDING_MAX);
            expect(QUALITY[name].loops, name).toBeGreaterThanOrEqual(1);
            expect(QUALITY[name].loops, name).toBeLessThanOrEqual(LOOP_SLOTS);
        }
        // A hard drop sends three streams and a clear up to four rows: both fit the pool at once.
        expect(STREAM_SLOTS).toBeGreaterThanOrEqual(3 + 4);
    });
});

describe('supernova core: the star', () => {
    it('heats with the chain, a little less for every step, never past full', () => {
        expect(heatForCombo(0)).toBe(0);
        expect(heatForCombo(-3)).toBe(0);
        let last = 0;
        let lastStep = Infinity;
        for (let combo = 1; combo <= 30; combo++) {
            const heat = heatForCombo(combo);
            expect(heat).toBeGreaterThan(last);
            expect(heat).toBeLessThan(1);
            expect(heat - last).toBeLessThan(lastStep);
            lastStep = heat - last;
            last = heat;
        }
        expect(heatForCombo(100)).toBeGreaterThan(0.999);
        expect(heatForCombo(1e9)).toBeLessThanOrEqual(1);
    });

    it('holds its size until the fall, falls to its smallest at the flash and swells back', () => {
        const birth = 100;
        // Untouched before the fall begins, and at the instant it begins.
        expect(collapseScale(birth - COLLAPSE_HOLD - 5, birth)).toBe(1);
        expect(collapseScale(birth - COLLAPSE_HOLD - 1e-9, birth)).toBe(1);
        expect(collapseScale(birth - COLLAPSE_HOLD, birth)).toBeCloseTo(1, 12);
        expect(collapseScale(birth - COLLAPSE_HOLD + 1e-6, birth)).toBeCloseTo(1, 6);
        // It falls faster and faster.
        const fall = samples(birth - COLLAPSE_HOLD, birth - 1e-9, 60).map((time) => collapseScale(time, birth));
        for (let i = 1; i < fall.length; i++) expect(fall[i]).toBeLessThan(fall[i - 1]);
        for (let i = 2; i < fall.length; i++) expect(fall[i - 1] - fall[i]).toBeGreaterThan(fall[i - 2] - fall[i - 1]);
        // The flash is its smallest moment, with no jump across it.
        const least = collapseScale(birth, birth);
        expect(least).toBe(COLLAPSED_SIZE);
        expect(least).toBeGreaterThan(0);
        expect(least).toBeLessThan(0.5);
        expect(collapseScale(birth - 1e-7, birth)).toBeCloseTo(least, 5);
        expect(collapseScale(birth + 1e-7, birth)).toBeCloseTo(least, 5);
        for (const time of samples(birth - 2, birth + REKINDLE + 2, 400)) {
            expect(collapseScale(time, birth)).toBeGreaterThanOrEqual(least - 1e-12);
        }
        // The newborn star swells back to its size over the rekindling, and stays there.
        const swell = samples(birth, birth + REKINDLE, 80).map((time) => collapseScale(time, birth));
        for (let i = 1; i < swell.length; i++) expect(swell[i]).toBeGreaterThanOrEqual(swell[i - 1]);
        expect(collapseScale(birth + REKINDLE * 0.5, birth)).toBeLessThan(1);
        expect(collapseScale(birth + REKINDLE, birth)).toBeCloseTo(1, 9);
        expect(collapseScale(birth + REKINDLE * 4, birth)).toBeCloseTo(1, 9);
        // A star that has never gone off (its flash far in the past) is whole.
        expect(collapseScale(10, -1000)).toBeCloseTo(1, 9);
    });

    it('falls over whatever hold it is given, along the same curve', () => {
        const birth = 50;
        const short = 0.12;
        // Outside the short fall the star is whole, where the long fall has already begun.
        expect(collapseScale(birth - short - 0.05, birth, short)).toBe(1);
        expect(collapseScale(birth - short - 0.05, birth)).toBeLessThan(1);
        // The same share of the way through either fall is the same size.
        for (const share of samples(0, 1, 11)) {
            expect(collapseScale(birth - short * (1 - share), birth, short))
                .toBeCloseTo(collapseScale(birth - COLLAPSE_HOLD * (1 - share), birth), 9);
            expect(collapseScale(birth - 2 * (1 - share), birth, 2))
                .toBeCloseTo(collapseScale(birth - COLLAPSE_HOLD * (1 - share), birth), 9);
        }
        // The hold changes nothing after the flash.
        expect(collapseScale(birth + 3, birth, short)).toBe(collapseScale(birth + 3, birth));
        // Left out, it is the collapse's own.
        expect(collapseScale(birth - 0.1, birth)).toBe(collapseScale(birth - 0.1, birth, COLLAPSE_HOLD));
    });

    it('lights the pulsar after the flash has cleared and puts it out as the new star kindles', () => {
        for (const age of [-10, -0.01, 0, 0.1, 0.249]) expect(pulsarGain(age), `age ${age}`).toBe(0);
        for (const age of [REKINDLE, REKINDLE + 0.5, REKINDLE * 2, 1000]) expect(pulsarGain(age), `age ${age}`).toBe(0);
        const gains = samples(0, REKINDLE, 261).map((age) => pulsarGain(age));
        for (const gain of gains) {
            expect(gain).toBeGreaterThanOrEqual(0);
            expect(gain).toBeLessThanOrEqual(1);
        }
        expect(pulsarGain(2)).toBeGreaterThan(0.5);
        // It comes up once and goes down once: no flicker.
        const peak = gains.indexOf(Math.max(...gains));
        for (let i = 1; i <= peak; i++) expect(gains[i]).toBeGreaterThanOrEqual(gains[i - 1]);
        for (let i = peak + 1; i < gains.length; i++) expect(gains[i]).toBeLessThanOrEqual(gains[i - 1]);
        // The choreography's order: the fall is short, the rearm outlasts it, the rows outrun a piece.
        expect(COLLAPSE_HOLD).toBeGreaterThan(0);
        expect(NOVA_REARM).toBeGreaterThan(COLLAPSE_HOLD);
        expect(REKINDLE).toBeGreaterThan(COLLAPSE_HOLD);
        expect(ROW_FLIGHT).toBeLessThan(STREAM_FLIGHT);
        expect(RING.radius).toBeGreaterThan(STAR.radius);
    });
});

describe('supernova core: colour', () => {
    it('reads an sRGB hex as scene-linear light', () => {
        expect(linRGB(0x000000)).toEqual([0, 0, 0]);
        expect(linRGB(0xffffff)).toEqual([1, 1, 1]);
        expect(linRGB(0x808080)[0]).toBeCloseTo(0.2158, 3);
        const [r, g, b] = linRGB(0xff8000);
        expect(r).toBe(1);
        expect(g).toBeGreaterThan(0);
        expect(g).toBeLessThan(0.5);
        expect(b).toBe(0);
    });

    it('takes a piece\'s colour as a hex string or a number, and a fallback for anything else', () => {
        const red = pieceColor('#ff0033');
        expect(pieceColor('ff0033')).toEqual(red);
        expect(pieceColor('  #FF0033 ')).toEqual(red);
        expect(pieceColor(0xff0033)).toEqual(red);
        // A fresh array every time: the caller may keep it.
        expect(pieceColor('#ff0033')).not.toBe(pieceColor('#ff0033'));
        const fallback = pieceColor(0xffaa00);
        for (const junk of [null, undefined, '', 'red', '#12', '#12345', '#gggggg', NaN, Infinity, {}, [], true]) {
            expect(pieceColor(junk), String(junk)).toEqual(fallback);
        }
        expect(pieceColor(null, 0x0088ff)).toEqual(pieceColor('#0088ff'));
        expect(pieceColor('nope', 0x0088ff)).not.toEqual(fallback);
    });

    it('normalises a piece\'s colour to its peak and keeps a floor in every channel', () => {
        const colours = [
            ...Object.values(SUPERNOVA_TETROMINOS.colors), '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#808080',
        ];
        for (const hex of colours) {
            const rgb = pieceColor(hex);
            expect(rgb, hex).toHaveLength(3);
            expect(Math.max(...rgb), hex).toBeCloseTo(1, 9);
            for (const channel of rgb) {
                expect(channel, hex).toBeGreaterThanOrEqual(0.05 - 1e-12);
                expect(channel, hex).toBeLessThanOrEqual(1 + 1e-12);
            }
            // Its strongest channel is still its strongest.
            const source = linRGB(Number.parseInt(hex.slice(1), 16));
            expect(rgb.indexOf(Math.max(...rgb)), hex).toBe(source.indexOf(Math.max(...source)));
        }
        // A pure primary still reaches all three channels; a grey is white light.
        const [r, g, b] = pieceColor('#ff0000');
        expect(r).toBeCloseTo(1, 9);
        expect(g).toBeCloseTo(0.05, 9);
        expect(b).toBeCloseTo(0.05, 9);
        expect(pieceColor('#808080')).toEqual([1, 1, 1].map((v) => expect.closeTo(v, 9)));
        // A pale colour is pushed toward its own hue: its weakest channel sinks.
        const pale = pieceColor('#ffd0d0');
        const paleSource = linRGB(0xffd0d0);
        expect(pale[1]).toBeLessThan(paleSource[1]);
        // Black has no hue to keep: it is a dim grey, never a division by zero.
        for (const channel of pieceColor('#000000')) expect(Number.isFinite(channel)).toBe(true);
    });

    it('has a palette for each of five elements, complete and scene-linear', () => {
        expect(SUPERNOVA_PALETTES).toHaveLength(5);
        const names = SUPERNOVA_PALETTES.map((palette) => palette.name);
        expect(names).toEqual(['hydrogen', 'helium', 'carbon', 'oxygen', 'silicon']);
        expect(Object.isFrozen(SUPERNOVA_PALETTES)).toBe(true);
        expect(new Set(PALETTE_KEYS).size).toBe(PALETTE_KEYS.length);
        for (const palette of SUPERNOVA_PALETTES) {
            // Every key the world eases is there, and nothing the world would not ease.
            const eased = Object.keys(palette).filter((key) => key !== 'name');
            expect(eased.sort(), palette.name).toEqual([...PALETTE_KEYS].sort());
            for (const key of PALETTE_KEYS) {
                const rgb = palette[key];
                expect(rgb, `${palette.name}.${key}`).toHaveLength(3);
                for (const channel of rgb) {
                    expect(Number.isFinite(channel), `${palette.name}.${key}`).toBe(true);
                    expect(channel, `${palette.name}.${key}`).toBeGreaterThanOrEqual(0);
                }
            }
            // The sky's own colour is nearly black.
            expect(Math.max(...palette.void), palette.name).toBeLessThan(0.05);
        }
        // No two elements burn alike.
        for (let i = 0; i < SUPERNOVA_PALETTES.length; i++) {
            for (let j = i + 1; j < SUPERNOVA_PALETTES.length; j++) {
                expect(SUPERNOVA_PALETTES[i].starMid).not.toEqual(SUPERNOVA_PALETTES[j].starMid);
                expect(SUPERNOVA_PALETTES[i].gasA).not.toEqual(SUPERNOVA_PALETTES[j].gasA);
            }
        }
    });

    it('carries the palette on through the cycle with time, from where the level starts it', () => {
        const count = SUPERNOVA_PALETTES.length;
        // At the start of a run the level alone decides.
        for (let level = 1; level <= count * 2; level++) {
            expect(paletteDrift(level, 0)).toEqual({ from: (level - 1) % count, to: level % count, blend: 0 });
        }
        // A palette holds, then turns, and has become the next one by the end of its time.
        expect(paletteDrift(1, PALETTE_DRIFT * PALETTE_HOLD).blend).toBe(0);
        let last = 0;
        for (let i = 0; i <= 200; i++) {
            const { from, to, blend } = paletteDrift(1, (PALETTE_DRIFT * 0.9999 * i) / 200);
            expect([from, to]).toEqual([0, 1]);
            expect(blend).toBeGreaterThanOrEqual(last);
            expect(blend - last).toBeLessThan(0.02);
            last = blend;
        }
        expect(last).toBeGreaterThan(0.999);
        expect(paletteDrift(1, PALETTE_DRIFT)).toEqual({ from: 1, to: 2, blend: 0 });
        // The level and the clock add up, and the cycle closes on itself.
        expect(paletteDrift(3, PALETTE_DRIFT * 1.1)).toMatchObject({ from: 3, to: 4 });
        expect(paletteDrift(1, PALETTE_DRIFT * count)).toEqual(paletteDrift(1, 0));
        expect(paletteDrift(count, PALETTE_DRIFT * 0.1)).toMatchObject({ from: count - 1, to: 0 });
        // Slow: a whole turn of the cycle takes minutes, not seconds.
        expect(PALETTE_DRIFT * count).toBeGreaterThan(240);
        // Nonsense reads as the first level at the start of its turn; a given object is reused.
        for (const junk of [undefined, null, NaN, Infinity, -3, 'x']) {
            expect(paletteDrift(junk, junk)).toEqual({ from: 0, to: 1, blend: 0 });
        }
        const out = { from: 9, to: 9, blend: 9 };
        expect(paletteDrift(2, 0, out)).toBe(out);
        expect(out).toEqual({ from: 1, to: 2, blend: 0 });
    });
});

describe('supernova core: where the star hangs', () => {
    it('burns left of centre in a wide frame and climbs to the top of an upright one', () => {
        for (const aspect of [4 / 3, 16 / 10, 16 / 9, 21 / 9, 2.4]) {
            const anchors = starAnchors(aspect);
            expect(anchors.x, `aspect ${aspect}`).toBeLessThan(0.4);
            expect(anchors.y, `aspect ${aspect}`).toBeGreaterThan(0.3);
            expect(anchors.y, `aspect ${aspect}`).toBeLessThan(0.6);
        }
        for (const aspect of [9 / 21, 0.46, 9 / 16]) {
            const anchors = starAnchors(aspect);
            expect(anchors.x, `aspect ${aspect}`).toBeCloseTo(0.5, 9);
            expect(anchors.y, `aspect ${aspect}`).toBeLessThan(0.2);
        }
        // It is drawn smaller where it has only the strip of sky above the card.
        expect(starAnchors(0.46).radius).toBeLessThan(starAnchors(16 / 9).radius);
    });

    it('keeps the whole disc on screen whatever the frame\'s shape', () => {
        for (const aspect of samples(0.4, 2.6, 221)) {
            const anchors = starAnchors(aspect);
            for (const value of Object.values(anchors)) expect(Number.isFinite(value)).toBe(true);
            expect(anchors.radius).toBeGreaterThan(0);
            // The radius is in screen heights: as a share of the width it is radius / aspect.
            expect(anchors.x - anchors.radius / aspect, `aspect ${aspect}`).toBeGreaterThan(0);
            expect(anchors.x + anchors.radius / aspect, `aspect ${aspect}`).toBeLessThan(1);
            expect(anchors.y - anchors.radius, `aspect ${aspect}`).toBeGreaterThan(0);
            expect(anchors.y + anchors.radius, `aspect ${aspect}`).toBeLessThan(1);
        }
    });

    it('answers junk with the wide frame\'s place, never with a number that is not one', () => {
        const wide = starAnchors(16 / 9);
        for (const junk of [NaN, 0, -1, Infinity, -Infinity, undefined, null, 'x', {}]) {
            expect(starAnchors(junk), String(junk)).toEqual(wide);
        }
    });

    it('stands clear of the solo card in a wide frame and above it on a phone', () => {
        for (const aspect of [16 / 9, 2.4]) {
            const anchors = starAnchors(aspect);
            const [card] = fallbackLayout(aspect * 1000, 1000).cards;
            expect(anchors.x + anchors.radius / aspect, `aspect ${aspect}`).toBeLessThan(card.x0);
        }
        for (const aspect of [0.46, 9 / 16]) {
            const anchors = starAnchors(aspect);
            const [card] = fallbackLayout(aspect * 1000, 1000).cards;
            expect(anchors.y + anchors.radius, `aspect ${aspect}`).toBeLessThan(card.y0);
        }
    });

    it('is in one place or the other, never carried across the card between them', () => {
        const places = new Set();
        for (const aspect of samples(0.4, 2.6, 441)) {
            const anchors = starAnchors(aspect);
            const [card] = fallbackLayout(aspect * 1000, 1000).cards;
            const label = `aspect ${aspect.toFixed(3)}`;
            // Beside the card, level with its middle; or above it, on the centre line.
            const beside = anchors.x + anchors.radius / aspect < card.x0;
            const above = anchors.y + anchors.radius < card.y0;
            expect(beside || above, label).toBe(true);
            if (beside) {
                expect(anchors.y, label).toBeGreaterThan(card.y0);
                expect(anchors.y, label).toBeLessThan(card.y1);
            } else expect(anchors.x, label).toBeCloseTo(0.5, 9);
            places.add(beside ? 'beside' : 'above');
            // So no part of its disc is ever behind the card.
            const reach = anchors.radius / aspect;
            const overlaps = anchors.x + reach > card.x0 && anchors.x - reach < card.x1
                && anchors.y + anchors.radius > card.y0 && anchors.y - anchors.radius < card.y1;
            expect(overlaps, label).toBe(false);
        }
        expect([...places].sort()).toEqual(['above', 'beside']);
        // A 2:3 frame, where a blend of the two would cross the card's corner.
        const [card] = fallbackLayout((2 / 3) * 1000, 1000).cards;
        const anchors = starAnchors(2 / 3);
        expect(anchors.x + anchors.radius / (2 / 3)).toBeLessThan(card.x0);
    });
});
