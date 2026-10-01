/** Dedicated preview: shared workspace edits must not reload a measured frame. */
import { createServer } from 'vite';

const server = await createServer({
    configFile: 'vite.config.js',
    cacheDir: 'node_modules/.vite-cosmic-noir-polish-5177',
    server: {
        port: 5177,
        strictPort: true,
        host: '127.0.0.1',
        hmr: false,
        open: false,
    },
});
await server.listen();
server.printUrls();
