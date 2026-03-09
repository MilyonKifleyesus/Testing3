import { FluorescenceMapMathService } from './fluorescence-map-map-math.service';

describe('FluorescenceMapMathService', () => {
  let service: FluorescenceMapMathService;

  beforeEach(() => {
    service = new FluorescenceMapMathService();
  });

  describe('parseViewBox', () => {
    it('returns base metrics when viewBox is null/undefined/empty', () => {
      expect(service.parseViewBox(null)).toEqual({ x: 0, y: 0, width: 950, height: 550 });
      expect(service.parseViewBox(undefined)).toEqual({ x: 0, y: 0, width: 950, height: 550 });
      expect(service.parseViewBox('')).toEqual({ x: 0, y: 0, width: 950, height: 550 });
    });

    it('parses whitespace or comma-separated viewBox values', () => {
      expect(service.parseViewBox('1 2 3 4')).toEqual({ x: 1, y: 2, width: 3, height: 4 });
      expect(service.parseViewBox(' 1, 2, 3, 4 ')).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    });

    it('falls back to base metrics for invalid viewBox strings', () => {
      expect(service.parseViewBox('1 2 3')).toEqual({ x: 0, y: 0, width: 950, height: 550 });
      expect(service.parseViewBox('1 2 x 4')).toEqual({ x: 0, y: 0, width: 950, height: 550 });
    });
  });

  describe('getZoomFactor', () => {
    it('returns 1.0 for base viewBox and clamps to [0.1, 10]', () => {
      expect(service.getZoomFactor({ x: 0, y: 0, width: 950, height: 550 })).toBeCloseTo(1, 6);
      expect(service.getZoomFactor({ x: 0, y: 0, width: 95, height: 55 })).toBe(10);
      expect(service.getZoomFactor({ x: 0, y: 0, width: 9500, height: 5500 })).toBe(0.1);
    });

    it('does not throw for zero/negative viewBox dimensions', () => {
      expect(service.getZoomFactor({ x: 0, y: 0, width: 0, height: 0 })).toBe(10);
      expect(service.getZoomFactor({ x: 0, y: 0, width: -100, height: -100 })).toBe(0.1);
    });
  });

  describe('createCurvedPath', () => {
    it('returns an empty string when start or end is missing', () => {
      expect(service.createCurvedPath(null, { x: 1, y: 2 })).toBe('');
      expect(service.createCurvedPath({ x: 1, y: 2 }, null)).toBe('');
    });

    it('creates a quadratic curve path between points', () => {
      const path = service.createCurvedPath({ x: 10, y: 100 }, { x: 30, y: 200 });
      expect(path).toContain('M 10 100 Q 20 50 30 200');
    });

    it('avoids scientific notation in the SVG path output', () => {
      const path = service.createCurvedPath({ x: 1e-12, y: 2e-12 }, { x: 3e-12, y: 4e-12 });
      expect(path).toBeTruthy();
      expect(path).not.toMatch(/[eE]/);
    });
  });

  describe('svgPointToContainerPixels', () => {
    it('returns null when required elements are missing', () => {
      expect(service.svgPointToContainerPixels(null, 10, 10, document.createElement('div'))).toBeNull();
      expect(service.svgPointToContainerPixels(document.createElementNS('http://www.w3.org/2000/svg', 'svg') as any, 10, 10, null)).toBeNull();
    });

    it('uses proportional fallback math when screen CTM is unavailable', () => {
      // Use plain stubs so the browser-only SVG CTM path is skipped deterministically.
      const svg = {
        getAttribute: (name: string) => (name === 'viewBox' ? '0 0 100 100' : null),
      } as unknown as SVGSVGElement;

      const container = {
        getBoundingClientRect: () =>
          ({
            left: 10,
            top: 20,
            right: 210,
            bottom: 120,
            width: 200,
            height: 100,
          }) as DOMRect,
      } as unknown as HTMLElement;

      const pt = service.svgPointToContainerPixels(svg, 50, 25, container);
      expect(pt).toEqual({ x: 100, y: 25 });
    });

    it('uses the provided fallbackViewBox when no viewBox attribute is present', () => {
      // Use plain stubs so the browser-only SVG CTM path is skipped deterministically.
      const svg = {
        getAttribute: () => null,
      } as unknown as SVGSVGElement;

      const container = {
        getBoundingClientRect: () =>
          ({
            left: 0,
            top: 0,
            right: 400,
            bottom: 200,
            width: 400,
            height: 200,
          }) as DOMRect,
      } as unknown as HTMLElement;

      const pt = service.svgPointToContainerPixels(svg, 100, 50, container, { x: 0, y: 0, width: 200, height: 100 });
      expect(pt).toEqual({ x: 200, y: 100 });
    });
  });

  describe('computeTooltipPosition', () => {
    it('clamps horizontally and flips below the anchor when needed', () => {
      const pos = service.computeTooltipPosition(
        { left: 0, top: 20, width: 20, height: 10 },
        { left: 0, right: 100, top: 0, bottom: 100 },
        { width: 40, height: 30 }
      );
      expect(pos).toEqual({ top: 42, left: 20, flipped: true });
    });

    it('clamps tooltip within right/bottom bounds', () => {
      const pos = service.computeTooltipPosition(
        { left: 90, top: 95, width: 20, height: 10 },
        { left: 0, right: 100, top: 0, bottom: 100 },
        { width: 40, height: 20 }
      );
      expect(pos.left).toBe(80);
      expect(pos.top).toBe(80);
    });
  });
});
