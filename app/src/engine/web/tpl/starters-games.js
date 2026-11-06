// Game starters (engine/web/starters.js): canvas and DOM games in plain JavaScript, no external requests.
import { page } from "./fw-shared.js";

const GAME_CSS = `* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f172a; color: #e2e8f0; font: 16px/1.5 system-ui, sans-serif; }
main { text-align: center; padding: 16px; }
canvas { background: #020617; border-radius: 12px; max-width: 100%; height: auto; touch-action: none; }
.hud { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
button { font: inherit; padding: 8px 16px; border-radius: 8px; border: 0; background: #22c55e; color: #052e16; cursor: pointer; }
`;

const game = (title, description, body, css, js) => ({
  "index.html": page({ title, description, head: `  <link rel="stylesheet" href="css/style.css">\n  <script src="js/game.js" type="module"></script>\n`, body }),
  "css/style.css": GAME_CSS + css,
  "js/game.js": js,
});

const snake = game(
  "Snake",
  "The classic snake game.",
  `<main>
  <div class="hud"><span>Score: <b id="score">0</b></span><span>Best: <b id="best">0</b></span></div>
  <canvas id="board" width="400" height="400" aria-label="Snake game. Use the arrow keys or swipe."></canvas>
  <p>Arrow keys or WASD to steer, swipe on touch screens. <button id="start" type="button">Start</button></p>
</main>`,
  "",
  `// Snake: a fixed-step game loop on a 20 × 20 grid.
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const N = 20;
const S = canvas.width / N;
let snake, dir, next, food, score, timer;
let best = Number(localStorage.getItem("snake-best") || 0);
document.getElementById("best").textContent = best;

function place() {
  do food = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) };
  while (snake.some((p) => p.x === food.x && p.y === food.y));
}

function start() {
  snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  dir = next = { x: 1, y: 0 };
  score = 0;
  document.getElementById("score").textContent = 0;
  place();
  clearInterval(timer);
  timer = setInterval(step, 110);
}

function step() {
  dir = next;
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
  if (head.x < 0 || head.y < 0 || head.x >= N || head.y >= N || snake.some((p) => p.x === head.x && p.y === head.y)) {
    clearInterval(timer);
    if (score > best) localStorage.setItem("snake-best", (best = score));
    document.getElementById("best").textContent = best;
    return draw(true);
  }
  snake.unshift(head);
  if (head.x === food.x && head.y === food.y) {
    document.getElementById("score").textContent = ++score;
    place();
  } else snake.pop();
  draw(false);
}

function draw(over) {
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(food.x * S + 2, food.y * S + 2, S - 4, S - 4);
  ctx.fillStyle = "#22c55e";
  for (const p of snake) ctx.fillRect(p.x * S + 1, p.y * S + 1, S - 2, S - 2);
  if (over) {
    ctx.fillStyle = "#fff";
    ctx.font = "bold 32px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Game over", canvas.width / 2, canvas.height / 2);
  }
}

const turn = (x, y) => {
  if (x !== -dir.x || y !== -dir.y) next = { x, y };
};
const KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
document.addEventListener("keydown", (e) => {
  const k = KEYS[e.key];
  if (k) {
    e.preventDefault();
    turn(...k);
  }
});
let touch = null;
canvas.addEventListener("pointerdown", (e) => (touch = { x: e.clientX, y: e.clientY }));
canvas.addEventListener("pointerup", (e) => {
  if (!touch) return;
  const dx = e.clientX - touch.x;
  const dy = e.clientY - touch.y;
  if (Math.abs(dx) > Math.abs(dy)) turn(Math.sign(dx), 0);
  else turn(0, Math.sign(dy));
  touch = null;
});
document.getElementById("start").addEventListener("click", start);
start();
`,
);

