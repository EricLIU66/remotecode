<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import TokenModal from './components/TokenModal.vue'
import AgentsModal from './components/AgentsModal.vue'
import ProgressCard from './components/ProgressCard.vue'
import ConsoleCard from './components/ConsoleCard.vue'

const DiffModal = defineAsyncComponent(() => import('./components/DiffModal.vue'))

const defaultRelayUrl = import.meta.env.VITE_RELAY_URL || 'http://localhost:8787'
const storageKey = 'remotecode.relay_url'

const loadRelayUrl = () => {
  const stored = window.localStorage.getItem(storageKey)
  return stored && stored.trim() ? stored : defaultRelayUrl
}

const relayUrl = ref(loadRelayUrl())
const viewerTokenKey = 'remotecode.viewer_token'
const loadViewerToken = () => {
  const stored = window.localStorage.getItem(viewerTokenKey)
  return stored && stored.trim() ? stored : ''
}
const viewerToken = ref(loadViewerToken())
const hasViewerToken = computed(() => Boolean(String(viewerToken.value || '').trim()))

const debugModeKey = 'remotecode.debug_mode'
const loadDebugMode = () => {
  const stored = window.localStorage.getItem(debugModeKey)
  return stored === 'true'
}
const debugMode = ref(loadDebugMode())
const isExchanging = ref(false)
const exchangeError = ref(null)
const isChecking = ref(false)
const status = ref('unknown')
const lastOkAt = ref(null)
const latencyMs = ref(null)
const lastError = ref(null)
const isPolling = ref(true)
const wsStatus = ref('idle')
const wsError = ref(null)
const showExchangeError = computed(() => Boolean(exchangeError.value) && wsStatus.value !== 'online')
const lastMessageAt = ref(null)
const deviceId = ref(null)
const logEntries = ref([])
const latestSnapshot = ref(null)
const latestEvent = ref(null)
const latestMessageInfo = ref(null)
const sessionInfo = ref(null)
const sessionTitleUpdatedAt = ref(null)
const todoOverride = ref(null)
const todoUpdatedAt = ref(null)
const sessionStatusOverride = ref(null)
const localToastOverride = ref(null)
const expandedEntryKey = ref(null)
const expandedConsoleSection = ref(null)
const isTokenModalOpen = ref(false)
const isAgentsModalOpen = ref(false)
const tokenDraft = ref('')
const activeDiff = ref(null)
const activeDiffFile = ref(null)

const remotecodeMeta = computed(() => {
  const summary = latestSnapshot.value?.session_summary
  if (!summary || typeof summary !== 'object') return null
  return summary.remotecode && typeof summary.remotecode === 'object' ? summary.remotecode : null
})

const sessionTitle = computed(() => {
  const title = sessionInfo.value?.title ?? remotecodeMeta.value?.session?.title
  return typeof title === 'string' && title.trim() ? title : 'No session title yet'
})

const sessionStatus = computed(() => {
  const status = sessionStatusOverride.value ?? remotecodeMeta.value?.status
  return status && typeof status === 'object' ? status : null
})

const sessionStatusLabel = computed(() => {
  const status = sessionStatus.value
  if (!status) return 'Unknown'
  if (status.type === 'busy') return 'Busy'
  if (status.type === 'idle') return 'Idle'
  if (status.type === 'retry') return 'Retrying'
  return 'Unknown'
})

const sessionStatusTone = computed(() => {
  const status = sessionStatus.value
  if (!status) return 'tone-idle'
  if (status.type === 'busy') return 'tone-online'
  if (status.type === 'retry') return 'tone-warn'
  return 'tone-idle'
})

const todos = computed(() => {
  if (Array.isArray(todoOverride.value)) return todoOverride.value
  const list = remotecodeMeta.value?.todos
  return Array.isArray(list) ? list : []
})

const todoCounts = computed(() => {
  const counts = remotecodeMeta.value?.todoCounts
  return counts && typeof counts === 'object' ? counts : null
})

const runningCount = computed(() => {
  if (todoCounts.value?.in_progress !== undefined) return todoCounts.value.in_progress
  return todos.value.filter((todo) => todo?.status === 'in_progress').length
})

const queuedCount = computed(() => {
  if (todoCounts.value?.pending !== undefined) return todoCounts.value.pending
  return todos.value.filter((todo) => todo?.status === 'pending').length
})

const latestToast = computed(() => {
  if (localToastOverride.value && typeof localToastOverride.value === 'object') {
    return localToastOverride.value
  }
  const toast = remotecodeMeta.value?.toast
  return toast && typeof toast === 'object' ? toast : null
})

const toastTone = computed(() => {
  const variant = latestToast.value?.variant
  if (variant === 'success') return 'toast-success'
  if (variant === 'warning') return 'toast-warning'
  if (variant === 'error') return 'toast-error'
  return 'toast-info'
})

let localToastTimer = null

const showLocalToast = ({ title, message, variant = 'info' }) => {
  localToastOverride.value = {
    title,
    message,
    variant,
    ts: new Date().toISOString(),
  }
  localToastTimer && window.clearTimeout(localToastTimer)
  localToastTimer = window.setTimeout(() => {
    localToastOverride.value = null
    localToastTimer = null
  }, 8000)
}

