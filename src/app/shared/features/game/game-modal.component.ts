import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { GameComponent } from './game.component';

@Component({
  selector: 'app-game-modal',
  standalone: true,
  imports: [CommonModule, NgbModule, GameComponent],
  template: `
    <div class="game-modal-wrapper">
      <div class="modal-dialog-content">
        <app-game></app-game>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    .game-modal-wrapper {
      width: 100%;
      height: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      background: transparent;
    }
    .modal-dialog-content {
      width: 100%;
      height: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
    }
  `]
})
export class GameModalComponent implements OnInit {
  ngOnInit(): void {
    console.log('GameModalComponent initialized');
  }
}
