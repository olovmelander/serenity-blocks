import {
    describe, expect, it, vi,
} from 'vitest';
import { OdysseyHUD } from '../../src/ui/odyssey/OdysseyHUD.js';
import { describeOdysseyGemRun, createOdysseyGemRun } from '../../src/core/odyssey/odyssey-gems.js';

function chip() {
    const state = { textContent: '' };
    const pad = { textContent: '', hidden: true };
    return {
        dataset: {},
        disabled: false,
        ariaLabel: '',
        state,
        pad,
        querySelector: (selector) => (selector === '.gem-chip__state' ? state : pad),
    };
}

function hudFixture() {
    const hud = Object.create(OdysseyHUD.prototype);
    hud.gemsSection = { hidden: true, dataset: {} };
    hud.gemsCount = { textContent: '' };
    hud.gemsNote = { hidden: true };
    hud.gemChips = new Map([['tide', chip()], ['still-air', chip()], ['second-breath', chip()]]);
    hud.timeLimit = 180;
    hud.elapsedTime = 1000;
    hud.updateTime = vi.fn();
    return hud;
}

describe('Odyssey HUD gem tray', () => {
    it('shows the wallet and each ability state, and the one-star note once a gem was spent', () => {
        const hud = hudFixture();
        const run = createOdysseyGemRun();
        run.used.add('still-air');
        run.stillAir = { kind: 'slow', until: 30000 };
        run.spent = 1;
        hud.updateGems(describeOdysseyGemRun(run, 2, 17500));
        expect(hud.gemsSection.hidden).toBe(false);
        expect(hud.gemsSection.dataset.empty).toBe('false');
        expect(hud.gemsCount.textContent).toBe('◆ 2');
        const tide = hud.gemChips.get('tide');
        expect(tide.dataset.state).toBe('ready');
        expect(tide.disabled).toBe(false);
        const air = hud.gemChips.get('still-air');
        expect(air.dataset.state).toBe('active');
        expect(air.disabled).toBe(true);
        expect(air.state.textContent).toBe('13 s');
        expect(air.ariaLabel).toContain('(13 s)');
        expect(hud.gemsNote.hidden).toBe(false);

        hud.updateGems(describeOdysseyGemRun(createOdysseyGemRun(), 0));
        expect(hud.gemsSection.dataset.empty).toBe('true');
        expect(hud.gemChips.get('tide').disabled).toBe(true);
        expect(hud.gemsNote.hidden).toBe(true);
        hud.updateGems(null);
        expect(hud.gemsSection.hidden).toBe(true);
    });

    it('labels controller buttons per ability and lengthens the clock for Still Air', () => {
        const hud = hudFixture();
        hud.setGemPadHints({ tide: 'LB', 'second-breath': 'LT' });
        expect(hud.gemChips.get('tide').pad).toEqual({ textContent: 'LB', hidden: false });
        expect(hud.gemChips.get('still-air').pad).toEqual({ textContent: '', hidden: true });
        hud.extendTimeLimit(30);
        expect(hud.timeLimit).toBe(210);
        expect(hud.updateTime).toHaveBeenCalledWith(1000);
        hud.timeLimit = null;
        hud.extendTimeLimit(30);
        expect(hud.timeLimit).toBeNull();
    });
});