watch(
  () => sessionStatus.value,
  (next, prev) => {
    const prevType = prev?.type
    const nextType = next?.type
    if (prevType !== 'busy' || nextType !== 'idle') return
    if (runningCount.value !== 0 || queuedCount.value !== 0) return

    showLocalToast({
      title: 'Idle',
      message: 'All tasks finished.',
      variant: 'success',
    })

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('RemoteCode', { body: 'All tasks finished.' })
      } catch {
        // ignore
      }
    }
  }
)

const relayHealthUrl = computed(() => {
  try {
    return new URL('/health', relayUrl.value).toString()
  } catch {
    return null
  }
})

const relayWsUrl = computed(() => {
  if (!hasViewerToken.value) {
    return null
  }

  try {
    const url = new URL(relayUrl.value)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/ws/viewer'
    url.searchParams.set('viewer_token', viewerToken.value)
    return url.toString()
  } catch {
    return null
  }
})

const parsePairingInput = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return { pairingToken: null, relayUrlOverride: null }

  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw)
      const pairingToken = parsed?.pairing_token || parsed?.pairingToken || null
      const relayUrlOverride = parsed?.relay_url || parsed?.relayUrl || null
      return { pairingToken, relayUrlOverride }
    } catch {
      return { pairingToken: raw, relayUrlOverride: null }
    }
  }

  return { pairingToken: raw, relayUrlOverride: null }
}

const confirmPairing = async ({ pairingToken, relayUrlValue }) => {
  const url = new URL('/pairing/confirm', relayUrlValue)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pairing_token: pairingToken }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const error = new Error(`Pairing confirm failed (${response.status}): ${body}`)
    error.status = response.status
    throw error
  }

  const data = await response.json()
  return { viewerToken: data.viewer_token, deviceId: data.device_id }
}

const maybeExchangePairingToken = async (value) => {
  exchangeError.value = null
  const raw = String(value || '').trim()
  if (!raw) return false

  const { pairingToken, relayUrlOverride } = parsePairingInput(raw)
  if (!pairingToken) return false

  if (relayUrlOverride && relayUrlOverride !== relayUrl.value) {
    relayUrl.value = relayUrlOverride
  }

  isExchanging.value = true
  try {
    const result = await confirmPairing({ pairingToken, relayUrlValue: relayUrl.value })
    if (result?.viewerToken && result.viewerToken !== viewerToken.value) {
      deviceId.value = result.deviceId ?? deviceId.value
      viewerToken.value = result.viewerToken
      return true
    }
  } catch (error) {
    // If this wasn't a valid pairing token, just treat the input as a viewer token.
    exchangeError.value = error?.message || 'Pairing confirm failed'
  } finally {
    isExchanging.value = false
  }

  return false
}

const statusLabel = computed(() => {
  if (status.value === 'online') return 'Online'
  if (status.value === 'offline') return 'Offline'
  if (status.value === 'invalid') return 'Invalid URL'
  return 'Unknown'
})

const statusTone = computed(() => {
  if (status.value === 'online') return 'tone-online'
  if (status.value === 'offline') return 'tone-offline'
  if (status.value === 'invalid') return 'tone-warn'
  return 'tone-idle'
})

const wsStatusLabel = computed(() => {
  if (!viewerToken.value) return 'Viewer token missing'
  if (isExchanging.value) return 'Exchanging token'
  if (wsStatus.value === 'online') return 'Live'
  if (wsStatus.value === 'connecting') return 'Connecting'
  if (wsStatus.value === 'error') return 'Error'
  return 'Offline'
})

const wsStatusTone = computed(() => {
  if (!viewerToken.value) return 'tone-warn'
  if (wsStatus.value === 'online') return 'tone-online'
  if (wsStatus.value === 'error') return 'tone-offline'
  if (wsStatus.value === 'connecting') return 'tone-idle'
  return 'tone-offline'
})

