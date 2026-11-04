import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js', 'src/**/*.test.js'],
    // A hang guard, not a speed budget (those are gates and assertions of their own). The default
    // 5 s sits inside the spread of this suite on CI: tests that take 3.7 s on one runner took 5.1 s
    // on another, and a different one failed main each run.
    testTimeout: 30_000,
  },
});
