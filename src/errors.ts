/**
 * Error class for IPC procedure errors.
 * Provides structured error information with a code and optional data payload.
 */
export class IpcError extends Error {
  constructor(
    public message: string,
    public code: string = 'INTERNAL_SERVER_ERROR',
    public data?: any
  ) {
    super(message);
    this.name = 'IpcError';
  }
}