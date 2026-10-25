// Failure classes for one failed e2e test, from its report.json entry. See
// gate.ts for what each class means and what the gate does about it.

export type FailureClass = 'APP_HANG' | 'INFRA' | 'SETUP' | 'APP_FAIL';

export interface ReportError {
  category?: string;
  code?: string;
  message?: string;
  source?: { file?: string; line?: number };
}

export interface ReportResult {
  file: string;
  titlePath: string[];
  status: string;
  attempts: { error?: ReportError; secondaryErrors?: ReportError[] }[];
}

const infraPattern = /Daemon request timed out|boot failed|starting an attempt on engine|disposing the engine timed out|device did not answer/i;

export function classify(error: ReportError | undefined, secondary: ReportError[], hungDuringRun: boolean): FailureClass {
  const all = [error, ...secondary].filter((item): item is ReportError => item !== undefined);
  if (all.some((item) => item.message?.includes('APP_HANG'))) return 'APP_HANG';
  if (!error) return 'APP_FAIL';
  if (['APP_UNREACHABLE', 'INSTALL_FAILED'].includes(error.code ?? '')) return 'SETUP';
  const tooling = error.category === 'infrastructure' && (['LAUNCH_TIMEOUT', 'CLEANUP_TIMEOUT'].includes(error.code ?? '') || infraPattern.test(error.message ?? ''));
  if (tooling) return hungDuringRun ? 'APP_HANG' : 'INFRA';
  return 'APP_FAIL';
}
