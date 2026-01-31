<script setup>
import MarkdownIt from 'markdown-it'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

const renderMarkdown = (value) => {
  const text = String(value ?? '')
  if (!text) return ''

  // Keep rendering inline to preserve the console layout, but still respect
  // newline boundaries when the stream emits multi-line updates.
  return text
    .split('\n')
    .map((line) => markdown.renderInline(line))
    .join('<br />')
}

const consoleBodyRef = ref(null)
const isPinnedToBottom = ref(true)

const updatePinnedToBottom = () => {
  const el = consoleBodyRef.value
  if (!el) return

  const scrollTop = typeof el.scrollTop === 'number' ? el.scrollTop : 0
  const scrollHeight = typeof el.scrollHeight === 'number' ? el.scrollHeight : 0
  const clientHeight = typeof el.clientHeight === 'number' ? el.clientHeight : 0

  // Keep a small threshold so we still treat "near bottom" as bottom.
  const threshold = 8
  isPinnedToBottom.value = scrollTop + clientHeight >= scrollHeight - threshold
}

const scrollConsoleToBottom = async () => {
  await nextTick()
  const el = consoleBodyRef.value
  if (!el) return
  if (typeof el.scrollHeight !== 'number') return
  el.scrollTop = el.scrollHeight
  isPinnedToBottom.value = true
}

const copiedEntryKey = ref(null)
let copyResetTimer = null

onBeforeUnmount(() => {
  if (copyResetTimer) {
    window.clearTimeout(copyResetTimer)
    copyResetTimer = null
  }
})

const copyText = async (text) => {
  const value = String(text ?? '')
  if (!value) return false
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // fall through
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '-1000px'
    textarea.style.left = '-1000px'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return Boolean(ok)
  } catch {
    // best-effort
    return false
  }
}

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  wsStatusTone: {
    type: String,
    default: 'tone-idle',
  },
  wsStatusLabel: {
    type: String,
    default: 'Offline',
  },
  debugMode: {
    type: Boolean,
    default: false,
  },
  thinkingPreview: {
    type: String,
    default: 'No thinking yet.',
  },
  thinkingBody: {
    type: String,
    default: '—',
  },
  finalPreview: {
    type: String,
    default: 'No summary yet.',
  },
  finalBody: {
    type: String,
    default: '—',
  },
  expandedConsoleSection: {
    type: String,
    default: null,
  },
  expandedEntryKey: {
    type: [Number, String],
    default: null,
  },
  logEntries: {
    type: Array,
    default: () => [],
  },
  activeDiff: {
    type: Object,
    default: null,
  },
  toggleConsoleSection: {
    type: Function,
    default: null,
  },
  toggleExpandedEntry: {
    type: Function,
    default: null,
  },
  setActiveDiff: {
    type: Function,
    default: null,
  },
  fmtTime: {
    type: Function,
    default: (value) => String(value ?? ''),
  },
  formatJson: {
    type: Function,
    default: (value) => String(value ?? ''),
  },
})

onMounted(() => {
  void scrollConsoleToBottom()
})

watch(
  () => props.logEntries,
  () => {
    if (!isPinnedToBottom.value) return
    void scrollConsoleToBottom()
  },
  { deep: false }
)

const onConsoleScroll = () => {
  updatePinnedToBottom()
}

const onToggleConsoleSection = (key) => {
  if (typeof props.toggleConsoleSection === 'function') {
    props.toggleConsoleSection(key)
  }
}

const onToggleExpandedEntry = (entry) => {
  if (typeof props.toggleExpandedEntry === 'function') {
    props.toggleExpandedEntry(entry)
  }
}

const onSetActiveDiff = (entry) => {
  if (typeof props.setActiveDiff === 'function') {
    props.setActiveDiff(entry)
  }
}

const onCopyEntryJson = (entry) => {
  const key = entry?.id ?? null
  if (key === null || key === undefined) {
    void copyText(props.formatJson(entry?.raw))
    return
  }

  void (async () => {
    const ok = await copyText(props.formatJson(entry?.raw))
    if (!ok) return
    copiedEntryKey.value = key
    if (copyResetTimer) {
      window.clearTimeout(copyResetTimer)
      copyResetTimer = null
    }
    copyResetTimer = window.setTimeout(() => {
      if (copiedEntryKey.value === key) {
        copiedEntryKey.value = null
      }
      copyResetTimer = null
    }, 1200)
  })()
}
</script>

<template>
  <section v-if="open" class="card console">
    <div class="console-header">
      <div>
        <div class="label">Plugin stream</div>
        <div class="console-subtitle">Live relay messages, newest first</div>
      </div>
      <div class="console-chip" :class="wsStatusTone">{{ wsStatusLabel }}</div>
    </div>
    <div ref="consoleBodyRef" class="console-body" @scroll="onConsoleScroll">
      <div v-if="logEntries.length === 0" class="console-empty">No messages yet.</div>
      <div v-for="entry in logEntries" :key="entry.id" class="console-entry" :class="`console-entry-${entry.kind}`">
        <div
          class="console-line console-line-interactive"
          role="button"
          tabindex="0"
          @click="onToggleExpandedEntry(entry)"
          @keydown.enter.prevent="onToggleExpandedEntry(entry)"
          @keydown.space.prevent="onToggleExpandedEntry(entry)"
        >
          <span class="console-text">
            <span class="console-badge" :class="entry.tone">{{ entry.badge }}</span>
            <span
              v-if="entry.kind === 'message' || entry.kind === 'thinking'"
              class="console-markdown"
              v-html="renderMarkdown(entry.text)"
            ></span>
            <span v-else>{{ entry.text }}</span>
          </span>
        </div>
        <div
          v-if="expandedEntryKey === entry.id && entry.kind !== 'diff' && (debugMode || entry.details)"
          class="console-expanded"
        >
          <pre v-if="entry.details" class="console-raw">{{ entry.details }}</pre>

          <div v-if="debugMode" class="console-expanded-head">
            <div class="console-expanded-label">Raw JSON</div>
            <button
              class="console-icon-button"
              type="button"
              @click.stop="onCopyEntryJson(entry)"
              :aria-label="copiedEntryKey === entry.id ? 'Copied' : 'Copy raw JSON'"
              :title="copiedEntryKey === entry.id ? 'Copied' : 'Copy'"
            >
              <svg
                v-if="copiedEntryKey === entry.id"
                class="console-icon"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M20 6L9 17l-5-5"
                  stroke="currentColor"
                  stroke-width="2.0"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <svg
                v-else
                class="console-icon"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M9 9h10v10H9V9Z"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linejoin="round"
                />
                <path
                  d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </div>
          <pre v-if="debugMode" class="console-raw console-raw-secondary">{{ formatJson(entry.raw) }}</pre>
        </div>
        <div
          v-if="expandedEntryKey === entry.id && entry.kind === 'diff'"
          class="diff-open-trigger"
          role="button"
          tabindex="0"
          @click.stop="onSetActiveDiff(entry)"
          @keydown.enter.stop.prevent="onSetActiveDiff(entry)"
          @keydown.space.stop.prevent="onSetActiveDiff(entry)"
        >
          View diff details
        </div>
        <div
          v-if="activeDiff?.id === entry.id && entry.kind === 'diff'"
          class="sr-only"
          aria-live="polite"
        >Diff modal open</div>
      </div>
    </div>
  </section>
</template>
