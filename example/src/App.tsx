import { useState } from 'react'
import { ipc } from './ipc'
import './index.css'

function App() {
  const [inputText, setInputText] = useState('')

  const { data: sysInfo, isLoading: sysLoading } = ipc.getSystemInfo.useQuery(undefined)
  const echoMutation = ipc.echoReverse.useMutation()
  const errorMutation = ipc.throwError.useMutation()

  return (
    <div id="root">
      <div className="container">

        {/* ── Header ── */}
        <div className="header">
          <div className="header-badge">⚡ electron-ipc-react-hooks</div>
          <h1>Type-Safe IPC</h1>
          <p>
            A live demonstration of <code>electron-ipc-react-hooks</code> — tRPC-style routing,
            TanStack Query integration, and Zod validation across the IPC bridge.
          </p>
        </div>

        {/* ── Status pills ── */}
        <div className="status-bar">
          <div className="pill">
            <span className="pill-dot" />
            IPC Connected
          </div>
          <div className="pill">
            🔒 Context Isolated
          </div>
          <div className="pill">
            ⚛️ React {sysInfo ? 'Query Active' : 'Loading…'}
          </div>
        </div>

        {/* ── Cards ── */}
        <div className="card-grid">

          {/* System Info */}
          <div className="card">
            <div className="card-header">
              <div className="card-icon blue">🖥️</div>
              <h2>System Context</h2>
            </div>
            {sysLoading ? (
              <p className="subtitle">Fetching from main process…</p>
            ) : (
              <table className="data-table">
                <tbody>
                  <tr><td>Platform</td><td>{sysInfo?.platform}</td></tr>
                  <tr><td>Architecture</td><td>{sysInfo?.arch}</td></tr>
                  <tr><td>Node Version</td><td>{sysInfo?.nodeVersion}</td></tr>
                  <tr><td>Electron</td><td>{sysInfo?.electronVersion}</td></tr>
                  <tr><td>Chrome</td><td>{sysInfo?.chromeVersion}</td></tr>
                </tbody>
              </table>
            )}
          </div>

          {/* Echo Mutation */}
          <div className="card">
            <div className="card-header">
              <div className="card-icon purple">🔄</div>
              <h2>IPC Mutation</h2>
            </div>
            <p className="subtitle">
              Type text and send it to the main process. It delays 500ms and returns the reversed string.
            </p>
            <div className="input-group">
              <input
                type="text"
                placeholder="Type something…"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && echoMutation.mutate({ text: inputText })}
              />
              <button
                onClick={() => echoMutation.mutate({ text: inputText })}
                disabled={echoMutation.isPending || !inputText.trim()}
              >
                {echoMutation.isPending ? '…' : 'Send'}
              </button>
            </div>
            {echoMutation.data && (
              <div className="result-block">
                <div className="result-label">Result</div>
                {echoMutation.data}
              </div>
            )}
          </div>

          {/* Error Handling */}
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <div className="card-icon red">🛡️</div>
              <h2>Error Boundaries</h2>
            </div>
            <p className="subtitle">
              Demonstrates how exceptions thrown in the main process are caught, serialized over IPC, and surfaced natively through React Query's error state — no uncaught promise rejections.
            </p>
            <button
              className="danger"
              onClick={() => errorMutation.mutate({ shouldThrow: true })}
              disabled={errorMutation.isPending}
            >
              {errorMutation.isPending ? 'Throwing…' : 'Trigger Main Process Error'}
            </button>
            {errorMutation.error && (
              <div className="error-block">
                <strong>Caught:</strong> {errorMutation.error.message}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

export default App
