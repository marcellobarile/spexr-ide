import * as React from "react";

/** Decorative blobs; `depth` pairs with the per-class parallax factor in CSS. */
const BLOBS = ["a", "b", "c", "d", "e"] as const;

/** How strongly the pointer pulls the current position each frame (lower = slower). */
const FOLLOW = 0.02;

/**
 * Iridescent, heavily blurred "glass" backdrop for the welcome page.
 *
 * Renders a fixed set of gradient blobs whose hue drifts on their own CSS
 * animation, while a requestAnimationFrame loop eases two CSS custom properties
 * (`--wx`, `--wy`, normalized to roughly -1..1) toward the pointer position so
 * the blobs trail the mouse very slowly via per-blob parallax. Honors
 * `prefers-reduced-motion` by leaving the layer static.
 */
export const WelcomeBackground: React.FC = () => {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let curX = 0;
    let curY = 0;
    let tgtX = 0;
    let tgtY = 0;

    const onMove = (e: MouseEvent): void => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      tgtX = ((e.clientX - r.left) / r.width - 0.5) * 2;
      tgtY = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };

    const tick = (): void => {
      curX += (tgtX - curX) * FOLLOW;
      curY += (tgtY - curY) * FOLLOW;
      el.style.setProperty("--wx", curX.toFixed(4));
      el.style.setProperty("--wy", curY.toFixed(4));
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener("mousemove", onMove);
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className="spexr-welcome-bg" aria-hidden>
      {BLOBS.map((id) => (
        <span key={id} className={`spexr-welcome-bg__blob spexr-welcome-bg__blob--${id}`} />
      ))}
    </div>
  );
};
