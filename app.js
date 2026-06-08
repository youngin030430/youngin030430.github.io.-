const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d");
const stage = document.querySelector("#stage");
const statusText = document.querySelector("#statusText");
const progressBar = document.querySelector("#progressBar");
const resetButton = document.querySelector("#resetButton");
const soundButton = document.querySelector("#soundButton");
const hint = document.querySelector("#hint");
const shapeChips = [...document.querySelectorAll(".shape-chip")];

const TOTAL_CHIPS = 24;
const TOTAL_CRUSH = 100;
const palettes = {
  lime: { light: "#d4ff72", base: "#9fdb33", dark: "#477817" }
};
const clayColors = { light: "#fffdf5", base: "#eee9de", dark: "#b9b3a9" };

// Each reference shape only needs to provide its own edge profile here.
const shapeProfiles = {
  greenApple: (angle) => {
    const topDimple = Math.exp(-Math.pow(Math.atan2(Math.sin(angle + Math.PI / 2), Math.cos(angle + Math.PI / 2)), 2) / 0.1);
    const bottomDimple = Math.exp(-Math.pow(Math.atan2(Math.sin(angle - Math.PI / 2), Math.cos(angle - Math.PI / 2)), 2) / 0.13);
    const appleCheeks = 0.05 * Math.cos(angle * 2);
    return 1 + appleCheeks - topDimple * 0.13 - bottomDimple * 0.06;
  }
};

let colorName = "lime";
let shapeName = "greenApple";
let particles = [];
let ripples = [];
let broken = false;
let clayDents = [];
let waxPieces = [];
let crushedPieces = 0;
let crushProgress = 0;
let kneading = false;
let lastDragPoint = null;
let clayStretch = 1;
let charging = false;
let chargeStartedAt = 0;
let chargePoint = null;
let chargeProgress = 0;
let radialCracks = [];
let soundOn = true;
let audioContext;
let lastTime = performance.now();

