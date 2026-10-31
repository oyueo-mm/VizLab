import { createRng, round } from '../lib/random'
import { DAY_MS, formatISO } from '../stats/datetime'
import type { DatasetDef, DatasetSize } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const date = (name: string): Column => ({ name, type: 'date' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

export const datasetsV5Stats: DatasetDef[] = [
  {
    id: 'regression-demo', name: '회귀 진단용 합성 데이터 (공부·수면·점수)', description: '공부 시간과 수면 시간으로 시험 점수를 설명하는 합성 데이터입니다. 공부 시간이 클수록 잔차의 퍼짐이 커지고(이분산), 이상값 두 개와 공부 시간이 유난히 긴 영향력 큰 한 점(레버리지)이 들어 있어 진단 그래프가 무엇을 잡아내는지 볼 수 있습니다.',
    size: sizes(60, 20, 400, 5, '학생 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      for (let i = 0; i < n; i++) {
        const study = r() * 10, sleep = Math.max(3, Math.min(10, r.normal(7, 1.1)))
        let score = 35 + 4.2 * study + 2.5 * (sleep - 7) + r.normal(0, 1.5 + 0.55 * study)
        if (i === 7) score += 22
        if (i === 33) score -= 20
        rows.push([round(study, 2), round(sleep, 2), round(score, 1)])
      }
      rows[n - 1] = [18, 7, 60] // far from the other study times and below the trend: high leverage and influential
      return table([num('공부 시간'), num('수면 시간'), num('점수')], rows)
    },
  },
  {
    id: 'survival-trial', name: '생존 분석용 합성 임상 데이터', description: '치료 집단과 대조 집단의 추적 기간(개월)과 사건(1 = 사건 발생, 0 = 검열)입니다. 치료 집단의 위험이 더 낮게 만든 합성 데이터이며 실제 환자 자료가 아닙니다. 36개월에 추적을 마쳐 그때까지 사건이 없으면 검열됩니다.',
    size: sizes(40, 10, 300, 5, '집단당 인원'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      for (const [group, scale] of [['치료', 46], ['대조', 24]] as const) {
        for (let i = 0; i < n; i++) {
          const event = scale * (-Math.log(1 - r())) ** (1 / 1.2)
          const dropout = r() < 0.18 ? r() * 30 : Infinity
          const t = Math.min(event, dropout, 36)
          rows.push([group, round(t, 1), event <= Math.min(dropout, 36) ? 1 : 0])
        }
      }
      return table([cat('집단'), num('기간'), num('사건')], rows)
    },
  },
  {
    id: 'process-shift', name: '작은 평균 이동이 있는 공정 (합성)', description: '시간 순서대로 잰 부품 치수(목표 50, 표준편차 1)입니다. 중간부터 평균이 표준편차의 0.8배(약 0.8)만큼 아주 조금 올라갑니다. 개별 점은 관리한계 안에 머물러, 작은 이동을 EWMA·CUSUM이 얼마나 빨리 잡는지 비교하기 위한 합성 데이터입니다.',
    size: sizes(80, 30, 300, 5, '측정 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const t0 = Date.UTC(2024, 5, 3, 8)
      const shiftAt = Math.floor(n * 0.5)
      return table([date('시점'), num('측정값')], Array.from({ length: n }, (_, i) => [formatISO(t0 + i * 3600000, true), round(50 + (i >= shiftAt ? 0.8 : 0) + r.normal(0, 1), 3)]))
    },
  },
  {
    id: 'forecast-overconfident', name: '예측 분포 보정: 과신 (합성)', description: '관측값과 정규분포로 낸 예측(평균, 표준편차)입니다. 예측은 표준편차를 1로 말하지만 실제 오차는 약 1.7배로 더 커서(과신) PIT 히스토그램이 U자 모양이 됩니다. 합성 데이터입니다.',
    size: sizes(400, 60, 3000, 20, '예측 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      return table([num('관측값'), num('예측 평균'), num('예측 표준편차')], Array.from({ length: n }, () => { const mu = r.normal(20, 4); return [round(mu + r.normal(0, 1.7), 3), round(mu, 3), 1] }))
    },
  },
  {
    id: 'forecast-calibrated', name: '예측 분포 보정: 잘 맞음 (합성)', description: '예측이 말한 표준편차와 실제 오차가 같은 잘 보정된 합성 예측입니다. PIT 히스토그램이 거의 평평해야 합니다.',
    size: sizes(400, 60, 3000, 20, '예측 수'),
    generate: (seed, n) => {
      const r = createRng(seed + 101)
      return table([num('관측값'), num('예측 평균'), num('예측 표준편차')], Array.from({ length: n }, () => { const mu = r.normal(20, 4); return [round(mu + r.normal(0, 1.2), 3), round(mu, 3), 1.2] }))
    },
  },
]

void DAY_MS
