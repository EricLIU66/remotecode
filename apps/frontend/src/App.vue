<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

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
const sessionInfo = ref(null)
const sessionStatusOverride = ref(null)
const expandedEntryKey = ref(null)
const expandedConsoleSection = ref(null)
const isTokenModalOpen = ref(false)
const tokenDraft = ref('')

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
      return null
    }

    if (eventType === 'session.status') {
      sessionStatusOverride.value = payload.payload?.status ?? null
      return null
    }

    if (eventType === 'session.diff') {
      entry.kind = 'diff'
      entry.badge = 'DIFF'
      entry.tone = 'tone-warn'
      const diffList = payload.payload?.diff
      const firstFile = Array.isArray(diffList) && diffList[0]?.file ? diffList[0].file : null
      const count = Array.isArray(diffList) ? diffList.length : 0
      entry.text = firstFile ? `${firstFile}${count > 1 ? ` +${count - 1}` : ''}` : 'session.diff'
      entry.details = formatDiffDetails(diffList)
      return entry
    }

    if (eventType === 'session.updated') {
      entry.kind = 'session'
      entry.badge = 'SESSION'
      entry.tone = 'tone-idle'
      const info = payload.payload?.info
      const title = typeof info?.title === 'string' ? info.title : null
      entry.text = title ? title : 'session.updated'
      entry.details = formatJson(info ?? payload)
      return entry
    }

    if (eventType === 'message.part.updated') {
      entry.kind = 'message'
      entry.badge = 'MESSAGE'
      entry.tone = 'tone-online'
      const part = payload.payload?.part
      const delta = payload.payload?.delta
      const baseText = typeof part?.text === 'string' ? part.text : ''
      const deltaText = typeof delta === 'string' ? delta : ''
      const combined = `${baseText}${deltaText}`.trim()
      entry.text = combined || 'message.part.updated'
      entry.details = formatJson(part ?? payload)
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

const closeTokenModal = () => {
  isTokenModalOpen.value = false
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
    }

    if (payload?.type === 'event.append') {
      latestEvent.value = payload
      if (payload.event_type === 'session.updated' && payload.payload?.info) {
        sessionInfo.value = payload.payload.info
      }
    }

    const entry = buildConsoleEntry(payload)
    if (entry) {
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
          <div class="metric-label">Last OK</div>
          <div class="metric-value">{{ fmtTime(lastOkAt) }}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Device</div>
          <div class="metric-value">{{ deviceId || '—' }}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Last plugin msg</div>
          <div class="metric-value">{{ fmtTime(lastMessageAt) }}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Agents</div>
          <div class="metric-value">
            {{ Array.isArray(latestSnapshot?.agent_states) ? latestSnapshot.agent_states.length : '—' }}
          </div>
        </div>
        <div class="metric">
          <div class="metric-label">Model</div>
          <div class="metric-value">{{ modelDisplay }}</div>
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

    <section v-if="hasViewerToken" class="card progress">
      <div class="progress-header">
        <div>
          <div class="label">OpenCode</div>
          <div class="progress-title">{{ sessionTitle }}</div>
        </div>
        <div class="progress-chips">
          <div class="progress-chip" :class="sessionStatusTone">{{ sessionStatusLabel }}</div>
          <div class="progress-chip progress-chip-muted">Running {{ runningCount }}</div>
          <div class="progress-chip progress-chip-muted">Queued {{ queuedCount }}</div>
        </div>
      </div>

      <div class="progress-grid">
        <div class="progress-panel">
          <div class="progress-panel-title">Todos</div>
          <div v-if="todos.length === 0" class="progress-empty">No todos yet.</div>
          <div v-else class="todo-list">
            <div v-for="todo in todos" :key="todo.id" class="todo-item" :class="`todo-${todo.status || 'pending'}`">
              <div class="todo-status">{{ (todo.status || 'pending').replace('_', ' ') }}</div>
              <div class="todo-content">{{ todo.content }}</div>
            </div>
          </div>
        </div>

        <div class="progress-panel">
          <div class="progress-panel-title">Task status</div>
          <div v-if="latestToast" class="toast" :class="toastTone">
            <div class="toast-title">{{ latestToast.title || 'Notification' }}</div>
            <div class="toast-message">{{ latestToast.message }}</div>
            <div class="toast-meta">{{ fmtTime(latestToast.ts) }}</div>
          </div>
          <div v-else class="progress-empty">No recent task notices.</div>

          <div v-if="sessionStatus?.type === 'retry'" class="toast toast-warning toast-compact">
            <div class="toast-title">Retry</div>
            <div class="toast-message">Attempt {{ sessionStatus.attempt }}: {{ sessionStatus.message }}</div>
          </div>
        </div>
      </div>
    </section>

    <section v-if="hasViewerToken" class="card console">
      <div class="console-header">
        <div>
          <div class="label">Plugin stream</div>
          <div class="console-subtitle">Live relay messages, newest first</div>
        </div>
        <div class="console-chip" :class="wsStatusTone">{{ wsStatusLabel }}</div>
      </div>
        <div class="console-body">
          <div class="console-highlights">
            <div
              class="console-line console-line-interactive console-highlight-line"
              role="button"
              tabindex="0"
              @click="toggleConsoleSection('thinking')"
              @keydown.enter.prevent="toggleConsoleSection('thinking')"
              @keydown.space.prevent="toggleConsoleSection('thinking')"
            >
              <span class="console-time console-highlight-label">Thinking</span>
              <span class="console-text">{{ thinkingPreview }}</span>
            </div>
            <pre v-if="expandedConsoleSection === 'thinking'" class="console-raw">{{ thinkingBody }}</pre>

            <div
              class="console-line console-line-interactive console-highlight-line"
              role="button"
              tabindex="0"
              @click="toggleConsoleSection('final')"
              @keydown.enter.prevent="toggleConsoleSection('final')"
              @keydown.space.prevent="toggleConsoleSection('final')"
            >
              <span class="console-time console-highlight-label">Final</span>
              <span class="console-text">{{ finalPreview }}</span>
            </div>
            <pre v-if="expandedConsoleSection === 'final'" class="console-raw">{{ finalBody }}</pre>
          </div>

          <div v-if="logEntries.length === 0" class="console-empty">No messages yet.</div>
          <div v-for="entry in logEntries" :key="entry.id" class="console-entry" :class="`console-entry-${entry.kind}`">
            <div
              class="console-line console-line-interactive"
              role="button"
              tabindex="0"
              @click="toggleExpandedEntry(entry)"
              @keydown.enter.prevent="toggleExpandedEntry(entry)"
              @keydown.space.prevent="toggleExpandedEntry(entry)"
            >
              <span class="console-time">{{ fmtTime(entry.ts) }}</span>
              <span class="console-text">
                <span class="console-badge" :class="entry.tone">{{ entry.badge }}</span>
                {{ entry.text }}
              </span>
            </div>
            <pre
              v-if="expandedEntryKey === entry.id"
              class="console-raw"
            >{{ entry.details ?? formatJson(entry.raw) }}</pre>
          </div>
        </div>
      </section>
  </main>

  <div v-if="isTokenModalOpen" class="modal-backdrop" @click.self="closeTokenModal">
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="Pairing token">
      <div class="modal-title">Pairing token</div>
      <div class="modal-subtitle">
        Paste the pairing code from <span class="setup-mono">bunx remotecode auth</span> to connect.
      </div>
      <input
        v-model.trim="tokenDraft"
        class="input modal-input"
        placeholder="paste pairing code or viewer token"
        autocomplete="off"
        spellcheck="false"
      />
      <div class="modal-actions">
        <button class="button" type="button" @click="saveViewerToken" :disabled="!tokenDraft.trim()">
          Save token
        </button>
        <button class="button button-ghost" type="button" @click="closeTokenModal">Cancel</button>
        <button
          v-if="hasViewerToken"
          class="button button-ghost"
          type="button"
          @click="clearViewerTokenFromModal"
        >
          Clear token
        </button>
      </div>
    </div>
  </div>
</template>
