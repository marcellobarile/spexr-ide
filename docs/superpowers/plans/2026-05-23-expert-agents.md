# Expert Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commits:** This repo's owner commits manually (house rule: never commit/push). Do NOT run `git commit`. Each task ends at a green checkpoint (typecheck/tests/build) instead.

**Goal:** Add a second tab ("Esperti") next to Memory in the right panel: a marketplace of built-in expert personas the user installs into the project (`docs/agents/*.md`) and launches as the active Claude session, with the active expert recognizable in the panel and terminal title.

**Architecture:** An expert is a `--append-system-prompt` persona layered on SPEXR's base prompt, reusing the single embedded `claude` terminal from spec 0003 (one active expert at a time; switching relaunches the terminal). Built-in catalog ships in `@spexr/agent` (backend-only). Installed experts persist as markdown under `docs/agents/`. Active selection is a folder-scoped Theia preference. The frontend does file CRUD via `FileService` (live refresh); the backend supplies the catalog over RPC and reads the active persona file when building launch context.

**Tech Stack:** TypeScript, Eclipse Theia 1.71 (Inversify DI, ReactWidget, AbstractViewContribution, PreferenceService, FileService, TerminalService), Vitest.

---

## File Structure

- `packages/agent/src/experts/types.ts` — `ExpertAgent` domain type (new).
- `packages/agent/src/experts/catalog.ts` — `EXPERT_CATALOG` (4 presets) (new).
- `packages/agent/src/experts/catalog.test.ts` — catalog integrity (new).
- `packages/agent/src/prompt-builder.ts` — add optional persona section (modify).
- `packages/agent/src/prompt-builder.test.ts` — persona section coverage (new).
- `packages/agent/src/index.ts` — re-export experts (modify).
- `packages/theia-extensions/src/common/agent-protocol.ts` — `ExpertAgentDto`, service methods (modify).
- `packages/theia-extensions/src/node/spexr-agent-backend-service.ts` — `listMarketplaceExperts`, `buildLaunchContext(expertId)`, persona-file reader (modify).
- `packages/theia-extensions/src/node/spexr-agent-backend-service.test.ts` — `stripFrontmatter` (new).
- `packages/theia-extensions/src/browser/preferences/spexr-preferences.ts` — active-expert pref (modify).
- `packages/theia-extensions/src/browser/agent/claude-terminal-manager.ts` — expert-aware launch (modify).
- `packages/theia-extensions/src/browser/workspace-paths.ts` — `agentsDir` helper (modify).
- `packages/theia-extensions/src/browser/views/experts-format.ts` — serialize/parse persona file (new).
- `packages/theia-extensions/src/browser/views/experts-format.test.ts` — round-trip (new).
- `packages/theia-extensions/src/browser/views/experts-view-contribution.ts` — view registration (new).
- `packages/theia-extensions/src/browser/views/experts-widget.tsx` — the panel (new).
- `packages/theia-extensions/src/browser/commands/spexr-commands-contribution.ts` — add/remove/start commands (modify).
- `packages/theia-extensions/src/browser/spexr-frontend-module.ts` — bind view + widget (modify).
- `packages/theia-extensions/src/browser/style/spexr.css` — experts panel styles (modify).
- `README.md` — `docs/agents` in workspace layout (modify).
- `docs/specs/0004-expert-agents.md` — status → in-progress (modify).

---

## Task 1: Expert type + built-in catalog (`@spexr/agent`)

**Files:**
- Create: `packages/agent/src/experts/types.ts`
- Create: `packages/agent/src/experts/catalog.ts`
- Create: `packages/agent/src/experts/catalog.test.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/experts/catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EXPERT_CATALOG } from "./catalog.js";

describe("EXPERT_CATALOG", () => {
  it("has unique ids", () => {
    const ids = EXPERT_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the four v1 presets", () => {
    expect(EXPERT_CATALOG.map((e) => e.id).sort()).toEqual(
      ["brainstorming", "design", "marketing", "review"],
    );
  });

  it("has all required fields non-empty", () => {
    for (const e of EXPERT_CATALOG) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.icon.length).toBeGreaterThan(0);
      expect(e.color.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
      expect(e.systemPrompt.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/agent test`
Expected: FAIL — cannot resolve `./catalog.js`.

- [ ] **Step 3: Create the type**

Create `packages/agent/src/experts/types.ts`:

```ts
/**
 * A persona preset that parametrises a Claude session.
 *
 * `systemPrompt` is appended to SPEXR's base prompt via
 * `--append-system-prompt-file`. `model` is optional; when omitted the CLI
 * default model is used. The same shape backs both the built-in catalog and
 * future user-authored experts stored under `docs/agents/`.
 */
export interface ExpertAgent {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly model?: string;
}
```

- [ ] **Step 4: Create the catalog**

Create `packages/agent/src/experts/catalog.ts`:

```ts
import type { ExpertAgent } from "./types.js";

/**
 * Built-in marketplace of expert personas (SPEXR v1).
 *
 * Adding to a project copies one of these into `docs/agents/<id>.md`.
 */
export const EXPERT_CATALOG: readonly ExpertAgent[] = [
  {
    id: "brainstorming",
    name: "Brainstorming",
    icon: "codicon-lightbulb",
    color: "#f5a623",
    description: "Explores the problem space, analyses options, and shapes ideas into directions.",
    systemPrompt: [
      "You are operating as the Brainstorming & Analysis expert.",
      "Open up the problem space before converging: surface assumptions, frame the real",
      "question, and analyse the situation from several angles.",
      "Propose 2-3 distinct directions with trade-offs and a clear recommendation.",
      "Ask one sharp clarifying question at a time when the goal is ambiguous; do not jump to code.",
    ].join("\n"),
  },
  {
    id: "design",
    name: "Progettazione",
    icon: "codicon-symbol-structure",
    color: "#4a90d9",
    description: "Designs architectures and interfaces grounded in the existing codebase.",
    systemPrompt: [
      "You are operating as the Design expert.",
      "Read the existing code and follow its patterns before proposing structure.",
      "Define clear module boundaries and interfaces; each unit has one responsibility.",
      "Produce a concrete blueprint: files to create/modify, data flow, and build order.",
      "Favour the simplest design that satisfies the spec; call out over-engineering.",
    ].join("\n"),
  },
  {
    id: "review",
    name: "Revisione",
    icon: "codicon-search",
    color: "#7c5cff",
    description: "Reviews diffs for bugs, design issues, and missing tests.",
    systemPrompt: [
      "You are operating as the Review expert.",
      "Review changes critically: flag blocking issues, suggestions, and nits, grouped by severity.",
      "Always cite file:line. Look for logic errors, missing tests, and edge cases.",
      "Verify claims against the code; do not praise. Stay within the diff unless a nearby risk is real.",
    ].join("\n"),
  },
  {
    id: "marketing",
    name: "Marketing",
    icon: "codicon-megaphone",
    color: "#e0518a",
    description: "Turns product work into positioning, copy, and launch material.",
    systemPrompt: [
      "You are operating as the Marketing expert.",
      "Translate technical work into user value and clear positioning.",
      "Draft concise, benefit-led copy (announcements, READMEs, release notes) for the target audience.",
      "Propose angles and a short launch checklist; keep claims truthful to what the product does.",
    ].join("\n"),
  },
];
```

