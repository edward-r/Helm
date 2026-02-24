import { Launcher } from 'chrome-launcher'
import puppeteer from 'puppeteer-core'
import type { LaunchOptions } from 'puppeteer-core'

import type { PuppeteerConfig } from '../config'

export type PuppeteerWaitUntil = 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'

export type PuppeteerPage = {
  setUserAgent: (userAgent: string) => Promise<void> | void
  setDefaultNavigationTimeout: (timeout: number) => void
  setDefaultTimeout: (timeout: number) => void
  goto: (
    url: string,
    options?: { waitUntil?: PuppeteerWaitUntil; timeout?: number },
  ) => Promise<unknown>
  waitForSelector: (selector: string, options?: { timeout?: number }) => Promise<unknown>
  content: () => Promise<string>
  url: () => string
  close: () => Promise<void>
}

export type PuppeteerBrowser = {
  newPage: () => Promise<PuppeteerPage>
  close: () => Promise<void>
}

export type PuppeteerAdapter = {
  launch: (options: LaunchOptions) => Promise<PuppeteerBrowser>
}

export type FetchPageHtmlOptions = {
  puppeteer?: PuppeteerAdapter
  launchOptions?: LaunchOptions
  waitUntil?: PuppeteerWaitUntil
}

let cachedExecutablePath: string | null | undefined

const resolveExecutablePath = (config: PuppeteerConfig): string | undefined => {
  if (config.executablePath) {
    return config.executablePath
  }

  if (cachedExecutablePath !== undefined) {
    return cachedExecutablePath ?? undefined
  }

  try {
    const found = Launcher.getFirstInstallation()
    cachedExecutablePath = found ?? null
  } catch {
    cachedExecutablePath = null
  }

  return cachedExecutablePath ?? undefined
}

export const buildLaunchOptions = (config: PuppeteerConfig): LaunchOptions => {
  const normalizedHeadless = config.headless === 'new' ? true : config.headless
  const resolvedHeadless = normalizedHeadless ?? true
  const options: LaunchOptions = {
    headless: resolvedHeadless,
  }

  if (resolvedHeadless === false) {
    options.defaultViewport = null
  }

  if (config.slowMoMs !== undefined) {
    options.slowMo = config.slowMoMs
  }

  const executablePath = resolveExecutablePath(config)
  if (executablePath) {
    options.executablePath = executablePath
  }

  if (config.args && config.args.length > 0) {
    options.args = config.args
  }

  return options
}

export const fetchPageHtml = async (
  url: string,
  config: PuppeteerConfig,
  options?: FetchPageHtmlOptions,
): Promise<string> => {
  const puppeteerClient = options?.puppeteer ?? puppeteer
  const launchOptions = {
    ...buildLaunchOptions(config),
    ...(options?.launchOptions ?? {}),
  }

  const browser = await puppeteerClient.launch(launchOptions)

  try {
    const page = await browser.newPage()

    if (config.userAgent) {
      await page.setUserAgent(config.userAgent)
    }

    if (config.navigationTimeoutMs !== undefined) {
      page.setDefaultNavigationTimeout(config.navigationTimeoutMs)
    }

    if (config.operationTimeoutMs !== undefined) {
      page.setDefaultTimeout(config.operationTimeoutMs)
    }

    await page.goto(url, {
      waitUntil: options?.waitUntil ?? 'networkidle0',
    })

    return await page.content()
  } finally {
    await safeClose(browser)
  }
}

const safeClose = async (browser: PuppeteerBrowser): Promise<void> => {
  try {
    await browser.close()
  } catch {
    // Swallow close errors to avoid masking the original failure.
  }
}
