/**
 * Tagged error hierarchy. Subsystems extend `SpexrError` so the shell can
 * pattern-match on `code` for user-facing messages and recovery hints.
 */
export class SpexrError extends Error {
  readonly code: string;
  override readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "SpexrError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class ConfigError extends SpexrError {
  constructor(message: string, cause?: unknown) {
    super("spexr.config", message, cause);
    this.name = "ConfigError";
  }
}

export class MemoryError extends SpexrError {
  constructor(message: string, cause?: unknown) {
    super("spexr.memory", message, cause);
    this.name = "MemoryError";
  }
}

export class SpecError extends SpexrError {
  constructor(message: string, cause?: unknown) {
    super("spexr.spec", message, cause);
    this.name = "SpecError";
  }
}

export class AgentError extends SpexrError {
  constructor(message: string, cause?: unknown) {
    super("spexr.agent", message, cause);
    this.name = "AgentError";
  }
}
