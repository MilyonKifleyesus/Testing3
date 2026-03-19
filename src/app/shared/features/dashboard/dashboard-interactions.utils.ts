import { DashboardWidget } from '../../models/client-dashboard.models';
import { DashboardResizeHandle } from './dashboard.types';

export interface DashboardResizeSession {
  widgetId: string;
  handle: DashboardResizeHandle;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  currentWidth: number;
  currentHeight: number;
  containerEl: HTMLElement;
  cardEl: HTMLElement;
}

export function createResizeSession(
  widget: DashboardWidget,
  handle: DashboardResizeHandle,
  event: MouseEvent,
  containerEl: HTMLElement,
  cardEl: HTMLElement,
): DashboardResizeSession {
  return {
    widgetId: widget.id,
    handle,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: widget.width,
    startHeight: widget.height,
    currentWidth: widget.width,
    currentHeight: widget.height,
    containerEl,
    cardEl,
  };
}

export function getResizeCursor(handle: DashboardResizeHandle): string {
  if (handle === 'right') return 'ew-resize';
  if (handle === 'bottom') return 'ns-resize';
  return 'nwse-resize';
}

export function applyResizeDeltaToDom(
  session: DashboardResizeSession,
  event: MouseEvent,
  pixelsPerColumn: number = 100,
  minHeight: number = 220,
): void {
  const deltaX = event.clientX - session.startX;
  const deltaY = event.clientY - session.startY;

  if (session.handle === 'corner' || session.handle === 'right') {
    const columnChange = Math.round(deltaX / pixelsPerColumn);
    const newWidth = Math.max(1, Math.min(12, session.startWidth + columnChange));
    if (newWidth !== session.currentWidth) {
      session.currentWidth = newWidth;
      session.containerEl.style.gridColumn = `span ${newWidth}`;
    }
  }

  if (session.handle === 'corner' || session.handle === 'bottom') {
    const newHeight = Math.max(minHeight, session.startHeight + deltaY);
    session.currentHeight = newHeight;
    session.cardEl.style.height = `${newHeight}px`;
  }
}

export function getNextFullscreenWidgetId(
  currentFullscreenWidgetId: string | null,
  nextCandidateWidgetId: string,
): string | null {
  return currentFullscreenWidgetId === nextCandidateWidgetId ? null : nextCandidateWidgetId;
}
