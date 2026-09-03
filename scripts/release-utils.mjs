import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const releaseFiles = {
  packageJson: "package.json",
  packageLock: "package-lock.json",
  tauriConfig: "src-tauri/tauri.conf.json",
  cargoToml: "src-tauri/Cargo.toml",
  cargoLock: "src-tauri/Cargo.lock",
  changelog: "CHANGELOG.md",
};

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function normalizeVersion(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("Missing version. Example: 0.0.3 or v0.0.3");
  }

  const version = input.trim().replace(/^v/, "");
  assertSemVer(version);
  return version;
}

export function assertSemVer(version) {
  if (!semverPattern.test(version)) {
    throw new Error(`Invalid Semantic Version: ${version}`);
  }
}

export function assertVersionIsNewer(currentVersion, nextVersion) {
  if (compareSemVer(currentVersion, nextVersion) >= 0) {
    throw new Error(`Version ${nextVersion} must be newer than ${currentVersion}`);
  }
}

export function compareSemVer(left, right) {
  const leftParts = parseSemVer(left);
  const rightParts = parseSemVer(right);
  const numbers = ["major", "minor", "patch"];

  for (const part of numbers) {
    if (leftParts[part] !== rightParts[part]) {
      return leftParts[part] - rightParts[part];
    }
  }

  if (!leftParts.prerelease && !rightParts.prerelease) return 0;
  if (!leftParts.prerelease) return 1;
  if (!rightParts.prerelease) return -1;

  const leftIdentifiers = leftParts.prerelease.split(".");
  const rightIdentifiers = rightParts.prerelease.split(".");
  const count = Math.max(leftIdentifiers.length, rightIdentifiers.length);

  for (let index = 0; index < count; index += 1) {
    const leftIdentifier = leftIdentifiers[index];
    const rightIdentifier = rightIdentifiers[index];

    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;

    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }

  return 0;
}

function parseSemVer(version) {
  const match = version.match(semverPattern);
  if (!match) {
    throw new Error(`Invalid Semantic Version: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
    build: match[5],
  };
}

function filePath(root, file) {
  return join(root, file);
}

function readFile(root, file) {
  try {
    return readFileSync(filePath(root, file), "utf8");
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error.message}`);
  }
}

function readJson(root, file) {
  try {
    return JSON.parse(readFile(root, file));
  } catch (error) {
    throw new Error(`Cannot parse ${file}: ${error.message}`);
  }
}

function readCargoTomlPackageVersion(text) {
  let inPackageSection = false;
  let found = false;
  let version;

  for (const line of text.split("\n")) {
    if (/^\s*\[package\]\s*$/.test(line)) {
      if (found) throw new Error("src-tauri/Cargo.toml has multiple [package] sections");
      inPackageSection = true;
      continue;
    }
    if (inPackageSection && /^\s*\[/.test(line)) {
      inPackageSection = false;
    }

    const match = inPackageSection ? line.match(/^\s*version\s*=\s*"([^"]+)"\s*$/) : null;
    if (match) {
      found = true;
      version = match[1];
    }
  }

  if (!found) throw new Error("Cannot find version in src-tauri/Cargo.toml [package]");
  return version;
}

function readCargoLockPackageVersion(text) {
  let inPackageSection = false;
  let packageName;
  let targetPackageSeen = false;
  let version;

  const finishPackage = () => {
    if (packageName !== "skill-deck") return;
    if (targetPackageSeen) {
      throw new Error("src-tauri/Cargo.lock has multiple skill-deck packages");
    }
    if (version === undefined) throw new Error("Cannot find version for skill-deck in src-tauri/Cargo.lock");

    targetPackageSeen = true;
    savedVersion = version;
  };
  let savedVersion;

  for (const line of text.split("\n")) {
    if (/^\s*\[\[package\]\]\s*$/.test(line)) {
      if (inPackageSection) finishPackage();
      inPackageSection = true;
      packageName = undefined;
      version = undefined;
      continue;
    }
    if (inPackageSection && /^\s*\[\[/.test(line)) {
      finishPackage();
      inPackageSection = false;
      packageName = undefined;
      version = undefined;
      continue;
    }
    if (!inPackageSection) continue;

    const nameMatch = line.match(/^\s*name\s*=\s*"([^"]+)"\s*$/);
    if (nameMatch) packageName = nameMatch[1];

    const versionMatch = line.match(/^\s*version\s*=\s*"([^"]+)"\s*$/);
    if (packageName === "skill-deck" && versionMatch) {
      if (version !== undefined) {
        throw new Error("src-tauri/Cargo.lock has multiple versions in the skill-deck package");
      }
      version = versionMatch[1];
    }
  }
  finishPackage();

  if (!targetPackageSeen) throw new Error("Cannot find skill-deck package in src-tauri/Cargo.lock");
  return savedVersion;
}

