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
  /**
   * Optional prompt typed into the session automatically right after the
   * expert is launched, once the CLI is ready for input. Lets an expert kick
   * off its work (e.g. produce a report) without the user typing anything.
   */
  readonly kickoffPrompt?: string;
}
