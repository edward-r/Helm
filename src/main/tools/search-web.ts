import { JSDOM } from 'jsdom'
import puppeteer from 'puppeteer-core'

import type { ResolvedSearchWebConfig, SearchWebConfig } from '../config'
import { resolveSearchWebConfig } from '../config'
import {
  buildLaunchOptions,
  type PuppeteerAdapter,
  type PuppeteerBrowser,
  type PuppeteerPage,
  type PuppeteerWaitUntil,
} from '../scrape/puppeteer-client'

export type SearchWebResultItem = {
  title: string
  url: string
  snippet: string
}

export type SearchWebSuccess = {
  ok: true
  value: {
    engine: 'duckduckgo_html'
    query: string
    results: SearchWebResultItem[]
    meta: {
      limit: number
      elapsedMs: number
    }
  }
}

export type SearchWebErrorCode =
  | 'TIMEOUT'
  | 'NO_RESULTS'
  | 'BLOCKED'
  | 'NAVIGATION_FAILED'
  | 'UNKNOWN'

export type SearchWebError = {
  ok: false
  error: {
    code: SearchWebErrorCode
    message: string
    details: {
      query: string
    }
  }
}

export type SearchWebResponse = SearchWebSuccess | SearchWebError

export type SearchWebOptions = {
  config?: Partial<SearchWebConfig>
  resolvedConfig?: ResolvedSearchWebConfig
  puppeteer?: PuppeteerAdapter
  waitUntil?: PuppeteerWaitUntil
  now?: () => number
}

const DUCKDUCKGO_ENGINE = 'duckduckgo_html'
const DUCKDUCKGO_SEARCH_URL = 'https://html.duckduckgo.com/html/?q='
const RESULT_SELECTOR = '.results .result, .result'
const RESULT_LINK_SELECTOR = 'a.result__a, a.result__url'
const RESULT_SNIPPET_SELECTOR = '.result__snippet, .result__snippetjs, a.result__snippet'
const BLOCKED_TERMS = ['captcha', 'unusual traffic', 'verify you are human', 'robot']
const NO_RESULTS_TERMS = ['no results', 'no result', 'no matches', 'no search results']

export const searchWeb = async (
  query: string,
  options?: SearchWebOptions,
): Promise<SearchWebResponse> => {
  const trimmed = query.trim()
  if (!trimmed) {
    return buildError('UNKNOWN', 'Query must not be empty.', query)
  }

  const now = options?.now ?? Date.now
  const startedAt = now()
  const baseConfig = options?.resolvedConfig ?? (await resolveSearchWebConfig())
  const config = mergeSearchWebConfig(baseConfig, options?.config)
  const targetUrl = `${DUCKDUCKGO_SEARCH_URL}${encodeURIComponent(trimmed)}`

  const puppeteerClient = options?.puppeteer ?? puppeteer
  const launchOptions = buildLaunchOptions(config.puppeteer)
  const launchArgs = [...(launchOptions.args ?? [])]
  if (config.proxy) {
    launchArgs.push(`--proxy-server=${config.proxy}`)
  }
  if (launchArgs.length > 0) {
    launchOptions.args = launchArgs
  }

  let browser: PuppeteerBrowser | null = null

  try {
    browser = await puppeteerClient.launch(launchOptions)
    const page = await browser.newPage()
    await applyPageConfig(page, config)

    try {
      await page.goto(targetUrl, { waitUntil: options?.waitUntil ?? 'domcontentloaded' })
    } catch (error) {
      return mapNavigationError(error, trimmed)
    }

    const selectorResult = await waitForResults(page, config, trimmed)
    if (!selectorResult.ok) {
      return selectorResult.response
    }

    const html = await page.content()
    const parsed = parseDuckDuckGoHtml(html, config.resultsLimit)

    if (parsed.blocked) {
      return buildError('BLOCKED', 'DuckDuckGo blocked the request.', trimmed)
    }

    if (parsed.results.length === 0) {
      return buildError('NO_RESULTS', 'No results found.', trimmed)
    }

    return {
      ok: true,
      value: {
        engine: DUCKDUCKGO_ENGINE,
        query: trimmed,
        results: parsed.results,
        meta: {
          limit: config.resultsLimit,
          elapsedMs: Math.max(0, now() - startedAt),
        },
      },
    }
  } catch (error) {
    return mapUnknownError(error, trimmed)
  } finally {
    if (browser) {
      await safeClose(browser)
    }
  }
}

const mergeSearchWebConfig = (
  base: ResolvedSearchWebConfig,
  override?: Partial<SearchWebConfig>,
): ResolvedSearchWebConfig => {
  const puppeteerConfig = {
    ...base.puppeteer,
    ...(override?.puppeteer ?? {}),
  }

  const resolved: ResolvedSearchWebConfig = {
    resultsLimit: resolveResultsLimit(override?.resultsLimit ?? base.resultsLimit),
    puppeteer: puppeteerConfig,
  }

  if (override?.proxy !== undefined) {
    if (override.proxy) {
      resolved.proxy = override.proxy
    }
  } else if (base.proxy) {
    resolved.proxy = base.proxy
  }

  if (override?.outputDir !== undefined) {
    if (override.outputDir) {
      resolved.outputDir = override.outputDir
    }
  } else if (base.outputDir) {
    resolved.outputDir = base.outputDir
  }

  return resolved
}

