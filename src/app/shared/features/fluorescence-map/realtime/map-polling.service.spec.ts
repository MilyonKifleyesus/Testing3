import { discardPeriodicTasks, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { MapPollingService } from './map-polling.service';

describe('MapPollingService', () => {
  let service: MapPollingService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MapPollingService],
    });
    service = TestBed.inject(MapPollingService);
  });

  it('start is idempotent and emits ticks', fakeAsync(() => {
    let tickCount = 0;
    service.tick$.subscribe(() => tickCount++);

    service.start(1000);
    service.start(1000);
    tick(0);
    expect(tickCount).toBe(1);

    tick(999);
    expect(tickCount).toBe(1);

    tick(1);
    expect(tickCount).toBe(2);

    tick(1000);
    expect(tickCount).toBe(3);

    tick(1000);
    expect(tickCount).toBe(4);
    discardPeriodicTasks();
  }));

  it('stop halts ticks', fakeAsync(() => {
    let tickCount = 0;
    service.tick$.subscribe(() => tickCount++);

    service.start(1000);
    tick(0);
    expect(tickCount).toBe(1);

    tick(1000);
    expect(tickCount).toBe(2);

    service.stop();
    tick(3000);
    expect(tickCount).toBe(2);
    discardPeriodicTasks();
  }));
});
