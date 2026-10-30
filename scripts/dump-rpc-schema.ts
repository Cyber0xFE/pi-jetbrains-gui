import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const require = createRequire(import.meta.url);
// Keep the schema utility dependency-free at the repository root; the web workspace already pins
// TypeScript and is available in normal plugin checkouts.
const ts = require(resolve(process.cwd(), "web/node_modules/typescript"));

/**
 * Produces a reviewable protocol snapshot from pi's rpc-types.ts without importing pi at runtime.
 * It intentionally records the exported declarations and their source text: this catches pinned
 * protocol changes while keeping the plugin repository independent from pi's build artifacts.
 *
 * Usage:
 *   npx tsx scripts/dump-rpc-schema.ts [path/to/rpc-types.ts] [output.json]
 */
const sourcePath = resolve(process.argv[2] ?? "../pi/packages/coding-agent/src/modes/rpc/rpc-types.ts");
const outputPath = resolve(process.argv[3] ?? "rpc-schema.json");
const source = ts.sys.readFile(sourcePath);
if (source === undefined) throw new Error(`rpc-types.ts not found: ${sourcePath}`);

const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declarations: Record<string, unknown> = {};
for (const statement of file.statements) {
  const name = declarationName(statement);
  if (!name || !name.startsWith("Rpc")) continue;
  declarations[name] = {
    kind: ts.SyntaxKind[statement.kind],
    source: statement.getText(file),
  };
}

const snapshot = {
  schemaVersion: 1,
  source: relative(process.cwd(), sourcePath).replaceAll("\\", "/"),
  declarations,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`wrote ${outputPath} (${Object.keys(declarations).length} declarations)`);

function declarationName(node: any): string | undefined {
  if (
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isFunctionDeclaration(node)
  ) {
    return node.name?.text;
  }
  return undefined;
}
