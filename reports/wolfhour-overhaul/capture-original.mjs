import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createChromeClient } from './chrome-mcp-client.mjs';

const directory = path.resolve(process.env.WOLFHOUR_CAPTURE_DIR || 'reports/wolfhour-overhaul');
mkdirSync(directory, { recursive: true });
const name = process.env.WOLFHOUR_CAPTURE_NAME || 'original-high-t8';
const url = process.env.WOLFHOUR_CAPTURE_URL || 'http://localhost:5173/reports/wolfhour-overhaul/baseline.html?wolfhourSeed=73013';
const params = new URL(url).searchParams;
const output = {
    createdAt: new Date().toISOString(),
    viewport: (process.env.WOLFHOUR_VIEWPORT || '1280x720').split('x').map(Number),
    url,
    requestedParameters: Object.fromEntries(params),
    seed: Number(params.get('wolfhourSeed') ?? params.get('seed') ?? 73013),
    t: Number(params.get('t') ?? 8),
};
let client;
const parseEvaluation = result => {
    const text = result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || '';
    const json = text.match(/```json\n([\s\S]*?)\n```/);
    if (!json) throw new Error(`No JSON evaluation result: ${text}`);
    return JSON.parse(json[1]);
};
const call = async (tool, args) => {
    const result = await client.call(tool, args);
    if (result.isError) {
        const details = result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n');
        throw new Error(`MCP ${tool} failed: ${details || JSON.stringify(result)}`);
    }
    return result;
};

try {
    client = await createChromeClient();
    const list = await client.rpc('tools/list');
    writeFileSync(path.join(directory, 'chrome-tools.json'), JSON.stringify(list, null, 2));
    output.navigate = await call('navigate_page', { url, type: 'url', timeout: 120000 });
    console.log('Wolfhour isolated fixture opened');
    output.ready = await call('evaluate_script', {
        function: `async () => {
            for (let i = 0; i < 800; i++) {
                if (window.__PLAYGROUND_ERROR__ || window.__WOLFHOUR_ERRORS__?.length) return { ready: false, error: window.__PLAYGROUND_ERROR__, errors: window.__WOLFHOUR_ERRORS__ };
                if (window.__PLAYGROUND_READY__) return { ready: true, adapter: window.__WOLFHOUR_BASELINE__.adapter, stats: window.__WOLFHOUR_BASELINE__.stats() };
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            return { ready: false, errors: window.__WOLFHOUR_ERRORS__ };
        }`,
    });
    const ready = parseEvaluation(output.ready);
    if (!ready.ready) throw new Error(`Fixture did not become ready: ${JSON.stringify(ready)}`);
    if (params.has('pointerX') || params.has('pointerY')) {
        // Frozen previous-pass bundles predate pointer URL support. Apply the same
        // settled pose through their exposed shipping theme without rebuilding them.
        output.pointerPose = parseEvaluation(await call('evaluate_script', {
            function: `() => {
                const params = new URLSearchParams(location.search);
                const baseline = window.__WOLFHOUR_BASELINE__;
                const theme = baseline.theme || baseline.effect?.theme;
                const read = key => { const value = Number(params.get(key) || 0); return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0; };
                // The playground consumes the same pinned pose directly from its URL.
                if (!theme && params.get('shipping') === '0') return { x: read('pointerX'), y: read('pointerY'), stats: baseline.stats() };
                if (!theme) throw new Error('Pointer capture requires an exposed theme or the playground');
                theme.pointerX = theme.smoothedPointerX = read('pointerX');
                theme.pointerY = theme.smoothedPointerY = read('pointerY');
                theme.updateCameraAnimation(0);
                theme.celestialSky?.applyParallax?.(theme.camera);
                theme.alpineLandscape?.applyParallax?.(theme.camera);
                baseline.render();
                return { x: theme.smoothedPointerX, y: theme.smoothedPointerY, stats: baseline.stats() };
            }`,
        }));
    }
    if (ready.stats && Object.hasOwn(ready.stats, 'seed')) output.seed = ready.stats.seed;
    output.t = ready.stats?.time ?? output.t;
    output.quality = ready.stats?.quality || params.get('quality') || 'High';
    output.runtimeFeatures = ready.stats?.runtimeFeatures || null;
    console.log(JSON.stringify(ready));
    output.compiledAssets = parseEvaluation(await call('evaluate_script', {
        function: `async () => {
            const candidates = [
                ...Array.from(document.scripts, script => script.src),
                ...performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname.endsWith('.js')),
            ];
            const urls = [...new Set(candidates)].filter(url => url && new URL(url).origin === location.origin);
            return await Promise.all(urls.map(async url => {
                const response = await fetch(url, { cache: 'no-store' });
                if (!response.ok) throw new Error('Cannot fingerprint compiled asset: ' + url + ' (' + response.status + ')');
                const bytes = await response.arrayBuffer();
                const digest = await crypto.subtle.digest('SHA-256', bytes);
                const sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
                return { url, sha256, bytes: bytes.byteLength };
            }));
        }`,
    }));
    for (let repeat = 1; repeat <= 2; repeat++) {
        const key = `repeat${repeat}`;
        output[key] = await call('evaluate_script', { function: 'async () => await window.__WOLFHOUR_BASELINE__.measure(180)' });
        const measurement = parseEvaluation(output[key]);
        if (!(measurement.frameMs?.count > 0) || !measurement.content?.length) throw new Error(`Invalid measurement window ${repeat}`);
        console.log(`180-frame measurement window ${repeat} completed`);
    }
    output.screenshot = await call('take_screenshot', { filePath: path.join(directory, `${name}.png`), format: 'png' });
    output.console = await call('list_console_messages', { includePreservedMessages: true, pageSize: 200 });
    output.errors = await call('evaluate_script', { function: '() => window.__WOLFHOUR_ERRORS__' });
    const errors = parseEvaluation(output.errors);
    const consoleText = output.console.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || '';
    if (errors?.length || consoleText.includes('[error]')) throw new Error(`Capture contained browser errors: ${JSON.stringify(errors)}\n${consoleText}`);
} catch (error) {
    output.error = error.stack;
    process.exitCode = 1;
    console.error(error);
} finally {
    output.mcpLogs = client?.logs || [];
    writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(output, null, 2));
    await client?.close();
}
