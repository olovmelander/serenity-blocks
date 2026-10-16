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
    it('runs the same steps in the same order with a pause before each', async () => {
        const log = [];
        let pauses = 0;
        const pause = () => {
            pauses += 1;
            log.push(`pause ${pauses}`);
            return Promise.resolve();
        };
        await expect(runStepsBreathing(parts(log), () => true, pause)).resolves.toBe(true);
        expect(log).toEqual(['pause 1', 'a', 'pause 2', 'b', 'pause 3', 'c']);
    });

    it('stops after a pause once the start is no longer current, and runs nothing more', async () => {
        const log = [];
        let pauses = 0;
        const pause = () => {
            pauses += 1;
            return Promise.resolve();
        };
        await expect(runStepsBreathing(parts(log), () => pauses < 2, pause)).resolves.toBe(false);
        expect(log).toEqual(['a']);
        // Stopped before the first step: nothing is built at all.
        const none = [];
        await expect(runStepsBreathing(parts(none), () => false, pause)).resolves.toBe(false);
        expect(none).toEqual([]);
    });

    it('breathes with a macrotask by default, before the first step too', async () => {
        const log = [];
        const order = [];
        const done = runStepsBreathing(parts(log)).then(() => order.push('built'));
        // Nothing runs in the caller's task (a world's constructor stays a task of its own)...
        expect(log).toEqual([]);
        // ...and a task queued now runs between the first step and the second: no two share a task.
        setTimeout(() => order.push(`timer saw ${log.join('')}`), 0);
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

    it('disposes the world itself when the start stops between steps, or before the first', async () => {
        const log = [];
        const built = world(log);
        let breaths = 0;
        const counted = () => {
            breaths += 1;
            return Promise.resolve();
        };
        await expect(buildWorldBreathing(built, () => breaths < 2, counted)).resolves.toBe(false);
        expect(log).toEqual(['a']);
        expect(built.disposed).toBe(1);
        const unbuilt = world([]);
        await expect(buildWorldBreathing(unbuilt, () => false, now)).resolves.toBe(false);
        expect(unbuilt.disposed).toBe(1);
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
    const stepped = [
        ...family, 'moonlit-greenhouse', 'high-coast', 'cinder-drift', 'sky-children', 'bioluminescence', 'koi-pond',
        'shifting-sands', 'sakura-twilight',
    ];
    /** A theme's world module (Sakura's carries the short name). */
    const worldOf = (id) => source(`${id}/${id === 'sakura-twilight' ? 'sakura' : id}-world.js`);
    it.each(stepped)('%s: build() drains buildSteps(); the theme owns the world once whole', (id) => {
        const world = worldOf(id);
        expect(world).toMatch(/\n {4}build\(\) \{\n {8}drainSteps\(this\.buildSteps\(\)\);\n {8}return this;\n {4}\}/);
        expect(world).toMatch(/\n {4}\* buildSteps\(\) \{/);
        expect(world.match(/yield /g).length).toBeGreaterThanOrEqual(2);
        const theme = source(`${id}/${id}-theme.js`);
        // Never a half-built this.world between the breaths (a resume or a resize would draw it).
        expect(theme).toContain('if (!(await buildWorldBreathing(world, isCurrent))) return');
        expect(theme).toContain('this.world = world;');
        expect(theme).not.toMatch(/this\.world = new /);
    });
    it.each([...family, 'sakura-twilight'])('%s: its start keeps nothing when stopped mid-build', (id) => {
        expect(source(`${id}/${id}-theme.js`)).toContain('if (await this.buildScene(current) === false)');
    });
});
