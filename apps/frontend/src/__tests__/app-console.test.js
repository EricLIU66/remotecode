import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import App from '../App.vue'
import DiffModal from '../components/DiffModal.vue'
import TokenModal from '../components/TokenModal.vue'
import ProgressCard from '../components/ProgressCard.vue'
import ConsoleCard from '../components/ConsoleCard.vue'

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

const mountAppWithToken = async (options = {}) => {
  window.localStorage.setItem('remotecode.relay_url', 'http://localhost:8787')
  window.localStorage.setItem('remotecode.viewer_token', 'viewer-token')
  if (options.hideDiff) {
    window.localStorage.setItem('remotecode.hide_diff', 'true')
  }

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

    // @git-diff-view/vue uses canvas text measurement.
    // JSDOM does not implement canvas; provide a minimal stub.
    if (typeof HTMLCanvasElement !== 'undefined') {
      HTMLCanvasElement.prototype.getContext = function () {
        return {
          font: '',
          measureText: () => ({ width: 10 }),
        }
      }
    }

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

  it('uses snapshot.update to populate agents modal (not console)', async () => {
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
    expect(consoleBody.text()).not.toContain('SNAPSHOT')

    expect(wrapper.text()).toContain('Agents')
    expect(wrapper.text()).toContain('1')

    const agentsButton = wrapper.findAll('button').find((btn) => btn.text() === 'Details')
    expect(agentsButton).toBeTruthy()
    await agentsButton.trigger('click')
    await nextTick()

    const modal = wrapper.find('.agents-modal')
    expect(modal.exists()).toBe(true)
    expect(modal.text()).toContain('sisyphus')
    expect(modal.text()).toContain('openai:gpt-5.2')
    expect(modal.text()).toContain('Permissions')
  })

  it('Agents modal switches agents via tabs', async () => {
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
            permission: [{ permission: 'read', action: 'allow', pattern: '*' }],
          },
          {
            name: 'metis',
            mode: 'secondary',
            model: { providerID: 'openai', modelID: 'gpt-4.1' },
            permission: [{ permission: 'webfetch', action: 'deny', pattern: '*' }],
          },
        ],
        ts: '2026-01-30T00:00:10.000Z',
      })
    )

    await nextTick()

    const agentsButton = wrapper.findAll('button').find((btn) => btn.text() === 'Details')
    expect(agentsButton).toBeTruthy()
    await agentsButton.trigger('click')
    await nextTick()

    const modal = wrapper.find('.agents-modal')
    expect(modal.exists()).toBe(true)
    expect(modal.text()).toContain('sisyphus')
    expect(modal.text()).toContain('read')

    const tabButtons = wrapper.findAll('button.diff-tab')
    expect(tabButtons.length).toBe(2)
    await tabButtons[1].trigger('click')
    await nextTick()
    expect(modal.text()).toContain('metis')
    expect(modal.text()).toContain('webfetch')
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

  it('does not render session.diff entries when Hide diffs is enabled', async () => {
    const wrapper = await mountAppWithToken({ hideDiff: true })
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'session.diff',
        severity: 'info',
        payload: {
          diff: [
            {
              file: 'apps/frontend/src/style.css',
              language: 'css',
              before: 'a',
              after: 'b',
            },
          ],
        },
        ts: '2026-01-31T04:21:02.000Z',
      })
    )

    await nextTick()
    expect(wrapper.findAll('.console-entry').length).toBe(0)
    expect(wrapper.text()).not.toContain('DIFF')
  })

  it('shows session.diff side-by-side when only one line changes', async () => {
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

    expect(wrapper.find('.diff-modal').text()).toContain('old text')
    expect(wrapper.find('.diff-modal').text()).toContain('new text')
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
    expect(modal.text()).toContain('d')
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

    expect(modal.find('.diff-block-title').text()).toContain('file-a.txt')
    expect(modal.text()).toContain('before-a')
    expect(modal.text()).toContain('after-a')

    await tabs[1].trigger('click')
    await nextTick()
    expect(modal.find('.diff-block-title').text()).toContain('file-b.txt')
    expect(modal.text()).toContain('before-b')
    expect(modal.text()).toContain('after-b')
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
    expect(wrapper.find('.progress-subtitle').text()).not.toContain('—')
    expect(wrapper.findAll('.console-entry').length).toBe(0)
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

  it('renders newest live relay messages at the bottom and omits timestamps', async () => {
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
            id: 'prt_a',
            sessionID: 'ses_123',
            messageID: 'msg_a',
            type: 'text',
            text: 'First',
          },
        },
        ts: '2026-01-30T00:00:05.000Z',
      })
    )

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'message.part.updated',
        severity: 'info',
        payload: {
          part: {
            id: 'prt_b',
            sessionID: 'ses_123',
            messageID: 'msg_b',
            type: 'text',
            text: 'Second',
          },
        },
        ts: '2026-01-30T00:00:06.000Z',
      })
    )

    await nextTick()

    const entries = wrapper.findAll('.console-entry')
    expect(entries.length).toBe(2)
    expect(entries[0].text()).toContain('First')
    expect(entries[1].text()).toContain('Second')
    expect(wrapper.find('.console-time').exists()).toBe(false)
  })

  it('keeps auto-scrolling only when already at the bottom', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    await nextTick()
    const body = wrapper.find('.console-body')
    expect(body.exists()).toBe(true)

    Object.defineProperty(body.element, 'scrollHeight', {
      configurable: true,
      get: () => 1000,
    })
    Object.defineProperty(body.element, 'clientHeight', {
      configurable: true,
      get: () => 200,
    })
    body.element.scrollTop = 800
    await body.trigger('scroll')

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'message.part.updated',
        severity: 'info',
        payload: {
          part: {
            id: 'prt_scroll_1',
            sessionID: 'ses_123',
            messageID: 'msg_scroll_1',
            type: 'text',
            text: 'Hello',
          },
        },
        ts: '2026-01-30T00:00:05.000Z',
      })
    )

    await nextTick()
    await nextTick()
    expect(body.element.scrollTop).toBe(1000)

    body.element.scrollTop = 0
    await body.trigger('scroll')
    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'message.part.updated',
        severity: 'info',
        payload: {
          part: {
            id: 'prt_scroll_2',
            sessionID: 'ses_123',
            messageID: 'msg_scroll_2',
            type: 'text',
            text: 'World',
          },
        },
        ts: '2026-01-30T00:00:06.000Z',
      })
    )

    await nextTick()
    await nextTick()
    expect(body.element.scrollTop).toBe(0)
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

  it('shows a completion toast when status transitions busy to idle', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'session.status',
        severity: 'info',
        payload: { status: { type: 'busy' } },
        ts: '2026-01-31T00:00:01.000Z',
      })
    )
    await nextTick()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'session.status',
        severity: 'info',
        payload: { status: { type: 'idle' } },
        ts: '2026-01-31T00:00:02.000Z',
      })
    )
    await nextTick()

    const progress = wrapper.find('.progress')
    expect(progress.exists()).toBe(true)
    expect(progress.text()).toContain('Idle')
    expect(progress.text()).toContain('All tasks finished')
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
    expect(consoleBody.text()).toContain('Implemented the live message console the way you described')
    expect(consoleBody.text()).not.toContain('described for')
  })

  it('renders live message text as markdown', async () => {
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
            id: 'prt_9',
            sessionID: 'ses_123',
            messageID: 'msg_999',
            type: 'text',
            text: '**Bold** and `code`',
          },
        },
        ts: '2026-01-30T00:00:05.100Z',
      })
    )

    await nextTick()
    const entry = wrapper.findAll('.console-entry')[0]
    expect(entry.exists()).toBe(true)
    expect(entry.html()).toContain('<strong>Bold</strong>')
    expect(entry.html()).toContain('<code>code</code>')
  })

  it('renders reasoning message.part.updated as THINKING (no prefix) and does not show event_type placeholder', async () => {
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
            id: 'prt_reason',
            sessionID: 'ses_123',
            messageID: 'msg_reason',
            type: 'reasoning',
            text: '**Updating CSS for todo items**\n\nI need to adjust the CSS xxx',
          },
          delta: '.',
        },
        ts: '2026-01-31T05:50:42.715Z',
      })
    )

    await nextTick()
    const entry = wrapper.findAll('.console-entry')[0]
    expect(entry.text()).toContain('THINKING')
    expect(entry.text()).toContain('Updating CSS for todo items')
    expect(entry.text()).not.toContain('Thinking:')
    expect(entry.text()).toContain('I need to adjust the CSS xxx')
    expect(entry.text()).not.toContain('CSS xxx.')
    expect(entry.text()).not.toContain('message.part.updated')
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

  it('does not append message.part.updated delta and keeps last non-empty text', async () => {
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
            text: 'Hello',
          },
          delta: 'Hello',
        },
        ts: '2026-01-30T00:00:07.500Z',
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
            text: 'Hello',
          },
          delta: ' world',
        },
        ts: '2026-01-30T00:00:07.600Z',
      })
    )

    // Some streams send an empty final update. This should not clear the running text.
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
            text: '',
          },
        },
        ts: '2026-01-30T00:00:07.700Z',
      })
    )

    await nextTick()
    const entries = wrapper.findAll('.console-entry')
    expect(entries.length).toBe(1)
    expect(entries[0].text()).toContain('Hello')
    expect(entries[0].text()).not.toContain('Hello world')
  })

  it('keeps final message after message.completed', async () => {
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
            text: 'Shipping fix…',
          },
        },
        ts: '2026-01-30T00:00:08.000Z',
      })
    )

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'message.completed',
        severity: 'info',
        payload: {
          message: {
            id: 'msg_123',
            sessionID: 'ses_123',
            type: 'text',
            text: 'Shipping fix… done.',
          },
        },
        ts: '2026-01-30T00:00:09.000Z',
      })
    )

    await nextTick()
    const entries = wrapper.findAll('.console-entry')
    expect(entries.length).toBe(1)
    expect(entries[0].text()).toContain('MESSAGE')
    expect(entries[0].text()).toContain('Shipping fix… done.')
  })

  it('uses message.updated to update metrics (not console)', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    const created = 1769834628499
    const completed = 1769834643719

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'message.updated',
        severity: 'info',
        payload: {
          info: {
            id: 'msg_1',
            sessionID: 'ses_123',
            time: { created, completed },
            modelID: 'gpt-5.2',
            providerID: 'openai',
            mode: 'sisyphus',
            agent: 'sisyphus',
            cost: 0,
          },
        },
        ts: '2026-01-30T00:00:11.000Z',
      })
    )

    await nextTick()

    expect(wrapper.findAll('.console-entry').length).toBe(0)

    const metrics = wrapper.findAll('.metric')
    const byLabel = (label) =>
      metrics.find((metric) => metric.find('.metric-label').text().trim() === label) || null

    const modelMetric = byLabel('Model')
    expect(modelMetric).toBeTruthy()
    expect(modelMetric.find('.metric-value').text()).toContain('openai / gpt-5.2')

    const modeMetric = byLabel('Mode / agent')
    expect(modeMetric).toBeTruthy()
    expect(modeMetric.find('.metric-value').text()).toContain('sisyphus')

    const costMetric = byLabel('Cost')
    expect(costMetric).toBeTruthy()
    expect(costMetric.find('.metric-value').text()).toBe('0')

    const lastMetric = byLabel('Last plugin msg')
    expect(lastMetric).toBeTruthy()
    const lastText = lastMetric.find('.metric-value').text()
    expect(lastText).toContain(new Date(created).toLocaleString())
    expect(lastText).toContain(new Date(completed).toLocaleString())
  })

  it('shows otherwise suppressed events in console when debug mode enabled', async () => {
    window.localStorage.setItem('remotecode.debug_mode', 'true')
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'session.updated',
        severity: 'info',
        payload: { info: { title: 'Session Title' } },
        ts: '2026-01-31T00:00:01.000Z',
      })
    )

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'todo.updated',
        severity: 'info',
        payload: { sessionID: 'ses_123', todos: [{ id: '1', content: 'Todo', status: 'pending' }] },
        ts: '2026-01-31T00:00:02.000Z',
      })
    )

    await nextTick()

    const entries = wrapper.findAll('.console-entry')
    expect(entries.length).toBeGreaterThanOrEqual(2)
    const text = wrapper.find('.console-body').text()
    expect(text).toContain('EVENT')
    expect(text).toContain('session.updated')
    expect(text).toContain('todo.updated')
  })

  it('hides tool.execute.before todowrite unless debug mode is enabled', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'tool.execute.before',
        severity: 'info',
        payload: {
          tool: 'todowrite',
          args: {
            todos: [
              {
                id: '1',
                content: 'todo a',
                status: 'completed',
                priority: 'high',
              },
            ],
          },
        },
        ts: '2026-01-31T09:40:22.520Z',
      })
    )

    await nextTick()
    expect(wrapper.findAll('.console-entry').length).toBe(0)

    // Flip on debug mode through settings modal (gear)
    await wrapper.find('.profile-button').trigger('click')
    await nextTick()
    const debugToggle = wrapper.find('input.modal-toggle-input')
    expect(debugToggle.exists()).toBe(true)
    await debugToggle.setValue(true)
    await nextTick()
    await wrapper.find('.modal-actions button.button').trigger('click')
    await nextTick()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'tool.execute.before',
        severity: 'info',
        payload: {
          tool: 'todowrite',
          args: {
            todos: [
              {
                id: '1',
                content: 'todo a',
                status: 'completed',
                priority: 'high',
              },
            ],
          },
        },
        ts: '2026-01-31T09:40:23.520Z',
      })
    )

    await nextTick()
    expect(wrapper.findAll('.console-entry').length).toBe(1)
    expect(wrapper.text()).toContain('⚙ todowrite')
  })

  it('stops showing debug-only events after turning debug mode off', async () => {
    window.localStorage.setItem('remotecode.debug_mode', 'true')
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'session.updated',
        severity: 'info',
        payload: { info: { title: 'Session Title' } },
        ts: '2026-01-31T00:00:01.000Z',
      })
    )

    await nextTick()
    expect(wrapper.find('.console-body').text()).toContain('session.updated')

    await wrapper.find('.profile-button').trigger('click')
    await nextTick()
    const checkbox = wrapper.find('.modal-toggle-input')
    expect(checkbox.exists()).toBe(true)
    await checkbox.setValue(false)
    await nextTick()

    expect(wrapper.find('.console-body').text()).not.toContain('session.updated')
  })

  it('renders tool.execute.after test events as TEST with output', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    const output = `\n> remotecode-frontend@0.0.0 test\n> vitest run\n\n\n RUN  v3.2.4\n\n ✓ src/__tests__/app-console.test.js (19 tests) 134ms\n\n Test Files  1 passed (1)\n      Tests  19 passed (19)\n\n`

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'tool.execute.after',
        severity: 'info',
        payload: {
          tool: 'bash',
          title: 'Runs frontend unit tests',
          metadata: {
            output,
            exit: 0,
            description: 'Runs frontend unit tests',
          },
          output,
        },
        ts: '2026-01-31T04:21:20.802Z',
      })
    )

    await nextTick()

    const consoleBody = wrapper.find('.console-body')
    expect(consoleBody.text()).toContain('TEST')
    expect(consoleBody.text()).toContain('Runs frontend unit tests')
    expect(consoleBody.text()).toContain('PASS')
    expect(consoleBody.text()).toContain('tests 19/19')

    const rows = wrapper.findAll('.console-line')
    const testRow = rows.find((row) => row.text().includes('TEST'))
    expect(testRow).toBeTruthy()
    await testRow.trigger('click')
    await nextTick()
    expect(wrapper.find('.console-raw').text()).toContain('vitest run')
  })

  it('formats tool.execute.after lsp_diagnostics as a compact TOOL line and hides raw details unless debug mode', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'tool.execute.after',
        severity: 'info',
        payload: {
          tool: 'lsp_diagnostics',
          title: '',
          metadata: { truncated: false },
          output: 'No diagnostics found',
          output_truncated: false,
        },
        ts: '2026-01-31T09:56:36.756Z',
      })
    )

    await nextTick()
    const consoleBody = wrapper.find('.console-body')
    expect(consoleBody.text()).toContain('TOOL')
    expect(consoleBody.text()).toContain('⚙ lsp_diagnostics [No diagnostics found]')
    expect(consoleBody.text()).not.toContain('tool.execute.after')

    const row = wrapper.findAll('.console-line').find((line) => line.text().includes('lsp_diagnostics'))
    expect(row).toBeTruthy()
    await row.trigger('click')
    await nextTick()
    // Non-debug: we should not show raw output.
    expect(wrapper.find('.console-raw').exists()).toBe(false)

    await wrapper.find('.profile-button').trigger('click')
    await nextTick()
    const debugToggle = wrapper.find('input.modal-toggle-input')
    await debugToggle.setValue(true)
    await nextTick()
    await wrapper.find('.modal-actions button.button').trigger('click')
    await nextTick()

    // With debug on, the same event should expose raw JSON.
    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'tool.execute.after',
        severity: 'info',
        payload: {
          tool: 'lsp_diagnostics',
          title: '',
          metadata: { truncated: false },
          output: 'No diagnostics found',
          output_truncated: false,
        },
        ts: '2026-01-31T09:56:37.756Z',
      })
    )

    await nextTick()
    const lastRow = wrapper.findAll('.console-line').at(-1)
    await lastRow.trigger('click')
    await nextTick()
    expect(wrapper.find('.console-raw').exists()).toBe(true)
    expect(wrapper.find('.console-raw').text()).toContain('lsp_diagnostics')
  })

  it('hides tool.execute.after todowrite unless debug mode is enabled', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'tool.execute.after',
        severity: 'info',
        payload: {
          tool: 'todowrite',
          title: 'Update todo list',
          metadata: { exit: 0 },
          output: '',
        },
        ts: '2026-01-31T09:41:20.802Z',
      })
    )

    await nextTick()
    expect(wrapper.findAll('.console-entry').length).toBe(0)

    await wrapper.find('.profile-button').trigger('click')
    await nextTick()
    const debugToggle = wrapper.find('input.modal-toggle-input')
    await debugToggle.setValue(true)
    await nextTick()
    await wrapper.find('.modal-actions button.button').trigger('click')
    await nextTick()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'tool.execute.after',
        severity: 'info',
        payload: {
          tool: 'todowrite',
          title: 'Update todo list',
          metadata: { exit: 0 },
          output: '',
        },
        ts: '2026-01-31T09:41:21.802Z',
      })
    )

    await nextTick()
    expect(wrapper.findAll('.console-entry').length).toBe(1)
    expect(wrapper.text()).toContain('TOOL')
    expect(wrapper.text()).toContain('Update todo list')
  })

  it('formats tool.execute.before with tool + args (no event_type prefix)', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'tool.execute.before',
        severity: 'info',
        payload: {
          tool: 'lsp_diagnostics',
          args: {
            filePath: '/Users/jinjial/Desktop/AI2/remotecode/apps/frontend/src/App.vue',
            severity: 'all',
          },
        },
        ts: '2026-01-31T09:17:55.550Z',
      })
    )

    await nextTick()

    const consoleBody = wrapper.find('.console-body')
    expect(consoleBody.text()).toContain('TOOL')
    expect(consoleBody.text()).toContain('⚙ lsp_diagnostics')
    expect(consoleBody.text()).toContain('filePath=apps/frontend/src/App.vue')
    expect(consoleBody.text()).toContain('severity=all')
    expect(consoleBody.text()).not.toContain('tool.execute.before')

    const row = wrapper.findAll('.console-line').find((line) => line.text().includes('lsp_diagnostics'))
    expect(row).toBeTruthy()
    await row.trigger('click')
    await nextTick()
    // Non-debug: tool.execute.before should not show details.
    expect(wrapper.find('.console-raw').exists()).toBe(false)

    // Collapse so we can re-open after enabling debug.
    await row.trigger('click')
    await nextTick()

    await wrapper.find('.profile-button').trigger('click')
    await nextTick()
    const debugToggle = wrapper.find('input.modal-toggle-input')
    await debugToggle.setValue(true)
    await nextTick()
    await wrapper.find('.modal-actions button.button').trigger('click')
    await nextTick()

    // Debug: raw JSON should show.
    await row.trigger('click')
    await nextTick()
    expect(wrapper.find('.console-raw').exists()).toBe(true)
    expect(wrapper.find('.console-raw').text()).toContain('lsp_diagnostics')
  })

  it('formats tool.execute.before grep command with pattern + path summary', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'tool.execute.before',
        severity: 'info',
        payload: {
          tool: 'grep',
          args: {
            pattern: '\\.footer\\b',
            path: '/Users/jinjial/Desktop/AI2/remotecode/apps/frontend/src/style.css',
          },
        },
        ts: '2026-01-31T09:20:37.865Z',
      })
    )

    await nextTick()

    const consoleBody = wrapper.find('.console-body')
    expect(consoleBody.text()).toContain('TOOL')
    expect(consoleBody.text()).toContain('✱ Grep "\\.footer\\b" in apps/frontend/src/style.css')
    expect(consoleBody.text()).not.toContain('tool.execute.before')
  })

  it('uses todo.updated to update todos panel (not console)', async () => {
    const wrapper = await mountAppWithToken()
    const socket = MockWebSocket.instances[0]
    expect(socket).toBeTruthy()

    socket.emitMessage(
      JSON.stringify({
        type: 'event.append',
        event_type: 'todo.updated',
        severity: 'info',
        payload: {
          sessionID: 'ses_123',
          todos: [
            { id: '1', content: 'First todo', status: 'completed', priority: 'high' },
            { id: '2', content: 'Second todo', status: 'pending', priority: 'low' },
          ],
        },
        ts: '2026-01-31T04:21:41.787Z',
      })
    )

    await nextTick()
    expect(wrapper.findAll('.console-entry').length).toBe(0)
    expect(wrapper.text()).toContain('First todo')
    expect(wrapper.text()).toContain('Second todo')

    const meta = wrapper.find('.progress-panel-meta')
    expect(meta.exists()).toBe(true)
    expect(meta.text()).toContain('Updated')
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

  it('DiffModal renders and emits close', async () => {
    const wrapper = mount(DiffModal, {
      props: {
        diff: {
          id: 1,
          diffBlocks: [
            {
              file: 'file-a.txt',
              language: 'text',
              lines: [
                { type: 'del', text: 'before-a' },
                { type: 'add', text: 'after-a' },
              ],
              columns: { before: 'before-a', after: 'after-a' },
            },
          ],
        },
      },
    })

    expect(wrapper.find('.diff-modal').exists()).toBe(true)
    await wrapper.find('.diff-close').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('TokenModal renders when open and emits actions', async () => {
    const wrapper = mount(TokenModal, {
      props: {
        open: true,
        hasViewerToken: true,
        deviceId: 'device-1',
        relayUrl: 'http://localhost:8787',
        'onUpdate:relayUrl': () => {},
        hideDiff: false,
        'onUpdate:hideDiff': () => {},
        draft: 'token',
        'onUpdate:draft': () => {},
        debugMode: false,
        'onUpdate:debugMode': () => {},
      },
    })

    expect(wrapper.find('.modal-card').exists()).toBe(true)
    expect(wrapper.text()).toContain('Relay URL')
    expect(wrapper.text()).toContain('Device ID')
    expect(wrapper.text()).toContain('Hide diffs')
    expect(wrapper.text()).toContain('Debug mode')
    await wrapper.find('button.button').trigger('click')
    expect(wrapper.emitted('save')).toBeTruthy()
    await wrapper.findAll('button.button-ghost')[0].trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('ProgressCard renders session title', async () => {
    const wrapper = mount(ProgressCard, {
      props: {
        open: true,
        sessionTitle: 'Test session',
        sessionStatusLabel: 'Idle',
        sessionStatusTone: 'tone-idle',
        runningCount: 0,
        queuedCount: 0,
        todos: [],
        latestToast: null,
        toastTone: 'toast-info',
        sessionStatus: null,
      },
    })

    expect(wrapper.find('.progress-title').text()).toContain('Test session')
  })

  it('ConsoleCard renders empty state', async () => {
    const wrapper = mount(ConsoleCard, {
      props: {
        open: true,
        wsStatusTone: 'tone-idle',
        wsStatusLabel: 'Live',
        debugMode: false,
        thinkingPreview: 'No thinking yet.',
        thinkingBody: '—',
        finalPreview: 'No summary yet.',
        finalBody: '—',
        expandedConsoleSection: null,
        expandedEntryKey: null,
        logEntries: [],
        fmtTime: () => '—',
        formatJson: () => '—',
      },
    })

    expect(wrapper.find('.console-body').text()).toContain('No messages yet.')
  })

  it('ConsoleCard copy button flips to a tick after successful copy', async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })

    const wrapper = mount(ConsoleCard, {
      props: {
        open: true,
        wsStatusTone: 'tone-online',
        wsStatusLabel: 'Live',
        debugMode: true,
        expandedConsoleSection: null,
        expandedEntryKey: 1,
        logEntries: [
          {
            id: 1,
            ts: '2026-01-31T00:00:00.000Z',
            kind: 'event',
            badge: 'EVENT',
            tone: 'tone-idle',
            text: 'hello',
            details: 'details',
            raw: { hello: 'world' },
          },
        ],
        fmtTime: () => '—',
        formatJson: () => '{"hello":"world"}',
      },
    })

    const button = wrapper.find('.console-icon-button')
    expect(button.exists()).toBe(true)
    expect(button.attributes('aria-label')).toBe('Copy raw JSON')

    await button.trigger('click')
    await nextTick()

    expect(writeText).toHaveBeenCalled()
    expect(wrapper.find('.console-icon-button').attributes('aria-label')).toBe('Copied')
  })
})
