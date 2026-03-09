import { Injectable } from '@angular/core';
import { Node as WarRoomNode } from '../../../../../models/fluorescence-map.interface';

@Injectable({ providedIn: 'root' })
export class WarRoomMapAssetsService {
  /**
   * Legacy logo names that are missing in current assets.
   * Keep these aliases until matching files are added to public/assets/images.
   */
  private readonly logoAliases: Record<string, string> = {
    '/assets/images/NFI_Logo.png': '/assets/images/New-Flyer.jpg',
    '/assets/images/TEMSA_Logo_Black.svg': '/assets/images/tam-logo.png',
    '/assets/images/MCI_Logo.png': '/assets/images/svgs/user.svg',
    '/assets/images/Prevost_Logo.png': '/assets/images/svgs/user.svg',
    '/assets/images/FleetZero.png': '/assets/images/svgs/user.svg',
  };
  private readonly invalidLogoTokens = new Set(['string', 'null', 'undefined', '[object object]']);

  getCompanyDisplayName(node: WarRoomNode): string {
    return node.company || node.name || node.city || 'Company';
  }

  getCompanyDescription(node: WarRoomNode): string {
    const customDescription = node.description?.trim();
    if (customDescription) {
      return customDescription;
    }
    const city = (node.city ?? '').trim();
    const country = (node.country ?? '').trim();
    const location =
      city && country ? `${city}, ${country}` : country || city || '';
    const displayName = this.getCompanyDisplayName(node);
    const facilityType = node.facilityType || this.getTypeLabel(node);
    const notes = node.notes ? ` // ${node.notes}` : '';

    if (!location) {
      return displayName ? `${displayName} (${facilityType}) location pending.${notes}` : `Location pending.${notes}`;
    }
    return displayName ? `${displayName} (${facilityType}) located in ${location}.${notes}` : `Located in ${location}.${notes}`;
  }

  getTypeLabel(node: WarRoomNode): string {
    const level = node.level || 'factory';
    if (level === 'parent') return 'Hub / Group HQ';
    if (level === 'manufacturer') return 'Manufacturer / Regional Hub';
    return 'Factory / Production Site';
  }

  getTooltipStatusClass(status?: string | null): string {
    if (!status) return 'status-active';
    const s = String(status).toUpperCase().trim();
    if (s === 'ACTIVE' || s === 'ONLINE') return 'status-active';
    if (s === 'INACTIVE' || s === 'OFFLINE') return 'status-inactive';
    return `status-${s.toLowerCase().replace(/\s+/g, '-')}`;
  }

  getLogoImagePaths(logoSource: string, baseUrl: string): string[] {
    const trimmed = logoSource.trim();
    if (!trimmed) return [];
    if (this.invalidLogoTokens.has(trimmed.toLowerCase())) return [];
    const aliased = this.logoAliases[trimmed] ?? this.logoAliases[`/assets/images/${trimmed}`] ?? trimmed;

    if (aliased.startsWith('data:') || aliased.startsWith('blob:')) {
      return [aliased];
    }

    if (
      aliased.startsWith('http://') ||
      aliased.startsWith('https://') ||
      aliased.startsWith('/') ||
      aliased.startsWith('./') ||
      aliased.startsWith('../')
    ) {
      return [aliased];
    }

    return [
      `${baseUrl}/assets/images/${aliased}`,
      `/assets/images/${aliased}`,
      `./assets/images/${aliased}`,
      `assets/images/${aliased}`,
    ];
  }

  getLogoFallbackPath(): string {
    return '/assets/images/svgs/user.svg';
  }

  private isAllowedLogoPath(path: string, baseUrl: string, allowedOrigins?: string[]): boolean {
    if (!path) return false;
    const normalized = path.trim();
    if (!normalized) return false;

    if (normalized.startsWith('data:') || normalized.startsWith('blob:')) {
      return true;
    }
    if (
      normalized.startsWith('/') ||
      normalized.startsWith('./') ||
      normalized.startsWith('../') ||
      normalized.startsWith('assets/')
    ) {
      return true;
    }
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      return false;
    }

    try {
      const candidate = new URL(normalized, baseUrl);
      const base = new URL(baseUrl);
      if (candidate.origin === base.origin) return true;
      const allowed = new Set((allowedOrigins ?? []).map((origin) => origin.trim()).filter(Boolean));
      return allowed.has(candidate.origin);
    } catch {
      return false;
    }
  }

  getPreferredLogoPath(
    logoSource: string,
    baseUrl: string,
    failures?: Set<string>,
    allowedOrigins?: string[]
  ): string {
    const paths = this.getLogoImagePaths(logoSource, baseUrl);
    const allowedPaths = paths.filter((path) => this.isAllowedLogoPath(path, baseUrl, allowedOrigins));
    const failureSet = failures ?? new Set<string>();
    return allowedPaths.find((path) => !failureSet.has(path)) || this.getLogoFallbackPath();
  }

  getNextLogoPath(
    logoSource: string,
    baseUrl: string,
    currentIndex: number,
    failures?: Set<string>,
    allowedOrigins?: string[]
  ): string {
    const paths = this.getLogoImagePaths(logoSource, baseUrl);
    const allowedPaths = paths.filter((path) => this.isAllowedLogoPath(path, baseUrl, allowedOrigins));
    const failureSet = failures ?? new Set<string>();
    for (let i = currentIndex + 1; i < allowedPaths.length; i += 1) {
      if (!failureSet.has(allowedPaths[i])) {
        return allowedPaths[i];
      }
    }
    return this.getLogoFallbackPath();
  }
}
