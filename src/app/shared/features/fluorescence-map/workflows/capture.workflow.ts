import { ProjectRoute } from '../../../../shared/models/fluorescence-map.interface';

export interface CaptureWorkflowApi {
  captureAndStoreForProject(projectId: string, projectName?: string): Promise<void>;
  projectRoutesLoading(): boolean;
  projectRoutes(): ProjectRoute[];
}

export const waitForRouteThenCapture = (
  api: CaptureWorkflowApi,
  projectId: string,
  projectName: string | undefined,
  initialDelayMs: number,
  pollIntervalMs: number,
  maxAttempts: number,
  onExhausted: () => void,
  onCaptureError?: (error: unknown) => void
): (() => void) => {
  let attempts = 0;
  let cancelled = false;
  const timerIds = new Set<ReturnType<typeof setTimeout>>();
  const schedule = (fn: () => void, delayMs: number): void => {
    const timerId = setTimeout(() => {
      timerIds.delete(timerId);
      fn();
    }, delayMs);
    timerIds.add(timerId);
  };

  const tryCapture = (): void => {
    if (cancelled) return;
    attempts++;
    const loading = api.projectRoutesLoading();
    const routes = api.projectRoutes();
    const route = routes.find((r) => r.projectId === projectId);
    const routeReady = route?.fromCoordinates && route?.toCoordinates;

    if (!loading && routeReady) {
      api.captureAndStoreForProject(projectId, projectName).catch((error) => {
        console.error('captureAndStoreForProject failed:', error);
        onCaptureError?.(error);
      });
      return;
    }
    if (attempts >= maxAttempts) {
      if (!cancelled) {
        onExhausted();
      }
      return;
    }
    schedule(tryCapture, pollIntervalMs);
  };
  schedule(tryCapture, initialDelayMs);

  return () => {
    cancelled = true;
    timerIds.forEach((timerId) => clearTimeout(timerId));
    timerIds.clear();
  };
};
