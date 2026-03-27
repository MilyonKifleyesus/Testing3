import type { DashboardWidget } from '../../models/client-dashboard.models';
import { applyResizeDeltaToDom, createResizeSession, getWidgetMinHeight } from './dashboard-interactions.utils';

describe('dashboard-interactions.utils', () => {
  const buildWidget = (overrides: Partial<DashboardWidget> = {}): DashboardWidget => ({
    id: 'widget-1',
    title: 'Widget',
    subtitle: 'Subtitle',
    type: 'chart',
    width: 4,
    height: 400,
    order: 1,
    loading: false,
    ...overrides,
  });

  const buildMouseEvent = (clientX: number, clientY: number): MouseEvent => (
    new MouseEvent('mousedown', { clientX, clientY })
  );

  it('clamps fleet map height to its supported minimum while resizing', () => {
    const widget = buildWidget({ id: 'widget-map', height: 640 });
    const containerEl = document.createElement('div');
    const cardEl = document.createElement('div');
    const session = createResizeSession(widget, 'bottom', buildMouseEvent(0, 0), containerEl, cardEl);

    applyResizeDeltaToDom(session, buildMouseEvent(0, -300));

    expect(session.currentHeight).toBe(520);
    expect(cardEl.style.height).toBe('520px');
  });

  it('keeps the shared minimum height for standard widgets', () => {
    const widget = buildWidget({ height: 320 });
    const containerEl = document.createElement('div');
    const cardEl = document.createElement('div');
    const session = createResizeSession(widget, 'bottom', buildMouseEvent(0, 0), containerEl, cardEl);

    applyResizeDeltaToDom(session, buildMouseEvent(0, -500));

    expect(session.currentHeight).toBe(220);
    expect(cardEl.style.height).toBe('220px');
  });

  it('exposes the rendered minimum height for layout hydration', () => {
    expect(getWidgetMinHeight('widget-map')).toBe(520);
    expect(getWidgetMinHeight('widget-1')).toBe(220);
  });
});
