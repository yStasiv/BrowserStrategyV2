(() => {
  const canvas = document.getElementById("battlefield");
  const ctx = canvas.getContext("2d");
  const msgEl = document.getElementById("message");
  const restartBtn = document.getElementById("btn-restart");
  const startBtn = document.getElementById("btn-start-battle");
  const turnWheelEl = document.getElementById("turn-wheel");
  const turnWheelLabel = document.getElementById("turn-wheel-label");

  const GRID_COLS = 12;
  const GRID_ROWS = 10;
  const CELL_SIZE = 64;
  const OFFSET_X = (canvas.width - GRID_COLS * CELL_SIZE) / 2;
  const OFFSET_Y = (canvas.height - GRID_ROWS * CELL_SIZE) / 2;

  let units = [];
  let turnOrder = [];
  let currentIndex = 0;
  let gameState = "playerTurn"; // "playerTurn" | "aiTurn" | "gameOver"
  let roundNumber = 1;
  // Recorded moves for this match (sent to server as part of details)
  let recordedMoves = [];
  // placement mode
  let isPlacement = false;
  let selectedUnit = null;

  // для анімацій руху
  let animations = [];
  let lastTimestamp = 0;

  function createInitialUnits() {
    if (window.INITIAL_UNITS && Array.isArray(window.INITIAL_UNITS)) {
      return JSON.parse(JSON.stringify(window.INITIAL_UNITS));
    }
    return [];
  }

  function initBattle() {
    units = createInitialUnits();
    turnOrder = [...units].sort((a, b) => b.initiative - a.initiative);
    currentIndex = 0;
    roundNumber = 1;
    gameState = turnOrder[0].isPlayer ? "playerTurn" : "aiTurn";
    animations = [];
    recordedMoves = [];
    recordedMoves.push({ type: 'start', time: Date.now(), units: JSON.parse(JSON.stringify(units)) });
    setMessage("Раунд 1. Твій хід. Обери дію для активного юніта.");
    if (gameState === "aiTurn") {
      aiTurnWithDelay();
    }
    updateTurnWheel();
  }
  
  function enterPlacementMode() {
    units = createInitialUnits();
    // helper to get unit size (w,h) - default 1x1
    function getUnitSize(u) {
      const s = u.size || 1;
      return { w: u.w || u.width || s, h: u.h || u.height || s };
    }

    // find next free position for this unit within allowed columns (players: first 2 columns)
    function findNextFreePosForUnit(u) {
      const { w, h } = getUnitSize(u);
      const maxPlayerCols = 2; // only first 2 columns allowed for player placement
      if (u.isPlayer) {
        for (let y = 0; y <= GRID_ROWS - h; y++) {
          for (let x = 0; x <= Math.max(0, maxPlayerCols - w); x++) {
            // check overlap
            let conflict = false;
            for (let oy = 0; oy < h && !conflict; oy++) {
              for (let ox = 0; ox < w; ox++) {
                const tx = x + ox, ty = y + oy;
                if (units.some(other => other !== u && (other.x <= tx && tx < (other.x + (other.size||other.w||1)) && other.y <= ty && ty < (other.y + (other.size||other.h||1))))) { conflict = true; break; }
              }
            }
            if (!conflict) return { x, y };
          }
        }
        return { x: 0, y: 0 };
      } else {
        // enemies default to right side
        for (let y = 0; y <= GRID_ROWS - h; y++) {
          for (let x = GRID_COLS - w; x >= GRID_COLS - Math.max(1, w); x--) {
            let conflict = false;
            for (let oy = 0; oy < h && !conflict; oy++) {
              for (let ox = 0; ox < w; ox++) {
                const tx = x + ox, ty = y + oy;
                if (units.some(other => other !== u && (other.x <= tx && tx < (other.x + (other.size||other.w||1)) && other.y <= ty && ty < (other.y + (other.size||other.h||1))))) { conflict = true; break; }
              }
            }
            if (!conflict) return { x, y };
          }
        }
        return { x: GRID_COLS - 1, y: 0 };
      }
    }

    // place units in sensible default positions, respecting sizes
    units.forEach(u => {
      if (typeof u.x !== 'number' || typeof u.y !== 'number') {
        const pos = findNextFreePosForUnit(u);
        u.x = pos.x; u.y = pos.y;
      }
      u.visualX = u.x; u.visualY = u.y;
    });
    isPlacement = true;
    selectedUnit = units.find(u => u.isPlayer && u.hp > 0) || null;
    recordedMoves = [];
    gameState = 'placement';
    if (selectedUnit) {
      setMessage(`Юніт ${selectedUnit.name} вибрано. Клікніть по клітинці щоб поставити його або виберіть інший.`);
    } else {
      setMessage('Розставте ваше військо: клік по клітинці — поставити юніта. Коли готові — натисніть "Почати бій".');
    }
    updateTurnWheel();
  }
  
  function startBattleFromPlacement() {
    isPlacement = false;
    selectedUnit = null;
    turnOrder = [...units].sort((a, b) => b.initiative - a.initiative);
    currentIndex = 0;
    roundNumber = 1;
    recordedMoves.push({ type: 'start', time: Date.now(), units: JSON.parse(JSON.stringify(units)) });
    gameState = turnOrder[0] && turnOrder[0].isPlayer ? 'playerTurn' : 'aiTurn';
    setMessage(`Раунд ${roundNumber}. ${gameState === 'playerTurn' ? 'Твій хід.' : 'Хід ворога.'}`);
    if (gameState === 'aiTurn') aiTurnWithDelay();
    updateTurnWheel();
  }

  function getUnitSize(u) {
    const s = u.size || 1;
    return { w: u.w || u.width || s, h: u.h || u.height || s };
  }

  function occupiesCell(u, x, y) {
    const { w, h } = getUnitSize(u);
    return u.hp > 0 && x >= u.x && x < u.x + w && y >= u.y && y < u.y + h;
  }

  function getUnitAt(x, y) {
    return units.find(u => occupiesCell(u, x, y));
  }

  function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

  function isInMoveRange(unit, tx, ty) {
    const dist = Math.abs(unit.x - tx) + Math.abs(unit.y - ty);
    return dist > 0 && dist <= unit.moveRange;
  }

  function isInAttackRange(attacker, target) {
    const dist = manhattan(attacker, target);
    if (attacker.range && attacker.range > 1) {
      return dist > 0 && dist <= attacker.range;
    }
    return dist === 1;
  }

  // check if a unit can be placed at grid coords (top-left x,y)
  function canPlaceUnitAt(unit, x, y) {
    const { w, h } = getUnitSize(unit);
    // bounds
    if (x < 0 || y < 0 || x + w > GRID_COLS || y + h > GRID_ROWS) return false;
    // player units must be inside first two columns
    const maxPlayerCols = 2;
    if (unit.isPlayer) {
      if (x + w > maxPlayerCols) return false;
    }
    // check overlap with other units (ignore self)
    for (let oy = 0; oy < h; oy++) {
      for (let ox = 0; ox < w; ox++) {
        const tx = x + ox, ty = y + oy;
        const other = units.find(u => u !== unit && occupiesCell(u, tx, ty));
        if (other) return false;
      }
    }
    return true;
  }

  function getActiveUnit() {
    if (!turnOrder.length) return null;
    if (currentIndex < 0 || currentIndex >= turnOrder.length) return null;
    const u = turnOrder[currentIndex];
    return u && u.hp > 0 ? u : null;
  }

  function nextAliveIndex(startIdx) {
    if (!turnOrder.length) return -1;
    let idx = startIdx;
    let loops = 0;
    while (loops < turnOrder.length) {
      if (idx >= turnOrder.length) idx = 0;
      const u = turnOrder[idx];
      if (u && u.hp > 0) return idx;
      idx++;
      loops++;
    }
    return -1;
  }

  function checkVictory() {
    const anyPlayer = units.some(u => u.isPlayer && u.hp > 0);
    const anyEnemy = units.some(u => !u.isPlayer && u.hp > 0);
    if (!anyPlayer || !anyEnemy) {
      gameState = "gameOver";
      let winner;
      if (!anyPlayer && !anyEnemy) {
        setMessage(`Раунд ${roundNumber}. Нічия. Усі полягли в бою.`);
        winner = 'draw';
      } else if (!anyEnemy) {
        setMessage(`Раунд ${roundNumber}. Перемога! Ти знищив усіх ворогів.`);
        winner = 'player';
      } else {
        setMessage(`Раунд ${roundNumber}. Поразка. Ворог переміг.`);
        winner = 'enemy';
      }
      try {
        const payload = {
          winner,
          round: roundNumber,
          units: units.map(u => ({ id: u.id, name: u.name, isPlayer: u.isPlayer, hp: u.hp, maxHp: u.maxHp, attack: u.attack })),
          moves: recordedMoves
        };
        if (typeof sendMatchResult === 'function') {
          sendMatchResult(payload);
        }
        try { showResultModal(winner); } catch (e) { console.warn('Failed to show result modal', e); }
      } catch (err) { console.warn('Unable to send match result', err); }
      return true;
    }
    return false;
  }

  function performAttack(attacker, target) {
    const dmg = attacker.attack;
    target.hp = Math.max(0, target.hp - dmg);
    try { recordedMoves.push({ type: 'attack', time: Date.now(), attackerId: attacker.id, targetId: target.id, damage: dmg, targetHp: target.hp }); } catch(e){}
    setMessage(`${attacker.name} б'є ${target.name} на ${dmg} урону.`);
    if (target.hp <= 0) {
      setMessage(`${attacker.name} вбиває ${target.name}!`);
      units = units.filter(u => u.hp > 0);
      turnOrder = turnOrder.filter(u => u.hp > 0);
      try { recordedMoves.push({ type: 'kill', time: Date.now(), killerId: attacker.id, victimId: target.id }); } catch(e){}
    }
    updateTurnWheel();
  }

  function moveUnit(unit, tx, ty) {
    const fromX = unit.x;
    const fromY = unit.y;
    unit.x = tx; unit.y = ty;
    animations.push({ unit, fromX, fromY, toX: tx, toY: ty, elapsed: 0, duration: 220 });
    try { recordedMoves.push({ type: 'move', time: Date.now(), unitId: unit.id, from: { x: fromX, y: fromY }, to: { x: tx, y: ty } }); } catch(e){}
    setMessage(`${unit.name} рухається на (${tx + 1}, ${ty + 1}).`);
  }

  function endTurn() {
    if (checkVictory()) { updateTurnWheel(); return; }
    const prevIndex = currentIndex;
    currentIndex = nextAliveIndex(currentIndex + 1);
    if (currentIndex === -1) currentIndex = nextAliveIndex(0);
    if (currentIndex !== -1 && currentIndex <= prevIndex) roundNumber += 1;
    const active = getActiveUnit();
    if (!active) { updateTurnWheel(); return; }
    if (active.isPlayer) { gameState = "playerTurn"; setMessage(`Раунд ${roundNumber}. Твій хід. Активний юніт: ${active.name}.`); }
    else { gameState = "aiTurn"; setMessage(`Раунд ${roundNumber}. Хід ворога. Активний юніт: ${active.name}.`); aiTurnWithDelay(); }
    updateTurnWheel();
  }

  function aiTurnWithDelay() { if (gameState !== "aiTurn" || !getActiveUnit()) return; setTimeout(() => { aiAct(); }, 450); }

  function aiAct() {
    if (gameState !== "aiTurn") return;
    const unit = getActiveUnit(); if (!unit || unit.isPlayer || unit.hp <= 0) return;
    const targets = units.filter(u => u.isPlayer && u.hp > 0);
    if (!targets.length) { checkVictory(); return; }
    let closest = targets[0]; let minDist = manhattan(unit, closest);
    for (let t of targets) { const d = manhattan(unit, t); if (d < minDist) { minDist = d; closest = t; } }
    if (isInAttackRange(unit, closest)) { performAttack(unit, closest); setTimeout(() => endTurn(), 260); return; }
    let bestX = unit.x, bestY = unit.y, bestDist = minDist;
    const candidates = [ { x: unit.x + 1, y: unit.y }, { x: unit.x - 1, y: unit.y }, { x: unit.x, y: unit.y + 1 }, { x: unit.x, y: unit.y - 1 } ];
    for (let c of candidates) {
      if (c.x >= 0 && c.x < GRID_COLS && c.y >= 0 && c.y < GRID_ROWS && canPlaceUnitAt(unit, c.x, c.y)) {
        const d = Math.abs(c.x - closest.x) + Math.abs(c.y - closest.y);
        if (d < bestDist && Math.abs(c.x - unit.x) + Math.abs(c.y - unit.y) <= unit.moveRange) { bestDist = d; bestX = c.x; bestY = c.y; }
      }
    }
    if (bestX !== unit.x || bestY !== unit.y) moveUnit(unit, bestX, bestY); else setMessage(`${unit.name} не може вигідно рухатися й пропускає хід.`);
    setTimeout(() => endTurn(), 260);
  }

  function drawGrid() {
    ctx.save();
    ctx.lineWidth = 1;
    const active = getActiveUnit();
    const showMoveOutline = active && active.isPlayer && gameState === "playerTurn" && !active.isDead;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const x = OFFSET_X + c * CELL_SIZE;
        const y = OFFSET_Y + r * CELL_SIZE;
        ctx.strokeStyle = "rgba(148, 163, 184, 0.4)";
        ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
        if ((r + c) % 2 === 0) ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
        else ctx.fillStyle = "rgba(15, 23, 42, 0.7)";
        ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);

        // Highlight valid placement areas while in placement mode.
        // For multi-cell units we draw the full w*h translucent block using the cell as top-left.
        if (isPlacement && selectedUnit) {
          const { w, h } = getUnitSize(selectedUnit);
          // only draw when the top-left of the unit at (c,r) would be valid
          if (canPlaceUnitAt(selectedUnit, c, r)) {
            ctx.save();
            // translucent fill for the whole unit area
            ctx.fillStyle = "rgba(34,197,94,0.12)"; // green, subtle
            ctx.fillRect(x + 2, y + 2, CELL_SIZE * w - 4, CELL_SIZE * h - 4);
            // stronger stroke around the candidate placement
            ctx.strokeStyle = "rgba(16,185,129,0.85)";
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            ctx.strokeRect(x + 2, y + 2, CELL_SIZE * w - 4, CELL_SIZE * h - 4);
            ctx.restore();
          }
        }

        // show move-outline for active unit when relevant
        if (showMoveOutline && isInMoveRange(active, c, r) && canPlaceUnitAt(active, c, r)) {
          ctx.save();
          ctx.strokeStyle = "rgba(34,197,94,0.9)";
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(x + 4, y + 4, CELL_SIZE - 8, CELL_SIZE - 8);
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  function drawUnits() {
    const active = getActiveUnit();
    for (let u of units) {
      const gx = (typeof u.visualX === "number") ? u.visualX : u.x;
      const gy = (typeof u.visualY === "number") ? u.visualY : u.y;
      const { w, h } = getUnitSize(u);
      const x = OFFSET_X + gx * CELL_SIZE; const y = OFFSET_Y + gy * CELL_SIZE;
      // shadow for active
      if (active && active.id === u.id && gameState !== "gameOver") {
        ctx.save(); ctx.shadowBlur = 20; ctx.shadowColor = u.isPlayer ? "#38bdf8" : "#f97316"; ctx.fillStyle = "rgba(15, 23, 42, 0.9)"; ctx.fillRect(x + 4, y + 4, w * CELL_SIZE - 8, h * CELL_SIZE - 8); ctx.restore();
      }
      // body (respect multi-cell size)
      ctx.save(); ctx.fillStyle = u.isPlayer ? "#3b82f6" : "#ef4444"; ctx.strokeStyle = "#020617"; ctx.lineWidth = 2;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x + 8, y + 8, w * CELL_SIZE - 16, h * CELL_SIZE - 16, 10); ctx.fill(); ctx.stroke(); }
      else { ctx.fillRect(x + 8, y + 8, w * CELL_SIZE - 16, h * CELL_SIZE - 16); ctx.strokeRect(x + 8, y + 8, w * CELL_SIZE - 16, h * CELL_SIZE - 16); }
      ctx.restore();
      // HP bar across the bottom of the unit
      const hpRatio = u.hp / u.maxHp; const barWidth = w * CELL_SIZE - 16; const barX = x + 8; const barY = y + h * CELL_SIZE - 10;
      ctx.save(); ctx.fillStyle = "#1f2937"; ctx.fillRect(barX, barY, barWidth, 4); ctx.fillStyle = hpRatio > 0.5 ? "#22c55e" : hpRatio > 0.25 ? "#eab308" : "#ef4444"; ctx.fillRect(barX, barY, barWidth * hpRatio, 4); ctx.restore();
      // text centered on unit
      ctx.save(); ctx.fillStyle = "#e5e7eb"; ctx.font = "10px system-ui"; ctx.textAlign = "center"; ctx.fillText(u.name, x + (w * CELL_SIZE) / 2, y + 18); ctx.fillText(`${u.hp}/${u.maxHp}`, x + (w * CELL_SIZE) / 2, y + (h * CELL_SIZE) / 2 + 4); ctx.restore();
      // highlight top-left for selected in placement
      if (isPlacement && u.isPlayer && selectedUnit && selectedUnit.id === u.id) { ctx.save(); ctx.strokeStyle = '#facc15'; ctx.lineWidth = 4; ctx.strokeRect(x + 6, y + 6, w * CELL_SIZE - 12, h * CELL_SIZE - 12); ctx.restore(); }
    }
  }

  function drawTurnInfo() { const active = getActiveUnit(); if (!active) return; ctx.save(); ctx.font = "14px system-ui"; ctx.textAlign = "left"; const textY = OFFSET_Y - 16; const textX = OFFSET_X; const role = active.isPlayer ? "Твій юніт" : "Ворог"; const sideColor = active.isPlayer ? "#38bdf8" : "#f97316"; ctx.fillStyle = "#e5e7eb"; ctx.fillText(`${role}: ${active.name}`, textX, textY); ctx.fillStyle = sideColor; ctx.fillText(`Хід: ${active.isPlayer ? "гравця" : "AI"}`, textX + 200, textY); ctx.fillStyle = "#9ca3af"; ctx.fillText(`Раунд: ${roundNumber}`, textX + 360, textY); ctx.restore(); }

  function render() { ctx.clearRect(0, 0, canvas.width, canvas.height); drawGrid(); drawUnits(); drawTurnInfo(); }

  function setMessage(text) { msgEl.textContent = text; }

  async function sendMatchResult(payload) {
    try {
      const resp = await fetch('/api/matches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!resp.ok) { console.warn('Server returned non-OK when saving match:', resp.status); } else { const data = await resp.json(); console.log('Match saved, id=', data.id); try { window.__last_saved_match_id = data.id; } catch(e){} }
    } catch (e) { console.warn('Failed to send match result', e); }
  }

  const resultOverlay = document.getElementById('result-modal-overlay');
  const resultTitle = document.getElementById('result-title');
  const resultMessage = document.getElementById('result-message');
  const btnRestartModal = document.getElementById('btn-restart-modal');
  const btnReplay = document.getElementById('btn-replay');

  function showResultModal(winner) {
    let title = 'Результат бою'; let message = '';
    if (winner === 'player') { title = 'Перемога!'; message = 'Ти переміг усіх ворогів.'; }
    else if (winner === 'enemy') { title = 'Поразка'; message = 'Ворог переміг.'; }
    else { title = 'Нічия'; message = 'Бій закінчився внічию.'; }
    resultTitle.textContent = title; resultMessage.textContent = message; resultOverlay.style.display = 'flex'; resultOverlay.setAttribute('aria-hidden', 'false');
    try { if (window.__last_saved_match_id) { btnReplay.style.display = 'inline-block'; btnReplay.href = `/replay.html?id=${window.__last_saved_match_id}`; } else { btnReplay.style.display = 'none'; } } catch (e) { console.warn('Failed to set replay link', e); }
  }

  function hideResultModal() { resultOverlay.style.display = 'none'; resultOverlay.setAttribute('aria-hidden', 'true'); }

  btnRestartModal.addEventListener('click', () => { hideResultModal(); initBattle(); });

  function updateTurnWheel() {
    while (turnWheelEl.children.length > 1) { turnWheelEl.removeChild(turnWheelEl.lastChild); }
    if (!turnOrder.length) return; const ordered = []; const len = turnOrder.length; if (len === 0) return; let start = currentIndex; if (start < 0 || start >= len) start = 0;
    for (let i = 0; i < len; i++) { const idx = (start + i) % len; const u = turnOrder[idx]; if (!u || u.hp <= 0) continue; ordered.push({ unit: u, isActive: i === 0 }); }
    ordered.forEach(entry => { const u = entry.unit; const div = document.createElement("div"); div.classList.add("turn-item"); div.classList.add(u.isPlayer ? "player" : "enemy"); if (entry.isActive && gameState !== "gameOver") { div.classList.add("active"); } const label = u.name.slice(0, 2).toUpperCase(); div.textContent = label; turnWheelEl.appendChild(div); });
    turnWheelLabel.textContent = `Черга ходів (раунд ${roundNumber}):`;
  }

  function updateAnimations(deltaMs) {
    if (!animations.length) return; const toRemove = [];
    animations.forEach((anim, index) => { anim.elapsed += deltaMs; const t = Math.min(1, anim.elapsed / anim.duration); anim.unit.visualX = anim.fromX + (anim.toX - anim.fromX) * t; anim.unit.visualY = anim.fromY + (anim.toY - anim.fromY) * t; if (t >= 1) { anim.unit.visualX = anim.toX; anim.unit.visualY = anim.toY; toRemove.push(index); } });
    for (let i = toRemove.length - 1; i >= 0; i--) animations.splice(toRemove[i], 1);
  }

  function gameLoop(timestamp) { const delta = timestamp - lastTimestamp; lastTimestamp = timestamp; updateAnimations(delta); render(); requestAnimationFrame(gameLoop); }

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect(); const mx = e.clientX - rect.left; const my = e.clientY - rect.top; const gx = Math.floor((mx - OFFSET_X) / CELL_SIZE); const gy = Math.floor((my - OFFSET_Y) / CELL_SIZE);
    if (gx < 0 || gx >= GRID_COLS || gy < 0 || gy >= GRID_ROWS) return;
    if (isPlacement || gameState === 'placement') {
      const clicked = getUnitAt(gx, gy);
      if (clicked && clicked.isPlayer) {
        selectedUnit = clicked;
        setMessage('Юніт вибрано. Клікніть по клітинці щоб поставити його.');
        return;
      }
      if (!clicked) {
        if (!selectedUnit) {
          const candidates = units.filter(u => u.isPlayer && u.hp > 0);
          if (candidates.length > 0) {
            let best = null; let bestDist = Infinity;
            for (let u of candidates) {
              const d = Math.abs(u.x - gx) + Math.abs(u.y - gy);
              if (d < bestDist) { best = u; bestDist = d; }
            }
            selectedUnit = best;
          }
        }
        if (!selectedUnit) { setMessage('Немає доступних юнітів для розміщення.'); return; }

        // attempt to place the selected unit with top-left at (gx,gy)
        if (!canPlaceUnitAt(selectedUnit, gx, gy)) {
          setMessage('Неможливо поставити юніта сюди. Спробуйте іншу клітинку (тільки перші 2 колонки для розміщення).');
          return;
        }

        selectedUnit.x = gx; selectedUnit.y = gy; selectedUnit.visualX = gx; selectedUnit.visualY = gy;
        try { recordedMoves.push({ type: 'place', time: Date.now(), unitId: selectedUnit.id, x: gx, y: gy }); } catch (err) {}
        selectedUnit = null; setMessage('Юніт поставлено. Виберіть наступний або натисніть "Почати бій".'); updateTurnWheel(); return;
      }
      return;
    }
    if (gameState !== "playerTurn") return; const active = getActiveUnit(); if (!active || !active.isPlayer || active.hp <= 0) return; const target = getUnitAt(gx, gy);
    if (target && !target.isPlayer) { if (isInAttackRange(active, target)) { performAttack(active, target); setTimeout(() => endTurn(), 260); } else { setMessage("Ціль занадто далеко для атаки."); } return; }
    if (!target) {
      if (!isInMoveRange(active, gx, gy)) {
        setMessage("Точка занадто далеко для руху.");
      } else if (!canPlaceUnitAt(active, gx, gy)) {
        setMessage("Не можна рухатися сюди — зайнято або не в межах дозволених колонок.");
      } else {
        moveUnit(active, gx, gy);
        setTimeout(() => endTurn(), 260);
      }
    }
  });

  restartBtn.addEventListener("click", () => { enterPlacementMode(); });
  const resetUnitsBtn = document.getElementById('btn-reset-units'); if (resetUnitsBtn) { resetUnitsBtn.addEventListener('click', () => { enterPlacementMode(); }); }
  if (startBtn) { startBtn.addEventListener('click', () => { if (!isPlacement && gameState !== 'placement') { enterPlacementMode(); return; } startBattleFromPlacement(); }); }

  window.__bs_start = function() { enterPlacementMode(); requestAnimationFrame(gameLoop); };
  if (window.INITIAL_UNITS) { window.__bs_start(); }
})();
