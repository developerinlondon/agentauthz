import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The UI ships in this package rather than a second one, which is only safe
// while the engine cannot reach it. These are the conditions that made that
// choice defensible; they are gates, not intentions.

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean; }>;
  exports: Record<string, { types: string; import: string; }>;
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const src = path.join(root, "src");
const engineFiles = sourceFiles(src);

describe("the engine is presentation-free", () => {
  test("nothing imports react", () => {
    const offenders = engineFiles.filter((f) => /from ["']react["']/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  test("and react is not a peer at all — presentation belongs to the host", () => {
    expect(pkg.peerDependencies?.react).toBeUndefined();
    expect(pkg.peerDependenciesMeta?.react).toBeUndefined();
  });
});

// The reason a security engine can carry a UI in the same tarball: the tarball
// has no runtime dependencies to carry. If the UI ever needs one, that stops
// being true and the packages should split. The MCP server is held to the same
// bar — it speaks JSON-RPC itself rather than pulling in an SDK to do it.
test("the package has zero runtime dependencies", () => {
  expect(pkg.dependencies ?? {}).toEqual({});
});

// An unbuilt subpath resolves to nothing, and only after publish, in someone
// else's project.
test("every declared export points at a built file", () => {
  const missing = Object.entries(pkg.exports).flatMap(([subpath, targets]) =>
    [targets.types, targets.import]
      .filter((target) => !existsSync(path.join(root, target)))
      .map((target) => `${subpath} → ${target}`)
  );
  expect(missing).toEqual([]);
});
