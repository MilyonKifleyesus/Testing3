import { ProjectRoute } from '../../../models/fluorescence-map.interface';

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
    const hasValidCoords = (coords: unknown): coords is { latitude: number; longitude: number } => {
      if (!coords || typeof coords !== 'object') return false;
      const c = coords as { latitude?: unknown; longitude?: unknown };
      return Number.isFinite(c.latitude) && Number.isFinite(c.longitude);
    };
    const routeReady = hasValidCoords(route?.fromCoordinates) && hasValidCoords(route?.toCoordinates);

    if (!loading && routeReady) {
      const promise = api.captureAndStoreForProject(projectId, projectName);
      promise.catch((error) => {
        if (cancelled) return;
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
