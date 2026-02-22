import { Injectable } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { RoutePreviewStorageService } from '../../../../shared/services/route-preview-storage.service';
import { ProjectRoute } from '../../../../shared/models/fluorescence-map.interface';
import {
  CAPTURE_WAIT_MS,
  CLIENT_CAPTURE_DELAY_MS,
  ROUTE_PREVIEW_DELAY_MS,
} from '../fluorescence-map.constants';

export interface CaptureWorkflowContext {
  projectRoutes(): ProjectRoute[];
  selectedEntity(): { level?: string; id?: string } | null;
  clientsSignal(): { id: string; name: string }[];
  setScreenshotMode(value: boolean): void;
  setSelectedProjectId(value: string | null): void;
  mapCaptureRoutesScreenshot(routes: ProjectRoute[]): Promise<Blob>;
  mapCaptureRouteScreenshot(route: ProjectRoute): Promise<Blob>;
  refreshRoutePreviewVersion(): void;
}

@Injectable({ providedIn: 'root' })
export class CaptureWorkflowService {
  constructor(
    private readonly toastr: ToastrService,
    private readonly routePreviewStorage: RoutePreviewStorageService
  ) {}

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async captureClientScreenshot(ctx: CaptureWorkflowContext, clientId: string): Promise<string | null> {
    const routes = ctx.projectRoutes().filter((r) => r.fromNodeId === clientId);
    if (!routes.length) {
      this.toastr.warning('No routes available for this client.', 'Cannot capture');
      return null;
    }
    ctx.setScreenshotMode(true);
    try {
      await new Promise((r) => setTimeout(r, CAPTURE_WAIT_MS));
      const blob = await ctx.mapCaptureRoutesScreenshot(routes);
      return await this.blobToDataUrl(blob);
    } catch {
      this.toastr.error('Failed to capture client projects.', 'Error');
      return null;
    } finally {
      ctx.setScreenshotMode(false);
    }
  }

  async captureRouteScreenshotForProject(ctx: CaptureWorkflowContext, projectId: string): Promise<string | null> {
    const routes = ctx.projectRoutes();
    const route = routes.find((r) => r.projectId === projectId);
    if (!route?.fromCoordinates || !route?.toCoordinates) {
      return null;
    }
    ctx.setSelectedProjectId(projectId);
    ctx.setScreenshotMode(true);
    try {
      await new Promise((r) => setTimeout(r, CAPTURE_WAIT_MS));
      const blob = await ctx.mapCaptureRouteScreenshot(route);
      return await this.blobToDataUrl(blob);
    } catch {
      this.toastr.error('Failed to capture route.', 'Error');
      return null;
    } finally {
      ctx.setScreenshotMode(false);
    }
  }

  async captureAndStoreForProject(ctx: CaptureWorkflowContext, projectId: string, projectName?: string): Promise<void> {
    const dataUrl = await this.captureRouteScreenshotForProject(ctx, projectId);
    if (dataUrl) {
      this.routePreviewStorage.set(projectId, dataUrl);
      ctx.refreshRoutePreviewVersion();
      this.routePreviewStorage.download(projectId, projectName);
      this.toastr.success('Route preview saved and downloaded.', 'CAPTURED');
    } else {
      this.showCaptureFailureToastWithRetry(() => this.waitForRouteThenCapture(ctx, projectId, projectName, 500, 400, 6));
    }
  }

  waitForRouteCapture(
    ctx: CaptureWorkflowContext,
    projectId: string,
    projectName: string | undefined,
    initialDelayMs: number,
    pollIntervalMs: number,
    maxAttempts: number
  ): void {
    this.waitForRouteThenCapture(ctx, projectId, projectName, initialDelayMs, pollIntervalMs, maxAttempts);
  }

  private showCaptureFailureToastWithRetry(onRetry: () => void): void {
    const toast = this.toastr.warning(
      'No route available to capture. Tap to retry.',
      'Cannot capture',
      { timeOut: 8000, closeButton: true, extendedTimeOut: 3000 }
    );
    if (toast?.onTap) {
      toast.onTap.subscribe(() => onRetry());
    }
  }

  private waitForRouteThenCapture(
    ctx: CaptureWorkflowContext,
    projectId: string,
    projectName: string | undefined,
    initialDelayMs: number,
    pollIntervalMs: number,
    maxAttempts: number
  ): void {
    let attempts = 0;
    const tryCapture = (): void => {
      attempts++;
      const routes = ctx.projectRoutes();
      const route = routes.find((r) => r.projectId === projectId);
      const routeReady = route?.fromCoordinates && route?.toCoordinates;

      if (routeReady) {
        void this.captureAndStoreForProject(ctx, projectId, projectName);
        return;
      }
      if (attempts >= maxAttempts) {
        this.showCaptureFailureToastWithRetry(() =>
          this.waitForRouteThenCapture(ctx, projectId, projectName, 500, 400, 6)
        );
        return;
      }
      setTimeout(tryCapture, pollIntervalMs);
    };
    setTimeout(tryCapture, initialDelayMs);
  }

  async captureAndStoreForClient(ctx: CaptureWorkflowContext, clientId: string): Promise<void> {
    const dataUrl = await this.captureClientScreenshot(ctx, clientId);
    if (dataUrl) {
      const storageKey = `client-${clientId}`;
      this.routePreviewStorage.set(storageKey, dataUrl);
      ctx.refreshRoutePreviewVersion();
      const clientName = ctx.clientsSignal().find((c) => c.id === clientId)?.name ?? clientId;
      this.routePreviewStorage.download(storageKey, `${clientName}-all-projects`);
      this.toastr.success('All client projects captured and downloaded.', 'CAPTURED');
    }
  }

  onRoutePreviewRequested(ctx: CaptureWorkflowContext, projectId: string, projectName?: string): void {
    setTimeout(() => this.captureAndStoreForProject(ctx, projectId, projectName), ROUTE_PREVIEW_DELAY_MS);
  }

  onClientCaptureRequested(ctx: CaptureWorkflowContext, clientId: string): void {
    setTimeout(() => this.captureAndStoreForClient(ctx, clientId), CLIENT_CAPTURE_DELAY_MS);
  }
}
