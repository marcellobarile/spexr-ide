import { injectable } from "@theia/core/shared/inversify";
import { FrontendApplicationContribution } from "@theia/core/lib/browser";

/**
 * Sets the `data-spexr-theme` attribute on the document so the design tokens
 * resolve to a concrete theme. Reads the saved preference (or system) and
 * subscribes to changes via prefers-color-scheme.
 */
@injectable()
export class SpexrThemeContribution implements FrontendApplicationContribution {
  onStart(): void {
    const stored = this.readStoredTheme();
    const resolved = stored ?? this.systemPreference();
    document.documentElement.setAttribute("data-spexr-theme", resolved);
    console.log("[spexr] theme applied:", resolved);

    if (!stored && typeof window !== "undefined" && window.matchMedia) {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", (event) => {
        document.documentElement.setAttribute("data-spexr-theme", event.matches ? "dark" : "light");
      });
    }
  }

  private readStoredTheme(): string | undefined {
    try {
      return globalThis.localStorage?.getItem("spexr.theme") ?? undefined;
    } catch {
      return undefined;
    }
  }

  private systemPreference(): string {
    if (typeof window === "undefined") return "dark";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
}
