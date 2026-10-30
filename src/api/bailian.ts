import { appLog } from '@/utils/appLog'
import { BAILIAN_REWRITE_PROMPT, BAILIAN_TITLE_TOPICS_PROMPT } from '@/constants/prompts'
import { readStationPreferences } from '@/utils/stationPreferences'

// 开源版：文案改写与标题生成走中转站（OpenAI 兼容）


export interface BailianChatOptions {
  apiKey: string
  model?: string
  prompt: string
  signal?: AbortSignal
}

export async function bailianChatCompletions(options: BailianChatOptions): Promise<unknown> {
  const apiKey = options.apiKey.trim()
  if (!apiKey) throw new Error('缺少 API Key（请在系统设置中填写中转站令牌）')

  const preferences = readStationPreferences()
  const model = options.model || preferences.chatModel
  const messages = [{ role: 'user', content: options.prompt }]
  const electron = window.electronAPI

  if (electron?.dashscopeChatCompletions) {
    return electron.dashscopeChatCompletions({ apiKey, model, messages, baseURL: preferences.baseURL })
  }

  let json: Record<string, unknown> = {}
  try {
    const response = await fetch(`${preferences.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages }),
      signal: options.signal,
    })
    json = (await response.json()) as Record<string, unknown>
    if (!response.ok) {
      const err = json.error as { message?: string } | undefined
      const message =
        err?.message || (typeof json.message === 'string' ? json.message : '') || `请求失败 (${response.status})`
      appLog.error('bailian.chat.failed', { status: response.status, json })
      throw new Error(message)
    }
    return json
  } catch (err) {
    appLog.error('bailian.chat.exception', {
      message: err instanceof Error ? err.message : String(err),
      json,
    })
    throw err
  }
}

export function extractBailianContent(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const root = data as Record<string, unknown>

  const choices = root.choices
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
    const message = (choices[0] as { message?: { content?: string } }).message
    if (typeof message?.content === 'string') return message.content
  }

  if (typeof root.data === 'string') return root.data

  const nested = root.data
  if (nested && typeof nested === 'object') {
    const nestedChoices = (nested as { choices?: unknown }).choices
    if (Array.isArray(nestedChoices) && nestedChoices[0] && typeof nestedChoices[0] === 'object') {
      const message = (nestedChoices[0] as { message?: { content?: string } }).message
      if (typeof message?.content === 'string') return message.content
    }
  }

  return ''
}

export function fillPrompt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ''))
}

export async function rewriteScriptsWithBailian(input: {
  apiKey: string
  persona: string
  sentences: string[]
  signal?: AbortSignal
}): Promise<string[]> {
  const prompt = fillPrompt(BAILIAN_REWRITE_PROMPT, {
    persona: input.persona,
    sentences: JSON.stringify(input.sentences),
    count: input.sentences.length,
  })
  const response = await bailianChatCompletions({
    apiKey: input.apiKey,
    prompt,
    signal: input.signal,
  })
  const content = extractBailianContent(response).trim()
  const parsed = JSON.parse(content) as unknown
  if (!Array.isArray(parsed)) throw new Error('百炼返回格式错误，期望 JSON 数组')
  return parsed.map((line) => String(line ?? '').trim())
}

export async function generateTitleTopicsWithBailian(input: {
  apiKey: string
  content: string
  signal?: AbortSignal
}): Promise<{ title: string; topics: string[] }> {
  const prompt = fillPrompt(BAILIAN_TITLE_TOPICS_PROMPT, {
    content: input.content,
  })
  const response = await bailianChatCompletions({
    apiKey: input.apiKey,
    prompt,
    signal: input.signal,
  })
  const text = extractBailianContent(response).trim()
  const parsed = JSON.parse(text) as { title?: string; topics?: unknown }
  const topics = Array.isArray(parsed.topics)
    ? parsed.topics.map((t) => String(t ?? '').trim()).filter(Boolean)
    : []
  return { title: String(parsed.title || '').trim(), topics }
}
