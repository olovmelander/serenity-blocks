import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { describe, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'bioluminescence', 'bioluminescence-theme.js');
const harnessPath = path.join(root, 'tests', 'performance', 'benchmark-bioluminescence-phase9.html');
const artDirectionPath = path.join(root, 'docs', 'BIOLUMINESCENCE_ART_DIRECTION.md');
const protocolPath = path.join(root, 'docs', 'BIOLUMINESCENCE_BASELINE_CAPTURE_PROTOCOL.md');

const themeSource = fs.readFileSync(themePath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');
const artDirectionSource = fs.readFileSync(artDirectionPath, 'utf8');
const protocolSource = fs.readFileSync(protocolPath, 'utf8');

describe('Bioluminescence Phase 0: Baseline Lock Artifacts', () => {
    it('includes required art direction and protocol sections', () => {
        assert(artDirectionSource.includes('## 1. Visual Pillars'), 'Art direction is missing visual pillars section');
        assert(artDirectionSource.includes('## 2. Color Palette Lock (Subnautica-Inspired)'), 'Art direction is missing palette lock section');
        assert(protocolSource.includes('## 2. Capture List (The "Subnautica 5")'), 'Protocol is missing Subnautica 5 capture list');
        assert(protocolSource.includes('## 5. Rubric Scoring (Manual Step)'), 'Protocol is missing rubric scoring section');
    });

    it('parses deterministic and fallback flags with explicit boolean handling', () => {
        assert(themeSource.includes('parseBooleanParam(params, key)'), 'Theme is missing boolean query parser');
        assert(themeSource.includes("forceWebGL: this.parseBooleanParam(params, 'forceWebGL')"), 'forceWebGL should use explicit boolean parsing');
        assert(themeSource.includes("fixedDt: Number.isFinite(parsedFixedDt) && parsedFixedDt > 0 ? parsedFixedDt : null"), 'fixedDt parser should validate finite positive values');
    });

    it('exposes required phase0 helper API', () => {
        assert(themeSource.includes('installBaselineHelpers()'), 'Missing baseline helper installer');
        assert(themeSource.includes('captureEventAnchors: (options = {}) => this.captureEventAnchors(options)'), 'Missing captureEventAnchors helper export');
        assert(themeSource.includes('runPresetSweep: (options = {}) => this.runPresetSweep(options)'), 'Missing runPresetSweep helper export');
        assert(themeSource.includes('runSoak: (options = {}) => this.runSoak(options)'), 'Missing runSoak helper export');
        assert(themeSource.includes('runThemeSwitchStress: (options = {}) => this.runThemeSwitchStress(options)'), 'Missing runThemeSwitchStress helper export');
        assert(themeSource.includes('collectEvidence: (options = {}) => this.collectEvidence(options)'), 'Missing collectEvidence helper export');
        assert(themeSource.includes('setDeterministicSeed(seed)'), 'Missing deterministic seed setter');
        assert(themeSource.includes('setFixedTimestep(dtMs)'), 'Missing fixed timestep setter');
    });

    it('connects harness event playback to the real event bus and evidence helper', () => {
        assert(harnessSource.includes("import { eventBus, EVENTS } from '../../src/events/event-bus.js';"), 'Harness should import eventBus/EVENTS symbols');
        assert(harnessSource.includes('eventBus.emit(EVENTS.LINE_CLEAR'), 'Harness should emit LINE_CLEAR events');
        assert(harnessSource.includes('eventBus.emit(EVENTS.COMBO'), 'Harness should emit COMBO events');
        assert(harnessSource.includes('baseline?.collectEvidence'), 'Harness should expose evidence collection flow');
    });
});
