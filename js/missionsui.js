// A small card over the 3D view for the mission model that was clicked, plus the score chip.
import { MISSIONS } from './missions.js';

const HOW = { push: 'drive into it', arm: 'lower the attachment onto it', lift: 'lower the attachment, then lift', visit: 'stop at it', avoid: 'keep away from it', auto: '' };

export function missionsForObstacle(obstacle) {
  return MISSIONS.filter((m) => m.models.includes(obstacle.id));
}

export class ModelCard {
  constructor(card, chip, { scoring, onPractice, onClose }) {
    this.card = card; this.chip = chip; this.scoring = scoring;
    this.onPractice = onPractice; this.onClose = onClose;
    this.obstacle = null; this.practising = null; this.result = null;
    scoring.on((ev) => {
      this.chip.textContent = `${scoring.score} pts`;
      if (this.obstacle) this.render();
    });
  }

  show(obstacle) {
    this.obstacle = obstacle;
    this.result = null;
    this.card.hidden = false;
    this.render();
  }

  close() {
    this.card.hidden = true;
    this.obstacle = null;
    this.onClose();
  }

  setResult(res) { this.result = res; if (this.obstacle) this.render(); }

  render() {
    const missions = missionsForObstacle(this.obstacle);
    const sheet = this.scoring.sheet();
    const blocks = missions.map((m) => {
      const row = sheet.find((s) => s.mission.id === m.id);
      const tasks = row.actions.map((a) => `<div class="task${a.done ? ' done' : ''}${a.lost ? ' lost' : ''}"><span>${a.done ? '&#10003;' : a.lost ? '&#10007;' : '&#9675;'}</span><span>${a.action.label}${HOW[a.action.trigger.kind] ? ` <span class="how">· ${HOW[a.action.trigger.kind]}</span>` : ''}</span><span class="pts">${a.action.points}</span></div>`).join('');
      const practising = this.practising === m.id;
      return `<div class="mission-block" data-mission="${m.id}">
        <div class="head"><span class="num">${m.id.slice(1)}</span><span class="title">${m.name}</span></div>
        <p class="text">${m.text}</p>
        ${tasks}
        <div class="foot"><span class="total">${row.points} / ${row.max} pts</span><button type="button" class="tb${practising ? '' : ' primary'}" data-practice="${m.id}">${practising ? 'Stop practising' : 'Practise this'}</button></div>
        ${practising && this.result ? `<p class="result">${this.resultText(this.result)}</p>` : practising ? '<p class="result">Press Run or Launch. The green ring is the first target; the blue line is your path.</p>' : ''}
      </div>`;
    });
    this.card.innerHTML = `<button type="button" class="close" aria-label="Close">&times;</button>` +
      (blocks.length ? blocks.join('<hr>') : `<div class="head"><span class="title">${this.obstacle.id}</span></div><p class="text">No scored tasks for this model.</p>`);
    this.card.querySelector('.close').addEventListener('click', () => this.close());
    this.card.querySelectorAll('[data-practice]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.practice;
      if (this.practising === id) { this.practising = null; this.onPractice(null); }
      else { this.practising = id; this.result = null; this.onPractice(MISSIONS.find((m) => m.id === id)); }
      this.render();
    }));
  }

  resultText(res) {
    const where = res.dist < 10 ? 'at the target' : `${res.dist.toFixed(0)} cm from the target`;
    const turn = Math.abs(res.off) < 10 ? 'facing it' : `turned ${Math.abs(res.off).toFixed(0)}° ${res.off > 0 ? 'left' : 'right'} of it`;
    return `Robot stopped <b>${where}</b>, ${turn}. ${res.points} pts (${res.done}/${res.total} tasks).`;
  }
}
