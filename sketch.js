// Cecilia — speak, watch your words appear, break them into letters with your hands.
//
// Hold SPACE ............ talk (Whisper transcribes when you let go)
// Pinch on a word ....... break it into letters (and grab one)
// Pinch on a letter ..... grab and throw it
// Open palm, fast ....... sweep through words to shatter them / push letters
// Fist (hold) ........... letters fly back into words
// Mouse works too: click a word to break it, drag letters, double-click to rebuild.
// Keys: T black/camera background · C camera on/off · L language · R rebuild · S split all · X clear · H help

const FONT = 'Helvetica';
const MAX_WORDS = 80;

let words = [];
let fontSize = 72;
let cam;
let showCam = true;
let camBackground = false; // T: black ↔ full-window camera
let showHelp = true;
let hands = [];
let lastVideoTime = -1;
let mouseLetter = null;
let seenPartial = 0;
let showDebug = true;
let spaceDown = false;

// ---------------------------------------------------------------- setup / draw

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont(FONT);
  cam = createCapture(VIDEO);
  cam.size(640, 480);
  cam.hide();
  addText('hold space and speak');
  words.forEach((w) => (w.hint = true));
}

function draw() {
  background(0);
  if (camBackground && cameraOn()) drawCamBackground();

  // Final text first (commits the live words), then the running partial guess.
  while (Speech.queue.length) { setLive(Speech.queue.shift()); commitLive(); }
  if (Speech.partialVersion !== seenPartial) { seenPartial = Speech.partialVersion; setLive(Speech.partial || ''); }

  trackHands();
  for (const h of hands) applyHand(h);
  updateLetters();
  updateSound();

  drawLetters();
  drawHands();
  if (showCam) drawPreview();
  drawStatus();
  if (showDebug) drawDebug();
}

// Diagnostics: what the speech side is doing right now. D toggles.
function drawDebug() {
  const d = Speech.debug || {};
  const lines = [
    `whisper: ${d.model || 'loading…'}`,
    `space held: ${spaceDown ? 'YES' : 'no'}   ·   recording: ${Speech.recording ? 'YES' : 'no'}`,
    `mic: ${Speech.mic || '(not opened yet)'}   ·   audio: ${d.ctx || '-'}`,
    `heard: ${(d.heard || 0).toFixed(1)} s   ·   loudest: ${(Speech.peak || 0).toFixed(2)} (needs > 0.03)`,
    `transcriptions: ${d.runs || 0}   ·   last took ${d.lastMs || 0} ms`,
    `live text: "${(Speech.partial || '').slice(-60)}"`,
    d.error ? `error: ${d.error}` : '',
  ].filter(Boolean);
  push();
  noStroke();
  fill(0, 170);
  rect(12, 12, 470, lines.length * 18 + 34, 6);
  fill(255, 200);
  rect(24, 24, 160 * (Speech.level || 0), 5); // live mic level
  textSize(12);
  textAlign(LEFT, TOP);
  lines.forEach((l, i) => {
    fill(l.startsWith('error') ? color(255, 110, 110) : 220);
    text(l, 24, 36 + i * 18);
  });
  pop();
}

// ---------------------------------------------------------------- words & layout

function makeWord(text, live) {
  return {
    text,
    live,
    split: false,
    letters: [...text].map((ch) => ({ ch, x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0, hx: 0, hy: 0, w: 0, holder: null, fresh: true, born: millis() })),
  };
}

function addText(t) {
  for (const text of t.split(/\s+/).filter(Boolean)) words.push(makeWord(text, false));
  while (words.length > MAX_WORDS) words.shift();
  layout();
}

// Show the running transcription. Words that didn't change keep their letters (no re-animation);
// changed or new words fade in where they belong.
function setLive(text) {
  const toks = text.split(/\s+/).filter(Boolean);
  if (toks.length) words = words.filter((w) => !w.hint); // the intro hint leaves once you speak
  const old = words.filter((w) => w.live);
  const next = toks.map((t, i) => (old[i] && old[i].text === t ? old[i] : makeWord(t, true)));
  words = words.filter((w) => !w.live).concat(next);
  layout();
  for (const w of next) if (!old.includes(w)) Sound.word(w.text, panOf(w.x + w.w / 2));
}

