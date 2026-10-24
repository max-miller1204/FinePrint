// Structured JSON logs, one object per line, shaped for Cloud Logging.
// Never pass request or document content here: only ids, codes, stages,
// counts, and timings (spec §15.4).

export type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export type LogSink = (line: string) => void;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const stdout: LogSink = (line) => process.stdout.write(`${line}\n`);

// Every line carries `requestId`. Process-level lines (startup, shutdown)
// have no request, so they log `requestId: null`.
export function createLogger(requestId: string | null, sink: LogSink = stdout): Logger {
  const write = (severity: Severity, message: string, fields: LogFields = {}) => {
    sink(JSON.stringify({ ...fields, severity, message, requestId, time: new Date().toISOString() }));
  };
  return {
    debug: (message, fields) => write('DEBUG', message, fields),
    info: (message, fields) => write('INFO', message, fields),
    warn: (message, fields) => write('WARNING', message, fields),
    error: (message, fields) => write('ERROR', message, fields),
  };
}
