import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import App from '../App.vue'

class MockWebSocket extends EventTarget {
  static instances = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  url

  constructor(url) {
    super()
    this.url = url
    MockWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN
      this.dispatchEvent(new Event('open'))
    })
  }

  send() {}

  close() {
    if (this.readyState === MockWebSocket.CLOSED) return
    this.readyState = MockWebSocket.CLOSED
    this.dispatchEvent(new CloseEvent('close'))
  }

  emitMessage(data) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

const createLocalStorageMock = () => {
  let store = {}
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null
    },
    setItem(key, value) {
      store[key] = String(value)
    },
    removeItem(key) {
      delete store[key]
    },
    clear() {
      store = {}
    },
  }
}

const stubFetchOk = () => {
  globalThis.fetch = vi.fn(async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }),
      text: async () => '',
    }
  })
}

const mountAppWithToken = async () => {
  window.localStorage.setItem('remotecode.relay_url', 'http://localhost:8787')
  window.localStorage.setItem('remotecode.viewer_token', 'viewer-token')

  const wrapper = mount(App)
  await nextTick()
  await nextTick()
  return wrapper
}

describe('Live message console', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: createLocalStorageMock(),
      configurable: true,
    })
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    stubFetchOk()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not render Latest event footer line', async () => {
    const wrapper = await mountAppWithToken()
    expect(wrapper.text()).not.toContain('Latest event:')
  })

  it('renders snapshot.update with a snapshot style row', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'snapshot.update',
        device_id: 'device-1',
        agent_states: [
          {
            name: 'sisyphus',
            mode: 'primary',
            model: { providerID: 'openai', modelID: 'gpt-5.2' },
          },
        ],
        ts: '2026-01-30T00:00:00.000Z',
      })
    )

    await nextTick()

    const consoleBody = wrapper.find('.console-body')
    expect(consoleBody.text()).toContain('SNAPSHOT')
    expect(consoleBody.text()).toContain('sisyphus')
    expect(consoleBody.text()).toContain('gpt-5.2')
  })

  it('renders session.diff preview and exposes the diff trigger', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'session.diff',
        severity: 'info',
        payload: {
          sessionID: 'ses_123',
          diff: [
            {
              file: 'apps/frontend/src/App.vue',
              before: 'before text',
              after: 'after text',
              language: 'vue',
            },
          ],
        },
        ts: '2026-01-30T00:00:01.000Z',
      })
    )

    await nextTick()
    const rows = wrapper.findAll('.console-line')
    const diffRow = rows.find((row) => row.text().includes('DIFF'))
    expect(diffRow).toBeTruthy()
    expect(diffRow.text()).toContain('apps/frontend/src/App.vue')

    await diffRow.trigger('click')
    await nextTick()

    const trigger = wrapper.find('.diff-open-trigger')
    expect(trigger.exists()).toBe(true)
  })

  it('shows session.diff side-by-side before/after with language class', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'session.diff',
        severity: 'info',
        payload: {
          sessionID: 'ses_123',
          diff: [
            {
              file: 'apps/frontend/src/App.vue',
              before: 'same line\nold text',
              after: 'same line\nnew text',
              language: 'vue',
            },
          ],
        },
        ts: '2026-01-30T00:00:01.500Z',
      })
    )

    await nextTick()

    const rows = wrapper.findAll('.console-line')
    const diffRow = rows.find((row) => row.text().includes('DIFF'))
    expect(diffRow).toBeTruthy()
    await diffRow.trigger('click')
    await nextTick()

    const trigger = wrapper.find('.diff-open-trigger')
    expect(trigger.exists()).toBe(true)
    await trigger.trigger('click')
    await nextTick()

    const block = wrapper.find('.diff-block')
    expect(block.exists()).toBe(true)
    expect(block.classes().some((c) => c.startsWith('language-'))).toBe(true)

    const left = block.find('.diff-col-left .diff-pre')
    const right = block.find('.diff-col-right .diff-pre')
    expect(left.text()).toContain('old text')
    expect(right.text()).toContain('new text')
  })

  it('renders session.diff preview with all files and line stats', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'session.diff',
        severity: 'info',
        payload: {
          sessionID: 'ses_123',
          diff: [
            {
              file: 'file-a.txt',
              before: 'a\nb\nc\n',
              after: 'a\nb\nc\nd\n',
              language: 'text',
            },
            {
              file: 'file-b.txt',
              before: 'x\ny\n',
              after: 'x\nz\n',
              language: 'text',
            },
          ],
        },
        ts: '2026-01-30T00:00:01.750Z',
      })
    )

    await nextTick()

    const rows = wrapper.findAll('.console-line')
    const diffRow = rows.find((row) => row.text().includes('DIFF'))
    expect(diffRow).toBeTruthy()
    expect(diffRow.text()).toContain('file-a.txt (+1/-0)')
    expect(diffRow.text()).toContain('file-b.txt (+1/-1)')

    await diffRow.trigger('click')
    await nextTick()

    const trigger = wrapper.find('.diff-open-trigger')
    expect(trigger.exists()).toBe(true)
    await trigger.trigger('click')
    await nextTick()

    const modal = wrapper.find('.diff-modal')
    expect(modal.exists()).toBe(true)
    const blocks = modal.findAll('.diff-block')
    expect(blocks.length).toBe(1)
    expect(blocks[0].text()).toContain('file-a.txt')
    const before = blocks[0].find('.diff-col-left .diff-pre')
    const after = blocks[0].find('.diff-col-right .diff-pre')
    expect(before.text()).toContain('a\nb\nc')
    expect(after.text()).toContain('d')
  })

  it('renders session.diff files as tabs and switches active diff', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'session.diff',
        severity: 'info',
        payload: {
          sessionID: 'ses_123',
          diff: [
            {
              file: 'file-a.txt',
              before: 'before-a',
              after: 'after-a',
              language: 'text',
            },
            {
              file: 'file-b.txt',
              before: 'before-b',
              after: 'after-b',
              language: 'text',
            },
          ],
        },
        ts: '2026-01-30T00:00:01.900Z',
      })
    )

    await nextTick()

    const rows = wrapper.findAll('.console-line')
    const diffRow = rows.find((row) => row.text().includes('DIFF'))
    expect(diffRow).toBeTruthy()
    await diffRow.trigger('click')
    await nextTick()

    const trigger = wrapper.find('.diff-open-trigger')
    await trigger.trigger('click')
    await nextTick()

    const modal = wrapper.find('.diff-modal')
    expect(modal.exists()).toBe(true)
    const tabs = modal.findAll('.diff-tabs button')
    expect(tabs.length).toBe(2)
    expect(tabs[0].text()).toContain('file-a.txt')
    expect(tabs[1].text()).toContain('file-b.txt')

    const beforeText = () => modal.find('.diff-col-left .diff-pre').text()
    const afterText = () => modal.find('.diff-col-right .diff-pre').text()
    expect(beforeText()).toContain('before-a')
    expect(afterText()).toContain('after-a')
    expect(afterText()).not.toContain('after-b')

    await tabs[1].trigger('click')
    await nextTick()
    expect(beforeText()).toContain('before-b')
    expect(afterText()).toContain('after-b')
    expect(afterText()).not.toContain('after-a')
  })

  it('uses session.updated event to update session title', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'session.updated',
        severity: 'info',
        payload: {
          info: {
            id: 'ses_123',
            title: 'Opencode plugin live relay messages UI integration',
          },
        },
        ts: '2026-01-30T00:00:02.000Z',
      })
    )

    await nextTick()
    expect(wrapper.find('.progress-title').text()).toContain('Opencode plugin live relay messages UI integration')
  })

  it('skips session.idle event from console list', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'session.idle',
        severity: 'info',
        payload: { sessionID: 'ses_123' },
        ts: '2026-01-30T00:00:03.000Z',
      })
    )

    await nextTick()
    expect(wrapper.findAll('.console-entry').length).toBe(0)
  })

  it('uses session.status event to update status label', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'session.status',
        severity: 'info',
        payload: { sessionID: 'ses_123', status: { type: 'idle' } },
        ts: '2026-01-30T00:00:04.000Z',
      })
    )

    await nextTick()
    expect(wrapper.find('.progress-chip').text()).toContain('Idle')
  })

  it('renders message.part.updated text in console', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'message.part.updated',
        severity: 'info',
        payload: {
          part: {
            id: 'prt_1',
            sessionID: 'ses_123',
            messageID: 'msg_123',
            type: 'text',
            text: 'Implemented the live message console the way you described',
          },
          delta: ' for',
        },
        ts: '2026-01-30T00:00:05.000Z',
      })
    )

    await nextTick()
    const consoleBody = wrapper.find('.console-body')
    expect(consoleBody.text()).toContain('MESSAGE')
    expect(consoleBody.text()).toContain('Implemented the live message console the way you described for')
  })

  it('merges message.part.updated lines by session and message', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'message.part.updated',
        severity: 'info',
        payload: {
          part: {
            id: 'prt_1',
            sessionID: 'ses_123',
            messageID: 'msg_123',
            type: 'text',
            text: 'PR created: https://',
          },
        },
        ts: '2026-01-30T00:00:06.000Z',
      })
    )

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'message.part.updated',
        severity: 'info',
        payload: {
          part: {
            id: 'prt_1',
            sessionID: 'ses_123',
            messageID: 'msg_123',
            type: 'text',
            text: 'PR created: https://github',
          },
        },
        ts: '2026-01-30T00:00:07.000Z',
      })
    )

    await nextTick()
    const entries = wrapper.findAll('.console-entry')
    expect(entries.length).toBe(1)
    expect(entries[0].text()).toContain('PR created: https://github')
  })

  it('opens diff modal and closes it', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'session.diff',
        severity: 'info',
        payload: {
          sessionID: 'ses_123',
          diff: [
            {
              file: 'apps/frontend/src/App.vue',
              before: 'old text',
              after: 'new text',
              language: 'vue',
            },
          ],
        },
        ts: '2026-01-30T00:00:01.600Z',
      })
    )

    await nextTick()

    const rows = wrapper.findAll('.console-line')
    const diffRow = rows.find((row) => row.text().includes('DIFF'))
    expect(diffRow).toBeTruthy()
    await diffRow.trigger('click')
    await nextTick()

    const trigger = wrapper.find('.diff-open-trigger')
    await trigger.trigger('click')
    await nextTick()

    const modal = wrapper.find('.diff-modal')
    expect(modal.exists()).toBe(true)

    const closeBtn = modal.find('.diff-close')
    await closeBtn.trigger('click')
    await nextTick()

    expect(wrapper.find('.diff-modal').exists()).toBe(false)
  })
})
