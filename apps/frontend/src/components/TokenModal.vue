<script setup>
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  hasViewerToken: {
    type: Boolean,
    default: false,
  },
  deviceId: {
    type: String,
    default: null,
  },
})

const emit = defineEmits(['save', 'cancel', 'clear'])

const draft = defineModel('draft', { type: String, default: '' })
const relayUrl = defineModel('relayUrl', { type: String, default: '' })
const debugMode = defineModel('debugMode', { type: Boolean, default: false })
const hideDiff = defineModel('hideDiff', { type: Boolean, default: false })

const onSave = () => {
  emit('save')
}

const onCancel = () => {
  emit('cancel')
}

const onClear = () => {
  emit('clear')
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="onCancel">
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="modal-title">Settings</div>
      <div class="modal-subtitle">Configure relay connection and pairing.</div>

      <div class="row">
        <label class="label" for="settingsRelayUrl">Relay URL</label>
        <input
          id="settingsRelayUrl"
          v-model.trim="relayUrl"
          class="input modal-input"
          inputmode="url"
          placeholder="http://localhost:8787"
          autocomplete="off"
          spellcheck="false"
        />
      </div>

      <div class="row">
        <div class="label">Device ID</div>
        <div class="modal-kv">{{ deviceId || '—' }}</div>
      </div>

      <div class="row">
        <label class="label" for="settingsToken">Pairing token</label>
        <input
          id="settingsToken"
          v-model.trim="draft"
          class="input modal-input"
          placeholder="paste pairing code or viewer token"
          autocomplete="off"
          spellcheck="false"
        />
      </div>

      <label class="modal-toggle">
        <input v-model="debugMode" type="checkbox" class="modal-toggle-input" />
        <span class="modal-toggle-body">
          <span class="modal-toggle-title">Debug mode</span>
          <span class="modal-toggle-help">Show all plugin relay messages (no filtering).</span>
        </span>
      </label>

      <label class="modal-toggle">
        <input v-model="hideDiff" type="checkbox" class="modal-toggle-input" />
        <span class="modal-toggle-body">
          <span class="modal-toggle-title">Hide diffs</span>
          <span class="modal-toggle-help">Hide DIFF entries from the live console.</span>
        </span>
      </label>
      <div class="modal-actions">
        <button class="button" type="button" @click="onSave" :disabled="!draft.trim()">
          Save
        </button>
        <button class="button button-ghost" type="button" @click="onCancel">Cancel</button>
        <button
          v-if="hasViewerToken"
          class="button button-ghost"
          type="button"
          @click="onClear"
        >
          Clear token
        </button>
      </div>
    </div>
  </div>
</template>
