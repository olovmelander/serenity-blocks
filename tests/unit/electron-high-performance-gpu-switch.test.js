import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const entrypoints = [
    ['production', new URL('../../electron/main.js', import.meta.url)],
    ['minimal', new URL('../../electron/main-minimal.js', import.meta.url)],
];

const supportedSwitch = "app.commandLine.appendSwitch('force_high_performance_gpu');";
const unsupportedSwitch = 'force-high-performance-gpu';

describe('Electron high-performance GPU preference', () => {
    it.each(entrypoints)(
        'uses the supported switch before app readiness in the %s entrypoint',
        (_, url) => {
            const source = readFileSync(url, 'utf8');
            const switchIndex = source.indexOf(supportedSwitch);
            const readyIndex = source.indexOf('app.whenReady');

            expect(switchIndex).toBeGreaterThanOrEqual(0);
            expect(source).not.toContain(unsupportedSwitch);
            expect(readyIndex).toBeGreaterThan(switchIndex);
        }
    );
});
