import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { drainSteps, runStepsBreathing } from '../../src/themes/shared/build-steps.js';

/**
 * A world's build as steps (src/themes/shared/build-steps.js): the forest family's worlds built
 * every part in one synchronous task, 0.3-0.5 s of main thread while the theme came in. They now
 * yield between parts, and their themes breathe between the steps.
 */
function* parts(log) {
    log.push('a');
    yield 'a';
    log.push('b');
    yield 'b';
    log.push('c');
    return 'built';
}

describe('drainSteps', () => {
    it('runs every step at once and hands back what the build returns', () => {
        const log = [];
        expect(drainSteps(parts(log))).toBe('built');
        expect(log).toEqual(['a', 'b', 'c']);
    });
});

describe('runStepsBreathing', () => {
    it('runs the same steps in the same order with a pause after each', async () => {
        const log = [];
        let pauses = 0;
        const pause = () => {
            pauses += 1;
            log.push(`pause ${pauses}`);
            return Promise.resolve();
        };
        await expect(runStepsBreathing(parts(log), () => true, pause)).resolves.toBe(true);
        expect(log).toEqual(['a', 'pause 1', 'b', 'pause 2', 'c']);
    });

    it('stops after a pause once the start is no longer current, and runs nothing more', async () => {
        const log = [];
        let current = true;
        const pause = () => {
            current = false;
            return Promise.resolve();
        };
        await expect(runStepsBreathing(parts(log), () => current, pause)).resolves.toBe(false);
        expect(log).toEqual(['a']);
    });

    it('breathes with a macrotask by default (the page draws between steps)', async () => {
        const log = [];
        const order = [];
        // A task queued before the build runs between its first and second step: the steps
        // never share one task.
        setTimeout(() => order.push(`timer saw ${log.join('')}`), 0);
        const done = runStepsBreathing(parts(log)).then(() => order.push('built'));
        await done;
        expect(order[0]).toBe('timer saw a');
        expect(log).toEqual(['a', 'b', 'c']);
    });
});

describe('the forest family builds its worlds in steps', () => {
    const source = (path) => readFileSync(new URL(`../../src/themes/${path}`, import.meta.url), 'utf8');
    const family = ['summer', 'verdant-hills', 'forest', 'golden-forest'];
    it.each(family)('%s: build() drains buildSteps(); the theme breathes', (id) => {
        const world = source(`${id}/${id}-world.js`);
        expect(world).toMatch(/\n {4}build\(\) \{\n {8}drainSteps\(this\.buildSteps\(\)\);\n {8}return this;\n {4}\}/);
        expect(world).toMatch(/\n {4}\* buildSteps\(\) \{/);
        expect(world.match(/yield /g).length).toBeGreaterThanOrEqual(5);
        const theme = source(`${id}/${id}-theme.js`);
        expect(theme).toContain('runStepsBreathing(this.world.buildSteps(), isCurrent)');
        expect(theme).toContain('if (await this.buildScene(current) === false)');
    });
});
