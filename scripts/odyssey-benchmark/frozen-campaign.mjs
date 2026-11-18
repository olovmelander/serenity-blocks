// Replay the campaign measuring instrument, including the rival and the simulation
// it was calibrated with. Only Git, the checkout's installed dependencies and Node are needed.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const revision = '8dc68d825db61bc04e1cfb4e4c5a1f580ea3e138';
const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'serenity-frozen-campaign-'));
const args = process.argv.slice(2);
const inline = args.findIndex(arg => arg.startsWith('--output='));
if (inline >= 0) args.splice(inline, 1, '--output', args[inline].slice('--output='.length));
const out = args.indexOf('--output');
if (out >= 0 && args[out + 1]) args[out + 1] = resolve(args[out + 1]);
else args.push('--output', resolve('artifacts', 'frozen-campaign'));
try {
    execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', root, dir]);
    execFileSync('git', ['sparse-checkout', 'set', '--cone', 'src', 'scripts'], { cwd: dir });
    execFileSync('git', ['checkout', '--quiet', '--detach', revision], { cwd: dir });
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    execFileSync(process.execPath, ['scripts/odyssey-benchmark.mjs', ...args], { cwd: dir, stdio: 'inherit' });
} finally {
    rmSync(dir, { recursive: true, force: true });
}
