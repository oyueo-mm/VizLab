import { createRng, round } from '../lib/random'
import type { DatasetDef } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })

export const LAB_GROUPS = ['시각화', '데이터베이스', '기계학습', '인터랙션', '그래픽스']
const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오']
const GIVEN = ['민준', '서연', '도윤', '하은', '지호', '수아', '예준', '지유', '시우', '채원', '유진', '현우', '나연', '태윤', '소윤', '건우', '다은', '준서', '서진', '아린', '이안', '하준', '지안', '로하']

export const SEARCH_TERMS = ['지도', '네트워크', '시간', '불확실성']

/** v0.9 datasets. */
export const datasetsV9: DatasetDef[] = [
  {
    id: 'lab-members', name: '연구실 구성원의 연구 분야 (다섯 분야, 합성)', description: '가상 연구원이 다섯 분야(시각화·데이터베이스·기계학습·인터랙션·그래픽스) 중 어디에서 활동하는지를 0/1 열로 적은 합성 자료입니다. 한 사람이 여러 분야에 걸칠 수 있고, 인접한 분야끼리 더 자주 겹치도록 만들었습니다. 지하철 노선도형·격자형 집합 표현의 입력으로 알맞습니다.',
    size: { min: 12, max: 48, default: 26, step: 2, label: '연구원 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      // neighbouring fields overlap more often: visualization~interaction, ml~database, graphics~visualization
      const near: [number, number][] = [[0, 3], [2, 1], [4, 0], [3, 4]]
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const m = LAB_GROUPS.map(() => 0)
        m[r.int(0, LAB_GROUPS.length - 1)] = 1
        for (const [a, b] of near) if ((m[a] || m[b]) && r() < 0.34) m[m[a] ? b : a] = 1
        if (r() < 0.08) m[r.int(0, LAB_GROUPS.length - 1)] = 1
        return [`${SURNAMES[i % SURNAMES.length]}${GIVEN[i % GIVEN.length]}`, ...m]
      })
      // names must be unique: add an index to repeated ones
      const seen = new Map<string, number>()
      rows.forEach((row) => { const k = String(row[0]); const c = (seen.get(k) ?? 0) + 1; seen.set(k, c); if (c > 1) row[0] = `${k}${c}` })
      return table([cat('이름'), ...LAB_GROUPS.map(num)], rows)
    },
  },
  {
    id: 'search-hits', name: '검색어별 문서 적중 (네 검색어, 합성)', description: '문서 하나가 네 검색어(지도·네트워크·시간·불확실성) 각각을 포함하는지를 1/0으로 적은 합성 검색 결과입니다. 어느 검색어도 포함하지 않는 문서도 섞여 있습니다. 검색어 조합별 문서 수를 세는 InfoCrystal의 입력으로 알맞습니다.',
    size: { min: 40, max: 600, default: 160, step: 20, label: '문서 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const p = [0.34, 0.3, 0.28, 0.18]
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const topic = r.int(0, 3)
        const m = p.map((q, k) => (r() < (k === topic ? 0.8 : q * 0.55) ? 1 : 0))
        if (r() < 0.2) m[(topic + 1) % 4] = 1
        return [`문서 ${String(i + 1).padStart(3, '0')}`, ...m]
      })
      return table([cat('문서'), ...SEARCH_TERMS.map(num)], rows)
    },
  },
  {
    id: 'team-projects', name: '연도별 공동 프로젝트와 참여자 (하이퍼엣지, 합성)', description: '연구원 열두 명이 해마다 여러 공동 프로젝트(둘 이상이 함께하는 묶음)에 참여한 기록입니다. 한 행이 ‘한 해, 한 프로젝트, 한 참여자’이므로 같은 프로젝트의 행들이 하나의 하이퍼엣지입니다. 같은 팀이 여러 해 반복해 모이도록 만들었습니다.',
    size: { min: 4, max: 14, default: 8, step: 1, label: '연도 수' },
    generate: (seed, years) => {
      const r = createRng(seed)
      const people = Array.from({ length: 12 }, (_, i) => `${SURNAMES[i]}${GIVEN[i]}`)
      const teams: number[][] = [[0, 1, 2], [3, 4], [5, 6, 7, 8], [1, 9], [10, 11, 2]]
      const rows: Cell[][] = []
      for (let y = 0; y < years; y++) {
        const k = r.int(3, 5)
        let id = 0
        for (let e = 0; e < k; e++) {
          let m: number[]
          if (r() < 0.55) {
            m = [...teams[r.int(0, teams.length - 1)]]
            if (r() < 0.3) m.push(r.int(0, 11))
          } else {
            m = []
            const size = r.int(2, 4)
            while (m.length < size) m.push(r.int(0, 11))
          }
          const uniq = [...new Set(m)]
          if (uniq.length < 2) continue
          id++
          const name = `${2015 + y}-P${id}`
          for (const q of uniq) rows.push([2015 + y, name, people[q]])
        }
      }
      return table([num('연도'), cat('프로젝트'), cat('참여자')], rows)
    },
  },
  {
    id: 'membership-history', name: '월별 구독 서비스 이용 (개체별 시점별 집합, 합성)', description: '가입자가 매달 어떤 서비스(음악·영상·도서·게임) 구독 조합을 쓰는지 기록한 합성 자료입니다. 한 행이 ‘한 가입자, 한 달, 구독 중인 서비스 하나’이며 어떤 서비스도 쓰지 않는 달은 행이 없습니다. 월이 갈수록 번들 구독으로 이동하는 경향을 넣었습니다.',
    size: { min: 20, max: 300, default: 80, step: 10, label: '가입자 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const services = ['음악', '영상', '도서', '게임']
      const months = 8
      const rows: Cell[][] = []
      for (let u = 0; u < n; u++) {
        let state = services.map(() => r() < 0.3)
        for (let t = 0; t < months; t++) {
          state = state.map((on, s) => (on ? r() > 0.14 : r() < 0.07 + 0.03 * t * (s === 1 ? 1 : 0.4)))
          // a bundle of music and video appears from month 4
          if (t >= 4 && state[0] && r() < 0.35) state[1] = true
          services.forEach((name, s) => { if (state[s]) rows.push([`가입자 ${String(u + 1).padStart(3, '0')}`, t + 1, name]) })
        }
      }
      return table([cat('개체'), num('월'), cat('집합')], rows)
    },
  },
  {
    id: 'care-braids', name: '두 집단의 진료 사건 순서 (속성이 있는 사건열, 합성)', description: '환자마다 접수→검사→진단→치료→경과관찰 순서의 사건 기록이 있고, 환자는 연령 집단(청년·장년)에 속합니다. 일부는 검사를 반복하거나 단계를 건너뛰며, 집단에 따라 경로가 달라집니다. 한 행이 한 사건입니다.',
    size: { min: 20, max: 200, default: 60, step: 10, label: '환자 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      for (let i = 0; i < n; i++) {
        const old = r() < 0.5
        const id = `환자 ${String(i + 1).padStart(3, '0')}`
        const seq = ['접수']
        seq.push(r() < (old ? 0.7 : 0.4) ? '영상검사' : '혈액검사')
        if (r() < 0.25) seq.push(seq[1])
        if (r() < 0.8) seq.push('진단')
        seq.push(r() < (old ? 0.65 : 0.3) ? '수술' : '약물치료')
        if (r() < 0.7) seq.push('경과관찰')
        if (old && r() < 0.35) seq.push('재입원')
        seq.forEach((e, k) => rows.push([id, k + 1, e, old ? '장년' : '청년']))
      }
      return table([cat('개체'), num('순서'), cat('사건'), cat('집단')], rows)
    },
  },
  {
    id: 'phone-specs', name: '스마트폰 사양 비교 (여섯 변수, 합성)', description: '가상 스마트폰 모델의 여섯 가지 수치(화면, 배터리, 카메라, 무게, 가격, 성능)입니다. 가격은 성능·카메라와 양의 상관, 무게는 배터리와 양의 상관을 갖게 만들었습니다. 변수를 자석으로 삼아 모델을 끌어당겨 보는 데 알맞습니다.',
    size: { min: 12, max: 120, default: 40, step: 4, label: '모델 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const tier = r()
        const perf = 40 + tier * 55 + r.normal(0, 6)
        const cam = 30 + tier * 50 + r.normal(0, 12)
        const bat = 3000 + r() * 2800
        const screen = 5.4 + r() * 1.6
        const weight = 140 + (bat - 3000) * 0.025 + screen * 6 + r.normal(0, 8)
        const price = 35 + perf * 0.9 + cam * 0.5 + r.normal(0, 12)
        return [`모델 ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) + 1}`, round(screen, 1), Math.round(bat), round(cam, 0), round(weight, 0), round(price, 0), round(perf, 0)]
      })
      return table([cat('모델'), num('화면(인치)'), num('배터리(mAh)'), num('카메라'), num('무게(g)'), num('가격(만원)'), num('성능')], rows)
    },
  },
  {
    id: 'topic-words', name: '월별 토픽과 단어 빈도 (네 토픽, 합성)', description: '뉴스 기사 모음에서 월별로 네 토픽(시각화 기법·데이터·성능·접근성)에 속한 단어의 빈도를 센 합성 자료입니다. 한 행이 ‘한 달, 한 토픽, 한 단어’의 빈도입니다. 토픽마다 몇 달 동안 커졌다 줄어들고, 그때 두드러지는 단어가 달라집니다.',
    size: { min: 5, max: 14, default: 10, step: 1, label: '월 수' },
    generate: (seed, months) => {
      const r = createRng(seed)
      const topics: [string, string[]][] = [
        ['시각화 기법', ['지도', '네트워크', '집합', '계층', '히트맵', '타임라인']],
        ['데이터', ['표본', '불확실성', '결측', '분포', '상관', '이상값']],
        ['성능', ['렌더링', '캐시', '워커', '지연', '번들', '프레임']],
        ['접근성', ['색약', '대비', '키보드', '낭독', '자막', '모바일']],
      ]
      const rows: Cell[][] = []
      topics.forEach(([name, words], k) => {
        const peak = ((k + 0.6) * months) / topics.length + r() * 0.8
        words.forEach((w, wi) => {
          const bias = 0.4 + r() * 0.9
          for (let t = 0; t < months; t++) {
            const level = 0.25 + Math.exp(-((t - peak) ** 2) / (2 * (months / 4.5) ** 2))
            const phase = 0.6 + 0.5 * Math.sin(t * 0.9 + wi * 1.7 + k)
            const f = Math.round(level * bias * phase * (60 - wi * 6) * (0.85 + r() * 0.3))
            if (f > 0) rows.push([t + 1, name, w, f])
          }
        })
      })
      return table([num('월'), cat('토픽'), cat('단어'), num('빈도')], rows)
    },
  },
  {
    id: 'search-docs', name: '검색 결과 문서 다섯 편의 문장 (지도·네트워크·시간, 합성)', description: '시각화 해설 다섯 편의 문장을 순서대로 모은 합성 자료입니다. 문서마다 길이가 다르고 어떤 주제가 앞쪽·가운데·뒤쪽에 몰려 있는지가 달라, 검색어 분포 막대(TileBars)를 비교하기 좋습니다. 한 행이 한 문장이며 행 순서가 문서 안의 순서입니다.',
    size: { min: 8, max: 40, default: 20, step: 2, label: '문서당 최대 문장 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const subj: Record<string, string[]> = {
        지도: ['지도 위에 값을 색으로 칠하면 지역 차이가 보인다', '지도 투영법에 따라 면적 인상이 달라진다', '지도에서 이동량은 선의 굵기로 나타낸다', '지도 위의 점은 위치 정보를 그대로 보존한다'],
        네트워크: ['네트워크의 노드는 관계를 맺는 대상이다', '네트워크 간선이 많으면 선이 겹쳐 읽기 어렵다', '네트워크 군집은 밀도가 높은 부분이다', '네트워크 행렬은 간선이 많을 때 유리하다'],
        시간: ['시간 축을 따라 변화를 읽을 수 있다', '시간 간격이 일정하지 않으면 해석이 어렵다', '시간에 따라 추세와 계절성이 나타난다', '시간 순서를 보존한 배치가 흐름을 드러낸다'],
        일반: ['색은 값의 크기를 구분하는 데 쓰인다', '범례는 읽는 사람이 기호를 이해하도록 돕는다', '축의 눈금은 값을 읽는 기준이다', '주석은 핵심 결과를 강조한다', '데이터의 출처를 밝히는 것은 중요하다'],
      }
      // each document has a different topic profile over its length
      const profiles: Record<string, number[]>[] = [
        { 지도: [0.6, 0.3, 0.05], 네트워크: [0.05, 0.1, 0.1], 시간: [0.05, 0.2, 0.5] },
        { 지도: [0.1, 0.1, 0.1], 네트워크: [0.1, 0.6, 0.2], 시간: [0.05, 0.1, 0.1] },
        { 지도: [0.1, 0.4, 0.4], 네트워크: [0.3, 0.1, 0.1], 시간: [0.3, 0.3, 0.1] },
        { 지도: [0.02, 0.02, 0.02], 네트워크: [0.05, 0.05, 0.05], 시간: [0.6, 0.6, 0.6] },
        { 지도: [0.3, 0.3, 0.3], 네트워크: [0.3, 0.3, 0.3], 시간: [0.3, 0.3, 0.3] },
      ]
      const rows: Cell[][] = []
      profiles.forEach((prof, d) => {
        const len = Math.max(6, Math.round(n * (0.5 + 0.5 * ((d * 37 % 5) / 4))))
        for (let s = 0; s < len; s++) {
          const third = Math.min(2, Math.floor((s / len) * 3))
          let pick = '일반'
          const x = r()
          let acc = 0
          for (const key of ['지도', '네트워크', '시간']) { acc += prof[key][third]; if (x < acc) { pick = key; break } }
          rows.push([`문서 ${'가나다라마'[d]}`, subj[pick][r.int(0, subj[pick].length - 1)]])
        }
      })
      return table([cat('문서'), cat('문장')], rows)
    },
  },
  {
    id: 'grid-flows', name: '격자형 지역 사이의 이동량 (중력 모형, 합성)', description: '지도를 열×행 격자로 단순화한 지역 사이의 이동량입니다. 한 행이 ‘출발 지역 → 도착 지역’ 한 쌍이고, 각 지역의 격자 위치(열·행)가 함께 들어 있습니다. 규모가 큰 지역(허브)과 가까운 지역 사이에 이동이 많도록 중력 모형으로 만들었습니다.',
    size: { min: 4, max: 8, default: 6, step: 1, label: '격자 열 수' },
    generate: (seed, cols) => {
      const r = createRng(seed)
      const rowsN = Math.max(3, cols - 1)
      const size = Array.from({ length: cols * rowsN }, () => 0.4 + r() * 1.2)
      const hub = r.int(0, cols * rowsN - 1)
      size[hub] *= 3.2
      const rows: Cell[][] = []
      for (let o = 0; o < cols * rowsN; o++) for (let d = 0; d < cols * rowsN; d++) {
        const dist = Math.hypot((o % cols) - (d % cols), Math.floor(o / cols) - Math.floor(d / cols))
        const f = o === d ? 0 : Math.round((size[o] * size[d] * 400) / (1 + dist * dist) * (0.8 + r() * 0.4))
        rows.push([`R${o + 1}`, `R${d + 1}`, o % cols, Math.floor(o / cols), d % cols, Math.floor(d / cols), f])
      }
      return table([cat('출발'), cat('도착'), num('출발 열'), num('출발 행'), num('도착 열'), num('도착 행'), num('이동량')], rows)
    },
  },
  {
    id: 'flow-2d', name: '이차원 흐름장 (소용돌이·원천·안장, 수식)', description: '평면에 소용돌이 두 개와 원천 하나, 안장점이 겹친 수식 벡터장을 정사각 격자에 표본한 자료입니다. 한 행이 한 격자점의 위치(x, y)와 속도(u, v)입니다. 흐름을 따라 질감을 옮기는 IBFV의 입력으로 알맞습니다.',
    size: { min: 12, max: 40, default: 24, step: 2, label: '축당 격자점 수' },
    generate: (_seed, n) => {
      const rows: Cell[][] = []
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = -2 + (4 * i) / (n - 1), y = -2 + (4 * j) / (n - 1)
        let u = 0.25 * x, v = -0.25 * y // saddle
        const vortex = (cx: number, cy: number, g: number) => {
          const dx = x - cx, dy = y - cy, r2 = dx * dx + dy * dy + 0.12
          return [(-g * dy) / r2, (g * dx) / r2]
        }
        const a = vortex(-0.9, 0.5, 0.9), b = vortex(1, -0.6, -0.7)
        u += a[0] + b[0]; v += a[1] + b[1]
        const sx = x - 0.2, sy = y - 1.2, sr = sx * sx + sy * sy + 0.2
        u += (0.45 * sx) / sr; v += (0.45 * sy) / sr
        rows.push([round(x, 4), round(y, 4), round(u, 5), round(v, 5)])
      }
      return table([num('x'), num('y'), num('u'), num('v')], rows)
    },
  },
  {
    id: 'tensor-twist', name: '비틀린 텐서장 (고유구조가 알려진 대칭 텐서, 수식)', description: '세 고유값이 중심에서 멀어질수록 달라지고, 최대 고유벡터가 z축 둘레를 나선형으로 도는 합성 대칭 텐서장입니다. 한 행이 한 격자점의 위치와 텐서 여섯 성분(Dxx, Dyy, Dzz, Dxy, Dxz, Dyz)입니다. 고유구조를 해석적으로 알고 있어 하이퍼스트림라인 계산을 검증할 수 있습니다.',
    size: { min: 6, max: 14, default: 9, step: 1, label: '축당 격자점 수' },
    generate: (_seed, n) => {
      const rows: Cell[][] = []
      for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = -2 + (4 * i) / (n - 1), y = -2 + (4 * j) / (n - 1), z = -2 + (4 * k) / (n - 1)
        const rr = Math.hypot(x, y)
        const ang = Math.atan2(y, x) + Math.PI / 2 // tangent direction
        const tilt = 0.25 * z
        // major axis: tangent direction tilted up by `tilt`; medium: radial; minor: the remaining direction
        const e1: [number, number, number] = [Math.cos(ang) * Math.cos(tilt), Math.sin(ang) * Math.cos(tilt), Math.sin(tilt)]
        const e2: [number, number, number] = [Math.cos(ang - Math.PI / 2), Math.sin(ang - Math.PI / 2), 0]
        const e3: [number, number, number] = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
        const l1 = 2.4 - 0.5 * rr, l2 = 1.0 + 0.3 * Math.cos(z), l3 = 0.35 + 0.1 * rr
        const T = (a: number, b: number) => l1 * e1[a] * e1[b] + l2 * e2[a] * e2[b] + l3 * e3[a] * e3[b]
        rows.push([round(x, 4), round(y, 4), round(z, 4), round(T(0, 0), 5), round(T(1, 1), 5), round(T(2, 2), 5), round(T(0, 1), 5), round(T(0, 2), 5), round(T(1, 2), 5)])
      }
      return table([num('x'), num('y'), num('z'), num('Dxx'), num('Dyy'), num('Dzz'), num('Dxy'), num('Dxz'), num('Dyz')], rows)
    },
  },
  {
    id: 'memo-archive', name: '날짜순 문서 보관함 (세 분류, 합성)', description: '삼 년 동안 쌓인 메모·보고서·회의록의 보관 기록입니다. 한 행이 문서 하나이며 날짜(일 수), 분류, 제목, 분량(쪽)이 있습니다. 시기에 따라 분류별 건수가 몰려 있어, 넓은 시간 축에서 관심 구간만 자세히 보는 기법(Perspective Wall·Bifocal)에 알맞습니다.',
    size: { min: 60, max: 400, default: 180, step: 20, label: '문서 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const kinds = ['메모', '보고서', '회의록']
      const rows: Cell[][] = []
      for (let i = 0; i < n; i++) {
        const day = Math.min(1095, Math.max(0, Math.round(r() < 0.45 ? r.normal(380, 60) : r() < 0.6 ? r.normal(800, 120) : r() * 1095)))
        const kind = kinds[day < 500 ? (r() < 0.6 ? 1 : 0) : day > 700 ? (r() < 0.6 ? 2 : 0) : r.int(0, 2)]
        rows.push([day, kind, `${kind} ${String(i + 1).padStart(3, '0')}`, r.int(1, 24)])
      }
      rows.sort((a, b) => (a[0] as number) - (b[0] as number))
      return table([num('날짜(일)'), cat('분류'), cat('제목'), num('분량(쪽)')], rows)
    },
  },
  {
    id: 'bivariate-volume', name: '두 스칼라장의 부피 자료 (온도·농도, 수식)', description: '정육면체 격자에서 두 스칼라장(온도와 농도)을 표본한 합성 자료입니다. 온도는 중심의 두 열원, 농도는 비스듬한 띠 모양이라 두 값이 함께 정해지는 영역이 닫힌 곡면으로 나타납니다. 한 행이 한 격자점입니다.',
    size: { min: 10, max: 22, default: 14, step: 2, label: '축당 격자점 수' },
    generate: (_seed, n) => {
      const rows: Cell[][] = []
      for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = -2 + (4 * i) / (n - 1), y = -2 + (4 * j) / (n - 1), z = -2 + (4 * k) / (n - 1)
        const t = Math.exp(-((x - 0.7) ** 2 + (y - 0.2) ** 2 + z * z) / 1.1) + 0.9 * Math.exp(-((x + 0.8) ** 2 + (y + 0.4) ** 2 + (z - 0.3) ** 2) / 0.9)
        const c = 0.5 + 0.5 * Math.sin(1.3 * (x + y) + 0.8 * z)
        rows.push([round(x, 4), round(y, 4), round(z, 4), round(t, 5), round(c, 5)])
      }
      return table([num('x'), num('y'), num('z'), num('온도'), num('농도')], rows)
    },
  },
  {
    id: 'club-network', name: '동아리 소속이 있는 인맥 (세 동아리와 친구 관계, 합성)', description: '가상 학생이 세 동아리(음악·운동·코딩) 중 어디에 가입했는지(0/1)와 친구 이름 목록(세미콜론으로 구분)을 한 행에 적은 합성 자료입니다. 같은 동아리 안에서 친구가 되기 쉽고, 동아리 사이 연결도 일부 있습니다. 한 행이 한 사람(노드)이고 ‘친구’ 열이 간선입니다. 집합 영역과 네트워크를 함께 배치하는 SetNet의 입력으로 알맞습니다.',
    size: { min: 12, max: 40, default: 22, step: 2, label: '학생 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const clubs = ['음악', '운동', '코딩']
      const names = Array.from({ length: n }, (_, i) => `${SURNAMES[i % SURNAMES.length]}${GIVEN[(i * 5) % GIVEN.length]}${i >= GIVEN.length ? i : ''}`)
      const member = names.map(() => {
        const m = clubs.map(() => 0)
        m[r.int(0, 2)] = 1
        if (r() < 0.28) m[r.int(0, 2)] = 1
        if (r() < 0.06) m.fill(0)
        return m
      })
      const friends: Set<number>[] = names.map(() => new Set())
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const common = member[i].some((v, c) => v && member[j][c])
        if (r() < (common ? 0.24 : 0.05)) { friends[i].add(j); friends[j].add(i) }
      }
      const rows: Cell[][] = names.map((nm, i) => [nm, ...member[i], [...friends[i]].map((j) => names[j]).join(';')])
      return table([cat('이름'), ...clubs.map(num), cat('친구')], rows)
    },
  },
  {
    id: 'code-lines', name: '소스 파일 네 개의 줄별 속성 (작성자·수정 시점, 합성)', description: '네 개의 소스 파일(길이가 서로 다름)의 줄마다 줄 번호, 글자 수, 들여쓰기, 작성자, 마지막 수정 후 지난 일수, 종류(코드·주석·빈 줄)와 내용을 적은 합성 자료입니다. 파일마다 오래된 줄과 최근에 고친 줄, 작성자의 분포가 다르게 만들었습니다. 한 행이 한 줄입니다.',
    size: { min: 40, max: 400, default: 160, step: 20, label: '가장 긴 파일의 줄 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const files = [['main.ts', 1], ['chart.ts', 0.8], ['utils.ts', 0.5], ['api.ts', 0.3]] as const
      const authors = ['가영', '나리', '다솜', '라온']
      const words = ['load', 'draw', 'scale', 'render', 'format', 'filter', 'merge', 'parse', 'update', 'select']
      const rows: Cell[][] = []
      files.forEach(([file, frac], fi) => {
        const len = Math.max(12, Math.round(n * frac))
        let author = r.int(0, 3), age = r.int(200, 900)
        for (let ln = 1; ln <= len; ln++) {
          // authorship and age change in runs, as they do in real files
          if (r() < 0.06) { author = r.int(0, 3); age = Math.max(1, Math.round(age * (0.15 + r() * 0.8))) }
          const kind = r() < 0.12 ? '빈 줄' : r() < 0.2 ? '주석' : '코드'
          const indent = kind === '빈 줄' ? 0 : r.int(0, 3) * 2
          const body = kind === '빈 줄' ? '' : kind === '주석' ? `// ${words[r.int(0, 9)]} ${words[r.int(0, 9)]}` : `${r() < 0.3 ? 'const ' : ''}${words[r.int(0, 9)]}(${words[r.int(0, 9)]}, ${r.int(0, 99)})`
          const text = ' '.repeat(indent) + body
          rows.push([file, ln, text.length, indent, authors[(author + fi) % 4], age, kind, text])
        }
      })
      return table([cat('파일'), num('줄'), num('글자 수'), num('들여쓰기'), cat('작성자'), num('수정 후 일수'), cat('종류'), cat('내용')], rows)
    },
  },
]

