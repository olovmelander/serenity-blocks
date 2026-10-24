/**
 * Build the game for trailer capture and, with --serve, serve it.
 *
 * The capture build is the normal production build plus the console test harness
 * (VITE_DEV_HARNESS=1, src/dev/console-harness.js), whose mock transport lets Online Versus
 * run between windows of one browser. It goes to artifacts/trailer-build (git-ignored), so the
 * real dist/ is left alone.
 *
 * Usage: node scripts/trailer/build.mjs [--serve] [--port=4174] [--skip-build]
 */
/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [key, ...value] = a.slice(2).split('=');
    return [key, value.join('=') || true];
}));
const OUT_DIR = 'artifacts/trailer-build';
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

function run(viteArgs, env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [VITE, ...viteArgs], {
            cwd: ROOT,
            stdio: 'inherit',
            env: {
                ...process.env,
                NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=8192`.trim(),
                ...env,
            },
        });
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`vite exited ${code}`))));
    });
}

if (!args['skip-build']) {
    await run(['build', '--outDir', OUT_DIR, '--emptyOutDir'], { VITE_DEV_HARNESS: '1' });
}
if (args.serve) {
    const port = String(args.port || 4174);
    console.log(`serving ${OUT_DIR} on http://127.0.0.1:${port}`);
    await run(['preview', '--outDir', OUT_DIR, '--port', port, '--strictPort', '--host', '127.0.0.1']);
}
