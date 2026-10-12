/**
 * Brand mark of «الفنان السعودي»: an invoice with a serrated (torn) bottom edge carrying a Sadu
 * weaving pattern. Palette from the approved design: red #9B2C1F, gold #E2A33C, sand #F2E8D5.
 *
 *  - tone="color":  red paper on a light background
 *  - tone="onDark": sand paper on a dark background
 *  - compact:       the simplified glyph used at small sizes (≤ 40px), where the fine lines would blur
 */
export const BRAND_NAME = 'الفنان السعودي';
export const BRAND_TAGLINE = 'برنامج المبيعات والمحاسبة';

const RED = '#9B2C1F';
const GOLD = '#E2A33C';
const SAND = '#F2E8D5';

const BILL =
  'M14,12 Q14,6 20,6 H80 Q86,6 86,12 V100 L80,110 L74,100 L68,110 L62,100 L56,110 L50,100 L44,110 L38,100 L32,110 L26,100 L20,110 L14,100 Z';

interface MarkProps {
  /** height in px (the glyph keeps its 100:116 proportions) */
  size?: number;
  tone?: 'color' | 'onDark';
  compact?: boolean;
  className?: string;
}

export function BrandMark({ size = 40, tone = 'color', compact, className }: MarkProps) {
  const paper = tone === 'color' ? RED : SAND;
  const ink = tone === 'color' ? SAND : RED;
  const small = compact ?? size <= 40;
  return (
    <svg
      viewBox="0 0 100 116"
      width={(size * 100) / 116}
      height={size}
      className={className}
      role="img"
      aria-label={BRAND_NAME}
    >
      <path fill={paper} d={BILL} />
      {small ? (
        <>
          <polygon points="34,20 44,30 34,40 24,30" fill={ink} />
          <polygon points="66,20 76,30 66,40 56,30" fill={GOLD} />
          <rect x="24" y="56" width="52" height="8" rx="4" fill={ink} />
          <rect x="24" y="74" width="30" height="10" rx="3" fill={GOLD} />
        </>
      ) : (
        <>
          <rect x="20" y="16" width="60" height="2" fill={ink} />
          <polygon points="26,22 32,28 26,34 20,28" fill={ink} />
          <polygon points="42,22 48,28 42,34 36,28" fill={GOLD} />
          <polygon points="58,22 64,28 58,34 52,28" fill={ink} />
          <polygon points="74,22 80,28 74,34 68,28" fill={GOLD} />
          <rect x="20" y="38" width="60" height="2" fill={ink} />
          <rect x="36" y="50" width="44" height="4" rx="2" fill={ink} />
          <rect x="50" y="60" width="30" height="4" rx="2" fill={ink} />
          <rect x="62" y="82" width="18" height="4" rx="2" fill={ink} />
          <rect x="20" y="80" width="28" height="8" rx="2" fill={GOLD} />
        </>
      )}
    </svg>
  );
}

/** The Sadu zig-zag rule used under the name. */
export function SaduRule({ width = 120, color = RED, className }: { width?: number; color?: string; className?: string }) {
  return (
    <svg viewBox="0 0 200 16" width={width} height={(width * 16) / 200} className={className} aria-hidden="true">
      <path
        fill={color}
        d="M0,14 L10,2 L20,14 L30,2 L40,14 L50,2 L60,14 L70,2 L80,14 L90,2 L100,14 L110,2 L120,14 L130,2 L140,14 L150,2 L160,14 L170,2 L180,14 L190,2 L200,14 Z"
      />
    </svg>
  );
}

/** Mark + name, for headers. */
export function BrandLockup({ tone = 'color', size = 40 }: { tone?: 'color' | 'onDark'; size?: number }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark size={size} tone={tone} />
      <span
        className={`font-bold leading-tight ${tone === 'onDark' ? 'text-white' : 'text-slate-900'}`}
        style={{ fontFamily: "'Reem Kufi', Tahoma, sans-serif", fontSize: Math.round(size * 0.55) }}
      >
        {BRAND_NAME}
      </span>
    </div>
  );
}
