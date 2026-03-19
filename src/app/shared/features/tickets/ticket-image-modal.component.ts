import { Component, Input } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

@Component({
  selector: 'app-ticket-image-modal',
  template: `
    <div class="ticket-image-modal-wrapper">
      <button type="button" class="ticket-image-modal-close-btn" aria-label="Close" (click)="closeModal()">×</button>
      <img [src]="imageUrl" alt="Ticket Image" class="ticket-image-modal-img" />
    </div>
  `,
  styles: [`
    .ticket-image-modal-wrapper {
      position: relative;
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.7);
    }
    .ticket-image-modal-img {
      max-width: 90vw;
      max-height: 80vh;
      border-radius: 8px;
      box-shadow: 0 2px 16px rgba(0,0,0,0.3);
    }
    .ticket-image-modal-close-btn {
      position: absolute;
      top: 16px;
      right: 24px;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 50%;
      background: rgba(26, 26, 46, 0.9);
      color: #fff;
      font-size: 24px;
      cursor: pointer;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ticket-image-modal-close-btn:hover {
      background: rgba(45, 45, 70, 0.95);
    }
  `],
  standalone: true
})
export class TicketImageModalComponent {
  @Input() imageUrl!: string;
  constructor(public activeModal: NgbActiveModal) {}
  closeModal(): void {
    this.activeModal.dismiss('close-button');
  }
}
