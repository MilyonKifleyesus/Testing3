import { DashboardWidget } from '../../models/client-dashboard.models';
import { DashboardResizeHandle } from './dashboard.types';

export interface DashboardResizeSession {
  widgetId: string;
  handle: DashboardResizeHandle;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}

export function createResizeSession(
  widget: DashboardWidget,
  handle: DashboardResizeHandle,
  event: MouseEvent,
): DashboardResizeSession {
  return {
    widgetId: widget.id,
    handle,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: widget.width,
    startHeight: widget.height,
  };
}

export function getResizeCursor(handle: DashboardResizeHandle): string {
  if (handle === 'right') return 'ew-resize';
  if (handle === 'bottom') return 'ns-resize';
  return 'nwse-resize';
}

export function applyResizeDelta(
  widgets: DashboardWidget[],
  session: DashboardResizeSession,
  event: MouseEvent,
  pixelsPerColumn: number = 100,
  minHeight: number = 220,
): boolean {
  const widget = widgets.find((item) => item.id === session.widgetId);
  if (!widget) return false;

  const deltaX = event.clientX - session.startX;
  const deltaY = event.clientY - session.startY;

  if (session.handle === 'corner' || session.handle === 'right') {
    const columnChange = Math.round(deltaX / pixelsPerColumn);
    widget.width = Math.max(1, Math.min(12, session.startWidth + columnChange));
  }

  if (session.handle === 'corner' || session.handle === 'bottom') {
    widget.height = Math.max(minHeight, session.startHeight + deltaY);
  }

  return true;
}

export function getNextFullscreenWidgetId(
  currentFullscreenWidgetId: string | null,
  nextCandidateWidgetId: string,
): string | null {
  return currentFullscreenWidgetId === nextCandidateWidgetId ? null : nextCandidateWidgetId;
}
