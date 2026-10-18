// Fig 2's live tour: Claude prepares two items and sends each down the tube into the To review
// rack; the member pulls the lever, and only the bottom bar rides the conveyor into the line, while
// the other waits. tour.js runs it on the plate in the page; the web app and the preview pages
// bundle the same code with the kit functions it uses.
import { lineOnTop, solidSvg, translateAlong } from '../../vendor/anatomy/kit/iso-kit.mjs';
import { add3, disc, frameAlong, mul3, sphereOf } from '../../vendor/anatomy/kit/lathe.mjs';
import { ease, lerp, rupees, runTour } from './tour.js';

/** The member's lever at an angle: a rod from its boss, and a lit knob. */
export function leverSvg(P, lever, angle) {
  const base = [lever.x, lever.y, lever.z];
  const dir = [0, Math.sin(angle), Math.cos(angle)];
  const F = frameAlong(base, dir);
  const tip = add3(base, mul3(dir, lever.length));
  return (
    solidSvg(disc(0, lever.length, lever.r, F, P, { steps: 16 }), { tone: 'mid' }) +
    solidSvg(sphereOf(tip, lever.knob, P, { steps: 32 }), { tone: 'hi', lit: true })
  );
}

/** The conveyor belt's cross marks, moved on by how far it has run. */
export function beltMarksSvg(P, belt, travel) {
  const pitch = 12;
  let d = '';
  for (let x = belt.x0 + 3 + (travel % pitch); x < belt.x1 - 2; x += pitch)
    d += lineOnTop([x, belt.y0], [x, belt.y1], belt.top, P);
  return `<path class="iso-line" data-tone="faint" d="${d}"/>`;
}

/** Starts the tour on root; returns a function that stops it and leaves the drawing as it is. */
export function playTour(root, D) {
  return runTour(root, (tour) => toReviewRack(tour, D));
}

