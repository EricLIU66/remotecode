<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  agents: {
    type: Array,
    default: () => [],
  },
  updatedAt: {
    type: String,
    default: null,
  },
})

const emit = defineEmits(['close'])

const close = () => {
  emit('close')
}

const normalizedAgents = computed(() => (Array.isArray(props.agents) ? props.agents : []))

const activeAgentKey = ref(null)

const agentKey = (agent, index) => {
  if (agent && typeof agent === 'object') {
    if (typeof agent.id === 'string' && agent.id) return agent.id
    if (typeof agent.name === 'string' && agent.name) return agent.name
  }
  return String(index)
}

watch(
  () => [props.open, normalizedAgents.value.length],
  () => {
    if (!props.open) return
    if (normalizedAgents.value.length === 0) {
      activeAgentKey.value = null
      return
    }
    const firstKey = agentKey(normalizedAgents.value[0], 0)
    if (!activeAgentKey.value) {
      activeAgentKey.value = firstKey
      return
    }

    const stillExists = normalizedAgents.value.some((agent, index) => agentKey(agent, index) === activeAgentKey.value)
    if (!stillExists) {
      activeAgentKey.value = firstKey
    }
  },
  { immediate: true }
)

const activeAgent = computed(() => {
  if (!activeAgentKey.value) return null
  const index = normalizedAgents.value.findIndex(
    (agent, idx) => agentKey(agent, idx) === activeAgentKey.value
  )
  if (index < 0) return null
  return normalizedAgents.value[index] ?? null
})

const formatModel = (agent) => {
  if (!agent || typeof agent !== 'object') return '—'
  const model = agent.model
  if (model && typeof model === 'object') {
    const provider = model.providerID ? String(model.providerID) : null
    const id = model.modelID ? String(model.modelID) : null
    if (provider && id) return `${provider}:${id}`
    if (id) return id
  }
  return '—'
}

const formatTime = (value) => {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

const normalizePerms = (agent) => {
  if (!agent || typeof agent !== 'object') return []
  const perms = agent.permission
  return Array.isArray(perms) ? perms : []
}

const permKey = (perm, index) => {
  if (!perm || typeof perm !== 'object') return `perm_${index}`
  const name = perm.permission ? String(perm.permission) : 'perm'
  const action = perm.action ? String(perm.action) : 'action'
  const pattern = perm.pattern ? String(perm.pattern) : ''
  return `${name}:${action}:${pattern}:${index}`
}

const permTone = (perm) => {
  const action = perm?.action
  if (action === 'allow') return 'perm-chip perm-chip-allow'
  if (action === 'deny') return 'perm-chip perm-chip-deny'
  return 'perm-chip perm-chip-ask'
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="close">
    <div class="modal-card agents-modal" role="dialog" aria-modal="true" aria-label="Agents">
      <div class="agents-modal-header">
        <div>
          <div class="modal-title">Agents</div>
          <div class="modal-subtitle">Latest snapshot: {{ formatTime(updatedAt) }}</div>
        </div>
        <button class="diff-close" type="button" @click="close" aria-label="Close agents">×</button>
      </div>

      <div v-if="normalizedAgents.length === 0" class="agents-empty">No agent_states in snapshot.</div>

      <div v-else>
        <div class="diff-tabs agents-tabs">
          <button
            v-for="(agent, index) in normalizedAgents"
            :key="agentKey(agent, index)"
            type="button"
            class="diff-tab"
            :class="{ 'diff-tab-active': activeAgentKey === agentKey(agent, index) }"
            @click="activeAgentKey = agentKey(agent, index)"
          >
            {{ agent?.name || `agent-${index + 1}` }}
          </button>
        </div>

        <div v-if="activeAgent" class="agent-card">
          <div class="agent-header">
            <div class="agent-name">{{ activeAgent?.name || 'agent' }}</div>
            <div class="agent-meta">
              <span class="agent-pill">{{ activeAgent?.mode || '—' }}</span>
              <span class="agent-pill">{{ formatModel(activeAgent) }}</span>
              <span class="agent-pill">native: {{ activeAgent?.native ? 'yes' : 'no' }}</span>
            </div>
          </div>

          <div class="agent-section">
            <div class="agent-section-title">Permissions</div>
            <div v-if="normalizePerms(activeAgent).length === 0" class="agents-empty">No permissions provided.</div>
            <div v-else class="perm-table">
              <div class="perm-head">Permission</div>
              <div class="perm-head">Action</div>
              <div class="perm-head">Pattern</div>
              <template v-for="(perm, permIndex) in normalizePerms(activeAgent)" :key="permKey(perm, permIndex)">
                <div class="perm-cell perm-mono">{{ perm?.permission || '—' }}</div>
                <div class="perm-cell"><span :class="permTone(perm)">{{ perm?.action || '—' }}</span></div>
                <div class="perm-cell perm-mono">{{ perm?.pattern || '—' }}</div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