const fmtTime = (value) => {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

const formatInline = (value) => {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const formatJson = (value) => {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  try {
    const rendered = JSON.stringify(value, null, 2)
    if (!rendered) return '—'
    const maxLen = 12_000
    if (rendered.length <= maxLen) return rendered
    return `${rendered.slice(0, maxLen)}\n… (truncated)`
  } catch {
    return String(value)
  }
}

const truncateSingleLine = (value, maxLen = 180) => {
  if (value === null || value === undefined) return ''
  const normalized = String(value).replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}…` : normalized
}

const extractModelLabel = (agent) => {
  if (!agent || typeof agent !== 'object') return null
  const directKeys = ['model', 'model_name', 'modelName', 'llm', 'engine']
  for (const key of directKeys) {
    if (typeof agent[key] === 'string' && agent[key].trim()) return agent[key]
  }

  if (agent.model && typeof agent.model === 'object') {
    if (typeof agent.model.modelID === 'string' && agent.model.modelID.trim()) return agent.model.modelID
    if (typeof agent.model.providerID === 'string' && agent.model.providerID.trim()) return agent.model.providerID
    if (typeof agent.model.name === 'string' && agent.model.name.trim()) return agent.model.name
    if (typeof agent.model.id === 'string' && agent.model.id.trim()) return agent.model.id
  }

  if (agent.llm && typeof agent.llm === 'object') {
    if (typeof agent.llm.name === 'string' && agent.llm.name.trim()) return agent.llm.name
    if (typeof agent.llm.model === 'string' && agent.llm.model.trim()) return agent.llm.model
  }

  if (agent.provider && typeof agent.provider === 'object') {
    if (typeof agent.provider.model === 'string' && agent.provider.model.trim()) return agent.provider.model
    if (typeof agent.provider.name === 'string' && agent.provider.name.trim()) return agent.provider.name
  }

  return null
}

const extractThinkingFromOutput = (output) => {
  if (!output) return null
  const text = String(output)
  const matches = [...text.matchAll(/(^|\n)\s*Thinking:\s*/g)]
  if (matches.length === 0) {
    return null
  }

  const parts = []
  for (let i = 0; i < matches.length; i += 1) {
    const start = (matches[i].index ?? 0) + matches[i][0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length
    const slice = text.slice(start, end).trim()
    if (slice) {
      parts.push(slice)
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null
}

const extractPreviewText = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return String(value)

  const candidates = [
    value.text,
    value.message,
    value.content,
    value.output,
    value.title,
    value.error?.message,
  ]
    .map((candidate) => {
      if (typeof candidate === 'string') return candidate
      if (Array.isArray(candidate)) {
        const joined = candidate.filter((part) => typeof part === 'string').join('')
        return joined || null
      }
      return null
    })
    .filter(Boolean)

  return candidates[0] ?? null
}

const summarizeEventPayload = (payload) => {
  const text = extractPreviewText(payload)
  if (!text) return null
  const normalized = String(text).replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  const maxLen = 140
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}…` : normalized
}

const setActiveDiff = (entry) => {
  activeDiff.value = entry
  const first = entry?.diffBlocks?.[0]
  activeDiffFile.value = first?.file ?? null
}

const activeDiffBlock = computed(() => {
  const diff = activeDiff.value
  if (!diff || !Array.isArray(diff.diffBlocks)) return null
  if (activeDiffFile.value) {
    const match = diff.diffBlocks.find((b) => b.file === activeDiffFile.value)
    if (match) return match
  }
  return diff.diffBlocks[0] ?? null
})

const summarizeMessage = (message) => {
  if (!message || typeof message !== 'object') return String(message)
  if (message.type === 'viewer.hello') return `viewer.hello device=${message.device_id || '—'}`
  if (message.type === 'snapshot.update') {
    const agentCount = Array.isArray(message.agent_states) ? message.agent_states.length : 0
    return `snapshot.update agents=${agentCount}`
  }
  if (message.type === 'event.append') {
    const eventType = message.event_type || 'event'
    const severity = message.severity || 'info'
    const detail = summarizeEventPayload(message.payload)
    return detail ? `event.append ${eventType} ${severity} — ${detail}` : `event.append ${eventType} ${severity}`
  }

  return formatInline(message)
}

const formatAgentSummary = (agents) => {
  if (!Array.isArray(agents) || agents.length === 0) return 'No agents'
  const rendered = []
  for (const agent of agents) {
    if (!agent || typeof agent !== 'object') continue
    const name = typeof agent.name === 'string' && agent.name.trim() ? agent.name : null
    const model = extractModelLabel(agent)
    if (!name && !model) continue
    rendered.push(model ? `${name ?? 'agent'} (${model})` : `${name}`)
    if (rendered.length >= 3) break
  }
  const suffix = agents.length > rendered.length ? ` +${agents.length - rendered.length}` : ''
  return rendered.length > 0 ? `${rendered.join(', ')}${suffix}` : `${agents.length} agents`
}

const formatDiffDetails = (diffList) => {
  if (!Array.isArray(diffList) || diffList.length === 0) return '—'
  const blocks = []
  for (const entry of diffList) {
    if (!entry || typeof entry !== 'object') continue
    const file = typeof entry.file === 'string' ? entry.file : 'unknown'
    const language = typeof entry.language === 'string' ? entry.language : ''
    const before = entry.before === null || entry.before === undefined ? '' : String(entry.before)
    const after = entry.after === null || entry.after === undefined ? '' : String(entry.after)
    blocks.push(
      `${file}${language ? ` (${language})` : ''}\n\n--- before\n${before}\n\n+++ after\n${after}`
    )
  }
  return blocks.length > 0 ? blocks.join('\n\n===\n\n') : '—'
}

const buildUnifiedDiffLines = (beforeText, afterText) => {
  const before = splitNormalizedLines(beforeText)
  const after = splitNormalizedLines(afterText)
  if (before.length === 0 && after.length === 0) return []

  const n = before.length
  const m = after.length
  const maxCells = 500_000
  if (n * m > maxCells) {
    // Fallback: simple delta-only view to stay responsive on very large inputs.
    const lines = []
    for (const line of before) lines.push({ type: 'del', text: line })
    for (const line of after) lines.push({ type: 'add', text: line })
    return lines
  }

  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      if (before[i - 1] === after[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = dp[i - 1][j] > dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1]
      }
    }
  }

  const lines = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && before[i - 1] === after[j - 1]) {
      lines.push({ type: 'context', text: before[i - 1] })
      i -= 1
      j -= 1
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      lines.push({ type: 'add', text: after[j - 1] })
      j -= 1
    } else if (i > 0) {
      lines.push({ type: 'del', text: before[i - 1] })
      i -= 1
    }
  }

  lines.reverse()
  return lines
}

const buildSideBySideDiff = (beforeText, afterText) => {
  return {
    before: String(beforeText ?? ''),
    after: String(afterText ?? ''),
  }
}

