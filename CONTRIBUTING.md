# Contributing to Serenity Blocks

Thank you for your interest in improving Serenity Blocks! This guide will help you contribute performance optimizations effectively.

## Performance Optimization Task

Your task is to identify and fix a single, verifiable performance bottleneck related to animations, backgrounds, or theme rendering in this repository. The goal is to improve performance while preserving the artistic style, atmosphere, and gameplay feel. Please follow these steps meticulously:

### 1. Codebase Analysis & Bottleneck Identification

- Systematically analyze code responsible for background rendering, animations, or theme effects.
- Look for inefficient rendering loops, redundant calculations, texture overdraw, or memory-heavy effects.
- Focus on optimizations that reduce frame drops and stutters without changing how the animations and visuals look to the player.
- **Do not attempt to re-optimize anything that has already been documented in the [optimization-reports](optimization-reports/) folder.**

### 2. Detailed Performance Report

Before making changes, provide a concise report including:

- The file and line number(s) where the performance bottleneck is located.
- A clear description of how this code impacts performance (e.g., slow background animation updates, heavy texture processing).
- Your proposed strategy for making it more efficient while preserving the original themes and animation fidelity.

### 3. Targeted Optimization Implementation

- Implement the most direct and clean fix for the identified bottleneck.
- Ensure the background animations and themes look identical to players after the optimization.
- Avoid unrelated changes to gameplay mechanics or non-performance-related code.

### 4. Verification Through Testing & Measurement

To validate your optimization, you must:

- Write a test case or benchmark that highlights the slowdown before your fix and shows improvement after.
- Run the full test suite to ensure no regressions in other systems.
- If possible, provide before/after performance metrics (e.g., FPS stability, reduced memory/CPU/GPU load).

### 5. Documentation

When finished, add a new markdown file in the [optimization-reports](optimization-reports/) folder.

- Each optimization must have its own new report file so previous work is not overwritten.
- Always use the [optimization-reports/template.md](optimization-reports/template.md) file as the base structure for your report.
- Use a clear, descriptive filename that indicates what was optimized. Examples:
  - `rainy-window-optimization.md`
  - `particle-buffer-optimization.md`
  - `wolfhour-canvas-caching.md`

Each report should summarize:

- The bottleneck found.
- The optimization applied.
- The measured improvement.

## Additional Resources

- See [RECOMMENDATIONS.md](RECOMMENDATIONS.md) for general performance optimization recommendations
- Review existing reports in [optimization-reports/](optimization-reports/) to avoid duplicate work and learn from previous optimizations

## Questions?

If you have questions about the contribution process or need clarification on the performance optimization workflow, please open an issue.
