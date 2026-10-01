import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createChromeClient } from '../wolfhour-overhaul/chrome-mcp-client.mjs';

const directory = path.resolve('reports/wolfhour-random-impacts');
mkdirSync(directory, { recursive: true });
const name = process.env.WOLFHOUR_SEQUENCE_NAME || 'shipping-sequence';
const output = { url: process.env.WOLFHOUR_CAPTURE_URL || 'http://127.0.0.1:4178/reports/wolfhour-overhaul/prototype.html?shipping=1&t=8&quality=High', targets: [], screenshots: [] };
let client;
const parse = result => JSON.parse(result.content.find(item => item.type === 'text').text.match(/```json\n([\s\S]*?)\n```/)[1]);
const call = async (tool, args) => {
    const result = await client.call(tool, args);
    if (result.isError) throw new Error(JSON.stringify(result));
    return result;
};
const evaluate = async fn => parse(await call('evaluate_script', { function: fn }));
try {
    client = await createChromeClient();
    await call('navigate_page', { url: output.url, type: 'url', timeout: 120000 });
    output.ready = await evaluate(`async () => {
        for (let i = 0; i < 800; i++) {
            if (window.__PLAYGROUND_ERROR__) throw new Error(window.__PLAYGROUND_ERROR__);
            if (window.__PLAYGROUND_READY__) return { stats: window.__WOLFHOUR_BASELINE__.stats(), adapter: window.__WOLFHOUR_BASELINE__.adapter };
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('Readiness timeout');
    }`);
    output.asset = await evaluate(`async () => {
        const url = document.querySelector('script[type="module"]').src;
        const bytes = await (await fetch(url)).arrayBuffer();
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return { url, sha256: Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('') };
    }`);
    const sideCounts = { left: 0, right: 0 };
    for (let index = 0; index < 12; index++) {
        const target = await evaluate(`async () => {
            const baseline = window.__WOLFHOUR_BASELINE__;
            const theme = baseline.effect.theme;
            while (theme.meteorCrashes.length) theme.releaseMeteorCrash(0, theme.meteorCrashes[0]);
            theme.updateEffects(10);
            baseline.effect.update(8);
            // Identical board-side origin on every pooled spawn recreates the bug.
            if (!theme.createMeteorCrash({ origin: { x: 420, y: 0, z: 100 }, reactive: true })) throw new Error('Spawn rejected');
            const data = theme.meteorCrashes[0].userData;
            const target = { x: data.targetX, y: data.targetY, z: data.targetZ,
                localX: (data.targetX - data.terrainOrigin.x) / data.terrainScaleX,
                launchX: data.startX, launchY: data.startY };
            theme.time = data.startTime + data.duration + 0.01;
            theme.updateMeteorCrashes();
            theme.time += 0.22;
            theme.updateMeteorCrashes();
            theme.celestialSky.update(theme.time, theme.effectState);
            theme.alpineLandscape.update(theme.time, theme.effectState);
            await baseline.renderer.compileAsync(baseline.scene, theme.camera);
            baseline.render();
            await baseline.renderer.resolveTimestampsAsync('render');
            return target;
        }`);
        output.targets.push(target);
        const side = target.localX < 0 ? 'left' : 'right';
        sideCounts[side]++;
        if (sideCounts[side] <= 2) {
            const screenshot = `${name}-${side}-${sideCounts[side]}.png`;
            await call('take_screenshot', { filePath: path.join(directory, screenshot), format: 'png' });
            output.screenshots.push({ index, screenshot });
        }
    }
    if (!sideCounts.left || !sideCounts.right) throw new Error('Repeated origins did not reach both shoulders');
    output.console = await call('list_console_messages', { includePreservedMessages: true, pageSize: 200 });
    output.errors = await evaluate('() => window.__WOLFHOUR_ERRORS__');
    if (output.errors.length || output.console.content.some(item => item.text?.includes('[error]'))) throw new Error('Browser/WebGPU errors');
    console.log(JSON.stringify({ sideCounts, targets: output.targets.map(t => [Math.round(t.x), Math.round(t.y)]), screenshots: output.screenshots }));
} catch (error) {
    output.error = error.stack;
    process.exitCode = 1;
    console.error(error);
} finally {
    writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(output, null, 2));
    await client?.close();
}
