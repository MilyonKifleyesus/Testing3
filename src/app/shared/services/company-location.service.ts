import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of, delay } from 'rxjs';
import { Company, Location } from '../models/company-location.model';
import { COMPANY_ADDRESSES_SEED } from '../data/company-addresses-seed';

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const parseAddress = (full: string): { city: string; provinceState?: string; country?: string } => {
  const parts = full.split(',').map((p) => p.trim());
  const city = parts[0] || '';
  const provinceState = parts.length >= 2 ? parts[1] : undefined;
  const country = parts.length >= 3 ? parts[parts.length - 1] : undefined;
  return { city, provinceState, country };
};

function buildFromSeed(): { companies: Company[]; locations: Location[] } {
  const companies: Company[] = [];
  const locations: Location[] = [];
  const companyByName = new Map<string, Company>();

  for (const row of COMPANY_ADDRESSES_SEED) {
    const companyId = slugify(row.companyName);
    let company = companyByName.get(companyId);
    if (!company) {
      company = { id: companyId, name: row.companyName };
      companies.push(company);
      companyByName.set(companyId, company);
    }
    const { city, provinceState, country } = parseAddress(row.fullStreetAddress);
    const locationId = `${companyId}-${slugify(city)}`;
    locations.push({
      id: locationId,
      companyId: company.id,
      fullStreetAddress: row.fullStreetAddress,
      city,
      provinceState,
      country,
    });
  }
  return { companies, locations };
}

const { companies: SEED_COMPANIES, locations: SEED_LOCATIONS } = buildFromSeed();

@Injectable({
  providedIn: 'root',
})
export class CompanyLocationService {
  private companies$ = new BehaviorSubject<Company[]>(SEED_COMPANIES);
  private locations$ = new BehaviorSubject<Location[]>(SEED_LOCATIONS);

  getCompanies(): Observable<Company[]> {
    return this.companies$.asObservable().pipe(delay(100));
  }

  getLocations(companyId?: string): Observable<Location[]> {
    return of(
      companyId
        ? this.locations$.value.filter((l) => l.companyId === companyId)
        : this.locations$.value
    ).pipe(delay(100));
  }

  addCompany(company: Omit<Company, 'id'>): Observable<Company> {
    const id = slugify(company.name);
    const newCompany: Company = { ...company, id };
    this.companies$.next([...this.companies$.value, newCompany]);
    return of(newCompany).pipe(delay(100));
  }

  addLocation(location: Omit<Location, 'id'>): Observable<Location> {
    const id = `${location.companyId}-${slugify(location.city)}`;
    const newLocation: Location = { ...location, id };
    this.locations$.next([...this.locations$.value, newLocation]);
    return of(newLocation).pipe(delay(100));
  }
}
