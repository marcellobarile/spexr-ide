/** Synonym/expansion table for common technical terms. */
const EXPANSIONS: Record<string, string[]> = {
  auth:             ["authentication", "authorization", "authenticate", "login", "session", "token", "credential"],
  authentication:   ["auth", "authenticate", "login", "credential", "session", "token", "signin"],
  authorization:    ["auth", "permission", "role", "access", "privilege", "policy"],
  login:            ["auth", "signin", "authenticate", "credential", "session"],
  logout:           ["signout", "session", "revoke", "invalidate"],
  settings:         ["preferences", "configuration", "config", "options", "prefs"],
  config:           ["configuration", "settings", "options", "preferences", "setup"],
  configuration:    ["config", "settings", "options", "preferences"],
  db:               ["database", "storage", "persistence", "repository", "query"],
  database:         ["db", "storage", "persistence", "repository"],
  api:              ["endpoint", "route", "handler", "service", "interface", "rest", "rpc"],
  endpoint:         ["api", "route", "handler", "controller", "path"],
  ui:               ["frontend", "component", "view", "widget", "render", "display"],
  frontend:         ["browser", "client", "ui", "component", "react", "widget"],
  backend:          ["server", "node", "service", "api", "handler"],
  test:             ["spec", "unit", "mock", "assert", "expect", "vitest", "jest"],
  error:            ["exception", "failure", "fault", "bug", "catch", "throw"],
  log:              ["logging", "logger", "console", "trace", "debug", "output"],
  search:           ["find", "query", "lookup", "filter", "match", "index"],
  file:             ["document", "resource", "asset", "path", "module"],
  user:             ["account", "profile", "member", "identity", "principal"],
  theme:            ["style", "color", "design", "appearance", "visual", "css"],
  command:          ["action", "handler", "execute", "keybinding", "shortcut"],
  widget:           ["panel", "view", "component", "sidebar", "container"],
  plugin:           ["extension", "module", "addon", "contribution"],
  workspace:        ["project", "folder", "directory", "root"],
};

/**
 * Expand a search query with synonyms so that "authentication" also matches
 * code that uses the abbreviation "auth", and vice versa.
 */
export function expandQuery(query: string): string {
  const words = query.toLowerCase().trim().split(/\s+/);
  const expanded = new Set<string>(words);
  for (const word of words) {
    for (const syn of EXPANSIONS[word] ?? []) {
      expanded.add(syn);
    }
  }
  return [...expanded].join(" ");
}
