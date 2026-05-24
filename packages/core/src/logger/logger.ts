/**
 * Minimal structured logger. One implementation surface so subsystems can swap
 * the sink (console, file, telemetry) at composition root without code changes.
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface LogRecord {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly timestamp: number;
}

export interface Logger {
  child(scope: string): Logger;
  trace(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface LogSink {
  write(record: LogRecord): void;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

export class ConsoleLogSink implements LogSink {
  write(record: LogRecord): void {
    const line = `[${new Date(record.timestamp).toISOString()}] ${record.level.toUpperCase()} ${record.scope}: ${record.message}`;
    if (record.level === "error") {
      console.error(line, record.data ?? "");
    } else if (record.level === "warn") {
      console.warn(line, record.data ?? "");
    } else {
      console.info(line, record.data ?? "");
    }
  }
}

export class StructuredLogger implements Logger {
  constructor(
    private readonly scope: string,
    private readonly minLevel: LogLevel,
    private readonly sink: LogSink,
  ) {}

  child(scope: string): Logger {
    return new StructuredLogger(`${this.scope}:${scope}`, this.minLevel, this.sink);
  }

  trace(message: string, data?: Record<string, unknown>): void {
    this.emit("trace", message, data);
  }
  debug(message: string, data?: Record<string, unknown>): void {
    this.emit("debug", message, data);
  }
  info(message: string, data?: Record<string, unknown>): void {
    this.emit("info", message, data);
  }
  warn(message: string, data?: Record<string, unknown>): void {
    this.emit("warn", message, data);
  }
  error(message: string, data?: Record<string, unknown>): void {
    this.emit("error", message, data);
  }

  private emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) return;
    const record: LogRecord = data === undefined
      ? { level, scope: this.scope, message, timestamp: Date.now() }
      : { level, scope: this.scope, message, data, timestamp: Date.now() };
    this.sink.write(record);
  }
}

export function createLogger(scope = "spexr", minLevel: LogLevel = "info"): Logger {
  return new StructuredLogger(scope, minLevel, new ConsoleLogSink());
}
