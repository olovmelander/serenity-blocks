import { describe, expect, it } from 'vitest';
import { buildLocalMatchConfig } from './local-match-config-modal.js';

// FormData semantics: missing/unchecked fields are absent; checkboxes => 'on';
// disabled controls (e.g. a human slot's bot-difficulty) are absent.

describe('buildLocalMatchConfig — config contract', () => {
    it('builds a standard FFA config (human + bot)', () => {
        const config = buildLocalMatchConfig({
            numPlayers: '2',
            matchMode: 'ffa',
            attackStyle: 'standard',
            endCondition: 'frags',
            endConditionValue: '7',
            startLevel: '1',
            player1Kind: 'human',
            player1Handicap: '2',
            player2Kind: 'bot',
            player2BotDifficulty: '5',
            player2Handicap: '2',
        });

        expect(config.numPlayers).toBe(2);
        expect(config.isInfinityLMS).toBe(false);
        expect(config.endCondition).toBe('frags');
        expect(config.endConditionValue).toBe(7);
        expect(config.startLevel).toBe(1);
        expect(config.attackStyle).toBe('standard');
        expect(config.attackRules).toBe(null);
        // Teams default to own-team (P1=A, P2=B). All-distinct => plain FFA.
        expect(config.isTeamMode).toBe(false);
        expect(config.playerTeams).toEqual([0, 1]);
        expect(config.playerHandicaps).toEqual([2, 2]);
        expect(config.playerSlots).toEqual([
            {
                difficulty: 10, handicap: 2, kind: 'human', name: 'Player 1', slot: 0,
            },
            {
                difficulty: 5, handicap: 2, kind: 'bot', name: 'Bot 2', slot: 1,
            },
        ]);
    });

    it('defaults a human slot difficulty to 10 when the disabled skill field is absent', () => {
        const config = buildLocalMatchConfig({
            numPlayers: '2',
            matchMode: 'ffa',
            endCondition: 'frags',
            endConditionValue: '7',
            startLevel: '1',
            player1Kind: 'human',
            player2Kind: 'human',
        });
        expect(config.playerSlots.map((s) => s.difficulty)).toEqual([10, 10]);
        expect(config.playerHandicaps).toEqual([2, 2]); // default Intermediate when absent
    });

    it('builds an Infinity LMS config and omits FFA-only fields', () => {
        const config = buildLocalMatchConfig({
            numPlayers: '3',
            matchMode: 'infinity-lms',
            infinityMaxRows: '250',
            player1Kind: 'human',
            player2Kind: 'bot',
            player2BotDifficulty: '8',
            player3Kind: 'bot',
            player3BotDifficulty: '3',
        });

        expect(config.isInfinityLMS).toBe(true);
        expect(config.endCondition).toBe('infinity-lms');
        expect(config.infinityMaxRows).toBe(250);
        expect(config).not.toHaveProperty('endConditionValue');
        expect(config).not.toHaveProperty('startLevel');
        expect(config).not.toHaveProperty('levelProgression');
        expect(config.playerSlots).toHaveLength(3);
        // No team fields supplied => each player on its own team => FFA.
        expect(config.playerTeams).toEqual([0, 1, 2]);
        expect(config.isTeamMode).toBe(false);
    });

    it('clamps infinity rows and bot difficulty to valid ranges', () => {
        const config = buildLocalMatchConfig({
            numPlayers: '2',
            matchMode: 'infinity-lms',
            infinityMaxRows: '99999',
            player1Kind: 'bot',
            player1BotDifficulty: '42',
            player2Kind: 'bot',
            player2BotDifficulty: '0',
        });
        expect(config.infinityMaxRows).toBe(1000);
        expect(config.playerSlots[0].difficulty).toBe(10);
        expect(config.playerSlots[1].difficulty).toBe(1);
    });

    it('derives team mode from shared teams (+ hot potato attack style)', () => {
        // Two pairs sharing teams (2v2) => isTeamMode derived true, no toggle.
        const config = buildLocalMatchConfig({
            numPlayers: '4',
            matchMode: 'ffa',
            attackStyle: 'hot_potato',
            endCondition: 'frags',
            endConditionValue: '7',
            startLevel: '1',
            boringRules: 'on',
            player1Kind: 'human',
            player1Team: '0',
            player2Kind: 'bot',
            player2BotDifficulty: '5',
            player2Team: '0',
            player3Kind: 'bot',
            player3BotDifficulty: '5',
            player3Team: '1',
            player4Kind: 'bot',
            player4BotDifficulty: '5',
            player4Team: '1',
        });

        expect(config.isTeamMode).toBe(true);
        expect(config.boringRules).toBe(true);
        expect(config.playerTeams).toEqual([0, 0, 1, 1]);
        expect(config.hotPotato).toBe(true);
        expect(config.potatoDurationMs).toBe(12000);
        expect(config.potatoPenaltyLines).toBe(6);
        expect(config.attackRules).toEqual({
            forceAttackType: 'potato',
            potatoDurationMs: 12000,
            potatoPenaltyLines: 6,
        });
    });

    it('derives team vs FFA from the team distribution', () => {
        const build = (numPlayers, teams) => buildLocalMatchConfig({
            numPlayers: String(numPlayers),
            matchMode: 'ffa',
            endCondition: 'never',
            startLevel: '1',
            ...Object.fromEntries(teams.map((t, i) => [`player${i + 1}Team`, String(t)])),
        });

        // All-distinct teams => FFA (everyone an opponent).
        expect(build(4, [0, 1, 2, 3]).isTeamMode).toBe(false);
        expect(build(4, [0, 1, 2, 3]).playerTeams).toEqual([0, 1, 2, 3]);

        // 3v1 sharing => team mode.
        expect(build(4, [0, 0, 0, 1]).isTeamMode).toBe(true);
        expect(build(4, [0, 0, 0, 1]).playerTeams).toEqual([0, 0, 0, 1]);

        // Everyone on one team is degenerate (no opponents) => falls back to FFA
        // so the round can never hang with zero attack targets.
        expect(build(2, [0, 0]).isTeamMode).toBe(false);
        expect(build(4, [2, 2, 2, 2]).isTeamMode).toBe(false);
    });

    it('maps each attack style to the correct garbage rules', () => {
        const ruleFor = (attackStyle) => buildLocalMatchConfig({
            numPlayers: '2', matchMode: 'ffa', endCondition: 'never', startLevel: '1', attackStyle,
        }).attackRules;
        expect(ruleFor('standard')).toBe(null);
        expect(ruleFor('blind')).toEqual({ forceAttackType: 'blind' });
        expect(ruleFor('full_blind')).toEqual({ forceAttackType: 'full_blind' });
        expect(ruleFor('peaceful')).toEqual({ disableAttacks: true });
    });
});
