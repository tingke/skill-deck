import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const outputDir = mkdtempSync(join(tmpdir(), "skill-deck-tests-"));

try {
  await build({
    entryPoints: [
      fileURLToPath(new URL("../tests/scanning.test.ts", import.meta.url)),
      fileURLToPath(new URL("../tests/connection-confirmation.test.ts", import.meta.url)),
      fileURLToPath(new URL("../tests/skill-delete-confirmation.test.ts", import.meta.url)),
      fileURLToPath(new URL("../tests/skill-batch.test.ts", import.meta.url)),
      fileURLToPath(new URL("../tests/skill-paths.test.ts", import.meta.url)),
    ],
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
