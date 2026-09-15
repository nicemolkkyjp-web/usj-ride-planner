// USJまわり方プランナー: 予測ロジック・スケジューリング・画面描画

const LOG_STORAGE_KEY = "usj-planner-logs-v1";

// ---------- 時刻ユーティリティ ----------

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const m = Math.round(mins) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// ---------- 混雑予測 ----------

// hourFloat: 9.0〜21.0 の範囲の時刻(9時開園〜21時閉園を想定したカーブ)
function curveValueAt(curveName, hourFloat) {
  const curve = CURVES[curveName];
  const clamped = Math.min(Math.max(hourFloat, 9), 21);
  const idx = Math.floor(clamped - 9);
  const frac = clamped - 9 - idx;
  const a = curve[idx];
  const b = curve[Math.min(idx + 1, curve.length - 1)];
  return a * (1 - frac) + b * frac;
}

function getPastAdjustment(attractionId) {
  const logs = loadLogs().filter((l) => l.attractionId === attractionId);
  if (logs.length === 0) return 1;
  // 直近の記録ほど重みを大きく、predicted(記録時点の基本予測)との比を平均する
  const recent = logs.slice(-5);
  let weightedSum = 0;
  let weightTotal = 0;
  recent.forEach((log, i) => {
    const weight = i + 1;
    const basePredicted = basePredictedWait(attractionId, log.hourFloat, "weekday", 0);
    const ratio = basePredicted > 0 ? log.actualWait / basePredicted : 1;
    weightedSum += ratio * weight;
    weightTotal += weight;
  });
  const avgRatio = weightedSum / weightTotal;
  // 補正は±40%までに制限し、極端な値を避ける
  return Math.min(Math.max(avgRatio, 0.6), 1.4);
}

function basePredictedWait(attractionId, hourFloat, dayType, feltCrowd) {
  const attraction = ATTRACTIONS.find((a) => a.id === attractionId);
  const curveName = attraction.curve || attraction.tier;
  const peak = PEAK_MINUTES[attraction.tier];
  const dayMultiplier = DAY_TYPE_MULTIPLIER[dayType] ?? 1;
  const feltMultiplier = 1 + Number(feltCrowd || 0);
  const raw = peak * curveValueAt(curveName, hourFloat) * dayMultiplier * feltMultiplier;
  return raw;
}

function predictedWait(attractionId, hourFloat, dayType, feltCrowd) {
  const base = basePredictedWait(attractionId, hourFloat, dayType, feltCrowd);
  const adjustment = getPastAdjustment(attractionId);
  const value = base * adjustment;
  return Math.max(5, Math.round(value / 5) * 5);
}

// ---------- 移動時間 ----------

function travelMinutes(areaA, areaB) {
  if (areaA === areaB) return 3;
  const n = AREAS.length;
  const diff = Math.abs(areaA - areaB);
  const loopDiff = Math.min(diff, n - diff);
  return 3 + loopDiff * 7;
}

// ---------- スケジューリング(貪欲法) ----------

// 「空いている時間まで待つ」ためにずらしてよい時間の上限(分)。
// これを超える無目的な空き時間は作らない。
const MAX_DELAY_MINUTES = 90;

