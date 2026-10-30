// A small card over the 3D view for the mission model that was clicked, plus the score chip.
import { MISSIONS } from './missions.js';

export function missionsForObstacle(obstacle) {
  return MISSIONS.filter((m) => m.models.includes(obstacle.id));
}

export class ModelCard {
  constructor(card, chip, { scoring, onPractice, onClose }) {
    this.card = card; this.chip = chip; this.scoring = scoring;
    this.onPractice = onPractice; this.onClose = onClose;
    this.obstacle = null; this.practicing = null; this.result = null;
    scoring.on((ev) => {
      const x = scoring.extras();
      this.chip.textContent = x.launched ? `${scoring.score} pts · ${x.tokens} tokens` : `${scoring.score} pts`;
      this.chip.title = x.launched ? `Missions ${x.missions} + inspection ${x.inspection} + precision tokens ${x.tokenPoints}${x.ended ? ' (final)' : ''}` : 'Mission points if the match ended now';
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
      const tasks = row.tasks.filter((t) => t.task.points > 0 || t.task.count).map((t) => {
        const pts = t.task.count ? `${t.count * t.task.each}` : `${t.task.points}`;
        return `<div class="task${t.done ? ' done' : ''}"><span>${t.done ? '&#10003;' : '&#9675;'}</span><span>${t.task.label}${t.task.how ? ` <span class="how">· ${t.task.how}</span>` : ''}</span><span class="pts">${pts}</span></div>`;
      }).join('') + (row.zero ? '<div class="task lost"><span>&#10007;</span><span>This mission scores zero right now (see the rulebook note on the card).</span><span class="pts">0</span></div>' : '') +
        (m.noEquipment ? '<p class="note">No equipment constraint: nothing scores if the model is touching the robot when the match ends.</p>' : '');
      const practicing = this.practicing === m.id;
      return `<div class="mission-block" data-mission="${m.id}">
        <div class="head"><span class="num">${m.id.slice(1)}</span><span class="title">${m.name}</span></div>
        <p class="text">${m.text}</p>
        ${tasks}
        <div class="foot"><span class="total">${row.points} / ${row.max} pts</span><button type="button" class="tb${practicing ? '' : ' primary'}" data-practice="${m.id}">${practicing ? 'Stop practicing' : 'Practice this'}</button></div>
        ${practicing && this.result ? `<p class="result">${this.resultText(this.result)}</p>` : practicing ? '<p class="result">Press Run or Launch. The green ring is the first target; the blue line is your path.</p>' : ''}
      </div>`;
    });
    this.card.innerHTML = `<button type="button" class="close" aria-label="Close">&times;</button>` +
      (blocks.length ? blocks.join('<hr>') : `<div class="head"><span class="title">${this.obstacle.id}</span></div><p class="text">No scored tasks for this model.</p>`);
    this.card.querySelector('.close').addEventListener('click', () => this.close());
    this.card.querySelectorAll('[data-practice]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.practice;
      if (this.practicing === id) { this.practicing = null; this.onPractice(null); }
      else { this.practicing = id; this.result = null; this.onPractice(MISSIONS.find((m) => m.id === id)); }
      this.render();
    }));
  }

  resultText(res) {
    const where = res.dist < 10 ? 'at the target' : `${res.dist.toFixed(0)} cm from the target`;
    const turn = Math.abs(res.off) < 10 ? 'facing it' : `turned ${Math.abs(res.off).toFixed(0)}° ${res.off > 0 ? 'left' : 'right'} of it`;
    return `Robot stopped <b>${where}</b>, ${turn}. ${res.points} pts (${res.done}/${res.total} tasks).`;
  }
}
