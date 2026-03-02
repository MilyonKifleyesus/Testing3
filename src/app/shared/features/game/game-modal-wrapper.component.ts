import { Component, OnInit } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

@Component({
  selector: 'app-game-modal-wrapper',
  template: `
    <div class="game-wrapper-modal">
      <button
        type="button"
        class="game-modal-close-btn"
        aria-label="Close"
        (click)="closeModal()"
      >
        ×
      </button>
      <app-game></app-game>
    </div>
  `,
  styles: [`
    .game-wrapper-modal {
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      background: transparent;
      padding: 0;
      margin: 0;
    }

    .game-modal-close-btn {
      position: absolute;
      top: 10px;
      right: 12px;
      width: 32px;
      height: 32px;
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 50%;
      background: rgba(26, 26, 46, 0.9);
      color: #fff;
      font-size: 22px;
      line-height: 1;
      cursor: pointer;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }

    .game-modal-close-btn:hover {
      background: rgba(45, 45, 70, 0.95);
      border-color: rgba(255, 255, 255, 0.6);
    }
  `],
  standalone: false
})
export class GameModalWrapperComponent implements OnInit {
  constructor(public activeModal: NgbActiveModal) {}

  ngOnInit(): void {
    console.log('GameModalWrapperComponent initialized');
  }

  closeModal(): void {
    this.activeModal.dismiss('close-button');
  }
}