- [ ] **Step 5: Re-export from the barrel**

Modify `packages/agent/src/index.ts` to:

```ts
export * from "./prompt-builder.js";
export * from "./experts/types.js";
export * from "./experts/catalog.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @spexr/agent test`
Expected: PASS (3 tests).

- [ ] **Step 7: Checkpoint**

Run: `pnpm --filter @spexr/agent typecheck`
Expected: exit 0.

---

## Task 2: Persona section in the prompt builder (`@spexr/agent`)

**Files:**
- Modify: `packages/agent/src/prompt-builder.ts`
- Create: `packages/agent/src/prompt-builder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/prompt-builder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./prompt-builder.js";

describe("buildSystemPrompt persona", () => {
  it("appends the persona section when expertPrompt is given", () => {
    const out = buildSystemPrompt({
      workspaceRoot: "/tmp/ws",
      expertPrompt: "You are operating as the Review expert.",
    });
    expect(out).toContain("# Expert Persona");
    expect(out).toContain("You are operating as the Review expert.");
    // persona comes after the house rules so project rules still bound it
    expect(out.indexOf("# House Rules")).toBeLessThan(out.indexOf("# Expert Persona"));
  });

  it("omits the persona section when no expertPrompt is given", () => {
    const out = buildSystemPrompt({ workspaceRoot: "/tmp/ws" });
    expect(out).not.toContain("# Expert Persona");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/agent test prompt-builder`
Expected: FAIL — `expertPrompt` not accepted / "# Expert Persona" missing.

- [ ] **Step 3: Add the persona section**

In `packages/agent/src/prompt-builder.ts`, extend the input interface:

```ts
export interface PromptInput {
  readonly workspaceRoot: string;
  readonly activeSpec?: Spec;
  readonly expertPrompt?: string;
}
```

Update `buildSystemPrompt` to append the persona last:

```ts
export function buildSystemPrompt(input: PromptInput): string {
  const sections = [
    identitySection(input.workspaceRoot),
    input.activeSpec ? specSection(input.activeSpec) : "",
    houseRulesSection(),
    input.expertPrompt ? expertSection(input.expertPrompt) : "",
  ].filter((s) => s.length > 0);
  return sections.join("\n\n---\n\n");
}
```

Add the helper at the end of the file:

```ts
function expertSection(persona: string): string {
  return ["# Expert Persona", "", persona].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spexr/agent test prompt-builder`
Expected: PASS (2 tests).

- [ ] **Step 5: Checkpoint**

Run: `pnpm --filter @spexr/agent test && pnpm --filter @spexr/agent typecheck`
Expected: all green.

---

## Task 3: Protocol DTO + service interface (`common`)

**Files:**
- Modify: `packages/theia-extensions/src/common/agent-protocol.ts`

- [ ] **Step 1: Add the DTO**

In `packages/theia-extensions/src/common/agent-protocol.ts`, after `ClaudeProfileDto`, add:

```ts
/**
 * Dependency-light DTO for an expert persona.
 *
 * Mirrors `ExpertAgent` from `@spexr/agent` without importing node-capable code,
 * so the browser bundle can use it. Carried over RPC for the marketplace list.
 */
export interface ExpertAgentDto {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly model?: string;
}
```

- [ ] **Step 2: Extend the service interface**

In the same file, change the `buildLaunchContext` signature and add `listMarketplaceExperts` to `SpexrAgentService`:

```ts
  /**
   * Return the built-in expert marketplace catalog.
   *
   * Always resolves; the list is static and shipped in `@spexr/agent`.
   */
  listMarketplaceExperts(): Promise<ExpertAgentDto[]>;

  /**
   * Build the launch context (system prompt) for the given workspace root.
   *
   * When `expertId` is provided, the persona from `docs/agents/<expertId>.md`
   * is appended to the base prompt. With no `expertId` the prompt is the base
   * (spec 0003 behaviour).
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   * @param expertId       Optional active expert id.
   */
  buildLaunchContext(workspaceRoot: string, expertId?: string): Promise<LaunchContextDto>;
```

(Replace the existing `buildLaunchContext(workspaceRoot: string): Promise<LaunchContextDto>;` declaration and its doc comment.)

- [ ] **Step 3: Checkpoint**

Run: `pnpm --filter @spexr/theia-extensions typecheck`
Expected: FAIL — `SpexrAgentBackendService` does not implement `listMarketplaceExperts` yet (fixed in Task 4). This is the expected red before Task 4.

---

## Task 4: Backend — marketplace list + persona-aware launch context

**Files:**
- Modify: `packages/theia-extensions/src/node/spexr-agent-backend-service.ts`
- Create: `packages/theia-extensions/src/node/spexr-agent-backend-service.test.ts`

- [ ] **Step 1: Write the failing test for the frontmatter stripper**

