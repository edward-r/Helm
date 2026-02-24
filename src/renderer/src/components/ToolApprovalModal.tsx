import { useMemo } from 'react'

import { useAgentStore } from '../store/useAgentStore'

const formatArgs = (args: Record<string, unknown>): string => {
  try {
    return JSON.stringify(args, null, 2)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to format arguments.'
    return `Unable to format args: ${message}`
  }
}

const ToolApprovalModal = () => {
  const pendingApproval = useAgentStore((state) => state.pendingApproval)
  const submitApproval = useAgentStore((state) => state.submitApproval)

  const formattedArgs = useMemo(() => {
    if (!pendingApproval) {
      return ''
    }
    return formatArgs(pendingApproval.plan.args)
  }, [pendingApproval])

  if (!pendingApproval) {
    return null
  }

  const riskReason = pendingApproval.plan.riskReason ?? 'No risk reason provided.'

  return (
    <div className="approval-overlay">
      <div className="approval-panel" role="dialog" aria-modal="true">
        <div className="approval-header">
          <div>
            <div className="approval-title">Tool approval required</div>
            <div className="approval-subtitle">{pendingApproval.toolName}</div>
          </div>
        </div>
        <div className="approval-body">
          <div className="approval-section">
            <div className="approval-label">Why this is risky</div>
            <div className="approval-text">{riskReason}</div>
          </div>
          <div className="approval-section">
            <div className="approval-label">Arguments</div>
            <pre className="approval-code">{formattedArgs}</pre>
          </div>
        </div>
        <div className="approval-actions">
          <button
            type="button"
            className="button is-secondary"
            onClick={() => void submitApproval(false)}
          >
            Deny
          </button>
          <button
            type="button"
            className="button is-primary"
            onClick={() => void submitApproval(true)}
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}

export default ToolApprovalModal
