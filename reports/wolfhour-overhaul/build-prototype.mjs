import { build } from 'vite';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const outDir = path.resolve(root, 'reports/wolfhour-overhaul/production-prototype');
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
        rollupOptions: { input: path.resolve(root, 'reports/wolfhour-overhaul/prototype.html') },
    },
});
const destination = path.join(outDir, 'textures/2k_moon.jpg');
mkdirSync(path.dirname(destination), { recursive: true });
copyFileSync(path.join(root, 'public/textures/2k_moon.jpg'), destination);
console.log(`Production prototype fixture: ${outDir}`);
