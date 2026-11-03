import { describe, expect, it } from 'vitest';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { getOdysseyLevelBriefing } from '../../src/ui/odyssey/odyssey-level-briefing.js';

// The survival ramp (level design audit 2026-11, phase 3): the pieces fall twice as fast every N seconds of play.
function dropAt(level, ...seconds) {
    const engine = new GameplayHybridEngine();
    engine.configure(structuredClone(level));
    const state = engine.createGameState({ rngSeed: 5 });
    return seconds.map((t) => {
        engine.updateTime(t);
        return Math.round(state.dropInterval * 10) / 10;
    });
}

describe('survival ramp', () => {
    const survival = getLevelById(39);

    it('halves the drop every doubling time from the opening, down to the fastest drop the game has', () => {
        const { fixedDropInterval: opening, doublingSeconds: doubling } = survival.mechanics.speed;
        expect(dropAt(survival, 0, doubling, 2 * doubling, 60 * doubling))
            .toEqual([opening, opening / 2, opening / 4, 10]);
    });

    it('meets the goal no faster than the chapter floor allows (a showcase keeps 95% of 115 ms)', () => {
        const [atGoal] = dropAt(survival, survival.victory.primary.target);
        expect(atGoal).toBeGreaterThanOrEqual(115 * 0.95);
    });

    it('leaves every other orb on its own speed', () => {
        const lines = getLevelById(1);
        const [start, later] = dropAt(lines, 0, 600);
        expect(later).toBe(start);
    });

    it('says so in the briefing, and is the orb\'s only speed driver', () => {
        expect(getOdysseyLevelBriefing(survival).rules).toContain('The pieces fall twice as fast every 2:30.');
        const both = structuredClone(survival);
        both.mechanics.speed.levelProgression = true;
        expect(new LevelRegistry().validateLevel(both).errors)
            .toContain('A speed ramp needs a positive doubling time and no line-based speed-ups');
    });
});
