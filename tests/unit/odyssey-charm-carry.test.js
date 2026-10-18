import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    describeOdysseyCharmDraft, describeOdysseyCharmEffect, describeOdysseyMercy, odysseyPanelCharms,
    odysseyUncarriedHelp, renderOdysseyCharmHeader,
} from '../../src/ui/odyssey/odyssey-charm-carry.js';
import { describeOdysseyCharms, odysseyCharmById } from '../../src/core/odyssey/odyssey-charms.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';

describe('Odyssey charm carry: what a charm does to this orb', () => {
    it('speaks in the orb’s own numbers, and says nothing for a charm that changes nothing here', () => {
        expect(describeOdysseyCharmEffect(getLevelById(1), 'keel')).toBe('Clear 17 lines, not 20');
        expect(describeOdysseyCharmEffect(getLevelById(13), 'keel')).toBe('Score 12,750 points, not 15,000');
        expect(describeOdysseyCharmEffect(getLevelById(2), 'keel')).toBe('Trigger 2 cascades, not 3');
        expect(describeOdysseyCharmEffect(getLevelById(5), 'keel')).toBeNull(); // a duel asks knockouts
        expect(describeOdysseyCharmEffect(getLevelById(15), 'long-breath')).toBe('30 more seconds on the clock');
        expect(describeOdysseyCharmEffect(getLevelById(1), 'long-breath')).toBeNull();
        expect(describeOdysseyCharmEffect(getLevelById(6), 'low-tide')).toBe('2 fewer rows of rubble');
        expect(describeOdysseyCharmEffect(getLevelById(3), 'low-tide')).toBe('1 fewer row of rubble');
        expect(describeOdysseyCharmEffect(getLevelById(1), 'low-tide')).toBeNull();
        expect(describeOdysseyCharmEffect(getLevelById(1), 'still-air')).toBe('pieces fall a quarter slower');
        expect(describeOdysseyCharmEffect(getLevelById(1), 'hearth')).toBe('one top-out forgiven');
        expect(describeOdysseyCharmEffect(getLevelById(5), 'hearth')).toBe('one top-out costs no knockout');
        ['kindle', 'swell', 'afterglow', 'nope'].forEach((id) => {
            expect(describeOdysseyCharmEffect(getLevelById(1), id)).toBeNull();
        });
        expect(describeOdysseyCharmEffect(null, 'keel')).toBeNull();
    });

    it('names the charms in the bag, not carried, that would ease this orb', () => {
        const bag = { gathered: ['keel', 'long-breath', 'kindle', 'hearth'], carried: ['keel', 'hearth'] };
        expect(odysseyUncarriedHelp(bag, getLevelById(15))).toEqual([
            { charm: odysseyCharmById('long-breath'), effect: '30 more seconds on the clock' },
        ]);
        expect(odysseyUncarriedHelp(bag, getLevelById(1))).toEqual([]);
        expect(odysseyUncarriedHelp({ gathered: [], carried: [] }, getLevelById(15))).toEqual([]);
        expect(odysseyUncarriedHelp(null, getLevelById(15))).toEqual([]);
    });
});

