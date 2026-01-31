<script setup>
const normalizeTodoStatus = (status) => {
  const raw = typeof status === 'string' ? status : ''
  return raw && raw.trim() ? raw.trim() : 'pending'
}

const todoStatusLabel = (status) => {
  const normalized = normalizeTodoStatus(status)
  return normalized.replace(/_/g, ' ')
}

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  sessionTitle: {
    type: String,
    default: '',
  },
  sessionTitleUpdatedAt: {
    type: String,
    default: null,
  },
  sessionStatusLabel: {
    type: String,
    default: 'Unknown',
  },
  sessionStatusTone: {
    type: String,
    default: 'tone-idle',
  },
  runningCount: {
    type: Number,
    default: 0,
  },
  queuedCount: {
    type: Number,
    default: 0,
  },
  todos: {
    type: Array,
    default: () => [],
  },
  todoUpdatedAt: {
    type: String,
    default: null,
  },
  latestToast: {
    type: Object,
    default: null,
  },
  toastTone: {
    type: String,
    default: 'toast-info',
  },
  sessionStatus: {
    type: Object,
    default: null,
  },
  fmtTime: {
    type: Function,
    default: (value) => String(value ?? ''),
  },
})
</script>

<template>
  <section v-if="open" class="card progress">
    <div class="progress-header">
      <div>
        <div class="label">OpenCode</div>
        <div class="progress-title">{{ sessionTitle }}</div>
        <div v-if="sessionTitleUpdatedAt" class="progress-subtitle">
          Updated {{ fmtTime(sessionTitleUpdatedAt) }}
        </div>
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
        <div v-if="todoUpdatedAt" class="progress-panel-meta">Updated {{ fmtTime(todoUpdatedAt) }}</div>
        <div v-if="todos.length === 0" class="progress-empty">No todos yet.</div>
        <div v-else class="todo-list">
          <div v-for="todo in todos" :key="todo.id" class="todo-item" :class="`todo-${todo.status || 'pending'}`">
            <div class="todo-status" :aria-label="todoStatusLabel(todo.status)" :title="todoStatusLabel(todo.status)">
              <svg
                v-if="normalizeTodoStatus(todo.status) === 'completed'"
                class="todo-status-icon"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M20 6L9 17l-5-5"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <svg
                v-else-if="normalizeTodoStatus(todo.status) === 'in_progress'"
                class="todo-status-icon"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M12 6v6l4 2"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M12 21a9 9 0 1 0-9-9"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                />
              </svg>
              <svg
                v-else-if="normalizeTodoStatus(todo.status) === 'cancelled'"
                class="todo-status-icon"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M7 7l10 10M17 7L7 17"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                />
              </svg>
              <svg
                v-else
                class="todo-status-icon"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="2.2" />
              </svg>
              <span class="sr-only">{{ todoStatusLabel(todo.status) }}</span>
            </div>
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
</template>
