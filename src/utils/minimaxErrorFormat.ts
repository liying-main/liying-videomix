const CODE_MESSAGES = new Map<number, string>([
  [1002, 'MiniMax 请求过于频繁，请稍后再试'],
  [1008, 'MiniMax 余额不足，请充值或更换可用 API Key 后重试'],
])

const MESSAGE_PATTERNS: Array<[RegExp, string]> = [
  [/(insufficient\s*balance|balance\s*insufficient|余额不足|账户余额|account\s*balance)/i, 'MiniMax 余额不足，请充值或更换可用 API Key 后重试'],
  [/(quota|credit|billing|payment|arrears|欠费|额度不足|额度已用完|额度超限)/i, 'MiniMax 余额或额度不足，请检查账户余额、套餐额度或更换 API Key'],
  [/invalid\s*(params?|parameters?)|bad\s*request|parameter\s*error|参数/i, '参数无效，请检查音色 ID、文本内容或上传音频是否符合 MiniMax 要求'],
  [/voice[_\s-]?id.*(exist|duplicate|already)|voice.*already.*exists|音色.*已存在/i, '该音色 ID 已存在，请换一个新的音色 ID'],
  [/voice[_\s-]?id.*(not\s*found|not\s*exist|missing)|voice.*not.*found|voice.*missing|音色.*不存在/i, '音色 ID 不存在，请先复刻或选择已创建的音色'],
  [/(unauthorized|unauthori[sz]ed|invalid.*api.*key|api.*key.*invalid|invalid.*token|token.*invalid|鉴权|认证失败)/i, 'MiniMax Key 无效或已过期，请检查 Key 是否正确'],
  [/(forbidden|permission|no\s*access|access\s*denied|not\s*allowed|无权限|权限不足)/i, 'MiniMax Key 没有当前接口权限，请检查账号权限或接口开通状态'],
  [/(rate\s*limit|too\s*many\s*requests|frequency|frequent|qps|请求.*频繁)/i, 'MiniMax 请求过于频繁，请稍后再试'],
  [/(file.*too.*large|too.*large|payload.*large|文件.*过大)/i, '音频文件过大，请使用 20MB 以内的音频'],
  [/(unsupported.*file|invalid.*file|file.*format|format.*invalid|unsupported.*format|格式.*不支持)/i, '音频格式不支持，请使用 wav、mp3 或 m4a'],
  [/(duration.*short|too.*short|音频.*短|时长.*短)/i, '音频时长过短，请使用 10 秒以上的音频'],
  [/(duration.*long|too.*long|音频.*长|时长.*长)/i, '音频时长过长，请使用 5 分钟以内的音频'],
  [/(text.*empty|empty.*text|text.*blank|文本.*为空)/i, '文本不能为空，请填写要生成或试听的文案'],
  [/(text.*too.*long|input.*too.*long|文本.*过长)/i, '文本过长，请缩短文案后重试'],
  [/(sensitive|violate|violation|content.*policy|risk|安全|敏感|违规)/i, '文本或音频内容未通过 MiniMax 安全校验，请调整内容后重试'],
  [/(model.*not.*found|model.*invalid|unsupported.*model|模型.*不存在|模型.*不支持)/i, '当前 MiniMax 模型不可用，请更换模型或稍后重试'],
  [/(language.*unsupported|unsupported.*language|语言.*不支持)/i, '当前语言暂不支持，请调整文本语言或语言增强参数'],
  [/(timeout|timed\s*out|超时)/i, 'MiniMax 请求超时，请稍后重试'],
  [/(failed\s*to\s*fetch|network\s*error|networkerror|connection|网络|连接失败)/i, '网络异常，无法连接 MiniMax，请检查网络后重试'],
  [/(internal\s*server\s*error|server\s*error|service\s*unavailable|bad\s*gateway|服务.*异常)/i, 'MiniMax 服务暂时异常，请稍后重试'],
]

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function pickCode(value: unknown): number | null {
  const root = asRecord(value)
  if (!root) return null
  const base = asRecord(root.base_resp)
  const fromBase = base ? Number(base.status_code) : NaN
  if (Number.isFinite(fromBase)) return fromBase
  const direct = Number(root.status_code ?? root.code)
  return Number.isFinite(direct) ? direct : null
}

function pickRawMessage(value: unknown): string {
  if (value instanceof Error) return value.message.trim()
  if (typeof value === 'string') return value.trim()
  const root = asRecord(value)
  if (!root) return ''
  const base = asRecord(root.base_resp)
  const fromBase = base?.status_msg ?? base?.message
  if (typeof fromBase === 'string' && fromBase.trim()) return fromBase.trim()
  for (const key of ['status_msg', 'error_msg', 'message', 'detail']) {
    const val = root[key]
    if (typeof val === 'string' && val.trim()) return val.trim()
  }
  const err = asRecord(root.error)
  const fromErr = err?.message ?? err?.msg ?? err?.detail
  if (typeof fromErr === 'string' && fromErr.trim()) return fromErr.trim()
  const nested = asRecord(root.data)
  const fromNested = nested?.status_msg ?? nested?.error_msg ?? nested?.message ?? nested?.detail
  return typeof fromNested === 'string' ? fromNested.trim() : ''
}

function isSuccessMessage(message: string): boolean {
  const lower = message.trim().toLowerCase()
  return lower === 'success' || lower === 'ok'
}

function matchMessage(message: string, fallback: string): string {
  if (!message || isSuccessMessage(message)) return fallback
  for (const [pattern, text] of MESSAGE_PATTERNS) {
    if (pattern.test(message)) return text
  }
  if (/[\u4e00-\u9fff]/.test(message)) return message
  if (/[a-z]/i.test(message)) return 'MiniMax 返回错误，请检查账号、参数或稍后重试'
  return message
}

export function formatMiniMaxError(data: unknown, fallback = 'MiniMax 请求失败'): string {
  const code = pickCode(data)
  if (code != null) {
    const mapped = CODE_MESSAGES.get(code)
    if (mapped) return mapped
  }
  const message = pickRawMessage(data)
  return matchMessage(message, fallback)
}

export function formatMiniMaxThrowMessage(data: unknown, fallback = 'MiniMax 请求失败'): string {
  const code = pickCode(data)
  if (code != null && code !== 0) {
    const mapped = formatMiniMaxError(data, fallback)
    return mapped === fallback ? `MiniMax 请求失败（错误码 ${code}），请检查账号、参数或稍后重试` : mapped
  }
  return formatMiniMaxError(data, fallback)
}
