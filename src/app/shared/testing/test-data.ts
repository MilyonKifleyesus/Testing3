/**
 * Test fixtures loaded from public/assets/data.
 * Single source of truth - no hardcoded duplicate data in specs.
 */
import factoriesData from '../../../../public/assets/data/factories.json';
import clientsData from '../../../../public/assets/data/clients.json';
import type { FactoryOption } from '../services/project.service';

export const FACTORIES_JSON = factoriesData;
export const CLIENTS_JSON = clientsData;

/** First factory from factories.json as FactoryOption (for Add Project modal tests) */
export function getFirstFactoryOption(): FactoryOption {
  const mfr = factoriesData.manufacturers[0];
  const f = factoriesData.factories[0];
  const parts = [f.city, f.country].filter(Boolean);
  const locSuffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  return {
    factoryId: f.factory_id,
    manufacturerId: f.manufacturer_id,
    manufacturerName: mfr.manufacturer_name,
    label: `${mfr.manufacturer_name} - ${f.factory_location_name}${locSuffix}`,
    factory_location_name: f.factory_location_name,
    city: f.city,
    state_province: f.state_province,
    country: f.country,
  };
}

/** First client from clients.json (for Add Project modal tests) */
export function getFirstClient(): { id: string; name: string; code: string } {
  const c = clientsData.clients[0];
  const code = c.clientName
    .replace(/\s*\([^)]*\)/g, '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 4);
  return { id: c.clientId, name: c.clientName, code: code || c.clientId.toUpperCase() };
}
