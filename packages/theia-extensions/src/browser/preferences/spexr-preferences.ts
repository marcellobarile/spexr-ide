import { injectable } from "@theia/core/shared/inversify";
import type { PreferenceContribution, PreferenceSchema } from "@theia/core/lib/common/preferences/preference-schema";

/**
 * Key for the Claude Code executable path preference.
 *
 * Leave empty to let the backend auto-detect `claude` from PATH. Set an
 * absolute path to override auto-detection (e.g. when multiple Claude Code
 * installations coexist or the binary is not on PATH).
 */
export const SPEXR_CLAUDE_EXECUTABLE_PREFERENCE = "spexr.claude.executablePath";

/**
 * Key for a custom launch command (shell alias or function) preference.
 *
 * When set, the agent is started through the user's interactive login shell so
 * aliases / functions defined in `.zshrc` / `.bashrc` resolve — e.g. set it to
 * `claude-perso` to run a personal alias instead of the `claude` binary. Takes
 * precedence over {@link SPEXR_CLAUDE_EXECUTABLE_PREFERENCE}. Leave empty to
 * spawn the resolved executable directly.
 */
export const SPEXR_CLAUDE_LAUNCH_COMMAND_PREFERENCE = "spexr.claude.launchCommand";

/**
 * Key for the `CLAUDE_CONFIG_DIR` override preference.
 *
 * When set, the spawned CLI uses this directory for authentication instead of
 * the default `~/.claude`. Populated automatically by the profile quick-pick.
 */
export const SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE = "spexr.claude.configDir";

/**
 * Key for the selected Claude profile identifier preference.
 *
 * Persisted per-folder once the user makes a choice in the quick-pick so the
 * prompt does not appear again for the same workspace. Empty string means
 * the user has not yet chosen.
 */
export const SPEXR_CLAUDE_PROFILE_ID_PREFERENCE = "spexr.claude.profileId";

/**
 * Key for the active expert persona id for this workspace.
 *
 * Folder-scoped. Empty string means no expert is active (base prompt).
 */
export const SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE = "spexr.experts.activeId";

const SpexrPreferencesSchema: PreferenceSchema = {
  properties: {
    [SPEXR_CLAUDE_EXECUTABLE_PREFERENCE]: {
      type: "string",
      default: "",
      description:
        "Path override for the Claude Code CLI binary used by the SPEXR agent. " +
        "Leave empty to auto-detect from PATH. Folder-scoped.",
    },
    [SPEXR_CLAUDE_LAUNCH_COMMAND_PREFERENCE]: {
      type: "string",
      default: "",
      description:
        "Custom command run through your interactive login shell to start the agent, " +
        "so shell aliases/functions resolve (e.g. \"claude-perso\"). Overrides the " +
        "executable path when set. Leave empty to spawn the binary directly. Folder-scoped.",
    },
    [SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE]: {
      type: "string",
      default: "",
      description:
        "CLAUDE_CONFIG_DIR override passed to the spawned CLI. Set automatically " +
        "when a Claude account profile is chosen. Folder-scoped.",
    },
    [SPEXR_CLAUDE_PROFILE_ID_PREFERENCE]: {
      type: "string",
      default: "",
      description:
        "ID of the Claude account profile chosen for this workspace. " +
        "Empty means not yet selected (prompt will appear on next open). Folder-scoped.",
    },
    [SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE]: {
      type: "string",
      default: "",
      description:
        "ID of the active expert persona for this workspace. Empty means no expert " +
        "(base prompt). Set when launching an expert session. Folder-scoped.",
    },
  },
};

/**
 * Registers SPEXR-specific user preferences with the Theia preference system.
 *
 * Bind this class to both its own identifier and to `PreferenceContribution`
 * in the frontend module so the schema is picked up at startup.
 */
@injectable()
export class SpexrPreferenceContribution implements PreferenceContribution {
  readonly schema = SpexrPreferencesSchema;
}
