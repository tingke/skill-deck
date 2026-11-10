import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTauriPackagePairing,
  readCargoLockVersions,
} from "../scripts/release-utils.mjs";

const CARGO_LOCK = `
[[package]]
name = "tauri"
version = "2.12.5"

[[package]]
name = "tauri-plugin-process"
version = "2.4.0"

[[package]]
name = "tauri-plugin-updater"
version = "2.14.0"

[[package]]
name = "serde"
version = "1.0.210"
`;

function packageLock(overrides: Record<string, string> = {}) {
  const versions: Record<string, { version: string }> = {
    "node_modules/@tauri-apps/api": { version: "2.12.4" },
    "node_modules/@tauri-apps/plugin-process": { version: "2.4.0" },
    "node_modules/@tauri-apps/plugin-updater": { version: "2.14.1" },
  };
  for (const [key, version] of Object.entries(overrides)) {
    versions[key] = { version };
  }
  return { packages: versions };
}

test("matching major/minor passes regardless of patch", () => {
  assertTauriPackagePairing({ packageLock: packageLock(), cargoLock: CARGO_LOCK });
});

test("npm minor behind crate minor is rejected (v0.0.5 release failure)", () => {
  const lock = packageLock({ "node_modules/@tauri-apps/api": "2.11.1" });
  assert.throws(
    () => assertTauriPackagePairing({ packageLock: lock, cargoLock: CARGO_LOCK }),
    /@tauri-apps\/api \(2\.11\.1\) : tauri \(2\.12\.5\)/,
  );
});

test("crate minor behind npm minor is rejected too", () => {
  const lock = packageLock({ "node_modules/@tauri-apps/plugin-updater": "2.15.0" });
  assert.throws(
    () => assertTauriPackagePairing({ packageLock: lock, cargoLock: CARGO_LOCK }),
    /plugin-updater \(2\.15\.0\) : tauri-plugin-updater \(2\.14\.0\)/,
  );
});

test("major mismatch is rejected even with equal minor", () => {
  const lock = packageLock({ "node_modules/@tauri-apps/plugin-process": "3.4.0" });
  assert.throws(
    () => assertTauriPackagePairing({ packageLock: lock, cargoLock: CARGO_LOCK }),
    /plugin-process \(3\.4\.0\) : tauri-plugin-process \(2\.4\.0\)/,
  );
});

test("package missing on either side is reported", () => {
  const lock = packageLock();
  delete lock.packages["node_modules/@tauri-apps/plugin-process"];
  assert.throws(
    () => assertTauriPackagePairing({ packageLock: lock, cargoLock: CARGO_LOCK }),
    /tauri-plugin-process \(2\.4\.0\)/,
  );
});

test("pairs absent on both sides are skipped", () => {
  const lock = { packages: {} };
  const cargo = `[[package]]
name = "serde"
version = "1.0.210"
`;
  assertTauriPackagePairing({ packageLock: lock, cargoLock: cargo });
});

test("readCargoLockVersions maps every package", () => {
  const versions = readCargoLockVersions(CARGO_LOCK);
  assert.equal(versions.tauri, "2.12.5");
  assert.equal(versions["tauri-plugin-process"], "2.4.0");
  assert.equal(versions["tauri-plugin-updater"], "2.14.0");
  assert.equal(versions.serde, "1.0.210");
});
