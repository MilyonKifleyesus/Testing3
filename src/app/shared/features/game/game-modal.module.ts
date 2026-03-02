import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameComponent } from './game.component';
import { GameModalComponent } from './game-modal.component';
import { GameModalWrapperComponent } from './game-modal-wrapper.component';

@NgModule({
  declarations: [GameModalWrapperComponent],
  imports: [CommonModule, GameComponent, GameModalComponent],
  exports: [GameComponent, GameModalComponent, GameModalWrapperComponent]
})
export class GameModalModule {}
