import { FactoryOption, ManufacturerLocationOption } from '../services/project.service';

/** Sample clients JSON for HTTP mock flush */
export const CLIENTS_JSON = {
  clients: [
    {
      clientId: 'yrt',
      clientName: 'York Region Transit',
      latitude: 43.8828,
      longitude: -79.4403,
      locations: [
        {
          locationName: 'Head Office',
          address: '55 Orlando Avenue, Richmond Hill, ON L4B 0B4',
          type: 'main',
        },
      ],
    },
    {
      clientId: 'ttc',
      clientName: 'Toronto Transit Commission (TTC)',
      latitude: 43.6532,
      longitude: -79.3832,
      locations: [
        {
          locationName: 'Head Office',
          address: '1900 Yonge Street, Toronto, ON M4S 1Z2',
          type: 'main',
        },
      ],
    },
  ],
};

/** Sample factories JSON for HTTP mock flush */
export const FACTORIES_JSON = {
  manufacturers: [
    { manufacturer_id: 1, manufacturer_name: 'Nova' },
    { manufacturer_id: 2, manufacturer_name: 'New Flyer' },
  ],
  factories: [
    {
      factory_id: 1,
      manufacturer_id: 1,
      factory_location_name: 'St. Eustache (Nova)',
      city: 'St. Eustache',
      state_province: 'Quebec',
      country: 'Canada',
    },
    {
      factory_id: 2,
      manufacturer_id: 2,
      factory_location_name: 'Crookston (New Flyer)',
      city: 'Crookston',
      state_province: 'Minnesota',
      country: 'USA',
    },
  ],
};

/** First client from CLIENTS_JSON for form setup */
export function getFirstClient(): { id: string; name: string; code: string } {
  const c = CLIENTS_JSON.clients[0];
  const id = String(c.clientId);
  const name = c.clientName ?? id;
  const fromName = name
    .replace(/\s*\([^)]*\)/g, '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 4);
  const code = fromName || id.toUpperCase();
  return { id, name, code };
}

/** First factory option for form setup (matches FactoryOption shape) */
export function getFirstFactoryOption(): FactoryOption {
  const f = FACTORIES_JSON.factories[0];
  const mfr = FACTORIES_JSON.manufacturers.find((m) => m.manufacturer_id === f.manufacturer_id);
  const mfrName = mfr?.manufacturer_name ?? 'Unknown';
  const parts = [f.city, f.country].filter(Boolean);
  const locSuffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  const label = `${mfrName} - ${f.factory_location_name}${locSuffix}`;
  return {
    manufacturerLocationId: f.factory_id,
    factoryId: f.factory_id,
    manufacturerId: f.manufacturer_id,
    manufacturerName: mfrName,
    label,
    factory_location_name: f.factory_location_name,
    city: f.city,
    state_province: f.state_province,
    country: f.country,
  };
}

export function getFirstManufacturerLocationOption(): ManufacturerLocationOption {
  return getFirstFactoryOption();
}
