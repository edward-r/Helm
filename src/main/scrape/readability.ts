import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'

export type ReadableArticle = {
  title: string | null
  content: string
  textContent: string | null
  excerpt: string | null
  byline: string | null
  siteName: string | null
  length: number
}

export const extractReadableArticle = (html: string, url: string): ReadableArticle | null => {
  const dom = new JSDOM(html, { url })

  try {
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    if (!article?.content) {
      return null
    }

    const title = normalizeOptionalText(article.title)
    const textContent = normalizeOptionalText(article.textContent)
    const excerpt = normalizeOptionalText(article.excerpt)
    const byline = normalizeOptionalText(article.byline)
    const siteName = normalizeOptionalText(article.siteName)
    const length = typeof article.length === 'number' ? article.length : article.content.length

    return {
      title,
      content: article.content,
      textContent,
      excerpt,
      byline,
      siteName,
      length,
    }
  } finally {
    dom.window.close()
  }
}

const normalizeOptionalText = (value?: string | null): string | null => {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}
