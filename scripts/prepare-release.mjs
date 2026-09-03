import { prepareRelease } from "./release-utils.mjs";

const [requestedVersion] = process.argv.slice(2);

try {
  const result = prepareRelease(process.cwd(), requestedVersion);
  console.log(`Prepared release ${result.version} (${result.date}).`);
  console.log("Updated files:");
  for (const file of result.changedFiles) {
    console.log(`- ${file}`);
  }
  console.log("Next: review the diff, run release checks, then run:");
  console.log(`  npm run release:verify -- ${result.version}`);
} catch (error) {
  console.error(`Failed to prepare release: ${error.message}`);
  process.exitCode = 1;
}