export function readReleaseState(root = process.cwd()) {
  const packageJson = readJson(root, releaseFiles.packageJson);
  const packageLock = readJson(root, releaseFiles.packageLock);
  const tauriConfig = readJson(root, releaseFiles.tauriConfig);
  const cargoToml = readFile(root, releaseFiles.cargoToml);
  const cargoLock = readFile(root, releaseFiles.cargoLock);
  const changelog = readFile(root, releaseFiles.changelog);

  const versions = {
    packageJson: packageJson.version,
    packageLockRoot: packageLock.version,
    packageLockPackage: packageLock.packages?.[""]?.version,
    tauriConfig: tauriConfig.version,
    cargoToml: readCargoTomlPackageVersion(cargoToml),
    cargoLock: readCargoLockPackageVersion(cargoLock),
  };

  return { ...versions, changelog };
}

export function assertReleaseVersionsAreConsistent(releaseState) {
  const versions = Object.values(versionFields(releaseState));
  const [version, ...others] = versions;
  const mismatched = others.filter((other) => other !== version);

  if (mismatched.length > 0) {
    throw new Error(`Release versions are inconsistent: ${JSON.stringify(versionFields(releaseState))}`);
  }

  return version;
}

function versionFields(releaseState) {
  return {
    packageJson: releaseState.packageJson,
    packageLockRoot: releaseState.packageLockRoot,
    packageLockPackage: releaseState.packageLockPackage,
    tauriConfig: releaseState.tauriConfig,
    cargoToml: releaseState.cargoToml,
    cargoLock: releaseState.cargoLock,
  };
}

