import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { OdysseyHUD } from '../../src/ui/odyssey/OdysseyHUD.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { applyOdysseyCharmsToLevel, describeOdysseyCharms } from '../../src/core/odyssey/odyssey-charms.js';
import { createOdysseyCharmRun, describeOdysseyCharmRun } from '../../src/core/odyssey/odyssey-charm-effects.js';

function classes() {
    const values = new Set();
    return {
        add: (...names) => names.forEach((name) => values.add(name)),
        contains: (name) => values.has(name),
        toggle: (name, value) => (value ? values.add(name) : values.delete(name)),
        remove: (...names) => names.forEach((name) => values.delete(name)),
    };
}

function node() {
    const element = {
        children: [],
        dataset: {},
        classList: classes(),
        hidden: false,
        textContent: '',
        style: { setProperty: vi.fn() },
        appendChild: vi.fn((child) => { element.children.push(child); return child; }),
        replaceChildren: vi.fn(() => { element.children = []; }),
    };
    return element;
}

function hudWithCharms() {
    const hud = Object.create(OdysseyHUD.prototype);
    hud.container = node();
    vi.stubGlobal('document', { createElement: () => node() });
    hud._createCharmsSection();
    return hud;
}

describe('Odyssey HUD: the charms held', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('lists the charms held with their lines, marks a spent Hearth, and hides without any', () => {
        const hud = hudWithCharms();
        expect(hud.charmsSection.hidden).toBe(true);
        expect(hud.container.children).toContain(hud.charmsSection);
        const run = createOdysseyCharmRun(['keel', 'hearth']);
        hud.updateCharms(describeOdysseyCharmRun(run));
        expect(hud.charmsSection.hidden).toBe(false);
        const chips = hud.charmsList.children;
        expect(chips.map((chip) => chip.children[0].textContent)).toEqual(['Keel', 'Hearth']);
        expect(chips.map((chip) => chip.dataset.charm)).toEqual(['keel', 'hearth']);
        expect(chips.map((chip) => chip.dataset.spent)).toEqual(['false', 'false']);
        expect(chips[0].title).toBe(describeOdysseyCharms(['keel'])[0].line);
        expect(chips[0].ariaLabel).toBe(`Keel: ${describeOdysseyCharms(['keel'])[0].line}`);
        run.hearthUsed = true;
        hud.updateCharms(describeOdysseyCharmRun(run));
        expect(hud.charmsList.children).toHaveLength(2);
        const hearth = hud.charmsList.children[1];
        expect(hearth.dataset.spent).toBe('true');
        expect(hearth.children.map((child) => child.textContent)).toEqual(['Hearth', 'spent']);
        expect(hearth.ariaLabel).toContain('spent this orb');
        hud.updateCharms({ charms: [] });
        expect(hud.charmsSection.hidden).toBe(true);
        hud.updateCharms(null);
        expect(hud.charmsSection.hidden).toBe(true);
    });

    it('shows the orb as the charms make it: a Long Breath deadline, or the authored orb when none is given', () => {
        const hud = Object.create(OdysseyHUD.prototype);
        hud.metrics = {
            lines: 0, score: 0, frags: 0, bonuses: 0, deaths: 0,
        };
        hud.completedBonuses = new Set();
        hud.elapsedTime = 0;
        ['chapterDisplay', 'levelNameDisplay', 'levelBadge', 'guideText', 'guide', 'timeLabel']
            .forEach((name) => { hud[name] = {}; });
        hud.levelRules = node();
        ['_updateObjectiveDisplay', '_updateBonusesDisplay', '_updateStarRequirements', 'resetMetrics']
            .forEach((name) => { hud[name] = vi.fn(); });
        vi.stubGlobal('document', { createElement: () => node() });
        vi.spyOn(console, 'log').mockImplementation(() => {});

        const authored = getLevelById(15);
        expect(authored.victory.failure).toMatchObject({ type: 'time', value: 270 });
        const played = applyOdysseyCharmsToLevel(authored, ['long-breath', 'keel']);
        hud.setLevel(15, played);
        expect(hud.levelConfig).toBe(played);
        expect(hud.timeLimit).toBe(300);
        expect(hud.timeLabel.textContent).toBe('Time left');
        expect(hud.levelRules.children.map((item) => item.textContent).join(' ')).toContain('5:00');
        expect(hud.levelBadge.textContent).toBe('Orb 15');

        hud.setLevel(15);
        expect(hud.levelConfig).toBe(authored);
        expect(hud.timeLimit).toBe(270);
    });
});
