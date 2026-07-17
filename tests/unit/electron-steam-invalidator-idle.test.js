import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Audit SB-03 (partial, minimized case): the Steam-overlay frame invalidator
// forces compositor frames at 60Hz via webContents.invalidate(). While the
// window is minimized the overlay cannot be used, so the invalidator must not
// force repaints — otherwise a minimized game burns GPU/CPU indefinitely.

describe('Steam overlay frame invalidator idles while minimized (SB-03)', () => {
    const source = readFileSync(
        new URL('../../electron/steam-integration.js', import.meta.url),
        'utf8',
    );

    it('guards the forced invalidate with isMinimized() inside the repaint interval', () => {
        const attachIdx = source.indexOf('function attachSteamOverlayFrameInvalidator');
        expect(attachIdx).toBeGreaterThan(-1);
        const attachBody = source.slice(attachIdx, source.indexOf('\n}', attachIdx));

        const minimizedIdx = attachBody.indexOf('isMinimized()');
        const invalidateIdx = attachBody.indexOf('webContents.invalidate()');
        expect(minimizedIdx).toBeGreaterThan(-1);
        expect(invalidateIdx).toBeGreaterThan(minimizedIdx);
    });
});
