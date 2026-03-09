import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subject, Subscription, timer } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class MapPollingService implements OnDestroy {
  private pollSub: Subscription | null = null;
  private readonly tickSubject = new Subject<void>();
  private readonly pollingSubject = new BehaviorSubject<boolean>(false);

  readonly tick$ = this.tickSubject.asObservable();
  readonly isPolling$ = this.pollingSubject.asObservable();

  start(intervalMs: number): void {
    if (this.pollSub) return;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      console.warn('MapPollingService.start called with invalid intervalMs:', intervalMs);
      return;
    }
    this.pollingSubject.next(true);
    this.pollSub = timer(0, intervalMs).subscribe(() => this.tickSubject.next());
  }

  stop(): void {
    if (this.pollSub) {
      this.pollSub.unsubscribe();
      this.pollSub = null;
    }
    this.pollingSubject.next(false);
  }

  ngOnDestroy(): void {
    this.stop();
    this.tickSubject.complete();
    this.pollingSubject.complete();
  }
}
