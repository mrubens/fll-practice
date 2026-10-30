// Hub panel: a 2D hub with the 5x5 matrix, clickable left/right buttons, sensor/motor readouts and sound.
import { PORT_LETTERS } from './robot.js';

export class HubPanel {
  constructor(container, robot) {
    this.robot = robot;
    this.container = container;
    this.lastSoundVersion = -1;
    this.osc = null;
    this.audio = null;
    this.lastText = 0;
    container.innerHTML = `
      <div class="hub">
        <div class="hub-face">
          <div class="hub-top"><span class="hub-dot"></span><span class="hub-name">SPIKE Prime Hub</span></div>
          <div class="hub-matrix" aria-label="LED matrix">${'<span class="px"></span>'.repeat(25)}</div>
          <div class="hub-buttons">
            <button type="button" class="hub-btn" data-side="left" aria-label="Left button">&#9664;</button>
            <button type="button" class="hub-btn hub-center" aria-label="Center button"></button>
            <button type="button" class="hub-btn" data-side="right" aria-label="Right button">&#9654;</button>
          </div>
        </div>
        <div class="hub-readouts">
          <div class="ro-row">
            <div class="ro"><span class="k">yaw</span><span class="v" data-ro="yaw">0°</span></div>
            <div class="ro"><span class="k">timer</span><span class="v" data-ro="timer">0.00</span></div>
            <div class="ro match"><span class="k">match</span><span class="v" data-ro="match">2:30</span></div>
          </div>
          <div class="ports">${PORT_LETTERS.map((p) => `<div class="port" data-port="${p}"><b>${p}</b><span class="type"></span><span class="v"></span></div>`).join('')}</div>
        </div>
      </div>`;
    this.pixels = [...container.querySelectorAll('.px')];
    this.center = container.querySelector('.hub-center');
    this.ro = { yaw: container.querySelector('[data-ro="yaw"]'), timer: container.querySelector('[data-ro="timer"]'), match: container.querySelector('[data-ro="match"]') };
    this.matchLeft = null;
    this.ports = {};
    for (const p of PORT_LETTERS) this.ports[p] = container.querySelector(`.port[data-port="${p}"]`);

    for (const btn of container.querySelectorAll('.hub-btn[data-side]')) {
      const side = btn.dataset.side;
      const down = (e) => { e.preventDefault(); btn.classList.add('down'); robot.setButton(side, true); };
      const up = () => { btn.classList.remove('down'); robot.setButton(side, false); };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
      btn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') down(e); });
      btn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') up(); });
    }
    // Arrow keys press the hub buttons when the focus is not in a text field.
    document.addEventListener('keydown', (e) => {
      if (e.repeat || isTyping()) return;
      if (e.key === 'ArrowLeft') robot.setButton('left', true);
      if (e.key === 'ArrowRight') robot.setButton('right', true);
    });
    document.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft') robot.setButton('left', false);
      if (e.key === 'ArrowRight') robot.setButton('right', false);
    });

    robot.on('matrix', () => this.drawMatrix());
    robot.on('light', () => this.drawLight());
    this.drawMatrix();
    this.drawLight();
    this.updatePortTypes();
  }

  updatePortTypes() {
    const c = this.robot.config;
    for (const p of PORT_LETTERS) {
      const el = this.ports[p];
      const type = p === c.left ? 'left wheel' : p === c.right ? 'right wheel' : p === c.color ? 'color sensor' : p === c.distance ? 'distance' : p === c.attachment ? 'attachment' : 'motor';
      el.querySelector('.type').textContent = type;
      el.dataset.type = type;
    }
  }

  drawMatrix() {
    const m = this.robot.hub.matrix;
    this.pixels.forEach((px, i) => {
      const b = m[i] / 9;
      px.style.opacity = b > 0 ? String(0.3 + 0.7 * b) : '';
      px.classList.toggle('on', b > 0);
    });
  }

  drawLight() {
    const c = this.robot.hub.centerColor;
    this.center.style.background = c || '';
    this.center.classList.toggle('lit', !!c);
  }

  ensureAudio() {
    if (this.audio) return;
    try { this.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.audio = null; }
  }

  syncSound() {
    const s = this.robot.hub.sound;
    if (s.version === this.lastSoundVersion) return;
    this.lastSoundVersion = s.version;
    if (this.osc) { try { this.osc.stop(); } catch { /* ignore */ } this.osc = null; }
    if (s.note === null || !this.audio) return;
    if (this.audio.state === 'suspended') this.audio.resume().catch(() => {});
    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = 'square';
    osc.frequency.value = 440 * Math.pow(2, (s.note - 69) / 12);
    gain.gain.value = 0.08;
    osc.connect(gain).connect(this.audio.destination);
    osc.start();
    this.osc = osc;
  }

  update(now) {
    this.syncSound();
    if (now - this.lastText < 100) return;
    this.lastText = now;
    const r = this.robot;
    this.ro.yaw.textContent = `${r.yaw()}°`;
    this.ro.timer.textContent = r.timer().toFixed(2);
    if (this.matchLeft !== null) {
      const s = Math.max(0, Math.ceil(this.matchLeft));
      this.ro.match.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      this.ro.match.parentElement.classList.toggle('over', this.matchLeft <= 0);
      this.ro.match.parentElement.classList.toggle('late', this.matchLeft > 0 && this.matchLeft <= 30);
    }
    const c = r.config;
    for (const p of PORT_LETTERS) {
      const v = this.ports[p].querySelector('.v');
      if (p === c.color) {
        const s = r.colorSample(p);
        v.innerHTML = s ? `<i class="sw" style="background:${rgb(s.rgb)}"></i>${s.name} · ${s.reflect}%` : '—';
      } else if (p === c.distance) {
        const d = r.distanceCm(p);
        v.textContent = d === null ? 'none' : `${Math.round(d)} cm`;
      } else {
        const m = r.motors[p];
        v.textContent = `${Math.round(((m.angle % 360) + 360) % 360)}° · ${m.stalled ? 'stalled' : Math.round((m.velocity / 9)) + '%'}`;
      }
    }
  }
}

const rgb = ([r, g, b]) => `rgb(${r},${g},${b})`;
function isTyping() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
}
