import { batch } from '../bot-ai-audit-2026-11/timing.mjs';
import { GravityBotController, gravityPlanningRate } from '../../src/core/ai/gravity-bot-controller.js';

export function sample(fixtures, repeat) {
    const rows = [];
    for (const kind of ['rubble', 'roof', 'cleanRoof', 'infinity']) {
        const boards = fixtures.filter(f => f.kind === kind);
        if (!boards.length) throw Error('Missing timing fixtures for ' + kind);
        for (const hz of [60, 165]) for (const tier of (repeat ? [10, 3] : [3, 10])) {
            rows.push({ kind, ...batch(boards, tier, gravityPlanningRate(), hz, 1, GravityBotController) });
        }
    }
    for (const kind of ['rubble', 'roof', 'cleanRoof', 'infinity']) {
        const boards = fixtures.filter(f => f.kind === kind);
        for (const hz of [60, 165]) {
            const pair = (repeat ? [true, false] : [false, true]).map(prepare => ({
                kind, ...batch(boards, 10, gravityPlanningRate(), hz, 1, GravityBotController, { prepare }),
            }));
            for (const key of ['choices', 'latencies', 'work']) {
                if (JSON.stringify(pair[0][key]) !== JSON.stringify(pair[1][key])) {
                    throw Error(`Between-tick preparation changed ${key} on ${kind} at ${hz} Hz`);
                }
            }
            rows.push(...pair);
        }
    }
    return rows;
}
