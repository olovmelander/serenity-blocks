import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createChromeClient } from '../wolfhour-overhaul/chrome-mcp-client.mjs';

const directory = path.resolve(process.env.WOLFHOUR_CAPTURE_DIR || 'reports/wolfhour-motion-audit');
const name = process.env.WOLFHOUR_CAPTURE_NAME || 'previous-pass-motion';
const url = process.env.WOLFHOUR_CAPTURE_URL || 'http://127.0.0.1:4180/reports/wolfhour-overhaul/prototype.html?shipping=1&t=8&quality=High';
const params = new URL(url).searchParams;
const startTime = Number(params.get('t') ?? 8);
const frames = 180;
const warmupFrames = 45;
mkdirSync(directory, { recursive: true });
const output = {
    createdAt: new Date().toISOString(),
    description: 'Isolated production ambient motion: fixed60Hz simulation, measured update+render CPU and resolved render GPU queries. RAF intervals include timestamp synchronization and are not gameplay FPS.',
    url,
    requestedParameters: Object.fromEntries(params),
    viewport: (process.env.WOLFHOUR_VIEWPORT || '1280x720').split('x').map(Number),
    startTime,
    frames,
    warmupFrames,
    fixedDeltaSeconds: 1 / 60,
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
const evaluate = async fn => parseEvaluation(await call('evaluate_script', { function: fn }));

// This function executes inside the isolated browser. It deliberately installs no
// continuous animation callback: each invocation ends with a stable scene pose.
function installMotionHarness() {
    const baseline = window.__WOLFHOUR_BASELINE__;
    const theme = baseline?.effect?.theme || baseline?.theme;
    if (!theme || typeof baseline.effect?.update !== 'function') throw new Error('Motion benchmark requires the shipping=1 fixture');
    const params = new URLSearchParams(location.search);
    if (params.has('event')) throw new Error('Motion windows require an ambient fixture without event parameters');
    const pointer = key => {
        const value = Number(params.get(key) || 0);
        return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    };
    theme.pointerX = theme.smoothedPointerX = pointer('pointerX');
    theme.pointerY = theme.smoothedPointerY = pointer('pointerY');
    const vector = value => [value.x, value.y, value.z];
    const snapshot = () => {
        baseline.scene.updateMatrixWorld(true);
        const camera = theme.camera;
        const layers = [];
        for (const [owner, group] of [
            ['sky', theme.celestialSky?.group],
            ['terrain', theme.alpineLandscape?.group],
        ]) {
            for (const mesh of group?.children || []) {
                const matrix = mesh.matrixWorld.elements;
                layers.push({
                    owner,
                    name: mesh.name || mesh.type,
                    localPosition: vector(mesh.position),
                    localRotation: vector(mesh.rotation),
                    worldPosition: [matrix[12], matrix[13], matrix[14]],
                    localScale: vector(mesh.scale),
                });
            }
        }
        const pose = {
            achievedTime: theme.time,
            camera: { position: vector(camera.position), left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom, zoom: camera.zoom },
            pointer: { x: theme.smoothedPointerX, y: theme.smoothedPointerY },
            layers,
        };
        if (!Number.isFinite(pose.achievedTime) || layers.some(layer => !layer.worldPosition.every(Number.isFinite))) {
            throw new Error('Nonfinite motion pose');
        }
        return pose;
    };
    const step = time => {
        baseline.effect.update(time, 1 / 60);
        baseline.render();
    };
    const setTime = async time => {
        step(time);
        await baseline.renderer.resolveTimestampsAsync('render');
        return snapshot();
    };
    const percentile = (values, ratio) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * ratio))] ?? null;
    const summary = values => ({ count: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null });
    async function measure({ startTime = 8, frames = 180, warmupFrames = 45 } = {}) {
        const renderer = baseline.renderer;
        const expectedWidth = renderer.domElement.width;
        const expectedHeight = renderer.domElement.height;
        if (expectedWidth < 1 || expectedHeight < 1 || renderer.getPixelRatio() !== 1) throw new Error('Unexpected motion capture dimensions or DPR');
        for (let index = 0; index < warmupFrames; index++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            step(startTime + index / 60);
            await renderer.resolveTimestampsAsync('render');
        }
        const startPose = await setTime(startTime);
        const gpu = [], cpu = [], intervals = [], content = [], stages = [];
        const poses = [{ frame: 0, ...startPose }];
        let last = null;
        for (let index = 0; index < frames; index++) {
            const now = await new Promise(resolve => requestAnimationFrame(resolve));
            if (last !== null) intervals.push(now - last);
            last = now;
            const requestedTime = startTime + (index + 1) / 60;
            renderer.info.reset();
            const begin = performance.now();
            step(requestedTime);
            cpu.push(performance.now() - begin);
            if (renderer.domElement.width !== expectedWidth || renderer.domElement.height !== expectedHeight) throw new Error('Canvas dimensions changed during motion capture');
            if (Math.abs(theme.time - requestedTime) > 1e-7) throw new Error(`Motion update did not reach requested time ${requestedTime}: ${theme.time}`);
            content.push({ calls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles, points: renderer.info.render.points });
            stages.push({ frame: index + 1, requestedTime, achievedTime: theme.time });
            // One datum per completed query resolve, never repeated timestamp cache reads.
            const duration = await renderer.resolveTimestampsAsync('render');
            if (Number.isFinite(duration) && duration > 0) gpu.push(duration);
            if ((index + 1) % 60 === 0 || index === frames - 1) poses.push({ frame: index + 1, ...snapshot() });
        }
        const uniqueContent = [...new Set(content.map(value => JSON.stringify(value)))].map(value => JSON.parse(value));
        if (!content.every(value => value.calls > 0 && value.triangles > 0)) throw new Error('Motion capture did not draw a complete scene');
        if (uniqueContent.length !== 1) throw new Error(`Ambient draw content changed unexpectedly: ${JSON.stringify(uniqueContent)}`);
        if (gpu.length === 0) throw new Error('No resolved GPU timestamp samples');
        return {
            startTime, endTime: theme.time, warmupFrames,
            dimensions: { width: expectedWidth, height: expectedHeight, pixelRatio: renderer.getPixelRatio() },
            gpuMs: summary(gpu), cpuUpdateRenderMs: summary(cpu), synchronizedFrameMs: summary(intervals),
            samples: { gpu, cpuUpdateRender: cpu, synchronizedIntervals: intervals },
            content, uniqueContent, stages, poses, stats: baseline.stats(),
        };
    }
    window.__WOLFHOUR_MOTION__ = { measure, setTime, snapshot };
    return { stats: baseline.stats(), pointer: { x: theme.smoothedPointerX, y: theme.smoothedPointerY }, hasSkyParallax: !!theme.celestialSky?.applyParallax, hasTerrainParallax: !!theme.alpineLandscape?.applyParallax };
}