function buildScheduleCore({
  selectedIds,
  entryTime,
  exitTime,
  dayType,
  feltCrowd,
  lunchBreak,
  dinnerBreak,
  allowDelay,
}) {
  let currentMinutes = timeToMinutes(entryTime);
  const exitMinutes = timeToMinutes(exitTime);
  let currentArea = 0; // メインエントランス(ハリウッド・エリア)からスタート
  let remaining = [...selectedIds];
  const schedule = [];
  let lunchTaken = !lunchBreak;
  let dinnerTaken = !dinnerBreak;

  while (remaining.length > 0 && currentMinutes < exitMinutes) {
    if (!lunchTaken && currentMinutes >= timeToMinutes("12:00")) {
      schedule.push({ type: "lunch", start: currentMinutes, end: currentMinutes + 45 });
      currentMinutes += 45;
      lunchTaken = true;
      continue;
    }
    if (!dinnerTaken && currentMinutes >= timeToMinutes("18:00")) {
      schedule.push({ type: "dinner", start: currentMinutes, end: currentMinutes + 45 });
      currentMinutes += 45;
      dinnerTaken = true;
      continue;
    }

    let best = null;
    for (const id of remaining) {
      const attraction = ATTRACTIONS.find((a) => a.id === id);
      const walk = travelMinutes(currentArea, attraction.area);
      const arrival = currentMinutes + walk;
      const hourFloat = arrival / 60;
      const wait = predictedWait(id, hourFloat, dayType, feltCrowd);
      const cost = walk + wait;
      if (!best || cost < best.cost) {
        best = { id, attraction, walk, arrival, wait, cost };
      }
    }

    if (best.arrival >= exitMinutes) break;

    // 最後の1つになったアトラクションは、少し待てば明らかに空くタイミングが
    // あるなら乗る時刻をずらす。ただし目的なく長時間空けないよう上限を設ける。
    if (allowDelay && remaining.length === 1) {
      const delayLimit = Math.min(exitMinutes, currentMinutes + MAX_DELAY_MINUTES);
      let bestDelayed = null;
      for (let t = best.arrival; t <= delayLimit; t += 15) {
        const w = predictedWait(best.id, t / 60, dayType, feltCrowd);
        if (t + w + best.attraction.duration > exitMinutes) continue;
        if (!bestDelayed || w < bestDelayed.wait) {
          bestDelayed = { time: t, wait: w };
        }
      }
      if (bestDelayed && bestDelayed.wait <= best.wait - 15 && bestDelayed.time > best.arrival) {
        schedule.push({
          type: "free",
          start: currentMinutes,
          end: bestDelayed.time,
          reason: `${best.attraction.name}は${Math.floor(bestDelayed.time / 60)}時頃の方が空いている見込みのため、周辺エリアを散策するなど時間調整がおすすめです`,
        });
        best.arrival = bestDelayed.time;
        best.wait = bestDelayed.wait;
        best.walk = 0;
      }
    }

    const rideEnd = best.arrival + best.wait + best.attraction.duration;

    schedule.push({
      type: "ride",
      id: best.id,
      name: best.attraction.name,
      area: AREAS[best.attraction.area],
      walk: best.walk,
      arrival: best.arrival,
      wait: best.wait,
      rideEnd,
    });

    currentMinutes = rideEnd;
    currentArea = best.attraction.area;
    remaining = remaining.filter((id) => id !== best.id);
  }

  return { schedule, leftover: remaining };
}

function buildSchedule(params) {
  const withComfort = buildScheduleCore({ ...params, allowDelay: true });
  if (withComfort.leftover.length === 0) {
    return { ...withComfort, breaksSkipped: false };
  }

  // 時間に余裕がなく全部は回れない場合、休憩や時間調整を省いて
  // できるだけ全アトラクションに乗れることを優先する
  const wantedBreaks = params.lunchBreak || params.dinnerBreak;
  const noComfort = buildScheduleCore({
    ...params,
    lunchBreak: false,
    dinnerBreak: false,
    allowDelay: false,
  });

  if (noComfort.leftover.length < withComfort.leftover.length) {
    return { ...noComfort, breaksSkipped: wantedBreaks };
  }
  return { ...withComfort, breaksSkipped: false };
}

// ---------- 実績記録(localStorage) ----------