function commitLive() {
  if (words.some((w) => w.live)) Sound.commit();
  for (const w of words) w.live = false;
  while (words.length > MAX_WORDS) words.shift();
  layout();
}

// Wraps words into centred lines, shrinking the type until everything fits.
function layout() {
  const margin = 80;
  for (fontSize = 96; fontSize >= 20; fontSize -= 4) {
    textSize(fontSize);
    const space = textWidth(' ');
    const lineH = fontSize * 1.2;
    const lines = [[]];
    let lineW = 0;
    for (const w of words) {
      w.w = textWidth(w.text);
      if (lineW > 0 && lineW + space + w.w > width - margin * 2) { lines.push([]); lineW = 0; }
      lineW += (lineW > 0 ? space : 0) + w.w;
      lines[lines.length - 1].push(w);
    }
    const blockH = lines.length * lineH;
    if (blockH > height - 180 && fontSize > 20) continue;

    let y = (height - blockH) / 2 + fontSize;
    for (const line of lines) {
      const total = line.reduce((s, w) => s + w.w, 0) + space * (line.length - 1);
      let x = (width - total) / 2;
      for (const w of line) {
        w.x = x; w.y = y;
        w.letters.forEach((l, i) => {
          l.hx = x + textWidth(w.text.slice(0, i));
          l.hy = y;
          l.w = textWidth(l.ch);
          if (l.fresh) { l.x = l.hx; l.y = l.hy + fontSize * 0.3; l.fresh = false; } // rise into place
        });
        x += w.w + space;
      }
      y += lineH;
    }
    return;
  }
}

function explode(word, force = 1) {
  if (word.split) return;
  word.split = true;
  Sound.split(word.letters.length, panOf(word.x + word.w / 2));
  for (const l of word.letters) {
    l.vx = random(-5, 5) * force;
    l.vy = random(-6, 2) * force;
    l.vr = random(-0.08, 0.08);
  }
}

function rebuild() {
  if (words.some((w) => w.split)) Sound.rebuild();
  for (const w of words) w.split = false;
  for (const h of hands) h.held = null;
  mouseLetter = null;
  for (const w of words) for (const l of w.letters) l.holder = null;
}

// ---------------------------------------------------------------- physics

function updateLetters() {
  for (const w of words) {
    for (const l of w.letters) {
      if (l.holder) {
        // follow the pinch / mouse
        l.vx = (l.holder.x - l.w / 2 - l.x) * 0.5;
        l.vy = (l.holder.y + fontSize * 0.35 - l.y) * 0.5;
        l.vr *= 0.9;
      } else if (w.split) {
        // free floating
        l.vx *= 0.985;
        l.vy = l.vy * 0.985 + 0.03;
        l.vr *= 0.99;
        const hit = abs(l.vx) + abs(l.vy);
        if (l.x < 0) { l.x = 0; l.vx = abs(l.vx) * 0.7; if (hit > 4) Sound.tick(-1, hit); }
        if (l.x > width - l.w) { l.x = width - l.w; l.vx = -abs(l.vx) * 0.7; if (hit > 4) Sound.tick(1, hit); }
        if (l.y < fontSize) { l.y = fontSize; l.vy = abs(l.vy) * 0.7; if (hit > 4) Sound.tick(panOf(l.x), hit); }
        if (l.y > height - 10) { l.y = height - 10; l.vy = -abs(l.vy) * 0.6; l.vx *= 0.9; if (hit > 4) Sound.tick(panOf(l.x), hit); }
      } else {
        // spring home
        l.vx = (l.vx + (l.hx - l.x) * 0.06) * 0.78;
        l.vy = (l.vy + (l.hy - l.y) * 0.06) * 0.78;
        l.rot *= 0.85;
        l.vr = 0;
      }
      l.x += l.vx;
      l.y += l.vy;
      l.rot += l.vr;
    }
  }
}

