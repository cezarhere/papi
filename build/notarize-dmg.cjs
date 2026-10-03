// electron-builder's `notarize` option only covers the .app inside the DMG.
// This hook (afterAllArtifactBuild) also notarizes and staples each .dmg, so
// the disk image itself passes Gatekeeper even when opened offline.
// Skipped (with a log line) when the App Store Connect API env vars are not
// set, so unsigned/local builds keep working.
const { execFileSync } = require("node:child_process");

module.exports = async function notarizeDmgs(context) {
  const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER } = process.env;
  const dmgs = context.artifactPaths.filter((p) => p.endsWith(".dmg"));
  if (!APPLE_API_KEY || !APPLE_API_KEY_ID || !APPLE_API_ISSUER) {
    if (dmgs.length) console.log("  • skipping DMG notarization: APPLE_API_* env vars not set");
    return [];
  }
  for (const dmg of dmgs) {
    console.log(`  • notarizing ${dmg}`);
    execFileSync(
      "xcrun",
      ["notarytool", "submit", dmg, "--key", APPLE_API_KEY, "--key-id", APPLE_API_KEY_ID, "--issuer", APPLE_API_ISSUER, "--wait"],
      { stdio: "inherit" },
    );
    execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });
  }
  return [];
};
