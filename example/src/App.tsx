import { useState } from 'react'
import { ipc } from './ipc'
import './index.css'

function App() {
  const [inputText, setInputText] = useState('')
  
  // 1. Fetching Data using queries
  const { data: sysInfo, isLoading: sysLoading } = ipc.getSystemInfo.useQuery()
  
  // 2. Mutations
  const echoMutation = ipc.echoReverse.useMutation()
  
  // 3. Error Handling Demo
  const errorMutation = ipc.throwError.useMutation()

  const handleEcho = () => {
    if (!inputText) return
    echoMutation.mutate({ text: inputText })
  }

  const handleError = () => {
    errorMutation.mutate({ shouldThrow: true })
  }

  return (
    <div className="container">
      <div className="header">
        <h1>Type-Safe IPC</h1>
        <p>A beautiful demonstration of <code>electron-ipc-react-hooks</code> utilizing tRPC-like routing, TanStack Query, and Zod validation across the IPC bridge.</p>
      </div>

      <div className="card-grid">
        {/* System Information Card */}
        <div className="card">
          <h2>System Context</h2>
          {sysLoading ? (
            <p>Loading system context...</p>
          ) : (
            <table className="data-table">
              <tbody>
                <tr>
                  <th>Platform</th>
                  <td>{sysInfo?.platform}</td>
                </tr>
                <tr>
                  <th>Architecture</th>
                  <td>{sysInfo?.arch}</td>
                </tr>
                <tr>
                  <th>Node Version</th>
                  <td>{sysInfo?.nodeVersion}</td>
                </tr>
                <tr>
                  <th>Electron</th>
                  <td>{sysInfo?.electronVersion}</td>
                </tr>
                <tr>
                  <th>Chrome</th>
                  <td>{sysInfo?.chromeVersion}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {/* Mutate Data Card */}
        <div className="card">
          <h2>Interactive Mutation</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Send text to the main process. It will artificially delay for 500ms and reverse the string, proving async mutation works.
          </p>
          <div className="input-group">
            <input 
              type="text" 
              placeholder="Enter text to reverse..." 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleEcho()}
            />
            <button 
              onClick={handleEcho}
              disabled={echoMutation.isPending || !inputText}
            >
              {echoMutation.isPending ? 'Sending...' : 'Mutate'}
            </button>
          </div>
          
          {echoMutation.data && (
            <div className="result">
              <strong>Result:</strong> {echoMutation.data}
            </div>
          )}
        </div>

        {/* Error Handling Card */}
        <div className="card">
          <h2>Error Boundaries</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Demonstrates how main process errors are safely caught, returned over IPC, and surface natively in React Query.
          </p>
          <div className="input-group">
            <button 
              onClick={handleError}
              disabled={errorMutation.isPending}
              style={{ background: '#ff4d4f', width: '100%' }}
            >
              {errorMutation.isPending ? 'Throwing...' : 'Trigger Main Process Error'}
            </button>
          </div>
          
          {errorMutation.error && (
            <div className="error">
              <strong>Caught Exception:</strong> {errorMutation.error.message}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
