import { injectable, inject } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { ThemeService } from "@theia/core/lib/browser/theming";

/** Maps a SPEXR theme id to the matching built-in Theia color theme. */
const THEIA_THEME_BY_SPEXR: Record<string, string> = {
  light: "light",
  dark: "dark",
  "high-contrast": "hc-theia",
};

/**
 * Sets the `data-spexr-theme` attribute on the document so the design tokens
 * resolve to a concrete theme, and syncs Theia's own color theme so native
 * chrome (tab bars, editor, terminal) matches the SPEXR tokens. Reads the saved
 * preference (or system) and subscribes to changes via prefers-color-scheme.
 */
@injectable()
export class SpexrThemeContribution implements FrontendApplicationContribution {
  @inject(ThemeService)
  private readonly themeService!: ThemeService;

  onStart(): void {
    const stored = this.readStoredTheme();
    const resolved = stored ?? this.systemPreference();
    this.applyTheme(resolved);

    if (!stored && typeof window !== "undefined" && window.matchMedia) {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", (event) => {
        this.applyTheme(event.matches ? "dark" : "light");
      });
    }
  }

  /** Apply a SPEXR theme to both the design tokens and Theia's native chrome. */
  private applyTheme(spexrTheme: string): void {
    document.documentElement.setAttribute("data-spexr-theme", spexrTheme);
    const theiaId = THEIA_THEME_BY_SPEXR[spexrTheme];
    if (!theiaId || this.themeService.getCurrentTheme().id === theiaId) return;
    if (this.themeService.getThemes().some((t) => t.id === theiaId)) {
      this.themeService.setCurrentTheme(theiaId, true);
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