const splitNormalizedLines = (value) => {
  const text = String(value ?? '')
  if (!text) return []
  const parts = text.split(/\r?\n/)
  // Avoid counting a trailing newline as an empty "line".
  if (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop()
  }
  return parts
}

const lcsLength = (a, b, maxCells = 2_000_000) => {
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0) return 0
  if (n * m > maxCells) {
    return null
  }

  let prev = new Array(m + 1).fill(0)
  let curr = new Array(m + 1).fill(0)
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1
      } else {
        curr[j] = prev[j] > curr[j - 1] ? prev[j] : curr[j - 1]
      }
    }
    ;[prev, curr] = [curr, prev]
    curr.fill(0)
  }

  return prev[m]
}

const countLineChanges = (beforeText, afterText) => {
  const beforeLines = splitNormalizedLines(beforeText)
  const afterLines = splitNormalizedLines(afterText)
  const len = lcsLength(beforeLines, afterLines)
  if (typeof len === 'number') {
    return { added: afterLines.length - len, removed: beforeLines.length - len }
  }

  // Fallback for very large inputs: preserve responsiveness with a cheap estimate.
  const delta = afterLines.length - beforeLines.length
  return {
    added: delta > 0 ? delta : 0,
    removed: delta < 0 ? -delta : 0,
  }
}

let nextEntryId = 1
const buildConsoleEntry = (payload) => {
  const raw = payload
  const entry = {
    id: nextEntryId++,
    ts: new Date().toISOString(),
    kind: 'unknown',
    badge: 'MSG',
    tone: 'tone-idle',
    text: summarizeMessage(payload),
    details: null,
    messageKey: null,
    raw,
  }

  if (!payload || typeof payload !== 'object') {
    return entry
  }

  entry.ts = typeof payload.ts === 'string' ? payload.ts : entry.ts

  if (payload.type === 'snapshot.update') {
    entry.kind = 'snapshot'
    entry.badge = 'SNAPSHOT'
    entry.tone = 'tone-online'
    const agents = payload.agent_states
    entry.text = `${formatAgentSummary(agents)}`
    entry.details = formatJson(payload)
    return entry
  }

  if (payload.type === 'event.append') {
    const eventType = payload.event_type
    if (eventType === 'session.idle') {
      if (!debugMode.value) return null
    }

    if (eventType === 'session.status') {
      sessionStatusOverride.value = payload.payload?.status ?? null
      if (!debugMode.value) return null
    }

    if (eventType === 'todo.updated') {
      if (!debugMode.value) return null
    }

    if (eventType === 'message.updated') {
      if (!debugMode.value) return null
    }

    if (eventType === 'message.updated') {
      return null
    }

    if (eventType === 'session.diff') {
      entry.kind = 'diff'
      entry.badge = 'DIFF'
      entry.tone = 'tone-warn'
      const diffList = payload.payload?.diff
      entry.text = Array.isArray(diffList)
        ? truncateSingleLine(
            diffList
              .map((d) => {
                const file = d?.file ?? 'unknown file'
                const { added, removed } = countLineChanges(d?.before, d?.after)
                return `${file} (+${added}/-${removed})`
              })
              .join(', '),
            160
          )
        : 'session.diff'
      entry.diffBlocks = Array.isArray(diffList)
        ? diffList.map((d) => ({
            file: d?.file ?? 'unknown file',
            language: d?.language,
            lines: buildUnifiedDiffLines(d?.before, d?.after),
            columns: buildSideBySideDiff(d?.before, d?.after),
          }))
        : []
      return entry
    }

    if (eventType === 'session.updated') {
      if (!debugMode.value) return null
    }

    if (
      eventType === 'message.part.updated' ||
      eventType === 'message.part.completed' ||
      eventType === 'message.completed'
    ) {
      entry.kind = 'message'
      entry.badge = 'MESSAGE'
      entry.tone = eventType === 'message.part.updated' ? 'tone-online' : 'tone-idle'

      const part = payload.payload?.part
      const message = payload.payload?.message
      const source = part ?? message
      const delta = payload.payload?.delta
      const baseText = typeof source?.text === 'string' ? source.text : ''
      const deltaText = typeof delta === 'string' ? delta : ''
      const combined = `${baseText}${deltaText}`.trim()

      entry.text = combined || eventType
      entry.details = formatJson(source ?? payload)

      const sessionID = source?.sessionID ?? source?.session_id
      const messageID = source?.messageID ?? source?.message_id ?? source?.id
      if (sessionID && messageID) {
        entry.messageKey = `${sessionID}:${messageID}`
      }
      return entry
    }

    if (eventType === 'tool.execute.after') {
      const title = typeof payload.payload?.title === 'string' ? payload.payload.title : null
      const description =
        typeof payload.payload?.metadata?.description === 'string' ? payload.payload.metadata.description : ''
      const output =
        typeof payload.payload?.output === 'string'
          ? payload.payload.output
          : typeof payload.payload?.metadata?.output === 'string'
            ? payload.payload.metadata.output
            : ''
      const exitCode =
        typeof payload.payload?.metadata?.exit === 'number' ? payload.payload.metadata.exit : null
      const normalizedTitle = (title ?? '').trim()
      const isTest = /\btests?\b/i.test(`${normalizedTitle} ${description}`.trim())

      entry.kind = isTest ? 'test' : 'tool'
      entry.badge = isTest ? 'TEST' : 'TOOL'
      entry.tone = exitCode === 0 ? 'tone-online' : exitCode === null ? 'tone-idle' : 'tone-offline'

      const status = exitCode === 0 ? 'PASS' : exitCode === null ? 'DONE' : `FAIL (exit ${exitCode})`
      const counts = []
      const filesMatch = output.match(/Test Files\s+(\d+)\s+passed\s+\((\d+)\)/)
      if (filesMatch) {
        counts.push(`files ${filesMatch[1]}/${filesMatch[2]}`)
      }
      const testsMatch = output.match(/Tests\s+(\d+)\s+passed\s+\((\d+)\)/)
      if (testsMatch) {
        counts.push(`tests ${testsMatch[1]}/${testsMatch[2]}`)
      }
      const countsLabel = counts.length > 0 ? ` (${counts.join(', ')})` : ''

      entry.text = normalizedTitle
        ? truncateSingleLine(`${normalizedTitle} — ${status}${countsLabel}`, 180)
        : truncateSingleLine(`tool.execute.after — ${status}${countsLabel}`, 180)
      entry.details = output.trim() ? output : formatJson(payload.payload)
      return entry
    }

    if (eventType === 'tool.execute.before') {
      const tool = typeof payload.payload?.tool === 'string' ? payload.payload.tool : null
      const args = payload.payload?.args
      const description =
        typeof args?.description === 'string'
          ? args.description
          : typeof payload.payload?.description === 'string'
            ? payload.payload.description
            : null
      const command = typeof args?.command === 'string' ? args.command : null

      const normalizedDescription = (description ?? '').trim()
      const isTest = /\btests?\b/i.test(normalizedDescription)

      entry.kind = isTest ? 'test' : 'tool'
      entry.badge = isTest ? 'TEST' : 'TOOL'
      entry.tone = 'tone-idle'
      entry.text = normalizedDescription
        ? truncateSingleLine(normalizedDescription, 180)
        : truncateSingleLine(`tool.execute.before ${tool ?? ''}`.trim(), 180)

      if (tool && command) {
        entry.details = `${tool}\n${command}`
      } else if (tool) {
        entry.details = `${tool}\n${formatJson(args ?? payload.payload)}`
      } else {
        entry.details = formatJson(args ?? payload.payload)
      }

      return entry
    }

    const summary = payload.payload?.info?.summary
    if (summary && typeof summary === 'object') {
      const title = typeof summary.title === 'string' ? summary.title : null
      const diffs = Array.isArray(summary.diffs) ? summary.diffs : []

      if (diffs.length > 0) {
        entry.kind = 'diff'
        entry.badge = 'DIFF'
        entry.tone = 'tone-warn'
        entry.text = title ? truncateSingleLine(title, 160) : truncateSingleLine(formatInline(summary), 160)
        entry.details = formatJson(summary)
        entry.diffBlocks = diffs
          .filter((d) => d && typeof d === 'object')
          .map((d) => ({
            file: d?.file ?? 'unknown file',
            language: d?.language,
            lines: buildUnifiedDiffLines(d?.before, d?.after),
            columns: buildSideBySideDiff(d?.before, d?.after),
          }))
        return entry
      }

      entry.kind = 'event'
      entry.badge = 'EVENT'
      entry.tone = payload.severity === 'error' ? 'tone-offline' : 'tone-idle'
      entry.text = title ? truncateSingleLine(title, 160) : truncateSingleLine(formatInline(summary), 160)
      entry.details = formatJson(summary)
      return entry
    }

    entry.kind = 'event'
    entry.badge = 'EVENT'
    entry.tone = payload.severity === 'error' ? 'tone-offline' : 'tone-idle'
    entry.text = summarizeMessage(payload)
    entry.details = formatJson(payload)
    return entry
  }

  return entry
}

