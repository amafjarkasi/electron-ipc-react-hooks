import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useIpcInvalidator } from 'electron-ipc-react-hooks/renderer'
import { ipc, useSettingsStore } from './ipc'
import './index.css'

function App() {
  const [inputText, setInputText] = useState('')
  const [clockData, setClockData] = useState<string>('Waiting for clock...')
  
  const [settings, setSettings, resetSettings] = useSettingsStore();

  const queryClient = useQueryClient()
  useIpcInvalidator(queryClient)

  const { data: sysInfo, isLoading: sysLoading } = ipc.system.getInfo.useQuery(undefined)
  const { data: helloMsg, isLoading: helloLoading } = ipc.helloContext.useQuery(undefined)
  const echoMutation = ipc.echoReverse.useMutation()
  const errorMutation = ipc.throwError.useMutation()
  const saveProfileMutation = ipc.saveProfile.useMutation()
  const openWindowMutation = ipc.system.openNewWindow.useMutation()

  ipc.clock.useSubscription(undefined, {
    onData: (data: string) => {
      setClockData(data);
    }
  });

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

          {/* Shared Store Demo */}
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <div className="card-icon blue">🌐</div>
              <h2>Shared Reactive Store</h2>
            </div>
            <p className="subtitle">
              A global state object synced natively between the Main process and all active Renderer windows.
            </p>
            <div className="result-block" style={{ marginTop: '10px', display: 'flex', gap: '20px', alignItems: 'center' }}>
               <div>
                  <strong>Theme:</strong> {settings.theme}
               </div>
               <button onClick={() => setSettings(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }))}>
                 Toggle Theme
               </button>

               <div style={{ marginLeft: 'auto' }}>
                  <strong>Notifications:</strong> {settings.notifications ? 'ON' : 'OFF'}
               </div>
               <button onClick={() => setSettings({ notifications: !settings.notifications })}>
                 Toggle Notifications
               </button>
               
               <button onClick={() => resetSettings()} className="danger" style={{ marginLeft: 'auto' }}>
                 Reset Defaults
               </button>
            </div>
          </div>

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
            
            <div className="card-header" style={{ marginTop: '20px' }}>
              <div className="card-icon purple">👋</div>
              <h2>Context-Aware Handler</h2>
            </div>
            {helloLoading ? (
              <p className="subtitle">Fetching greeting…</p>
            ) : (
              <div className="result-block" style={{ marginTop: '10px' }}>
                <div className="result-label">Greeting</div>
                {helloMsg}
              </div>
            )}

            <div className="card-header" style={{ marginTop: '20px' }}>
              <div className="card-icon blue">🪟</div>
              <h2>Multi-Window Sync</h2>
            </div>
            <p className="subtitle">
              Open a new window to watch the Shared Reactive Store sync in real-time!
            </p>
            <div style={{ marginTop: '10px' }}>
               <button 
                 onClick={() => openWindowMutation.mutate(undefined)}
                 disabled={openWindowMutation.isPending}
               >
                 {openWindowMutation.isPending ? 'Opening...' : 'Open New Window'}
               </button>
            </div>
          </div>

          {/* File Picker Demo */}
          <div className="card">
            <div className="card-header">
              <div className="card-icon blue">📁</div>
              <h2>Native Dialogs & FS</h2>
            </div>
            <p className="subtitle">
              Trigger a native open-file dialog on the Main Process and return the file's stats via IPC.
            </p>
            <FilePickerDemo />
          </div>

          {/* Clock Subscription */}
          <div className="card">
            <div className="card-header">
              <div className="card-icon blue">⏱️</div>
              <h2>Real-time Subscription</h2>
            </div>
            <p className="subtitle">
              Demonstrates continuous stream of data from the main process over an IPC channel.
            </p>
            <div className="result-block" style={{ marginTop: '10px', fontFamily: 'monospace', fontSize: '1.2em' }}>
              {clockData}
            </div>
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
              <h2>Error Boundaries & Validation</h2>
            </div>
            <p className="subtitle">
              Demonstrates how exceptions thrown in the main process are caught, serialized over IPC, and surfaced natively through React Query's error state. Also demonstrates automatic Zod validation errors!
            </p>
            
            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '250px' }}>
                <h3>1. Expected Error</h3>
                <button
                  className="danger"
                  onClick={() => errorMutation.mutate({ shouldThrow: true })}
                  disabled={errorMutation.isPending}
                >
                  {errorMutation.isPending ? 'Throwing…' : 'Trigger Main Process Error'}
                </button>
                {errorMutation.error && (
                  <div className="error-block" style={{ marginTop: '10px' }}>
                    <strong>Caught:</strong> {errorMutation.error.message}
                  </div>
                )}
              </div>

              <div style={{ flex: 1, minWidth: '250px' }}>
                <h3>2. Zod Validation (Requires ≥ 3 chars)</h3>
                <div className="input-group">
                  <input
                    type="text"
                    placeholder="Type name (e.g., 'a' or 'admin')..."
                    id="profile-name"
                  />
                  <button
                    onClick={() => {
                      const val = (document.getElementById('profile-name') as HTMLInputElement).value;
                      saveProfileMutation.mutate({ name: val });
                    }}
                    disabled={saveProfileMutation.isPending}
                  >
                    Save
                  </button>
                </div>
                {saveProfileMutation.error && (
                  <div className="error-block" style={{ marginTop: '10px' }}>
                    <strong>Code:</strong> {(saveProfileMutation.error as any).code}<br/>
                    <strong>Message:</strong> {saveProfileMutation.error.message}<br/>
                    <pre style={{ fontSize: '11px', marginTop: '5px', whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify((saveProfileMutation.error as any).data, null, 2)}
                    </pre>
                  </div>
                )}
                {saveProfileMutation.data && (
                  <div className="result-block" style={{ marginTop: '10px', borderColor: 'green' }}>
                    Success!
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* AbortSignal Cancellation */}
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <div className="card-icon blue">🛑</div>
              <h2>Auto-Canceling IPC Queries</h2>
            </div>
            <p className="subtitle">
              Clicking cancel aborts the React Query, which automatically sends an IPC signal to the Main process to halt the backend operation via <code>AbortSignal</code>.
            </p>
            <SlowQueryDemo />
          </div>

          {/* Automatic Request Batching */}
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <div className="card-icon purple">📦</div>
              <h2>Automatic IPC Batching</h2>
            </div>
            <p className="subtitle">
              Concurrent `useQuery` calls executed within the same tick are automatically batched into a single IPC message sent to the Main Process. Check the terminal to see them executed in one block!
            </p>
            <BatchingDemo />
          </div>

          {/* Infinite Query Demo */}
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <div className="card-icon blue">📜</div>
              <h2>Infinite Query Pagination</h2>
            </div>
            <p className="subtitle">
              Using React Query's `useInfiniteQuery` wrapper over IPC to seamlessly paginate a local backend database or large file!
            </p>
            <InfiniteQueryDemo />
          </div>

          {/* Bi-directional Channel Demo */}
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <div className="card-icon purple">📡</div>
              <h2>Bi-directional Data Streams</h2>
            </div>
            <p className="subtitle">
              Using the `.channel()` procedure, the Renderer can continuously stream chunks up to the Main process, whilst simultaneously receiving responses!
            </p>
            <ChannelDemo />
          </div>

        </div>
      </div>
    </div>
  )
}

