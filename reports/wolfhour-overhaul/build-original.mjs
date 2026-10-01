import { build } from 'vite';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const outDir = path.resolve(root, 'reports/wolfhour-overhaul/production-original');
if (!outDir.startsWith(path.resolve(root, 'reports/wolfhour-overhaul') + path.sep)) throw new Error('Build output escaped report directory');
await build({
    configFile: false,
    root,
    base: '/',
    publicDir: false,
    build: {
        target: 'esnext',
        outDir,
        emptyOutDir: true,
        rollupOptions: { input: path.resolve(root, 'reports/wolfhour-overhaul/baseline.html') },
    },
});
for (const asset of ['textures/2k_moon.jpg', 'textures/wolfhour/nebula-silver-1.png', 'textures/wolfhour/nebula-silver-2.png', 'textures/wolfhour/nebula-silver-3.png']) {
    const destination = path.join(outDir, asset);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(root, 'public', asset), destination);
}
console.log(`Production original fixture: ${outDir}`);
