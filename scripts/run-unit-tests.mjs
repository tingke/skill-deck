import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const testsDir = fileURLToPath(new URL("../tests", import.meta.url));
const testEntries = readdirSync(testsDir)
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => join(testsDir, file))
  .sort();

if (testEntries.length === 0) {
  console.error("No test files found in tests/");
  process.exit(1);
}

const outputDir = mkdtempSync(join(tmpdir(), "skill-deck-tests-"));

try {
  await build({
    entryPoints: testEntries,
    bundle: true,
    platform: "node",
    format: "esm",
    outdir: outputDir,
    outExtension: { ".js": ".mjs" },
  });

  const testFiles = readdirSync(outputDir)
    .filter((file) => file.endsWith(".test.mjs"))
    .map((file) => join(outputDir, file));
  const testRun = spawnSync(process.execPath, ["--test", ...testFiles], {
    stdio: "inherit",
  });
  process.exitCode = testRun.status ?? 1;
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}
