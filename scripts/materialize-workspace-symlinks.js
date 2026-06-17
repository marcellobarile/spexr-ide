// Replace every pnpm workspace symlink under apps/desktop/node_modules with a
// real, fully-dereferenced copy so electron-builder can package it into the ASAR.
//
// Why this exists: workspace deps (@spexr/*) are linked, not copied, even under
// node-linker=hoisted. The dependency chain is
//   @spexr/desktop -> @spexr/theia-extensions -> @spexr/spec (and others)
// so the symlinks are NESTED:
//   apps/desktop/node_modules/@spexr/theia-extensions            (symlink)
//     -> .../node_modules/@spexr/spec  ("../../../spec")          (nested symlink)
// A shallow copy that only dereferences the top-level symlink leaves the nested
// relative symlink pointing at a path that does not exist inside the copy,
// producing a dangling link and the runtime error:
//   Error: Cannot find module '@spexr/spec/registry'
// fs.cpSync({ recursive, dereference }) resolves symlinks at EVERY depth, which
// fixes both the outer and the nested links on macOS, Linux and Windows alike.

const fs = require("fs");
const path = require("path");

const workspaceRoot = process.cwd();
const desktopNodeModules = path.join(workspaceRoot, "apps", "desktop", "node_modules");

function materialize(linkPath) {
  let real;
  try {
    real = fs.realpathSync(linkPath);
  } catch {
    console.log("skip (unresolvable):", path.relative(workspaceRoot, linkPath));
    return;
  }
  if (real !== linkPath) {
    console.log("materialize:", path.relative(workspaceRoot, linkPath));
    fs.rmSync(linkPath, { recursive: true, force: true });
    fs.cpSync(real, linkPath, { recursive: true, dereference: true });
  }
  // cpSync's dereference handling for symlinks NESTED inside the copied tree is
  // platform/Node-version dependent, so explicitly recurse into any nested
  // node_modules/@spexr and materialize those links too. This guarantees the
  // packaged tree is self-contained (no surviving symlinks) on every platform.
  materializeWorkspaceLinksIn(path.join(linkPath, "node_modules"));
}

function materializeWorkspaceLinksIn(nodeModulesDir) {
  let entries;
  try {
    entries = fs.readdirSync(nodeModulesDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const full = path.join(nodeModulesDir, entry);
    if (entry.startsWith("@")) {
      let children;
      try {
        children = fs.readdirSync(full);
      } catch {
        continue;
      }
      for (const child of children) {
        const childPath = path.join(full, child);
        if (isSymlink(childPath)) materialize(childPath);
      }
    } else if (isSymlink(full)) {
      materialize(full);
    }
  }
}

function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

if (!fs.existsSync(desktopNodeModules)) {
  console.log("no apps/desktop/node_modules — nothing to do");
  process.exit(0);
}

materializeWorkspaceLinksIn(desktopNodeModules);
