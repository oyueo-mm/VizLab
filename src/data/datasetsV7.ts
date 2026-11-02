import { createRng, round } from '../lib/random'
import type { DatasetDef } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const date = (name: string): Column => ({ name, type: 'date' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })

const pad = (n: number) => String(n).padStart(2, '0')

/** v0.7 datasets: states over time, timetables, event records, categorical surveys, text and flow sources. */
export const datasetsV7: DatasetDef[] = [
  {
    id: 'state-series', name: '시점별 상태 벡터 (주제 비중)', description: '48개월 동안 다섯 주제가 차지하는 비중의 변화입니다. 계절 주기와 서서히 일어나는 변화가 섞여 있어, 시간 순서와 상태 유사도가 어떻게 다른지 볼 수 있습니다.',
    size: { min: 12, max: 120, default: 48, step: 6, label: '개월 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      for (let k = 0; k < n; k++) {
        const y = 2020 + Math.floor(k / 12), m = (k % 12) + 1
        const season = (2 * Math.PI * (k % 12)) / 12
        const drift = k / n
        const raw = [
          2 + 1.2 * Math.sin(season) + 1.5 * drift,
          2 + 1.2 * Math.cos(season) - 1.0 * drift,
          1.5 + 0.8 * Math.sin(2 * season),
          1 + 2.0 * drift * drift,
          1.5 - 0.9 * Math.sin(season) + 0.4 * Math.cos(season),
        ].map((v) => Math.max(0.2, v + 0.12 * r.normal()))
        const s = raw.reduce((a, b) => a + b, 0)
        rows.push([`${y}-${pad(m)}-01`, ...raw.map((v) => round((v / s) * 100, 1))])
      }
      return table([date('월'), num('정책'), num('경제'), num('기술'), num('환경'), num('문화')], rows)
    },
  },
  {
    id: 'train-timetable', name: '열차 시간표 (거리–시각)', description: '가상 노선의 여섯 역(0–150 km)을 지나는 상·하행 열차 여덟 대의 정차·통과 시각입니다. 시각은 오전 6시부터의 분입니다. 완행은 모든 역에 서고 급행은 일부만 섭니다.',
    generate: () => {
      const stations: [string, number][] = [['가', 0], ['나', 25], ['다', 55], ['라', 90], ['마', 120], ['바', 150]]
      // [train, direction, start minute, speed km/h, stops(station idx), dwell min]
      const trains: [string, 1 | -1, number, number, number[], number][] = [
        ['완행 1', 1, 0, 80, [0, 1, 2, 3, 4, 5], 2],
        ['급행 1', 1, 20, 140, [0, 2, 5], 1],
        ['완행 2', 1, 60, 80, [0, 1, 2, 3, 4, 5], 2],
        ['급행 2', 1, 75, 140, [0, 2, 5], 1],
        ['완행 3', -1, 5, 80, [5, 4, 3, 2, 1, 0], 2],
        ['급행 3', -1, 30, 140, [5, 2, 0], 1],
        ['완행 4', -1, 65, 80, [5, 4, 3, 2, 1, 0], 2],
        ['급행 4', -1, 90, 140, [5, 2, 0], 1],
      ]
      const rows: Cell[][] = []
      for (const [name, , start, speed, stops, dwell] of trains) {
        let t = start
        let prev = stops[0]
        stops.forEach((s, k) => {
          if (k > 0) t += (Math.abs(stations[s][1] - stations[prev][1]) / speed) * 60
          rows.push([name, stations[s][0], stations[s][1], round(t, 1)])
          if (k < stops.length - 1) { t += dwell; rows.push([name, stations[s][0], stations[s][1], round(t, 1)]) }
          prev = s
        })
      }
      return table([cat('열차'), cat('역'), num('거리'), num('시각')], rows)
    },
  },
  {
    id: 'patient-events', name: '환자별 진료 사건', description: '여덟 명의 환자가 입원·투약·검사·진단을 받은 기록입니다. 시작과 종료가 같으면 한 시점에 일어난 사건입니다(일 단위).',
    generate: (seed) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      for (let p = 1; p <= 8; p++) {
        const id = `환자 ${p}`
        const admit = r.int(0, 12)
        const stay = r.int(6, 20)
        rows.push([id, '입원', '입원', admit, admit + stay])
        rows.push([id, '진단', '진단', admit + 1, admit + 1])
        const meds = r.int(1, 3)
        for (let m = 0; m < meds; m++) {
          const s = admit + r.int(1, Math.max(2, stay - 4))
          rows.push([id, `투약 ${m + 1}`, '투약', s, s + r.int(2, 6)])
        }
        const tests = r.int(2, 4)
        for (let t = 0; t < tests; t++) { const s = admit + r.int(0, stay); rows.push([id, `검사 ${t + 1}`, '검사', s, s]) }
        if (r.int(0, 3) === 0) rows.push([id, '재입원', '입원', admit + stay + r.int(5, 12), admit + stay + r.int(14, 22)])
      }
      return table([cat('환자'), cat('사건'), cat('유형'), num('시작'), num('종료')], rows)
    },
  },
  {
    id: 'survey-cats', name: '범주형 설문 (네 가지 응답)', description: '가상 서비스 이용자 설문입니다. 연령대·이용 목적·이용 기기·만족도 네 범주 변수와 그 조합의 응답 수가 들어 있습니다.',
    generate: (seed) => {
      const r = createRng(seed)
      const ages = ['10–20대', '30대', '40대', '50대+']
      const purposes = ['업무', '학습', '여가']
      const devices = ['모바일', '노트북', '태블릿']
      const sat = ['불만', '보통', '만족']
      const rows: Cell[][] = []
      ages.forEach((a, ai) => purposes.forEach((p, pi) => devices.forEach((d, di) => {
        const base = 6 + 8 * Math.exp(-((ai - pi) ** 2) / 2) + (di === 0 ? 8 - 3 * ai : 2 + ai * 2) + r.int(0, 6)
        const sIdx = (pi === 1 ? 1.2 : 0.6) + 0.25 * ai - (di === 1 ? 0.2 : 0)
        const m = Math.max(0.2, 1 + 0.3 * sIdx)
        const split = [Math.max(0.1, 1.6 - m), 1, Math.max(0.2, m)]
        const tot = split.reduce((x, y) => x + y, 0)
        sat.forEach((s, si) => rows.push([a, p, d, s, Math.max(1, Math.round((base * 3 * split[si]) / tot))]))
      })))
      return table([cat('연령대'), cat('이용 목적'), cat('이용 기기'), cat('만족도'), num('응답 수')], rows)
    },
  },
  {
    id: 'text-corpus', name: '데이터 시각화 문장 모음', description: '데이터 시각화에 관한 서른 개의 짧은 문장입니다. 단어 빈도와 앞뒤 문맥을 계산하는 데 씁니다. 직접 문장을 고치면 결과가 바로 바뀝니다.',
    generate: () => table([cat('문장')], [
      '시각화는 데이터를 눈으로 이해하게 합니다', '좋은 시각화는 질문에서 시작합니다', '산점도는 두 변수의 관계를 보여줍니다', '막대그래프는 범주의 크기를 비교합니다',
      '선그래프는 시간에 따른 변화를 보여줍니다', '색은 값을 표현하는 강력한 도구입니다', '색은 접근성을 고려해 선택해야 합니다', '축은 정직하게 시작해야 합니다',
      '지도는 위치와 값을 함께 보여줍니다', '네트워크는 관계를 연결로 표현합니다', '트리맵은 계층을 면적으로 표현합니다', '분포는 히스토그램과 상자그림으로 보여줍니다',
      '불확실성은 구간과 확률로 표현해야 합니다', '시각화는 데이터를 요약하고 데이터를 왜곡할 수 있습니다', '좋은 질문은 좋은 시각화를 만듭니다', '단순한 시각화가 가장 강력할 때가 많습니다',
      '데이터는 시각화로 이야기를 전달합니다', '시각화는 탐색과 설명 모두에 쓰입니다', '탐색은 가설을 만들고 설명은 결론을 전달합니다', '인터랙션은 데이터 탐색을 도와줍니다',
      '색은 순서와 범주를 구별해 표현합니다', '지도는 면적이 값을 왜곡할 수 있습니다', '네트워크는 노드와 연결로 구성됩니다', '표는 정확한 값을 읽을 때 좋습니다',
      '시각화는 맥락과 출처를 함께 보여줘야 합니다', '변수 사이의 관계는 상관과 인과를 구분해야 합니다', '분포를 보면 평균이 놓치는 것을 알 수 있습니다', '시간에 따른 변화는 주기와 추세로 나눕니다',
      '좋은 시각화는 설명 없이도 읽힙니다', '시각화는 데이터를 더 가까이 느끼게 합니다',
    ].map((s) => [s])),
  },
  {
    id: 'lic-sources', name: '유동장 원천 (소용돌이·흡입·방출)', description: '2차원 평면에 놓인 소용돌이·흡입구·방출구·균일 흐름의 위치와 세기입니다. 모든 원천의 속도를 더해 벡터장을 만듭니다.',
    generate: () => table([cat('종류'), num('x'), num('y'), num('세기'), num('반경')], [
      ['소용돌이', 0.3, 0.55, 1.2, 0.12], ['소용돌이', 0.72, 0.45, -1.0, 0.12], ['흡입', 0.5, 0.15, 0.7, 0.1], ['방출', 0.5, 0.88, 0.7, 0.1], ['균일', 0.5, 0.5, 0.25, 1],
    ]),
  },
]
