import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  ElementRef,
  ViewChild,
  NgZone,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';

interface GameObject {
  id: number;
  x: number;
  y: number;
}

interface Obstacle extends GameObject {
  type: number; // 1–4 for different car colors
  lane: number;
  speed: number;
}

interface RoadMarking {
  x: number;
  y: number;
}

type GameState = 'idle' | 'playing' | 'paused' | 'gameover';

@Component({
  selector: 'app-game',
  templateUrl: './game.component.html',
  styleUrls: ['./game.component.scss'],
  standalone: true,
  imports: [CommonModule, NgbModule],
})
export class GameComponent implements OnInit, OnDestroy {
  @ViewChild('gameWrapper') gameWrapper!: ElementRef<HTMLDivElement>;

  // ── Game State ─────────────────────────────────────────
  gameState: GameState = 'idle';
  score = 0;
  passengers = 0;
  lives = 3;
  highScore = 0;
  isNewHighScore = false;
  isHitFlashing = false;

  // ── Player ─────────────────────────────────────────────
  playerX = 0;
  playerY = 0;
  playerWidth = 60;
  playerHeight = 100;
  playerLane = 1; // 0, 1, 2
  readonly LANE_COUNT = 3;

  // ── Road / dimensions ──────────────────────────────────
  roadWidth = 360;
  roadHeight = 520;
  laneWidth = 0;

  // ── Obstacles ──────────────────────────────────────────
  obstacles: Obstacle[] = [];
  passengerItems: GameObject[] = [];
  boostItems: GameObject[] = [];
  roadMarkings: RoadMarking[] = [];
  private idCounter = 0;

  // ── Speed / Difficulty ─────────────────────────────────
  baseSpeed = 3;
  currentSpeedRaw = 3;
  maxSpeed = 12;
  minSpeed = 1;
  speedPercent = 25;
  currentSpeed = 60; // display km/h
  private difficultyTimer = 0;

  // ── Game Loop ──────────────────────────────────────────
  private animationId: number | null = null;
  private lastTime = 0;
  private spawnTimer = 0;
  private passengerTimer = 0;
  private boostTimer = 0;
  private scoreTimer = 0;
  private markingTimer = 0;

  // ── Keys ───────────────────────────────────────────────
  private keysDown = new Set<string>();
  private moveDebounce = false;

  get livesArray(): number[] {
    return Array(Math.max(0, this.lives)).fill(0);
  }

  ngOnInit(): void {
    console.log('GameComponent ngOnInit called');
    try {
      this.highScore = parseInt(localStorage.getItem('buspulse_high') || '0', 10);
      this.laneWidth = this.roadWidth / this.LANE_COUNT;
      this.initRoadMarkings();
      this.updatePlayerPosition();
      console.log('GameComponent initialization successful');
    } catch (error) {
      console.error('Error initializing GameComponent:', error);
    }
  }

  ngOnDestroy(): void {
    this.stopLoop();
  }

