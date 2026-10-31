import { koreaRows, worldRows } from '../geo/data/stats'
import { createRng, round, type Rng } from '../lib/random'
import { formatISO, DAY_MS } from '../stats/datetime'
import type { Cell, Column, DataTable } from './table'
import type { DatasetDef, DatasetId, DatasetSize } from './datasets'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const date = (name: string): Column => ({ name, type: 'date' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

/** Approximate registered population of the 17 first-level divisions, in thousands (2023, rounded; for learning, not for citation). */
const KR_POP: Record<string, number> = { 'KR-11': 9386, 'KR-26': 3293, 'KR-27': 2371, 'KR-28': 3022, 'KR-29': 1414, 'KR-30': 1438, 'KR-31': 1102, 'KR-50': 387, 'KR-41': 13589, 'KR-42': 1527, 'KR-43': 1595, 'KR-44': 2127, 'KR-45': 1754, 'KR-46': 1790, 'KR-47': 2600, 'KR-48': 3255, 'KR-49': 676 }

const KR_CENTROIDS = new Map(koreaRows.map((r) => [r[0], { name: r[1], lon: r[4], lat: r[5] }]))

/** Real cities (approximate coordinates) used for the synthetic flow data; two lie across the antimeridian from the others on purpose. */
const CITIES: [string, number, number][] = [
  ['서울', 126.98, 37.57], ['도쿄', 139.69, 35.69], ['베이징', 116.4, 39.9], ['싱가포르', 103.82, 1.35], ['두바이', 55.3, 25.2], ['런던', -0.13, 51.51],
  ['파리', 2.35, 48.86], ['뉴욕', -74.0, 40.71], ['로스앤젤레스', -118.24, 34.05], ['상파울루', -46.63, -23.55], ['시드니', 151.21, -33.87],
  ['요하네스버그', 28.05, -26.2], ['뭄바이', 72.88, 19.08], ['오클랜드', 174.76, -36.85], ['호놀룰루', -157.86, 21.31],
]

const NAMES = ['민준', '서연', '도윤', '하은', '시우', '지우', '예준', '서윤', '주원', '수아', '지호', '아윤', '준우', '채원', '현우', '다은', '건우', '소율', '유준', '지민', '선우', '윤서', '은우', '하린', '이안', '나윤', '정우', '유나', '태윤', '세아', '로운', '하준', '시아', '도현', '연우', '아린', '재윤', '다인', '승우', '가온', '민재', '서아', '규민', '예린', '동현', '채윤', '우진', '수빈', '지환', '나은', '시윤', '소민', '한결', '보라', '이든', '은서', '라온', '해인', '태현', '유진']

function gauss(rng: Rng, mean: number, sd: number) { return rng.normal(mean, sd) }

export const datasetsV4: DatasetDef[] = [
  {
    id: 'kr-regions', name: '대한민국 시도별 통계 (근삿값)', description: '17개 시도의 인구(천 명), 대표 좌표(Natural Earth 경계의 중심), 면적(km², 경계 데이터에서 계산)입니다. 인구는 2023년 주민등록 기준을 반올림한 근삿값이며 학습용입니다. 면적은 단순화 전의 경계에서 계산했습니다.',
    generate: () => table([cat('지역'), cat('ID'), num('인구'), num('위도'), num('경도'), num('면적')], koreaRows.map(([id, ko, , area, lon, lat]) => [ko, id, KR_POP[id], lat, lon, area])),
  },
  {
    id: 'world-regions', name: '세계 국가별 통계 (Natural Earth 추정)', description: '176개 국가의 인구(백만 명), 대표 좌표, 면적(km²)과 GDP(십억 달러)입니다. 인구·GDP는 Natural Earth 데이터에 들어 있는 제작 시점(대체로 2019년 전후)의 추정값이고, 면적은 경계에서 계산했습니다. 최신 통계가 아닙니다.',
    generate: () => table([cat('국가'), cat('ID'), num('인구'), num('위도'), num('경도'), num('면적'), num('GDP')], worldRows.map(([id, ko, , , pop, gdp, area, lon, lat]) => [ko, id, pop, lat, lon, area, gdp])),
  },
  {
    id: 'kr-flows', name: '시도 간 이동 (합성)', description: '시도 사이의 연간 이동량을 중력 모형(인구가 클수록, 가까울수록 많음)으로 만든 합성 데이터입니다. 실제 이동 통계가 아닙니다.',
    size: sizes(40, 6, 150, 2, '흐름 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const pairs: [string, string, number][] = []
      for (const a of koreaRows) for (const b of koreaRows) {
        if (a[0] === b[0]) continue
        const d = Math.hypot((a[4] - b[4]) * 0.8, a[5] - b[5]) + 0.2
        pairs.push([a[0], b[0], (KR_POP[a[0]] * KR_POP[b[0]]) ** 0.5 / d ** 1.4 * (0.7 + 0.6 * r())])
      }
      const top = pairs.sort((x, y) => y[2] - x[2]).slice(0, n)
      const scale = 1200 / (top[0]?.[2] || 1)
      return table([cat('출발'), cat('도착'), num('이동량'), num('출발위도'), num('출발경도'), num('도착위도'), num('도착경도')],
        top.map(([a, b, v]) => { const p = KR_CENTROIDS.get(a)!; const q = KR_CENTROIDS.get(b)!; return [p.name, q.name, Math.max(1, Math.round(v * scale)), p.lat, p.lon, q.lat, q.lon] }))
    },
  },
  {
    id: 'world-flows', name: '도시 간 이동 (합성)', description: '열다섯 도시 사이의 연간 이동량(천 명)을 난수로 만든 합성 데이터입니다. 오클랜드·호놀룰루는 날짜변경선 건너편에 있어, 연결선이 지도를 가로지르지 않고 올바르게 이어지는지 볼 수 있습니다.',
    size: sizes(36, 6, 120, 2, '흐름 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const hubs = new Map([['서울', 3], ['도쿄', 3], ['런던', 3], ['뉴욕', 3], ['두바이', 2.5], ['싱가포르', 2.5]])
      const pairs: [number, number, number][] = []
      CITIES.forEach((a, i) => CITIES.forEach((b, j) => { if (i !== j) pairs.push([i, j, (hubs.get(a[0]) ?? 1) * (hubs.get(b[0]) ?? 1) * (0.2 + r())]) }))
      const top = pairs.sort((x, y) => y[2] - x[2]).slice(0, n)
      return table([cat('출발'), cat('도착'), num('이동량'), num('출발위도'), num('출발경도'), num('도착위도'), num('도착경도')],
        top.map(([i, j, v]) => [CITIES[i][0], CITIES[j][0], Math.max(1, Math.round(v * 80)), CITIES[i][2], CITIES[i][1], CITIES[j][2], CITIES[j][1]]))
    },
  },
  {
    id: 'geo-points', name: '위치 데이터 (합성)', description: '대한민국 주요 도시 주변에 난수로 만든 위치와 값입니다. 실제 사건이나 사람의 위치가 아닌 합성 데이터입니다.',
    size: sizes(1500, 100, 20000, 100, '점 개수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const centers: [number, number, number, number][] = [[37.57, 126.98, 0.14, 5], [35.18, 129.08, 0.1, 2.5], [35.87, 128.6, 0.09, 1.8], [37.46, 126.71, 0.08, 2], [35.16, 126.85, 0.08, 1.2], [36.35, 127.38, 0.08, 1.2], [33.5, 126.53, 0.1, 0.8], [37.26, 127.03, 0.1, 2.2], [35.54, 129.31, 0.07, 0.9]]
      const total = centers.reduce((s, c) => s + c[3], 0)
      const rows: Cell[][] = Array.from({ length: n }, () => {
        let u = r() * total
        let c = centers[0]
        for (const q of centers) { if (u < q[3]) { c = q; break } u -= q[3] }
        return [round(c[0] + gauss(r, 0, c[2]), 4), round(c[1] + gauss(r, 0, c[2] * 1.15), 4), round(Math.max(0.1, 1 + 4 * r() * r()), 2)]
      })
      return table([num('위도'), num('경도'), num('값')], rows)
    },
  },
  {
    id: 'studies', name: '메타분석 연구 (오즈비, 합성)', description: '같은 처치를 조사한 연구들의 오즈비(OR)와 95% 신뢰구간, 로그 오즈비의 표준오차입니다. 참 효과는 OR ≈ 0.70(감소)이고, 큰 연구일수록 정밀하게 나오도록 만든 합성 데이터입니다.',
    size: sizes(14, 4, 60, 1, '연구 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      return studyTable(r, n, 0)
    },
  },
  {
    id: 'studies-biased', name: '메타분석 연구 (소규모 연구 효과, 합성)', description: '작은 연구일수록 더 큰 효과가 보고된 비대칭 사례입니다(깔때기 그림이 한쪽으로 기웁니다). 출판 편향의 흉내이지만, 그림의 비대칭만으로 원인을 단정할 수는 없습니다.',
    size: sizes(24, 6, 80, 1, '연구 수'),
    generate: (seed, n) => studyTable(createRng(seed), n, 1.6),
  },
  {
    id: 'paired', name: '두 측정 방법 (합성)', description: '같은 대상을 방법 A와 B로 잰 값입니다. B는 A보다 평균 약 2 높고 값이 클수록 조금 더 벌어지며, 몇 건의 이상한 측정이 섞여 있습니다.',
    size: sizes(60, 10, 500, 5, '대상 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const truth = 60 + 40 * r.normal(0, 0.55) + 40
        const a = truth + r.normal(0, 3)
        let b = truth * 1.03 + 1.5 + r.normal(0, 3.4)
        if (i % 29 === 7) b += (r() < 0.5 ? -1 : 1) * (14 + 6 * r())
        return [round(a, 1), round(b, 1), `대상 ${i + 1}`]
      })
      return table([num('방법 A'), num('방법 B'), cat('대상')], rows)
    },
  },
  {
    id: 'risk-model', name: '위험 예측 모델 (합성, 과신)', description: '양성 비율이 약 20%인 이진 분류 데이터의 예측 확률과 실제 레이블(1 = 양성)입니다. 모델이 확률을 실제보다 극단적으로 말하도록(과신) 만들어서, 구분 능력은 좋아도 보정은 나쁩니다. ROC·PR·보정 곡선을 함께 비교할 수 있습니다.',
    size: sizes(1000, 100, 8000, 100, '표본 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const sig = (x: number) => 1 / (1 + Math.exp(-x))
      const rows: Cell[][] = Array.from({ length: n }, () => {
        const logit = r.normal(-1.7, 1.3)
        const y = r() < sig(logit) ? 1 : 0
        return [round(sig(1.7 * logit + r.normal(0, 0.35)), 4), y]
      })
      return table([num('예측 확률'), num('실제 레이블')], rows)
    },
  },
  {
    id: 'process', name: '공정 측정값 (합성)', description: '시간 간격으로 측정한 부품 치수(목표 50)입니다. 5개씩 한 부분군이며 중간에 평균이 이동하고 이상값이 몇 개 있습니다. 합성 데이터입니다.',
    size: sizes(30, 10, 120, 5, '부분군 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      const start = Date.UTC(2024, 2, 4, 8)
      for (let g = 0; g < n; g++) {
        for (let k = 0; k < 5; k++) {
          const shift = g >= Math.floor(n * 0.62) ? 1.8 : 0
          const spike = g === Math.floor(n * 0.3) && k === 2 ? 7 : 0
          rows.push([formatISO(start + (g * 5 + k) * 3600000, true), round(50 + shift + spike + r.normal(0, 1.4), 2), `S${String(g + 1).padStart(2, '0')}`])
        }
      }
      return table([date('시점'), num('측정값'), cat('부분군')], rows)
    },
  },
  {
    id: 'process-counts', name: '공정 불량·결함 집계 (합성)', description: '일별 검사한 개수와 불량 개수, 단위당 결함 개수입니다. 검사 수가 날마다 달라 p 관리도의 한계가 점마다 변합니다. 합성 데이터입니다.',
    size: sizes(30, 10, 120, 5, '일 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = Array.from({ length: n }, (_, d) => {
        const inspected = r.int(60, 160)
        const p = d >= Math.floor(n * 0.7) ? 0.1 : 0.045
        let defects = 0
        for (let i = 0; i < inspected; i++) if (r() < p) defects++
        let c = 0
        for (let i = 0; i < 40; i++) if (r() < (d >= Math.floor(n * 0.7) ? 0.17 : 0.1)) c++
        return [formatISO(Date.UTC(2024, 2, 1) + d * DAY_MS), defects, inspected, c]
      })
      return table([date('일자'), num('불량 수'), num('검사 수'), num('결함 수')], rows)
    },
  },
  {
    id: 'conversion', name: '구매 전환 퍼널 (합성)', description: '쇼핑몰 방문자가 단계마다 얼마나 남는지 보여 주는 합성 데이터입니다. 단계마다 값이 줄어드는 전형적인 전환 퍼널입니다.',
    generate: (seed) => {
      const r = createRng(seed)
      const stages: [string, number][] = [['방문', 1], ['상품 조회', 0.62], ['장바구니', 0.24], ['결제 시작', 0.14], ['결제 완료', 0.095]]
      return table([cat('단계'), num('인원')], stages.map(([s, f]) => [s, Math.round(12000 * f * (0.96 + 0.08 * r()))]))
    },
  },
  {
    id: 'process-flow', name: '민원 처리 단계 (중간 유입, 합성)', description: '접수부터 완료까지의 처리 건수입니다. ‘승인’ 단계에서 재접수 건이 새로 들어와 값이 앞 단계보다 커집니다 — 전환율만으로는 설명되지 않는 실제 프로세스 형태의 합성 데이터입니다.',
    generate: () => table([cat('단계'), num('건수')], [['접수', 1000], ['검토', 880], ['승인', 940], ['처리', 810], ['완료', 790]]),
  },
  {
    id: 'projects', name: '소프트웨어 프로젝트 일정 (합성)', description: '2024년 3월 4일에 시작하는 가상 프로젝트의 작업 일정입니다. 선행 작업과 진행률이 있고, 의존 관계를 따라 일정이 이어집니다.',
    generate: (seed) => {
      const r = createRng(seed)
      const start = Date.UTC(2024, 2, 4)
      const spec: [string, string, number, string[], number][] = [
        ['요구사항 분석', '기획', 7, [], 100], ['화면 설계', '기획', 9, ['요구사항 분석'], 100], ['데이터 모델링', '개발', 6, ['요구사항 분석'], 100],
        ['API 개발', '개발', 14, ['데이터 모델링'], 80], ['프런트엔드 개발', '개발', 16, ['화면 설계', 'API 개발'], 45], ['인증·권한', '개발', 8, ['API 개발'], 60],
        ['통합 테스트', '품질', 8, ['프런트엔드 개발', '인증·권한'], 10], ['성능 점검', '품질', 5, ['통합 테스트'], 0], ['사용자 문서', '기획', 6, ['화면 설계'], 70],
        ['배포 준비', '운영', 4, ['성능 점검', '사용자 문서'], 0], ['출시', '운영', 1, ['배포 준비'], 0],
      ]
      const end = new Map<string, number>()
      const rows: Cell[][] = spec.map(([name, group, dur, deps, progress]) => {
        const s = deps.length ? Math.max(...deps.map((d) => end.get(d)!)) + DAY_MS : start
        const e = s + (dur + (name === '출시' ? 0 : r.int(0, 2)) - 1) * DAY_MS
        end.set(name, e)
        return [name, formatISO(s), formatISO(e), group, progress, deps.join(',')]
      })
      return table([cat('작업'), date('시작'), date('종료'), cat('그룹'), num('진행률'), cat('선행 작업')], rows)
    },
  },
  {
    id: 'market', name: '지역별 제품군 매출 (합성)', description: '네 지역의 세 제품군 매출(억 원)입니다. 지역의 전체 규모(너비)와 제품군 구성(높이)을 한 그림에 담기 좋은 합성 데이터입니다.',
    generate: (seed) => {
      const r = createRng(seed)
      const regions: [string, number, number[]][] = [['동아시아', 420, [0.5, 0.3, 0.2]], ['유럽', 310, [0.35, 0.4, 0.25]], ['북미', 520, [0.3, 0.35, 0.35]], ['기타', 150, [0.2, 0.3, 0.5]]]
      const products = ['소프트웨어', '하드웨어', '서비스']
      const rows: Cell[][] = []
      for (const [region, total, share] of regions) products.forEach((p, i) => rows.push([region, p, Math.round(total * share[i] * (0.92 + 0.16 * r()))]))
      return table([cat('지역'), cat('제품군'), num('매출')], rows)
    },
  },
  {
    id: 'profile', name: '서버 프로파일 (합성 호출 스택)', description: '가상의 웹 서버를 프로파일링해 모은 호출 스택(함수를 ;로 이은 경로)과 표본 수입니다. 같은 경로의 표본을 모아 한 줄로 둔 형식이며, 실제 프로파일이 아닙니다.',
    size: sizes(1, 1, 5, 1, '배율'),
    generate: (seed, k) => {
      const r = createRng(seed)
      const stacks: [string, number][] = [
        ['main;http.Serve;handler.Index;template.Render', 84], ['main;http.Serve;handler.Index;db.Query;sql.Exec', 130], ['main;http.Serve;handler.Index;db.Query;sql.Scan', 46],
        ['main;http.Serve;handler.Search;index.Lookup;tokenize', 62], ['main;http.Serve;handler.Search;index.Lookup;rank', 118], ['main;http.Serve;handler.Search;template.Render', 31],
        ['main;http.Serve;handler.Upload;io.Copy', 44], ['main;http.Serve;handler.Upload;image.Resize;lanczos', 96], ['main;http.Serve;handler.Upload;image.Resize;alloc', 22],
        ['main;http.Serve;middleware.Auth;jwt.Verify', 38], ['main;http.Serve;middleware.Log', 14], ['main;http.Serve', 19],
        ['main;gc.Mark', 56], ['main;gc.Sweep', 27], ['main;cache.Evict', 17], ['runtime.idle', 40],
      ]
      return table([cat('스택'), num('표본 수')], stacks.map(([s, v]) => [s, Math.max(1, Math.round(v * k * (0.9 + 0.2 * r())))]))
    },
  },
  {
    id: 'affiliations', name: '사람과 모임 (이분 그래프, 합성)', description: '사람들이 어떤 모임에 참여하는지 보여 주는 합성 데이터입니다. 왼쪽은 사람, 오른쪽은 모임이며 사람끼리·모임끼리는 연결되지 않습니다.',
    size: sizes(14, 6, 60, 2, '사람 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const clubs = ['독서', '등산', '요리', '사진', '보드게임', '러닝', '밴드', '코딩']
      const people = Array.from({ length: n }, (_, i) => NAMES[i % NAMES.length] + (i >= NAMES.length ? String(Math.floor(i / NAMES.length) + 1) : ''))
      const rows: Cell[][] = []
      people.forEach((p, i) => {
        const home = i % clubs.length
        const picks = new Set<number>([home])
        if (r() < 0.55) picks.add((home + 1 + r.int(0, 2)) % clubs.length)
        if (r() < 0.2) picks.add(r.int(0, clubs.length - 1))
        for (const c of picks) rows.push([p, clubs[c], r.int(1, 5)])
      })
      return table([cat('사람'), cat('모임'), num('참여도')], rows)
    },
  },
  {
    id: 'modules', name: '모듈 의존 관계 (합성)', description: '가상의 앱 안에서 모듈이 서로를 불러오는 관계입니다. 모듈 이름의 경로(패키지/모듈)가 계층 구조가 되고, 연결선은 그 계층을 따라 묶여 그려집니다.',
    size: sizes(34, 6, 120, 2, '의존 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const mods = ['ui/Button', 'ui/Modal', 'ui/Table', 'ui/Chart', 'ui/Form', 'data/Store', 'data/Cache', 'data/Query', 'data/Schema', 'io/File', 'io/Http', 'io/Socket', 'core/Logger', 'core/Config', 'core/Utils', 'core/Events', 'auth/Session', 'auth/Token', 'report/Export', 'report/Layout']
      const rows: Cell[][] = []
      const seen = new Set<string>()
      let guard = 0
      while (rows.length < n && guard++ < n * 20) {
        const a = mods[r.int(0, mods.length - 1)]
        const b = mods[r.int(0, mods.length - 1)]
        const near = a.split('/')[0] === b.split('/')[0]
        if (a === b || seen.has(`${a}>${b}`) || (near && r() < 0.5)) continue
        seen.add(`${a}>${b}`)
        rows.push([a, b, r.int(1, 4), a.split('/')[0]])
      }
      for (const m of mods) if (!rows.some((q) => q[0] === m || q[1] === m)) rows.push([m, null, null, m.split('/')[0]])
      return table([cat('출발'), cat('도착'), num('가중치'), cat('출발 그룹')], rows)
    },
  },
]

function studyTable(r: Rng, n: number, smallStudyShift: number): DataTable {
  const trueLogOr = Math.log(0.7)
  const rows: Cell[][] = []
  for (let i = 0; i < n; i++) {
    // Standard error of a log odds ratio shrinks as a study gets larger: se ≈ √(4/events).
    const se = 0.08 + 0.5 * r() ** 1.6
    // With a small-study effect, the less precise a study is, the more strongly it favours the treatment.
    const effect = trueLogOr - smallStudyShift * se + r.normal(0, se)
    rows.push([`연구 ${String(i + 1).padStart(2, '0')}`, round(Math.exp(effect), 3), round(Math.exp(effect - 1.959964 * se), 3), round(Math.exp(effect + 1.959964 * se), 3), round(se, 3)])
  }
  return table([cat('연구'), num('효과크기'), num('하한'), num('상한'), num('표준오차')], rows)
}

export const v4Ids: DatasetId[] = datasetsV4.map((d) => d.id)
