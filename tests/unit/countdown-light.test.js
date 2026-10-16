/**
 * The countdown's light (src/ui/countdown-light.js), shared by local versus' cover and the online
 * match countdown: one spectrum, one ring colour, per count.
 */
import { describe, expect, it } from 'vitest';
import {
    COUNTDOWN_HUES, countdownGlow, countdownHueKey, paintCountdown,
} from '../../src/ui/countdown-light.js';

function fakeElement() {
    const props = {};
    return { props, style: { setProperty: (k, v) => { props[k] = v; } } };
}

describe('the countdown light', () => {
    it('walks the spectrum down the count and lands on coral for GO', () => {
        expect([5, 4, 3, 2, 1, 0, 'GO'].map(countdownHueKey))
            .toEqual(['high', 'high', 'high', 'two', 'one', 'one', 'go']);
        expect(countdownHueKey('ROUND OVER')).toBe('gold');
        expect(COUNTDOWN_HUES.high.color).toBe('#b8a4ff');
        expect(COUNTDOWN_HUES.two.color).toBe('#9ee8ed');
        expect(COUNTDOWN_HUES.one.color).toBe('#c5f1cf');
        expect(COUNTDOWN_HUES.go.color).toBe('#ffac88');
    });

    it('paints a count: its colour, glow, ring colour and size', () => {
        const el = fakeElement();
        expect(paintCountdown(el, 2)).toBe('two');
        expect(el.style.color).toBe('#9ee8ed');
        expect(el.style.textShadow).toBe(countdownGlow('158, 232, 237'));
        expect(el.props['--cd-rgb']).toBe('158, 232, 237');
        expect(el.style.fontSize).toBe('clamp(108px, 14vw, 156px)');
        paintCountdown(el, 'GO');
        expect(el.props['--cd-rgb']).toBe('255, 172, 136');
        expect(el.style.fontSize).toBe('clamp(88px, 11vw, 128px)');
        paintCountdown(el, 'ROUND OVER');
        expect(el.style.color).toBe('#f3d28d');
        expect(el.style.fontSize).toBe('clamp(44px, 6.4vw, 80px)');
    });
});
