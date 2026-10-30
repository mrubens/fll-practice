// A small card over the 3D view for the mission model that was clicked, plus the score chip.
import { MISSIONS } from './missions.js';

export function missionsForObstacle(obstacle) {
  return MISSIONS.filter((m) => m.models.includes(obstacle.id));
}

export class ModelCard {
  constructor(card, chip, { scoring, onClose }) {
    this.card = card; this.chip = chip; this.scoring = scoring;
    this.onClose = onClose;
    this.obstacle = null;
    this.sheet = document.getElementById('scoreSheet');
    this.log = [];
    this.wasLaunched = false;
    scoring.on((ev) => {
      if (ev.type === 'reset') { this.log = []; this.wasLaunched = false; }
      if (ev.type === 'done') this.log.push({ text: `+${ev.task.count ? ev.task.each : ev.task.points} ${ev.task.label}`, mission: ev.mission.id });
      if (ev.type === 'lost') this.log.push({ text: `−${ev.task.points} ${ev.task.label}`, mission: ev.mission.id, lost: true });
      if (ev.type === 'token') this.log.push({ text: `−1 precision token (${ev.tokens} left)`, lost: true });
      if (ev.type === 'end') this.log.push({ text: `Match over: ${ev.score} pts` });
      const x = scoring.extras();
      if (x.launched && !this.wasLaunched) { this.wasLaunched = true; this.log.push({ text: x.inspection ? `+${x.inspection} equipment inspection, 6 precision tokens` : 'Inspection failed: no bonus. 6 precision tokens' }); }
      this.renderChip();
      if (this.obstacle) this.render();
    });
    this.chip.addEventListener('click', () => { if (this.sheet.hidden) this.openSheet(); else this.closeSheet(); });
    this.renderChip();
  }

  renderChip() {
    const sc = this.scoring, x = sc.extras();
    this.chip.querySelector('.pts').textContent = x.launched ? `${sc.score} pts · ${x.tokens} tokens` : `${sc.score} pts`;
    if (!this.sheet.hidden) this.renderSheet();
  }

  openSheet() { this.sheet.hidden = false; if (!this.card.hidden) this.close(); this.renderSheet(); }
  closeSheet() { this.sheet.hidden = true; }

  renderSheet() {
    const sc = this.scoring, x = sc.extras();
    const rows = sc.sheet().map((row) => {
      const done = row.tasks.filter((t) => t.done).map((t) => t.task.label.replace(/^Bonus: /, 'bonus: '));
      const cls = row.zero ? 'zero' : row.points > 0 ? 'scored' : '';
      return `<div class="row ${cls}"><span class="m">${row.mission.id}</span><span class="n">${row.mission.name}${done.length ? `<small>${done.join(' · ')}</small>` : ''}</span><span class="p">${row.points}<span style="color:var(--muted);font-weight:600">/${row.max}</span></span></div>`;
    }).join('');
    const extras = x.launched ? `<div class="extras">Missions ${x.missions} + inspection ${x.inspection} + ${x.tokens} precision tokens ${x.tokenPoints}${x.ended ? ' · final' : ''}</div>` : '<div class="extras">Press Launch for a scored match (inspection bonus and precision tokens).</div>';
    const log = this.log.length ? `<div class="log">${this.log.slice(-8).reverse().map((l) => `<div class="${l.lost ? 'lost' : ''}">${l.mission ? l.mission + ' ' : ''}${l.text}</div>`).join('')}</div>` : '';
    this.sheet.innerHTML = `<h4><span>Scoresheet</span><span>${sc.score} pts</span></h4>${rows}${extras}${log}`;
  }

  show(obstacle) {
    this.closeSheet();
    this.obstacle = obstacle;
    this.card.hidden = false;
    this.render();
  }

  close() {
    this.card.hidden = true;
    this.obstacle = null;
    this.onClose();
  }

  render() {
    const missions = missionsForObstacle(this.obstacle);
    const sheet = this.scoring.sheet();
    const blocks = missions.map((m) => {
      const row = sheet.find((s) => s.mission.id === m.id);
      const tasks = row.tasks.filter((t) => t.task.points > 0 || t.task.count).map((t) => {
        const pts = t.task.count ? `${t.count * t.task.each}` : `${t.task.points}`;
        return `<div class="task${t.done ? ' done' : ''}"><span>${t.done ? '&#10003;' : '&#9675;'}</span><span>${t.task.label}${t.task.how ? ` <span class="how">· ${t.task.how}</span>` : ''}</span><span class="pts">${pts}</span></div>`;
      }).join('') + (row.zero ? '<div class="task lost"><span>&#10007;</span><span>This mission scores zero right now (see the rulebook note on the card).</span><span class="pts">0</span></div>' : '') +
        (m.noEquipment ? '<p class="note">No equipment constraint: nothing scores if the model is touching the robot when the match ends.</p>' : '');
      return `<div class="mission-block" data-mission="${m.id}">
        <div class="head"><span class="num">${m.id.slice(1)}</span><span class="title">${m.name}</span></div>
        <p class="text">${m.text}</p>
        ${tasks}
        <div class="foot"><span class="total">${row.points} / ${row.max} pts</span></div>
      </div>`;
    });
    this.card.innerHTML = `<button type="button" class="close" aria-label="Close">&times;</button>` +
      (blocks.length ? blocks.join('<hr>') : `<div class="head"><span class="title">${this.obstacle.id}</span></div><p class="text">No scored tasks for this model.</p>`);
    this.card.querySelector('.close').addEventListener('click', () => this.close());
  }
}
