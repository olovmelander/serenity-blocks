import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createChromeClient } from './chrome-mcp-client.mjs';
const args = Object.fromEntries(process.argv.slice(2).map(arg => { const eq = arg.indexOf('='); return [arg.slice(2, eq), arg.slice(eq + 1)]; }));
const directory = path.resolve('reports/wolfhour-overhaul');
mkdirSync(directory, { recursive: true });
const name = args.name || 'prototype-high-t8';
const url = args.url || 'http://localhost:5173/playground.html?effect=wolfhour-composition&t=8&seed=73013&profile=1&trackTimestamp=1&hud=0&orbit=0';
const client = await createChromeClient();
const output = { createdAt: new Date().toISOString(), viewport: [1280, 720], url };
const parse = result => {
    const block = result.content?.find(item => item.type === 'text')?.text || '';
    const match = block.match(/```json\n([\s\S]*?)\n```/);
    return match ? JSON.parse(match[1]) : result;
};
try {
    output.navigate = await client.call('navigate_page', { url, type: 'url', timeout: 120000 });
    output.ready = parse(await client.call('evaluate_script', { function: 'async () => { for(let i=0;i<800;i++){ if(window.__PLAYGROUND_READY__) return {ready:true, backend:window.__PLAYGROUND__?.backend?.()}; if(window.__PLAYGROUND_ERROR__) return {ready:false,error:window.__PLAYGROUND_ERROR__}; await new Promise(r=>setTimeout(r,50)); } return {ready:false}; }' }));
    console.log(JSON.stringify(output.ready));
    if (!output.ready.ready) throw new Error('Playground did not become ready');
    if (args.evaluate) output.evaluate = parse(await client.call('evaluate_script', { function: args.evaluate }));
    await client.call('evaluate_script', { function: 'async () => { await new Promise(r=>setTimeout(r,800)); return true; }' });
    for (let repeat = 1; repeat <= 2; repeat += 1) {
        output[`repeat${repeat}`] = parse(await client.call('evaluate_script', { function: 'async () => { const p=window.__PLAYGROUND__?.profile; if(!p) return null; p.reset(); await new Promise(r=>setTimeout(r,2500)); return p.snapshot(); }' }));
    }
    output.screenshot = await client.call('take_screenshot', { filePath: path.join(directory, `${name}.png`), format: 'png' });
    output.console = await client.call('list_console_messages', { includePreservedMessages: true, pageSize: 200 });
    console.log(JSON.stringify({name, repeat1: output.repeat1, repeat2: output.repeat2, console: output.console}));
} catch (error) { output.error = error.stack; console.error(error); }
finally {
    output.mcpLogs = client.logs;
    writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(output, null, 2));
    await client.close();
}
