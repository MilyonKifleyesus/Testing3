import { DashboardWidget } from '../../models/client-dashboard.models';
import { DashboardWidgetLayoutItem } from './dashboard.types';
import { getWidgetMinHeight } from './dashboard-interactions.utils';

export function sortWidgetsByOrder(widgets: DashboardWidget[]): DashboardWidget[] {
  return [...widgets].sort((left, right) => left.order - right.order);
}

export function readWidgetLayout(storageKey: string): DashboardWidgetLayoutItem[] | null {
  const savedLayout = localStorage.getItem(storageKey);
  if (!savedLayout) return null;

  const parsedLayout = JSON.parse(savedLayout) as DashboardWidgetLayoutItem[];
  if (!Array.isArray(parsedLayout)) return null;

  return parsedLayout;
}

export function saveWidgetLayout(storageKey: string, widgets: DashboardWidget[]): void {
  const layoutData: DashboardWidgetLayoutItem[] = widgets.map((widget) => ({
    id: widget.id,
    width: widget.width,
    height: Math.max(widget.height, getWidgetMinHeight(widget.id)),
    order: widget.order,
  }));

  localStorage.setItem(storageKey, JSON.stringify(layoutData));
}

export function applyWidgetLayout(
  widgets: DashboardWidget[],
  layout: DashboardWidgetLayoutItem[],
): DashboardWidget[] {
  return widgets.map((widget) => {
    const saved = layout.find((item) => item.id === widget.id);
    return saved
      ? { ...widget, ...saved, height: Math.max(saved.height, getWidgetMinHeight(widget.id)) }
      : widget;
  });
}

export function applyDefaultWidgetLayout(
  widgets: DashboardWidget[],
  defaults: DashboardWidgetLayoutItem[],
): DashboardWidget[] {
  const fallbackMap = new Map(defaults.map((item) => [item.id, item]));

  return widgets.map((widget) => {
    const fallback = fallbackMap.get(widget.id);
    return fallback
      ? {
          ...widget,
          width: fallback.width,
          height: Math.max(fallback.height, getWidgetMinHeight(widget.id)),
          order: fallback.order,
        }
      : widget;
  });
}
