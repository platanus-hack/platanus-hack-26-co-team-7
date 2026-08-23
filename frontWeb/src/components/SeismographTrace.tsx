interface SeismographTraceProps {
  /**
   * `brand` — the app's mark: a still hairline broken by a single sharp spike.
   * `alert` — dense irregular trace, scrolling, for an open event.
   */
  variant?: "brand" | "alert";
  className?: string;
}

// The brand rule, traced from the app's login screen: flat baseline, one peak,
// one trough, back to flat. Deliberately still — nothing about the resting
// state should move.
const BRAND_PATH = "M0 20 H228 L236 4 L248 36 L256 20 H320";

// An active trace: irregular amplitude, no repeating rhythm. Starts and ends
// on the baseline so two copies tile seamlessly while scrolling.
const ALERT_PATH =
  "M0 20 L18 20 L24 6 L30 34 L36 12 L42 30 L48 18 L56 20 L74 20 L80 2 L86 38 L92 10 L98 32 L104 20 L130 20 L136 8 L142 30 L148 20 L188 20 L194 4 L200 36 L206 14 L212 28 L218 20 L250 20 L256 12 L262 26 L268 20 L320 20";

export default function SeismographTrace({ variant = "brand", className = "" }: SeismographTraceProps) {
  const isAlert = variant === "alert";
  const path = isAlert ? ALERT_PATH : BRAND_PATH;

  const trace = (key: number, width: string) => (
    <svg key={key} viewBox="0 0 320 40" preserveAspectRatio="none" className={`h-full shrink-0 ${width}`}>
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );

  // The brand mark renders once and holds still; the alert trace tiles twice
  // so the scroll loops without a visible seam.
  return (
    <div className={`overflow-hidden ${className}`} aria-hidden="true">
      {isAlert ? (
        <div className="animate-seismo flex h-full w-[200%]">
          {[0, 1].map((i) => trace(i, "w-1/2"))}
        </div>
      ) : (
        trace(0, "w-full")
      )}
    </div>
  );
}
