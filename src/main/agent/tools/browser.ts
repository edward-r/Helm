import type { JsonSchema } from '@prompt-maker/core'

import type { AgentTool } from './tool-types'
import { readWebPage } from '../../tools/read-web-page'
import { searchWeb } from '../../tools/search-web'

export { readWebPage } from '../../tools/read-web-page'
export type {
  ReadWebPageError,
  ReadWebPageErrorCode,
  ReadWebPageOptions,
  ReadWebPageResponse,
  ReadWebPageSuccess,
} from '../../tools/read-web-page'
export { searchWeb } from '../../tools/search-web'
export type {
  SearchWebError,
  SearchWebErrorCode,
  SearchWebOptions,
  SearchWebResponse,
  SearchWebResultItem,
  SearchWebSuccess,
} from '../../tools/search-web'

const READ_WEB_PAGE_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'Fetch and extract readable markdown from a URL.',
  properties: {
    url: {
      type: 'string',
      description: 'The http(s) URL to fetch and extract.',
    },
  },
  required: ['url'],
  additionalProperties: false,
}

const SEARCH_WEB_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'Search DuckDuckGo HTML for top results.',
  properties: {
    query: {
      type: 'string',
      description: 'The query string to search for.',
    },
  },
  required: ['query'],
  additionalProperties: false,
}

/**
 * Tool: read_web_page
 * Input: { url: string }
 * Output: { ok: true, value: { markdown: string, sourceUrl: string, title?: string } }
 *   | { ok: false, error: { code, message, details: { url } } }
 * Errors: INVALID_URL, TIMEOUT, BLOCKED, NAVIGATION_FAILED, CONTENT_FAILED,
 *   EXTRACTION_FAILED, MARKDOWN_FAILED, UNKNOWN
 * Config/env: config.json `scrape` plus `PROMPT_MAKER_SCRAPE_*` and `PUPPETEER_*` env vars.
 * Example input: { "url": "https://example.com" }
 * Example output: { "ok": true, "value": { "markdown": "...", "sourceUrl": "https://example.com" } }
 */
const READ_WEB_PAGE_TOOL: AgentTool = {
  name: 'read_web_page',
  description: 'Fetch a URL and extract the main content as markdown.',
  inputSchema: READ_WEB_PAGE_SCHEMA,
  execute: async (input: unknown) => {
    const url = getString(input, 'url')
    return await readWebPage(url)
  },
}

/**
 * Tool: search_web
 * Input: { query: string }
 * Output: { ok: true, value: { engine: "duckduckgo_html", query, results, meta } }
 *   | { ok: false, error: { code, message, details: { query } } }
 * Errors: TIMEOUT, NO_RESULTS, BLOCKED, NAVIGATION_FAILED, UNKNOWN
 * Config/env: config.json `searchWeb` plus `PROMPT_MAKER_SEARCH_WEB_*` and `PUPPETEER_*` env vars.
 * Example input: { "query": "prompt maker" }
 * Example output: { "ok": true, "value": { "engine": "duckduckgo_html", "query": "prompt maker", "results": [] } }
 */
const SEARCH_WEB_TOOL: AgentTool = {
  name: 'search_web',
  description: 'Search the web (DuckDuckGo HTML) and return top results.',
  inputSchema: SEARCH_WEB_SCHEMA,
  execute: async (input: unknown) => {
    const query = getString(input, 'query')
    return await searchWeb(query)
  },
}

export const browserTools: AgentTool[] = [READ_WEB_PAGE_TOOL, SEARCH_WEB_TOOL]

const getString = (input: unknown, key: string): string => {
  if (isRecord(input)) {
    const value = input[key]
    if (typeof value === 'string') {
      return value
    }
  }
  return ''
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
