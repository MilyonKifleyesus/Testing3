import { CommonModule, DOCUMENT } from '@angular/common';
import {
  Component,
  ElementRef,
  Inject,
  NgZone,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppStateService } from './shared/services/app-state.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'spruha';

  private ariaHiddenObserver?: MutationObserver;

  constructor(
    private appState: AppStateService,
    private elementRef: ElementRef<HTMLElement>,
    @Inject(DOCUMENT) private document: Document,
    private ngZone: NgZone,
  ) {
    this.appState.updateState();
  }

  ngOnInit(): void {
    this.initAriaHiddenFocusGuard();
  }

  ngOnDestroy(): void {
    this.ariaHiddenObserver?.disconnect();
  }

  private initAriaHiddenFocusGuard(): void {
    if (typeof MutationObserver === 'undefined') {
      return;
    }

    const host = this.elementRef.nativeElement;
    this.ariaHiddenObserver = new MutationObserver(() => {
      this.ngZone.runOutsideAngular(() => {
        requestAnimationFrame(() => this.ensureFocusNotInsideAriaHiddenHost());
      });
    });

    this.ariaHiddenObserver.observe(host, {
      attributes: true,
      attributeFilter: ['aria-hidden'],
    });

    this.ensureFocusNotInsideAriaHiddenHost();
  }

  private ensureFocusNotInsideAriaHiddenHost(): void {
    const host = this.elementRef.nativeElement;
    if (host.getAttribute('aria-hidden') !== 'true') {
      return;
    }

    const activeElement = this.document.activeElement as HTMLElement | null;
    if (!activeElement || !host.contains(activeElement)) {
      return;
    }

    const focusTarget = this.getOverlayFocusableElement();
    if (focusTarget) {
      focusTarget.focus({ preventScroll: true });
      return;
    }

    activeElement.blur();
    this.focusBodySafely();
  }

  private getOverlayFocusableElement(): HTMLElement | null {
    const selector = [
      '.modal.show button:not([disabled])',
      '.modal.show [href]',
      '.modal.show input:not([disabled])',
      '.modal.show select:not([disabled])',
      '.modal.show textarea:not([disabled])',
      '.modal.show [tabindex]:not([tabindex="-1"])',
      '.offcanvas.show button:not([disabled])',
      '.offcanvas.show [href]',
      '.offcanvas.show input:not([disabled])',
      '.offcanvas.show select:not([disabled])',
      '.offcanvas.show textarea:not([disabled])',
      '.offcanvas.show [tabindex]:not([tabindex="-1"])',
    ].join(', ');

    return this.document.querySelector<HTMLElement>(selector);
  }

  private focusBodySafely(): void {
    const body = this.document.body;
    const hadTabIndex = body.hasAttribute('tabindex');
    if (!hadTabIndex) {
      body.setAttribute('tabindex', '-1');
    }

    body.focus({ preventScroll: true });

    if (!hadTabIndex) {
      body.removeAttribute('tabindex');
    }
  }
}
