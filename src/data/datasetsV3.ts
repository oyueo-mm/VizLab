import { createRng, round } from '../lib/random'
import { formatISO, addMonths, DAY_MS } from '../stats/datetime'
import { bandsFromSigma } from '../stats/fan'
import type { Cell, Column, DataTable } from './table'
import type { DatasetDef, DatasetId, DatasetSize } from './datasets'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const date = (name: string): Column => ({ name, type: 'date' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

/** Splits `total` into integer parts proportional to `weights` (largest remainder), so the parts always add up exactly. */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0) || 1
  const raw = weights.map((w) => (w / sum) * total)
  const out = raw.map(Math.floor)
  let left = total - out.reduce((s, v) => s + v, 0)
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0])
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++
  return out
}

const NAMES = ['민준', '서연', '도윤', '하은', '시우', '지우', '예준', '서윤', '주원', '수아', '지호', '아윤', '준우', '채원', '현우', '다은', '건우', '소율', '유준', '지민', '선우', '윤서', '은우', '하린', '이안', '나윤', '정우', '유나', '태윤', '세아', '로운', '하준', '시아', '도현', '연우', '아린', '재윤', '다인', '승우', '가온', '민재', '서아', '규민', '예린', '동현', '채윤', '우진', '수빈', '지환', '나은', '시윤', '소민', '한결', '보라', '이든', '은서', '라온', '해인', '태현', '유진', '성민', '다온', '진우', '하늘', '재원', '별', '단우', '새봄', '지안', '솔', '도하', '이레', '건', '시현', '아라', '찬영', '하랑', '정민', '미소', '현서', '온유']

