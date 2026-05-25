import type { ApplicationShell } from "@theia/core/lib/browser";

/** Minimum width (px) for the left side panel that hosts the agent terminal. */
export const MIN_LEFT_PANEL_WIDTH = 480;

/** Minimum width (px) for the right side panel that hosts spec/memory/experts. */
export const MIN_RIGHT_PANEL_WIDTH = 400;

type PanelSide = "left" | "right";

interface SidePanelHandlerLike {
  expand?: () => void;
  resize?: (size: number) => void;
  getPanelSize?: () => number | undefined;
  readonly state?: { pendingUpdate?: Promise<unknown> };
}

/**
 * Expand a side panel and enforce a usable minimum width.
 *
 * Lumino positions split children with an explicit inline width, so a CSS
 * `min-width` is ignored. The floor is applied through the handler's `resize`
 * API after the expand animation settles, leaving a wider user-chosen width
 * untouched.
 *
 * @param shell  The application shell.
 * @param side   Which side panel to expand.
 * @param min    Minimum width in pixels to enforce.
 */
export function expandSidePanelWithMinWidth(
  shell: ApplicationShell,
  side: PanelSide,
  min: number,
): void {
  const raw = side === "left" ? shell.leftPanelHandler : shell.rightPanelHandler;
  const handler = raw as unknown as SidePanelHandlerLike | undefined;
  if (typeof handler?.expand !== "function") return;
  handler.expand();
  const enforce = (): void => {
    const size = handler.getPanelSize?.();
    if (typeof size !== "number" || size < min) {
      handler.resize?.(min);
    }
  };
  const pending = handler.state?.pendingUpdate;
  if (pending) void pending.then(enforce);
  else enforce();
}

/** Expand the left side panel and enforce {@link MIN_LEFT_PANEL_WIDTH}. */
export function expandLeftPanelWithMinWidth(shell: ApplicationShell): void {
  expandSidePanelWithMinWidth(shell, "left", MIN_LEFT_PANEL_WIDTH);
}

/** Expand the right side panel and enforce {@link MIN_RIGHT_PANEL_WIDTH}. */
export function expandRightPanelWithMinWidth(shell: ApplicationShell): void {
  expandSidePanelWithMinWidth(shell, "right", MIN_RIGHT_PANEL_WIDTH);
}
