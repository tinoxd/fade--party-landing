/*
  Simple Mario-like game using HTML5 Canvas
  Controls: Left/Right (A/D), Jump (W/Up/Space)
*/

(function () {
  'use strict';

  // Canvas setup
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // Fixed internal resolution (NES-ish 16:9)
  const INTERNAL_WIDTH = 512;   // 32 tiles * 16px
  const INTERNAL_HEIGHT = 288;  // 18 tiles * 16px
  const TILE_SIZE = 16;

  // Physics constants
  const GRAVITY = 0.6;
  const MAX_FALL_SPEED = 16;
  const MOVE_ACCEL = 0.8;
  const MOVE_DECEL = 0.6;
  const MAX_RUN_SPEED = 3.0;
  const JUMP_SPEED = -10.5;

  // Game state
  const input = {
    left: false,
    right: false,
    up: false,
    jump: false,
  };

  function setupInput() {
    const keyDown = (e) => {
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA': input.left = true; break;
        case 'ArrowRight':
        case 'KeyD': input.right = true; break;
        case 'ArrowUp':
        case 'KeyW':
        case 'Space': input.up = true; input.jump = true; break;
      }
    };
    const keyUp = (e) => {
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA': input.left = false; break;
        case 'ArrowRight':
        case 'KeyD': input.right = false; break;
        case 'ArrowUp':
        case 'KeyW':
        case 'Space': input.up = false; break;
      }
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    // Prevent arrow key scroll
    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    }, { passive: false });
  }

  // Utility
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  // Level generation
  const LEVEL_HEIGHT_TILES = Math.floor(INTERNAL_HEIGHT / TILE_SIZE);  // 18
  const LEVEL_WIDTH_TILES = 240; // long level

  const TILE = {
    EMPTY: 0,
    GROUND: 1,
    BRICK: 2,
    COIN: 3,
    QUESTION: 4,
    PIPE: 5,
    FLAGPOLE: 6,
    FLAG: 7,
  };

  function createLevel() {
    const map = new Array(LEVEL_HEIGHT_TILES).fill(0).map(() => new Array(LEVEL_WIDTH_TILES).fill(TILE.EMPTY));
    const groundY = LEVEL_HEIGHT_TILES - 2; // second from bottom; bottom row as void/color

    // Ground baseline
    for (let x = 0; x < LEVEL_WIDTH_TILES; x++) {
      map[groundY][x] = TILE.GROUND;
    }

    // Some terrain variations and platforms
    for (let x = 10; x < 30; x++) map[groundY - 3][x] = TILE.BRICK;
    for (let x = 40; x < 47; x++) map[groundY - 5][x] = TILE.BRICK;
    for (let x = 52; x < 60; x++) map[groundY - 2][x] = TILE.BRICK;
    for (let x = 70; x < 72; x++) map[groundY - 1][x] = TILE.PIPE; // small pipe
    for (let x = 95; x < 100; x++) map[groundY - 4][x] = TILE.BRICK;
    for (let x = 120; x < 125; x++) map[groundY - 6][x] = TILE.BRICK;
    for (let x = 150; x < 170; x++) if (x % 2 === 0) map[groundY - 3][x] = TILE.BRICK;

    // Question blocks and coins
    map[groundY - 4][14] = TILE.QUESTION;
    map[groundY - 4][15] = TILE.COIN;
    map[groundY - 4][16] = TILE.QUESTION;
    map[groundY - 7][43] = TILE.COIN;
    map[groundY - 6][44] = TILE.COIN;
    map[groundY - 5][45] = TILE.COIN;

    // Flag at the end
    const flagX = LEVEL_WIDTH_TILES - 6;
    for (let y = groundY - 8; y <= groundY; y++) map[y][flagX] = TILE.FLAGPOLE;
    map[groundY - 8][flagX + 1] = TILE.FLAG;

    return { map, groundY, flagX };
  }

  const level = createLevel();

  function tileAt(tx, ty) {
    if (ty < 0 || ty >= LEVEL_HEIGHT_TILES || tx < 0 || tx >= LEVEL_WIDTH_TILES) return TILE.EMPTY;
    return level.map[ty][tx];
  }

  function isSolid(tile) {
    return tile === TILE.GROUND || tile === TILE.BRICK || tile === TILE.PIPE || tile === TILE.FLAGPOLE;
  }

  // Entities
  class RectEntity {
    constructor(x, y, w, h) {
      this.x = x; this.y = y; this.width = w; this.height = h;
      this.vx = 0; this.vy = 0; this.alive = true;
      this.onGround = false;
      this.facing = 1; // 1 right, -1 left
    }

    get centerX() { return this.x + this.width / 2; }
    get centerY() { return this.y + this.height / 2; }
  }

  class Player extends RectEntity {
    constructor(x, y) {
      super(x, y, 12, 16);
      this.score = 0;
      this.coins = 0;
      this.lives = 3;
      this.reachedFlag = false;
      this.jumpBuffered = 0; // frames to buffer jump
      this.coyoteFrames = 0; // allow jumps a few frames after leaving ground
    }

    update() {
      // Horizontal input
      if (input.left && !input.right) {
        this.vx = clamp(this.vx - MOVE_ACCEL, -MAX_RUN_SPEED, MAX_RUN_SPEED);
        this.facing = -1;
      } else if (input.right && !input.left) {
        this.vx = clamp(this.vx + MOVE_ACCEL, -MAX_RUN_SPEED, MAX_RUN_SPEED);
        this.facing = 1;
      } else {
        if (this.vx > 0) this.vx = Math.max(0, this.vx - MOVE_DECEL);
        if (this.vx < 0) this.vx = Math.min(0, this.vx + MOVE_DECEL);
      }

      // Jump buffering and coyote time
      if (input.jump) {
        this.jumpBuffered = 6; // frames
        input.jump = false; // consume
      }
      if (this.onGround) this.coyoteFrames = 6; else this.coyoteFrames = Math.max(0, this.coyoteFrames - 1);

      if (this.jumpBuffered > 0 && (this.onGround || this.coyoteFrames > 0)) {
        this.vy = JUMP_SPEED;
        this.onGround = false;
        this.coyoteFrames = 0;
        this.jumpBuffered = 0;
      } else {
        this.jumpBuffered = Math.max(0, this.jumpBuffered - 1);
      }

      // Apply gravity
      this.vy = clamp(this.vy + GRAVITY, -999, MAX_FALL_SPEED);

      // Horizontal movement and collision
      this.x += this.vx;
      this.resolveCollisions(true);

      // Vertical movement and collision
      this.y += this.vy;
      this.resolveCollisions(false);
    }

    resolveCollisions(horizontal) {
      const minTx = Math.floor((this.x - 1) / TILE_SIZE);
      const maxTx = Math.floor((this.x + this.width + 1) / TILE_SIZE);
      const minTy = Math.floor((this.y - 1) / TILE_SIZE);
      const maxTy = Math.floor((this.y + this.height + 1) / TILE_SIZE);

      this.onGround = false;

      for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
          const t = tileAt(tx, ty);
          if (!isSolid(t)) continue;

          const tileX = tx * TILE_SIZE;
          const tileY = ty * TILE_SIZE;

          if (this.x < tileX + TILE_SIZE && this.x + this.width > tileX && this.y < tileY + TILE_SIZE && this.y + this.height > tileY) {
            // Collision detected, resolve along movement axis
            const overlapX1 = this.x + this.width - tileX;
            const overlapX2 = tileX + TILE_SIZE - this.x;
            const overlapY1 = this.y + this.height - tileY;
            const overlapY2 = tileY + TILE_SIZE - this.y;

            if (horizontal) {
              if (overlapX1 < overlapX2) {
                this.x -= overlapX1; // push left
              } else {
                this.x += overlapX2; // push right
              }
              this.vx = 0;
            } else {
              if (overlapY1 < overlapY2) {
                this.y -= overlapY1; // push up
                this.vy = 0;
                this.onGround = true;
              } else {
                this.y += overlapY2; // push down
                this.vy = Math.min(0, this.vy);
              }
            }
          }
        }
      }

      // Interactions with non-solid tiles (coins, question, flag)
      for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
          const t = tileAt(tx, ty);
          if (t === TILE.COIN) {
            if (aabb(this, { x: tx * TILE_SIZE, y: ty * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE })) {
              level.map[ty][tx] = TILE.EMPTY;
              this.coins += 1;
              this.score += 100;
            }
          } else if (t === TILE.QUESTION) {
            // Hit from below to get a coin
            const box = { x: tx * TILE_SIZE, y: ty * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE };
            if (aabb(this, box)) {
              const comingFromBelow = (this.centerY > box.y + box.height);
              if (comingFromBelow && this.vy < 0) {
                level.map[ty][tx] = TILE.BRICK; // becomes used brick
                this.coins += 1;
                this.score += 200;
                this.vy = 2; // small bounce back
              }
            }
          } else if (t === TILE.FLAG || t === TILE.FLAGPOLE) {
            const box = { x: tx * TILE_SIZE, y: ty * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE };
            if (aabb(this, box)) {
              this.reachedFlag = true;
            }
          }
        }
      }
    }

    draw(ctx, camera) {
      ctx.fillStyle = '#ff4136';
      ctx.fillRect(Math.floor(this.x - camera.x), Math.floor(this.y - camera.y), this.width, this.height);
      // Eye
      ctx.fillStyle = '#111';
      const eyeX = Math.floor(this.x - camera.x + (this.facing === 1 ? this.width - 4 : 2));
      ctx.fillRect(eyeX, Math.floor(this.y - camera.y + 4), 2, 2);
    }
  }

  class Goomba extends RectEntity {
    constructor(x, y) {
      super(x, y, 14, 12);
      this.vx = -0.7;
    }

    update() {
      // Apply gravity
      this.vy = clamp(this.vy + GRAVITY, -999, MAX_FALL_SPEED);

      // Move horizontally, flip direction on wall
      this.x += this.vx;
      const collidedX = this.resolveCollisions(true);
      if (collidedX) this.vx *= -1;

      // Move vertically
      this.y += this.vy;
      this.resolveCollisions(false);
    }

    resolveCollisions(horizontal) {
      let collided = false;
      const minTx = Math.floor((this.x - 1) / TILE_SIZE);
      const maxTx = Math.floor((this.x + this.width + 1) / TILE_SIZE);
      const minTy = Math.floor((this.y - 1) / TILE_SIZE);
      const maxTy = Math.floor((this.y + this.height + 1) / TILE_SIZE);

      for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
          const t = tileAt(tx, ty);
          if (!isSolid(t)) continue;
          const tileX = tx * TILE_SIZE;
          const tileY = ty * TILE_SIZE;
          if (this.x < tileX + TILE_SIZE && this.x + this.width > tileX && this.y < tileY + TILE_SIZE && this.y + this.height > tileY) {
            const overlapX1 = this.x + this.width - tileX;
            const overlapX2 = tileX + TILE_SIZE - this.x;
            const overlapY1 = this.y + this.height - tileY;
            const overlapY2 = tileY + TILE_SIZE - this.y;
            if (horizontal) {
              collided = true;
              if (overlapX1 < overlapX2) this.x -= overlapX1; else this.x += overlapX2;
              this.vx = 0;
            } else {
              if (overlapY1 < overlapY2) { this.y -= overlapY1; this.vy = 0; }
              else { this.y += overlapY2; this.vy = Math.min(0, this.vy); }
            }
          }
        }
      }
      return collided;
    }

    draw(ctx, camera) {
      ctx.fillStyle = '#7f4a00';
      ctx.fillRect(Math.floor(this.x - camera.x), Math.floor(this.y - camera.y), this.width, this.height);
      // Feet
      ctx.fillStyle = '#5b3700';
      ctx.fillRect(Math.floor(this.x - camera.x), Math.floor(this.y - camera.y + this.height - 3), this.width, 3);
    }
  }

  function aabb(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }

  // Camera
  const camera = { x: 0, y: 0 };
  function updateCamera(player) {
    const marginX = INTERNAL_WIDTH * 0.35;
    const targetX = clamp(player.centerX - marginX, 0, LEVEL_WIDTH_TILES * TILE_SIZE - INTERNAL_WIDTH);
    camera.x += (targetX - camera.x) * 0.15;
    camera.y = 0;
  }

  // Entities init
  const player = new Player(4 * TILE_SIZE, (level.groundY - 3) * TILE_SIZE);
  const enemies = [];
  // Place some Goombas
  enemies.push(new Goomba(28 * TILE_SIZE, (level.groundY - 1.1) * TILE_SIZE));
  enemies.push(new Goomba(55 * TILE_SIZE, (level.groundY - 1.1) * TILE_SIZE));
  enemies.push(new Goomba(100 * TILE_SIZE, (level.groundY - 1.1) * TILE_SIZE));
  enemies.push(new Goomba(160 * TILE_SIZE, (level.groundY - 1.1) * TILE_SIZE));

  // Player/enemy interactions
  function handlePlayerEnemyInteractions() {
    for (const e of enemies) {
      if (!e.alive) continue;
      if (!aabb(player, e)) continue;
      const playerBottom = player.y + player.height;
      const enemyTop = e.y;
      if (player.vy > 0 && playerBottom - enemyTop < 8) {
        // Stomp
        e.alive = false;
        player.vy = -7;
        player.score += 200;
      } else {
        // Hit player
        respawnPlayer();
        break;
      }
    }
  }

  function respawnPlayer() {
    player.lives -= 1;
    if (player.lives < 0) {
      // Reset whole game
      player.lives = 3;
      player.score = 0;
      player.coins = 0;
    }
    player.x = 4 * TILE_SIZE;
    player.y = (level.groundY - 3) * TILE_SIZE;
    player.vx = 0; player.vy = 0;
    camera.x = 0; camera.y = 0;
  }

  // Rendering tiles
  function drawTile(ctx, t, x, y) {
    switch (t) {
      case TILE.EMPTY: return;
      case TILE.GROUND:
        ctx.fillStyle = '#8b5a2b';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = '#6f451f';
        ctx.fillRect(x, y + TILE_SIZE - 4, TILE_SIZE, 4);
        return;
      case TILE.BRICK:
        ctx.fillStyle = '#b36b00';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = '#8f5500';
        ctx.fillRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        return;
      case TILE.COIN:
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.ellipse(x + TILE_SIZE / 2, y + TILE_SIZE / 2, 4, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        return;
      case TILE.QUESTION:
        ctx.fillStyle = '#f0a202';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = '#fff';
        ctx.fillRect(x + 5, y + 4, 2, 2);
        ctx.fillRect(x + 9, y + 4, 2, 2);
        ctx.fillRect(x + 7, y + 8, 2, 2);
        return;
      case TILE.PIPE:
        ctx.fillStyle = '#2dbf53';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = '#239245';
        ctx.fillRect(x, y, TILE_SIZE, 3);
        return;
      case TILE.FLAGPOLE:
        ctx.fillStyle = '#f3f3f3';
        ctx.fillRect(x + TILE_SIZE / 2 - 1, y, 2, TILE_SIZE);
        return;
      case TILE.FLAG:
        ctx.fillStyle = '#ff2f2f';
        ctx.fillRect(x, y + 3, TILE_SIZE - 4, TILE_SIZE - 6);
        return;
    }
  }

  function drawLevel(ctx, camera) {
    const startTx = Math.floor(camera.x / TILE_SIZE);
    const endTx = Math.ceil((camera.x + INTERNAL_WIDTH) / TILE_SIZE);
    const startTy = Math.floor(camera.y / TILE_SIZE);
    const endTy = Math.ceil((camera.y + INTERNAL_HEIGHT) / TILE_SIZE);

    for (let ty = startTy; ty < endTy; ty++) {
      for (let tx = startTx; tx < endTx; tx++) {
        const t = tileAt(tx, ty);
        const sx = Math.floor(tx * TILE_SIZE - camera.x);
        const sy = Math.floor(ty * TILE_SIZE - camera.y);
        drawTile(ctx, t, sx, sy);
      }
    }
  }

  function drawHUD(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(8, 8, INTERNAL_WIDTH - 16, 22);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(`SCORE: ${player.score}`, 16, 12);
    ctx.fillText(`COINS: ${player.coins}`, 140, 12);
    ctx.fillText(`LIVES: ${player.lives}`, 260, 12);
  }

  // Resize handling: keep internal resolution, scale to canvas size via CSS already; ensure canvas size fixed
  function resize() {
    canvas.width = INTERNAL_WIDTH;
    canvas.height = INTERNAL_HEIGHT;
  }
  window.addEventListener('resize', resize);
  resize();

  // Main loop
  let lastTime = 0;
  function frame(ts) {
    const dt = Math.min(33, ts - lastTime);
    lastTime = ts;

    // Update
    player.update();
    for (const e of enemies) if (e.alive) e.update();
    handlePlayerEnemyInteractions();
    updateCamera(player);

    // Check win
    if (player.reachedFlag) {
      drawScene();
      drawWin();
      requestAnimationFrame(frame);
      return;
    }

    // Render
    drawScene();

    requestAnimationFrame(frame);
  }

  function drawScene() {
    // Sky
    ctx.fillStyle = '#5fc1ff';
    ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

    // Background hills
    ctx.fillStyle = '#a8e6ff';
    ctx.beginPath();
    ctx.ellipse(60 - camera.x * 0.2, INTERNAL_HEIGHT - 10, 80, 25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(240 - camera.x * 0.2, INTERNAL_HEIGHT - 8, 120, 35, 0, 0, Math.PI * 2);
    ctx.fill();

    drawLevel(ctx, camera);

    for (const e of enemies) if (e.alive) e.draw(ctx, camera);
    player.draw(ctx, camera);

    drawHUD(ctx);
  }

  function drawWin() {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('YOU WIN! 🎉', INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2 - 8);
    ctx.font = '12px monospace';
    ctx.fillText('Press R to restart', INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2 + 14);
  }

  function setupRestart() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR') {
        // Reset level state minimally
        player.reachedFlag = false;
        respawnPlayer();
        for (const e of enemies) { e.alive = true; e.x += 0; e.y += 0; }
      }
    });
  }

  function start() {
    setupInput();
    setupRestart();
    requestAnimationFrame(frame);
  }

  start();
})();