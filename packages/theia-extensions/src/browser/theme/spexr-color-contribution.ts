import { injectable } from "@theia/core/shared/inversify";
import type { ColorContribution } from "@theia/core/lib/browser/color-application-contribution";
import type { ColorRegistry } from "@theia/core/lib/browser/color-registry";
import { Color } from "@theia/core/lib/common/color";

/**
 * Overrides Theia's `terminal.background` so the embedded Claude terminal reads
 * darker than the editor it docks beside. Values derive from the active theme's
 * `editor.background`, so light / dark / high-contrast all stay coherent.
 */
@injectable()
export class SpexrColorContribution implements ColorContribution {
  registerColors(colors: ColorRegistry): void {
    colors.register({
      id: "terminal.background",
      defaults: {
        dark: Color.darken("editor.background", 0.35),
        light: Color.darken("editor.background", 0.05),
        hcDark: "editor.background",
        hcLight: "editor.background",
      },
      description:
        "SPEXR: darker terminal background, separating the Claude session from the editor.",
    });
  }
}
