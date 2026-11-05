import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../electron/main.js', import.meta.url), 'utf8');

describe('Electron power event forwarding', () => {
    it('forwards the CPU limit from Electron 44 single-argument event details', () => {
        const powerMonitor = new EventEmitter();
        const emitRuntimeEvent = vi.fn();
        const start = source.indexOf('// Power monitor → renderer');
        const end = source.indexOf('// Load Steam AFTER', start);
        runInNewContext(source.slice(start, end), { powerMonitor, emitRuntimeEvent });

        powerMonitor.emit('speed-limit-change', { limit: 75 });
        expect(emitRuntimeEvent).toHaveBeenLastCalledWith('power-speed-limit-change', { limit: 75 });
        powerMonitor.emit('speed-limit-change', { limit: 100 });
        expect(emitRuntimeEvent).toHaveBeenLastCalledWith('power-speed-limit-change', { limit: 100 });
    });
});
