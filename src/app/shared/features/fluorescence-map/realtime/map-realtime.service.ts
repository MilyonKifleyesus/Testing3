import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../shared/services/auth.service';
import {
  MapChangeEvent,
  RealtimeConnectionState,
  normalizeMapChangeEvent,
} from './map-realtime.types';

type RealtimeEnvironmentConfig = typeof environment & {
  apiBaseUrl?: string;
  mapHubUrl?: string;
  mapRealtimeEnabled?: boolean;
};

interface HubConnectionLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  on(eventName: string, callback: (payload: unknown) => void): void;
  onreconnecting(callback: () => void): void;
  onreconnected(callback: () => void): void;
  onclose(callback: () => void): void;
}

@Injectable({ providedIn: 'root' })
export class MapRealtimeService implements OnDestroy {
  private readonly envConfig = environment as RealtimeEnvironmentConfig;
  private hub: HubConnectionLike | null = null;
  private destroyed = false;
  private connectingPromise: Promise<void> | null = null;

  private readonly stateSubject = new BehaviorSubject<RealtimeConnectionState>('disconnected');
  readonly state$ = this.stateSubject.asObservable();

  private readonly changesSubject = new Subject<MapChangeEvent>();
  readonly changes$ = this.changesSubject.asObservable();

  constructor(private readonly authService: AuthService) {}

  async connect(): Promise<void> {
    if (this.destroyed || this.hub) return;
    if (this.connectingPromise) {
      await this.connectingPromise;
      return;
    }
    if (this.envConfig.mapRealtimeEnabled === false) {
      this.stateSubject.next('disconnected');
      return;
    }

    this.connectingPromise = (async () => {
      this.stateSubject.next('connecting');
      let hub: HubConnectionLike;
      try {
        const signalR = await this.loadSignalR();
        hub = this.createHubConnection(signalR);
      } catch (error) {
        this.stateSubject.next('disconnected');
        throw error;
      }

      this.registerHubHandlers(hub);

      try {
        await hub.start();
        if (this.destroyed) {
          await hub.stop();
          this.stateSubject.next('disconnected');
          return;
        }
        this.hub = hub;
        this.stateSubject.next('connected');
      } catch (error) {
        this.hub = null;
        this.stateSubject.next('disconnected');
        throw error;
      }
    })();

    try {
      await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  async disconnect(): Promise<void> {
    const hub = this.hub;
    this.hub = null;
    if (!hub) {
      this.stateSubject.next('disconnected');
      return;
    }

    try {
      await hub.stop();
    } finally {
      this.stateSubject.next('disconnected');
    }
  }

  async ngOnDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.connectingPromise) {
      try {
        await this.connectingPromise;
      } catch {
        // Swallow errors during teardown.
      }
    }
    await this.disconnect();
    this.changesSubject.complete();
    this.stateSubject.complete();
  }

  // Lazy-load SignalR through the bundler so browser runtime can resolve the module.
  // If loading fails, caller falls back to polling mode.
  private async loadSignalR(): Promise<any> {
    return import('@microsoft/signalr');
  }

  private createHubConnection(signalR: any): HubConnectionLike {
    return new signalR.HubConnectionBuilder()
      .withUrl(this.resolveHubUrl(), {
        accessTokenFactory: () => this.authService.accessToken ?? undefined,
      })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .configureLogging(signalR.LogLevel.Warning)
      .build();
  }

  private resolveHubUrl(): string {
    const configured = this.envConfig.mapHubUrl?.trim();
    if (configured) return configured;

    const apiBaseUrl = this.envConfig.apiBaseUrl?.trim();
    if (apiBaseUrl) {
      return `${apiBaseUrl.replace(/\/+$/, '')}/hubs/map`;
    }
    return '/api/hubs/map';
  }

  private registerHubHandlers(hub: HubConnectionLike): void {
    hub.onreconnecting(() => this.stateSubject.next('reconnecting'));
    hub.onreconnected(() => this.stateSubject.next('connected'));
    hub.onclose(() => {
      this.hub = null;
      this.stateSubject.next('disconnected');
    });

    hub.on('MapChanged', (raw: unknown) => {
      const normalized = normalizeMapChangeEvent(raw);
      if (!normalized) return;
      this.changesSubject.next(normalized);
    });
  }
}
