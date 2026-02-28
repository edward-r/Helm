export const isReasoningModel = (modelId: string): boolean => {
  const normalized = modelId.trim().toLowerCase()
  return (
    /(^|[^a-z0-9])o(?:1|3|4|5)(?:[^a-z0-9]|$)/i.test(normalized) ||
    normalized.includes('thinking') ||
    normalized.includes('gpt-5')
  )
}