Create `packages/theia-extensions/src/node/spexr-agent-backend-service.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { stripFrontmatter } from "./spexr-agent-backend-service.js";

describe("stripFrontmatter", () => {
  it("returns the body after a frontmatter block", () => {
    const md = "---\nid: review\nname: Revisione\n---\nYou are the Review expert.\n";
    expect(stripFrontmatter(md).trim()).toBe("You are the Review expert.");
  });

  it("returns the input unchanged when there is no frontmatter", () => {
    expect(stripFrontmatter("no frontmatter here")).toBe("no frontmatter here");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions test spexr-agent-backend-service`
Expected: FAIL — `stripFrontmatter` is not exported.

- [ ] **Step 3: Implement the catalog method, persona reader, and stripper**

In `packages/theia-extensions/src/node/spexr-agent-backend-service.ts`:

Add to the existing `@spexr/agent` import:

```ts
import { buildSystemPrompt, EXPERT_CATALOG } from "@spexr/agent";
```

Add `ExpertAgentDto` to the type import from `../common/agent-protocol.js`:

```ts
import type {
  SpexrAgentService,
  ClaudeProfileDto,
  ExpertAgentDto,
  LaunchContextDto,
  MemoryLinkResult,
} from "../common/agent-protocol.js";
```

Add the marketplace method to the class (next to `detectClaudeProfiles`):

```ts
  async listMarketplaceExperts(): Promise<ExpertAgentDto[]> {
    return EXPERT_CATALOG.map((e) => ({ ...e }));
  }
```

Replace the existing `buildLaunchContext` method body so it threads the persona:

```ts
  async buildLaunchContext(workspaceRoot: string, expertId?: string): Promise<LaunchContextDto> {
    try {
      const paths = resolveSpexrPaths({ projectRoot: workspaceRoot, projectScopeDir: "docs" });
      const specRegistry = new FilesystemSpecRegistry({ directory: paths.specDir });
      const all = await specRegistry.list();
      const activeSpec = all.find((s) => s.frontmatter.status === "in-progress");

      const expertPrompt = expertId ? readInstalledExpertPrompt(workspaceRoot, expertId) : undefined;

      const prompt = buildSystemPrompt({
        workspaceRoot,
        ...(activeSpec ? { activeSpec } : {}),
        ...(expertPrompt ? { expertPrompt } : {}),
      });

      const tmpFile = path.join(os.tmpdir(), `spexr-system-prompt-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, prompt, "utf8");

      return { appendSystemPromptFile: tmpFile };
    } catch {
      return {};
    }
  }
```

Add these module-level helpers near the other module-level functions (e.g. after `ensureSourceMemory`):

```ts
/** Strip a leading `---\n...\n---` frontmatter block, returning the body. */
export function stripFrontmatter(markdown: string): string {
  const match = markdown.match(/^---\n[\s\S]*?\n---\n?/);
  return match ? markdown.slice(match[0].length) : markdown;
}

/**
 * Read the persona body from `docs/agents/<expertId>.md`.
 *
 * Returns `undefined` when the file is missing or empty so the caller falls
 * back to the base prompt.
 */