const modelLabel = computed(() => {
  const agents = latestSnapshot.value?.agent_states
  if (!Array.isArray(agents)) return '—'
  for (const agent of agents) {
    const label = extractModelLabel(agent)
    if (label) return label
  }
  return '—'
})

const modelDisplay = computed(() => {
  if (modelLabel.value === '—') return '—'
  return truncateSingleLine(modelLabel.value, 32)
})

const messageModelDisplay = computed(() => {
  const info = latestMessageInfo.value
  const providerID = typeof info?.providerID === 'string' ? info.providerID.trim() : ''
  const modelID = typeof info?.modelID === 'string' ? info.modelID.trim() : ''
  if (providerID && modelID) return truncateSingleLine(`${providerID} / ${modelID}`, 32)
  if (modelID) return truncateSingleLine(modelID, 32)
  if (providerID) return truncateSingleLine(providerID, 32)
  return modelDisplay.value
})

const modeAgentDisplay = computed(() => {
  const info = latestMessageInfo.value
  const mode = typeof info?.mode === 'string' ? info.mode.trim() : ''
  const agent = typeof info?.agent === 'string' ? info.agent.trim() : ''
  if (mode && agent) return truncateSingleLine(`${mode} · ${agent}`, 32)
  if (mode) return truncateSingleLine(mode, 32)
  if (agent) return truncateSingleLine(agent, 32)
  return '—'
})

const costDisplay = computed(() => {
  const info = latestMessageInfo.value
  const cost = info?.cost
  if (typeof cost === 'number' && Number.isFinite(cost)) return String(cost)
  if (typeof cost === 'string' && cost.trim()) return cost.trim()
  return '—'
})