function loadLogs() {
  try {
    return JSON.parse(localStorage.getItem(LOG_STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveLogs(logs) {
  localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs));
}

function addLog(log) {
  const logs = loadLogs();
  logs.push(log);
  saveLogs(logs);
}

function removeLog(index) {
  const logs = loadLogs();
  logs.splice(index, 1);
  saveLogs(logs);
}

// ---------- 画面描画: フォーム ----------

function renderAttractionCheckboxes() {
  const container = document.getElementById("attraction-list");
  const byArea = {};
  ATTRACTIONS.forEach((a) => {
    byArea[a.area] = byArea[a.area] || [];
    byArea[a.area].push(a);
  });

  container.innerHTML = Object.keys(byArea)
    .sort((a, b) => a - b)
    .map((areaIdx) => {
      const items = byArea[areaIdx]
        .map(
          (a) => `
        <label class="attraction-item">
          <input type="checkbox" value="${a.id}" class="attraction-checkbox" />
          <span>${a.name}</span>
          ${a.note ? `<small class="note">${a.note}</small>` : ""}
        </label>`
        )
        .join("");
      return `<div class="area-group"><h4>${AREAS[areaIdx]}</h4>${items}</div>`;
    })
    .join("");
}

function renderLogAttractionOptions() {
  const select = document.getElementById("log-attraction");
  select.innerHTML = ATTRACTIONS.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
}

// ---------- 混雑度の色分け ----------

function waitSeverityClass(minutes) {
  if (minutes <= 20) return "wait-short";
  if (minutes <= 50) return "wait-medium";
  return "wait-long";
}

// ---------- 画面描画: 結果 ----------

function renderResult({ schedule, leftover, breaksSkipped }, dayType, feltCrowd) {
  const resultSection = document.getElementById("result-section");
  resultSection.hidden = false;

  const rideEvents = schedule.filter((s) => s.type === "ride");
  const totalWait = rideEvents.reduce((sum, r) => sum + r.wait, 0);

  document.getElementById("summary").innerHTML = `
    <div class="summary-item"><strong>${rideEvents.length}</strong> 件のアトラクションを予定</div>
    <div class="summary-item">合計予想待ち時間 <strong>${totalWait}分</strong></div>
    ${
      breaksSkipped
        ? `<div class="summary-item summary-warn">時間に余裕がないため、休憩を省略して全て乗れるプランにしています</div>`
        : ""
    }
  `;

  const rows = [];
  let order = 1;
  schedule.forEach((s) => {
    if (s.type === "lunch") {
      rows.push(`
        <tr class="lunch-row">
          <td colspan="6">昼休憩 (${minutesToTime(s.start)} 〜 ${minutesToTime(s.end)})</td>
        </tr>`);
      return;
    }
    if (s.type === "dinner") {
      rows.push(`
        <tr class="lunch-row">
          <td colspan="6">夕食休憩 (${minutesToTime(s.start)} 〜 ${minutesToTime(s.end)})</td>
        </tr>`);
      return;
    }
    if (s.type === "free") {
      rows.push(`
        <tr class="lunch-row">
          <td colspan="6">自由時間 (${minutesToTime(s.start)} 〜 ${minutesToTime(s.end)}): ${s.reason}</td>
        </tr>`);
      return;
    }
    const tip = buildTip(s.id, s.arrival, dayType, feltCrowd);
    rows.push(`
      <tr>
        <td>${order++}</td>
        <td>${s.name}<br><small class="note">${s.area}(移動約${s.walk}分)</small></td>
        <td>${minutesToTime(s.arrival)}</td>
        <td><span class="wait-pill ${waitSeverityClass(s.wait)}">${s.wait}分</span></td>
        <td>${minutesToTime(s.rideEnd)}</td>
        <td>${tip}</td>
      </tr>`);
  });
  document.getElementById("plan-body").innerHTML = rows.join("");

  const leftoverEl = document.getElementById("leftover");
  if (leftover.length > 0) {
    leftoverEl.hidden = false;
    const names = leftover.map((id) => ATTRACTIONS.find((a) => a.id === id).name).join("、");
    leftoverEl.textContent = `時間内に周りきれない可能性があります: ${names}。退園時刻を遅くするか、対象を絞ることをおすすめします。`;
  } else {
    leftoverEl.hidden = true;
  }

  renderForecastCharts(rideEvents.map((r) => r.id), dayType, feltCrowd);
}

function buildTip(attractionId, arrivalMinutes, dayType, feltCrowd) {
  const hours = [];
  for (let h = 9; h <= 21; h += 0.5) hours.push(h);
  const waits = hours.map((h) => predictedWait(attractionId, h, dayType, feltCrowd));
  const minWait = Math.min(...waits);
  const currentWait = predictedWait(attractionId, arrivalMinutes / 60, dayType, feltCrowd);
  if (currentWait <= minWait * 1.15) {
    return "空いている時間帯です";
  }
  const bestIdx = waits.indexOf(minWait);
  const bestHour = hours[bestIdx];
  const bestH = Math.floor(bestHour);
  const bestM = bestHour % 1 === 0 ? "00" : "30";
  return `${bestH}:${bestM}頃なら約${minWait}分の見込み`;
}

function renderForecastCharts(attractionIds, dayType, feltCrowd) {
  const container = document.getElementById("forecast-charts");
  const hours = [];
  for (let h = 9; h <= 21; h++) hours.push(h);

  container.innerHTML = attractionIds
    .map((id) => {
      const attraction = ATTRACTIONS.find((a) => a.id === id);
      const waits = hours.map((h) => predictedWait(id, h, dayType, feltCrowd));
      const maxWait = Math.max(...waits, 1);
      const bars = waits
        .map((w, i) => {
          const heightPct = Math.max(6, Math.round((w / maxWait) * 100));
          return `<div class="bar-wrap" title="${hours[i]}時: 約${w}分">
              <div class="bar ${waitSeverityClass(w)}" style="height:${heightPct}%"></div>
              <span class="bar-label">${hours[i]}</span>
            </div>`;
        })
        .join("");
      return `<div class="chart-block">
          <h4>${attraction.name}</h4>
          <div class="bar-chart">${bars}</div>
        </div>`;
    })
    .join("");
}

// ---------- 実績記録テーブル ----------

function renderLogTable() {
  const logs = loadLogs();
  const table = document.getElementById("log-table");
  const body = document.getElementById("log-body");
  if (logs.length === 0) {
    table.hidden = true;
    body.innerHTML = "";
    return;
  }
  table.hidden = false;
  body.innerHTML = logs
    .map((log, i) => {
      const attraction = ATTRACTIONS.find((a) => a.id === log.attractionId);
      return `<tr>
          <td>${log.date}</td>
          <td>${attraction ? attraction.name : log.attractionId}</td>
          <td>${log.time}</td>
          <td>${log.actualWait}分</td>
          <td><button type="button" class="link-btn" data-index="${i}">削除</button></td>
        </tr>`;
    })
    .join("");

  body.querySelectorAll(".link-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      removeLog(Number(btn.dataset.index));
      renderLogTable();
    });
  });
}

