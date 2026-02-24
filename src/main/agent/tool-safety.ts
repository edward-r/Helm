export type ToolRisk = 'safe' | 'dangerous'

export type ToolRiskAssessment = {
  risk: ToolRisk
  reason?: string
}

const DANGEROUS_TOOL_NAMES = new Set([
  'write_file',
  'search_web',
  'read_web_page',
  'generate_image',
])

const SAFE_TOOL_NAMES = new Set(['read_file', 'list_dir'])

const DANGEROUS_TOOL_REASONS: Record<string, string> = {
  write_file: 'Writes files to disk.',
  search_web: 'Performs outbound network searches.',
  read_web_page: 'Fetches remote web content.',
  generate_image: 'Calls external image generation APIs and writes files to disk.',
}

const DANGEROUS_NAME_PATTERNS: RegExp[] = [/(^|[_-])(shell|bash|zsh|powershell|cmd|exec)([_-]|$)/i]

const normalizeToolName = (toolName: string): string => toolName.trim().toLowerCase()

export const classifyToolRisk = (toolName: string): ToolRisk => getToolRiskAssessment(toolName).risk

export const getToolRiskAssessment = (toolName: string): ToolRiskAssessment => {
  const normalized = normalizeToolName(toolName)
  if (!normalized) {
    return { risk: 'dangerous', reason: 'Unknown tool; requires approval.' }
  }

  if (DANGEROUS_TOOL_NAMES.has(normalized)) {
    const reason = DANGEROUS_TOOL_REASONS[normalized]
    return reason ? { risk: 'dangerous', reason } : { risk: 'dangerous' }
  }

  if (DANGEROUS_NAME_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { risk: 'dangerous', reason: 'Executes shell commands on this machine.' }
  }

  if (SAFE_TOOL_NAMES.has(normalized)) {
    return { risk: 'safe' }
  }

  return { risk: 'dangerous', reason: 'Unknown tool; requires approval.' }
}

export const isDangerousToolName = (toolName: string): boolean => {
  return getToolRiskAssessment(toolName).risk === 'dangerous'
}
