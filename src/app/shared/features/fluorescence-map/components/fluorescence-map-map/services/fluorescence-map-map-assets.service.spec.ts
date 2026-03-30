import { WarRoomMapAssetsService } from './fluorescence-map-map-assets.service';
import { Node } from '../../../../../models/fluorescence-map.interface';

describe('WarRoomMapAssetsService', () => {
  let service: WarRoomMapAssetsService;

  const baseNode = (overrides: Partial<Node> = {}): Node =>
    ({
      id: 'node-1',
      name: 'Node Name',
      company: 'Node Company',
      companyId: 'node-1',
      city: 'Toronto',
      country: 'Canada',
      coordinates: { latitude: 43.65, longitude: -79.38 },
      type: 'Facility',
      status: 'ACTIVE',
      ...overrides,
    }) as Node;

  beforeEach(() => {
    service = new WarRoomMapAssetsService();
  });

  describe('getCompanyDisplayName', () => {
    it('prefers company then name then city then default', () => {
      expect(service.getCompanyDisplayName(baseNode({ company: 'Acme' }))).toBe('Acme');
      expect(service.getCompanyDisplayName(baseNode({ company: '', name: 'Fallback Name' }))).toBe('Fallback Name');
      expect(service.getCompanyDisplayName(baseNode({ company: '', name: '', city: 'Fallback City' }))).toBe('Fallback City');
      expect(service.getCompanyDisplayName(baseNode({ company: '', name: '', city: '' }))).toBe('Company');
    });
  });

  describe('getCompanyDescription', () => {
    it('returns a trimmed custom description when provided', () => {
      expect(service.getCompanyDescription(baseNode({ description: '  Custom desc  ' }))).toBe('Custom desc');
    });

    it('builds a description using facility type, location, and notes', () => {
      const desc = service.getCompanyDescription(
        baseNode({
          company: 'Acme',
          facilityType: 'Depot',
          city: 'Austin',
          country: 'USA',
          notes: 'Important',
          description: undefined,
        })
      );
      expect(desc).toContain('Acme (Depot) located in Austin, USA.');
      expect(desc).toContain('// Important');
    });

    it('falls back to a pending-location message when city/country are missing', () => {
      const desc = service.getCompanyDescription(
        baseNode({
          company: '',
          name: '',
          city: '',
          country: '',
          level: 'parent',
          description: undefined,
        })
      );
      expect(desc).toContain('Hub / Group HQ');
      expect(desc).toContain('location pending');
    });
  });

  describe('getTypeLabel', () => {
    it('maps known hierarchy levels to labels', () => {
      expect(service.getTypeLabel(baseNode({ level: 'parent' }))).toBe('Hub / Group HQ');
      expect(service.getTypeLabel(baseNode({ level: 'manufacturer' }))).toBe('Manufacturer / Regional Hub');
      expect(service.getTypeLabel(baseNode({ level: 'factory' }))).toBe('Factory / Production Site');
    });
  });

  describe('getTooltipStatusClass', () => {
    it('defaults to active when status is missing', () => {
      expect(service.getTooltipStatusClass(null)).toBe('status-active');
      expect(service.getTooltipStatusClass(undefined)).toBe('status-active');
      expect(service.getTooltipStatusClass('')).toBe('status-active');
    });

    it('maps known statuses and normalizes unknown values', () => {
      expect(service.getTooltipStatusClass('ACTIVE')).toBe('status-active');
      expect(service.getTooltipStatusClass('online')).toBe('status-active');
      expect(service.getTooltipStatusClass('INACTIVE')).toBe('status-inactive');
      expect(service.getTooltipStatusClass('OffLine')).toBe('status-inactive');
      expect(service.getTooltipStatusClass('In Repair')).toBe('status-in-repair');
    });
  });

  describe('logo path helpers', () => {
    it('returns an empty list for invalid logo tokens', () => {
      expect(service.getLogoImagePaths('  ', 'http://base')).toEqual([]);
      expect(service.getLogoImagePaths('null', 'http://base')).toEqual([]);
      expect(service.getLogoImagePaths('[object Object]', 'http://base')).toEqual([]);
    });

    it('applies legacy aliases when the logo matches an alias key', () => {
      expect(service.getLogoImagePaths('NFI_Logo.png', 'http://base')).toEqual(['/assets/images/New-Flyer.jpg']);
    });

    it('returns a single absolute/relative path when already qualified', () => {
      expect(service.getLogoImagePaths('https://example.com/logo.png', 'http://base')).toEqual(['https://example.com/logo.png']);
      expect(service.getLogoImagePaths('/assets/images/logo.png', 'http://base')).toEqual(['/assets/images/logo.png']);
      expect(service.getLogoImagePaths('../assets/images/logo.png', 'http://base')).toEqual(['../assets/images/logo.png']);
      expect(service.getLogoImagePaths('data:image/png;base64,abc', 'http://base')).toEqual(['data:image/png;base64,abc']);
    });

    it('builds fallback search paths for unqualified names', () => {
      const paths = service.getLogoImagePaths('my-logo.png', 'http://base');
      expect(paths).toEqual([
        'http://base/assets/images/my-logo.png',
        '/assets/images/my-logo.png',
        './assets/images/my-logo.png',
        'assets/images/my-logo.png',
      ]);
    });

    it('picks the first non-failed logo path and falls back when all fail', () => {
      const failures = new Set<string>(['http://base/assets/images/my-logo.png', '/assets/images/my-logo.png']);
      expect(service.getPreferredLogoPath('my-logo.png', 'http://base', failures)).toBe('./assets/images/my-logo.png');

      const all = new Set<string>([
        'http://base/assets/images/my-logo.png',
        '/assets/images/my-logo.png',
        './assets/images/my-logo.png',
        'assets/images/my-logo.png',
      ]);
      expect(service.getPreferredLogoPath('my-logo.png', 'http://base', all)).toBe('/assets/images/svgs/user.svg');
    });

    it('blocks external remote logos unless origin is explicitly allowed', () => {
      expect(service.getPreferredLogoPath('https://evil.example/logo.png', 'https://app.example')).toBe('/assets/images/svgs/user.svg');
      expect(
        service.getPreferredLogoPath(
          'https://cdn.example/logo.png',
          'https://app.example',
          undefined,
          ['https://cdn.example']
        )
      ).toBe('https://cdn.example/logo.png');
    });

    it('advances to the next non-failed logo path', () => {
      const failures = new Set<string>(['/assets/images/my-logo.png']);
      expect(service.getNextLogoPath('my-logo.png', 'http://base', 0, failures)).toBe('./assets/images/my-logo.png');
    });
  });
});
