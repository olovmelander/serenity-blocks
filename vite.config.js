import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import replace from '@rollup/plugin-replace';
import path from 'path';
import {
  realpathSync,
  copyFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { createThemeThumbnailAssetPlugin } from './scripts/theme-thumbnail-assets.js';

// Resolve the project root to its real on-disk casing (canonical uppercase drive
// letter on Windows). Without this, launching the dev server from a lowercase
// `c:\...` cwd makes `config.root` lowercase, and Vite's html-proxy load handler
// does a CASE-SENSITIVE `id.replace(config.root)` — so the inline renderer entry
// (`index.html?html-proxy&index=0.js`) 500s with "No matching HTML proxy module
// found", and the desktop shell reports "Renderer entry did not start".
const projectRoot = realpathSync.native(__dirname);

function resolveBuildOutputDir(config) {
  return path.isAbsolute(config.build.outDir)
    ? config.build.outDir
    : path.resolve(config.root, config.build.outDir);
}

function createPrunePlaygroundReferencesPlugin() {
  let outputDir = path.resolve(projectRoot, 'dist');

  return {
    name: 'prune-playground-references',
    apply: 'build',
    configResolved(config) {
      outputDir = resolveBuildOutputDir(config);
    },
    closeBundle() {
      rmSync(path.resolve(outputDir, 'playground-refs'), {
        recursive: true,
        force: true,
      });
    },
  };
}

function createCopyLegalNoticesPlugin() {
  let outputDir = path.resolve(projectRoot, 'dist');

  return {
    name: 'copy-legal-notices',
    apply: 'build',
    configResolved(config) {
      outputDir = resolveBuildOutputDir(config);
    },
    closeBundle() {
      for (const file of ['CREDITS.md', 'README.md']) {
        const src = path.resolve(projectRoot, file);
        const dest = path.resolve(outputDir, file);
        if (!existsSync(src)) {
          throw new Error(
            `[copy-legal-notices] Required repository-root legal source is missing: ${src}`,
          );
        }
        copyFileSync(src, dest);
      }
    },
  };
}

// Theme directory ids, longest first, for the playground-effect → theme chunk rule below.
const themeIdsByLength = readdirSync(path.resolve(projectRoot, 'src/themes'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'shared')
  .map((entry) => entry.name)
  .sort((a, b) => b.length - a.length);

export default defineConfig({
  // Force a canonical-cased root so dev-server module resolution is launch-cwd agnostic.
  root: projectRoot,
  // Harness isolation. The capture/perf harnesses spawn their OWN Vite servers, and two Vite
  // instances sharing node_modules/.vite corrupt the dep-optimizer cache — the interactive
  // playground then hangs forever on 504s with no error in sight. This has cost three
  // debugging sessions ("everything freezes and stops"). Harnesses set VITE_CACHE_DIR to a
  // port-scoped directory; a plain `npm run dev` keeps the default and is never touched.
  cacheDir: process.env.VITE_CACHE_DIR || undefined,
  // Base public path for assets
  base: './',
  // Ensure Phaser renderer flags are set correctly during dev and build
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        'typeof CANVAS_RENDERER': 'false',
        'typeof WEBGL_RENDERER': 'true',
      },
    }),
    createThemeThumbnailAssetPlugin({
      projectRoot,
    }),
    // Playground concept/reference images are local iteration inputs. Vite copies
    // public/ wholesale, so remove this dev-only 17+ MB directory from shipping
    // web/Electron artifacts while keeping it available on the dev server.
    createPrunePlaygroundReferencesPlugin(),
    // Copy top-level legal/credit notices into the build output so they ship with
    // both the web build (dist → GitHub Pages) and the Electron build (which packs
    // dist/**/*). Required so third-party attributions (CC-BY, the SynthCity MIT
    // notice, etc.) actually reach end users.
    createCopyLegalNoticesPlugin(),
  ],

  // Server configuration
  server: {
    port: 5173,  // Standard Vite port (changed from 3000 for Electron compatibility)
    strictPort: true,  // Don't try another port if 5173 is in use
    open: false,  // Don't auto-open browser (we're using Electron)
    host: true,
    watch: {
      ignored: ['**/three_js_example_repo/**', '**/artifacts/**'],
    },
  },

  // Build configuration
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // GitHub Pages' upload action excludes dot-prefixed folders by default.
    // Keep the manifest at a visible path so the startup loader can resolve the
    // hashed desktop entry after deployment.
    manifest: 'manifest.json',
    sourcemap: process.env.VITE_BUILD_SOURCEMAP === 'true',
    // Electron loads the packaged app from file://, so Vite's module-preload
    // rewrites add startup indirection without providing browser-network wins.
    // Disabling them also prevents the generated preload helper from being
    // stranded inside an arbitrary lazy mode chunk.
    modulePreload: false,
    // Optimize chunk size for Phaser 4
    rollupOptions: {
      input: {
        app: path.resolve(projectRoot, 'index.html'),
        // The WebGPU/TSL playground is a DEV tool (`npm run dev:playground`; the capture scripts
        // run it on the dev server). It is no longer a production input: its static graph reaches
        // every effect and, through them, Odyssey chapter modules — and Rollup places a
        // dynamically imported module into the chunk that already imports it statically, so the
        // game's lazy chapter loads resolved to the playground's entry chunk and ran its
        // top-level init ("[playground] init failed", 2026-08-21).
        'entry-desktop': path.resolve(projectRoot, 'src/entry-desktop.js'),
      },
      output: {
        // APP BOOT (2026-08-21): Rollup's function-form manualChunks ABSORBS every unclaimed static
        // dependency of a manual-chunk root into that chunk (rollup node-entry.js
        // addStaticDependenciesToManualChunk). With the directory rules below, tiny shared
        // modules — src/core/constants.js, utils/viewport.js, the Odyssey theme palette behind the
        // custom cursor, the intro config, Vite's own __vitePreload helper — were captured by
        // lazy theme/mode chunks, which welded three (1.75 MB), Phaser (1.6 MB), the Odyssey
        // mode chunk and all 60 theme chunks onto the menu's boot path: dist main's static
        // closure was 75 chunks / 9.5 MB, ~1.7 s of parse+evaluate long tasks before the menu
        // (Electron, production). onlyExplicitManualChunks stops the absorption: modules not
        // named here get Rollup's normal shared-chunk placement. scripts/check-boot-closure.mjs
        // guards the result after every build.
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          const clean = id.split('?')[0];
          const isRuntimeJs = /\.(js|mjs|ts)$/.test(clean);

          // Vite's preload helper must never strand inside a lazy chunk: whoever hosts it is
          // statically imported by EVERY dynamic import site, the entry included.
          if (id.includes('vite/preload-helper')) {
            return 'app-runtime';
          }

          // No explicit 'app-core' list: with absorption off, Rollup's own placement puts every
          // module shared between the boot path and a lazy chunk into a shared chunk that main
          // already imports. (An explicit list was tried: each listed module's unassigned
          // dependencies were then extracted into chunks that import the list back — cycles.)

          // Split Phaser into its own chunk
          if (id.includes('node_modules/phaser')) {
            return 'phaser';
          }

          // Split Three.js into its own chunk (lazy-loaded by themes only)
          if (id.includes('node_modules/three')) {
            return 'three';
          }

          // Keep cross-cutting app/runtime infrastructure out of mode/theme chunks.
          // These modules are consumed by both game modes and themes; if Rollup
          // places them inside a mode chunk, lazy theme imports can form TDZ cycles
          // against packaged Electron builds.
          if (id.includes('src/events/')) {
            return 'app-events';
          }

          if (
            id.includes('src/utils/quality.js')
            || id.includes('src/utils/gpu-context-resilience.js')
            || id.includes('src/utils/helpers.js')
          ) {
            return 'app-runtime';
          }

          // base-theme.js is NOT in theme-shared any more: the shared/** chunk imports three
          // (mrt-blend, shared TSL), and main imports base-theme at boot — naming them together
          // put three back on the boot path. Rollup places base-theme with its importers.

          // Playground effects that a theme imports as its scene builder belong to that theme's
          // chunk (summer → summer-meadow.effect, winter → winter-wonderland.effect, …); left
          // unassigned they become their own chunk that imports the theme back — a cycle.
          if (isRuntimeJs && id.includes('src/playground/effects/')) {
            const effectName = clean.split('/').pop().replace(/.effect.js$/, '');
            const owner = themeIdsByLength.find((themeId) => effectName === themeId || effectName.startsWith(`${themeId}-`));
            if (owner) {
              return `theme-${owner}`;
            }
          }

          // Group theme runtime by implementation family to reduce chunk graph fragility.
          // RUNTIME JS ONLY: the *-theme-icon.png URL modules the Serenity Hub globs must not
          // bind the hub (and through it the boot) to all 60 theme chunks.
          if (isRuntimeJs && id.includes('src/themes/')) {
            if (id.includes('/shared/')) {
              return 'theme-shared';
            }

            const themeMatch = id.match(/src\/themes\/([^/]+)\//);
            if (themeMatch?.[1] && themeMatch[1] !== 'shared') {
              return `theme-${themeMatch[1]}`;
            }
          }

          // Split game modes into individual chunks
          if (isRuntimeJs && id.includes('src/core/game-modes/') && id.includes('Mode.js')) {
            const modeName = clean.split('/').pop().replace('.js', '');
            return `mode-${modeName}`;
          }

          // (No manual 'rendering-phaser' / 'rendering-canvas' chunks any more: main imports the
          // Phaser scenes at boot and draw.js (app-core) imports the canvas utils, so naming them
          // only produced circular chunk imports — Rollup places them with their importers.)

          // Group vendor dependencies
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
    // Increase chunk size warning limit (we know about the large chunks)
    chunkSizeWarningLimit: 1700,
    // Compress assets
    assetsInlineLimit: 4096, // Inline assets smaller than 4kb
    minify: 'esbuild', // Use esbuild for faster builds (terser is slower but smaller)
    target: 'es2020', // Modern browsers for better optimization
    // Strip console.log and debugger statements in production builds
    esbuild: {
      drop: ['debugger'],
      pure: ['console.debug'],
    },
  },

  // Optimize dependencies for faster dev server startup
  optimizeDeps: {
    // Keep dependency crawling scoped to the actual app entry. The vendored
    // Three.js repo ships extra HTML pages that reference optional example deps.
    entries: ['index.html', 'playground.html'],
    include: [
      'phaser',
      'three',
      'three/webgpu',
      'three/tsl',
      'three/addons/tsl/display/BloomNode.js',
      'three/addons/utils/BufferGeometryUtils.js',
      'three/addons/postprocessing/EffectComposer.js',
      'three/addons/postprocessing/RenderPass.js',
      'three/addons/postprocessing/UnrealBloomPass.js',
      'three/addons/postprocessing/ShaderPass.js'
    ],
    // Exclude Electron/Node.js modules from browser bundling
    exclude: ['steamworks.js', 'electron'],
  },

  // Resolve configuration
  resolve: {
    alias: {
      '@': path.resolve(projectRoot, './src'),
      '@core': path.resolve(projectRoot, './src/core'),
      '@rendering': path.resolve(projectRoot, './src/rendering'),
      '@themes': path.resolve(projectRoot, './src/themes'),
      '@ui': path.resolve(projectRoot, './src/ui'),
      '@utils': path.resolve(projectRoot, './src/utils'),
      '@events': path.resolve(projectRoot, './src/events'),
    },
  },

  // Asset handling
  assetsInclude: ['**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.svg', '**/*.mp3', '**/*.wav', '**/*.ogg'],
});
