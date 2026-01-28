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
  },

  // Build configuration
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    // Optimize chunk size for Phaser 4
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Split Phaser into its own chunk
          if (id.includes('node_modules/phaser')) {
            return 'phaser';
          }

          // Split themes into individual chunks for lazy loading
          if (id.includes('src/themes/') && id.includes('-theme.js')) {
            const themeName = id.split('/').pop().replace('-theme.js', '');
            return `theme-${themeName}`;
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
  },

  // Optimize dependencies for faster dev server startup
  optimizeDeps: {
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
