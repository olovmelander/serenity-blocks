import { batch } from '../bot-ai-audit-2026-11/timing.mjs';
import { GravityBotController, gravityPlanningRate } from '../../src/core/ai/gravity-bot-controller.js';

export function sample(fixtures, repeat) {
    const specs = [];
    for (const hz of [60, 165]) for (const count of [1, 3, 4]) specs.push([10, gravityPlanningRate(count), hz, count]);
    for (const hz of [60, 165]) specs.push([8, gravityPlanningRate(2), hz, 1]);
    for (const spec of specs) batch(fixtures.slice(0, 2), ...spec, GravityBotController);
    return (repeat ? specs.reverse() : specs).map(spec => batch(fixtures, ...spec, GravityBotController));
}
