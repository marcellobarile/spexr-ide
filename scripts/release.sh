#!/usr/bin/env bash
# Usage: bash scripts/release.sh [patch|minor|major]
# Default bump: patch
# What it does:
#   1. Validates git state (clean working tree, on main)
#   2. Bumps version in apps/desktop/package.json + package.json
#   3. Generates changelog section from commits since last tag
#   4. Prepends section to CHANGELOG.md
#   5. Commits + tags v<new-version>
#   6. Pushes commit + tag  →  GitHub Actions release.yml fires

set -euo pipefail

BUMP="${1:-patch}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── Validation ────────────────────────────────────────────────────────────────

cd "$REPO_ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty. Commit or stash changes first." >&2
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "error: must be on main, currently on '$CURRENT_BRANCH'." >&2
  exit 1
fi

# ── Version bump (pure bash semver) ──────────────────────────────────────────

CURRENT_VERSION="$(node -p "require('./apps/desktop/package.json').version")"
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
  *)
    echo "error: bump must be patch, minor, or major (got '$BUMP')." >&2
    exit 1
    ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
TAG="v${NEW_VERSION}"

echo "Bumping ${CURRENT_VERSION} → ${NEW_VERSION} (${BUMP})"

# Update version fields using node to avoid platform differences with jq/sed
node -e "
const fs = require('fs');
function bump(file) {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.version = '${NEW_VERSION}';
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}
bump('package.json');
bump('apps/desktop/package.json');
"

# ── Changelog ─────────────────────────────────────────────────────────────────

LAST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || echo "")"
DATE="$(date +%Y-%m-%d)"

if [[ -n "$LAST_TAG" ]]; then
  RANGE="${LAST_TAG}..HEAD"
else
  RANGE="HEAD"
fi

# Collect commits: skip chore/release/merge commits for readability
COMMITS="$(git log "$RANGE" --pretty=format:"- %s" \
  --no-merges \
  | grep -v "^- chore: release\|^- Merge " \
  || true)"

if [[ -z "$COMMITS" ]]; then
  COMMITS="- Minor improvements and bug fixes."
fi

CHANGELOG_SECTION="## ${NEW_VERSION} — ${DATE}

${COMMITS}
"

CHANGELOG_FILE="${REPO_ROOT}/CHANGELOG.md"

if [[ -f "$CHANGELOG_FILE" ]]; then
  # Prepend new section after the title line
  EXISTING="$(tail -n +2 "$CHANGELOG_FILE")"
  TITLE="$(head -1 "$CHANGELOG_FILE")"
  printf '%s\n\n%s\n%s\n' "$TITLE" "$CHANGELOG_SECTION" "$EXISTING" > "$CHANGELOG_FILE"
else
  printf '# Changelog\n\n%s\n' "$CHANGELOG_SECTION" > "$CHANGELOG_FILE"
fi

echo "Changelog updated."

# ── Commit, tag, push ─────────────────────────────────────────────────────────

git add package.json apps/desktop/package.json CHANGELOG.md
git commit -m "chore: release ${TAG}"

git tag -a "$TAG" -m "Release ${TAG}"

echo "Pushing ${TAG} → origin (this triggers the GitHub Actions release)…"
git push origin main
git push origin "$TAG"

echo ""
echo "Done. GitHub Actions release.yml will build installers and publish the release."
echo "Track progress: https://github.com/marcellobarile/spexr-ide/actions"