function FilePickerDemo() {
  const pickFile = ipc.system.openFileDialog.useMutation();

  return (
    <div style={{ marginTop: '15px' }}>
      <button 
        onClick={() => pickFile.mutate(undefined)} 
        disabled={pickFile.isPending}
      >
        {pickFile.isPending ? 'Opening...' : 'Select a File'}
      </button>

      {pickFile.data && (
        <div className="result-block" style={{ marginTop: '10px' }}>
          <div className="result-label">File Stats</div>
          <div style={{ fontSize: '0.9em', wordBreak: 'break-all' }}>
            <strong>Name:</strong> {pickFile.data.name}<br/>
            <strong>Size:</strong> {(pickFile.data.size / 1024).toFixed(2)} KB<br/>
            <strong>Path:</strong> {pickFile.data.path}
          </div>
        </div>
      )}
    </div>
  )
}

function BatchingDemo() {
  const [trigger, setTrigger] = useState(false);

  // When enabled, all three queries mount at the exact same time
  const q1 = ipc.mathSquare.useQuery(2, { enabled: trigger });
  const q2 = ipc.mathSquare.useQuery(5, { enabled: trigger });
  const q3 = ipc.mathSquare.useQuery(10, { enabled: trigger });

  const isFetching = q1.isFetching || q2.isFetching || q3.isFetching;

  return (
    <div style={{ marginTop: '15px' }}>
      <div className="input-group">
        <button onClick={() => setTrigger(true)} disabled={trigger || isFetching}>
          Trigger 3 Concurrent Queries
        </button>
        <button className="danger" onClick={() => setTrigger(false)} disabled={!trigger}>
          Reset
        </button>
      </div>

      {trigger && (
        <div className="result-block" style={{ marginTop: '10px', display: 'flex', gap: '20px' }}>
          {isFetching ? (
            <span>Fetching via single IPC batch...</span>
          ) : (
            <>
              <div>2² = {q1.data}</div>
              <div>5² = {q2.data}</div>
              <div>10² = {q3.data}</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SlowQueryDemo() {
  const [trigger, setTrigger] = useState(false);

  const query = ipc.slowQuery.useQuery('Heavy Data Task', {
    enabled: trigger,
  });

  return (
    <div style={{ marginTop: '15px' }}>
      <div className="input-group">
        {!trigger ? (
          <button onClick={() => setTrigger(true)}>Start 5s Query</button>
        ) : (
          <button className="danger" onClick={() => {
            setTrigger(false);
          }}>
            Cancel Query Component
          </button>
        )}
      </div>

      {trigger && (
        <div className="result-block" style={{ marginTop: '10px' }}>
          {query.isLoading ? 'Loading heavily (Check terminal console)...' : query.data}
          {query.error && <div style={{ color: 'red' }}>{query.error.message}</div>}
        </div>
      )}
    </div>
  );
}

function InfiniteQueryDemo() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status } = ipc.getLogs.useInfiniteQuery(
    { limit: 5 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: 0,
    }
  );

  return (
    <div style={{ marginTop: '15px' }}>
      {status === 'pending' ? (
        <p>Loading initial items...</p>
      ) : status === 'error' ? (
        <p>Error: Could not load items</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '200px', overflowY: 'auto', background: '#f5f5f5', border: '1px solid #ddd', padding: '10px', borderRadius: '4px' }}>
            {data.pages.map((page, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {page.items.map((item) => (
                  <div key={item.id} style={{ padding: '8px', background: 'white', borderRadius: '4px', border: '1px solid #eee' }}>
                    {item.message}
                  </div>
                ))}
              </div>
            ))}
          </div>
          
          <div style={{ marginTop: '10px' }}>
            <button
              onClick={() => fetchNextPage()}
              disabled={!hasNextPage || isFetchingNextPage}
            >
              {isFetchingNextPage
                ? 'Loading more...'
                : hasNextPage
                ? 'Load More'
                : 'Nothing more to load'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ChannelDemo() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  
  const { send } = ipc.fileUploadStream.useChannel(
    { filename: 'test.zip' },
    {
      onData: (data) => {
        setLogs((prev) => [...prev, `[Main] ${JSON.stringify(data)}`]);
        if (data.status === 'complete') {
          setIsSending(false);
        }
      }
    }
  );

  const startStream = async () => {
    setIsSending(true);
    setLogs(['[Renderer] Starting chunk stream...']);
    
    for (let i = 1; i <= 5; i++) {
      setLogs((prev) => [...prev, `[Renderer] Sending chunk ${i} (1024 bytes)`]);
      send({ bytes: 1024 });
      await new Promise(r => setTimeout(r, 400));
    }
    
    setLogs((prev) => [...prev, `[Renderer] Sending FIN signal.`]);
    send({ done: true });
  };

  return (
    <div style={{ marginTop: '15px' }}>
      <button onClick={startStream} disabled={isSending}>
        {isSending ? 'Streaming...' : 'Start 5KB Stream to Main'}
      </button>
      <div style={{ marginTop: '10px', maxHeight: '150px', overflowY: 'auto', background: '#1e1e1e', color: '#00ff00', padding: '10px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px' }}>
        {logs.length === 0 ? 'Waiting for stream...' : logs.map((log, i) => (
          <div key={i} style={{ color: log.startsWith('[Main]') ? '#ff00ff' : '#00ffff' }}>{log}</div>
        ))}
      </div>
    </div>
  );
}

export default App

// --- DEMO COMPONENTS ---

function WindowControlDemo() {
  const windowControl = ipc.system.controlWindow.useMutation();

  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
        <button onClick={() => windowControl.mutate({ action: 'minimize' })}>
          Minimize
        </button>
        <button onClick={() => windowControl.mutate({ action: 'maximize' })}>
          Maximize/Restore
        </button>
        <button onClick={() => windowControl.mutate({ action: 'close' })} className="danger">
          Close
        </button>
      </div>
    </div>
  )
}

function OSNotificationDemo() {
  const notificationMutation = ipc.system.showNotification.useMutation();
  const [notifText, setNotifText] = useState('Hello from React via IPC!');

  return (
    <div>
      <h3 style={{ marginBottom: '10px', fontSize: '1rem' }}>Native OS Notifications</h3>
      <div className="input-group">
        <input 
          type="text" 
          value={notifText} 
          onChange={(e) => setNotifText(e.target.value)} 
        />
        <button 
          onClick={() => notificationMutation.mutate({ title: 'React Query IPC', body: notifText })}
          disabled={notificationMutation.isPending}
        >
          Show
        </button>
      </div>
    </div>
  )
}

function DragAndDropDemo() {
  const processDrop = ipc.system.processDroppedFile.useMutation();
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div style={{ marginTop: '15px' }}>
      <div 
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) {
            // In Electron, File objects have a `path` property!
            processDrop.mutate({ filePath: (file as any).path });
          }
        }}
        style={{
          border: `2px dashed ${isDragging ? '#00d8ff' : '#666'}`,
          borderRadius: '8px',
          padding: '40px 20px',
          textAlign: 'center',
          background: isDragging ? 'rgba(0, 216, 255, 0.1)' : 'rgba(0, 0, 0, 0.2)',
          transition: 'all 0.2s',
          cursor: 'pointer'
        }}
      >
        {processDrop.isPending ? 'Processing File...' : 'Drop a text file here!'}
      </div>

      {processDrop.error && (
        <div className="error-block" style={{ marginTop: '10px' }}>
          <strong>Error:</strong> {processDrop.error.message}
        </div>
      )}

      {processDrop.data && (
        <div className="result-block" style={{ marginTop: '15px' }}>
          <div className="result-label">File Preview ({processDrop.data.name})</div>
          <div style={{ fontSize: '0.8em', color: '#999', marginBottom: '8px' }}>
            Size: {(processDrop.data.size / 1024).toFixed(2)} KB
          </div>
          <pre style={{ 
            background: '#111', 
            padding: '10px', 
            borderRadius: '4px', 
            fontSize: '12px', 
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            margin: 0
          }}>
            {processDrop.data.preview || '(Empty File)'}
          </pre>
        </div>
      )}
    </div>
  )
}
