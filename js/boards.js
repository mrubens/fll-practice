// The tables you can practice on. The season table comes from mat/season.json (official mat and models);
// the others are drawn here: plain mats with lines and a few LEGO objects, like the SPIKE Training Camp lessons.
import { TABLE, PX_PER_CM } from './world.js';

const X = (cm) => (cm + TABLE.w / 2) * PX_PER_CM;
const Y = (cm) => (cm + TABLE.h / 2) * PX_PER_CM;
const s = PX_PER_CM;

function paper(ctx, canvas) {
  ctx.fillStyle = '#F5F2EA';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#E4E0D5';
  ctx.lineWidth = 1;
  for (let cm = -110; cm <= 110; cm += 10) { ctx.beginPath(); ctx.moveTo(X(cm), 0); ctx.lineTo(X(cm), canvas.height); ctx.stroke(); }
  for (let cm = -50; cm <= 50; cm += 10) { ctx.beginPath(); ctx.moveTo(0, Y(cm)); ctx.lineTo(canvas.width, Y(cm)); ctx.stroke(); }
}
function startBox(ctx, start, label = 'START') {
  ctx.strokeStyle = '#8A93A3';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(X(start.x - 12), Y(start.y - 11), 24 * s, 22 * s);
  ctx.setLineDash([]);
  ctx.fillStyle = '#8A93A3';
  ctx.font = `bold ${7 * s}px Nunito, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(label, X(start.x), Y(start.y - 14));
}
function line(ctx, pts, width = 2.4, color = '#111111') {
  ctx.strokeStyle = color; ctx.lineWidth = width * s; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
  ctx.stroke();
}
function loop(ctx, x0, y0, x1, y1, r, width = 2.4) {
  ctx.strokeStyle = '#111111'; ctx.lineWidth = width * s; ctx.lineJoin = 'round';
  const x = X(x0), y = Y(y0), w = (x1 - x0) * s, h = (y1 - y0) * s, rr = r * s;
  ctx.beginPath();
  ctx.moveTo(x + rr, y); ctx.lineTo(x + w - rr, y); ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr); ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h); ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr); ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath(); ctx.stroke();
}
function tile(ctx, x, y, size, color) { ctx.fillStyle = color; ctx.fillRect(X(x - size / 2), Y(y - size / 2), size * s, size * s); }
function footprint(ctx, o) { ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.strokeRect(X(o.x - o.w / 2), Y(o.y - o.d / 2), o.w * s, o.d * s); ctx.setLineDash([]); }

/** Lines to follow and colors to find: a loop, a wiggly line, a stop line and four color tiles. */
function drawLines(canvas, board) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  paper(ctx, canvas);
  loop(ctx, -100, -40, 0, 40, 28);
  line(ctx, [[20, 44], [40, 44], [55, 30], [70, 44], [85, 30], [100, 44], [112, 44]]);
  line(ctx, [[20, -44], [112, -44]]);
  line(ctx, [[66, -50], [66, -38]], 2.4, '#E3000B');
  for (const t of board.tiles) tile(ctx, t.x, t.y, t.size, t.color);
  startBox(ctx, board.start);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** The Training Camp table: a line to drive to, a marker to stop at, a cube to collect, a goal to bring it to. */
function drawTraining(canvas, board) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  paper(ctx, canvas);
  line(ctx, [[-20, -52], [-20, 52]]);                    // the black line across the table
  line(ctx, [[50, 20], [50, 52]], 2.4, '#0B5FC4');        // a blue line near the goal
  tile(ctx, 85, 36, 22, '#CDEBD3');                       // the goal square for the cube
  ctx.strokeStyle = '#2E8B57'; ctx.lineWidth = 3; ctx.strokeRect(X(74), Y(25), 22 * s, 22 * s);
  ctx.fillStyle = '#2E8B57'; ctx.font = `bold ${5 * s}px Nunito, Arial, sans-serif`; ctx.textAlign = 'center';
  ctx.fillText('GOAL', X(85), Y(51));
  for (const o of board.obstacles) footprint(ctx, o);
  startBox(ctx, board.start);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export const BOARDS = [
  { id: 'season', name: 'BIOGLOW season table', kind: 'season', url: 'mat/season.json' },
  {
    id: 'lines', name: 'Line practice', kind: 'drawn', draw: drawLines,
    start: { x: -95, y: 40, heading: 0 },
    tiles: [{ x: 35, y: -12, size: 18, color: '#E3000B' }, { x: 70, y: -12, size: 18, color: '#FFD500' }, { x: 35, y: 14, size: 18, color: '#00A845' }, { x: 70, y: 14, size: 18, color: '#0B5FC4' }],
    obstacles: [],
  },
  {
    id: 'training', name: 'Training camp', kind: 'drawn', draw: drawTraining,
    start: { x: -95, y: 36, heading: 0 },
    obstacles: [
      { id: 'Training marker', x: -50, y: 36, w: 3.2, d: 3.2, h: 9.6, color: '#FFD500', movable: false, model: 'models/training/marker.mpd', modelPose: { x: -50, y: 36, heading: 0 } },
      { id: 'Training cube', x: 10, y: 0, w: 4, d: 4, h: 5.6, color: '#E3000B', movable: false, model: 'models/training/cube.mpd', modelPose: { x: 10, y: 0, heading: 0 } },
      { id: 'Training cube 2', x: 10, y: -30, w: 4, d: 4, h: 5.6, color: '#E3000B', movable: false, model: 'models/training/cube.mpd', modelPose: { x: 10, y: -30, heading: 0 } },
    ],
  },
];

export function boardById(id) { return BOARDS.find((b) => b.id === id) || BOARDS[0]; }
