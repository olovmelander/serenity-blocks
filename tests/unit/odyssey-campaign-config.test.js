import { describe, expect, it } from 'vitest';
import { getBotDifficultyConfig } from '../../src/core/ai/bot-difficulty.js';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { VictoryConditionEvaluator } from '../../src/core/odyssey/VictoryConditionEvaluator.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { normalizeOdysseyCompletionStars } from '../../src/core/odyssey/data/difficulty-model.js';
import { LEVEL_CONFIGS, getLevelById } from '../../src/core/odyssey/data/levels.js';
import { ODYSSEY_DUEL_GRAVITY_BY_CHAPTER, ODYSSEY_DUEL_KNOCKOUTS } from '../../src/core/odyssey/data/duel-rules.js';

const DUEL_IDS = [5, 10, 18, 26, 34, 48, 56, 60];
const DUEL_NAMES = ['Cinder', 'Coral', 'Willow', 'Frost', 'Zephyr', 'Nova', 'Prism', 'Neon'];

function cloneLevel(id) {
    return structuredClone(getLevelById(id));
}

describe('Odyssey campaign objectives', () => {
    it('ends every chapter on one increasingly capable rival duel without changing the route', () => {
        const registry = new LevelRegistry();
        const duels = registry.getAllLevels().filter((level) => level.mechanics.versus);

        expect(duels.map((level) => level.id)).toEqual(DUEL_IDS);
        expect(new Set(duels.map((level) => level.mechanics.versus.botName)).size).toBe(8);
        expect(registry.getTotalLevels()).toBe(60);
        expect(registry.getAllLevels().map((level) => level.id))
            .toEqual(Array.from({ length: 60 }, (_, index) => index + 1));
        for (const [index, chapter] of CHAPTER_CONFIGS.entries()) {
            const levels = registry.getLevelsInChapter(chapter.id);
            const duel = levels.find((level) => level.mechanics.versus);

            expect(levels.filter((level) => level.mechanics.versus)).toHaveLength(1);
            expect(duel.id).toBe(DUEL_IDS[index]);
            expect(duel.id).toBe(chapter.levelRange[1]);
            expect(duel.isChapterStart).toBe(false);
            expect(duel.isChapterEnd).toBe(true);
            expect(duel.mechanics.versus).toEqual({
                botDifficulty: index + 1, botName: DUEL_NAMES[index], fragsToWin: ODYSSEY_DUEL_KNOCKOUTS,
            });
            expect(duel.metadata.subtitle).toContain(DUEL_NAMES[index]);
            expect(duel.metadata.description).toContain(DUEL_NAMES[index]);
            expect(duel.victory.primary.type).toBe('frags');
            expect(duel.victory.primary.target).toBe(ODYSSEY_DUEL_KNOCKOUTS);
            expect(duel.victory.failure).toEqual({ type: 'opponent-frags', value: ODYSSEY_DUEL_KNOCKOUTS });
            expect(duel.stars).toEqual({
                one: { frags: 3 },
                two: { frags: 3, maxDeaths: 1 },
                three: { frags: 3, maxDeaths: 0 },
            });
            expect(duel.mechanics.board).toEqual({ columns: 10, rows: 20, startingRows: 0 });
            expect(duel.mechanics.speed).toEqual({
                startLevel: 1, levelProgression: false, fixedDropInterval: ODYSSEY_DUEL_GRAVITY_BY_CHAPTER[index],
            });
            expect(duel.modifiers.active).toEqual([]);
            expect(duel.victory.bonuses).toEqual([]);
            expect(duel.victoryLapPolicy).toBe('none');
            if (index > 0) {
                expect(getBotDifficultyConfig(index + 1).actionIntervalMs)
                    .toBeLessThan(getBotDifficultyConfig(index).actionIntervalMs);
                expect(duel.mechanics.speed.fixedDropInterval)
                    .toBeLessThan(duels[index - 1].mechanics.speed.fixedDropInterval);
            }
        }
        expect(duels.map((level) => level.theme.primary)).toEqual([
            'pyrestorm', 'waves', 'summer', 'winter',
            'rainbow-terraces', 'stellar-velocity', 'chromatic-impasto', 'synthwave-sunset',
        ]);
    });

    it('keeps every challenge whole when the duel moves to the end of its chapter', () => {
        const registry = new LevelRegistry();
        // Slots keep their path positions; the orbs after a duel each step one slot earlier.
        for (const chapter of CHAPTER_CONFIGS) {
            const levels = registry.getLevelsInChapter(chapter.id);
            const positions = levels.map((level) => level.pathPosition);
            expect([...positions].sort((left, right) => left - right)).toEqual(positions);
        }
        expect(getLevelById(4).name).toBe('Crystal Cavern');
        expect(getLevelById(5).name).toBe('Molten Flow');
        expect(getLevelById(55).name).toBe("Indra's Net");
        expect(getLevelById(59).name).toBe('Electric Apex');
        expect(getLevelById(60).name).toBe('Electric Nights');
        expect(getLevelById(5).theme.primary).toBe('pyrestorm');
        expect(getLevelById(4).theme.primary).toBe('bioluminescence');
    });

    it('crowns one solo orb per chapter, never the duel', () => {
        // Audit 2026-10-18: after the rotation the role:'boss' tags crowned the orb before the
        // rival in chapters 1-4, two orbs in 5-7 and none in 8.
        const bosses = LEVEL_CONFIGS.filter((level) => level.chapterBoss);
        expect(bosses.map((level) => level.id)).toEqual([4, 9, 17, 25, 33, 47, 55, 59]);
        expect(new Set(bosses.map((level) => level.chapter)).size).toBe(CHAPTER_CONFIGS.length);
        expect(bosses.some((level) => level.mechanics.versus)).toBe(false);
        expect(bosses.some((level) => DUEL_IDS.includes(level.id))).toBe(false);
    });

    it('makes every no-lap star primary requirement achievable before completion stops play', () => {
        for (const level of LEVEL_CONFIGS.filter((entry) => entry.victoryLapPolicy === 'none')) {
            const { primary } = level.victory;
            const metric = primary.type === 'cascade' ? 'cascades' : primary.type;
            for (const tier of ['one', 'two', 'three']) {
                expect(level.stars[tier][metric], `Level ${level.id}, ${tier} stars`).toBe(primary.target);
            }
        }
        const level = getLevelById(2);
        const evaluator = new VictoryConditionEvaluator();
        for (let sequence = 0; sequence < level.victory.primary.target; sequence++) {
            evaluator.onCascade(3);
        }
        expect(evaluator.evaluate({}, level.victory)).toBe(true);
        expect(evaluator.calculateStars(level.stars, {})).toBe(3);
        expect(getLevelById(52).stars.three.cascades).toBe(22);
        expect(getLevelById(52).stars.three.maxCascadeDepth).toBe(6);
    });

    it('retains meaningful quality tiers and extended showcase goals', () => {
        const solo = getLevelById(12);
        expect(solo.stars.two.time).toBeGreaterThan(solo.stars.three.time);
        expect(getLevelById(32).stars.three.cascades).toBeGreaterThan(getLevelById(32).victory.primary.target);
        expect(getLevelById(55).stars.three.score).toBe(400000);
        expect(getLevelById(59).stars.three.score).toBe(240000);

        const authored = cloneLevel(13);
        authored.stars.three.score = authored.victory.primary.target * 2;
        const before = structuredClone(authored);
        const normalized = normalizeOdysseyCompletionStars(authored);

        expect(authored).toEqual(before);
        expect(normalized.stars.three.score).toBe(authored.victory.primary.target);
        expect(normalized.stars.three.tetrises).toBe(authored.stars.three.tetrises);
        expect(normalized.stars.three.maxCascadeDepth).toBe(authored.stars.three.maxCascadeDepth);
    });

    it('describes the resolved goals instead of stale authored numbers', () => {
        const units = {
            lines: 'lines?', cascade: 'cascades?', score: 'points?', frags: 'knockouts?',
        };
        for (const level of LEVEL_CONFIGS) {
            const { primary, failure } = level.victory;
            const description = [level.metadata.description, primary.description].filter(Boolean).join(' ');
            const pattern = new RegExp(`([\\d,]+) ${units[primary.type]}\\b`, 'g');
            for (const match of description.matchAll(pattern)) {
                expect(Number(match[1].replaceAll(',', '')), `Level ${level.id} goal`).toBe(primary.target);
            }
            const boardHeight = description.match(/(\d+)-row board/);
            if (boardHeight) expect(Number(boardHeight[1])).toBe(level.mechanics.board.rows);
            const deadline = description.match(/(\d+)-second timer/);
            if (deadline) expect(Number(deadline[1])).toBe(failure.value);
        }
        expect(getLevelById(37).metadata.tip).not.toContain('ms');
        expect(getLevelById(51).metadata.tip).not.toContain('ms');
        for (const id of DUEL_IDS) {
            expect(getLevelById(id).metadata.description).toContain('3 knockouts');
            expect(getLevelById(id).metadata.tip).toContain('only resets the round');
        }
    });
});

