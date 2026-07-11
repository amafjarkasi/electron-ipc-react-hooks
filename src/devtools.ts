import type { ProcedureType } from './types';

/**
 * A single IPC call record in the DevTools history.
 */
export interface IpcCallRecord {
  /** The procedure path (e.g., 'admin.users.get') */
  path: string;
  /** The procedure type */
  type: ProcedureType | string;
  /** The input payload sent from the renderer */
  input: any;
  /** Timestamp when the call started (ms since epoch) */
  timestamp: number;
  /** How long the call took in ms (set when response arrives) */
  duration?: number;
  /** Whether the call succeeded */
  success?: boolean;
  /** The response data (if successful) */
  data?: any;
  /** The error details (if failed) */
  error?: { message: string; code?: string; data?: any };
}

/**
 * Aggregated statistics computed from the DevTools history.
 */
export interface IpcDevToolsStats {
  /** Total number of recorded calls */
  totalCalls: number;
  /** Number of successful calls */
  successCount: number;
  /** Number of failed calls */
  errorCount: number;
  /** Average call duration in ms */
  avgDuration: number;
  /** Breakdown by procedure type */
  byType: Record<string, number>;
}

/**
 * Options for creating a DevTools instance.
 */
export interface DevToolsOptions {
  /** Maximum number of history entries to keep (default: 100) */
  maxHistory?: number;
}

/**
 * IPC DevTools for inspecting and monitoring IPC traffic between
 * main and renderer processes.
 *
 * @example
 * ```ts
 * const devtools = createDevTools({ maxHistory: 50 });
 *
 * // In your main process handler:
 * const id = crypto.randomUUID();
 * devtools.recordCall({ path: 'getUser', type: 'query', input: { id: '1' }, timestamp: Date.now(), id });
 * devtools.recordResponse({ path: 'getUser', duration: 45, success: true, data: { name: 'Alice' }, id });
 *
 * // In a DevTools panel:
 * const history = devtools.getHistory();
 * const stats = devtools.getStats();
 * ```
 */
export interface IpcDevTools {
  /** Record the start of an IPC call. Pass `id` when concurrent same-path calls are possible. */
  recordCall(call: { path: string; type: string; input: any; timestamp: number; id?: string }): void;
  /** Record the response of an IPC call. Match `id` to the corresponding `recordCall` when provided. */
  recordResponse(response: {
    path: string;
    duration: number;
    success: boolean;
    data?: any;
    error?: { message: string; code?: string; data?: any };
    id?: string;
  }): void;
  /** Get recorded history, optionally filtered */
  getHistory(filter?: { pathPrefix?: string }): IpcCallRecord[];
  /** Get aggregated statistics */
  getStats(): IpcDevToolsStats;
  /** Clear all recorded history */
  clear(): void;
  /** Subscribe to new response events */
  subscribe(listener: (record: IpcCallRecord) => void): () => void;
  /** Enable recording (default: enabled) */
  enable(): void;
  /** Disable recording */
  disable(): void;
}

type PendingCall = { path: string; type: string; input: any; timestamp: number; id?: string };

function pendingKey(path: string, id?: string): string {
  return id !== undefined && id !== '' ? `${path}\0${id}` : path;
}

/**
 * Create an IpcDevTools instance for monitoring IPC traffic.
 */
export function createDevTools(options: DevToolsOptions = {}): IpcDevTools {
  const maxHistory = options.maxHistory ?? 100;

  // Queues per key so concurrent same-path calls match FIFO (or by explicit id)
  const pendingCalls = new Map<string, PendingCall[]>();
  const history: IpcCallRecord[] = [];
  const subscribers = new Set<(record: IpcCallRecord) => void>();
  let enabled = true;

  return {
    recordCall(call) {
      if (!enabled) return;
      const key = pendingKey(call.path, call.id);
      const queue = pendingCalls.get(key);
      if (queue) {
        queue.push(call);
      } else {
        pendingCalls.set(key, [call]);
      }
    },

    recordResponse(response) {
      if (!enabled) return;
      const key = pendingKey(response.path, response.id);
      const queue = pendingCalls.get(key);
      if (!queue || queue.length === 0) return;
      const pending = queue.shift()!;
      if (queue.length === 0) {
        pendingCalls.delete(key);
      }

      const record: IpcCallRecord = {
        path: pending.path,
        type: pending.type,
        input: pending.input,
        timestamp: pending.timestamp,
        duration: response.duration,
        success: response.success,
        data: response.data,
        error: response.error,
      };

      history.push(record);
      // Trim to maxHistory (keep the most recent)
      if (history.length > maxHistory) {
        history.splice(0, history.length - maxHistory);
      }

      // Notify subscribers
      for (const listener of subscribers) {
        try {
          listener(record);
        } catch {
          // Subscriber errors should not disrupt recording
        }
      }
    },

    getHistory(filter) {
      if (!filter?.pathPrefix) return [...history];
      return history.filter(r => r.path.startsWith(filter.pathPrefix!));
    },

    getStats() {
      let successCount = 0;
      let errorCount = 0;
      let totalDuration = 0;
      let durationCount = 0;
      const byType: Record<string, number> = {};

      for (const record of history) {
        if (record.success === true) successCount++;
        else if (record.success === false) errorCount++;

        if (record.duration !== undefined) {
          totalDuration += record.duration;
          durationCount++;
        }

        byType[record.type] = (byType[record.type] || 0) + 1;
      }

      return {
        totalCalls: history.length,
        successCount,
        errorCount,
        avgDuration: durationCount > 0 ? totalDuration / durationCount : 0,
        byType,
      };
    },

    clear() {
      history.length = 0;
      pendingCalls.clear();
    },

    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },

    enable() {
      enabled = true;
    },

    disable() {
      enabled = false;
    },
  };
}
