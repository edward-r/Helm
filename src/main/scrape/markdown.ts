import TurndownService from 'turndown'

export type MarkdownOptions = {
  headingStyle?: 'setext' | 'atx'
  bulletListMarker?: '-' | '*' | '+'
  codeBlockStyle?: 'indented' | 'fenced'
  emDelimiter?: '_' | '*'
  strongDelimiter?: '**' | '__'
  linkStyle?: 'inlined' | 'referenced'
  linkReferenceStyle?: 'full' | 'collapsed' | 'shortcut'
}

const DEFAULT_OPTIONS: MarkdownOptions = {
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
  strongDelimiter: '**',
  linkStyle: 'inlined',
  linkReferenceStyle: 'full',
}

export const convertHtmlToMarkdown = (html: string, options?: MarkdownOptions): string => {
  const turndown = new TurndownService({ ...DEFAULT_OPTIONS, ...(options ?? {}) })
  return turndown.turndown(html).replace(/\r/g, '').trim()
}
