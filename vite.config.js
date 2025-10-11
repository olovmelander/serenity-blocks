import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  // Base public path for assets
  base: './',

  // Server configuration
  server: {
    port: 3000,
    open: true,
    host: true,
  },

  // Build configuration
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    // Optimize chunk size for Phaser
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
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
  define: {
    'typeof CANVAS_RENDERER': JSON.stringify(true),
    'typeof WEBGL_RENDERER': JSON.stringify(true),
  },
});
