import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  // Base public path for assets
  base: './',

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
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },

  // Optimize dependencies for faster dev server startup
  optimizeDeps: {
    include: ['phaser'],
    // Exclude Electron/Node.js modules from browser bundling
    exclude: ['greenworks', 'electron'],
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

  // Define global constants
  // Phaser 4 is WebGL-only (no Canvas renderer)
  define: {
    'typeof CANVAS_RENDERER': JSON.stringify(false),
    'typeof WEBGL_RENDERER': JSON.stringify(true),
  },
});
