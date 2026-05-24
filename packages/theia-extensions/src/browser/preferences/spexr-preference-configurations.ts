import { injectable } from "@theia/core/shared/inversify";
import { PreferenceConfigurations } from "@theia/core/lib/common/preferences/preference-configurations";

/**
 * Stores workspace settings/layout under `.spexr/` instead of `.theia/`.
 *
 * The first entry is the write location; `.theia`/`.vscode` stay as read
 * fallbacks so existing or VS Code-style configs are still picked up.
 */
@injectable()
export class SpexrPreferenceConfigurations extends PreferenceConfigurations {
  override getPaths(): string[] {
    return [".spexr", ".theia", ".vscode"];
  }
}