function drawLetters() {
  noStroke();
  textSize(fontSize);
  textAlign(LEFT, BASELINE);
  const now = millis();
  for (const w of words) {
    for (const l of w.letters) {
      const fade = min(1, (now - l.born) / 250);
      fill(255, (w.live ? 190 : 255) * fade); // still-being-heard words are a touch dimmer
      push();
      translate(l.x + l.w / 2, l.y - fontSize * 0.35);
      rotate(l.rot);
      text(l.ch, -l.w / 2, fontSize * 0.35);
      pop();
    }
  }
}

// ---------------------------------------------------------------- picking

function letterNear(x, y, r) {
  let best = null, bestD = r;
  for (const w of words) {
    if (!w.split) continue;
    for (const l of w.letters) {
      if (l.holder) continue;
      const d = dist(x, y, l.x + l.w / 2, l.y - fontSize * 0.35);
      if (d < bestD) { best = l; bestD = d; }
    }
  }
  return best;
}

function wordAt(x, y, pad = 16) {
  return words.find((w) => !w.split &&
    x > w.x - pad && x < w.x + w.w + pad &&
    y > w.y - fontSize - pad && y < w.y + fontSize * 0.25 + pad);
}

// Pinch / click at (x, y): grab a loose letter, or break the word there and grab its nearest letter.
function grabAt(x, y, holder) {
  let l = letterNear(x, y, fontSize * 0.8);
  if (!l) {
    const w = wordAt(x, y);
    if (w) { explode(w, 0.6); l = letterNear(x, y, fontSize * 3); }
  }
  if (l) l.holder = holder;
  return l;
}

function release(l, vx, vy) {
  if (!l) return;
  l.holder = null;
  l.vx = constrain(vx, -40, 40);
  l.vy = constrain(vy, -40, 40);
  l.vr = random(-0.1, 0.1);
  Sound.release(mag(l.vx, l.vy), panOf(l.x));
}

// ---------------------------------------------------------------- sound

function panOf(x) { return constrain((x / width) * 2 - 1, -1, 1); }

function updateSound() {
  let looseCount = 0, speed = 0, px = 0;
  const held = [];
  for (const w of words) {
    for (const l of w.letters) {
      if (l.holder) held.push({ id: l, x: l.x / width, y: l.y / height });
      else if (w.split) { looseCount++; speed += mag(l.vx, l.vy); px += l.x; }
    }
  }
  Sound.update({
    recording: Speech.recording,
    level: Speech.level || 0,
    looseCount,
    looseSpeed: looseCount ? speed / looseCount : 0,
    loosePan: looseCount ? panOf(px / looseCount) : 0,
    held,
    hands: hands.map((h) => ({
      x: h.palm.x / width, y: h.palm.y / height,
      open: h.open, pinching: h.pinching, speed: mag(h.vel.x, h.vel.y),
    })),
  });
}

// ---------------------------------------------------------------- hands

function trackHands() {
  if (!Hands.ready || !cam.elt || cam.elt.readyState < 2) return;
  if (cam.elt.currentTime === lastVideoTime) return;
  lastVideoTime = cam.elt.currentTime;

  let res;
  try { res = Hands.detect(cam.elt, performance.now()); } catch { return; }
  const list = (res && res.landmarks) || [];

  const next = list.map((lm, i) => readHand(lm, hands[i]));
  for (let i = next.length; i < hands.length; i++) if (hands[i].held) release(hands[i].held, 0, 0);
  hands = next;
}

