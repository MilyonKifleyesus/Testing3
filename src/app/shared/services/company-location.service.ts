import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, delay, map, throwError } from 'rxjs';
import { Company, Location } from '../models/company-location.model';

interface ClientJsonLocation {
  address: string;
}

interface ClientJsonItem {
  clientId: string;
  clientName: string;
  locations?: ClientJsonLocation[];
}

interface ClientsJsonResponse {
  clients?: ClientJsonItem[];
}

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

function buildFromClients(rows: ClientJsonItem[]): { companies: Company[]; locations: Location[] } {
  const companies: Company[] = [];
  const locations: Location[] = [];
  const companyById = new Map<string, Company>();

  for (const row of rows) {
    const companyId = row.clientId?.trim() ? slugify(row.clientId) : slugify(row.clientName);
    let company = companyById.get(companyId);
    if (!company) {
      company = { id: companyId, name: row.clientName };
      companies.push(company);
      companyById.set(companyId, company);
    }

    for (const [index, loc] of (row.locations ?? []).entries()) {
      const fullStreetAddress = loc.address?.trim();
      if (!fullStreetAddress) continue;

      const { city, provinceState, country } = parseAddress(fullStreetAddress);
      const locationId = `${companyId}-${slugify(city || fullStreetAddress)}-${index}`;
      locations.push({
        id: locationId,
        companyId: company.id,
        fullStreetAddress,
        city,
        provinceState,
        country,
      });
    }
  }
  return { companies, locations };
}

@Injectable({
  providedIn: 'root',
})
export class CompanyLocationService {
  private readonly CLIENTS_JSON_PATH = 'assets/data/clients.json';

  private companies$ = new BehaviorSubject<Company[]>([]);
  private locations$ = new BehaviorSubject<Location[]>([]);

  constructor(private http: HttpClient) {
    this.loadCompaniesFromClientsJson();
  }

  private loadCompaniesFromClientsJson(): void {
    this.http
      .get<ClientsJsonResponse>(this.CLIENTS_JSON_PATH)
      .subscribe({
        next: (response) => {
          const { companies, locations } = buildFromClients(response?.clients ?? []);
          this.companies$.next(companies);
          this.locations$.next(locations);
        },
        error: () => {
          this.companies$.next([]);
          this.locations$.next([]);
        },
      });
  }

  getCompanies(): Observable<Company[]> {
    return this.companies$.asObservable().pipe(delay(100));
  }

  getLocations(companyId?: string): Observable<Location[]> {
    return this.locations$.asObservable().pipe(
      map((locations) =>
        companyId ? locations.filter((l) => l.companyId === companyId) : locations
      ),
      delay(100)
    );
  }

  addCompany(company: Omit<Company, 'id'>): Observable<Company> {
    const baseId = slugify(company.name);
    let id = baseId;
    let suffix = 1;
    const existingIds = new Set(this.companies$.value.map((c) => c.id));
    while (existingIds.has(id)) {
      id = `${baseId}-${suffix++}`;
    }
    const newCompany: Company = { ...company, id };
    this.companies$.next([...this.companies$.value, newCompany]);
    return of(newCompany).pipe(delay(100));
  }

  addLocation(location: Omit<Location, 'id'>): Observable<Location> {
    const companyExists = this.companies$.value.some((company) => company.id === location.companyId);
    if (!companyExists) {
      return throwError(() => new Error(`Company ${location.companyId} does not exist`));
    }
    const city = location.city?.trim();
    if (!city) {
      return throwError(() => new Error('Location city is required'));
    }
    const baseId = `${location.companyId}-${slugify(city)}`;
    let id = baseId;
    let suffix = 1;
    const existingIds = new Set(this.locations$.value.map((l) => l.id));
    while (existingIds.has(id)) {
      id = `${baseId}-${suffix++}`;
    }
    const newLocation: Location = { ...location, id };
    this.locations$.next([...this.locations$.value, newLocation]);
    return of(newLocation).pipe(delay(100));
  }
}
