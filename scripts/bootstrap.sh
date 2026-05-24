#!/usr/bin/env bash
# First-time local setup for SPEXR.
# Idempotent: safe to re-run.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

color() { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
info()  { color "1;34" "==> $*"; }
warn()  { color "1;33" "[warn] $*"; }
fail()  { color "1;31" "[fail] $*"; exit 1; }

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"
}

check_node_version() {
    local required_major=20
    local current
    current="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if [ "$current" -lt "$required_major" ]; then
        fail "Node $required_major+ required, found v$current. Use nvm/asdf to switch."
    fi
    info "Node $(node -v) OK"
}

check_pnpm() {
    if ! command -v pnpm >/dev/null 2>&1; then
        warn "pnpm not found; enabling via corepack"
        corepack enable
        corepack prepare pnpm@9.12.0 --activate
    fi
    info "pnpm $(pnpm -v) OK"
}

install_deps() {
    info "Installing workspace dependencies"
    pnpm install --frozen-lockfile=false
}

rebuild_native() {
    info "Rebuilding Electron native modules (@spexr/desktop)"
    pnpm --filter @spexr/desktop run rebuild
}

build_workspace() {
    info "Building all packages"
    pnpm build
}

main() {
    require_cmd node
    check_node_version
    check_pnpm
    install_deps
    rebuild_native
    build_workspace
    info "Bootstrap complete."
    color "1;32" "Next steps:"
    echo "  pnpm dev                       # run in dev mode (Theia)"
    echo "  pnpm --filter @spexr/desktop start   # launch Electron with current build"
    echo "  pnpm --filter @spexr/desktop package # build installers (current OS)"
}

main "$@"
