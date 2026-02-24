import { JSDOM } from 'jsdom'
import puppeteer from 'puppeteer-core'

import type { ResolvedScrapeConfig, ScrapeConfig } from '../config'
import { resolveScrapeConfig } from '../config'
import {
  buildLaunchOptions,
  type PuppeteerAdapter,
  type PuppeteerBrowser,
  type PuppeteerPage,
  type PuppeteerWaitUntil,
} from '../scrape/puppeteer-client'
import { convertHtmlToMarkdown } from '../scrape/markdown'
import { extractReadableArticle, type ReadableArticle } from '../scrape/readability'

export type ReadWebPageSuccess = {
  ok: true
  value: {
    markdown: string
    sourceUrl: string
    title?: string
  }
}

export type ReadWebPageErrorCode =
  | 'INVALID_URL'
  | 'TIMEOUT'
  | 'BLOCKED'
  | 'NAVIGATION_FAILED'
  | 'CONTENT_FAILED'
  | 'EXTRACTION_FAILED'
  | 'MARKDOWN_FAILED'
  | 'UNKNOWN'

export type ReadWebPageError = {
  ok: false
  error: {
    code: ReadWebPageErrorCode
    message: string
    details: {
      url: string
    }
  }
}

export type ReadWebPageResponse = ReadWebPageSuccess | ReadWebPageError

export type ReadWebPageOptions = {
  config?: Partial<ScrapeConfig>
  resolvedConfig?: ResolvedScrapeConfig
  puppeteer?: PuppeteerAdapter
  waitUntil?: PuppeteerWaitUntil
  extractReadableArticle?: (html: string, url: string) => ReadableArticle | null
  convertHtmlToMarkdown?: (html: string) => string
}

type FallbackExtraction = {
  title: string | null
  contentHtml: string | null
  textContent: string | null
  blocked: boolean
}

const BLOCKED_TERMS = [
  'captcha',
  'unusual traffic',
  'verify you are human',
  'not a robot',
  'robot check',
  'access denied',
  'blocked',
  'cloudflare',
]

const FALLBACK_SELECTORS = ['main', 'article', 'body']
const STRIP_SELECTORS = ['script', 'style', 'noscript', 'template', 'iframe']

export const readWebPage = async (
  url: string,
  options?: ReadWebPageOptions,
): Promise<ReadWebPageResponse> => {
  const trimmed = url.trim()
  if (!trimmed) {
    return buildError('INVALID_URL', 'URL must not be empty.', url)
  }

  const parsed = parseHttpUrl(trimmed)
  if (!parsed) {
    return buildError('INVALID_URL', 'Invalid URL. Provide an http(s) URL.', trimmed)
  }

  const baseConfig = options?.resolvedConfig ?? (await resolveScrapeConfig())
  const config = mergeScrapeConfig(baseConfig, options?.config)
  const puppeteerClient = options?.puppeteer ?? puppeteer
  const launchOptions = buildLaunchOptions(config.puppeteer)

  let browser: PuppeteerBrowser | null = null
  let page: PuppeteerPage | null = null

  try {
    browser = await puppeteerClient.launch(launchOptions)
    page = await browser.newPage()
    await applyPageConfig(page, config)

    try {
      await page.goto(parsed.toString(), { waitUntil: options?.waitUntil ?? 'domcontentloaded' })
    } catch (error) {
      return mapNavigationError(error, parsed.toString())
    }

    const sourceUrl = resolveSourceUrl(page, parsed.toString())

    let html: string
    try {
      html = await page.content()
    } catch (error) {
      return mapContentError(error, parsed.toString())
    }

    if (isBlockedHtml(html)) {
      return buildError(
        'BLOCKED',
        'Page appears to block automated browsing. Try again later or use a different URL.',
        parsed.toString(),
      )
    }

    const readableExtractor = options?.extractReadableArticle ?? extractReadableArticle
    const article = readableExtractor(html, sourceUrl)

    const needsFallback = !article?.content || !article.content.trim() || !article.title
    const fallback = needsFallback ? extractFallbackFromHtml(html, sourceUrl) : null

    if (fallback?.blocked) {
      return buildError(
        'BLOCKED',
        'Page appears to block automated browsing. Try again later or use a different URL.',
        parsed.toString(),
      )
    }

    const contentHtml = article?.content?.trim() || fallback?.contentHtml || null
    const title = normalizeOptionalText(article?.title) ?? fallback?.title
    const textContent = normalizeOptionalText(article?.textContent) ?? fallback?.textContent ?? null

    if (!contentHtml && !textContent) {
      return buildError(
        'EXTRACTION_FAILED',
        'Failed to extract readable content from the page.',
        parsed.toString(),
      )
    }

    const markdownConverter = options?.convertHtmlToMarkdown ?? convertHtmlToMarkdown
    const markdown = buildMarkdown(contentHtml, textContent, markdownConverter)
    if (!markdown) {
      return buildError(
        'MARKDOWN_FAILED',
        'Failed to convert the page content to markdown.',
        parsed.toString(),
      )
    }

    const value: ReadWebPageSuccess['value'] = {
      markdown,
      sourceUrl,
    }

    if (title) {
      value.title = title
    }

    return { ok: true, value }
  } catch (error) {
    return mapUnknownError(error, parsed.toString())
  } finally {
    if (page) {
      await safeClosePage(page)
    }
    if (browser) {
      await safeCloseBrowser(browser)
    }
  }
}

