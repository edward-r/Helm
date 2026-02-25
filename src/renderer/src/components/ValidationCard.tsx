import { useAgentStore } from '../store/useAgentStore'

const getScoreTone = (score: number): 'good' | 'warn' | 'bad' => {
  if (score >= 80) {
    return 'good'
  }
  if (score >= 50) {
    return 'warn'
  }
  return 'bad'
}

const renderListItems = (items: string[], emptyLabel: string) => {
  if (items.length === 0) {
    return <li className="validation-empty">{emptyLabel}</li>
  }
  return items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)
}

const ValidationCard = () => {
  const validationReport = useAgentStore((state) => state.validationReport)
  const isValidating = useAgentStore((state) => state.isValidating)

  if (!validationReport && !isValidating) {
    return null
  }

  if (isValidating) {
    return <div className="validation-card is-loading">Analyzing prompt quality...</div>
  }

  if (!validationReport) {
    return null
  }

  const scoreValue = Math.round(validationReport.score)
  const tone = getScoreTone(scoreValue)

  return (
    <div className="validation-card">
      <div className="validation-header">
        <div className={`validation-score is-${tone}`}>
          <span className="validation-score-label">Score</span>
          <span className="validation-score-value">{scoreValue}</span>
        </div>
        <div className="validation-title">Prompt Quality</div>
      </div>
      <div className="validation-body">
        <div className="validation-section">
          <div className="validation-section-title">Pros</div>
          <ul className="validation-list">
            {renderListItems(validationReport.feedback, 'No strengths called out yet.')}
          </ul>
        </div>
        <div className="validation-section">
          <div className="validation-section-title">Cons</div>
          <ul className="validation-list">
            {renderListItems(validationReport.improvements, 'No gaps highlighted yet.')}
          </ul>
        </div>
      </div>
    </div>
  )
}

export default ValidationCard