function resize() {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = rect.width * scale;
  canvas.height = rect.height * scale;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

function geometry() {
  const { width, height } = canvas.getBoundingClientRect();
  return {
    width,
    height,
    x: width / 2,
    y: height / 2 - 3,
    radius: Math.min(width, height) * (window.innerWidth < 540 ? 0.31 : 0.285)
  };
}

function roundedBlobPath(x, y, radius, time, options = {}) {
  const points = 90;
  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const angle = (Math.PI * 2 * i) / points;
    let r = radius * shapeProfiles[shapeName](angle);
    const dents = options.clay ? clayDents : [];
    for (const dent of dents) {
      const edgeInfluence = Math.min(1, Math.hypot(dent.x, dent.y) * 1.15);
      const diff = Math.atan2(Math.sin(angle - dent.angle), Math.cos(angle - dent.angle));
      const inward = Math.exp(-(diff * diff) / 0.07);
      const leftShoulder = Math.exp(-Math.pow(diff - 0.58, 2) / 0.18);
      const rightShoulder = Math.exp(-Math.pow(diff + 0.58, 2) / 0.18);
      r += radius * dent.depth * edgeInfluence * (-inward * 0.28 + (leftShoulder + rightShoulder) * 0.34 + 0.02);
    }
    if (options.clay) {
      r *= 0.99 + Math.sin(angle * 4 + time * 0.004) * 0.012;
    }
    const px = x + Math.cos(angle) * r * (options.clay ? clayStretch : 1);
    const py = y + Math.sin(angle) * r / (options.clay ? clayStretch : 1);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawBackground(g) {
  const gradient = ctx.createRadialGradient(g.x, g.y, 20, g.x, g.y, g.width * 0.66);
  gradient.addColorStop(0, "#343035");
  gradient.addColorStop(0.6, "#232125");
  gradient.addColorStop(1, "#1b1a1d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, g.width, g.height);

  ctx.save();
  ctx.translate(g.x, g.y + g.radius * 0.95);
  ctx.scale(1, 0.22);
  const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, g.radius * 1.05);
  shadow.addColorStop(0, "rgba(0,0,0,.36)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(0, 0, g.radius * 1.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBall(g, time) {
  if (broken) {
    drawClay(g, time);
    return;
  }
  const colors = palettes[colorName];
  ctx.save();
  roundedBlobPath(g.x, g.y, g.radius, time);
  ctx.clip();

  const fill = ctx.createRadialGradient(
    g.x - g.radius * 0.34, g.y - g.radius * 0.38, g.radius * 0.05,
    g.x, g.y, g.radius * 1.1
  );
  fill.addColorStop(0, colors.light);
  fill.addColorStop(0.4, colors.base);
  fill.addColorStop(1, colors.dark);
  ctx.fillStyle = fill;
  ctx.fillRect(g.x - g.radius, g.y - g.radius, g.radius * 2, g.radius * 2);

  const glaze = ctx.createLinearGradient(g.x, g.y - g.radius, g.x, g.y + g.radius);
  glaze.addColorStop(0, "rgba(255,255,255,.12)");
  glaze.addColorStop(0.65, "rgba(255,255,255,0)");
  glaze.addColorStop(1, "rgba(0,0,0,.13)");
  ctx.fillStyle = glaze;
  ctx.fillRect(g.x - g.radius, g.y - g.radius, g.radius * 2, g.radius * 2);

  drawSpeckles(g);
  ctx.restore();
  drawChargingCracks(g);

  if (shapeName === "greenApple") drawAppleDetails(g);

  ctx.save();
  roundedBlobPath(g.x, g.y, g.radius, time);
  ctx.strokeStyle = "rgba(255,255,255,.16)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function drawChargingCracks(g) {
  if (!charging || !chargePoint) return;
  ctx.save();
  roundedBlobPath(g.x, g.y, g.radius, performance.now());
  ctx.clip();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  radialCracks.forEach((branch, index) => {
    const visiblePoints = Math.max(1, Math.ceil(branch.length * chargeProgress));
    ctx.beginPath();
    ctx.moveTo(g.x + chargePoint.x, g.y + chargePoint.y);
    branch.slice(0, visiblePoints).forEach((point) => {
      ctx.lineTo(g.x + chargePoint.x + point.x * chargeProgress, g.y + chargePoint.y + point.y * chargeProgress);
    });
    ctx.strokeStyle = index % 3 === 0 ? "rgba(28,31,23,.9)" : "rgba(49,55,38,.82)";
    ctx.lineWidth = 1.2 + chargeProgress * 1.1;
    ctx.stroke();
  });
  ctx.restore();
}

function drawAppleDetails(g) {
  ctx.save();
  ctx.translate(g.x + g.radius * 0.03, g.y - g.radius * 0.92);
  ctx.rotate(0.18);
  const stem = ctx.createLinearGradient(-5, 0, 6, 0);
  stem.addColorStop(0, "#645033");
  stem.addColorStop(0.55, "#a79055");
  stem.addColorStop(1, "#554229");
  ctx.fillStyle = stem;
  ctx.beginPath();
  ctx.roundRect(-5, -g.radius * 0.28, 10, g.radius * 0.32, 5);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(g.x + g.radius * 0.18, g.y - g.radius * 1.05);
  ctx.rotate(-0.45);
  ctx.fillStyle = "rgba(128,176,62,.8)";
  ctx.beginPath();
  ctx.ellipse(0, 0, g.radius * 0.18, g.radius * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawClay(g, time) {
  ctx.save();
  roundedBlobPath(g.x, g.y, g.radius * 0.88, time, { clay: true });
  ctx.clip();
  const fill = ctx.createRadialGradient(
    g.x - g.radius * 0.32, g.y - g.radius * 0.36, 3,
    g.x, g.y, g.radius
  );
  fill.addColorStop(0, clayColors.light);
  fill.addColorStop(0.62, clayColors.base);
  fill.addColorStop(1, clayColors.dark);
  ctx.fillStyle = fill;
  ctx.fillRect(g.x - g.radius, g.y - g.radius, g.radius * 2, g.radius * 2);
  drawClayTexture(g);
  clayDents.forEach((dent) => drawClayPress(g, dent));
  drawClayWaxPieces(g);
  ctx.restore();

  ctx.save();
  roundedBlobPath(g.x, g.y, g.radius * 0.88, time, { clay: true });
  ctx.strokeStyle = "rgba(255,255,255,.34)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function drawClayTexture(g) {
  for (let i = 0; i < 46; i++) {
    const angle = i * 2.17;
    const distance = g.radius * (0.08 + ((i * 29) % 73) / 100);
    const x = g.x + Math.cos(angle) * distance;
    const y = g.y + Math.sin(angle) * distance;
    ctx.fillStyle = i % 3 === 0 ? "rgba(170,162,150,.18)" : "rgba(255,255,255,.18)";
    ctx.beginPath();
    ctx.ellipse(x, y, 1.2 + (i % 4), 0.45 + (i % 2), angle, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(158,150,138,.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    const y = g.y - g.radius * 0.45 + i * g.radius * 0.11;
    ctx.beginPath();
    ctx.moveTo(g.x - g.radius * 0.52, y);
    ctx.bezierCurveTo(g.x - g.radius * 0.18, y + 5, g.x + g.radius * 0.16, y - 6, g.x + g.radius * 0.5, y + 2);
    ctx.stroke();
  }
}

function drawClayPress(g, dent) {
  const dx = g.x + dent.x * g.radius * 0.88;
  const dy = g.y + dent.y * g.radius * 0.88;
  const size = g.radius * 0.16;
  const highlight = ctx.createRadialGradient(dx - size * 0.2, dy - size * 0.25, 2, dx, dy, size);
  highlight.addColorStop(0, "rgba(178,169,156,.28)");
  highlight.addColorStop(0.58, "rgba(236,231,220,.24)");
  highlight.addColorStop(1, "rgba(255,253,245,0)");
  ctx.fillStyle = highlight;
  ctx.beginPath();
  ctx.arc(dx, dy, size, 0, Math.PI * 2);
  ctx.fill();
}

function drawClayWaxPieces(g) {
  const colors = palettes[colorName];
  ctx.fillStyle = colors.base;
  ctx.globalAlpha = 0.9;
  for (const piece of waxPieces) {
    const x = g.x + piece.x * g.radius;
    const y = g.y + piece.y * g.radius;
    const size = g.radius * piece.size;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(piece.rotation);
    ctx.beginPath();
    ctx.moveTo(-size * 0.28, -size * 0.44);
    ctx.lineTo(size * piece.length, -size * 0.16);
    ctx.lineTo(-size * 0.1, size * piece.width);
    ctx.lineTo(-size * piece.width, size * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawSpeckles(g) {
  ctx.fillStyle = "rgba(255,255,255,.16)";
  for (let i = 0; i < 24; i++) {
    const a = i * 2.39;
    const r = g.radius * (0.16 + ((i * 47) % 77) / 100);
    ctx.beginPath();
    ctx.arc(g.x + Math.cos(a) * r, g.y + Math.sin(a) * r, i % 4 === 0 ? 1.4 : 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParticles(delta, g) {
  particles.forEach((particle) => {
    particle.life -= delta;
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    particle.vy += 0.0007 * delta;
    particle.rotation += particle.spin * delta;
    const alpha = Math.max(0, Math.min(1, particle.life / 650));
    ctx.save();
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.rotation);
    ctx.fillStyle = particle.color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(-particle.size, particle.size * 0.65);
    ctx.lineTo(particle.size * (particle.length || 1), -particle.size * 0.18);
    ctx.lineTo(particle.size * 0.08, -particle.size);
    ctx.lineTo(-particle.size * (particle.width || 0.7), particle.size * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
  particles = particles.filter((particle) => particle.life > 0 && particle.y < g.height + 60);
}

function drawRipples(delta) {
  ripples.forEach((ripple) => {
    ripple.life -= delta;
    ripple.radius += delta * 0.06;
    ctx.strokeStyle = `rgba(255,255,255,${Math.max(0, ripple.life / 520) * 0.42})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
    ctx.stroke();
  });
  ripples = ripples.filter((ripple) => ripple.life > 0);
}

function burst(g, amount = 72, origin = { x: 0, y: 0 }) {
  const colors = palettes[colorName];
  for (let i = 0; i < amount; i++) {
    const ringIndex = i % 34;
    const angle = (Math.PI * 2 * ringIndex) / 34 + (Math.random() - 0.5) * 0.13;
    const isLarge = i < 34;
    const force = isLarge ? 0.28 + Math.random() * 0.22 : 0.08 + Math.random() * 0.25;
    const startRadius = g.radius * (isLarge ? 0.08 : 0.16 + Math.random() * 0.62);
    particles.push({
      x: g.x + origin.x + Math.cos(angle) * startRadius,
      y: g.y + origin.y + Math.sin(angle) * startRadius,
      vx: Math.cos(angle) * force,
      vy: Math.sin(angle) * force - Math.random() * 0.1,
      life: (isLarge ? 1050 : 780) + Math.random() * 850,
      size: isLarge ? 5 + Math.random() * 8 : 2 + Math.random() * 5,
      length: isLarge ? 2.3 + Math.random() * 1.4 : 1 + Math.random() * 0.8,
      width: isLarge ? 0.55 + Math.random() * 0.25 : 0.7 + Math.random() * 0.4,
      rotation: angle,
      spin: (Math.random() - 0.5) * 0.02,
      color: Math.random() > 0.2 ? colors.base : clayColors.light
    });
  }
}

function createWaxPieces(origin = { x: 0, y: 0 }, g = geometry()) {
  waxPieces = Array.from({ length: TOTAL_CHIPS }, (_, index) => {
    const angle = (Math.PI * 2 * index) / TOTAL_CHIPS + (Math.random() - 0.5) * 0.2;
    const distance = 0.18 + ((index * 37) % 58) / 100;
    return {
      x: origin.x / g.radius + Math.cos(angle) * distance,
      y: origin.y / g.radius + Math.sin(angle) * distance,
      size: 0.104 + ((index * 17) % 8) / 60,
      length: 1.6 + ((index * 13) % 7) / 5,
      width: 0.55 + ((index * 11) % 5) / 12,
      rotation: angle,
      crushed: false
    };
  });
}

function crushNearbyWax(x, y, g) {
  const nx = x / g.radius;
  const ny = y / g.radius;
  let crushedNow = 0;
  const nearbyPieces = waxPieces
    .filter((piece) => !piece.crushed)
    .map((piece) => ({ piece, distance: Math.hypot(piece.x - nx, piece.y - ny) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 2);

  nearbyPieces.forEach(({ piece }) => {
    piece.size *= 0.87;
    piece.rotation += 0.4;
    if (piece.size < 0.038) {
      piece.size = 0.021;
      piece.crushed = true;
      crushedNow += 1;
    }
  });
  crushedPieces = waxPieces.filter((piece) => piece.crushed).length;
  crushProgress = Math.min(TOTAL_CRUSH, crushProgress + 1);
  shedWaxChips(g, x, y, 2 + crushedNow * 2);
  statusText.textContent = crushProgress >= TOTAL_CRUSH
    ? "왁스 조각이 잘게 섞였어요. 계속 주물러도 좋아요"
    : "조각을 여러 번 눌러 잘게 부숴보세요";
}

function shedWaxChips(g, x, y, amount) {
  const colors = palettes[colorName];
  for (let i = 0; i < amount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const force = 0.035 + Math.random() * 0.12;
    particles.push({
      x: g.x + x,
      y: g.y + y,
      vx: Math.cos(angle) * force,
      vy: Math.sin(angle) * force - Math.random() * 0.08,
      life: 300 + Math.random() * 450,
      size: 1.4 + Math.random() * 3.8,
      rotation: Math.random() * 5,
      spin: (Math.random() - 0.5) * 0.025,
      color: colors.base
    });
  }
}

function shakeStage() {
  stage.classList.remove("shaking");
  void stage.offsetWidth;
  stage.classList.add("shaking");
}

function makeRadialCracks(g) {
  radialCracks = Array.from({ length: 11 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 11 + (Math.random() - 0.5) * 0.26;
    return Array.from({ length: 5 }, (_, step) => {
      const length = g.radius * (0.11 + step * 0.13);
      const bend = (Math.random() - 0.5) * 0.22;
      return { x: Math.cos(angle + bend) * length, y: Math.sin(angle + bend) * length };
    });
  });
}

function beginCharge(x, y, g, event) {
  charging = true;
  chargeStartedAt = performance.now();
  chargePoint = { x, y };
  chargeProgress = 0;
  makeRadialCracks(g);
  statusText.textContent = "꾹 누르고 계세요...";
  hint.textContent = "손을 떼지 말고 끝까지";
  canvas.setPointerCapture(event.pointerId);
}

function releaseCharge() {
  if (!charging) return;
  charging = false;
  chargePoint = null;
  radialCracks = [];
  if (!broken) {
    statusText.textContent = "조금 더 길게 눌러보세요";
    hint.textContent = "길게 눌러 왁스를 깨뜨리세요";
    progressBar.style.width = "0";
  }
}

function shatter(g) {
  const origin = chargePoint || { x: 0, y: 0 };
  broken = true;
  charging = false;
  chargePoint = null;
  radialCracks = [];
  createWaxPieces(origin, g);
  canvas.style.cursor = "grab";
  progressBar.style.width = "0";
  statusText.textContent = "와장창! 이제 조각째로 주물러보세요";
  hint.textContent = "누르고 끌어서 왁스 조각 부수기";
  shakeStage();
  if (navigator.vibrate) navigator.vibrate([45, 30, 70]);
  ripples.push({ x: g.x, y: g.y, radius: 4, life: 520 });
  burst(g, 146, origin);
  createSound(true);
}

function createSound(isBurst = false) {
  if (!soundOn) return;
  audioContext ||= new AudioContext();
  const now = audioContext.currentTime;
  const crackPower = broken ? Math.min(1, crushProgress / TOTAL_CRUSH) : 1;
  const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 0.12, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const decay = 1 - i / data.length;
    data[i] = (Math.random() * 2 - 1) * decay * decay;
  }
  const noise = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  noise.buffer = buffer;
  filter.type = "highpass";
  filter.frequency.value = isBurst ? 280 : 980 - crackPower * 430;
  gain.gain.setValueAtTime(isBurst ? 0.52 : 0.18 + crackPower * 0.16, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + (isBurst ? 0.18 : 0.1));
  noise.connect(filter).connect(gain).connect(audioContext.destination);
  noise.start();

  const pop = audioContext.createOscillator();
  const popGain = audioContext.createGain();
  pop.frequency.setValueAtTime(isBurst ? 115 : 240 - crackPower * 70, now);
  pop.frequency.exponentialRampToValueAtTime(55, now + 0.08);
  popGain.gain.setValueAtTime(isBurst ? 0.3 : 0.08 + crackPower * 0.07, now);
  popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
  pop.connect(popGain).connect(audioContext.destination);
  pop.start();
  pop.stop(now + 0.1);
}

function handlePress(event) {
  const rect = canvas.getBoundingClientRect();
  const g = geometry();
  const x = event.clientX - rect.left - g.x;
  const y = event.clientY - rect.top - g.y;
  if (Math.hypot(x, y) > g.radius * (broken ? 0.98 : 1.05)) return;

  if (broken) {
    kneading = true;
    canvas.style.cursor = "grabbing";
    lastDragPoint = { x, y };
    kneadClay(x, y, g);
    crushNearbyWax(x, y, g);
    createSound(false);
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  beginCharge(x, y, g, event);
}

function kneadClay(x, y, g) {
  const radius = g.radius * 0.88;
  clayDents.push({
    x: x / radius,
    y: y / radius,
    angle: Math.atan2(y, x),
    depth: 0.026 + Math.random() * 0.016
  });
  if (clayDents.length > 8) clayDents.shift();
  ripples.push({ x: g.x + x, y: g.y + y, radius: 4, life: 420 });
}

function handleDrag(event) {
  if (!broken || !kneading) return;
  const rect = canvas.getBoundingClientRect();
  const g = geometry();
  const x = event.clientX - rect.left - g.x;
  const y = event.clientY - rect.top - g.y;
  if (Math.hypot(x, y) <= g.radius * 0.98) {
    if (lastDragPoint) {
      const dx = x - lastDragPoint.x;
      const dy = y - lastDragPoint.y;
      clayStretch = Math.max(0.9, Math.min(1.12, clayStretch + (Math.abs(dx) - Math.abs(dy)) * 0.0007));
    }
    lastDragPoint = { x, y };
    kneadClay(x, y, g);
    crushNearbyWax(x, y, g);
  }
}

function reset() {
  particles = [];
  ripples = [];
  broken = false;
  clayDents = [];
  waxPieces = [];
  crushedPieces = 0;
  crushProgress = 0;
  kneading = false;
  lastDragPoint = null;
  clayStretch = 1;
  charging = false;
  chargeStartedAt = 0;
  chargePoint = null;
  chargeProgress = 0;
  radialCracks = [];
  canvas.style.cursor = "crosshair";
  progressBar.style.width = "0";
  statusText.textContent = "살짝 눌러보세요";
  hint.textContent = "길게 눌러 왁스를 깨뜨리세요";
  hint.style.opacity = "1";
}

function animate(time) {
  const delta = Math.min(40, time - lastTime);
  lastTime = time;
  const g = geometry();
  if (charging && !broken) {
    chargeProgress = Math.min(1, (time - chargeStartedAt) / 920);
    progressBar.style.width = `${chargeProgress * 100}%`;
    if (chargeProgress >= 1) shatter(g);
  }
  ctx.clearRect(0, 0, g.width, g.height);
  drawBackground(g);
  drawBall(g, time);
  drawRipples(delta);
  drawParticles(delta, g);
  requestAnimationFrame(animate);
}

canvas.addEventListener("pointerdown", handlePress);
canvas.addEventListener("pointermove", handleDrag);
canvas.addEventListener("pointerup", () => {
  releaseCharge();
  kneading = false;
  lastDragPoint = null;
  if (broken) canvas.style.cursor = "grab";
});
canvas.addEventListener("pointercancel", () => {
  releaseCharge();
  kneading = false;
  lastDragPoint = null;
  if (broken) canvas.style.cursor = "grab";
});
resetButton.addEventListener("click", reset);
soundButton.addEventListener("click", () => {
  soundOn = !soundOn;
  soundButton.setAttribute("aria-pressed", soundOn);
  soundButton.querySelector("span:last-child").textContent = soundOn ? "소리 켜짐" : "소리 꺼짐";
  soundButton.querySelector(".sound-icon").textContent = soundOn ? "♪" : "×";
});

shapeChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    shapeName = chip.dataset.shape;
    shapeChips.forEach((button) => button.classList.toggle("active", button === chip));
    colorName = "lime";
    reset();
  });
});

window.addEventListener("resize", resize);
window.__waxPopPreview = {
  shatter() {
    const g = geometry();
    chargePoint = { x: g.radius * 0.08, y: -g.radius * 0.05 };
    shatter(g);
  },
  knead() {
    const g = geometry();
    kneadClay(g.radius * 0.2, g.radius * 0.12, g);
    crushNearbyWax(g.radius * 0.2, g.radius * 0.12, g);
  }
};
resize();
requestAnimationFrame(animate);
