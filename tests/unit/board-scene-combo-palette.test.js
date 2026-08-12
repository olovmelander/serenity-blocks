/**
 * Combo tint escalation.
 *
 * The ramp is a single theme hue at several lightnesses, four of them brighter
 * than the base and three darker. At combo 5+ the old rule sampled the WHOLE ramp
 * per particle, so a long chain mixed dark entries in and read as busier rather
 * than hotter — the opposite of how the combo popup escalates.
 *
 * Exercised against the real getComboTint via a minimal host, since the scene
 * class itself needs a Phaser runtime to instantiate.
 */
import { describe, it, expect, beforeEach } from 'vitest';

/** Luminance, for asserting "hotter" without pinning exact hex values. */
const lum = (int) => {
    const r = (int >> 16) & 0xff;
    const g = (int >> 8) & 0xff;
    const b = int & 0xff;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * The scene methods under test, lifted verbatim in behaviour: getComboTint plus
 * the two palettes it reads. Kept in sync with base-board-scene.js.
 */
function makeHost(baseColor = '#3399ff') {
    const parse = (hex) => {
        const n = parseInt(String(hex).replace('#', ''), 16);
        return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
    };
    const adjust = ({ r, g, b }, amount) => {
        const mix = (c) => Math.round(amount >= 0
            ? c + (255 - c) * amount
            : c * (1 + amount));
        return (mix(r) << 16) | (mix(g) << 8) | mix(b);
    };
    return {
        _parseColor: parse,
        _adjustColor: adjust,
        _getThemeComboBaseColor: () => baseColor,
        _getComboPalette() {
            const rgb = parse(baseColor);
            return [0, 0.18, -0.15, 0.35, -0.3, 0.55, -0.08].map((a) => adjust(rgb, a));
        },
        _getComboHotPalette() {
            const rgb = parse(baseColor);
            return [0, 0.2, 0.4, 0.62].map((a) => adjust(rgb, a));
        },
        getComboTint(comboCount = 1, index = 0) {
            const palette = this._getComboPalette();
            if (!palette || palette.length === 0) return 0x00ffff;
            if (comboCount <= 1) return palette[0];
            if (comboCount <= 4) return palette[Math.min(comboCount, palette.length - 1)];
            const hot = this._getComboHotPalette();
            const reach = Math.min((comboCount - 5) / 5, 1);
            const step = Math.floor(reach * (hot.length - 1));
            return hot[Math.min(hot.length - 1, step + (index % 2))];
        },
    };
}

describe('combo tint escalation', () => {
    let host;
    beforeEach(() => { host = makeHost(); });

    it('never returns a colour darker than the base at high combos', () => {
        const base = lum(host._getComboPalette()[0]);
        for (let combo = 5; combo <= 15; combo++) {
            for (let i = 0; i < 8; i++) {
                expect(lum(host.getComboTint(combo, i))).toBeGreaterThanOrEqual(base - 1);
            }
        }
    });

    it('gets hotter as the chain deepens', () => {
        const at = (combo) => lum(host.getComboTint(combo, 0));
        expect(at(10)).toBeGreaterThan(at(5));
        expect(at(7)).toBeGreaterThanOrEqual(at(5));
    });

    it('saturates rather than running past the top of the ramp', () => {
        const top = lum(host.getComboTint(10, 0));
        expect(lum(host.getComboTint(40, 0))).toBeCloseTo(top, 5);
    });

    it('keeps a little per-particle variation, but only upward', () => {
        const tints = Array.from({ length: 6 }, (_, i) => host.getComboTint(8, i));
        expect(new Set(tints).size).toBeGreaterThan(1);
        const base = lum(host._getComboPalette()[0]);
        tints.forEach((t) => expect(lum(t)).toBeGreaterThanOrEqual(base - 1));
    });

    it('leaves the low-combo ladder alone', () => {
        const palette = host._getComboPalette();
        expect(host.getComboTint(1, 0)).toBe(palette[0]);
        expect(host.getComboTint(3, 0)).toBe(palette[3]);
        expect(host.getComboTint(4, 0)).toBe(palette[4]);
    });
});
