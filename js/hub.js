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
      <button type="button" class="hub-toggle" aria-label="Hide the hub panel" title="Hide the hub panel"></button>
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
          <div class="hub-source" role="group" aria-label="Whose readings to show" hidden>
            <button type="button" data-src="sim" class="on">Simulator</button><button type="button" data-src="real">Real hub</button>
          </div>
          <div class="ro-row">
            <div class="ro"><span class="k">yaw</span><span class="v" data-ro="yaw">0°</span></div>
            <div class="ro"><span class="k" data-k="timer">timer</span><span class="v" data-ro="timer">0.00</span></div>
            <div class="ro match"><span class="k" data-k="match">match</span><span class="v" data-ro="match">2:30</span></div>
          </div>
          <div class="ports">${PORT_LETTERS.map((p) => `<div class="port" data-port="${p}"><b>${p}</b><span class="type"></span><span class="v"></span></div>`).join('')}</div>
        </div>
      </div>`;
    // The panel folds down to a tab in the corner; the choice is remembered.
    const toggle = container.querySelector('.hub-toggle');
    const setFolded = (folded) => {
      container.classList.toggle('folded', folded);
      toggle.setAttribute('aria-label', folded ? 'Show the hub panel' : 'Hide the hub panel');
      toggle.title = folded ? 'Show the hub panel' : 'Hide the hub panel';
      try { localStorage.setItem('spikesim.hud', folded ? 'folded' : 'open'); } catch { /* ignore */ }
    };
    toggle.addEventListener('click', () => setFolded(!container.classList.contains('folded')));
    try { if (localStorage.getItem('spikesim.hud') === 'folded') setFolded(true); } catch { /* ignore */ }
    this.pixels = [...container.querySelectorAll('.px')];
    this.center = container.querySelector('.hub-center');
    this.ro = { yaw: container.querySelector('[data-ro="yaw"]'), timer: container.querySelector('[data-ro="timer"]'), match: container.querySelector('[data-ro="match"]') };
    this.matchLeft = null;
    this.keys = { timer: container.querySelector('[data-k="timer"]'), match: container.querySelector('[data-k="match"]') };
    // a connected hub's live readings (see setReal), shown instead of the simulator's when 'Real hub' is picked
    this.real = null; this.realAt = 0; this.mode = 'sim';
    this.source = container.querySelector('.hub-source');
    for (const b of this.source.querySelectorAll('button')) b.addEventListener('click', () => this.setMode(b.dataset.src));
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
    // (while no program runs the arrows drive the robot instead; see app.js)
    document.addEventListener('keydown', (e) => {
      if (e.repeat || isTyping() || !document.body.classList.contains('running')) return;
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

  /** Live readings from a connected hub (ble.js parseDevices), or null when it is gone. */
  setReal(data) {
    const first = !this.real && data;
    this.real = data; this.realAt = performance.now();
    this.source.hidden = !data;
    if (first) this.setMode('real');
    if (!data && this.mode === 'real') this.setMode('sim');
    this.lastText = 0;
  }

  setMode(mode) {
    this.mode = mode === 'real' && this.real ? 'real' : 'sim';
    for (const b of this.source.querySelectorAll('button')) b.classList.toggle('on', b.dataset.src === this.mode);
    this.container.classList.toggle('real', this.mode === 'real');
    this.keys.timer.textContent = this.mode === 'real' ? 'battery' : 'timer';
    this.keys.match.textContent = this.mode === 'real' ? 'tilt' : 'match';
    this.ro.match.parentElement.classList.remove('over', 'late');
    this.ro.match.classList.remove('tight');
    if (this.mode === 'sim' && this.matchLeft === null) this.ro.match.textContent = '2:30';
    if (this.mode === 'sim') { this.updatePortTypes(); this.drawMatrix(); for (const p of PORT_LETTERS) { this.ports[p].classList.remove('mismatch'); this.ports[p].title = ''; } }
    this.lastText = 0;
  }

  /** What the simulator's robot has on each port: 'motor', a sensor type, or null for nothing in particular. */
  simKind(p) {
    const c = this.robot.config;
    if (c.sensors[p]) return c.sensors[p];
    return p === c.left || p === c.right || p === c.attachment || (c.tools || []).includes(p) ? 'motor' : null;
  }

  drawReal(now) {
    const d = this.real, stale = now - this.realAt > 1500;
    const imu = d.imu;
    this.ro.yaw.textContent = stale ? 'no data' : imu ? `${Math.round(-imu.yaw / 10)}°` : '—';
    this.ro.timer.textContent = d.battery === null ? '—' : `${d.battery}%`;
    const tilt = imu ? `${Math.round(imu.pitch / 10)}° ${Math.round(imu.roll / 10)}°` : '—';
    this.ro.match.textContent = tilt;
    this.ro.match.classList.toggle('tight', tilt.length > 7);   // big angles: a little smaller so both fit
    if (d.matrix) {
      const top = Math.max(9, ...d.matrix);
      this.pixels.forEach((px, i) => { const b = d.matrix[i] / top; px.style.opacity = b > 0 ? String(0.3 + 0.7 * b) : ''; px.classList.toggle('on', b > 0); });
    }
    for (const p of PORT_LETTERS) {
      const el = this.ports[p], dev = d.ports[p], v = el.querySelector('.v');
      el.querySelector('.type').textContent = dev ? dev.name : 'empty';
      el.dataset.type = dev ? (dev.kind === 'color' ? 'color sensor' : dev.kind === 'distance' ? 'distance' : dev.kind === 'force' ? 'force sensor' : 'motor') : '';
      if (!dev) v.textContent = '';
      else if (dev.kind === 'motor') v.textContent = `${((dev.position % 360) + 360) % 360}° · ${dev.speed}%`;
      else if (dev.kind === 'color') {
        const m = Math.max(1, ...dev.rgb), sw = dev.rgb.map((c) => Math.round((c / m) * 255));
        v.innerHTML = `<i class="sw" style="background:${rgb(sw)}"></i>${dev.colorName}`;
      } else if (dev.kind === 'distance') v.textContent = dev.mm === null ? 'none' : `${(dev.mm / 10).toFixed(1)} cm`;
      else if (dev.kind === 'force') v.textContent = `${(dev.value / 10).toFixed(1)} N${dev.pressed ? ' · pressed' : ''}`;
      else v.textContent = '';
      // the real robot is wired differently from the simulator's: say so on the port
      const want = this.simKind(p), have = dev ? dev.kind : null;
      const off = !!want && want !== have;
      el.classList.toggle('mismatch', off);
      el.title = off ? `The simulator's robot has a ${want === 'motor' ? 'motor' : want + ' sensor'} on port ${p}; the real hub has ${have ? (have === 'motor' ? 'a motor' : 'a ' + have + ' sensor') : 'nothing'} there.` : '';
    }
  }

  updatePortTypes() {
    if (this.mode === 'real') return;
    const c = this.robot.config;
    for (const p of PORT_LETTERS) {
      const el = this.ports[p];
      const sensor = c.sensors[p];
      const type = p === c.left ? 'left wheel' : p === c.right ? 'right wheel' : sensor === 'color' ? 'color sensor' : sensor === 'distance' ? 'distance' : sensor === 'force' ? 'force sensor' : p === c.attachment ? 'attachment' : (c.tools || []).includes(p) ? 'tool motor' : 'motor';
      el.querySelector('.type').textContent = type;
      el.dataset.type = type;
    }
  }

  drawMatrix() {
    if (this.mode === 'real') return;
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
    if (this.mode === 'real' && this.real) { this.drawReal(now); return; }
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
      if (c.sensors[p] === 'color') {
        const s = r.colorSample(p);
        v.innerHTML = s ? `<i class="sw" style="background:${rgb(s.rgb)}"></i>${s.name} · ${s.reflect}%` : '—';
      } else if (c.sensors[p] === 'force') {
        const f = r.forceSample(p);
        v.textContent = f ? `${f.newtons.toFixed(1)} N${f.hard ? ' · hard' : f.pressed ? ' · pressed' : ''}` : '—';
      } else if (c.sensors[p] === 'distance') {
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
