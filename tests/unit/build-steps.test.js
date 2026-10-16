import {
    describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import { buildWorldBreathing, drainSteps, runStepsBreathing } from '../../src/themes/shared/build-steps.js';

/**
 * A world's build as steps (src/themes/shared/build-steps.js): the forest family's worlds (and
 * Moonlit Greenhouse's, High Coast's, Cinder Drift's, Sky Children's) built every part in one
 * synchronous task, 0.2-0.5 s of main thread while the theme came in. They now yield between parts,
 * and their themes breathe between the steps, taking the world only once it is whole.
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

describe('buildWorldBreathing', () => {
    const world = (log, { fail = false } = {}) => ({
        disposed: 0,
        build() { drainSteps(this.buildSteps()); },
        * buildSteps() {
            log.push('a');
            yield 'a';
            if (fail) throw new Error('part b broke');
            log.push('b');
        },
        dispose() { this.disposed += 1; },
    });
    const now = () => Promise.resolve();

    it('hands over a whole world, not disposed', async () => {
        const log = [];
        const built = world(log);
        await expect(buildWorldBreathing(built, () => true, now)).resolves.toBe(true);
        expect(log).toEqual(['a', 'b']);
        expect(built.disposed).toBe(0);
    });

    it('disposes the world itself when the start stops between steps', async () => {
        const log = [];
        const built = world(log);
        await expect(buildWorldBreathing(built, () => false, now)).resolves.toBe(false);
        expect(log).toEqual(['a']);
        expect(built.disposed).toBe(1);
    });

    it('disposes the world itself when a part throws half-way, and throws on', async () => {
        const built = world([], { fail: true });
        await expect(buildWorldBreathing(built, () => true, now)).rejects.toThrow(/part b broke/);
        expect(built.disposed).toBe(1);
    });

    it('builds a world without steps at once', async () => {
        const plain = { build: vi.fn(), dispose: vi.fn() };
        await expect(buildWorldBreathing(plain, () => false, now)).resolves.toBe(true);
        expect(plain.build).toHaveBeenCalledOnce();
        expect(plain.dispose).not.toHaveBeenCalled();
    });
});

describe('the stepped themes build their worlds in steps', () => {
    const source = (path) => readFileSync(new URL(`../../src/themes/${path}`, import.meta.url), 'utf8');
    const family = ['summer', 'verdant-hills', 'forest', 'golden-forest'];
    const stepped = [...family, 'moonlit-greenhouse', 'high-coast', 'cinder-drift', 'sky-children'];
    it.each(stepped)('%s: build() drains buildSteps(); the theme owns the world once whole', (id) => {
        const world = source(`${id}/${id}-world.js`);
        expect(world).toMatch(/\n {4}build\(\) \{\n {8}drainSteps\(this\.buildSteps\(\)\);\n {8}return this;\n {4}\}/);
        expect(world).toMatch(/\n {4}\* buildSteps\(\) \{/);
        expect(world.match(/yield /g).length).toBeGreaterThanOrEqual(2);
        const theme = source(`${id}/${id}-theme.js`);
        // Never a half-built this.world between the breaths (a resume or a resize would draw it).
        expect(theme).toContain('if (!(await buildWorldBreathing(world, isCurrent))) return');
        expect(theme).toContain('this.world = world;');
        expect(theme).not.toMatch(/this\.world = new /);
    });
    it.each(family)('%s: its start keeps nothing when stopped mid-build', (id) => {
        expect(source(`${id}/${id}-theme.js`)).toContain('if (await this.buildScene(current) === false)');
    });
});
