import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
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
const engineFiles = sourceFiles(src).filter((f) => !f.startsWith(path.join(src, "ui")));

describe("the engine cannot reach the UI", () => {
  test("nothing outside src/ui imports react", () => {
    const offenders = engineFiles.filter((f) => /from ["']react/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });

  test("nothing outside src/ui imports from src/ui", () => {
    const offenders = engineFiles.filter((f) =>
      /from ["'][^"']*\/ui\//.test(readFileSync(f, "utf8"))
    );
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });

  test("react is an OPTIONAL peer, so an engine-only consumer never installs it", () => {
    expect(pkg.peerDependencies?.react).toBeTruthy();
    expect(pkg.peerDependenciesMeta?.react?.optional).toBe(true);
  });
});

// The reason a security engine can carry a UI in the same tarball: the tarball
// has no runtime dependencies to carry. If the UI ever needs one, that stops
// being true and the packages should split.
test("the package has zero runtime dependencies", () => {
  expect(pkg.dependencies ?? {}).toEqual({});
});

test("src/ui depends on the engine only through types and the version constant", () => {
  const values = sourceFiles(path.join(src, "ui"))
    .flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => /^import [^t]/.test(l) && /from ["']\.\.\//.test(l))
    );
  // A short list is what keeps a later split cheap; anything else here means
  // the UI has grown into the engine and the two are no longer separable.
  expect(values.join("\n")).toContain("DESCRIPTOR_VERSION");
  expect(values).toHaveLength(1);
});
