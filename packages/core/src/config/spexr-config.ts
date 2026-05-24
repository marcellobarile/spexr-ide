/**
 * SPEXR runtime config — merged from defaults, user prefs, and project prefs
 * in that order. Project always wins on conflict.
 */

export interface SpexrConfig {
  readonly theme: {
    readonly active: string;
    readonly followSystem: boolean;
  };
  readonly agent: {
    readonly autoStart: boolean;
    readonly model: string;
    readonly maxContextTokens: number;
  };
  readonly memory: {
    readonly userScopePath: string;
    readonly projectScopeDir: string;
    readonly indexFile: string;
  };
  readonly spec: {
    readonly dir: string;
    readonly driftDetectorEnabled: boolean;
  };
  readonly onboarding: {
    readonly autoOpenOnFirstRun: boolean;
  };
}

export const DEFAULT_SPEXR_CONFIG: SpexrConfig = {
  theme: {
    active: "dark",
    followSystem: true,
  },
  agent: {
    autoStart: true,
    model: "claude-opus-4-7",
    maxContextTokens: 200_000,
  },
  memory: {
    userScopePath: "~/.spexr/memory",
    // Project memory lives under docs/memory/ relative to the workspace root.
    // resolveSpexrPaths resolves this as: resolve(root, "docs") + "memory".
    projectScopeDir: "docs",
    indexFile: "MEMORY.md",
  },
  spec: {
    // Spec files live under docs/specs/ — the "docs" prefix is the projectScopeDir.
    dir: "specs",
    driftDetectorEnabled: true,
  },
  onboarding: {
    autoOpenOnFirstRun: true,
  },
};

export function mergeConfig(
  base: SpexrConfig,
  ...overrides: ReadonlyArray<DeepPartial<SpexrConfig>>
): SpexrConfig {
  return overrides.reduce<SpexrConfig>(
    (acc, patch) => deepMerge(acc, patch) as SpexrConfig,
    base,
  );
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function deepMerge<T>(target: T, source: DeepPartial<T>): T {
  if (!isPlainObject(source)) return target;
  const out: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [key, value] of Object.entries(source)) {
    const current = out[key];
    if (isPlainObject(value) && isPlainObject(current)) {
      out[key] = deepMerge(current, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
