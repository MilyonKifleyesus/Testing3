import { ElementRef } from '@angular/core';
import { of } from 'rxjs';

import { DefectWordCloudWidgetComponent } from './defect-word-cloud-widget.component';

describe('DefectWordCloudWidgetComponent', () => {
  let component: DefectWordCloudWidgetComponent;
  let container: HTMLDivElement;
  let dashboardService: {
    getTickets: jasmine.Spy;
    getProjects: jasmine.Spy;
    getVehicles: jasmine.Spy;
    getDefectTypes: jasmine.Spy;
  };
  let dashboardProjectsService: {
    getAllTickets: jasmine.Spy;
  };
  let clientService: {
    getClients: jasmine.Spy;
  };

  const attachMeasuredContainer = (width: number, height: number): HTMLDivElement => {
    const el = document.createElement('div');
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.style.position = 'relative';
    document.body.appendChild(el);

    Object.defineProperty(el, 'clientWidth', {
      configurable: true,
      get: () => width,
    });
    Object.defineProperty(el, 'clientHeight', {
      configurable: true,
      get: () => height,
    });
    el.getBoundingClientRect = () => ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => '',
    } as DOMRect);

    return el;
  };

  beforeEach(() => {
    dashboardService = {
      getTickets: jasmine.createSpy('getTickets').and.returnValue(of([])),
      getProjects: jasmine.createSpy('getProjects').and.returnValue(of([])),
      getVehicles: jasmine.createSpy('getVehicles').and.returnValue(of([])),
      getDefectTypes: jasmine.createSpy('getDefectTypes').and.returnValue(of([])),
    };
    dashboardProjectsService = {
      getAllTickets: jasmine.createSpy('getAllTickets').and.returnValue(of([])),
    };
    clientService = {
      getClients: jasmine.createSpy('getClients').and.returnValue(of([])),
    };

    component = new DefectWordCloudWidgetComponent(
      dashboardService as any,
      clientService as any,
      dashboardProjectsService as any,
    );
    container = attachMeasuredContainer(360, 260);
    component.cloudContainer = new ElementRef(container);
    component.loading = false;
    component.error = null;
  });

  afterEach(() => {
    container.remove();
  });

  it('aggregates cleaned defect terms and excludes active drilldown words', () => {
    component.tickets = [
      {
        id: '1',
        ticketDescription: 'Door panel loose and missing harness',
        projectId: 1,
        vehicleId: 1,
        defectLocationId: 1,
        defectLocationName: 'Interior',
        defectTypeId: 1,
        createdAt: '2026-03-01T12:00:00Z',
      },
      {
        id: '2',
        ticketDescription: 'Door panel loose, panel rubbing near the engine',
        projectId: 1,
        vehicleId: 1,
        defectLocationId: 1,
        defectLocationName: 'Interior',
        defectTypeId: 1,
        createdAt: '2026-03-02T12:00:00Z',
      },
    ];
    component.drilldownPath = ['door'];

    const words = component.processWords();

    expect(words).toContain(jasmine.objectContaining({ text: 'panel', count: 3 }));
    expect(words).toContain(jasmine.objectContaining({ text: 'loose', count: 2 }));
    expect(words.some((word) => word.text === 'door')).toBeFalse();
    expect(words.some((word) => word.text === 'and')).toBeFalse();
  });

  it('reduces the rendered word limit on narrow containers', () => {
    (component as any).dimensions = { width: 359, height: 260 };
    expect((component as any).getResponsiveWordLimit()).toBe(22);

    (component as any).dimensions = { width: 470, height: 260 };
    expect((component as any).getResponsiveWordLimit()).toBe(30);

    (component as any).dimensions = { width: 639, height: 260 };
    expect((component as any).getResponsiveWordLimit()).toBe(40);

    (component as any).dimensions = { width: 900, height: 260 };
    expect((component as any).getResponsiveWordLimit()).toBe(60);
  });

  it('shrinks the font range when the widget width is constrained', () => {
    const words = [
      { text: 'compartment', count: 9 },
      { text: 'harness', count: 7 },
      { text: 'door', count: 6 },
    ];

    (component as any).dimensions = { width: 340, height: 240 };
    const compactRange = (component as any).getResponsiveFontRange(words);

    (component as any).dimensions = { width: 920, height: 420 };
    const wideRange = (component as any).getResponsiveFontRange(words);

    expect(compactRange[0]).toBeLessThan(wideRange[0]);
    expect(compactRange[1]).toBeLessThan(wideRange[1]);
  });

  it('draws a scalable svg that fills the available container width', () => {
    component.draw([
      {
        text: 'door',
        count: 6,
        size: 42,
        x: 0,
        y: 0,
        rotate: 0,
        baseColor: '#ff4d4f',
        hoverColor: '#ff4d4f',
        frequencyLabel: 'Systemic / Recurring Issue',
      },
    ], 360, 260);

    const svg = container.querySelector('svg');
    const word = container.querySelector('text');
    const tooltip = container.querySelector('.wc-tooltip');

    expect(svg?.getAttribute('viewBox')).toBe('0 0 360 260');
    expect(svg?.style.width).toBe('100%');
    expect(svg?.style.height).toBe('100%');
    expect(word?.textContent).toBe('door');
    expect(tooltip).not.toBeNull();
  });

  it('keeps the tooltip inside the measured widget bounds', () => {
    component.tickets = [
      {
        id: '1',
        ticketDescription: 'Door harness loose near right front panel',
        projectId: 1,
        vehicleId: 1,
        defectLocationId: 1,
        defectLocationName: 'Interior',
        defectTypeId: 1,
        createdAt: '2026-03-01T12:00:00Z',
      },
    ];

    component.draw([], 360, 260);
    component.showTooltip(
      { clientX: 352, clientY: 12 },
      {
        text: 'door',
        count: 6,
        baseColor: '#ff4d4f',
        frequencyLabel: 'Systemic / Recurring Issue',
      },
    );

    const tooltip = container.querySelector('.wc-tooltip') as HTMLDivElement;
    // Mock offsetWidth and offsetHeight since JSDOM doesn't compute them
    Object.defineProperty(tooltip, 'offsetWidth', { value: 100 });
    Object.defineProperty(tooltip, 'offsetHeight', { value: 50 });
    const left = parseFloat(tooltip.style.left);
    const top = parseFloat(tooltip.style.top);
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;

    expect(tooltip.style.opacity).toBe('1');
    expect(tooltip.innerHTML).toContain('Sample Tickets');
    expect(left).toBeGreaterThanOrEqual(4);
    expect(top).toBeGreaterThanOrEqual(4);
    expect(left + tooltipWidth).toBeLessThanOrEqual(356);
    expect(top + tooltipHeight).toBeLessThanOrEqual(256);
  });

  it('reuses external project and vehicle options instead of refetching them', () => {
    component.projectOptions = [{ id: '11', name: 'Project 11' }];
    component.vehicleOptions = [{ id: '22', name: 'Vehicle 22' }];

    component.loadData();

    expect(dashboardService.getProjects).not.toHaveBeenCalled();
    expect(dashboardService.getVehicles).not.toHaveBeenCalled();
    expect(component.projects).toEqual([{ id: '11', name: 'Project 11' }]);
    expect(component.vehicles).toEqual([{ id: '22', name: 'Vehicle 22' }]);
  });

  it('loads tickets through the paged dashboard-projects helper so the cloud is not capped to page one', () => {
    component.loadData();

    expect(dashboardProjectsService.getAllTickets).toHaveBeenCalledWith(jasmine.objectContaining({
      maxItems: Number.MAX_SAFE_INTEGER,
      pageSize: 10000,
    }));
    expect(dashboardService.getTickets).not.toHaveBeenCalled();
  });

  it('passes non-numeric scoped ids through unchanged so the service can normalize them', () => {
    component.projectId = 'proj-12';
    component.vehicleId = 'veh-9';

    component.loadData();

    expect(dashboardProjectsService.getAllTickets).toHaveBeenCalledWith(jasmine.objectContaining({
      projectId: 'proj-12',
      vehicleId: 'veh-9',
    }));
  });
});
