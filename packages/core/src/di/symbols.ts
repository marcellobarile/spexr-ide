/**
 * DI symbols. Each subsystem owns its symbol; consumers import from a single
 * location to avoid circular module graphs and to keep the binding surface
 * inspectable in one place.
 */
export const SPEXR_DI = {
  Logger: Symbol.for("spexr.Logger"),
  SpexrConfig: Symbol.for("spexr.SpexrConfig"),
  Paths: Symbol.for("spexr.Paths"),
  MemoryStore: Symbol.for("spexr.MemoryStore"),
  MemoryIndex: Symbol.for("spexr.MemoryIndex"),
  SpecRegistry: Symbol.for("spexr.SpecRegistry"),
  AgentSession: Symbol.for("spexr.AgentSession"),
  OnboardingService: Symbol.for("spexr.OnboardingService"),
  ThemeService: Symbol.for("spexr.ThemeService"),
} as const;

export type SpexrDISymbol = (typeof SPEXR_DI)[keyof typeof SPEXR_DI];
