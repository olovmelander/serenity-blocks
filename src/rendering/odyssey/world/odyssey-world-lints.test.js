import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SOURCE LINT — vertex-stage texture reads must pin their LOD with `.level(...)`.
 *
 * WGSL forbids implicit-LOD `textureSample` in the vertex stage, and three r181 auto-injects
 * a level for exactly three internal cases (EnvironmentNode ×2 and Background) — never for a
 * user heightfield displacement. The failure is not a build error: the WebGPU backend emits a
 * validation error at PIPELINE CREATION, on the GPU lane, after every unit test has passed.
 * This is the trap the One World plan (§ Wave 2) said to lint rather than re-learn.
 *
 * The check runs on SOURCE, with one refinement that matters: a `texture(...)` read that
 * feeds `positionNode` through an intermediate `const` (the cloud deck's `billow` is exactly
 * this) is still a vertex-stage read. So the lint resolves identifiers referenced by a
 * `positionNode` statement transitively through same-file `const` declarations, and demands
 * `.level(` on every texture call in that closure. Fragment-stage reads (colorNode/opacityNode
 * chains) legitimately use implicit LOD and are not in the closure, so they stay untouched.
 */

const WORLD_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

function lintTargets() {
    const worldFiles = readdirSync(WORLD_DIR)
        .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
        .map((f) => path.join(WORLD_DIR, f));
    const effectsDir = path.resolve(WORLD_DIR, '../../../playground/effects');
    const effectFiles = readdirSync(effectsDir)
        .filter((f) => f.startsWith('odyssey-') && f.endsWith('.effect.js'))
        .map((f) => path.join(effectsDir, f));
    return [...worldFiles, ...effectFiles];
}

/** Split source into statements, tolerating multi-line expressions. */
function statementsOf(source) {
    // Strip comments first so commented-out code cannot trip or mask the lint.
    const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ');
    return stripped.split(';');
}

/** Collect `const NAME =` declarations by name. */
function constDeclarations(statements) {
    const decls = new Map();
    statements.forEach((s) => {
        const m = s.match(/const\s+([A-Za-z_$][\w$]*)\s*=/);
        if (m) decls.set(m[1], s);
    });
    return decls;
}

/** Every texture( call in `text` that is NOT followed by .level( before its argument list closes. */
function unpinnedTextureCalls(text) {
    const offenders = [];
    const re = /texture\s*\(/g;
    let m = re.exec(text);
    while (m) {
        // Walk to the matching close paren of texture(...), then look at what follows.
        let depth = 1;
        let i = m.index + m[0].length;
        while (i < text.length && depth > 0) {
            if (text[i] === '(') depth += 1;
            else if (text[i] === ')') depth -= 1;
            i += 1;
        }
        const tail = text.slice(i, i + 12).replace(/\s+/g, '');
        if (!tail.startsWith('.level(')) offenders.push(text.slice(m.index, i).slice(0, 90));
        m = re.exec(text);
    }
    return offenders;
}

/**
 * Identifiers a statement genuinely REFERENCES. Two exclusions keep the closure honest:
 * `(?<![.\w$])` drops member accesses (`q.cavity` reads a property, not the const `cavity`),
 * and `(?!\s*:)` drops object KEYS — without it the quality-tier literal `{ cavity: 0.30 }`
 * matched the fragment-stage `const cavity` and dragged the entire colour chain (and its
 * legitimately implicit-LOD `texture(heightTex, vUv)`) into the "vertex stage" closure.
 * The key exclusion also skips a ternary consequent (`c ? a : b`); that can only make the
 * lint miss a reference, never flag a false positive, and no positionNode here uses one.
 */
function referencedIdentifiers(statement) {
    return statement.match(/(?<![.\w$])[A-Za-z_$][\w$]*(?!\s*:)/g) ?? [];
}

describe('vertex-stage texture reads pin their LOD (.level)', () => {
    lintTargets().forEach((file) => {
        it(path.basename(file), () => {
            const statements = statementsOf(readFileSync(file, 'utf8'));
            const decls = constDeclarations(statements);
            const positionStatements = statements.filter((s) => /\.positionNode\s*=/.test(s));

            // Transitive closure: everything a positionNode expression can reach through
            // same-file const declarations runs (or may run) in the vertex stage.
            const closure = [];
            const seen = new Set();
            const enqueue = (s) => { if (!seen.has(s)) { seen.add(s); closure.push(s); } };
            positionStatements.forEach(enqueue);
            for (let idx = 0; idx < closure.length; idx += 1) {
                const ids = referencedIdentifiers(closure[idx]);
                ids.forEach((id) => {
                    if (decls.has(id)) enqueue(decls.get(id));
                });
            }

            const offenders = closure.flatMap((s) => unpinnedTextureCalls(s));
            expect(offenders, `texture() reachable from positionNode without .level() in ${path.basename(file)}:\n${offenders.join('\n')}`).toEqual([]);
        });
    });

    it('actually covers the known vertex-stage reads (self-test, not vacuous)', () => {
        // The ground displacement and the cloud billow are the two known vertex-stage texture
        // reads. If refactoring renames things so the closure no longer reaches ANY texture
        // call, this lint would pass while checking nothing — so pin that it sees at least one.
        const rendererSource = readFileSync(path.join(WORLD_DIR, 'odyssey-world-renderer.js'), 'utf8');
        const statements = statementsOf(rendererSource);
        const decls = constDeclarations(statements);
        const positionStatements = statements.filter((s) => /\.positionNode\s*=/.test(s));
        const closure = [];
        const seen = new Set();
        const enqueue = (s) => { if (!seen.has(s)) { seen.add(s); closure.push(s); } };
        positionStatements.forEach(enqueue);
        for (let idx = 0; idx < closure.length; idx += 1) {
            const ids = referencedIdentifiers(closure[idx]);
            ids.forEach((id) => { if (decls.has(id)) enqueue(decls.get(id)); });
        }
        const textureCallCount = closure.join(';').match(/texture\s*\(/g)?.length ?? 0;
        expect(textureCallCount).toBeGreaterThanOrEqual(2);
    });
});
