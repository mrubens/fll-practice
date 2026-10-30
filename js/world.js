// The table: an FLL-sized mat (236 x 114 cm) with walls, a black line loop, colour tiles and obstacles.
// The mat is drawn once onto a canvas that is both the 3D texture and the colour-sensor lookup.

export const TABLE = { w: 236, h: 114, wall: 2.5, wallHeight: 9 };
export const PX_PER_CM = 2;

export const START_POSE = { x: -95, y: 40, heading: 0 };

export const OBSTACLES = [
  { id: 'crate', x: 95, y: 40, w: 14, d: 14, h: 10, color: '#B8C0CC' },
  { id: 'wall', x: 100, y: -18, w: 10, d: 30, h: 12, color: '#E3000B' },
  { id: 'cone', x: 20, y: -5, w: 8, d: 8, h: 14, color: '#FFD500' },
];

export const TILES = [
  { x: 35, y: -32, size: 18, color: '#E3000B' },
  { x: 70, y: -32, size: 18, color: '#FFD500' },
  { x: 35, y: 0, size: 18, color: '#00A845' },
  { x: 70, y: 0, size: 18, color: '#0B5FC4' },
];

export const LINE = { x0: -100, y0: -40, x1: 0, y1: 40, radius: 28, width: 2.4 };

export function createMatCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = TABLE.w * PX_PER_CM;
  canvas.height = TABLE.h * PX_PER_CM;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const s = PX_PER_CM;
  const X = (cm) => (cm + TABLE.w / 2) * s;
  const Y = (cm) => (cm + TABLE.h / 2) * s;

  ctx.fillStyle = '#F5F2EA';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 10 cm grid so kids can estimate distances.
  ctx.strokeStyle = '#E4E0D5';
  ctx.lineWidth = 1;
  for (let cm = -110; cm <= 110; cm += 10) { ctx.beginPath(); ctx.moveTo(X(cm), 0); ctx.lineTo(X(cm), canvas.height); ctx.stroke(); }
  for (let cm = -50; cm <= 50; cm += 10) { ctx.beginPath(); ctx.moveTo(0, Y(cm)); ctx.lineTo(canvas.width, Y(cm)); ctx.stroke(); }

  // Colour tiles.
  for (const t of TILES) {
    ctx.fillStyle = t.color;
    const half = t.size / 2;
    ctx.fillRect(X(t.x - half), Y(t.y - half), t.size * s, t.size * s);
  }

  // Black line loop (rounded rectangle) for line following.
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = LINE.width * s;
  ctx.lineJoin = 'round';
  roundRect(ctx, X(LINE.x0), Y(LINE.y0), (LINE.x1 - LINE.x0) * s, (LINE.y1 - LINE.y0) * s, LINE.radius * s);
  ctx.stroke();

  // Start box.
  ctx.strokeStyle = '#8A93A3';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(X(START_POSE.x - 12), Y(START_POSE.y - 11), 24 * s, 22 * s);
  ctx.setLineDash([]);
  ctx.fillStyle = '#8A93A3';
  ctx.font = `bold ${7 * s}px Nunito, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('START', X(START_POSE.x), Y(START_POSE.y - 14));

  // Obstacle footprints (so the mat shows where they stand).
  for (const o of OBSTACLES) {
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 2;
    ctx.strokeRect(X(o.x - o.w / 2), Y(o.y - o.d / 2), o.w * s, o.d * s);
  }

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { canvas, image };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export class World {
  constructor() {
    const { canvas, image } = createMatCanvas();
    this.matCanvas = canvas;
    this.matImage = image;
    this.obstacles = OBSTACLES.map((o) => ({ ...o }));
    this.innerHalfW = TABLE.w / 2;
    this.innerHalfH = TABLE.h / 2;
  }

  /** RGB of the mat at a point (cm, table centre origin, y down). Off-mat is white. */
  sampleRGB(x, y) {
    const px = Math.floor((x + TABLE.w / 2) * PX_PER_CM);
    const py = Math.floor((y + TABLE.h / 2) * PX_PER_CM);
    const img = this.matImage;
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) return [255, 255, 255];
    const i = (py * img.width + px) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  }

  /** Segments (walls + obstacle sides) used by the distance sensor. */
  segments() {
    const hw = this.innerHalfW, hh = this.innerHalfH;
    const segs = [
      [-hw, -hh, hw, -hh], [hw, -hh, hw, hh], [hw, hh, -hw, hh], [-hw, hh, -hw, -hh],
    ];
    for (const o of this.obstacles) {
      const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, y0 = o.y - o.d / 2, y1 = o.y + o.d / 2;
      segs.push([x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]);
    }
    return segs;
  }

  /** Distance (cm) from (x,y) along (dx,dy) to the first wall/obstacle, or Infinity. */
  raycast(x, y, dx, dy, maxDist = 250) {
    let best = Infinity;
    for (const [ax, ay, bx, by] of this.segments()) {
      const ex = bx - ax, ey = by - ay;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-9) continue;
      const t = ((ax - x) * ey - (ay - y) * ex) / denom;
      const u = ((ax - x) * dy - (ay - y) * dx) / denom;
      if (t >= 0 && u >= 0 && u <= 1 && t < best) best = t;
    }
    return best > maxDist ? Infinity : best;
  }

  /** Keep a circle of radius r inside the walls and outside the obstacles. Returns the corrected point. */
  resolveCircle(x, y, r) {
    const hw = this.innerHalfW - r, hh = this.innerHalfH - r;
    x = Math.max(-hw, Math.min(hw, x));
    y = Math.max(-hh, Math.min(hh, y));
    for (const o of this.obstacles) {
      const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, y0 = o.y - o.d / 2, y1 = o.y + o.d / 2;
      const cx = Math.max(x0, Math.min(x1, x)), cy = Math.max(y0, Math.min(y1, y));
      let ddx = x - cx, ddy = y - cy;
      const dist = Math.hypot(ddx, ddy);
      if (dist >= r) continue;
      if (dist < 1e-6) {
        // Centre inside the box: push out along the shortest axis.
        const pushes = [[x0 - r - x, 0], [x1 + r - x, 0], [0, y0 - r - y], [0, y1 + r - y]];
        pushes.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
        x += pushes[0][0]; y += pushes[0][1];
      } else {
        const push = (r - dist) / dist;
        x += ddx * push; y += ddy * push;
      }
    }
    return [x, y];
  }
}
