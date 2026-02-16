import { Injectable, signal } from '@angular/core';

const STORAGE_PREFIX = 'route-preview-';
const MAX_DATA_URL_BYTES = 900_000; // ~900KB to stay under localStorage ~5MB limit

/**
 * Stores and retrieves route preview images (base64 data URLs) per project.
 * Uses in-memory cache with optional localStorage persistence.
 * Call previewSaved.update(n => n + 1) when storing to trigger UI refresh.
 */
@Injectable({ providedIn: 'root' })
export class RoutePreviewStorageService {
  private readonly memory = new Map<string, string>();

  /** Increment when a preview is saved; panels use this to re-read and refresh thumbnails */
  readonly previewSaved = signal(0);

  get(projectId: string): string | null {
    const key = STORAGE_PREFIX + projectId;
    const fromMemory = this.memory.get(key);
    if (fromMemory) return fromMemory;
    try {
      const fromStorage = localStorage.getItem(key);
      if (fromStorage) {
        this.memory.set(key, fromStorage);
        return fromStorage;
      }
    } catch {
      // localStorage full or disabled
    }
    return null;
  }

  set(projectId: string, dataUrl: string): void {
    const key = STORAGE_PREFIX + projectId;
    this.memory.set(key, dataUrl);
    try {
      if (dataUrl.length < MAX_DATA_URL_BYTES) {
        localStorage.setItem(key, dataUrl);
      }
    } catch {
      // localStorage full; keep in memory only
    }
    this.previewSaved.update((n) => n + 1);
  }

  /** Triggers a download of the route preview image for the given project. */
  download(projectId: string, filename?: string): boolean {
    const dataUrl = this.get(projectId);
    if (!dataUrl) return false;
    const name = filename || `route-preview-${projectId}`;
    const safeName = name.replace(/[^a-zA-Z0-9-_]/g, '-') + '.png';
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = safeName;
    a.click();
    return true;
  }
}