/** The To review rack's scene, for runTour. */
function toReviewRack({ svg, say, tell }, D) {
  const P = D.P;
  const q = (sel) => svg.querySelector(sel);
  const T = (dx, dy, dz) => translateAlong(P, [dx, dy, dz]);
  // How fast a bar falls into the rack, in units per second squared.
  const GRAVITY = 700;

  const barEls = D.items.map((_, i) => q(`[data-bar="${i}"]`));
  const store = q('[data-part="store"]');
  const inRack = q('[data-part="in-rack"]');
  const onBelt = q('[data-part="on-belt"]');
  const gate = q('[data-part="gate"]');
  const lever = q('[data-part="lever"]');
  const count = q('[data-count="rack"]');
  const lamp = q('[data-lamp="link"]');
  const marks = q('[data-part="belt-marks"]');
  const term = [0, 1, 2].map((i) => q(`.rv-desk [data-line="${i}"]:not([data-hood])`));
  const hood = [0, 1].map((i) => q(`[data-hood="${i}"]`));

  const set = (els, lines) =>
    els.forEach((el, i) => {
      if (el.textContent !== (lines[i] ?? '')) el.textContent = lines[i] ?? '';
    });
  const named = (item) => `${item.title} ${rupees(item.amountMinor)}`;
  const split = (item) =>
    item.chips.every((c) => c === item.chips[0])
      ? `${item.chips.length} × ${rupees(item.chips[0])}`
      : `${item.chips.length} chips`;

  // ---------------------------------------------------------------- state
  let phase = 'idle';
  let clock = 0;
  let waiting = 0;
  let beltTravel = 0;
  const pose = { lever: D.lever.rest, gate: 0 };
  const bar = D.items.map(() => ({ x: 0, slot: 0, z: 0, fall: 0, where: 'store' }));

  function restart() {
    phase = 'idle';
    clock = 0;
    waiting = 0;
    beltTravel = 0;
    pose.lever = D.lever.rest;
    pose.gate = 0;
    bar.forEach((b, i) => {
      Object.assign(b, { x: 0, slot: 0, z: 0, fall: 0, where: 'store' });
      barEls[i].style.display = 'none';
      store.appendChild(barEls[i]);
    });
    set(term, D.screens.termIdle);
    set(hood, D.screens.hoodIdle);
    lamp.setAttribute('data-on', '');
    tell('Claude connected · To review empty');
  }
  function send(i) {
    phase = `send${i}`;
    clock = 0;
    const item = D.items[i];
    set(term, D.screens.termSend[i]);
    tell(`Claude prepares ${named(item)} · ${split(item)}`);
  }
  function release() {
    phase = 'release';
    clock = 0;
    tell(`You pull the lever · ${named(D.items[0])} is saved`);
  }
  function hold() {
    phase = 'hold';
    clock = 0;
    set(term, D.screens.termHold);
    tell(D.stillWords);
  }

  function update(dt, calm) {
    clock += dt;
    if (phase === 'idle') {
      if (clock > 1.8) send(0);
    } else if (phase === 'send0' || phase === 'send1') {
      const i = phase === 'send0' ? 0 : 1;
      const b = bar[i];
      if (b.where === 'store' && (calm || clock > 0.9)) {
        b.where = 'falling';
        b.slot = i;
        b.z = D.rack.top - 4 - D.rack.z0;
        b.fall = 0;
        b.x = 0;
        inRack.appendChild(barEls[i]);
        barEls[i].style.display = '';
      }
      if (b.where === 'falling') {
        b.fall += dt;
        const floor = b.slot * D.chipH;
        b.z = calm
          ? floor
          : Math.max(floor, D.rack.top - 4 - D.rack.z0 - 0.5 * GRAVITY * b.fall * b.fall);
        if (b.z <= floor) {
          b.where = 'rack';
          waiting += 1;
          // A beat within the step: the live region keeps the step's words.
          say(`${named(D.items[i])} is in To review · waiting for you`);
        }
      }
      if (b.where === 'rack' && clock > 2.4) {
        if (i === 0) send(1);
        else release();
      }
    } else if (phase === 'release') {
      const b = bar[0];
      const upper = bar[1];
      const len = D.items[0].chips.length * D.cw;
      pose.lever = lerp(D.lever.rest, D.lever.pulled, calm ? 1 : ease(clock / 0.45));
      if (b.where === 'rack') {
        pose.gate = calm ? 7 : 7 * ease((clock - 0.3) / 0.3);
        if (calm || clock > 0.65) b.where = 'sliding';
      }
      if (b.where === 'sliding') {
        const step = calm ? 999 : 115 * dt;
        b.x += step;
        if (b.x - len / 2 > D.rack.x1 - D.rack.x && barEls[0].parentNode !== onBelt)
          onBelt.appendChild(barEls[0]);
        // Shown settled, the belt has not run: the still's marks are where the drawing rests.
        if (barEls[0].parentNode === onBelt && !calm) beltTravel += step;
        if (b.x - len / 2 > D.rack.x1 + 5 - D.rack.x) {
          pose.gate = Math.max(0, pose.gate - dt * 30);
          if (upper.where === 'rack' && upper.slot === 1) {
            upper.where = 'settling';
            upper.fall = 0;
          }
        }
        if (b.x >= D.hood.x + len / 2 + 2 - D.rack.x) {
          b.where = 'saved';
          barEls[0].style.display = 'none';
          waiting -= 1;
          set(hood, D.screens.hoodSaved);
        }
      }
      if (upper.where === 'settling') {
        upper.fall += dt;
        upper.z = calm ? 0 : Math.max(0, D.chipH - 0.5 * GRAVITY * upper.fall * upper.fall);
        if (upper.z <= 0) {
          upper.where = 'rack';
          upper.slot = 0;
        }
      }
      if (b.where === 'saved') {
        pose.lever = lerp(D.lever.pulled, D.lever.rest, calm ? 1 : ease((clock - 1.6) / 0.5));
        pose.gate = 0;
        if (calm || clock > 2.4) hold();
      }
    } else if (phase === 'hold') {
      if (clock > 3.6) restart();
    }
  }

  function draw() {
    bar.forEach((b, i) => {
      if (b.where === 'store' || b.where === 'saved') return;
      const z =
        b.where === 'rack'
          ? b.slot * D.chipH
          : b.where === 'falling' || b.where === 'settling'
            ? b.z
            : 0;
      barEls[i].setAttribute('transform', T(D.rack.x + b.x, 0, D.rack.z0 + z));
    });
    gate.setAttribute('transform', T(0, 0, pose.gate));
    lever.innerHTML = leverSvg(P, D.lever, pose.lever);
    const v = String(Math.max(0, waiting));
    if (count.textContent !== v) count.textContent = v;
    marks.innerHTML = beltMarksSvg(P, D.belt, beltTravel);
  }

  // ---------------------------------------------------------------- stepping
  // Each step lands its item in the rack at once, then plays the next; held, the next shows settled.
  function next() {
    if (phase === 'idle') send(0);
    else if (phase === 'send0') {
      if (bar[0].where !== 'rack') update(0, true);
      send(1);
    } else if (phase === 'send1') {
      if (bar[1].where !== 'rack') update(0, true);
      release();
    } else if (phase === 'release') poseStill();
    else restart();
  }

  // ---------------------------------------------------------------- the still
  // The documented still (#450): Dinner saved and gone into the line, Cab waiting in the rack.
  // Under reduced motion the tour opens here.
  function poseStill() {
    restart();
    send(0);
    update(0, true);
    send(1);
    update(0, true);
    release();
    update(0, true);
  }

  // Held, every step settles in one update: nothing falls, slides or settles afterwards.
  const settled = () =>
    phase !== 'release' && bar.every((b) => b.where !== 'falling' && b.where !== 'settling');

  return { restart, next, update, draw, poseStill, settled };
}
