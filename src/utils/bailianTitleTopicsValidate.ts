import { BAILIAN_TITLE_TOPICS_PROMPT } from '@/constants/prompts'

export interface ParsedTitleTopics {
  exact: boolean
  title: string
  topics: string[]
}

function normalizeTitle(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^标题[:：]?\s*/i, '')
    .replace(/\s+/g, '')
}

function normalizeTopic(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^#+/, '')
    .replace(/^话题[:：]?\s*/i, '')
    .replace(/\s+/g, '')
}

export function parseTitleTopicsContent(raw: string): ParsedTitleTopics {
  const text = String(raw || '').trim()
  if (!text) return { exact: false, title: '', topics: [] }

  let jsonText = text
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) {
    jsonText = fenced[1].trim()
  } else {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) jsonText = text.slice(start, end + 1)
  }

  try {
    const parsed = JSON.parse(jsonText) as { title?: unknown; topics?: unknown }
    const title = normalizeTitle(String(parsed?.title ?? ''))
    const topics: string[] = []
    const rawTopics = Array.isArray(parsed?.topics) ? parsed.topics : []
    for (const item of rawTopics) {
      const topic = normalizeTopic(String(item ?? ''))
      if (topic && !topics.includes(topic)) topics.push(topic)
    }
    const exact =
      !!title &&
      title.length <= 20 &&
      topics.length >= 3 &&
      topics.length <= 5 &&
      topics.every((topic) => topic.length <= 10)
    return { exact, title, topics }
  } catch {
    return { exact: false, title: '', topics: [] }
  }
}

export function buildTitleTopicsRetryPrompt(content: string): string {
  return `${BAILIAN_TITLE_TOPICS_PROMPT.replace('{{content}}', content)}

系统校验提醒
你上一次返回的结果不符合要求，请重新输出，这一次只允许返回一个 JSON 对象
title 必须非空且不超过20个字
topics 必须是 3 到 5 个字符串数组
每个 topic 不超过10个字
除 JSON 对象外不要输出任何文字`
}

export function formatTopicsForStorage(topics: string[]): string {
  return topics.map((topic) => `#${topic}`).join(' ')
}

export function parseTopicsInput(value: string): string[] {
  return String(value || '')
    .split(/[\s,，、]+/g)
    .map((item) => item.trim().replace(/^#+/, ''))
    .filter(Boolean)
}
