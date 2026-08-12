import { defineConfig } from 'vite';
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
        playground: path.resolve(projectRoot, 'playground.html'),
        'entry-desktop': path.resolve(projectRoot, 'src/entry-desktop.js'),
      },
      output: {
        manualChunks(id) {
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

          if (id.includes('src/themes/base-theme.js')) {
            return 'theme-shared';
          }

          // Group theme runtime by implementation family to reduce chunk graph fragility
          if (id.includes('src/themes/')) {
            if (id.includes('/shared/')) {
              return 'theme-shared';
            }

            const themeMatch = id.match(/src\/themes\/([^/]+)\//);
            if (themeMatch?.[1] && themeMatch[1] !== 'shared') {
              return `theme-${themeMatch[1]}`;
            }
          }

          // Split game modes into individual chunks
          if (id.includes('src/core/game-modes/') && id.includes('Mode.js')) {
            const modeName = id.split('/').pop().replace('.js', '');
            return `mode-${modeName}`;
          }

          // Split rendering engines
          if (id.includes('src/rendering/phaser/')) {
            return 'rendering-phaser';
          }
          if (id.includes('src/rendering/canvas/')) {
            return 'rendering-canvas';
          }

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
