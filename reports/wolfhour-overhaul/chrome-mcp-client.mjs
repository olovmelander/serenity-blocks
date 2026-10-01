import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export async function createChromeClient() {
    const viewport = process.env.WOLFHOUR_VIEWPORT || '1280x720';
    const executable = process.env.WOLFHOUR_MCP_BIN;
    if (!executable) {
        throw new Error('Set WOLFHOUR_MCP_BIN to the chrome-devtools-mcp CLI file (validated with 1.7.0). See this report directory\'s README.md.');
    }
    const child = spawn(process.execPath, [executable, '--headless', '--isolated', `--viewport=${viewport}`, '--no-usage-statistics', '--no-performance-crux', '--allowUnrestrictedPaths', '--chromeArg=--force-high-performance-gpu', '--chromeArg=--disable-background-timer-throttling', '--chromeArg=--disable-renderer-backgrounding'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const pending = new Map();
    const logs = [];
    let id = 0;
    child.stderr.on('data', chunk => logs.push(String(chunk)));
    createInterface({ input: child.stdout }).on('line', line => {
        let value;
        try { value = JSON.parse(line); } catch { logs.push(line); return; }
        const waiter = pending.get(value.id);
        if (waiter) {
            pending.delete(value.id);
            clearTimeout(waiter.timer);
            if (value.error) waiter.reject(new Error(JSON.stringify(value.error)));
            else waiter.resolve(value.result);
        }
    });
    const rpc = (method, params = {}) => new Promise((resolve, reject) => {
        const serial = ++id;
        const timer = setTimeout(() => { pending.delete(serial); reject(new Error(`Timeout: ${method}`)); }, 150000);
        pending.set(serial, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: serial, method, params })}\n`);
    });
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'wolfhour-isolated-validation', version: '1.0' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    return {
        rpc,
        logs,
        call: (name, args = {}) => rpc('tools/call', { name, arguments: args }),
        async close() { child.stdin.end(); await new Promise(resolve => setTimeout(resolve, 600)); child.kill(); },
    };
}
