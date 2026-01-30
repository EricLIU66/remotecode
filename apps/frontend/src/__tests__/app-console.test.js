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

  it('renders session.diff with file diff preview + expandable before/after', async () => {
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

    const expanded = wrapper.find('.console-raw')
    expect(expanded.text()).toContain('apps/frontend/src/App.vue')
    expect(expanded.text()).toContain('--- before')
    expect(expanded.text()).toContain('+++ after')
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
})
