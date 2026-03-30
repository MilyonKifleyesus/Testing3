import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../../../shared/services/auth.service';
import { MapRealtimeService } from './map-realtime.service';
import { RealtimeConnectionState } from './map-realtime.types';

class FakeHubConnection {
  private eventHandlers = new Map<string, Array<(payload: unknown) => void>>();
  private reconnectingHandler: (() => void) | null = null;
  private reconnectedHandler: (() => void) | null = null;
  private closeHandler: (() => void) | null = null;

  readonly start = jasmine.createSpy('start').and.returnValue(Promise.resolve());
  readonly stop = jasmine.createSpy('stop').and.returnValue(Promise.resolve());

  on(eventName: string, callback: (payload: unknown) => void): void {
    const handlers = this.eventHandlers.get(eventName) ?? [];
    handlers.push(callback);
    this.eventHandlers.set(eventName, handlers);
  }

  onreconnecting(callback: () => void): void {
    this.reconnectingHandler = callback;
  }

  onreconnected(callback: () => void): void {
    this.reconnectedHandler = callback;
  }

  onclose(callback: () => void): void {
    this.closeHandler = callback;
  }

  emit(eventName: string, payload: unknown): void {
    const handlers = this.eventHandlers.get(eventName) ?? [];
    handlers.forEach((handler) => handler(payload));
  }

  triggerReconnecting(): void {
    this.reconnectingHandler?.();
  }

  triggerReconnected(): void {
    this.reconnectedHandler?.();
  }

  triggerClose(): void {
    this.closeHandler?.();
  }
}

describe('MapRealtimeService', () => {
  let service: MapRealtimeService;
  let fakeHub: FakeHubConnection;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MapRealtimeService,
        { provide: AuthService, useValue: { accessToken: 'test-token' } },
      ],
    });

    service = TestBed.inject(MapRealtimeService);
    (service as any).envConfig.mapRealtimeEnabled = true;
    fakeHub = new FakeHubConnection();
    spyOn<any>(service, 'loadSignalR').and.returnValue(Promise.resolve({}));
    spyOn<any>(service, 'createHubConnection').and.returnValue(fakeHub as any);
  });

  it('connect success sets connected', async () => {
    const states: RealtimeConnectionState[] = [];
    const sub = service.state$.subscribe((state) => states.push(state));

    await service.connect();

    expect(fakeHub.start).toHaveBeenCalled();
    expect(states).toContain('connecting');
    expect(states[states.length - 1]).toBe('connected');
    sub.unsubscribe();
  });

  it('reconnect transitions set reconnecting then connected', async () => {
    const states: RealtimeConnectionState[] = [];
    const sub = service.state$.subscribe((state) => states.push(state));
    await service.connect();

    fakeHub.triggerReconnecting();
    fakeHub.triggerReconnected();

    expect(states).toContain('reconnecting');
    expect(states[states.length - 1]).toBe('connected');
    sub.unsubscribe();
  });

  it('onclose transitions to disconnected', async () => {
    const states: RealtimeConnectionState[] = [];
    const sub = service.state$.subscribe((state) => states.push(state));
    await service.connect();

    fakeHub.triggerClose();

    expect(states[states.length - 1]).toBe('disconnected');
    sub.unsubscribe();
  });

  it('incoming MapChanged emits normalized event', async () => {
    let lastEvent: any = null;
    const sub = service.changes$.subscribe((event) => (lastEvent = event));

    await service.connect();
    const expectedTimestamp = new Date('2026-01-01T00:00:00Z').toISOString();
    fakeHub.emit('MapChanged', {
      Entity: 'Project',
      Action: 'Updated',
      Id: 123,
      Payload: { projectName: 'Route Test' },
      TimestampUtc: '2026-01-01T00:00:00Z',
    });

    expect(lastEvent).toEqual({
      entity: 'Project',
      action: 'Updated',
      id: '123',
      payload: { projectName: 'Route Test' },
      timestampUtc: expectedTimestamp,
    });
    sub.unsubscribe();
  });

  it('disconnect sets disconnected', async () => {
    const states: RealtimeConnectionState[] = [];
    const sub = service.state$.subscribe((state) => states.push(state));

    await service.connect();
    await service.disconnect();

    expect(fakeHub.stop).toHaveBeenCalled();
    expect(states[states.length - 1]).toBe('disconnected');
    sub.unsubscribe();
  });
});
