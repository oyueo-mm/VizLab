import katex from 'katex'
import 'katex/dist/katex.min.css'
import { ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { loadContent } from '../content/loader'
import type { Formula, VizContent } from '../content/types'
import { Related } from './Related'

function FormulaView({ f }: { f: Formula }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(f.tex, { displayMode: true, throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' })
    } catch {
      return null
    }
  }, [f.tex])
  return (
    <figure className="formula">
      {html ? <div className="formula-math" dangerouslySetInnerHTML={{ __html: html }} /> : <code>{f.tex}</code>}
      <figcaption>{f.caption}</figcaption>
    </figure>
  )
}

const List = ({ items }: { items: string[] }) => <ul>{items.map((t) => <li key={t}>{t}</li>)}</ul>

type Loaded = { id: string; content: VizContent | undefined } | { id: string; error: true }

export default function Details({ id, open, onToggle }: { id: string; open: boolean; onToggle: () => void }) {
  // The explanation text is loaded when the lab shows it (one version group at a time), not with the page.
  const [state, setState] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    loadContent(id).then((c) => { if (live) setState({ id, content: c }) }).catch(() => { if (live) setState({ id, error: true }) })
    return () => { live = false }
  }, [id, attempt])
  const current = state && state.id === id ? state : null
  if (current && 'content' in current && !current.content) return null
  const c = current && 'content' in current ? current.content : undefined
  return (
    <section className={`lab-details ${open ? 'is-open' : ''}`} aria-label="상세 설명">
      <button type="button" className="details-toggle" aria-expanded={open} aria-controls="details-body" onClick={onToggle} data-testid="details-toggle">
        <span>상세 설명</span>
        <span className="details-sub">정의 · 적합한 데이터 · 작동 원리 · 수식 · 장단점 · 주의사항 · 비슷한 시각화</span>
        <ChevronDown size={18} className={open ? 'rot-180' : ''} aria-hidden="true" />
      </button>
      {open && !c && (
        <div id="details-body" className="details-body" data-testid="details-body" role="status">
          {current && 'error' in current ? (
            <p>설명을 불러오지 못했습니다. <button type="button" className="link-btn" onClick={() => { setState(null); setAttempt((a) => a + 1) }} data-testid="details-retry">다시 시도</button></p>
          ) : <p>설명을 불러오는 중…</p>}
        </div>
      )}
      {open && c && (
        <div id="details-body" className="details-body" data-testid="details-body">
          <article>
            <h3>정의</h3>
            <p>{c.definition}</p>
            {c.note && <p className="details-note" data-testid="details-note">{c.note}</p>}
            {c.encoding && <><h3>시각적 매핑</h3><List items={c.encoding} /></>}
            <h3>어떤 데이터에 적합한가</h3>
            <List items={c.suitable} />
            <h3>작동 원리</h3>
            <ol>{c.howItWorks.map((t) => <li key={t}>{t}</li>)}</ol>
          </article>
          <article>
            <h3>수학적 원리</h3>
            {c.math.map((f) => <FormulaView key={f.tex} f={f} />)}
          </article>
          <article>
            <div className="pros-cons">
              <div><h3>장점</h3><List items={c.pros} /></div>
              <div><h3>단점</h3><List items={c.cons} /></div>
            </div>
            <h3>주의사항</h3>
            <List items={c.cautions} />
            {c.differs && <><h3>다른 기법과의 차이</h3><List items={c.differs} /></>}
            <h3>비슷한 시각화</h3>
            <Related id={id} />
            {c.references && <><h3>참고자료</h3><List items={c.references} /></>}
          </article>
        </div>
      )}
    </section>
  )
}
