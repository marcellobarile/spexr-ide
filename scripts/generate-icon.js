#!/usr/bin/env node
// Usage: node scripts/generate-icon.js
// Converts apps/desktop/build/icon.svg → icon.png (1024×1024).
// electron-builder converts icon.png to .icns (mac) and .ico (win) automatically.
// Run once when the SVG changes; commit the output PNG.

const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const SVG_FILE = path.join(ROOT, "apps", "desktop", "build", "icon.svg");
const PNG_FILE = path.join(ROOT, "apps", "desktop", "build", "icon.png");

async function main() {
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    console.error(
      "Error: sharp not found. Run `pnpm install` first (it is a root devDependency).",
    );
    process.exit(1);
  }

  if (!fs.existsSync(SVG_FILE)) {
    console.error(`Error: SVG source not found at ${SVG_FILE}`);
    process.exit(1);
  }

  await sharp(SVG_FILE).resize(1024, 1024).png({ compressionLevel: 9 }).toFile(PNG_FILE);
  console.log(`Icon generated: ${path.relative(ROOT, PNG_FILE)}`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
