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
const isChecking = ref(false)
const status = ref('unknown')
const lastOkAt = ref(null)
const latencyMs = ref(null)
const lastError = ref(null)
const wsStatus = ref('idle')
const wsError = ref(null)
const lastMessageAt = ref(null)
const deviceId = ref(null)
const logEntries = ref([])
const latestSnapshot = ref(null)
const latestEvent = ref(null)

const relayHealthUrl = computed(() => {
  try {
    return new URL('/health', relayUrl.value).toString()
  } catch {
    return null
  }
})

const relayWsUrl = computed(() => {
  if (!viewerToken.value) {
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
    return `event.append ${eventType} ${severity}`
  }

  return formatInline(message)
}

let pollTimer = null
let currentAbort = null
let socket = null
let reconnectTimer = null

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
}

watch(
  () => relayUrl.value,
  (value) => {
    window.localStorage.setItem(storageKey, value)
    void checkHealth()
  }
)

watch(
  () => viewerToken.value,
  (value) => {
    window.localStorage.setItem(viewerTokenKey, value)
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

  const wsUrl = relayWsUrl.value
  if (!wsUrl) {
    wsStatus.value = viewerToken.value ? 'error' : 'idle'
    wsError.value = viewerToken.value ? 'Invalid relay URL' : null
    return
  }

  wsStatus.value = 'connecting'
  wsError.value = null
  const connection = new WebSocket(wsUrl)
  socket = connection

  connection.addEventListener('open', () => {
    wsStatus.value = 'online'
  })

  connection.addEventListener('message', (event) => {
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
    }

    const entry = {
      ts: new Date().toISOString(),
      summary: summarizeMessage(payload),
      raw: payload,
    }
    logEntries.value = [entry, ...logEntries.value].slice(0, 200)
    lastMessageAt.value = entry.ts
  })

  connection.addEventListener('close', () => {
    if (socket !== connection) return
    wsStatus.value = 'offline'
    reconnectTimer = window.setTimeout(connectViewer, 2000)
  })

  connection.addEventListener('error', () => {
    wsStatus.value = 'error'
    wsError.value = 'WebSocket error'
  })
}

onMounted(() => {
  void checkHealth()
  startPolling()
  connectViewer()
})

onBeforeUnmount(() => {
  pollTimer && window.clearInterval(pollTimer)
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
      <div class="pulse" :class="statusTone" aria-hidden="true"></div>
    </header>

    <section class="card">
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

      <div class="row row-secondary">
        <label class="label" for="viewerToken">Viewer token</label>
        <input
          id="viewerToken"
          v-model.trim="viewerToken"
          class="input"
          placeholder="paste viewer token"
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
      </div>

      <div class="footer">
        <button class="button" type="button" @click="checkHealth" :disabled="isChecking">
          {{ isChecking ? 'Checking…' : 'Check now' }}
        </button>
        <div class="hint">
          <div class="hint-line">GET {{ relayHealthUrl || '—' }}</div>
          <div v-if="lastError" class="hint-line hint-error">{{ lastError }}</div>
          <div class="hint-line">WS {{ relayWsUrl || '—' }}</div>
          <div v-if="wsError" class="hint-line hint-error">{{ wsError }}</div>
        </div>
      </div>
    </section>

    <section class="card console">
      <div class="console-header">
        <div>
          <div class="label">Plugin stream</div>
          <div class="console-subtitle">Live relay messages, newest first</div>
        </div>
        <div class="console-chip" :class="wsStatusTone">{{ wsStatusLabel }}</div>
      </div>
      <div class="console-body">
        <div v-if="logEntries.length === 0" class="console-empty">No messages yet.</div>
        <div v-for="entry in logEntries" :key="entry.ts + entry.summary" class="console-line">
          <span class="console-time">{{ fmtTime(entry.ts) }}</span>
          <span class="console-text">{{ entry.summary }}</span>
        </div>
      </div>
      <div class="console-footer">
        <div class="console-hint">Latest event: {{ summarizeMessage(latestEvent) }}</div>
        <div class="console-hint">Session: {{ formatInline(latestSnapshot?.session_summary) }}</div>
      </div>
    </section>
  </main>
</template>
