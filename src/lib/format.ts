/** Compact, locale-aware number formatting for axes, tooltips and readouts. */
export function fmt(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '–'
  const abs = Math.abs(value)
  if (abs !== 0 && (abs >= 1e7 || abs < 1e-3)) return value.toExponential(2)
  const d = abs >= 1000 ? 0 : abs >= 100 ? Math.min(digits, 1) : digits
  return value.toLocaleString('ko-KR', { maximumFractionDigits: d })
}

export const pct = (value: number, digits = 1) => (Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '–')

/** Axis tick label: trims trailing zeros and abbreviates large values. */
export function tick(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1e6) return `${+(value / 1e6).toFixed(1)}M`
  if (abs >= 1e4) return `${+(value / 1e3).toFixed(1)}k`
  return String(+value.toFixed(abs < 1 && abs > 0 ? 3 : 2))
}
