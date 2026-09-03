import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  findUnreleasedSection,
  prepareRelease,
  readReleaseState,
  verifyRelease,
} from "../scripts/release-utils.mjs";

test("prepare release syncs every version field and converts the changelog section", () => {
  const fixture = mkdtempSync(join(tmpdir(), "skilldeck-release-test-"));

  try {
    const write = (file: string, contents: string) => {
      mkdirSync(dirname(join(fixture, file)), { recursive: true });
      writeFileSync(join(fixture, file), `${contents}\n`, "utf8");
    };
    write(
      "package.json",
      JSON.stringify(
        {
          name: "skill-deck",
          version: "0.0.2",
          dependencies: { example: "0.0.2" },
        },
        null,
        2,
      ),
    );
    write(
      "package-lock.json",
      JSON.stringify(
        {
          name: "skill-deck",
          version: "0.0.2",
          packages: {
            "": { name: "skill-deck", version: "0.0.2" },
            "node_modules/example": { name: "example", version: "0.0.2" },
          },
        },
        null,
        2,
      ),
    );
    write("src-tauri/tauri.conf.json", JSON.stringify({ productName: "SkillDeck", version: "0.0.2" }, null, 2));
    write(
      "src-tauri/Cargo.toml",
      [
        "[package]",
        'name = "skill-deck"',
        'version = "0.0.2"',
        "",
        "[dependencies]",
        'example = "1"',
      ].join("\n"),
    );
    write(
      "src-tauri/Cargo.lock",
      [
        "[[package]]",
        'name = "example"',
        'version = "0.0.2"',
        "",
        "[[package]]",
        'name = "skill-deck"',
        'version = "0.0.2"',
      ].join("\n"),
    );
    write(
      "CHANGELOG.md",
      [
        "# Changelog",
        "",
        "## [Unreleased]",
        "",
        "### Added",
        "",
        "- Test release preparation.",
        "",
        "## [0.0.2] - 2026-09-03",
        "",
        "### Added",
        "",
        "- Previous release.",
      ].join("\n"),
    );

    prepareRelease(fixture, "v0.0.3", "2026-09-04");
    const state = readReleaseState(fixture);
    assert.deepEqual(
      {
        packageJson: state.packageJson,
        packageLockRoot: state.packageLockRoot,
        packageLockPackage: state.packageLockPackage,
        tauriConfig: state.tauriConfig,
        cargoToml: state.cargoToml,
        cargoLock: state.cargoLock,
      },
      {
        packageJson: "0.0.3",
        packageLockRoot: "0.0.3",
        packageLockPackage: "0.0.3",
        tauriConfig: "0.0.3",
        cargoToml: "0.0.3",
        cargoLock: "0.0.3",
      },
    );
    assert.equal(verifyRelease(fixture, "0.0.3").changelogDate, "2026-09-04");
    assert.equal(findUnreleasedSection(state.changelog)?.hasContent, false);
    assert.match(state.changelog, /^## \[0\.0\.3\] - 2026-09-04$/m);

    const packageLock = JSON.parse(readFileSync(join(fixture, "package-lock.json"), "utf8")) as {
      packages: Record<string, { version?: string }>;
    };
    assert.equal(packageLock.packages["node_modules/example"]?.version, "0.0.2");

    assert.throws(
      () => prepareRelease(fixture, "0.0.4", "2026-09-05"),
      /Unreleased changelog section is empty/u,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