const resolveResultsLimit = (value: number): number => {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error('searchWeb.resultsLimit must be a positive integer.')
  }
  return value
}

const applyPageConfig = async (
  page: PuppeteerPage,
  config: ResolvedSearchWebConfig,
): Promise<void> => {
  if (config.puppeteer.userAgent) {
    await page.setUserAgent(config.puppeteer.userAgent)
  }

  if (config.puppeteer.navigationTimeoutMs !== undefined) {
    page.setDefaultNavigationTimeout(config.puppeteer.navigationTimeoutMs)
  }

  if (config.puppeteer.operationTimeoutMs !== undefined) {
    page.setDefaultTimeout(config.puppeteer.operationTimeoutMs)
  }
}

const waitForResults = async (
  page: PuppeteerPage,
  config: ResolvedSearchWebConfig,
  query: string,
): Promise<{ ok: true } | { ok: false; response: SearchWebError }> => {
  try {
    const timeout = config.puppeteer.navigationTimeoutMs
    const waitOptions = timeout !== undefined ? { timeout } : undefined
    await page.waitForSelector(RESULT_SELECTOR, waitOptions)
    return { ok: true }
  } catch (error) {
    const html = await safePageContent(page)
    if (html) {
      const parsed = parseDuckDuckGoHtml(html, config.resultsLimit)
      if (parsed.blocked) {
        return {
          ok: false,
          response: buildError('BLOCKED', 'DuckDuckGo blocked the request.', query),
        }
      }
      if (parsed.noResults) {
        return { ok: false, response: buildError('NO_RESULTS', 'No results found.', query) }
      }
    }

    if (isTimeoutError(error)) {
      return {
        ok: false,
        response: buildError('TIMEOUT', 'Timed out waiting for search results.', query),
      }
    }

    return {
      ok: false,
      response: buildError('NAVIGATION_FAILED', 'Failed to load search results.', query),
    }
  }
}

const safePageContent = async (page: PuppeteerPage): Promise<string | null> => {
  try {
    return await page.content()
  } catch {
    return null
  }
}

const parseDuckDuckGoHtml = (
  html: string,
  limit: number,
): { results: SearchWebResultItem[]; blocked: boolean; noResults: boolean } => {
  const dom = new JSDOM(html)

  try {
    const document = dom.window.document

    const bodyText = document.body?.textContent ?? ''
    const normalizedText = normalizeForMatch(bodyText)
    const blocked = BLOCKED_TERMS.some((term) => normalizedText.includes(term))
    const noResults =
      NO_RESULTS_TERMS.some((term) => normalizedText.includes(term)) ||
      Boolean(document.querySelector('.no-results, #no_results'))

    const resultNodes = Array.from(document.querySelectorAll(RESULT_SELECTOR))
    const results: SearchWebResultItem[] = []

    for (const node of resultNodes) {
      const item = extractResult(node)
      if (!item) {
        continue
      }
      results.push(item)
      if (results.length >= limit) {
        break
      }
    }

    return { results, blocked, noResults }
  } finally {
    dom.window.close()
  }
}

const extractResult = (node: Element): SearchWebResultItem | null => {
  const link = node.querySelector(RESULT_LINK_SELECTOR)
  const title = normalizeTextContent(link?.textContent ?? '')
  const href = link?.getAttribute('href') ?? ''
  const url = normalizeResultUrl(href)

  if (!title || !url) {
    return null
  }

  const snippet = normalizeTextContent(
    node.querySelector(RESULT_SNIPPET_SELECTOR)?.textContent ?? '',
  )

  return { title, url, snippet }
}

const normalizeResultUrl = (href: string): string | null => {
  const trimmed = href.trim()
  if (!trimmed) {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed, 'https://duckduckgo.com')
  } catch {
    return null
  }

  if (parsed.hostname.endsWith('duckduckgo.com') && parsed.pathname === '/l/') {
    const uddg = parsed.searchParams.get('uddg')
    if (!uddg) {
      return null
    }
    try {
      parsed = new URL(decodeURIComponent(uddg))
    } catch {
      return null
    }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null
  }

  return parsed.toString()
}

const normalizeTextContent = (value: string): string => {
  return value.replace(/\s+/g, ' ').trim()
}

const normalizeForMatch = (value: string): string => {
  return normalizeTextContent(value).toLowerCase()
}

const buildError = (code: SearchWebErrorCode, message: string, query: string): SearchWebError => {
  return {
    ok: false,
    error: {
      code,
      message,
      details: { query },
    },
  }
}

const isTimeoutError = (error: unknown): boolean => {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') {
      return true
    }
    return /timeout/i.test(error.message)
  }
  return false
}

const mapNavigationError = (error: unknown, query: string): SearchWebError => {
  if (isTimeoutError(error)) {
    return buildError('TIMEOUT', 'Timed out navigating to DuckDuckGo.', query)
  }

  const message = error instanceof Error ? error.message : 'Navigation failed.'
  return buildError('NAVIGATION_FAILED', message, query)
}

const mapUnknownError = (error: unknown, query: string): SearchWebError => {
  const message = error instanceof Error ? error.message : 'Unknown error.'
  return buildError('UNKNOWN', message, query)
}

const safeClose = async (browser: PuppeteerBrowser): Promise<void> => {
  try {
    await browser.close()
  } catch {
    // Ignore close errors.
  }
}