// ---------- イベント登録 ----------

function init() {
  renderAttractionCheckboxes();
  renderLogAttractionOptions();
  renderLogTable();

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("visit-date").value = today;

  document.getElementById("plan-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const selectedIds = Array.from(document.querySelectorAll(".attraction-checkbox:checked")).map(
      (cb) => cb.value
    );
    if (selectedIds.length === 0) {
      alert("乗りたいアトラクションを1つ以上選んでください");
      return;
    }
    const entryTime = document.getElementById("entry-time").value;
    const exitTime = document.getElementById("exit-time").value;
    const dayType = document.getElementById("day-type").value;
    const feltCrowd = document.getElementById("felt-crowd").value;
    const lunchBreak = document.getElementById("lunch-break").checked;
    const dinnerBreak = document.getElementById("dinner-break").checked;

    const result = buildSchedule({
      selectedIds,
      entryTime,
      exitTime,
      dayType,
      feltCrowd,
      lunchBreak,
      dinnerBreak,
    });
    renderResult(result, dayType, feltCrowd);
    document.getElementById("result-section").scrollIntoView({ behavior: "smooth" });
  });

  document.getElementById("log-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const attractionId = document.getElementById("log-attraction").value;
    const time = document.getElementById("log-time").value;
    const actualWait = Number(document.getElementById("log-wait").value);
    const date = document.getElementById("visit-date").value || new Date().toISOString().slice(0, 10);
    addLog({
      attractionId,
      time,
      date,
      actualWait,
      hourFloat: timeToMinutes(time) / 60,
    });
    renderLogTable();
    document.getElementById("log-form").reset();
  });
}

document.addEventListener("DOMContentLoaded", init);