function readInstalledExpertPrompt(workspaceRoot: string, expertId: string): string | undefined {
  try {
    const file = path.join(workspaceRoot, "docs", "agents", `${expertId}.md`);
    const body = stripFrontmatter(fs.readFileSync(file, "utf8")).trim();
    return body.length > 0 ? body : undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions test spexr-agent-backend-service`
Expected: PASS (2 tests).

- [ ] **Step 5: Checkpoint**

Run: `pnpm --filter @spexr/theia-extensions typecheck`
Expected: exit 0 (Task 3's red is now resolved).

---

## Task 5: Active-expert preference

**Files:**
- Modify: `packages/theia-extensions/src/browser/preferences/spexr-preferences.ts`

- [ ] **Step 1: Add the preference key and schema entry**

In `packages/theia-extensions/src/browser/preferences/spexr-preferences.ts`, add the key after `SPEXR_CLAUDE_PROFILE_ID_PREFERENCE`:

```ts
/**
 * Key for the active expert persona id for this workspace.
 *
 * Folder-scoped. Empty string means no expert is active (base prompt).
 */
export const SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE = "spexr.experts.activeId";
```

Add the schema property inside `SpexrPreferencesSchema.properties`:

```ts
    [SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE]: {
      type: "string",
      default: "",
      description:
        "ID of the active expert persona for this workspace. Empty means no expert " +
        "(base prompt). Set when launching an expert session. Folder-scoped.",
    },
```

- [ ] **Step 2: Checkpoint**

Run: `pnpm --filter @spexr/theia-extensions typecheck`
Expected: exit 0.

---

## Task 6: `agentsDir` path helper

**Files:**
- Modify: `packages/theia-extensions/src/browser/workspace-paths.ts`

- [ ] **Step 1: Add the constant and helper**

In `packages/theia-extensions/src/browser/workspace-paths.ts`, add the constant after `SPECS_DIR`:

```ts
/** Experts subdirectory name inside the docs container. */
export const AGENTS_DIR = "agents";
```

Add the helper after `specsDir`:

```ts
/**
 * Resolves the `docs/agents/` directory URI for the given workspace root.
 *
 * Installed expert personas live here as `<id>.md`, alongside `docs/memory`
 * and `docs/specs`.
 */
export function agentsDir(root: URI): URI {
  return root.resolve(DOCS_DIR).resolve(AGENTS_DIR);
}
```

- [ ] **Step 2: Checkpoint**

Run: `pnpm --filter @spexr/theia-extensions typecheck`
Expected: exit 0.

---

## Task 7: Persona file (de)serialization util

**Files:**
- Create: `packages/theia-extensions/src/browser/views/experts-format.ts`
- Create: `packages/theia-extensions/src/browser/views/experts-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/theia-extensions/src/browser/views/experts-format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { serializeExpertFile, parseExpertFrontmatter } from "./experts-format.js";

describe("experts-format", () => {
  it("round-trips id/name/icon/color through serialize → parse", () => {
    const md = serializeExpertFile({
      id: "review",
      name: "Revisione",
      icon: "codicon-search",
      color: "#7c5cff",
      systemPrompt: "You are the Review expert.",
    });
    const meta = parseExpertFrontmatter(md, "fallback");
    expect(meta).toEqual({
      id: "review",
      name: "Revisione",
      icon: "codicon-search",
      color: "#7c5cff",
    });
  });

  it("includes the system prompt body after the frontmatter", () => {
    const md = serializeExpertFile({
      id: "x",
      name: "X",
      icon: "codicon-person",
      color: "#888",
      systemPrompt: "Body line.",
    });
    expect(md).toContain("---");
    expect(md.trimEnd().endsWith("Body line.")).toBe(true);
  });

  it("returns undefined for content without frontmatter", () => {
    expect(parseExpertFrontmatter("no frontmatter", "id")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions test experts-format`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the util**

Create `packages/theia-extensions/src/browser/views/experts-format.ts`:

```ts
/**
 * (De)serialization for installed expert persona files under `docs/agents/`.
 *
 * Pure string helpers (no Theia/node imports) so they are unit-testable and
 * usable from the browser bundle. The file format is a markdown document with
 * an `id/name/icon/color[/model]` frontmatter block followed by the system
 * prompt body.
 */

/** Fields needed to write a persona file. */
export interface ExpertFileFields {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly systemPrompt: string;
  readonly model?: string;
}

/** Frontmatter metadata read back for the panel (body not included). */
export interface InstalledExpertMeta {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly model?: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const FIELD_RE = /^(id|name|icon|color|model):\s*(.+)$/;

/** Serialize a persona into the `docs/agents/<id>.md` file format. */
export function serializeExpertFile(e: ExpertFileFields): string {
  const lines = ["---", `id: ${e.id}`, `name: ${e.name}`, `icon: ${e.icon}`, `color: ${e.color}`];
  if (e.model) lines.push(`model: ${e.model}`);
  lines.push("---", "", e.systemPrompt.trim(), "");
  return lines.join("\n");
}

/**
 * Parse the frontmatter of a persona file.
 *
 * Returns `undefined` when there is no frontmatter or no usable id/name, so the
 * caller can skip malformed files without crashing the panel.
 *
 * @param markdown    Raw file content.
 * @param idFallback  Used when the frontmatter omits `id` (e.g. derived from filename).
 */
export function parseExpertFrontmatter(
  markdown: string,
  idFallback: string,
): InstalledExpertMeta | undefined {
  const match = markdown.match(FRONTMATTER_RE);
  if (!match) return undefined;
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const m = line.match(FIELD_RE);
    if (m && m[1] && m[2]) fields[m[1]] = m[2].trim();
  }
  const id = fields["id"] ?? idFallback;
  const name = fields["name"];
  if (!id || !name) return undefined;
  return {
    id,
    name,
    icon: fields["icon"] ?? "codicon-person",
    color: fields["color"] ?? "#888888",
    ...(fields["model"] ? { model: fields["model"] } : {}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions test experts-format`
Expected: PASS (3 tests).

- [ ] **Step 5: Checkpoint**

Run: `pnpm --filter @spexr/theia-extensions typecheck`
Expected: exit 0.

---

## Task 8: Expert-aware terminal manager

**Files:**
- Modify: `packages/theia-extensions/src/browser/agent/claude-terminal-manager.ts`

- [ ] **Step 1: Add the active-expert import**

In `claude-terminal-manager.ts`, add to the preferences import block:

```ts
import {
  SPEXR_CLAUDE_EXECUTABLE_PREFERENCE,
  SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE,
  SPEXR_CLAUDE_PROFILE_ID_PREFERENCE,
  SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE,
} from "../preferences/spexr-preferences.js";
import { PreferenceScope } from "@theia/core/lib/common/preferences/preference-scope";
```

(`PreferenceScope` is already imported — keep a single import; do not duplicate.)

- [ ] **Step 2: Add the expert state field**

Add a field next to `private placement`:

```ts
  /** Id of the expert persona the running terminal was launched with. */
  private currentExpertId: string | undefined;
```

- [ ] **Step 3: Refactor `ensureStarted` to resolve the active expert and delegate to a shared launch**

Replace the existing `ensureStarted` method body's launch tail with a call to a shared `launchSession`. The full method becomes:

```ts
  async ensureStarted(): Promise<void> {
    if (this.widget && !this.widget.isDisposed) {
      await this.reveal();
      return;
    }

    const existing = this.terminalService.getById(CLAUDE_TERMINAL_ID);
    if (existing) {
      this.widget = existing;
      existing.setTitle("Agente");
      await this.reveal();
      return;
    }

    const activeId = this.activeExpertId();
    const expert = activeId ? await this.resolveExpert(activeId) : undefined;
    await this.launchSession(expert);
  }
```

- [ ] **Step 4: Add the shared launch + expert helpers**

Add these methods to the class (e.g. after `ensureStarted`):

```ts
  /**
   * Launch a session as the given expert (or the base agent when undefined),
   * reusing the existing terminal slot if a different one is running.
   *
   * @param expert  Minimal expert info for title/icon, or undefined for base.
   */
  async startWithExpert(expert: { id: string; name: string; icon: string }): Promise<void> {
    const firstRoot = this.workspace.tryGetRoots()[0];
    if (firstRoot) {
      await this.preferences.set(
        SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE,
        expert.id,
        PreferenceScope.Folder,
        firstRoot.resource.toString(),
      );
    }
    if (this.widget && !this.widget.isDisposed && this.currentExpertId === expert.id) {
      await this.reveal();
      return;
    }
    this.disposeCurrent();
    await this.launchSession(expert);
  }

  private activeExpertId(): string | undefined {
    const stored = this.preferences.get<string>(SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE) ?? "";
    return stored.trim() || undefined;
  }

  private async resolveExpert(
    id: string,
  ): Promise<{ id: string; name: string; icon: string } | undefined> {
    if (!this.agentService) return undefined;
    try {
      const all = await this.agentService.listMarketplaceExperts();
      const found = all.find((e) => e.id === id);
      return found ? { id: found.id, name: found.name, icon: found.icon } : undefined;
    } catch {
      return undefined;
    }
  }

  private disposeCurrent(): void {
    if (this.widget && !this.widget.isDisposed) this.widget.dispose();
    const adopted = this.terminalService.getById(CLAUDE_TERMINAL_ID);
    adopted?.dispose();
    this.widget = undefined;
    this.currentExpertId = undefined;
  }

  private async launchSession(
    expert?: { id: string; name: string; icon: string },
  ): Promise<void> {
    const firstRoot = this.workspace.tryGetRoots()[0];
    if (!firstRoot) {
      void this.messages.info("SPEXR: open a workspace to start the Claude session.");
      return;
    }
    if (!this.agentService) return;

    const workspaceRoot = firstRoot.resource.path.toString();
    const workspaceUri = firstRoot.resource.toString();

    try {
      const profile = await this.resolveProfile(workspaceUri);
      if (!profile) return;
      await this.linkMemory(workspaceRoot);
      const shellArgs = await this.buildShellArgs(workspaceRoot, expert?.id);
      await this.launch(workspaceRoot, profile, shellArgs, expert);
      this.currentExpertId = expert?.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void this.messages.error(`SPEXR: ${message}`);
    }
  }
```

- [ ] **Step 5: Thread `expertId` through `buildShellArgs`**

Change the signature and first line of `buildShellArgs`:

```ts
  private async buildShellArgs(workspaceRoot: string, expertId?: string): Promise<string[]> {
    const ctx = await this.agentService!.buildLaunchContext(workspaceRoot, expertId);
    if (ctx.appendSystemPromptFile) {
      return ["--append-system-prompt-file", ctx.appendSystemPromptFile];
    }
    if (ctx.appendSystemPromptInline) {
      return ["--append-system-prompt", ctx.appendSystemPromptInline];
    }
    return [];
  }
```

- [ ] **Step 6: Make `launch` set the expert title and icon**

Change `launch`'s signature and the `newTerminal` title/icon:

```ts
  private async launch(
    workspaceRoot: string,
    profile: ClaudeProfileDto,
    shellArgs: string[],
    expert?: { id: string; name: string; icon: string },
  ): Promise<void> {
    const env: { [k: string]: string | null } = profile.configDir
      ? { CLAUDE_CONFIG_DIR: profile.configDir }
      : {};

    const term = await this.terminalService.newTerminal({
      id: CLAUDE_TERMINAL_ID,
      title: expert ? `Agente · ${expert.name}` : "Agente",
      useServerTitle: false,
      iconClass: expert ? `codicon ${expert.icon}` : "codicon codicon-sparkle",
      shellPath: profile.executablePath,
      shellArgs,
      cwd: workspaceRoot,
      env,
      destroyTermOnClose: false,
    });
    await term.start();

    this.widget = term;
    this.placement = "left";
    await this.shell.addWidget(term, { area: "left", rank: 1 });
    await this.reveal();
  }
```

- [ ] **Step 7: Remove the now-duplicated launch tail from the old `ensureStarted`**

Confirm `ensureStarted` no longer contains the old `workspaceRoot`/`resolveProfile`/`launch` block (it now ends with the `launchSession(expert)` call from Step 3). The profile/link/launch logic lives only in `launchSession`.

- [ ] **Step 8: Checkpoint**

Run: `pnpm --filter @spexr/theia-extensions typecheck`
Expected: exit 0.

---

## Task 9: Expert commands (add / remove / start)

**Files:**
- Modify: `packages/theia-extensions/src/browser/commands/spexr-commands-contribution.ts`

- [ ] **Step 1: Import the helpers and DTO type**

Add to the `workspace-paths` import:

```ts
import { memoryDir, specsDir, specContextDir, agentsDir } from "../workspace-paths.js";
```

Add new imports:

```ts
import { serializeExpertFile } from "../views/experts-format.js";
import { SpexrAgentServiceProxy } from "../agent/agent-service-proxy.js";
import type { SpexrAgentService, ExpertAgentDto } from "../../common/agent-protocol.js";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { PreferenceScope } from "@theia/core/lib/common/preferences/preference-scope";
import { SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE } from "../preferences/spexr-preferences.js";
import { optional } from "@theia/core/shared/inversify";
```

(Add `optional` to the existing `@theia/core/shared/inversify` import rather than duplicating it.)

- [ ] **Step 2: Register the command descriptors**

Add to the `SpexrCommands` object (before the closing `} as const;`):

```ts
  EXPERT_ADD: {
    id: "spexr.experts.add",
    label: "Spexr: Add expert to project",
  } satisfies Command,
  EXPERT_REMOVE: {
    id: "spexr.experts.remove",
    label: "Spexr: Remove expert from project",
  } satisfies Command,
  EXPERT_START: {
    id: "spexr.experts.start",
    label: "Spexr: Start session with expert",
  } satisfies Command,
```

- [ ] **Step 3: Inject the agent proxy and preferences**

Add fields to `SpexrCommandsContribution`:

```ts
  @optional()
  @inject(SpexrAgentServiceProxy)
  private readonly agentService!: SpexrAgentService | undefined;

  @inject(PreferenceService)
  private readonly preferences!: PreferenceService;
```

- [ ] **Step 4: Register the command handlers**

In `registerCommands`, add after the `MEMORY_RESOLVE_CONFLICT` registration:

```ts
    commands.registerCommand(SpexrCommands.EXPERT_ADD, {
      execute: (raw: unknown) => this.addExpert(raw),
    });
    commands.registerCommand(SpexrCommands.EXPERT_REMOVE, {
      execute: (raw: unknown) => this.removeExpert(typeof raw === "string" ? raw : undefined),
    });
    commands.registerCommand(SpexrCommands.EXPERT_START, {
      execute: (raw: unknown) => this.startExpert(raw),
    });
```

- [ ] **Step 5: Implement the handlers**

Add these methods to the class (e.g. after `resolveMemoryConflict`):

```ts
  private isExpertDto(raw: unknown): raw is ExpertAgentDto {
    return (
      typeof raw === "object" &&
      raw !== null &&
      typeof (raw as ExpertAgentDto).id === "string" &&
      typeof (raw as ExpertAgentDto).systemPrompt === "string"
    );
  }

  private async addExpert(raw: unknown): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) {
      this.messages.warn("Open a workspace before adding an expert.");
      return;
    }
    if (!this.isExpertDto(raw)) {
      this.messages.warn("Add expert requires an expert definition.");
      return;
    }
    try {
      const dir = agentsDir(root);
      await this.ensureDir(dir);
      const fileUri = dir.resolve(`${raw.id}.md`);
      const content = serializeExpertFile({
        id: raw.id,
        name: raw.name,
        icon: raw.icon,
        color: raw.color,
        systemPrompt: raw.systemPrompt,
        ...(raw.model ? { model: raw.model } : {}),
      });
      await this.fileService.create(fileUri, content, { overwrite: true });
      this.messages.info(`Added expert ${raw.name} to the project.`);
    } catch (err) {
      console.error("[spexr] addExpert failed", err);
      this.messages.error(
        `Add expert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async removeExpert(id: string | undefined): Promise<void> {
    const root = this.workspaceRoot();
    if (!root || !id) {
      this.messages.warn("Remove expert requires a workspace and an expert id.");
      return;
    }
    const fileUri = agentsDir(root).resolve(`${id}.md`);
    const confirmed = await new ConfirmDialog({
      title: `Remove expert "${id}"?`,
      msg: "This deletes the persona file from docs/agents/. You can add it again from the marketplace.",
      ok: "Remove",
      cancel: "Cancel",
      maxWidth: 480,
    }).open();
    if (!confirmed) return;
    try {
      await this.fileService.delete(fileUri, { useTrash: false, recursive: false });
      const active = this.preferences.get<string>(SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE) ?? "";
      if (active === id) {
        await this.preferences.set(
          SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE,
          "",
          PreferenceScope.Folder,
          root.toString(),
        );
      }
      this.messages.info(`Removed expert "${id}".`);
    } catch (err) {
      console.error("[spexr] removeExpert failed", err);
      this.messages.error(
        `Remove expert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async startExpert(raw: unknown): Promise<void> {
    if (!this.isExpertDto(raw)) {
      this.messages.warn("Start expert requires an expert definition.");
      return;
    }
    try {
      await this.claudeTerminal.startWithExpert({ id: raw.id, name: raw.name, icon: raw.icon });
      this.messages.info(`Started session as ${raw.name}.`);
    } catch (err) {
      console.error("[spexr] startExpert failed", err);
      this.messages.error(
        `Start expert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
```

- [ ] **Step 6: Checkpoint**

Run: `pnpm --filter @spexr/theia-extensions typecheck`
Expected: exit 0.

---

## Task 10: Experts view contribution + widget

**Files:**
- Create: `packages/theia-extensions/src/browser/views/experts-view-contribution.ts`
- Create: `packages/theia-extensions/src/browser/views/experts-widget.tsx`

- [ ] **Step 1: Create the view contribution**

Create `packages/theia-extensions/src/browser/views/experts-view-contribution.ts`:

```ts
import { injectable } from "@theia/core/shared/inversify";
import { AbstractViewContribution } from "@theia/core/lib/browser";
import { SpexrExpertsWidget } from "./experts-widget.js";

export const EXPERTS_VIEW_ID = "spexr.view.experts";

@injectable()
export class SpexrExpertsViewContribution extends AbstractViewContribution<SpexrExpertsWidget> {
  constructor() {
    super({
      widgetId: EXPERTS_VIEW_ID,
      widgetName: "Esperti",
      defaultWidgetOptions: {
        area: "right",
        rank: 2,
      },
      toggleCommandId: "spexr.view.experts.toggle",
    });
  }
}
```

- [ ] **Step 2: Create the widget**

Create `packages/theia-extensions/src/browser/views/experts-widget.tsx`:

```tsx
import * as React from "react";
import { injectable, inject, optional, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget, type Message } from "@theia/core/lib/browser";
import { CommandService } from "@theia/core/lib/common/command";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { type FileOperationEvent } from "@theia/filesystem/lib/common/files";
import type URI from "@theia/core/lib/common/uri";
import { EXPERTS_VIEW_ID } from "./experts-view-contribution.js";
import { SpexrCommands } from "../commands/spexr-commands-contribution.js";
import { SpexrAgentServiceProxy } from "../agent/agent-service-proxy.js";
import type { SpexrAgentService, ExpertAgentDto } from "../../common/agent-protocol.js";
import { parseExpertFrontmatter, type InstalledExpertMeta } from "./experts-format.js";
import { SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE } from "../preferences/spexr-preferences.js";
import { agentsDir } from "../workspace-paths.js";

interface ExpertsPanelProps {
  readonly hasWorkspace: boolean;
  readonly marketplace: readonly ExpertAgentDto[];
  readonly installed: readonly InstalledExpertMeta[];
  readonly activeId: string | undefined;
  readonly onAdd: (expert: ExpertAgentDto) => void;
  readonly onRemove: (id: string) => void;
  readonly onStart: (expert: ExpertAgentDto) => void;
  readonly onRefresh: () => void;
}

@injectable()
export class SpexrExpertsWidget extends ReactWidget {
  static readonly ID = EXPERTS_VIEW_ID;

  @inject(CommandService)
  private readonly commands!: CommandService;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(FileService)
  private readonly fileService!: FileService;

  @inject(PreferenceService)
  private readonly preferences!: PreferenceService;

  @optional()
  @inject(SpexrAgentServiceProxy)
  private readonly agentService!: SpexrAgentService | undefined;

  private marketplace: readonly ExpertAgentDto[] = [];
  private installed: readonly InstalledExpertMeta[] = [];

  constructor() {
    super();
    this.id = SpexrExpertsWidget.ID;
    this.title.label = "Esperti";
    this.title.caption = "Expert agents marketplace";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-organization";
    this.addClass("spexr-experts-widget");
  }

  @postConstruct()
  protected init(): void {
    this.toDispose.push(this.workspace.onWorkspaceChanged(() => void this.refresh()));
    this.toDispose.push(
      this.fileService.onDidRunOperation((event) => {
        if (this.affectsAgents(event)) void this.refresh();
      }),
    );
    this.toDispose.push(
      this.preferences.onPreferenceChanged((e) => {
        if (e.preferenceName === SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE) this.update();
      }),
    );
    void this.refresh();
    this.update();
  }

  protected override onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this.update();
  }

  private affectsAgents(event: FileOperationEvent): boolean {
    const root = this.workspaceRoot();
    if (!root) return false;
    const agentsRoot = agentsDir(root).toString() + "/";
    const candidates = [event.resource, event.target?.resource].filter(
      (u): u is URI => u !== undefined,
    );
    return candidates.some(
      (uri) => uri.toString().startsWith(agentsRoot) && uri.path.base.endsWith(".md"),
    );
  }

  private async refresh(): Promise<void> {
    this.marketplace = this.agentService ? await this.safeMarketplace() : [];
    this.installed = await this.loadInstalled();
    this.update();
  }

  private async safeMarketplace(): Promise<readonly ExpertAgentDto[]> {
    try {
      return await this.agentService!.listMarketplaceExperts();
    } catch {
      return [];
    }
  }

  private async loadInstalled(): Promise<readonly InstalledExpertMeta[]> {
    const root = this.workspaceRoot();
    if (!root) return [];
    try {
      const stat = await this.fileService.resolve(agentsDir(root));
      const items: InstalledExpertMeta[] = [];
      for (const child of stat.children ?? []) {
        if (!child.isFile || !child.name.endsWith(".md")) continue;
        try {
          const file = await this.fileService.read(child.resource);
          const meta = parseExpertFrontmatter(file.value, child.name.replace(/\.md$/, ""));
          if (meta) items.push(meta);
        } catch {
          // skip unreadable file
        }
      }
      return items.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  private workspaceRoot(): URI | undefined {
    return this.workspace.tryGetRoots()[0]?.resource;
  }

  private activeId(): string | undefined {
    const stored = this.preferences.get<string>(SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE) ?? "";
    return stored.trim() || undefined;
  }

  private readonly handleAdd = (expert: ExpertAgentDto): void => {
    void this.commands
      .executeCommand(SpexrCommands.EXPERT_ADD.id, expert)
      .then(() => this.refresh());
  };

  private readonly handleRemove = (id: string): void => {
    void this.commands
      .executeCommand(SpexrCommands.EXPERT_REMOVE.id, id)
      .then(() => this.refresh());
  };

  private readonly handleStart = (expert: ExpertAgentDto): void => {
    void this.commands.executeCommand(SpexrCommands.EXPERT_START.id, expert).then(() => this.update());
  };

  private readonly handleRefresh = (): void => {
    void this.refresh();
  };

  protected render(): React.ReactNode {
    return (
      <ExpertsPanel
        hasWorkspace={Boolean(this.workspaceRoot())}
        marketplace={this.marketplace}
        installed={this.installed}
        activeId={this.activeId()}
        onAdd={this.handleAdd}
        onRemove={this.handleRemove}
        onStart={this.handleStart}
        onRefresh={this.handleRefresh}
      />
    );
  }
}

const ExpertsPanel: React.FC<ExpertsPanelProps> = ({
  hasWorkspace,
  marketplace,
  installed,
  activeId,
  onAdd,
  onRemove,
  onStart,
  onRefresh,
}) => {
  const installedIds = new Set(installed.map((e) => e.id));
  const available = marketplace.filter((e) => !installedIds.has(e.id));
  const dtoById = new Map(marketplace.map((e) => [e.id, e]));

  if (!hasWorkspace) {
    return (
      <section className="spexr-experts-panel" aria-label="Expert agents">
        <p className="spexr-experts-panel__empty">Open a workspace to manage expert agents.</p>
      </section>
    );
  }

  return (
    <section className="spexr-experts-panel" aria-label="Expert agents">
      <header className="spexr-experts-panel__header">
        <h2>Esperti</h2>
        <p className="spexr-experts-panel__hint">
          Add an expert persona to the project, then start a Claude session as that expert.
          One expert is active at a time.
        </p>
      </header>

      <div className="spexr-experts-panel__actions">
        <button type="button" className="spexr-button" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      <div className="spexr-experts-panel__section">
        <h3 className="spexr-experts-panel__subtitle">Nel progetto</h3>
        {installed.length === 0 ? (
          <p className="spexr-experts-panel__empty">
            No experts yet. Add one from the marketplace below.
          </p>
        ) : (
          <ul className="spexr-experts-list" role="list">
            {installed.map((e) => {
              const isActive = e.id === activeId;
              const dto = dtoById.get(e.id);
              return (
                <li
                  key={e.id}
                  className={`spexr-experts-list__item${isActive ? " spexr-experts-list__item--active" : ""}`}
                  style={isActive ? { borderColor: e.color, background: `${e.color}1f` } : undefined}
                >
                  <span className={`codicon ${e.icon} spexr-experts-list__icon`} style={{ color: e.color }} />
                  <span className="spexr-experts-list__name">{e.name}</span>
                  {isActive ? <span className="spexr-experts-list__active">● attivo</span> : null}
                  <span className="spexr-experts-list__buttons">
                    {dto && !isActive ? (
                      <button
                        type="button"
                        className="spexr-button spexr-button--compact"
                        onClick={() => onStart(dto)}
                      >
                        Avvia
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="spexr-button spexr-button--ghost spexr-button--compact spexr-button--danger"
                      onClick={() => onRemove(e.id)}
                    >
                      Rimuovi
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="spexr-experts-panel__section">
        <h3 className="spexr-experts-panel__subtitle">Marketplace</h3>
        {available.length === 0 ? (
          <p className="spexr-experts-panel__empty">All marketplace experts are already in the project.</p>
        ) : (
          <ul className="spexr-experts-list" role="list">
            {available.map((e) => (
              <li key={e.id} className="spexr-experts-list__item">
                <span className={`codicon ${e.icon} spexr-experts-list__icon`} style={{ color: e.color }} />
                <span className="spexr-experts-list__meta">
                  <span className="spexr-experts-list__name">{e.name}</span>
                  <span className="spexr-experts-list__desc">{e.description}</span>
                </span>
                <span className="spexr-experts-list__buttons">
                  <button
                    type="button"
                    className="spexr-button spexr-button--compact"
                    onClick={() => onAdd(e)}
                  >
                    + Aggiungi
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
```

- [ ] **Step 3: Checkpoint**

Run: `pnpm --filter @spexr/theia-extensions typecheck`
Expected: FAIL — `SpexrExpertsWidget`/view not yet bound (DI wiring is Task 11). Compilation of the files themselves should report no type errors; binding errors are runtime, so typecheck should actually pass here. If typecheck reports unused-symbol or import errors, fix them before moving on.

---

## Task 11: Wire the experts view into DI

**Files:**
- Modify: `packages/theia-extensions/src/browser/spexr-frontend-module.ts`

- [ ] **Step 1: Import the experts view and widget**

Add after the memory view import:

```ts
import {
  SpexrExpertsViewContribution,
  EXPERTS_VIEW_ID,
} from "./views/experts-view-contribution.js";
import { SpexrExpertsWidget } from "./views/experts-widget.js";
```

- [ ] **Step 2: Bind the view + widget factory**

Add right after the memory-view binding block (after the `MEMORY_VIEW_ID` `WidgetFactory` binding):

```ts
  bindViewContribution(bind, SpexrExpertsViewContribution);
  bind(SpexrExpertsWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: EXPERTS_VIEW_ID,
      createWidget: () => ctx.container.get(SpexrExpertsWidget),
    }))
    .inSingletonScope();
```

- [ ] **Step 3: Checkpoint**

Run: `pnpm --filter @spexr/theia-extensions typecheck`
Expected: exit 0.

---

## Task 12: Experts panel styles

**Files:**
- Modify: `packages/theia-extensions/src/browser/style/spexr.css`

- [ ] **Step 1: Append the experts styles**

Add to the end of `packages/theia-extensions/src/browser/style/spexr.css`:

```css
.spexr-experts-panel {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.spexr-experts-panel__hint {
  color: var(--theia-descriptionForeground);
  font-size: 12px;
  margin: 4px 0 0;
}

.spexr-experts-panel__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.spexr-experts-panel__subtitle {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--theia-descriptionForeground);
  margin: 0;
}

.spexr-experts-panel__empty {
  color: var(--theia-descriptionForeground);
  font-size: 12px;
}

.spexr-experts-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.spexr-experts-list__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--theia-editorWidget-border);
  border-radius: 8px;
}

.spexr-experts-list__item--active {
  border-width: 2px;
}

.spexr-experts-list__icon {
  flex: 0 0 auto;
}

.spexr-experts-list__meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.spexr-experts-list__name {
  font-weight: 600;
}

.spexr-experts-list__desc {
  font-size: 11px;
  color: var(--theia-descriptionForeground);
  overflow-wrap: anywhere;
}

.spexr-experts-list__active {
  font-size: 11px;
  color: var(--theia-descriptionForeground);
}

.spexr-experts-list__buttons {
  margin-left: auto;
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}
```

- [ ] **Step 2: Checkpoint (full build picks up the CSS via copy-assets)**

Run: `pnpm --filter @spexr/theia-extensions build`
Expected: exit 0; `lib/browser/style/spexr.css` updated.

---

## Task 13: Docs — README workspace layout + spec status

**Files:**
- Modify: `README.md`
- Modify: `docs/specs/0004-expert-agents.md`

- [ ] **Step 1: Add `docs/agents` to the README workspace layout**

In `README.md`, in the "Workspace layout" code block, add the `agents/` line under `docs/`:

```
<your-workspace>/
└── docs/
    ├── agents/          Installed expert personas (<id>.md)
    ├── memory/          Project-scope memory (markdown + MEMORY.md index)
    └── specs/           NNNN-<slug>.md spec files
```

- [ ] **Step 2: Flip the spec status to in-progress**

In `docs/specs/0004-expert-agents.md` frontmatter, change `status: draft` to `status: in-progress`.

- [ ] **Step 3: Checkpoint (no code; doc-only)**

No command needed.

---

## Task 14: Full validation

- [ ] **Step 1: Typecheck everything**

Run: `pnpm typecheck`
Expected: all packages green (15/15).

- [ ] **Step 2: Run the affected test suites**

Run: `pnpm --filter @spexr/agent test && pnpm --filter @spexr/theia-extensions test && pnpm --filter @spexr/spec test`
Expected: agent (catalog + prompt-builder), theia-extensions (detector + backend-service + experts-format), spec — all pass.

- [ ] **Step 3: Build the bundles (no node-scheme leak)**

Run: `pnpm build:dev`
Expected: all bundles compile. `@spexr/agent` is only imported by backend code, so the catalog must not appear in the frontend bundle; the `experts-format.ts` util the frontend imports is pure (no node imports).

- [ ] **Step 4: Lint the touched files**

Run: `pnpm --filter @spexr/agent lint && pnpm --filter @spexr/theia-extensions lint`
Expected: no new errors (pre-existing repo lint state unchanged).

---

## Manual end-to-end (run the app — owner-driven)

1. Open a workspace → right panel shows two tabs: **Memory** and **Esperti**.
2. Esperti → Marketplace lists 4 experts (Brainstorming, Progettazione, Revisione, Marketing). "+ Aggiungi" on Revisione → `docs/agents/review.md` is created and Revisione moves to "Nel progetto".
3. "Avvia" on Revisione → the left terminal relaunches; its title reads `Agente · Revisione` with the search icon; the panel highlights Revisione with its accent color and "● attivo".
4. In the session, the persona is active (the agent behaves as a reviewer). `/model` and slash commands still work (terminal fidelity from spec 0003).
5. "Avvia" on another installed expert → terminal relaunches with the new persona; the previous one is replaced (its history recoverable via the CLI `/resume`).
6. "Rimuovi" on the active expert → confirm → `docs/agents/<id>.md` deleted, `spexr.experts.activeId` cleared; next launch uses the base prompt.