describe('Odyssey charm carry: the mode’s wiring', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });
    const node = () => ({ textContent: '', title: '' });
    const modeWith = (bag, overrides = {}) => ({
        odysseyState: {
            getCharmBag: () => bag,
            toggleCarriedCharm: vi.fn(() => ({ carried: true, refused: false })),
            takeCharm: vi.fn(() => ({ setDown: 'kindle' })),
            passCharm: vi.fn(() => true),
            getMercyDraft: vi.fn(() => null),
        },
        levelRegistry: { getLevel: (id) => getLevelById(id) },
        _updateLevelPreview: vi.fn(),
        _updateHeaderProgress: vi.fn(),
        ...overrides,
    });

    it('writes the header line: nothing yet, the charms carried, or a bag with nothing carried', () => {
        const empty = node();
        renderOdysseyCharmHeader(modeWith({ gathered: [], carried: [] }), empty);
        expect(empty.textContent).toBe('◇ No charms yet');
        expect(empty.title).toContain('You carry up to three');
        const carried = node();
        renderOdysseyCharmHeader(modeWith({ gathered: ['keel', 'hearth', 'kindle'], carried: ['keel', 'hearth'] }), carried);
        expect(carried.textContent).toBe('◇ Keel · Hearth');
        expect(carried.title.split('\n')).toEqual([
            `◆ Keel: ${odysseyCharmById('keel').line}`,
            `◆ Hearth: ${odysseyCharmById('hearth').line}`,
            `◇ Kindle: ${odysseyCharmById('kindle').line}`,
        ]);
        const setDown = node();
        renderOdysseyCharmHeader(modeWith({ gathered: ['keel', 'hearth'], carried: [] }), setDown);
        expect(setDown.textContent).toBe('◇ Carrying none · 2 in the bag');
        expect(() => renderOdysseyCharmHeader(modeWith({ gathered: [], carried: [] }), null)).not.toThrow();
        vi.stubGlobal('document', { getElementById: vi.fn(() => null) });
        expect(() => renderOdysseyCharmHeader({})).not.toThrow();
    });

    it('hands the panel the bag and a toggle that re-renders the panel and header, with a one-time notice when refused', () => {
        const mode = modeWith({ gathered: ['keel', 'hearth'], carried: ['keel'] });
        const panel = odysseyPanelCharms(mode, 7);
        expect(panel).toMatchObject({ gathered: ['keel', 'hearth'], carried: ['keel'], notice: null });
        panel.onToggle('hearth');
        expect(mode.odysseyState.toggleCarriedCharm).toHaveBeenCalledWith('hearth');
        expect(mode._updateLevelPreview).toHaveBeenCalledWith(7);
        expect(mode._updateHeaderProgress).toHaveBeenCalledOnce();
        expect(odysseyPanelCharms(mode, 7).notice).toBeNull();
        mode.odysseyState.toggleCarriedCharm.mockReturnValue({ carried: false, refused: true });
        panel.onToggle('hearth');
        expect(odysseyPanelCharms(mode, 7).notice).toBe('You carry 3. Set one down to carry another.');
        expect(odysseyPanelCharms(mode, 7).notice).toBeNull(); // read once
        expect(odysseyPanelCharms({ odysseyState: {} }, 7)).toBeNull();
        expect(odysseyPanelCharms(null, 7)).toBeNull();
    });

    it('describes a draft: taking carries the charm and names what was set down; passing settles it', () => {
        const mode = modeWith({ gathered: [], carried: [] });
        const draft = { key: 'chapter:2', charms: describeOdysseyCharms(['low-tide', 'kindle', 'hearth']) };
        const described = describeOdysseyCharmDraft(mode, draft);
        expect(described.charms).toBe(draft.charms);
        expect(described.onTake('low-tide')).toEqual({ taken: true, setDown: odysseyCharmById('kindle') });
        expect(mode.odysseyState.takeCharm).toHaveBeenCalledWith(draft, 'low-tide');
        expect(mode._updateHeaderProgress).toHaveBeenCalledOnce();
        mode.odysseyState.takeCharm.mockReturnValue({ setDown: null });
        expect(described.onTake('hearth')).toEqual({ taken: true, setDown: null });
        mode.odysseyState.takeCharm.mockReturnValue(null);
        expect(described.onTake('hearth')).toBe(false);
        expect(described.onPass()).toBe(true);
        expect(mode.odysseyState.passCharm).toHaveBeenCalledWith(draft);
        expect(describeOdysseyCharmDraft(mode, null)).toBeNull();
        expect(describeOdysseyCharmDraft(mode, { key: 'x', charms: [] })).toBeNull();
    });

    it('rides the road’s mercy on the attempt: a draft, or a word on the bag’s charm that would help here', () => {
        const draft = { key: 'orb:15', charms: describeOdysseyCharms(['long-breath']) };
        const offering = modeWith({ gathered: [], carried: [] });
        offering.odysseyState.getMercyDraft.mockReturnValue(draft);
        const offered = describeOdysseyMercy(offering, { levelId: 15 }, 3);
        expect(offered.charmHint).toBeNull();
        expect(offered.charmDraft.charms).toBe(draft.charms);
        expect(offering.odysseyState.getMercyDraft).toHaveBeenCalledWith(15);

        const holding = modeWith({ gathered: ['long-breath', 'keel', 'kindle'], carried: ['kindle'] });
        expect(describeOdysseyMercy(holding, { levelId: 15 }, 3)).toEqual({
            charmDraft: null,
            charmHint: 'In your bag, not carried: Long Breath (30 more seconds on the clock) · Keel (Clear 36 lines, not 42). '
                + 'Change what you carry on the map.',
        });
        // Not before the third fall, not without anything that would help, not without a known orb.
        expect(describeOdysseyMercy(holding, { levelId: 15 }, 2)).toEqual({ charmDraft: null, charmHint: null });
        expect(describeOdysseyMercy(holding, { levelId: 5 }, 3)).toEqual({ charmDraft: null, charmHint: null }); // a duel
        expect(describeOdysseyMercy(holding, { levelId: 999 }, 3)).toEqual({ charmDraft: null, charmHint: null });
        expect(describeOdysseyMercy(holding, null, undefined)).toEqual({ charmDraft: null, charmHint: null });
    });
});
