// Scoresheet and mission practice cards (the "Missions" panel under the hub).
import { MISSIONS, MAX_SCORE } from './missions.js';

export class MissionsPanel {
  constructor(container, { scoring, onPractice, onStopPractice }) {
    this.scoring = scoring;
    this.onPractice = onPractice;
    this.onStopPractice = onStopPractice;
    this.practising = null;
    container.innerHTML = `
      <div class="missions-head">
        <h3>Missions</h3>
        <div class="score"><b data-score>0</b> / ${MAX_SCORE} pts</div>
      </div>
      <div class="mission-card" hidden></div>
      <div class="mission-list"></div>`;
    this.scoreEl = container.querySelector('[data-score]');
    this.list = container.querySelector('.mission-list');
    this.card = container.querySelector('.mission-card');
    this.renderList();
    scoring.on((ev) => {
      if (ev.type === 'score' || ev.type === 'reset') this.renderList();
      if (ev.type === 'done') this.flash(ev.mission.id);
    });
  }

  renderList() {
    const sheet = this.scoring.sheet();
    this.scoreEl.textContent = String(this.scoring.score);
    this.list.innerHTML = sheet.map((row) => `
      <div class="mission${row.points === row.max ? ' full' : row.points ? ' part' : ''}${this.practising === row.mission.id ? ' active' : ''}" data-id="${row.mission.id}">
        <button type="button" class="pick" title="${row.mission.text.replace(/"/g, '&quot;')}">
          <span class="mid">${row.mission.id.slice(1)}</span>
          <span class="mname">${row.mission.name}</span>
          <span class="mpts">${row.points}/${row.max}</span>
        </button>
        <div class="actions">${row.actions.map((a) => `<span class="act${a.done ? ' done' : ''}${a.lost ? ' lost' : ''}">${a.done ? '&#10003;' : a.lost ? '&#10007;' : '&#9675;'} ${a.action.label} <i>${a.action.points}</i></span>`).join('')}</div>
      </div>`).join('');
    this.list.querySelectorAll('.pick').forEach((btn) => btn.addEventListener('click', () => this.select(btn.parentElement.dataset.id)));
  }

  flash(missionId) {
    const el = this.list.querySelector(`.mission[data-id="${missionId}"]`);
    if (el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); }
  }

  select(missionId) {
    const m = MISSIONS.find((x) => x.id === missionId);
    if (!m) return;
    if (this.practising === missionId) { this.stop(); return; }
    this.practising = missionId;
    this.card.hidden = false;
    const kinds = { push: 'drive into it', arm: 'lower the attachment onto it', lift: 'lower the attachment, then lift', visit: 'stop at it', avoid: 'stay away from it', auto: '' };
    this.card.innerHTML = `
      <div class="card-head"><b>${m.id} ${m.name}</b><button type="button" class="tb" data-stop>Stop practising</button></div>
      <p>${m.text}</p>
      <ul>${m.actions.map((a) => `<li><b>${a.points} pts</b> ${a.label}${kinds[a.trigger.kind] ? ` <span class="how">(${kinds[a.trigger.kind]})</span>` : ''}</li>`).join('')}</ul>
      <p class="result" data-result>Press <b>Run</b> (or Launch). The green ring marks the first target; the blue line is your path.</p>`;
    this.card.querySelector('[data-stop]').addEventListener('click', () => this.stop());
    this.renderList();
    this.onPractice(m);
  }

  stop() {
    this.practising = null;
    this.card.hidden = true;
    this.renderList();
    this.onStopPractice();
  }

  showResult(res) {
    const el = this.card.querySelector('[data-result]');
    if (!el || !res) return;
    const dist = res.dist.toFixed(0), off = Math.abs(res.off).toFixed(0);
    const where = res.dist < 10 ? 'at the target' : `${dist} cm from the target`;
    const turn = Math.abs(res.off) < 10 ? 'facing it' : `turned ${off}° ${res.off > 0 ? 'left' : 'right'} of it`;
    el.innerHTML = `Robot stopped <b>${where}</b>, ${turn}. Scored <b>${res.points}</b> pts on this mission (${res.done}/${res.total} tasks).`;
  }
}
