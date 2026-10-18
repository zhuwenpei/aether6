import { useEffect, useRef, useState } from "react";

interface AetherLaunchSequenceProps {
  ready: boolean;
  showAuthor?: boolean;
  onComplete: () => void;
}

type LaunchPhase = "brand" | "blackout" | "author" | "exit";

/**
 * AETHER 3.7.7 launch sequence.
 *
 * Intentionally renders only the AETHER wordmark on a pure black field.  The reveal is built from
 * duplicated vector strokes plus opacity/transform/stroke-dashoffset animation; no bitmap scene,
 * turbulence filter or full-screen blur is used, keeping the startup compositor-friendly on phones.
 * The creator card is shown on genuine document startup; background/forward restores skip the entire launch sequence.
 */
export default function AetherLaunchSequence({ ready, showAuthor = false, onComplete }: AetherLaunchSequenceProps) {
  const [phase, setPhase] = useState<LaunchPhase>("brand");
  const [minimumBrandTimeElapsed, setMinimumBrandTimeElapsed] = useState(false);
  const transitionStarted = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinimumBrandTimeElapsed(true), 2250);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready || !minimumBrandTimeElapsed || transitionStarted.current) return;
    transitionStarted.current = true;
    setPhase("blackout");

    if (!showAuthor) {
      const exitTimer = window.setTimeout(() => setPhase("exit"), 180);
      const doneTimer = window.setTimeout(onComplete, 760);
      return () => {
        window.clearTimeout(exitTimer);
        window.clearTimeout(doneTimer);
      };
    }

    const authorTimer = window.setTimeout(() => setPhase("author"), 420);
    const exitTimer = window.setTimeout(() => setPhase("exit"), 1860);
    const doneTimer = window.setTimeout(onComplete, 2440);
    return () => {
      window.clearTimeout(authorTimer);
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
  }, [ready, minimumBrandTimeElapsed, showAuthor, onComplete]);

  const wordPaths = [
    "M-292 38 L-254 -40 L-216 38 M-277 9 L-231 9",
    "M-166 -37 H-103 M-166 0 H-111 M-166 37 H-103",
    "M-62 -37 H4 M-29 -37 V39",
    "M49 -37 V39 M112 -37 V39 M49 0 H112",
    "M158 -37 H220 M158 0 H212 M158 37 H220",
    "M260 39 V-37 H294 C316 -37 329 -24 329 -5 C329 15 315 27 294 27 H260 M294 27 L334 39"
  ];

  return (
    <div className={`aether-launch aether-launch--${phase}`} aria-label="AETHER 启动画面">
      <div className="aether-launch__brand" aria-hidden={phase !== "brand" && phase !== "blackout"}>
        <div className="aether-launch__wordstage" role="img" aria-label="AETHER">
          <svg className="aether-launch__wordmark-svg" viewBox="-380 -110 760 220" preserveAspectRatio="xMidYMid meet">
            <g className="aether-launch__wordmark-trace" fill="none" stroke="#ffffff" strokeLinecap="square" strokeLinejoin="miter">
              {wordPaths.map((d, i) => <path key={`trace-${i}`} d={d} pathLength="1" style={{ animationDelay: `${260 + i * 70}ms` }} />)}
            </g>
            <g className="aether-launch__wordmark-crisp" fill="none" stroke="#f8fafc" strokeLinecap="square" strokeLinejoin="miter">
              {wordPaths.map((d, i) => <path key={`crisp-${i}`} d={d} pathLength="1" style={{ animationDelay: `${630 + i * 55}ms` }} />)}
            </g>
          </svg>
        </div>
      </div>

      {showAuthor && (
        <div className="aether-launch__author" aria-hidden={phase !== "author" && phase !== "exit"}>
          <div>Bilibili 晚风渡山月</div>
        </div>
      )}
    </div>
  );
}
