import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const frontendRoot = resolve(import.meta.dirname, "..");
const sourceRoot = join(frontendRoot, "src");
const sourceExtensions = new Set([".ts", ".tsx"]);
const controllerBoundPresentation = new Set([
  "pages/workspace/WorkspacePage.tsx",
  "pages/workspace/components/AnnotationEditor.tsx",
  "pages/workspace/components/TranslationComparePanel.tsx",
  "pages/workspace/components/TagEditorPanel.tsx",
  "pages/workspace/components/AnnotationBulkActionDialog.tsx",
  "pages/workspace/components/AssetDeletionDialog.tsx",
  "pages/jobs/JobsPage.tsx",
  "pages/jobs/components/NewJobPanel.tsx",
  "pages/jobs/components/JobDetailPanel.tsx",
  "pages/preprocess/PreprocessPage.tsx",
  "pages/export/ExportPage.tsx",
]);

function collectSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

function sourcePath(path) {
  return relative(sourceRoot, path).split(sep).join("/");
}

function resolveSourceImport(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(importer), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return candidates.find(
    (candidate) =>
      existsSync(candidate) &&
      statSync(candidate).isFile() &&
      sourceExtensions.has(extname(candidate)),
  );
}

function importSpecifiers(sourceFile) {
  const specifiers = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
}

function topLevelArea(path) {
  return sourcePath(path).split("/")[0];
}

function featureName(path) {
  const parts = sourcePath(path).split("/");
  return parts[0] === "features" ? parts[1] : null;
}

function isV2SafeSharedPath(path) {
  const normalized = sourcePath(path);
  if (normalized.startsWith("shared/desktop/")) return normalized.endsWith(".ts");
  return ["shared/api/", "shared/format/", "shared/query/", "shared/store/"].some((prefix) =>
    normalized.startsWith(prefix),
  );
}

function isFeatureSafeSharedPath(path) {
  const normalized = sourcePath(path);
  return normalized.startsWith("shared/api/") || normalized.startsWith("shared/query/");
}

function isFeatureRuntimeModule(path) {
  return /^features\/[^/]+\/(api|hooks)\.ts$/u.test(sourcePath(path));
}

function findCycle(graph) {
  const state = new Map();
  const stack = [];

  function visit(node) {
    state.set(node, "visiting");
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) {
      if (state.get(dependency) === "visiting") {
        const start = stack.indexOf(dependency);
        return [...stack.slice(start), dependency];
      }
      if (!state.has(dependency)) {
        const cycle = visit(dependency);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(node, "visited");
    return null;
  }

  for (const node of graph.keys()) {
    if (state.has(node)) continue;
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

const files = collectSourceFiles(sourceRoot);
const graph = new Map(files.map((file) => [file, []]));
const violations = [];

for (const file of files) {
  const relativeFile = sourcePath(file);
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    extname(file) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function report(message) {
    violations.push(`${relativeFile}: ${message}`);
  }

  for (const specifier of importSpecifiers(sourceFile)) {
    if (specifier.endsWith("/styles/global.css") && relativeFile !== "legacy-main.tsx") {
      report("legacy global styles may only be loaded by legacy-main.tsx.");
    }
    if (specifier.startsWith("@tauri-apps/") && !relativeFile.startsWith("shared/desktop/")) {
      report(`Tauri import "${specifier}" must be isolated under shared/desktop.`);
    }

    const dependency = resolveSourceImport(file, specifier);
    if (!dependency) continue;
    graph.get(file).push(dependency);

    const sourceArea = topLevelArea(file);
    const dependencyArea = topLevelArea(dependency);
    if (controllerBoundPresentation.has(relativeFile) && isFeatureRuntimeModule(dependency)) {
      report(
        `controller-bound presentation cannot call feature runtime ${sourcePath(dependency)} directly.`,
      );
    }
    if (sourceArea === "shared" && dependencyArea !== "shared") {
      report(`shared code cannot depend on ${sourcePath(dependency)}.`);
    }
    if (sourceArea === "features" && dependencyArea === "features") {
      const sourceFeature = featureName(file);
      const dependencyFeature = featureName(dependency);
      if (sourceFeature !== dependencyFeature) {
        report(`feature "${sourceFeature}" cannot depend on feature "${dependencyFeature}".`);
      }
    }
    if (
      sourceArea === "features" &&
      dependencyArea === "shared" &&
      !isFeatureSafeSharedPath(dependency)
    ) {
      report(
        `feature code cannot depend on presentation or platform module ${sourcePath(dependency)}.`,
      );
    }
    if (
      sourceArea === "features" &&
      ["app", "application", "layouts", "legacy", "pages", "v2"].includes(dependencyArea)
    ) {
      report(`feature code cannot depend on ${sourcePath(dependency)}.`);
    }
    if (
      sourceArea === "application" &&
      ["app", "layouts", "legacy", "pages", "v2"].includes(dependencyArea)
    ) {
      report(`application code cannot depend on presentation module ${sourcePath(dependency)}.`);
    }
    if (
      sourceArea === "application" &&
      dependencyArea === "shared" &&
      !isV2SafeSharedPath(dependency)
    ) {
      report(`application code cannot depend on legacy shared module ${sourcePath(dependency)}.`);
    }
    if (sourceArea === "legacy" && dependencyArea === "v2") {
      report(`legacy code cannot depend on ${sourcePath(dependency)}.`);
    }
    if (sourceArea === "v2") {
      const allowed =
        dependencyArea === "v2" ||
        dependencyArea === "application" ||
        dependencyArea === "features" ||
        (dependencyArea === "shared" && isV2SafeSharedPath(dependency));
      if (!allowed) {
        report(`V2 code cannot depend on legacy presentation module ${sourcePath(dependency)}.`);
      }
    }
  }

  function checkCalls(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch" &&
      relativeFile !== "shared/api/client.ts"
    ) {
      report("direct fetch calls must go through shared/api/client.ts.");
    }
    ts.forEachChild(node, checkCalls);
  }
  checkCalls(sourceFile);
}

const cycle = findCycle(graph);
if (cycle) {
  violations.push(`dependency cycle: ${cycle.map(sourcePath).join(" -> ")}`);
}

if (violations.length) {
  process.stderr.write(`Frontend architecture check failed:\n- ${violations.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  const edgeCount = [...graph.values()].reduce(
    (total, dependencies) => total + dependencies.length,
    0,
  );
  process.stdout.write(
    `Frontend architecture check passed (${files.length} modules, ${edgeCount} internal edges).\n`,
  );
}
