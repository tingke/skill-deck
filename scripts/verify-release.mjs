import { verifyRelease } from "./release-utils.mjs";

const [requestedVersion] = process.argv.slice(2);

try {
  const result = verifyRelease(process.cwd(), requestedVersion);
  console.log(
    `Release ${result.version} is consistent; changelog date is ${result.changelogDate}.`,
  );
} catch (error) {
  console.error(`Failed to verify release: ${error.message}`);
  process.exitCode = 1;
}
