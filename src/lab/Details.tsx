import katex from 'katex'
import 'katex/dist/katex.min.css'
import { ChevronDown } from 'lucide-react'
import { useMemo } from 'react'
import { content, type Formula } from '../content'
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

export default function Details({ id, open, onToggle }: { id: string; open: boolean; onToggle: () => void }) {
  const c = content[id]
  if (!c) return null
  return (
    <section className={`lab-details ${open ? 'is-open' : ''}`} aria-label="상세 설명">
      <button type="button" className="details-toggle" aria-expanded={open} aria-controls="details-body" onClick={onToggle} data-testid="details-toggle">
        <span>상세 설명</span>
        <span className="details-sub">정의 · 적합한 데이터 · 작동 원리 · 수식 · 장단점 · 주의사항 · 비슷한 시각화</span>
        <ChevronDown size={18} className={open ? 'rot-180' : ''} aria-hidden="true" />
      </button>
      {open && (
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