// Where the (mirrored) camera image sits on the canvas, scaled to cover the window.
function camRect() {
  const vw = cam.elt.videoWidth || 640, vh = cam.elt.videoHeight || 480;
  const s = max(width / vw, height / vh);
  const w = vw * s, h = vh * s;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

function drawCamBackground() {
  const r = camRect();
  push();
  translate(r.x + r.w, r.y);
  scale(-1, 1); // mirror
  image(cam, 0, 0, r.w, r.h);
  pop();
  noStroke();
  fill(0, 70); // darken a little so the white letters stay readable
  rect(0, 0, width, height);
}

function readHand(lm, prev) {
  // Same mirrored cover mapping as the background, so the cursor sits on your real fingers.
  const r = camRect();
  const pts = lm.map((p) => ({ x: r.x + (1 - p.x) * r.w, y: r.y + p.y * r.h }));
  const d = (a, b) => dist(pts[a].x, pts[a].y, pts[b].x, pts[b].y);
  const size = max(d(0, 9), 1);

  const pinchRatio = d(4, 8) / size;
  const pinching = prev && prev.pinching ? pinchRatio < 0.45 : pinchRatio < 0.28;

  const curled = [[8, 6], [12, 10], [16, 14], [20, 18]].map(([tip, pip]) => d(tip, 0) < d(pip, 0));
  const fist = curled.every(Boolean);
  const open = curled.every((c) => !c) && !pinching;

  const palm = [0, 5, 9, 13, 17].reduce((a, i) => ({ x: a.x + pts[i].x / 5, y: a.y + pts[i].y / 5 }), { x: 0, y: 0 });
  const cursor = { x: (pts[4].x + pts[8].x) / 2, y: (pts[4].y + pts[8].y) / 2 };

  return {
    lm, pts, size, pinching, fist, open, palm, cursor,
    vel: prev ? { x: palm.x - prev.palm.x, y: palm.y - prev.palm.y } : { x: 0, y: 0 },
    cvel: prev ? { x: cursor.x - prev.cursor.x, y: cursor.y - prev.cursor.y } : { x: 0, y: 0 },
    wasPinching: prev ? prev.pinching : false,
    fistFrames: fist ? (prev ? prev.fistFrames : 0) + 1 : 0,
    held: prev ? prev.held : null,
    holder: prev ? prev.holder : { x: cursor.x, y: cursor.y },
  };
}

function applyHand(h) {
  h.holder.x = h.cursor.x;
  h.holder.y = h.cursor.y;

  if (h.pinching && !h.wasPinching && !h.held) h.held = grabAt(h.cursor.x, h.cursor.y, h.holder);
  if (!h.pinching && h.held) { release(h.held, h.cvel.x * 1.5, h.cvel.y * 1.5); h.held = null; }
  h.wasPinching = h.pinching;

  if (h.fistFrames === 12) rebuild();

  if (h.open) {
    const speed = mag(h.vel.x, h.vel.y);
    if (speed > 18) {
      const w = wordAt(h.palm.x, h.palm.y, h.size * 0.5);
      if (w) {
        explode(w, 0.5);
        for (const l of w.letters) { l.vx += h.vel.x * 0.4; l.vy += h.vel.y * 0.4; }
      }
    }
    // push loose letters away from the palm
    const r = h.size * 1.6;
    for (const w of words) {
      if (!w.split) continue;
      for (const l of w.letters) {
        if (l.holder) continue;
        const dx = l.x + l.w / 2 - h.palm.x, dy = l.y - fontSize * 0.35 - h.palm.y;
        const dd = mag(dx, dy);
        if (dd < r && dd > 0.01) {
          const f = (1 - dd / r) * 2.2;
          l.vx += (dx / dd) * f + h.vel.x * 0.05;
          l.vy += (dy / dd) * f + h.vel.y * 0.05;
        }
      }
    }
  }
}

function drawHands() {
  for (const h of hands) {
    noFill();
    stroke(255, 90);
    strokeWeight(1.5);
    // fingertip dots
    for (const i of [4, 8, 12, 16, 20]) circle(h.pts[i].x, h.pts[i].y, 6);
    // pinch cursor
    if (h.pinching) { noStroke(); fill(255); circle(h.cursor.x, h.cursor.y, 14); }
    else { stroke(255, 160); circle(h.cursor.x, h.cursor.y, 22); }
    // fist progress
    if (h.fistFrames > 0 && h.fistFrames < 12) {
      noFill(); stroke(255, 200); strokeWeight(2);
      arc(h.palm.x, h.palm.y, 50, 50, -HALF_PI, -HALF_PI + TWO_PI * h.fistFrames / 12);
    }
  }
}

// ---------------------------------------------------------------- camera preview & status

const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];