export function findChangelogSection(changelog, version) {
  const headingPattern = new RegExp(
    `^## \\[${escapeRegExp(version)}\\] - (\\d{4}-\\d{2}-\\d{2})[ \\t]*$`,
    "m",
  );
  const headingMatch = changelog.match(headingPattern);
  if (!headingMatch) return null;

  const nextHeadingMatch = changelog.slice(headingMatch.index + headingMatch[0].length).match(/^## \[/m);
  const bodyStart = headingMatch.index + headingMatch[0].length;
  const bodyEnd = nextHeadingMatch
    ? headingMatch.index + headingMatch[0].length + nextHeadingMatch.index
    : changelog.length;
  const body = changelog.slice(bodyStart, bodyEnd).trim();

  return {
    date: headingMatch[1],
    body,
    hasContent: body !== "",
  };
}

export function findUnreleasedSection(changelog) {
  const headingIndex = changelog.search(/^## \[Unreleased\][ \t]*$/m);
  if (headingIndex === -1) return null;

  const remainder = changelog.slice(headingIndex);
  const nextHeadingMatch = remainder.slice("\n".length).match(/^## \[/m);
  const bodyEnd = nextHeadingMatch
    ? remainder.indexOf(nextHeadingMatch[0], "\n".length)
    : changelog.length - headingIndex;
  const body = remainder.slice(0, bodyEnd).replace(/^## \[Unreleased\][ \t]*\r?\n?/, "").trim();

  return {
    headingIndex,
    body,
    hasContent: body !== "",
  };
}

export function formatLocalDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function updateJsonVersion({ text, currentVersion, nextVersion, expectedCount }) {
  const pattern = new RegExp(
    `^([ \\t]*"version"[ \\t]*:[ \\t]*)"${escapeRegExp(currentVersion)}"([ \\t]*,?[ \\t]*)$`,
    "gm",
  );
  let count = 0;
  const nextText = text.replace(pattern, (_match, prefix, suffix) => {
    count += 1;
    return `${prefix}"${nextVersion}"${suffix}`;
  });

  if (count !== expectedCount) {
    throw new Error(`Expected ${expectedCount} version fields, found ${count}`);
  }
  JSON.parse(nextText);
  return nextText;
}

function updatePackageJsonVersion({ text, currentVersion, nextVersion }) {
  const data = JSON.parse(text);
  if (data.version !== currentVersion) {
    throw new Error(`Unexpected package.json version: ${data.version}`);
  }
  data.version = nextVersion;
  return serializeJson(text, data);
}

function updatePackageLockVersion({ text, currentVersion, nextVersion }) {
  const data = JSON.parse(text);
  const rootPackage = data.packages?.[""];
  if (data.version !== currentVersion || rootPackage?.version !== currentVersion) {
    throw new Error(`Unexpected package-lock.json version fields: ${data.version}, ${rootPackage?.version}`);
  }
  data.version = nextVersion;
  rootPackage.version = nextVersion;
  return serializeJson(text, data);
}

function serializeJson(text, data) {
  const indent = text.match(/^[ \t]+(?=")/m)?.[0]?.length ?? 2;
  const newline = text.endsWith("\n") ? "\n" : "";
  return `${JSON.stringify(data, null, indent)}${newline}`;
}

function updateCargoTomlVersion({ text, currentVersion, nextVersion }) {
  const lines = text.split("\n");
  let inPackageSection = false;
  let count = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*\[package\]\s*$/.test(line)) {
      inPackageSection = true;
      continue;
    }
    if (inPackageSection && /^\s*\[/.test(line)) {
      inPackageSection = false;
    }

    const match = inPackageSection ? line.match(/^(\s*version\s*=\s*")([^"]+)("\s*)$/) : null;
    if (match) {
      if (match[2] !== currentVersion) {
        throw new Error(`Unexpected Cargo.toml version: ${match[2]}`);
      }
      lines[index] = `${match[1]}${nextVersion}${match[3]}`;
      count += 1;
    }
  }

  if (count !== 1) {
    throw new Error(`Expected one Cargo.toml package version, found ${count}`);
  }
  return lines.join("\n");
}

function updateCargoLockVersion({ text, currentVersion, nextVersion }) {
  const lines = text.split("\n");
  let inPackageSection = false;
  let packageName;
  let count = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*\[\[package\]\]\s*$/.test(line)) {
      inPackageSection = true;
      packageName = undefined;
      continue;
    }
    if (inPackageSection && /^\s*\[\[/.test(line)) {
      inPackageSection = false;
      packageName = undefined;
      continue;
    }
    if (!inPackageSection) continue;

    const nameMatch = line.match(/^\s*name\s*=\s*"([^"]+)"\s*$/);
    if (nameMatch) packageName = nameMatch[1];

    if (packageName === "skill-deck") {
      const match = line.match(/^(\s*version\s*=\s*")([^"]+)("\s*)$/);
      if (match) {
        if (match[2] !== currentVersion) {
          throw new Error(`Unexpected Cargo.lock version for skill-deck: ${match[2]}`);
        }
        lines[index] = `${match[1]}${nextVersion}${match[3]}`;
        count += 1;
      }
    }
  }

  if (count !== 1) {
    throw new Error(`Expected one Cargo.lock skill-deck version, found ${count}`);
  }
  return lines.join("\n");
}

function updateChangelog({ text, version, date }) {
  const pattern = /^## \[Unreleased\][ \t]*$/m;
  const matches = text.match(new RegExp(pattern.source, "gm")) ?? [];
  if (matches.length !== 1) {
    throw new Error(`Expected one Unreleased heading in CHANGELOG.md, found ${matches.length}`);
  }
  if (findChangelogSection(text, version)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`);
  }

  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  return text.replace(pattern, `## [Unreleased]${newline}${newline}## [${version}] - ${date}`);
}

function writeFile(root, file, text) {
  writeFileSync(filePath(root, file), text, "utf8");
}

export function prepareRelease(root, requestedVersion, date = formatLocalDate()) {
  const version = normalizeVersion(requestedVersion);
  const state = readReleaseState(root);
  const currentVersion = assertReleaseVersionsAreConsistent(state);
  assertVersionIsNewer(currentVersion, version);

  const unreleased = findUnreleasedSection(state.changelog);
  if (!unreleased) throw new Error("CHANGELOG.md must have an Unreleased heading");
  if (!unreleased.hasContent) {
    throw new Error("The Unreleased changelog section is empty; add user-visible changes first");
  }

  const packageJson = updatePackageJsonVersion({
    text: readFile(root, releaseFiles.packageJson),
    currentVersion,
    nextVersion: version,
  });
  const packageLock = updatePackageLockVersion({
    text: readFile(root, releaseFiles.packageLock),
    currentVersion,
    nextVersion: version,
  });
  const tauriConfig = updateJsonVersion({
    text: readFile(root, releaseFiles.tauriConfig),
    currentVersion,
    nextVersion: version,
    expectedCount: 1,
  });
  const cargoToml = updateCargoTomlVersion({
    text: readFile(root, releaseFiles.cargoToml),
    currentVersion,
    nextVersion: version,
  });
  const cargoLock = updateCargoLockVersion({
    text: readFile(root, releaseFiles.cargoLock),
    currentVersion,
    nextVersion: version,
  });
  const changelog = updateChangelog({
    text: state.changelog,
    version,
    date,
  });

  writeFile(root, releaseFiles.packageJson, packageJson);
  writeFile(root, releaseFiles.packageLock, packageLock);
  writeFile(root, releaseFiles.tauriConfig, tauriConfig);
  writeFile(root, releaseFiles.cargoToml, cargoToml);
  writeFile(root, releaseFiles.cargoLock, cargoLock);
  writeFile(root, releaseFiles.changelog, changelog);

  return {
    previousVersion: currentVersion,
    version,
    date,
    changedFiles: Object.values(releaseFiles),
  };
}

export function verifyRelease(root, requestedVersion) {
  const version = normalizeVersion(requestedVersion);
  const state = readReleaseState(root);
  const currentVersion = assertReleaseVersionsAreConsistent(state);

  if (currentVersion !== version) {
    throw new Error(`Release files are at ${currentVersion}, expected ${version}`);
  }
  if (!findUnreleasedSection(state.changelog)) {
    throw new Error("CHANGELOG.md must retain an Unreleased heading");
  }

  const section = findChangelogSection(state.changelog, version);
  if (!section) {
    throw new Error(`CHANGELOG.md has no dated section for ${version}`);
  }
  if (!section.hasContent) {
    throw new Error(`CHANGELOG.md section for ${version} is empty`);
  }

  return {
    version,
    changelogDate: section.date,
  };
}