const breakout = game(
  "Breakout",
  "Break all the bricks with the ball.",
  `<main>
  <div class="hud"><span>Level <b id="level">1</b></span><span>Score <b id="score">0</b></span><span>Lives <b id="lives">3</b></span></div>
  <canvas id="game" width="480" height="360" aria-label="Breakout. Move the paddle with the mouse, touch or arrow keys."></canvas>
  <p>Mouse, touch or arrow keys move the paddle. Space launches the ball.</p>
</main>`,
  "",
  `// Breakout with requestAnimationFrame and a time step, so the speed does not depend on the display rate.
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;
const paddle = { x: W / 2 - 40, w: 80, h: 10 };
const ball = { x: 0, y: 0, vx: 0, vy: 0, r: 6, stuck: true };
let bricks = [];
let level = 1;
let score = 0;
let lives = 3;
const keys = {};
const hud = (id, v) => (document.getElementById(id).textContent = v);

function build() {
  bricks = [];
  for (let r = 0; r < 3 + level; r++) for (let c = 0; c < 8; c++) bricks.push({ x: 8 + c * 58, y: 30 + r * 20, w: 54, h: 14, hue: (r * 40 + 200) % 360 });
}

function launch() {
  if (!ball.stuck) return;
  ball.stuck = false;
  ball.vx = 160 * (Math.random() < 0.5 ? -1 : 1);
  ball.vy = -(200 + level * 30);
}

function update(dt) {
  if (keys.ArrowLeft) paddle.x -= 420 * dt;
  if (keys.ArrowRight) paddle.x += 420 * dt;
  paddle.x = Math.max(0, Math.min(W - paddle.w, paddle.x));
  if (ball.stuck) {
    ball.x = paddle.x + paddle.w / 2;
    ball.y = H - 30;
    return;
  }
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  if (ball.x < ball.r || ball.x > W - ball.r) ball.vx *= -1;
  if (ball.y < ball.r) ball.vy = Math.abs(ball.vy);
  if (ball.y > H - 20 - ball.r && ball.y < H - 10 && ball.x > paddle.x && ball.x < paddle.x + paddle.w && ball.vy > 0) {
    ball.vy *= -1;
    ball.vx = ((ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2)) * 240;
  }
  for (const b of bricks) {
    if (ball.x > b.x && ball.x < b.x + b.w && ball.y - ball.r < b.y + b.h && ball.y + ball.r > b.y) {
      bricks.splice(bricks.indexOf(b), 1);
      ball.vy *= -1;
      hud("score", (score += 10));
      break;
    }
  }
  if (!bricks.length) {
    hud("level", ++level);
    build();
    ball.stuck = true;
  }
  if (ball.y > H + ball.r) {
    hud("lives", --lives);
    ball.stuck = true;
    if (!lives) {
      lives = 3;
      score = 0;
      level = 1;
      hud("lives", 3);
      hud("score", 0);
      hud("level", 1);
      build();
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  for (const b of bricks) {
    ctx.fillStyle = "hsl(" + b.hue + " 70% 55%)";
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(paddle.x, H - 20, paddle.w, paddle.h);
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  ctx.fill();
}

let last = performance.now();
function frame(now) {
  update(Math.min(0.033, (now - last) / 1000));
  last = now;
  draw();
  requestAnimationFrame(frame);
}

document.addEventListener("keydown", (e) => {
  keys[e.key] = true;
  if (e.key === " ") {
    e.preventDefault();
    launch();
  }
});
document.addEventListener("keyup", (e) => (keys[e.key] = false));
canvas.addEventListener("pointermove", (e) => {
  const r = canvas.getBoundingClientRect();
  paddle.x = ((e.clientX - r.left) / r.width) * W - paddle.w / 2;
});
canvas.addEventListener("pointerdown", launch);
build();
requestAnimationFrame(frame);
`,
);

const memory = game(
  "Memory",
  "Find all the matching pairs.",
  `<main>
  <h1>Memory</h1>
  <div class="hud"><span>Moves: <b id="moves">0</b></span><span>Time: <b id="time">0</b> s</span><button id="restart" type="button">New game</button></div>
  <div class="cards" id="cards" role="grid" aria-label="Cards"></div>
  <p id="won" hidden>You found all pairs!</p>
</main>`,
  `.cards { display: grid; grid-template-columns: repeat(4, 72px); gap: 10px; justify-content: center; margin: 16px 0; }
.card { width: 72px; height: 72px; font-size: 34px; border-radius: 10px; background: #334155; color: transparent; padding: 0; }
.card.open, .card.done { background: #e2e8f0; color: #0f172a; }
.card.done { opacity: 0.6; }
`,
  `// Memory: shuffle eight pairs, open two cards per turn, keep matches open.
const SYMBOLS = ["🍎", "🚀", "🎵", "🌵", "🐙", "⚽", "🌙", "🎲"];
const grid = document.getElementById("cards");
let open = [];
let moves = 0;
let found = 0;
let seconds = 0;
let timer;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newGame() {
  open = [];
  moves = found = seconds = 0;
  document.getElementById("moves").textContent = 0;
  document.getElementById("time").textContent = 0;
  document.getElementById("won").hidden = true;
  clearInterval(timer);
  timer = setInterval(() => (document.getElementById("time").textContent = ++seconds), 1000);
  grid.replaceChildren(...shuffle([...SYMBOLS, ...SYMBOLS]).map((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "card";
    b.textContent = s;
    b.setAttribute("aria-label", "Hidden card");
    b.addEventListener("click", () => flip(b));
    return b;
  }));
}

function flip(card) {
  if (open.length === 2 || card.classList.contains("open") || card.classList.contains("done")) return;
  card.classList.add("open");
  card.setAttribute("aria-label", card.textContent);
  open.push(card);
  if (open.length < 2) return;
  document.getElementById("moves").textContent = ++moves;
  const [a, b] = open;
  if (a.textContent === b.textContent) {
    a.classList.add("done");
    b.classList.add("done");
    open = [];
    if (++found === SYMBOLS.length) {
      clearInterval(timer);
      document.getElementById("won").hidden = false;
    }
  } else {
    setTimeout(() => {
      for (const c of open) {
        c.classList.remove("open");
        c.setAttribute("aria-label", "Hidden card");
      }
      open = [];
    }, 700);
  }
}

document.getElementById("restart").addEventListener("click", newGame);
newGame();
`,
);

export const FILES = { snake, breakout, memory };