  // ── Keyboard ───────────────────────────────────────────
  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent): void {
    this.keysDown.add(e.key);

    if (this.gameState !== 'playing') return;

    if (
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown'
    ) {
      e.preventDefault();
      e.stopPropagation();
    }

    switch (e.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        this.moveLeft();
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        this.moveRight();
        break;
      case 'ArrowUp':
      case 'w':
      case 'W':
        this.accelerate();
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        this.brake();
        break;
      case 'Escape':
      case 'p':
      case 'P':
        this.pauseGame();
        break;
    }
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.key);
  }

  // ── Mobile ─────────────────────────────────────────────
  mobileLeft(): void { this.moveLeft(); }
  mobileRight(): void { this.moveRight(); }
  mobileAccel(): void { this.accelerate(); }
  mobileBrake(): void { this.brake(); }
  mobilePause(): void { this.pauseGame(); }

  // ── Player Movement ────────────────────────────────────
  moveLeft(): void {
    if (this.playerLane > 0) {
      this.playerLane--;
      this.updatePlayerPosition();
    }
  }

  moveRight(): void {
    if (this.playerLane < this.LANE_COUNT - 1) {
      this.playerLane++;
      this.updatePlayerPosition();
    }
  }

  accelerate(): void {
    this.currentSpeedRaw = Math.min(this.maxSpeed, this.currentSpeedRaw + 0.5);
  }

  brake(): void {
    this.currentSpeedRaw = Math.max(this.minSpeed, this.currentSpeedRaw - 0.5);
  }

  private updatePlayerPosition(): void {
    this.playerX = this.laneWidth * this.playerLane + (this.laneWidth - this.playerWidth) / 2;
    this.playerY = this.roadHeight - this.playerHeight - 20;
  }

  // ── Game Control ───────────────────────────────────────
  startGame(): void {
    this.score = 0;
    this.passengers = 0;
    this.lives = 3;
    this.isNewHighScore = false;
    this.playerLane = 1;
    this.currentSpeedRaw = this.baseSpeed;
    this.difficultyTimer = 0;
    this.obstacles = [];
    this.passengerItems = [];
    this.boostItems = [];
    this.initRoadMarkings();
    this.updatePlayerPosition();
    this.gameState = 'playing';
    this.startLoop();

    // Focus for keyboard input
    setTimeout(() => this.gameWrapper?.nativeElement?.focus(), 50);
  }

  pauseGame(): void {
    if (this.gameState !== 'playing') return;
    this.gameState = 'paused';
    this.stopLoop();
  }

  resumeGame(): void {
    if (this.gameState !== 'paused') return;
    this.gameState = 'playing';
    this.startLoop();
  }

  resetToMenu(): void {
    this.stopLoop();
    this.gameState = 'idle';
  }

  private endGame(): void {
    this.stopLoop();
    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.isNewHighScore = true;
      localStorage.setItem('buspulse_high', String(this.highScore));
    }
    this.gameState = 'gameover';
  }

  // ── Game Loop ──────────────────────────────────────────
  private startLoop(): void {
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  private stopLoop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  private loop(timestamp: number): void {
    const dt = Math.min((timestamp - this.lastTime) / 16.67, 3); // normalized to ~60fps
    this.lastTime = timestamp;

    this.update(dt);

    this.animationId = requestAnimationFrame((t) => this.loop(t));
  }

  private update(dt: number): void {
    const speed = this.currentSpeedRaw;

    // Difficulty ramp
    this.difficultyTimer += dt;
    if (this.difficultyTimer > 300) {
      this.difficultyTimer = 0;
      this.baseSpeed = Math.min(this.maxSpeed - 2, this.baseSpeed + 0.2);
      this.currentSpeedRaw = Math.max(this.currentSpeedRaw, this.baseSpeed);
    }

    // Score accumulation
    this.scoreTimer += dt;
    if (this.scoreTimer >= 10) {
      this.score += Math.floor(speed);
      this.scoreTimer = 0;
    }

    // Speed display
    this.speedPercent = ((speed - this.minSpeed) / (this.maxSpeed - this.minSpeed)) * 100;
    this.currentSpeed = Math.round(40 + speed * 10);

    // Move road markings
    this.markingTimer += dt;
    this.roadMarkings.forEach((m) => {
      m.y += speed * dt * 0.8;
      if (m.y > this.roadHeight + 20) m.y = -40;
    });

    // Spawn obstacles
    this.spawnTimer += dt;
    const spawnInterval = Math.max(40, 90 - speed * 5);
    if (this.spawnTimer >= spawnInterval) {
      this.spawnTimer = 0;
      this.spawnObstacle();
    }

    // Spawn passengers
    this.passengerTimer += dt;
    if (this.passengerTimer >= 120) {
      this.passengerTimer = 0;
      this.spawnPassenger();
    }

    // Spawn boosts
    this.boostTimer += dt;
    if (this.boostTimer >= 250) {
      this.boostTimer = 0;
      this.spawnBoost();
    }

    // Move obstacles
    this.obstacles.forEach((obs) => {
      obs.y += (obs.speed + speed * 0.5) * dt;
    });
    this.obstacles = this.obstacles.filter((o) => o.y < this.roadHeight + 120);

    // Move passengers
    this.passengerItems.forEach((p) => (p.y += speed * dt * 0.4));
    this.passengerItems = this.passengerItems.filter((p) => p.y < this.roadHeight + 50);

    // Move boosts
    this.boostItems.forEach((b) => (b.y += speed * dt * 0.4));
    this.boostItems = this.boostItems.filter((b) => b.y < this.roadHeight + 50);

    // Collision detection
    this.checkCollisions();
  }

  // ── Spawning ───────────────────────────────────────────
  private spawnObstacle(): void {
    const lane = Math.floor(Math.random() * this.LANE_COUNT);
    const type = Math.floor(Math.random() * 4) + 1;
    const carW = 50, carH = 80;
    this.obstacles.push({
      id: this.idCounter++,
      x: this.laneWidth * lane + (this.laneWidth - carW) / 2,
      y: -carH - 10,
      lane,
      type,
      speed: 1 + Math.random() * 1.5,
    });
  }

  private spawnPassenger(): void {
    const lane = Math.floor(Math.random() * this.LANE_COUNT);
    this.passengerItems.push({
      id: this.idCounter++,
      x: this.laneWidth * lane + this.laneWidth / 2 - 15,
      y: -40,
    });
  }

  private spawnBoost(): void {
    const lane = Math.floor(Math.random() * this.LANE_COUNT);
    this.boostItems.push({
      id: this.idCounter++,
      x: this.laneWidth * lane + this.laneWidth / 2 - 15,
      y: -40,
    });
  }

  private initRoadMarkings(): void {
    this.roadMarkings = [];
    for (let col = 0; col < this.LANE_COUNT - 1; col++) {
      for (let row = 0; row < 6; row++) {
        this.roadMarkings.push({
          x: this.laneWidth * (col + 1) - 2,
          y: row * 90,
        });
      }
    }
  }

  // ── Collision ──────────────────────────────────────────
  private checkCollisions(): void {
    const px = this.playerX + 8;
    const py = this.playerY + 10;
    const pw = this.playerWidth - 16;
    const ph = this.playerHeight - 15;

    // vs obstacles
    for (const obs of this.obstacles) {
      if (this.rectsOverlap(px, py, pw, ph, obs.x + 5, obs.y + 5, 40, 70)) {
        this.handleHit();
        this.obstacles = this.obstacles.filter((o) => o.id !== obs.id);
        break;
      }
    }

    // vs passengers
    this.passengerItems = this.passengerItems.filter((p) => {
      if (this.rectsOverlap(px, py, pw, ph, p.x, p.y, 30, 40)) {
        this.score += 10;
        this.passengers++;
        return false;
      }
      return true;
    });

    // vs boosts
    this.boostItems = this.boostItems.filter((b) => {
      if (this.rectsOverlap(px, py, pw, ph, b.x, b.y, 30, 30)) {
        this.currentSpeedRaw = Math.min(this.maxSpeed, this.currentSpeedRaw + 2);
        this.score += 5;
        return false;
      }
      return true;
    });
  }

  private rectsOverlap(
    ax: number, ay: number, aw: number, ah: number,
    bx: number, by: number, bw: number, bh: number
  ): boolean {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  private handleHit(): void {
    this.lives--;
    this.isHitFlashing = true;
    setTimeout(() => (this.isHitFlashing = false), 600);

    if (this.lives <= 0) {
      this.endGame();
    }
  }

  // ── Utilities ──────────────────────────────────────────
  trackById(_: number, item: GameObject): number { return item.id; }
  trackByIndex(index: number): number { return index; }
}