const thinkingEntries = computed(() => {
  const results = []
  for (const entry of logEntries.value) {
    const raw = entry?.raw
    if (!raw || typeof raw !== 'object') continue
    if (raw.type !== 'event.append') continue
    if (raw.event_type !== 'tool.execute.after') continue
    if (raw.payload?.tool !== 'background_output') continue
    const output = raw.payload?.output
    if (typeof output !== 'string' || !output.trim()) continue
    const thinking = extractThinkingFromOutput(output)
    if (!thinking) continue

    results.push({ ts: raw.ts ?? entry.ts, text: thinking })
    if (results.length >= 6) break
  }
  return results
})

const thinkingPreview = computed(() => {
  if (thinkingEntries.value.length === 0) return 'No thinking yet.'
  return truncateSingleLine(thinkingEntries.value[0].text, 200)
})

const thinkingBody = computed(() => {
  if (thinkingEntries.value.length === 0) return '—'
  return thinkingEntries.value
    .map((entry) => {
      const when = fmtTime(entry.ts)
      return `${when}\n${entry.text}`
    })
    .join('\n\n---\n\n')
})

const finalSummary = computed(() => {
  const summary = latestSnapshot.value?.session_summary
  if (summary === null || summary === undefined) return null
  if (typeof summary === 'string') return summary
  if (typeof summary !== 'object') return String(summary)

  if (typeof summary.summary === 'string' && summary.summary.trim()) {
    return summary.summary
  }

  return formatJson(summary)
})

const finalPreview = computed(() => {
  if (!finalSummary.value) return 'No summary yet.'
  return truncateSingleLine(finalSummary.value, 200)
})

const finalBody = computed(() => {
  if (!finalSummary.value) return '—'
  return finalSummary.value
})

const toggleConsoleSection = (key) => {
  expandedConsoleSection.value = expandedConsoleSection.value === key ? null : key
}

const openTokenModal = () => {
  tokenDraft.value = viewerToken.value
  isTokenModalOpen.value = true
}

const openAgentsModal = () => {
  isAgentsModalOpen.value = true
}

const closeTokenModal = () => {
  isTokenModalOpen.value = false
}

const closeAgentsModal = () => {
  isAgentsModalOpen.value = false
}

const saveViewerToken = () => {
  viewerToken.value = String(tokenDraft.value || '').trim()
  isTokenModalOpen.value = false
}

const clearViewerTokenFromModal = () => {
  clearViewerToken()
  tokenDraft.value = ''
  isTokenModalOpen.value = false
}

const toggleExpandedEntry = (entry) => {
  const key = entry?.id ?? null
  expandedEntryKey.value = expandedEntryKey.value === key ? null : key
}

let pollTimer = null
let currentAbort = null
let socket = null
let reconnectTimer = null

const clearViewerToken = () => {
  exchangeError.value = null
  viewerToken.value = ''
}

const invalidateViewerToken = (message) => {
  exchangeError.value = message
  deviceId.value = null
  lastMessageAt.value = null
  viewerToken.value = ''
}

const checkHealth = async () => {
  const url = relayHealthUrl.value
  if (!url) {
    status.value = 'invalid'
    lastError.value = 'Invalid relay URL'
    latencyMs.value = null
    return
  }

  currentAbort?.abort()
  const controller = new AbortController()
  currentAbort = controller

  isChecking.value = true
  const startedAt = performance.now()
  try {
    const timeout = window.setTimeout(() => controller.abort(), 2500)
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    window.clearTimeout(timeout)

    const elapsed = Math.round(performance.now() - startedAt)
    latencyMs.value = elapsed

    if (!response.ok) {
      status.value = 'offline'
      lastError.value = `HTTP ${response.status}`
      return
    }

    const data = await response.json().catch(() => null)
    if (data && data.status === 'ok') {
      status.value = 'online'
      lastOkAt.value = new Date().toISOString()
      lastError.value = null
      return
    }

    status.value = 'offline'
    lastError.value = 'Unexpected response'
  } catch (error) {
    status.value = 'offline'
    latencyMs.value = null
    if (error?.name === 'AbortError') {
      lastError.value = 'Request timed out'
    } else {
      lastError.value = error?.message || 'Network error'
    }
  } finally {
    if (currentAbort === controller) {
      currentAbort = null
    }
    isChecking.value = false
  }
}

const startPolling = () => {
  pollTimer && window.clearInterval(pollTimer)
  pollTimer = window.setInterval(() => {
    void checkHealth()
  }, 5000)
  isPolling.value = true
}

const stopPolling = () => {
  pollTimer && window.clearInterval(pollTimer)
  pollTimer = null
  isPolling.value = false
}

const togglePolling = () => {
  if (isPolling.value) {
    stopPolling()
  } else {
    void checkHealth()
    startPolling()
  }
}

watch(
  () => relayUrl.value,
  (value) => {
    window.localStorage.setItem(storageKey, value)
    if (isPolling.value) {
      void checkHealth()
    }
  }
)

