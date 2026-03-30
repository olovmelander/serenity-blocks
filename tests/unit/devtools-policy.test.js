import { describe, expect, it } from 'vitest';
import {
    decideDevToolsOpenRequest,
    getDevToolsOpenStrategy,
    MANAGED_DEVTOOLS_HOST_ROLE,
    shouldAttachSteamOverlayFrameInvalidator,
} from '../../electron/devtools-policy.js';

describe('DevTools policy helpers', () => {
    it('uses a managed host only for smoke mode', () => {
        expect(getDevToolsOpenStrategy({
            isPackagedWindowsApp: true,
            devToolsSmokeMode: false,
        })).toEqual({
            useManagedHost: false,
            openOptions: {
                mode: 'detach',
                activate: true,
                title: 'Serenity Blocks DevTools',
            },
        });

        expect(getDevToolsOpenStrategy({
            isPackagedWindowsApp: false,
            devToolsSmokeMode: true,
        }).useManagedHost).toBe(true);

        expect(getDevToolsOpenStrategy({
            isPackagedWindowsApp: false,
            devToolsSmokeMode: false,
        }).useManagedHost).toBe(false);

        expect(getDevToolsOpenStrategy({
            isPackagedWindowsApp: true,
            devToolsSmokeMode: true,
        }).useManagedHost).toBe(false);
    });

    it('collapses duplicate open requests onto the active pending request id', () => {
        const activePendingRequest = {
            requestId: 'devtools-first-request',
            source: 'before-input-event:F12',
            startedAt: 1000,
        };

        const decision = decideDevToolsOpenRequest({
            activePendingRequest,
            newRequestId: 'devtools-second-request',
            source: 'renderer-button',
            now: 1400,
        });

        expect(decision.type).toBe('reuse');
        expect(decision.request).toBe(activePendingRequest);
        expect(decision.response).toEqual({
            accepted: true,
            requestId: 'devtools-first-request',
            alreadyOpen: false,
        });
        expect(decision.ageMs).toBe(400);
    });

    it('creates a fresh pending request when no open is active', () => {
        const decision = decideDevToolsOpenRequest({
            activePendingRequest: null,
            newRequestId: 'devtools-new-request',
            source: 'renderer-button',
            now: 5000,
        });

        expect(decision.type).toBe('create');
        expect(decision.request).toEqual({
            requestId: 'devtools-new-request',
            source: 'renderer-button',
            startedAt: 5000,
        });
        expect(decision.response).toEqual({
            accepted: true,
            requestId: 'devtools-new-request',
            alreadyOpen: false,
        });
        expect(decision.ageMs).toBe(0);
    });

    it('skips the Steam overlay frame invalidator for the managed DevTools host', () => {
        expect(shouldAttachSteamOverlayFrameInvalidator('main-window')).toBe(true);
        expect(shouldAttachSteamOverlayFrameInvalidator(MANAGED_DEVTOOLS_HOST_ROLE)).toBe(false);
    });
});
