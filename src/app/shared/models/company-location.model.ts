/**
 * Company and Location models for spreadsheet import and address management
 */
export interface Company {
  id: string;
  name: string;
  logoUrl?: string;
  description?: string;
}

export interface Location {
  id: string;
  companyId: string;
  fullStreetAddress: string;
  city: string;
  provinceState?: string;
  postalCode?: string;
  country?: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  /** Link to War Room FactoryLocation when applicable */
  manufacturerLocationId?: string;
}