try {
    if (!Number.isFinite(startTime)) throw new Error('The t URL parameter must be finite');
    client = await createChromeClient();
    await call('navigate_page', { url, type: 'url', timeout: 120000 });
    output.ready = await evaluate(`async () => {
        for (let index = 0; index < 800; index++) {
            if (window.__PLAYGROUND_ERROR__ || window.__WOLFHOUR_ERRORS__?.length) return { ready: false, error: window.__PLAYGROUND_ERROR__, errors: window.__WOLFHOUR_ERRORS__ };
            if (window.__PLAYGROUND_READY__) return { ready: true, adapter: window.__WOLFHOUR_BASELINE__.adapter, stats: window.__WOLFHOUR_BASELINE__.stats() };
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return { ready: false, errors: window.__WOLFHOUR_ERRORS__ };
    }`);
    if (!output.ready.ready) throw new Error(`Fixture did not become ready: ${JSON.stringify(output.ready)}`);
    const dimensions = output.ready.stats;
    if (dimensions.width !== output.viewport[0] || dimensions.height !== output.viewport[1] || dimensions.pixelRatio !== 1) {
        throw new Error(`Fixture dimensions do not match requested DPR1 viewport: ${JSON.stringify(dimensions)}`);
    }
    output.compiledAssets = await evaluate(`async () => {
        const resources = [...Array.from(document.scripts, script => script.src), ...performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname.endsWith('.js'))];
        const urls = [...new Set(resources)].filter(url => url && new URL(url).origin === location.origin);
        return await Promise.all(urls.map(async url => {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error('Cannot fingerprint compiled asset: ' + url);
            const bytes = await response.arrayBuffer();
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            return { url, bytes: bytes.byteLength, sha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('') };
        }));
    }`);
    output.harness = await evaluate(installMotionHarness.toString());
    output.before = await evaluate(`async () => await window.__WOLFHOUR_MOTION__.setTime(${startTime})`);
    await call('take_screenshot', { filePath: path.join(directory, `${name}-before.png`), format: 'png' });
    for (let repeat = 1; repeat <= 2; repeat++) {
        output[`repeat${repeat}`] = await evaluate(`async () => await window.__WOLFHOUR_MOTION__.measure(${JSON.stringify({ startTime, frames, warmupFrames })})`);
        console.log(`Motion window ${repeat}: ${JSON.stringify({ gpuMs: output[`repeat${repeat}`].gpuMs, cpuUpdateRenderMs: output[`repeat${repeat}`].cpuUpdateRenderMs })}`);
    }
    output.after = await evaluate('() => window.__WOLFHOUR_MOTION__.snapshot()');
    await call('take_screenshot', { filePath: path.join(directory, `${name}-after.png`), format: 'png' });
    output.console = await call('list_console_messages', { includePreservedMessages: true, pageSize: 200 });
    output.errors = await evaluate('() => window.__WOLFHOUR_ERRORS__');
    const consoleText = output.console.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || '';
    if (output.errors?.length || consoleText.includes('[error]')) throw new Error(`Capture contained browser errors: ${JSON.stringify(output.errors)}\n${consoleText}`);
} catch (error) {
    output.error = error.stack;
    process.exitCode = 1;
    console.error(error);
} finally {
    output.mcpLogs = client?.logs || [];
    writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(output, null, 2));
    await client?.close();
}