const mergeScrapeConfig = (
  base: ResolvedScrapeConfig,
  override?: Partial<ScrapeConfig>,
): ResolvedScrapeConfig => {
  const puppeteerConfig = {
    ...base.puppeteer,
    ...(override?.puppeteer ?? {}),
  }

  const resolved: ResolvedScrapeConfig = {
    outputDir: base.outputDir,
    outputFormat: base.outputFormat,
    puppeteer: puppeteerConfig,
  }

  if (override?.outputDir !== undefined) {
    if (override.outputDir) {
      resolved.outputDir = override.outputDir
    }
  }

  if (override?.outputFormat !== undefined) {
    resolved.outputFormat = override.outputFormat
  }

  return resolved
}

const applyPageConfig = async (
  page: PuppeteerPage,
  config: ResolvedScrapeConfig,
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

const parseHttpUrl = (value: string): URL | null => {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

const resolveSourceUrl = (page: PuppeteerPage, fallback: string): string => {
  try {
    const current = page.url().trim()
    if (!current) {
      return fallback
    }
    const parsed = parseHttpUrl(current)
    return parsed ? parsed.toString() : fallback
  } catch {
    return fallback
  }
}

const extractFallbackFromHtml = (html: string, url: string): FallbackExtraction => {
  const dom = new JSDOM(html, { url })

  try {
    const document = dom.window.document
    const bodyText = document.body?.textContent ?? ''
    const blocked = isBlockedText(bodyText)

    for (const selector of STRIP_SELECTORS) {
      for (const node of Array.from(document.querySelectorAll(selector))) {
        node.remove()
      }
    }

    const contentRoot = findFallbackRoot(document)
    const contentHtml = normalizeOptionalHtml(contentRoot?.innerHTML ?? '')
    const textContent = normalizeOptionalText(
      contentRoot?.textContent ?? document.body?.textContent ?? '',
    )

    return {
      title: normalizeOptionalText(document.title),
      contentHtml,
      textContent,
      blocked,
    }
  } finally {
    dom.window.close()
  }
}

const findFallbackRoot = (document: Document): Element | null => {
  for (const selector of FALLBACK_SELECTORS) {
    const node = document.querySelector(selector)
    if (!node) {
      continue
    }
    if (normalizeOptionalText(node.textContent ?? '')) {
      return node
    }
  }

  return document.body
}

const buildMarkdown = (
  html: string | null,
  fallbackText: string | null,
  convert: (input: string) => string,
): string | null => {
  if (html) {
    try {
      const markdown = normalizeOptionalMarkdown(convert(html))
      if (markdown) {
        return markdown
      }
    } catch {
      // Fall back to text below.
    }
  }

  if (fallbackText) {
    const normalized = normalizeOptionalText(fallbackText)
    if (normalized) {
      return normalized
    }
  }

  return null
}

const buildError = (code: ReadWebPageErrorCode, message: string, url: string): ReadWebPageError => {
  return {
    ok: false,
    error: {
      code,
      message,
      details: { url },
    },
  }
}

const isBlockedHtml = (html: string): boolean => {
  const normalized = normalizeForMatch(html.replace(/<[^>]+>/g, ' '))
  return BLOCKED_TERMS.some((term) => normalized.includes(term))
}

const isBlockedText = (value: string): boolean => {
  const normalized = normalizeForMatch(value)
  return BLOCKED_TERMS.some((term) => normalized.includes(term))
}

const normalizeOptionalHtml = (value?: string | null): string | null => {
  const normalized = value?.replace(/\r/g, '').trim()
  return normalized && normalized.length > 0 ? normalized : null
}

const normalizeOptionalMarkdown = (value?: string | null): string | null => {
  const normalized = value?.replace(/\r/g, '').trim()
  return normalized && normalized.length > 0 ? normalized : null
}

const normalizeOptionalText = (value?: string | null): string | null => {
  if (!value) {
    return null
  }

  const normalized = value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return normalized && normalized.length > 0 ? normalized : null
}

const normalizeForMatch = (value: string): string => {
  const normalized = normalizeOptionalText(value)
  return normalized ? normalized.replace(/\s+/g, ' ').toLowerCase() : ''
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

const mapNavigationError = (error: unknown, url: string): ReadWebPageError => {
  if (isTimeoutError(error)) {
    return buildError('TIMEOUT', 'Timed out navigating to the page.', url)
  }

  const message = error instanceof Error ? error.message : 'Navigation failed.'
  return buildError('NAVIGATION_FAILED', message, url)
}

const mapContentError = (error: unknown, url: string): ReadWebPageError => {
  if (isTimeoutError(error)) {
    return buildError('TIMEOUT', 'Timed out retrieving page content.', url)
  }

  const message = error instanceof Error ? error.message : 'Failed to capture page content.'
  return buildError('CONTENT_FAILED', message, url)
}

const mapUnknownError = (error: unknown, url: string): ReadWebPageError => {
  const message = error instanceof Error ? error.message : 'Unknown error.'
  return buildError('UNKNOWN', message, url)
}

const safeClosePage = async (page: PuppeteerPage): Promise<void> => {
  try {
    await page.close()
  } catch {
    // Ignore close errors.
  }
}

const safeCloseBrowser = async (browser: PuppeteerBrowser): Promise<void> => {
  try {
    await browser.close()
  } catch {
    // Ignore close errors.
  }
}