describe('Odyssey objective validation', () => {
    const registry = new LevelRegistry();

    it('validates the complete campaign and reports malformed primary conditions without throwing', () => {
        expect(registry.validateAll().valid).toBe(true);
        const incomplete = cloneLevel(2);
        delete incomplete.victory.primary;
        expect(registry.validateLevel(incomplete)).toMatchObject({ valid: false });
        expect(registry.validateLevel(null)).toMatchObject({ valid: false });
    });

    it('rejects mismatched duel targets, unsupported bot tiers and reversed death limits', () => {
        const mismatched = cloneLevel(5);
        mismatched.victory.failure.value = 8;
        expect(registry.validateLevel(mismatched).errors)
            .toContain('Duel failure must match its opponent frag target');

        const unsupported = cloneLevel(5);
        unsupported.mechanics.versus.botDifficulty = 11;
        expect(registry.validateLevel(unsupported).errors).toContain('Bot difficulty must be an integer from 1 to 10');

        const reversed = cloneLevel(5);
        reversed.stars.three.maxDeaths = 4;
        expect(registry.validateLevel(reversed).errors).toContain('Duel higher stars cannot allow more deaths');

        const missingDuel = cloneLevel(5);
        delete missingDuel.mechanics.versus;
        expect(registry.validateLevel(missingDuel).errors)
            .toContain('Frag objectives require a bot duel configuration');
    });

    it('rejects unreachable no-lap stars and bonus requirements beyond the authored objectives', () => {
        const extraSequences = cloneLevel(2);
        extraSequences.stars.three.cascades = extraSequences.victory.primary.target + 1;
        expect(registry.validateLevel(extraSequences).errors)
            .toContain('three-star cascades requirement exceeds the completion target without a victory lap');

        const extraBonuses = cloneLevel(1);
        extraBonuses.stars.three.bonuses = extraBonuses.victory.bonuses.length + 1;
        expect(registry.validateLevel(extraBonuses).errors)
            .toContain('three-star bonus requirement exceeds the configured bonuses');
    });
});
