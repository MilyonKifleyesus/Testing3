import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';

interface HObj { id: number; x: number; y: number; }

interface Obstacle extends HObj {
  lane: number;
  type: number;
  spd: number;
}

interface Passenger extends HObj {
  sidewalk: 'top' | 'bottom';
}

interface FloatText extends HObj {
  text: string;
  age: number;
  opacity: number;
}

interface RoadDash { x: number; row: number; }

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

  // ── Game State ──────────────────────────────────────────────
  gameState: GameState = 'idle';
  score = 0;
  passengers = 0;
  lives = 3;
  highScore = 0;
  isNewHighScore = false;
  isHitFlashing = false;
  combo = 1;
  level = 1;
  showCombo = false;

  // ── Layout (readonly constants exposed to template) ─────────
  readonly LANE_H = 80;
  readonly LANE_COUNT = 3;
  readonly SIDEWALK_H = 64;
  readonly ROAD_W = 820;
  readonly BUS_X = 110;
  readonly BUS_W = 120;
  readonly BUS_H = 52;
  readonly CAR_W = 90;
  readonly CAR_H = 58;

  get ROAD_H(): number { return this.LANE_H * this.LANE_COUNT; }
  get SCENE_H(): number { return this.SIDEWALK_H * 2 + this.ROAD_H; }
  get laneRows(): number[] { return [0, 1]; } // for lane dividers

  // ── Player ──────────────────────────────────────────────────
  playerLane = 1;
  playerY = 0;

  // ── Game objects ────────────────────────────────────────────
  obstacles: Obstacle[] = [];
  passengerItems: Passenger[] = [];
  boostItems: HObj[] = [];
  roadDashes: RoadDash[] = [];
  floatTexts: FloatText[] = [];

  // ── Speed / Difficulty ──────────────────────────────────────
  baseSpeed = 4;
  currentSpeedRaw = 4;
  readonly maxSpeed = 14;
  readonly minSpeed = 1;
  speedPercent = 25;
  currentSpeed = 60;

  // ── Scenery ─────────────────────────────────────────────────
  bgScene = 0; // 0=day-city, 1=sunset-sea, 2=night-city
  private sceneBgTimer = 0;

  // Building shapes [width, height] for two parallax strips
  readonly BLDGS_FAR  = [[22,55],[38,90],[18,48],[45,110],[20,60],[55,75],[30,85],[14,52],[40,100],[25,70],[32,80],[18,55],[48,115],[16,50],[28,72]];
  readonly BLDGS_NEAR = [[32,75],[22,55],[42,120],[18,50],[36,88],[26,65],[50,95],[20,58],[38,105],[30,78],[44,130],[16,48],[34,92],[24,62],[46,108]];

  // ── Timers ──────────────────────────────────────────────────
  private idCounter = 0;
  private animationId: number | null = null;
  private lastTime = 0;
  private spawnTimer = 0;
  private passengerTimer = 0;
  private boostTimer = 0;
  private scoreTimer = 0;
  private difficultyTimer = 0;
  private comboTimer = 0;
  private lastObstacleLane = -1;

  get livesArray(): number[] { return Array(Math.max(0, this.lives)).fill(0); }

  getLaneCenterY(lane: number): number {
    return this.SIDEWALK_H + lane * this.LANE_H + (this.LANE_H - this.BUS_H) / 2;
  }

  // ── Lifecycle ───────────────────────────────────────────────
  ngOnInit(): void {
    this.highScore = parseInt(localStorage.getItem('buspulse_high') || '0', 10);
    this.initDashes();
    this.playerY = this.getLaneCenterY(this.playerLane);
  }

  ngOnDestroy(): void { this.stopLoop(); }

  // ── Keyboard ────────────────────────────────────────────────
  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent): void {
    if (this.gameState !== 'playing') return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
    }
    switch (e.key) {
      case 'ArrowUp':    case 'w': case 'W': this.moveUp();    break;
      case 'ArrowDown':  case 's': case 'S': this.moveDown();  break;
      case 'ArrowLeft':  case 'a': case 'A': this.brake();     break;
      case 'ArrowRight': case 'd': case 'D': this.accelerate();break;
      case 'Escape': case 'p': case 'P': this.pauseGame();     break;
    }
  }

  // ── Player movement ─────────────────────────────────────────
  moveUp(): void {
    if (this.playerLane > 0) {
      this.playerLane--;
      this.playerY = this.getLaneCenterY(this.playerLane);
    }
  }

  moveDown(): void {
    if (this.playerLane < this.LANE_COUNT - 1) {
      this.playerLane++;
      this.playerY = this.getLaneCenterY(this.playerLane);
    }
  }

  accelerate(): void { this.currentSpeedRaw = Math.min(this.maxSpeed, this.currentSpeedRaw + 0.6); }
  brake():      void { this.currentSpeedRaw = Math.max(this.minSpeed, this.currentSpeedRaw - 0.6); }

  // Mobile proxies
  mobileUp():    void { this.moveUp(); }
  mobileDown():  void { this.moveDown(); }
  mobileAccel(): void { this.accelerate(); }
  mobileBrake(): void { this.brake(); }
  mobilePause(): void { this.pauseGame(); }

  // ── Game control ────────────────────────────────────────────
  startGame(): void {
    this.score = 0; this.passengers = 0; this.lives = 3;
    this.combo = 1; this.level = 1; this.showCombo = false;
    this.isNewHighScore = false; this.isHitFlashing = false;
    this.playerLane = 1;
    this.baseSpeed = 4; this.currentSpeedRaw = 4;
    this.difficultyTimer = 0; this.spawnTimer = 0;
    this.passengerTimer = 0; this.boostTimer = 0;
    this.scoreTimer = 0; this.comboTimer = 0; this.sceneBgTimer = 0; this.bgScene = 0; this.lastObstacleLane = -1;
    this.obstacles = []; this.passengerItems = [];
    this.boostItems = []; this.floatTexts = [];
    this.initDashes();
    this.playerY = this.getLaneCenterY(this.playerLane);
    this.gameState = 'playing';
    this.startLoop();
    setTimeout(() => this.gameWrapper?.nativeElement?.focus(), 50);
  }

  pauseGame():   void { if (this.gameState !== 'playing') return; this.gameState = 'paused'; this.stopLoop(); }
  resumeGame():  void { if (this.gameState !== 'paused') return; this.gameState = 'playing'; this.startLoop(); }
  resetToMenu(): void { this.stopLoop(); this.gameState = 'idle'; }

  private endGame(): void {
    this.stopLoop();
    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.isNewHighScore = true;
      localStorage.setItem('buspulse_high', String(this.highScore));
    }
    this.gameState = 'gameover';
  }

  // ── Game loop ────────────────────────────────────────────────
  private startLoop(): void { this.lastTime = performance.now(); this.loop(this.lastTime); }
  private stopLoop():  void {
    if (this.animationId !== null) { cancelAnimationFrame(this.animationId); this.animationId = null; }
  }

  private loop(t: number): void {
    const dt = Math.min((t - this.lastTime) / 16.67, 3);
    this.lastTime = t;
    this.update(dt);
    if (this.gameState === 'playing') {
      this.animationId = requestAnimationFrame((nt) => this.loop(nt));
    }
  }

  private update(dt: number): void {
    const spd = this.currentSpeedRaw;

    // Difficulty ramp
    this.difficultyTimer += dt;
    if (this.difficultyTimer > 300) {
      this.difficultyTimer = 0;
      this.baseSpeed = Math.min(this.maxSpeed - 2, this.baseSpeed + 0.25);
      this.currentSpeedRaw = Math.max(this.currentSpeedRaw, this.baseSpeed);
      this.level = Math.max(1, Math.floor((this.baseSpeed - 4) / 2) + 1);
    }

    // Passive score
    this.scoreTimer += dt;
    if (this.scoreTimer >= 10) { this.score += Math.floor(spd); this.scoreTimer = 0; }

    // Speed display
    this.speedPercent = ((spd - this.minSpeed) / (this.maxSpeed - this.minSpeed)) * 100;
    this.currentSpeed = Math.round(40 + spd * 10);

    // Cycle background scenery (day-city → sunset-sea → night-city)
    this.sceneBgTimer += dt;
    if (this.sceneBgTimer > 700) { this.sceneBgTimer = 0; this.bgScene = (this.bgScene + 1) % 3; }

    // Combo timeout
    this.comboTimer += dt;
    if (this.comboTimer > 200) { this.combo = 1; this.showCombo = false; }

    // Scroll road dashes left
    this.roadDashes.forEach(d => {
      d.x -= spd * dt * 0.9;
      if (d.x < -60) d.x += this.ROAD_W + 80;
    });

    // Spawn – longer interval and cap to keep road passable
    this.spawnTimer += dt;
    const si = Math.max(60, 150 - spd * 6);
    if (this.spawnTimer >= si && this.obstacles.length < 4) { this.spawnTimer = 0; this.spawnObstacle(); }

    this.passengerTimer += dt;
    if (this.passengerTimer >= 110) { this.passengerTimer = 0; this.spawnPassenger(); }

    this.boostTimer += dt;
    if (this.boostTimer >= 240) { this.boostTimer = 0; this.spawnBoost(); }

    // Move obstacles leftward — same direction as player but slower (player overtakes)
    this.obstacles.forEach(o => { o.x -= Math.max(0.4, spd * 0.55 - o.spd) * dt; });
    this.obstacles = this.obstacles.filter(o => o.x > -180);

    // Move passengers leftward; reset combo when one passes the bus missed
    this.passengerItems.forEach(p => { p.x -= spd * dt * 0.55; });
    this.passengerItems = this.passengerItems.filter(p => {
      if (p.x + 30 < this.BUS_X) { this.combo = 1; this.showCombo = false; return false; }
      return true;
    });

    // Move boosts leftward
    this.boostItems.forEach(b => { b.x -= spd * dt * 0.55; });
    this.boostItems = this.boostItems.filter(b => b.x > -50);

    // Age float texts
    this.floatTexts.forEach(f => { f.age += dt; f.y -= dt * 0.4; f.opacity = Math.max(0, 1 - f.age / 45); });
    this.floatTexts = this.floatTexts.filter(f => f.age < 50);

    this.checkCollisions();
  }

  // ── Spawning ─────────────────────────────────────────────────
  private spawnObstacle(): void {
    // Pick a lane different from the last one so player always has an escape route
    let lane = Math.floor(Math.random() * this.LANE_COUNT);
    if (lane === this.lastObstacleLane) {
      lane = (lane + 1 + Math.floor(Math.random() * (this.LANE_COUNT - 1))) % this.LANE_COUNT;
    }
    this.lastObstacleLane = lane;
    const type = Math.floor(Math.random() * 4) + 1;
    const y = this.SIDEWALK_H + lane * this.LANE_H + (this.LANE_H - this.CAR_H) / 2;
    this.obstacles.push({ id: this.idCounter++, x: this.ROAD_W + 10, y, lane, type, spd: 0.4 + Math.random() * 1.2 });
  }

  private spawnPassenger(): void {
    const sidewalk: 'top' | 'bottom' = Math.random() < 0.5 ? 'top' : 'bottom';
    const y = sidewalk === 'top'
      ? 8 + Math.random() * (this.SIDEWALK_H - 36)
      : this.SIDEWALK_H + this.ROAD_H + 10 + Math.random() * (this.SIDEWALK_H - 36);
    this.passengerItems.push({ id: this.idCounter++, x: this.ROAD_W + 20, y, sidewalk });
  }

  private spawnBoost(): void {
    const lane = Math.floor(Math.random() * this.LANE_COUNT);
    const y = this.SIDEWALK_H + lane * this.LANE_H + (this.LANE_H - 32) / 2;
    this.boostItems.push({ id: this.idCounter++, x: this.ROAD_W + 10, y });
  }

  private initDashes(): void {
    this.roadDashes = [];
    for (let row = 0; row < this.LANE_COUNT - 1; row++) {
      for (let i = 0; i < 14; i++) {
        this.roadDashes.push({ x: i * 62 + Math.random() * 15, row });
      }
    }
  }

  // ── Collision detection ──────────────────────────────────────
  private checkCollisions(): void {
    const bx1 = this.BUS_X + 14,  bx2 = this.BUS_X + this.BUS_W - 14;
    const by1 = this.playerY + 10, by2 = this.playerY + this.BUS_H - 10;

    // vs obstacle cars
    for (const obs of this.obstacles) {
      const ox2 = obs.x + this.CAR_W - 10;
      if (bx1 < ox2 && bx2 > obs.x + 10 && by1 < obs.y + this.CAR_H - 10 && by2 > obs.y + 10) {
        this.handleHit();
        this.obstacles = this.obstacles.filter(o => o.id !== obs.id);
        break;
      }
    }

    // vs passengers (sidewalk pickup — only when bus is in edge lane)
    this.passengerItems = this.passengerItems.filter(p => {
      if (p.x < bx2 && p.x + 28 > bx1) {
        const canPick = (p.sidewalk === 'top' && this.playerLane === 0)
                     || (p.sidewalk === 'bottom' && this.playerLane === this.LANE_COUNT - 1);
        if (canPick) {
          this.combo = Math.min(5, this.combo + 1);
          this.comboTimer = 0;
          this.showCombo = this.combo > 1;
          const pts = 15 * this.combo;
          this.score += pts;
          this.passengers++;
          this.addFloat(p.x, p.y, `+${pts}${this.combo > 1 ? ` ×${this.combo}` : ''}`);
          return false;
        }
      }
      return true;
    });

    // vs boosts
    this.boostItems = this.boostItems.filter(b => {
      if (b.x < bx2 && b.x + 32 > bx1 && b.y < by2 && b.y + 32 > by1) {
        this.currentSpeedRaw = Math.min(this.maxSpeed, this.currentSpeedRaw + 2);
        this.score += 5;
        this.addFloat(b.x, b.y, '⚡ +5');
        return false;
      }
      return true;
    });
  }

  private addFloat(x: number, y: number, text: string): void {
    this.floatTexts.push({ id: this.idCounter++, x, y, text, age: 0, opacity: 1 });
  }

  private handleHit(): void {
    this.lives--;
    this.combo = 1; this.showCombo = false;
    this.isHitFlashing = true;
    setTimeout(() => (this.isHitFlashing = false), 600);
    if (this.lives <= 0) this.endGame();
  }

  // ── Utilities ────────────────────────────────────────────────
  trackById(_: number, item: HObj): number { return item.id; }
  trackByIndex(i: number): number { return i; }
}