export const datasetsV3: DatasetDef[] = [
  {
    id: 'visits-dated', name: '일별 방문자 (날짜형)', description: '2024년 1월 1일부터 세 유입 채널의 일별 방문자 수입니다. 날짜 열이 실제 날짜형이고 주말에 방문자가 줄어듭니다. 합성 데이터입니다.',
    size: sizes(120, 14, 731, 1, '일 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const series = [{ name: '검색', base: 1200, trend: 2.2, amp: 160, weekend: -220 }, { name: 'SNS', base: 600, trend: 3.6, amp: 90, weekend: 140 }, { name: '직접 유입', base: 900, trend: 0.6, amp: 40, weekend: -80 }]
      const rows: Cell[][] = []
      const start = Date.UTC(2024, 0, 1)
      for (let d = 0; d < n; d++) {
        const t = start + d * DAY_MS
        const dow = new Date(t).getUTCDay()
        for (const s of series) {
          const v = s.base + s.trend * d + s.amp * Math.sin((d / 30.4) * 2 * Math.PI) + (dow === 0 || dow === 6 ? s.weekend : 0) + r.normal(0, s.amp * 0.3)
          rows.push([formatISO(t), s.name, Math.max(0, Math.round(v))])
        }
      }
      return table([date('날짜'), cat('채널'), num('방문자')], rows)
    },
  },
  {
    id: 'inventory', name: '재고 변동 (불규칙 시점)', description: '두 품목의 창고 재고가 팔릴 때마다 줄고 가끔 입고되어 뛰어오르는 기록입니다. 기록 시점의 간격이 불규칙해 값이 다음 변화까지 유지되는 계단 모양이 잘 맞습니다. 합성 데이터입니다.',
    size: sizes(30, 6, 200, 2, '기록 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const items = [{ name: '품목 A', stock: 120, restock: 150, rate: [4, 14] as const }, { name: '품목 B', stock: 80, restock: 100, rate: [2, 9] as const }]
      const rows: Cell[][] = []
      const start = Date.UTC(2024, 0, 1)
      for (const it of items) {
        let t = start
        let stock = it.stock
        for (let i = 0; i < n; i++) {
          rows.push([formatISO(t), it.name, stock])
          t += (1 + r.int(0, 8)) * DAY_MS
          stock -= r.int(it.rate[0], it.rate[1]) * (1 + r.int(0, 2))
          if (stock < 20) stock += it.restock
        }
      }
      return table([date('날짜'), cat('품목'), num('재고')], rows)
    },
  },
  {
    id: 'sensors', name: '센서 편차 (시간 단위)', description: '2024년 3월 1일 0시부터 네 센서가 기준값에서 벗어난 정도입니다. 하루 주기와 가끔의 이상 신호가 있습니다. 합성 데이터입니다.',
    size: sizes(168, 48, 720, 24, '시간 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const sensors = [{ name: '온도', amp: 3.2, phase: 0 }, { name: '습도', amp: 5, phase: 2.4 }, { name: '진동', amp: 1.6, phase: 4.1 }, { name: '전류', amp: 2.4, phase: 1.2 }]
      const spikes = sensors.map(() => Array.from({ length: 3 }, () => ({ at: r.int(6, Math.max(7, n - 6)), mag: (r() < 0.5 ? -1 : 1) * (2 + 3 * r()) })))
      const rows: Cell[][] = []
      const start = Date.UTC(2024, 2, 1)
      for (let h = 0; h < n; h++) {
        sensors.forEach((s, si) => {
          let v = s.amp * Math.sin(((h % 24) / 24) * 2 * Math.PI + s.phase) + r.normal(0, s.amp * 0.18)
          for (const sp of spikes[si]) v += sp.mag * s.amp * 0.5 * Math.exp(-(((h - sp.at) / 2.5) ** 2))
          rows.push([formatISO(start + h * 3600000, true), s.name, round(v, 2)])
        })
      }
      return table([date('시각'), cat('센서'), num('편차')], rows)
    },
  },
  {
    id: 'ohlc', name: '가상 주가 (OHLC)', description: '영업일 기준 일별 시가·고가·저가·종가·거래량입니다. 실제 시세가 아니라 난수로 만든 합성 데이터입니다.',
    size: sizes(60, 10, 500, 5, '영업일 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      let price = 100
      let t = Date.UTC(2024, 0, 2)
      while (rows.length < n) {
        const dow = new Date(t).getUTCDay()
        if (dow !== 0 && dow !== 6) {
          const drift = 0.0006 + 0.0004 * Math.sin(rows.length / 14)
          const open = price * (1 + r.normal(0, 0.004))
          const close = open * (1 + drift + r.normal(0, 0.017))
          const high = Math.max(open, close) * (1 + Math.abs(r.normal(0, 0.007)))
          const low = Math.min(open, close) * (1 - Math.abs(r.normal(0, 0.007)))
          const volume = Math.round((900 + 600 * Math.abs((close - open) / open) * 40 + r.normal(0, 120)) * 10)
          rows.push([formatISO(t), round(open, 2), round(high, 2), round(low, 2), round(close, 2), Math.max(50, volume)])
          price = close
        }
        t += DAY_MS
      }
      return table([date('날짜'), num('시가'), num('고가'), num('저가'), num('종가'), num('거래량')], rows)
    },
  },
  {
    id: 'forecast', name: '예측 구간 데이터', description: '월별 매출(관측값)과 이후 12개월의 예측 중심값, 50%·80%·95% 예측구간입니다. 예측 첫 6개월에는 나중에 알게 된 실제 값이 있어 구간이 맞았는지 비교할 수 있습니다. 합성 데이터입니다.',
    size: sizes(36, 12, 96, 6, '관측 개월 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const level = (m: number) => 200 + 1.6 * m + 24 * Math.sin((m / 12) * 2 * Math.PI)
      const sigma0 = 7
      const rows: Cell[][] = []
      const start = Date.UTC(2021, 0, 1)
      for (let m = 0; m < n; m++) rows.push([formatISO(addMonths(start, m)), round(level(m) + r.normal(0, sigma0), 1), null, null, null, null, null, null, null])
      for (let h = 1; h <= 12; h++) {
        const m = n - 1 + h
        const sigma = sigma0 * Math.sqrt(1 + 0.45 * h)
        const center = level(m) + 1.2 * Math.sin(h)
        const b = bandsFromSigma(center, sigma)
        const actual = h <= 6 ? round(level(m) + r.normal(0, sigma0 * Math.sqrt(1 + 0.2 * h)), 1) : null
        rows.push([formatISO(addMonths(start, m)), actual, round(center, 1), round(b.lo[0.5], 1), round(b.hi[0.5], 1), round(b.lo[0.8], 1), round(b.hi[0.8], 1), round(b.lo[0.95], 1), round(b.hi[0.95], 1)])
      }
      return table([date('날짜'), num('관측값'), num('예측'), num('하한 50%'), num('상한 50%'), num('하한 80%'), num('상한 80%'), num('하한 95%'), num('상한 95%')], rows)
    },
  },
  {
    id: 'pca-students', name: '다변량 PCA 데이터: 학생 성적', description: '여섯 과목 점수입니다. 전반적인 학업 수준과 ‘이과–문과 성향’이라는 두 가지 숨은 요인이 점수를 만듭니다. 합성 데이터입니다.',
    size: sizes(120, 12, 1500, 12, '학생 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const klass = ['인문반', '자연반', '예체능반']
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const k = i % 3
        const g = r.normal(0, 1)
        const lean = [-1.1, 1.0, 0.1][k] + 0.5 * r.normal()
        const arts = [0, -0.3, 1.2][k] + 0.4 * r.normal()
        const sc = (base: number, a: number, b: number, c: number) => round(Math.max(0, Math.min(100, base + 9 * (a * g + b * lean + c * arts) + r.normal(0, 4))), 1)
        return [klass[k], sc(70, 1, -0.9, 0), sc(68, 1, -0.5, 0), sc(66, 1, 0.9, -0.2), sc(65, 1, 1, -0.2), sc(72, 0.35, 0, 1), sc(74, 0.15, 0.2, 0.9)]
      })
      return table([cat('반'), num('국어'), num('영어'), num('수학'), num('과학'), num('미술'), num('체육')], rows)
    },
  },
  {
    id: 'pyramid', name: '두 집단 인구 분포', description: '가상 도시의 연령대별 남성·여성 인구(천 명)입니다. 아래 연령은 줄고 고령층은 여성이 더 많은 전형적인 고령화 구조를 본뜬 합성 데이터입니다.',
    generate: (seed) => {
      const r = createRng(seed)
      const ages = ['0–4', '5–9', '10–14', '15–19', '20–24', '25–29', '30–34', '35–39', '40–44', '45–49', '50–54', '55–59', '60–64', '65–69', '70–74', '75–79', '80–84', '85+']
      const base = [18, 20, 23, 26, 31, 34, 37, 40, 44, 52, 56, 54, 46, 36, 26, 18, 11, 6]
      const female = [0.95, 0.95, 0.95, 0.95, 0.96, 0.97, 0.98, 0.99, 1, 1, 1.01, 1.04, 1.09, 1.16, 1.25, 1.4, 1.6, 1.9]
      const rows: Cell[][] = ages.map((a, i) => [a, round(base[i] * (1 + r.normal(0, 0.03)), 1), round(base[i] * 0.97 * female[i] * (1 + r.normal(0, 0.03)), 1)])
      return table([cat('연령대'), num('남성'), num('여성')], rows)
    },
  },
  {
    id: 'defects', name: '불량 유형별 건수', description: '한 공장에서 한 달 동안 접수된 불량 유형별 건수입니다. 소수의 유형이 대부분을 차지합니다. 합성 데이터입니다.',
    generate: (seed) => {
      const r = createRng(seed)
      const types = ['스크래치', '치수 불량', '도장 벗겨짐', '조립 불량', '용접 결함', '이물질', '변색', '누유', '소음', '라벨 오류']
      const base = [212, 148, 83, 51, 33, 24, 17, 12, 8, 5]
      return table([cat('불량 유형'), num('건수')], types.map((t, i) => [t, Math.max(1, Math.round(base[i] * (1 + r.normal(0, 0.08))))]))
    },
  },
  {
    id: 'kpi', name: '목표 대비 성과 지표', description: '여섯 성과 지표의 실적(0–100점)과 목표, 그리고 나쁨·보통·좋음 구간의 상한입니다. 합성 데이터입니다.',
    generate: (seed) => {
      const r = createRng(seed)
      const items: [string, number, number][] = [['품질', 82, 85], ['납기', 74, 80], ['비용', 61, 70], ['안전', 93, 90], ['고객 만족', 77, 85], ['혁신', 48, 60]]
      return table([cat('지표'), num('실적'), num('목표'), num('나쁨'), num('보통'), num('좋음')], items.map(([name, v, t]) => [name, Math.round(v + r.normal(0, 2)), t, 50, 75, 100]))
    },
  },
  {
    id: 'stage-flow', name: '단계별 범주 이동', description: '같은 학생들이 1학년부터 3학년까지 문과·이과·예체능·미정 중 어디에 속했는지 보여 주는 합성 데이터입니다. 각 단계의 전체 인원은 같습니다.',
    size: sizes(300, 60, 3000, 30, '학생 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const groups = ['문과', '이과', '예체능', '미정']
      const stages = ['1학년', '2학년', '3학년']
      let counts = allocate(n, [0.3, 0.32, 0.13, 0.25])
      const rows: Cell[][] = []
      for (let s = 0; s < stages.length - 1; s++) {
        const next = new Array(groups.length).fill(0)
        groups.forEach((g, gi) => {
          // Each group mostly stays; the undecided group settles; others drift with a seeded bias.
          const stay = gi === 3 ? 0.05 : 0.68 + 0.08 * r()
          const w = groups.map((_, ti) => (ti === gi ? stay : ti === 3 ? 0.02 : (1 - stay) * (0.4 + r())))
          const parts = allocate(counts[gi], gi === 3 ? [0.3 + 0.1 * r(), 0.3 + 0.1 * r(), 0.12, w[3]] : w)
          parts.forEach((v, ti) => { next[ti] += v; if (v > 0) rows.push([stages[s], stages[s + 1], g, groups[ti], v]) })
        })
        counts = next
      }
      return table([cat('시작 단계'), cat('끝 단계'), cat('시작 범주'), cat('끝 범주'), num('인원')], rows)
    },
  },
  {
    id: 'network', name: '네트워크 노드·간선', description: '세 모임으로 나뉜 가상 인맥 네트워크입니다. 같은 모임끼리 더 자주 이어지고 모임 사이는 드물게 연결됩니다. 연결 대상이 비어 있는 행은 연결이 없는 노드입니다.',
    size: sizes(18, 6, 80, 2, '노드 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const groups = ['A팀', 'B팀', 'C팀']
      const members = Array.from({ length: n }, (_, i) => ({ name: NAMES[i % NAMES.length] + (i >= NAMES.length ? String(Math.floor(i / NAMES.length) + 1) : ''), group: groups[i % 3] }))
      const rows: Cell[][] = []
      const hasOut = new Set<string>()
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const same = members[i].group === members[j].group
          if (r() < (same ? Math.min(0.6, 2.4 / (n / 3)) : Math.min(0.08, 0.4 / n * 3))) {
            rows.push([members[i].name, members[j].name, 1 + r.int(0, 4), members[i].group])
            hasOut.add(members[i].name)
          }
        }
      }
      for (const m of members) if (!hasOut.has(m.name)) rows.push([m.name, null, null, m.group])
      return table([cat('출발'), cat('도착'), num('가중치'), cat('출발 그룹')], rows)
    },
  },
  {
    id: 'folders', name: '계층 구조: 폴더 용량', description: '저장 공간을 폴더 › 하위 폴더 › 파일 유형의 세 단계로 나눈 용량(GB)입니다. 합성 데이터입니다.',
    generate: (seed) => {
      const r = createRng(seed)
      const spec: [string, string, [string, number][]][] = [
        ['사진', '여행', [['RAW', 120], ['JPG', 46], ['동영상', 98]]], ['사진', '가족', [['JPG', 52], ['동영상', 61]]], ['사진', '작업', [['PSD', 74], ['JPG', 18]]],
        ['문서', '업무', [['PDF', 21], ['문서', 12], ['스프레드시트', 15]]], ['문서', '학습', [['PDF', 28], ['노트', 6]]],
        ['프로젝트', '웹앱', [['소스', 4], ['빌드', 11], ['의존성', 38]]], ['프로젝트', '데이터', [['CSV', 44], ['모델', 63]]],
        ['미디어', '음악', [['FLAC', 82], ['MP3', 24]]], ['미디어', '영상', [['4K', 150], ['HD', 70]]],
      ]
      const rows: Cell[][] = []
      for (const [a, b, items] of spec) for (const [c, v] of items) rows.push([a, b, c, Math.max(1, Math.round(v * (0.85 + 0.3 * r())))])
      return table([cat('폴더'), cat('하위 폴더'), cat('유형'), num('용량')], rows)
    },
  },
  {
    id: 'scores', name: '이진 분류 예측 점수', description: '양성과 음성이 비슷한 비율로 섞인 분류기의 예측 점수(0–1)와 실제 레이블(1 = 양성)입니다. 점수가 겹치는 구간이 있습니다. 합성 데이터입니다.',
    size: sizes(300, 20, 5000, 20, '표본 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = Array.from({ length: n }, () => {
        const y = r() < 0.4 ? 1 : 0
        const s = Math.min(1, Math.max(0, y ? r.normal(0.66, 0.2) : r.normal(0.38, 0.2)))
        return [round(s, 3), y]
      })
      return table([num('예측 점수'), num('실제 레이블')], rows)
    },
  },
  {
    id: 'scores-imbalanced', name: '분류 불균형 데이터', description: '양성이 약 5%뿐인 불균형 데이터의 예측 점수와 실제 레이블입니다. 정확도나 ROC만으로는 성능이 좋아 보일 수 있습니다. 합성 데이터입니다.',
    size: sizes(1000, 100, 8000, 100, '표본 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = Array.from({ length: n }, () => {
        const y = r() < 0.05 ? 1 : 0
        const s = Math.min(1, Math.max(0, y ? r.normal(0.62, 0.22) : r.normal(0.24, 0.17)))
        return [round(s, 3), y]
      })
      return table([num('예측 점수'), num('실제 레이블')], rows)
    },
  },
  {
    id: 'survey', name: '범주형 교차표', description: '연령대 × 만족도 × 이용 경로를 가로지른 설문 응답 수입니다. 어린 응답자일수록 모바일을 쓰고 만족도가 낮은 경향이 들어 있는 합성 데이터입니다.',
    size: sizes(600, 60, 6000, 60, '응답자 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const ages = ['20대', '30대', '40대 이상']
      const sat = ['불만', '보통', '만족']
      const via = ['모바일', '웹']
      const counts = new Map<string, number>()
      for (let i = 0; i < n; i++) {
        const a = r() < 0.34 ? 0 : r() < 0.55 ? 1 : 2
        const v = r() < [0.78, 0.55, 0.3][a] ? 0 : 1
        const p = a === 0 ? [0.34, 0.4, 0.26] : a === 1 ? [0.22, 0.4, 0.38] : [0.12, 0.34, 0.54]
        const u = r()
        const s = u < p[0] ? 0 : u < p[0] + p[1] ? 1 : 2
        const k = `${a}|${s}|${v}`
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
      const rows: Cell[][] = []
      ages.forEach((a, ai) => sat.forEach((s, si) => via.forEach((v, vi) => rows.push([a, s, v, counts.get(`${ai}|${si}|${vi}`) ?? 0]))))
      return table([cat('연령대'), cat('만족도'), cat('이용 경로'), num('응답 수')], rows)
    },
  },
  {
    id: 'trajectory', name: '시간에 따른 두 지표의 경로', description: '가상 국가의 연도별 1인당 소득(천 달러)과 기대수명(세)입니다. 두 지표가 시간에 따라 함께 움직인 경로를 보여 주는 합성 데이터입니다.',
    size: sizes(24, 6, 60, 1, '연도 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      let income = 12
      let life = 69
      const rows: Cell[][] = []
      for (let i = 0; i < n; i++) {
        const shock = i === Math.round(n * 0.4) ? -0.12 : 0
        income = income * (1 + 0.045 + shock + r.normal(0, 0.012))
        life += 0.32 + 0.6 * (income - 12) / (income + 8) * 0.1 + (shock ? -0.8 : 0) + r.normal(0, 0.12)
        rows.push([round(income, 1), round(life, 1), 2000 + i])
      }
      return table([num('소득'), num('기대수명'), num('연도')], rows)
    },
  },
  {
    id: 'big-groups', name: '대규모 그룹 표본', description: '세 그룹의 측정값입니다. A는 정규분포, B는 오른쪽 꼬리가 긴 분포, C는 양쪽 꼬리가 두꺼운 분포입니다. 표본이 커서 꼬리의 모양이 보입니다.',
    size: sizes(3000, 150, 30000, 150, '전체 표본 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const groups = ['A', 'B', 'C']
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const g = groups[i % 3]
        const v = g === 'A' ? r.normal(50, 8) : g === 'B' ? 38 + Math.exp(r.normal(2.3, 0.65)) : 52 + r.normal(0, 5) * (r() < 0.12 ? 3.2 : 1)
        return [g, round(v, 2)]
      })
      return table([cat('그룹'), num('측정값')], rows)
    },
  },
]

export const v3Ids: DatasetId[] = datasetsV3.map((d) => d.id)
