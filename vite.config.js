import { defineConfig } from 'vite';
import replace from '@rollup/plugin-replace';
import path from 'path';

export default defineConfig({
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
  ],

  // Server configuration
  server: {
    port: 5173,  // Standard Vite port (changed from 3000 for Electron compatibility)
    strictPort: true,  // Don't try another port if 5173 is in use
    open: false,  // Don't auto-open browser (we're using Electron)
    host: true,
    watch: {
      ignored: ['**/three_js_example_repo/**'],
    },
  },

  // Build configuration
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: process.env.VITE_BUILD_SOURCEMAP === 'true',
    // Optimize chunk size for Phaser 4
    rollupOptions: {
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

          // Group theme runtime by implementation family to reduce chunk graph fragility
          if (id.includes('src/themes/') && id.includes('-theme.js')) {
            if (id.includes('/shared/')) {
              return 'theme-shared';
            }

            const lowerId = id.toLowerCase();
            if (lowerId.includes('wolfhour') || lowerId.includes('sky-children') || lowerId.includes('cosmic-noir') || lowerId.includes('black-hole') || lowerId.includes('neon-district')) {
              return 'theme-premium';
            }
            if (lowerId.includes('fluid') || lowerId.includes('nebula') || lowerId.includes('chromatic') || lowerId.includes('aether')) {
              return 'theme-sim';
            }
            return 'theme-core';
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
    chunkSizeWarningLimit: 1000,
    // Compress assets
    assetsInlineLimit: 4096, // Inline assets smaller than 4kb
    minify: 'esbuild', // Use esbuild for faster builds (terser is slower but smaller)
    target: 'es2020', // Modern browsers for better optimization
    // Strip console.log and debugger statements in production builds
    esbuild: {
      drop: ['debugger'],
      pure: ['console.log', 'console.debug'],
    },
  },

  // Optimize dependencies for faster dev server startup
  optimizeDeps: {
    // Keep dependency crawling scoped to the actual app entry. The vendored
    // Three.js repo ships extra HTML pages that reference optional example deps.
    entries: ['index.html'],
    include: ['phaser'],
    // Exclude Electron/Node.js modules from browser bundling
    exclude: ['steamworks.js', 'electron'],
  },

  // Resolve configuration
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@core': path.resolve(__dirname, './src/core'),
      '@rendering': path.resolve(__dirname, './src/rendering'),
      '@themes': path.resolve(__dirname, './src/themes'),
      '@ui': path.resolve(__dirname, './src/ui'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@events': path.resolve(__dirname, './src/events'),
    },
  },

  // Asset handling
  assetsInclude: ['**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.svg', '**/*.mp3', '**/*.wav', '**/*.ogg'],
});
