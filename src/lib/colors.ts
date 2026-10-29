import * as d3 from 'd3'

/** Categorical palette tuned for a white background (distinct hues, similar lightness). */
export const palette = ['#2a8c82', '#e07a3f', '#4c6fb5', '#d4a53a', '#9b5fb4', '#5d9a4a', '#cf4f6a', '#4a9bc4', '#8a6d4e', '#6b7280']

export const colorAt = (i: number) => palette[((i % palette.length) + palette.length) % palette.length]

export function categoryColor(domain: readonly string[]) {
  const map = new Map(domain.map((d, i) => [d, colorAt(i)]))
  return (key: string) => map.get(key) ?? '#6b7280'
}

export type SequentialScheme = 'viridis' | 'blues' | 'teal' | 'magma' | 'ylorrd'
export type DivergingScheme = 'rdbu' | 'piyg' | 'brbg'
export type ColorScheme = SequentialScheme | DivergingScheme

export const schemes: Record<ColorScheme, { name: string; diverging: boolean; interpolate: (t: number) => string }> = {
  viridis: { name: 'Viridis', diverging: false, interpolate: d3.interpolateViridis },
  blues: { name: '파랑', diverging: false, interpolate: d3.interpolateBlues },
  teal: { name: '청록', diverging: false, interpolate: d3.interpolateYlGnBu },
  magma: { name: 'Magma', diverging: false, interpolate: d3.interpolateMagma },
  ylorrd: { name: '노랑–빨강', diverging: false, interpolate: d3.interpolateYlOrRd },
  rdbu: { name: '빨강–파랑 (발산)', diverging: true, interpolate: (t) => d3.interpolateRdBu(1 - t) },
  piyg: { name: '분홍–초록 (발산)', diverging: true, interpolate: d3.interpolatePiYG },
  brbg: { name: '갈색–청록 (발산)', diverging: true, interpolate: d3.interpolateBrBG },
}

/** Black or white text, whichever contrasts better with the fill. */
export function textOn(fill: string) {
  const c = d3.rgb(fill)
  const lum = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lum(c.r) + 0.7152 * lum(c.g) + 0.0722 * lum(c.b)
  return L > 0.32 ? '#111827' : '#ffffff'
}
