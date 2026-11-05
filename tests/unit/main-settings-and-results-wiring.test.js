/**
 * Behaviour that lives in src/main.js, which has no importable surface: these run its statements
 * and method bodies, as written there, against small stand-ins.
 *
 * The saved sound set was never applied at launch, so the sound set menu showed one set while the
 * game played Zen. Pausing in the moment between a top-out and the results sheet left the sheet
 * under Settings, and closing Settings hid it: a dead board with no way out.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const main = readFileSync('src/main.js', 'utf8');

/** The body of the brace block that opens at `from`. */
function block(from) {
    const open = main.indexOf('{', from);
    let depth = 0;
    for (let at = open; at < main.length; at += 1) {
        if (main[at] === '{') depth += 1;
        if (main[at] === '}') depth -= 1;
        if (depth === 0) return main.slice(open + 1, at);
    }
    throw new Error('unbalanced block');
}

describe('the saved sound set', () => {
    it('is applied at launch, with the volumes', () => {
        const sync = block(main.indexOf('// Sync volume settings immediately after creation/loading'));
        expect(sync).toContain('setMusicVolume(currentSettings.musicVolume)');
        expect(sync).toContain('setSoundSet(currentSettings.soundSet)');
    });

    it('goes through the manager when it changes, which works before audio has started', () => {
        const at = main.indexOf('if (changes.soundSet) {');
        expect(at).toBeGreaterThan(-1);
        expect(block(at)).toContain('this.soundManager.setSoundSet(settings.soundSet)');
        expect(block(at)).not.toContain('sfxPlayer');
    });

    function themeLinkHandler() {
        const at = main.indexOf('onThemeLinkedSfxChange: (enabled) => {');
        expect(at).toBeGreaterThan(-1);
        // eslint-disable-next-line no-new-func -- runs the handler as src/main.js has it
        return new Function('enabled', 'THEME_SFX_MAP', block(at));
    }

    const app = (activeThemeName) => ({
        themeManager: { activeThemeName },
        settingsManager: { get: () => ({ soundSet: 'Retro' }) },
        soundManager: { setSoundSet: vi.fn() },
    });

    it('takes over from the theme\'s set when Theme-linked SFX is turned off', () => {
        const stub = app('forest');

        themeLinkHandler().call(stub, false, { forest: 'Nebula' });

        expect(stub.soundManager.setSoundSet).toHaveBeenCalledWith('Retro');
    });

    it('gives way to the theme\'s set when Theme-linked SFX is turned on', () => {
        const stub = app('forest');

        themeLinkHandler().call(stub, true, { forest: 'Nebula' });

        expect(stub.soundManager.setSoundSet).toHaveBeenCalledWith('Nebula');
    });

    it('waits for a theme when there is none to link to', () => {
        const stub = app(null);

        themeLinkHandler().call(stub, true, {});

        expect(stub.soundManager.setSoundSet).not.toHaveBeenCalled();
    });
});
