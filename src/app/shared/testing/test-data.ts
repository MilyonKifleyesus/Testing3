import { Client } from '../models/client.model';
import { FactoryOption } from '../services/project.service';

export const CLIENTS_JSON = {
  clients: [
    {
      clientId: '3',
      clientName: 'TTC',
      customerLogo: '',
      customerLogoName: 'ttc-logo.png',
      locations: [],
    },
    {
      clientId: '8',
      clientName: 'Metrolinx',
      customerLogo: '',
      customerLogoName: 'metrolinx-logo.png',
      locations: [],
    },
  ],
};

export const FACTORIES_JSON = {
  manufacturers: [
    {
      manufacturer_id: 1,
      manufacturer_name: 'Nova Bus',
    },
  ],
  factories: [
    {
      factory_id: 101,
      manufacturer_id: 1,
      factory_location_name: 'Toronto Facility',
      city: 'Toronto',
      state_province: 'Ontario',
      country: 'Canada',
    },
  ],
};

export function getFirstClient(): Client {
  return {
    id: '3',
    name: 'TTC',
    code: 'TTC',
  };
}

export function getFirstFactoryOption(): FactoryOption {
  return {
    factoryId: 101,
    manufacturerId: 1,
    manufacturerName: 'Nova Bus',
    label: 'Nova Bus - Toronto Facility (Toronto, Canada)',
    factory_location_name: 'Toronto Facility',
    city: 'Toronto',
    state_province: 'Ontario',
    country: 'Canada',
  };
}
