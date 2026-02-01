<script setup>
import { computed, watch } from 'vue'
import { DiffModeEnum, DiffView } from '@git-diff-view/vue'
import { generateDiffFile } from '@git-diff-view/file'
import '@git-diff-view/vue/styles/diff-view.css'

const props = defineProps({
  diff: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['close'])

const activeFile = defineModel('activeFile', { type: String, default: null })

const diffBlocks = computed(() => {
  if (!props.diff || typeof props.diff !== 'object') return []
  return Array.isArray(props.diff.diffBlocks) ? props.diff.diffBlocks : []
})

const activeDiffBlock = computed(() => {
  const blocks = diffBlocks.value
  if (blocks.length === 0) return null
  if (activeFile.value) {
    const match = blocks.find((b) => b?.file === activeFile.value)
    if (match) return match
  }
  return blocks[0] ?? null
})

const isSingleLineChange = computed(() => {
  const block = activeDiffBlock.value
  const lines = Array.isArray(block?.lines) ? block.lines : []
  let adds = 0
  let dels = 0
  for (const line of lines) {
    if (line?.type === 'add') adds += 1
    if (line?.type === 'del') dels += 1
  }
  const total = adds + dels
  if (total === 0) return false
  return total <= 2
})

const diffViewMode = computed(() => {
  // GitHub-style split view when the change is small; otherwise unified.
  return isSingleLineChange.value ? DiffModeEnum.SplitGitHub : DiffModeEnum.Unified
})

const diffFile = computed(() => {
  const block = activeDiffBlock.value
  if (!block || typeof block !== 'object') return null
  const fileName = typeof block.file === 'string' && block.file.trim() ? block.file.trim() : 'file'
  const before = block.columns?.before ?? ''
  const after = block.columns?.after ?? ''
  const language = typeof block.language === 'string' && block.language.trim() ? block.language.trim() : 'text'
  try {
    const instance = generateDiffFile(
      `a/${fileName}`,
      String(before),
      `b/${fileName}`,
      String(after),
      language,
      language
    )
    // Ensure both modes are ready regardless of default.
    instance.initTheme('light')
    instance.initRaw()
    instance.buildSplitDiffLines()
    instance.buildUnifiedDiffLines()
    return instance
  } catch {
    return null
  }
})

watch(
  () => props.diff,
  (next) => {
    if (!next || typeof next !== 'object') {
      activeFile.value = null
      return
    }

    const first = Array.isArray(next.diffBlocks) ? next.diffBlocks[0] : null
    if (first?.file && activeFile.value !== first.file) {
      activeFile.value = first.file
    }
  },
  { immediate: true }
)

const close = () => {
  emit('close')
}
</script>

<template>
  <div v-if="diff" class="modal-backdrop" @click.self="close">
    <div class="modal-card diff-modal" role="dialog" aria-modal="true" aria-label="Diff details" tabindex="-1">
      <div class="diff-modal-header">
        <div class="modal-title">Diff</div>
        <button class="diff-close" type="button" @click="close" aria-label="Close diff">×</button>
      </div>

      <div class="diff-tabs" v-if="diffBlocks.length">
        <button
          v-for="block in diffBlocks"
          :key="block.file"
          type="button"
          class="diff-tab"
          :class="{ 'diff-tab-active': activeFile === block.file }"
          @click="activeFile = block.file"
        >
          {{ block.file }}
        </button>
      </div>

      <div class="diff-blocks" v-if="activeDiffBlock">
        <div
          class="diff-block"
          :class="activeDiffBlock.language ? `language-${activeDiffBlock.language}` : 'language-text'"
          :data-lang="activeDiffBlock.language || 'text'"
        >
          <div class="diff-block-title">{{ activeDiffBlock.file }}</div>
          <div v-if="!diffFile" class="diff-empty">No diff data.</div>
          <div v-else class="diff-view-host">
            <DiffView
              :diff-file="diffFile"
              :diff-view-mode="diffViewMode"
              diff-view-theme="light"
              :diff-view-highlight="true"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