watch(
  () => debugMode.value,
  (value) => {
    window.localStorage.setItem(debugModeKey, value ? 'true' : 'false')

    if (value) return

    const isDebugOnlyPayload = (raw) => {
      if (!raw || typeof raw !== 'object') return false
      if (raw.type === 'snapshot.update') return true
      if (raw.type !== 'event.append') return false
      const eventType = raw.event_type
      return (
        eventType === 'session.idle' ||
        eventType === 'session.status' ||
        eventType === 'session.updated' ||
        eventType === 'todo.updated' ||
        eventType === 'message.updated'
      )
    }

    const filtered = logEntries.value.filter((entry) => !isDebugOnlyPayload(entry?.raw))
    logEntries.value = filtered
    if (expandedEntryKey.value !== null && !filtered.some((entry) => entry.id === expandedEntryKey.value)) {
      expandedEntryKey.value = null
    }
  }
)

watch(
  () => viewerToken.value,
  async (value) => {
    const normalized = String(value || '').trim()
    if (normalized) {
      window.localStorage.setItem(viewerTokenKey, normalized)
    } else {
      window.localStorage.removeItem(viewerTokenKey)
      disconnectViewer()
      wsStatus.value = 'idle'
      wsError.value = null
      return
    }

    const exchanged = await maybeExchangePairingToken(normalized)
    if (exchanged) {
      return
    }

    connectViewer()
  }
)

watch(
  () => relayWsUrl.value,
  () => {
    connectViewer()
  }
)

const disconnectViewer = () => {
  reconnectTimer && window.clearTimeout(reconnectTimer)
  reconnectTimer = null
  if (socket) {
    socket.close()
    socket = null
  }
}

const connectViewer = () => {
  disconnectViewer()

  if (isExchanging.value) {
    wsStatus.value = 'connecting'
    wsError.value = 'Exchanging pairing token…'
    return
  }

  const wsUrl = relayWsUrl.value
  if (!wsUrl) {
    wsStatus.value = viewerToken.value ? 'error' : 'idle'
    wsError.value = viewerToken.value ? 'Invalid relay URL' : null
    return
  }

  wsStatus.value = 'connecting'
  wsError.value = null
  const connectionStartedAt = performance.now()
  let receivedAnyMessage = false
  const connection = new WebSocket(wsUrl)
  socket = connection

  connection.addEventListener('open', () => {
    wsStatus.value = 'online'
  })

  connection.addEventListener('message', (event) => {
    receivedAnyMessage = true
    let payload = null
    try {
      payload = JSON.parse(event.data)
    } catch {
      payload = event.data
    }

    if (payload?.type === 'viewer.hello') {
      deviceId.value = payload.device_id ?? null
    }

    if (payload?.type === 'snapshot.update') {
      latestSnapshot.value = payload
      lastMessageAt.value = payload.ts ?? new Date().toISOString()
      if (!debugMode.value) return
    }

    if (payload?.type === 'event.append') {
      latestEvent.value = payload
      if (payload.event_type === 'session.updated' && payload.payload?.info) {
        sessionInfo.value = payload.payload.info
        sessionTitleUpdatedAt.value = payload.ts ?? new Date().toISOString()
        if (!debugMode.value) return
      }

      if (payload.event_type === 'message.updated' && payload.payload?.info) {
        latestMessageInfo.value = payload.payload.info
        if (!debugMode.value) return
      }

      if (payload.event_type === 'todo.updated') {
        const list = payload.payload?.todos
        todoOverride.value = Array.isArray(list) ? list : []
        todoUpdatedAt.value = payload.ts ?? new Date().toISOString()
        if (!debugMode.value) return
      }
    }

    const entry = buildConsoleEntry(payload)
    if (entry) {
      if (entry.messageKey) {
        const existingIndex = logEntries.value.findIndex(
          (existing) => existing.messageKey === entry.messageKey
        )
        if (existingIndex >= 0) {
          const existing = logEntries.value[existingIndex]
          const merged = {
            ...existing,
            text: entry.text,
            details: entry.details,
            ts: entry.ts,
            raw: entry.raw,
          }
          logEntries.value = [
            merged,
            ...logEntries.value.slice(0, existingIndex),
            ...logEntries.value.slice(existingIndex + 1),
          ]
          lastMessageAt.value = merged.ts
          return
        }
      }

      logEntries.value = [entry, ...logEntries.value].slice(0, 200)
      lastMessageAt.value = entry.ts
    }
  })

  connection.addEventListener('close', () => {
    if (socket !== connection) return
    wsStatus.value = 'offline'
    const elapsedMs = Math.round(performance.now() - connectionStartedAt)
    if (status.value === 'online' && !receivedAnyMessage && elapsedMs < 1500) {
      wsError.value = 'Viewer token invalid'
      invalidateViewerToken('Viewer token invalid or expired. Paste a new pairing code.')
      return
    }
    reconnectTimer = window.setTimeout(connectViewer, 2000)
  })

  connection.addEventListener('error', () => {
    wsStatus.value = 'error'
    wsError.value = exchangeError.value || 'WebSocket error'
  })
}

onMounted(() => {
  void checkHealth()
  startPolling()
  connectViewer()
})

onBeforeUnmount(() => {
  stopPolling()
  currentAbort?.abort()
  localToastTimer && window.clearTimeout(localToastTimer)
  localToastTimer = null
  disconnectViewer()
})
</script>

