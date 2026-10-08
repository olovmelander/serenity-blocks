// Audit/parser tooling is intentionally a development-only dependency.
// eslint-disable-next-line import/no-extraneous-dependencies
import ts from 'typescript';

const DOM_GLOBALS = new Set(['window', 'document', 'navigator']);

/** Count direct dotted DOM-global access, excluding text that merely mentions it. */
export function countDomGlobalReads(source, fileName = 'source.js') {
    const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let count = 0;
    const visit = (node) => {
        if (ts.isPropertyAccessExpression(node) && !node.questionDotToken
            && ts.isIdentifier(node.expression) && DOM_GLOBALS.has(node.expression.text)) count++;
        ts.forEachChild(node, visit);
    };
    visit(tree);
    return count;
}
