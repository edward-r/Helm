import fs from 'node:fs/promises'
import path from 'node:path'

const PROMPT_EMISSION_SCHEMA_VERSION = '1'
const PROMPT_EMISSION_SYSTEM_INSTRUCTIONS =
  'Execute the prompt contract in <user_query> exactly. Follow all constraints and output format rules.'

const normalizeNewlines = (value: string): string =>
  value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

const stripTrailingWhitespace = (value: string): string =>
  value
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')

const normalizeForOutput = (value: string): string =>
  stripTrailingWhitespace(normalizeNewlines(value))

const escapeCdata = (value: string): string => value.replace(/\]\]>/g, ']]]]><![CDATA[>')

const wrapXmlSection = (tag: string, content: string): string => {
  const normalized = normalizeForOutput(content)
  const escaped = escapeCdata(normalized)
  return `<${tag}>\n<![CDATA[${escaped}]]>\n</${tag}>`
}

const loadAgentsContext = async (): Promise<string> => {
  try {
    const agentsPath = path.resolve(process.cwd(), 'AGENTS.md')
    const content = await fs.readFile(agentsPath, 'utf8')
    return `<file path="AGENTS.md">\n${content}\n</file>`
  } catch {
    return ''
  }
}

export const buildPromptEmissionXml = async (options: {
  prompt: string
  systemInstructions?: string
  documentContext?: string
}): Promise<string> => {
  const baseContext = await loadAgentsContext()
  const extraContext = options.documentContext ?? ''
  const documentContext = [baseContext, extraContext].filter(Boolean).join('\n\n')
  const systemInstructions = options.systemInstructions ?? PROMPT_EMISSION_SYSTEM_INSTRUCTIONS
  const userQuery = options.prompt

  const blocks = [
    wrapXmlSection('document_context', documentContext),
    wrapXmlSection('system_instructions', systemInstructions),
    wrapXmlSection('user_query', userQuery)
  ]

  return [
    `<prompt_emission schemaVersion="${PROMPT_EMISSION_SCHEMA_VERSION}">`,
    ...blocks,
    '</prompt_emission>'
  ].join('\n')
}