<template>
  <main class="page">
    <header class="header">
      <div class="brand">
        <div class="mark" aria-hidden="true"></div>
        <div>
          <div class="brand-title">RemoteCode</div>
          <div class="brand-subtitle">Relay Status</div>
        </div>
      </div>
      <div class="header-actions">
        <div class="pulse" :class="statusTone" aria-hidden="true"></div>
        <button class="profile-button" type="button" @click="openTokenModal" aria-label="Pairing token">
          <span class="profile-label">ME</span>
        </button>
      </div>
    </header>

    <section class="card">
      <div v-if="!hasViewerToken" class="setup-note">
        Paste your pairing code (from <span class="setup-mono">bunx remotecode auth</span>) to unlock the dashboard.
        We'll store it in your browser.
        <button class="button button-ghost" type="button" @click="openTokenModal">Add pairing token</button>
      </div>
      <div class="row">
        <label class="label" for="relayUrl">Relay URL</label>
        <input
          id="relayUrl"
          v-model.trim="relayUrl"
          class="input"
          inputmode="url"
          placeholder="http://localhost:8787"
          autocomplete="off"
          spellcheck="false"
        />
      </div>

      <div class="grid">
        <div class="metric">
          <div class="metric-label">Status</div>
          <div class="metric-value" :class="statusTone">{{ statusLabel }}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Viewer</div>
          <div class="metric-value" :class="wsStatusTone">{{ wsStatusLabel }}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Latency</div>
          <div class="metric-value">{{ latencyMs === null ? '—' : `${latencyMs} ms` }}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Device</div>
          <div class="metric-value">{{ deviceId || '—' }}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Last plugin msg</div>
          <div class="metric-value metric-value-stack">
            <div>{{ fmtTime(latestMessageInfo?.time?.created) }}</div>
            <div class="metric-subvalue">done {{ fmtTime(latestMessageInfo?.time?.completed) }}</div>
          </div>
        </div>
        <div class="metric">
          <div class="metric-label">Cost</div>
          <div class="metric-value">{{ costDisplay }}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Mode / agent</div>
          <div class="metric-value">{{ modeAgentDisplay }}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Agents</div>
          <div class="metric-value metric-value-stack">
            <div>
              {{ Array.isArray(latestSnapshot?.agent_states) ? latestSnapshot.agent_states.length : '—' }}
            </div>
            <button
              class="button button-ghost button-small"
              type="button"
              @click="openAgentsModal"
              :disabled="!Array.isArray(latestSnapshot?.agent_states) || latestSnapshot.agent_states.length === 0"
            >
              Details
            </button>
          </div>
        </div>
        <div class="metric">
          <div class="metric-label">Model</div>
          <div class="metric-value">{{ messageModelDisplay }}</div>
        </div>
      </div>

      <div class="footer">
        <button class="button" type="button" @click="checkHealth" :disabled="isChecking">
          {{ isChecking ? 'Checking…' : 'Check now' }}
        </button>
        <button class="button" type="button" @click="togglePolling">
          {{ isPolling ? 'Stop auto-check' : 'Start auto-check' }}
        </button>
        <button class="button" type="button" @click="openTokenModal">Manage token</button>
        <div class="hint">
           <div class="hint-line">GET {{ relayHealthUrl || '—' }}</div>
           <div v-if="lastError" class="hint-line hint-error">{{ lastError }}</div>
           <div class="hint-line">WS {{ relayWsUrl || '—' }}</div>
           <div v-if="wsError" class="hint-line hint-error">{{ wsError }}</div>
           <div v-else-if="showExchangeError" class="hint-line hint-error">{{ exchangeError }}</div>
         </div>
       </div>
      </section>

    <ProgressCard
      :open="hasViewerToken"
      :sessionTitle="sessionTitle"
      :sessionTitleUpdatedAt="sessionTitleUpdatedAt"
      :sessionStatusLabel="sessionStatusLabel"
      :sessionStatusTone="sessionStatusTone"
      :runningCount="runningCount"
      :queuedCount="queuedCount"
      :todos="todos"
      :todoUpdatedAt="todoUpdatedAt"
      :latestToast="latestToast"
      :toastTone="toastTone"
      :sessionStatus="sessionStatus"
      :fmtTime="fmtTime"
    />

    <ConsoleCard
      :open="hasViewerToken"
      :wsStatusTone="wsStatusTone"
      :wsStatusLabel="wsStatusLabel"
      :debugMode="debugMode"
      :thinkingPreview="thinkingPreview"
      :thinkingBody="thinkingBody"
      :finalPreview="finalPreview"
      :finalBody="finalBody"
      :expandedConsoleSection="expandedConsoleSection"
      :expandedEntryKey="expandedEntryKey"
      :logEntries="logEntries"
      :activeDiff="activeDiff"
      :toggleConsoleSection="toggleConsoleSection"
      :toggleExpandedEntry="toggleExpandedEntry"
      :setActiveDiff="setActiveDiff"
      :fmtTime="fmtTime"
      :formatJson="formatJson"
    />
</main>

  <TokenModal
    :open="isTokenModalOpen"
    :hasViewerToken="hasViewerToken"
    v-model:draft="tokenDraft"
    v-model:debugMode="debugMode"
    @save="saveViewerToken"
    @cancel="closeTokenModal"
    @clear="clearViewerTokenFromModal"
  />

  <DiffModal
    :diff="activeDiff"
    v-model:activeFile="activeDiffFile"
    @close="activeDiff = null"
  />

  <AgentsModal
    :open="isAgentsModalOpen"
    :agents="latestSnapshot?.agent_states"
    :updatedAt="latestSnapshot?.ts"
    @close="closeAgentsModal"
  />
</template>
