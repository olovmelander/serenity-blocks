import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('reports/wolfhour-motion-audit/baseline-build');
const port = Number(process.env.WOLFHOUR_MOTION_BASELINE_PORT || 4180);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = path.resolve(root, `.${pathname}`);
    if (!target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
        const content = await readFile(target);
        response.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream', 'cache-control': 'no-store' });
        response.end(content);
    } catch { response.writeHead(404).end(); }
}).listen(port, '127.0.0.1', () => console.log(`Previous updated Wolfhour: http://127.0.0.1:${port}/reports/wolfhour-overhaul/prototype.html?shipping=1&t=8&quality=High`));
