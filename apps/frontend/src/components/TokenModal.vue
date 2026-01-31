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
})

const emit = defineEmits(['save', 'cancel', 'clear'])

const draft = defineModel('draft', { type: String, default: '' })
const debugMode = defineModel('debugMode', { type: Boolean, default: false })

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
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="Pairing token">
      <div class="modal-title">Pairing token</div>
      <div class="modal-subtitle">
        Paste the pairing code from <span class="setup-mono">bunx remotecode auth</span> to connect.
      </div>
      <input
        v-model.trim="draft"
        class="input modal-input"
        placeholder="paste pairing code or viewer token"
        autocomplete="off"
        spellcheck="false"
      />

      <label class="modal-toggle">
        <input v-model="debugMode" type="checkbox" class="modal-toggle-input" />
        <span class="modal-toggle-body">
          <span class="modal-toggle-title">Debug mode</span>
          <span class="modal-toggle-help">Show all plugin relay messages (no filtering).</span>
        </span>
      </label>
      <div class="modal-actions">
        <button class="button" type="button" @click="onSave" :disabled="!draft.trim()">
          Save token
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
