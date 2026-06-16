const { execFileSync } = require("child_process");
const path = require("path");

// Ad-hoc sign the .app after electron-builder's own signing step.
// Without a Developer ID certificate, electron-builder skips signing entirely,
// leaving a completely unsigned app. macOS Ventura/Sonoma marks unsigned apps
// downloaded from the internet as "damaged". Ad-hoc signing (identity "-") is
// not trusted by Apple but prevents the "damaged" state — users get the
// "unidentified developer" dialog instead, which right-click → Open bypasses.
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  console.log(`[after-sign] ad-hoc signing: ${appPath}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
};
