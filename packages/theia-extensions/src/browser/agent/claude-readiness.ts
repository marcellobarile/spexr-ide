/**
 * Pure helpers for detecting when the embedded `claude` CLI is ready to accept
 * typed input. Kept free of Theia/node imports so they are unit-testable and
 * reusable from the terminal manager.
 *
 * The CLI emits no machine-readable readiness handshake over the PTY, so the
 * most deterministic signal available is the input-box footer marker it prints
 * once the REPL is rendered. We match it against ANSI-stripped output.
 */

// CSI (colors, cursor moves) and OSC (window title) escape sequences.
const ANSI_RE = new RegExp(
  String.fromCharCode(27) +
    "\\[[0-9;?]*[ -/]*[@-~]|" +
    String.fromCharCode(27) +
    "\\][^" +
    String.fromCharCode(7) +
    "]*" +
    String.fromCharCode(7),
  "g",
);

/** Marker printed in the claude input-box footer when the REPL is ready. */
export const CLAUDE_READY_RE = /\?\s+for\s+shortcuts/i;

/** Remove ANSI escape sequences from terminal output. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** Whether accumulated (raw) terminal output indicates the CLI is ready. */
export function isClaudeReady(rawOutput: string): boolean {
  return CLAUDE_READY_RE.test(stripAnsi(rawOutput));
}