function drawPreview() {
  const pw = 200, ph = 150;
  push();
  translate(width - 20, 20);
  scale(-1, 1);
  tint(255, 140);
  image(cam, 0, 0, pw, ph);
  noTint();
  stroke(255, 200);
  strokeWeight(1);
  for (const h of hands) for (const [a, b] of BONES) line(h.lm[a].x * pw, h.lm[a].y * ph, h.lm[b].x * pw, h.lm[b].y * ph);
  noFill();
  stroke(255, 60);
  rect(0, 0, pw, ph);
  pop();
}

function cameraOn() { return cam && cam.elt && cam.elt.readyState >= 2; }
function cameraStatus() {
  if (!cameraOn()) return 'camera off';
  return hands.length ? `${hands.length} hand${hands.length > 1 ? 's' : ''}` : 'camera on · show your hand';
}

function langLabel() {
  const l = (Speech.language || 'auto').toUpperCase();
  return l === 'AUTO' && Speech.detected ? `AUTO → ${Speech.detected.toUpperCase()}` : l;
}

function drawStatus() {
  noStroke();
  textSize(13);
  textAlign(LEFT, BASELINE);
  if (Speech.recording) {
    fill(255, 60, 60);
    circle(26, height - 30, 10);
    // mic level meter
    fill(255, 40);
    rect(40, height - 100, 200, 6);
    fill(255);
    rect(40, height - 100, 200 * (Speech.level || 0), 6);
    fill(150);
    text(`mic: ${Speech.mic || '…'}`, 40, height - 108);
  }
  fill(150);
  text(`${Speech.status}   ·   ${langLabel()} (L to switch)   ·   ${Hands.status}   ·   ${cameraStatus()}`, 40, height - 25);
  if (millis() > 4000 && !cameraOn()) {
    fill(255, 90, 90);
    textSize(15);
    text('no camera · open localhost:8123 in Chrome, allow camera + mic', 40, height - 70);
    textSize(13);
  }
  if (showHelp) {
    fill(90);
    text('SPACE talk · pinch a word to break it · pinch a letter to grab/throw · open palm sweep · fist to rebuild · T background · C camera · L language · M sound · F fullscreen · R rebuild · S split · X clear · H help', 40, height - 45);
  }
}

// ---------------------------------------------------------------- input

function keyPressed() {
  Sound.init(); // browsers only allow audio to start after a key press or click
  if (key.toLowerCase() === 'm') Sound.toggleMute();
  if (key === ' ') { spaceDown = true; Speech.start(); return false; }
  const k = key.toLowerCase();
  if (k === 'r') rebuild();
  if (k === 's') words.forEach((w) => explode(w));
  if (k === 'c') showCam = !showCam;
  if (k === 't') camBackground = !camBackground;
  if (k === 'd') showDebug = !showDebug;
  if (k === 'f') fullscreen(!fullscreen());
  if (k === 'x') { words = []; hands.forEach((h) => (h.held = null)); mouseLetter = null; }
  if (k === 'h') showHelp = !showHelp;
  if (k === 'l' && Speech.cycleLanguage) Speech.cycleLanguage();
}

function keyReleased() {
  if (key === ' ') { spaceDown = false; Speech.stop(); return false; }
}

const mouseHolder = { x: 0, y: 0 };
function mousePressed() {
  Sound.init();
  mouseHolder.x = mouseX; mouseHolder.y = mouseY;
  mouseLetter = grabAt(mouseX, mouseY, mouseHolder);
}
function mouseDragged() { mouseHolder.x = mouseX; mouseHolder.y = mouseY; }
function mouseReleased() {
  if (mouseLetter) release(mouseLetter, (mouseX - pmouseX) * 1.5, (mouseY - pmouseY) * 1.5);
  mouseLetter = null;
}
function doubleClicked() { rebuild(); }

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  layout();
}
