/**
 * Tile-grid layouts: each region is one equal square, placed on a coarse grid so that neighbours stay roughly neighbours. The positions are
 * hand-made approximations — a tile's place does not give the region's real coordinates, size or border.
 */
export type TileLayout = Record<string, [number, number]>

export interface TileGrid { id: 'korea' | 'world'; label: string; cols: number; rows: number; tiles: TileLayout }

const korea: TileLayout = {
  'KR-28': [0, 0], 'KR-11': [1, 0], 'KR-42': [2, 0],
  'KR-41': [1, 1],
  'KR-44': [0, 2], 'KR-50': [1, 2], 'KR-43': [2, 2], 'KR-47': [3, 2],
  'KR-45': [0, 3], 'KR-30': [1, 3], 'KR-27': [3, 3], 'KR-31': [4, 3],
  'KR-29': [0, 4], 'KR-46': [1, 4], 'KR-48': [2, 4], 'KR-26': [3, 4],
  'KR-49': [1, 5],
}

const worldRows: [string, number, number][] = [
  ['ISL', 3, 0], ['NOR', 5, 0], ['SWE', 6, 0], ['FIN', 7, 0], ['RUS', 9, 0],
  ['CAN', 1, 1], ['IRL', 3, 1], ['GBR', 4, 1], ['DNK', 5, 1], ['POL', 6, 1], ['BLR', 7, 1], ['KAZ', 8, 1], ['MNG', 10, 1], ['PRK', 12, 1],
  ['USA', 1, 2], ['FRA', 4, 2], ['DEU', 5, 2], ['CZE', 6, 2], ['UKR', 7, 2], ['TUR', 8, 2], ['UZB', 9, 2], ['CHN', 10, 2], ['KOR', 12, 2], ['JPN', 13, 2],
  ['MEX', 1, 3], ['PRT', 3, 3], ['ESP', 4, 3], ['ITA', 5, 3], ['ROU', 6, 3], ['GRC', 7, 3], ['IRQ', 8, 3], ['IRN', 9, 3], ['PAK', 10, 3], ['IND', 11, 3], ['MMR', 12, 3], ['VNM', 13, 3],
  ['CUB', 2, 4], ['MAR', 3, 4], ['DZA', 4, 4], ['LBY', 5, 4], ['EGY', 6, 4], ['SAU', 7, 4], ['ARE', 8, 4], ['THA', 12, 4], ['PHL', 13, 4],
  ['COL', 2, 5], ['VEN', 3, 5], ['NGA', 4, 5], ['TCD', 5, 5], ['SDN', 6, 5], ['ETH', 7, 5], ['YEM', 8, 5], ['MYS', 12, 5], ['IDN', 13, 5],
  ['PER', 2, 6], ['BRA', 3, 6], ['AGO', 5, 6], ['COD', 6, 6], ['TZA', 7, 6], ['MOZ', 8, 6], ['AUS', 12, 6], ['PNG', 13, 6],
  ['CHL', 2, 7], ['ARG', 3, 7], ['ZAF', 6, 7], ['MDG', 8, 7], ['NZL', 13, 7],
]

export const tileGrids: Record<'korea' | 'world', TileGrid> = {
  korea: { id: 'korea', label: '대한민국 시도 (17)', cols: 5, rows: 6, tiles: korea },
  world: { id: 'world', label: '세계 주요 국가 (60여 개)', cols: 14, rows: 8, tiles: Object.fromEntries(worldRows.map(([id, c, r]) => [id, [c, r] as [number, number]])) },
}

/** Moves a region to a cell; if another region is there the two swap places. Returns a new layout. */
export function moveTile(layout: TileLayout, id: string, cell: [number, number]): TileLayout {
  const from = layout[id]
  const other = Object.entries(layout).find(([k, v]) => k !== id && v[0] === cell[0] && v[1] === cell[1])?.[0]
  const next = { ...layout, [id]: cell }
  if (other && from) next[other] = from
  return next
}
