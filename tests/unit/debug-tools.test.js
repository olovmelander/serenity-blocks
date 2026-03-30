import { describe, expect, it } from 'vitest';
import {
    buildDebugToolsStatus,
    getPrimaryDebugMenuLabel,
    normalizeRendererReportedLog,
    resolveDevToolsFrontendUrl,
    resolveRendererDebugTarget,
} from '../../electron/debug-tools.js';

describe('Debug tools helpers', () => {
    it('selects the main renderer page target and resolves a relative frontend URL', () => {
        const targets = [
            {
                id: 'worker-1',
                type: 'service_worker',
                url: 'file:///ignored-worker.js',
            },
            {
                id: 'page-secondary',
                type: 'page',
                url: 'file:///C:/Serenity/secondary.html',
                devtoolsFrontendUrl: '/devtools/inspector.html?ws=127.0.0.1:9229/devtools/page/page-secondary',
            },
            {
                id: 'page-main',
                type: 'page',
                url: 'file:///C:/Serenity/dist/index.html',
                devtoolsFrontendUrl: '/devtools/inspector.html?ws=127.0.0.1:9229/devtools/page/page-main',
            },
        ];

        const target = resolveRendererDebugTarget({
            targets,
            mainWindowUrl: 'file:///C:/Serenity/dist/index.html',
        });

        expect(target?.id).toBe('page-main');
        expect(resolveDevToolsFrontendUrl({
            target,
            remoteDebuggingUrl: 'http://127.0.0.1:9229',
        })).toBe(
            'http://127.0.0.1:9229/devtools/inspector.html?ws=127.0.0.1:9229/devtools/page/page-main',
        );
    });

    it('falls back to the first page target and preserves an absolute frontend URL', () => {
        const target = resolveRendererDebugTarget({
            targets: [
                {
                    id: 'page-first',
                    type: 'page',
                    url: 'file:///fallback.html',
                    devtoolsFrontendUrl: 'http://127.0.0.1:9229/devtools/inspector.html?ws=fallback',
                },
            ],
            mainWindowUrl: 'file:///missing.html',
        });

        expect(target?.id).toBe('page-first');
        expect(resolveDevToolsFrontendUrl({
            target,
            remoteDebuggingUrl: 'http://127.0.0.1:9229',
        })).toBe('http://127.0.0.1:9229/devtools/inspector.html?ws=fallback');
    });

    it('builds remote-first packaged debug status with main inspector details', () => {
        const status = buildDebugToolsStatus({
            isPackagedWindowsApp: true,
            remoteDebuggingPort: '9229',
            remoteDebuggingUrl: 'http://127.0.0.1:9229',
            mainInspectorPort: '9230',
            mainInspectorUrl: 'ws://127.0.0.1:9230/abcd',
            lastRendererDebuggerUrl: 'http://127.0.0.1:9229/devtools/inspector.html?ws=test',
            logPaths: {
                main: '/tmp/main-debug.jsonl',
                renderer: '/tmp/renderer-debug.jsonl',
            },
        });

        expect(status.packagedExternalDebugger).toBe(true);
        expect(status.embeddedDevToolsSupported).toBe(false);
        expect(status.rendererDebugger).toEqual({
            mode: 'external',
            enabled: true,
            port: 9229,
            baseUrl: 'http://127.0.0.1:9229',
            jsonListUrl: 'http://127.0.0.1:9229/json/list',
            lastOpenedUrl: 'http://127.0.0.1:9229/devtools/inspector.html?ws=test',
        });
        expect(status.mainInspector.enabled).toBe(true);
        expect(status.mainInspector.port).toBe(9230);
        expect(status.mainInspector.attachHint).toBe('Attach Chrome/Edge or VS Code to 127.0.0.1:9230.');
        expect(status.logPaths.renderer).toBe('/tmp/renderer-debug.jsonl');
    });

    it('uses a packaged-specific menu label for the primary debug action', () => {
        expect(getPrimaryDebugMenuLabel(true)).toBe('Open Renderer Debugger');
        expect(getPrimaryDebugMenuLabel(false)).toBe('Toggle Developer Tools');
    });

    it('normalizes reported renderer logs and preserves structured fields', () => {
        const normalized = normalizeRendererReportedLog({
            sourceProcess: 'preload',
            level: 'warn',
            message: 'Renderer bridge failed',
            timestamp: '2026-03-20T08:00:00.000Z',
            stack: 'Error: bridge failed',
            details: {
                channel: 'desktop:get-debug-tools-status',
            },
            args: ['Renderer bridge failed', { retryable: true }],
        });

        expect(normalized).toEqual({
            sourceProcess: 'preload',
            level: 'warn',
            message: 'Renderer bridge failed',
            timestamp: '2026-03-20T08:00:00.000Z',
            stack: 'Error: bridge failed',
            details: {
                channel: 'desktop:get-debug-tools-status',
            },
            args: ['Renderer bridge failed', { retryable: true }],
        });
    });
});
