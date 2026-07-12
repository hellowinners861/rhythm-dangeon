// notesui.js … ノーツレーン・判定表示
// 画面下部中央に判定点を置き、今後2小節分の拍ノーツが左右から流れる。
// 位置は Conductor.currentBeat() だけから算出し、performance.now は表示フェードにのみ使う。

const NotesUI = (() => {
  const FALLBACK = {
    LOOKAHEAD_BEATS: 8,
    CENTER_Y: 665,
    HALF_WIDTH: 400,
    BAND_HEIGHT: 92,
    POP_MS: 560,
    RADIUS: { DOWNBEAT: 19, BEAT: 13, EIGHTH: 8 },
  };

  const COLORS = {
    PERFECT: "#ffd66b",
    GOOD: "#77e0b2",
    MISS: "#ff7c86",
  };

  let pop = null; // { verdict, diffMs, born } bornはperformance.now

  function settings() {
    return (CONFIG.UI && CONFIG.UI.NOTES) || FALLBACK;
  }

  function popJudge(verdict, diffMs) {
    pop = { verdict, diffMs, born: performance.now() };
  }

  function roundedRect(g, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  function draw(g, viewW, viewH, options = {}) {
    const cfg = settings();
    const cx = viewW / 2;
    const cy = Math.min(cfg.CENTER_Y, viewH - 190);
    const halfW = Math.min(cfg.HALF_WIDTH, viewW * 0.32);
    const bandH = cfg.BAND_HEIGHT;
    const beatsPerBar = CONFIG.METRONOME.BEATS_PER_BAR;
    const running = !!Conductor.running;
    const cur = running ? Conductor.currentBeat() : 0;
    const section = running ? Conductor.sectionAt(cur) : { div: 1, fever: false };
    const forcedRest = !!options.forcedRest;
    const curRest = forcedRest || section.div === 0;
    // section.fever は譜面の盛り上がり。コンボフィーバーとは色を分けてシアンで示す。
    const chartFever = !!section.fever && !curRest;
    const frac = cur - Math.floor(cur);
    const beatPulse = running ? Math.max(0, 1 - frac * 4) : 0;

    g.save();

    // 帯の外枠。中央の情報だけを濃くし、ゲーム画面を覆いすぎない細いカプセルにする。
    const outerX = cx - halfW - 38;
    const outerY = cy - bandH / 2;
    const outerW = (halfW + 38) * 2;
    const laneGrad = g.createLinearGradient(outerX, cy, outerX + outerW, cy);
    laneGrad.addColorStop(0, "rgba(4,12,28,0.28)");
    laneGrad.addColorStop(0.18, "rgba(7,18,39,0.78)");
    laneGrad.addColorStop(0.5, curRest ? "rgba(9,13,24,0.92)" : "rgba(10,24,48,0.94)");
    laneGrad.addColorStop(0.82, "rgba(7,18,39,0.78)");
    laneGrad.addColorStop(1, "rgba(4,12,28,0.28)");
    roundedRect(g, outerX, outerY, outerW, bandH, bandH / 2);
    g.fillStyle = laneGrad;
    g.fill();
    g.strokeStyle = chartFever
      ? `rgba(119,216,255,${0.48 + beatPulse * 0.28})`
      : curRest ? "rgba(160,174,202,0.16)" : "rgba(166,206,255,0.26)";
    g.lineWidth = chartFever ? 3 : 2;
    g.stroke();

    // レーン中心線と4分割目盛り。先の拍ほど細く見せ、流れる方向を直感的に示す。
    const lineGrad = g.createLinearGradient(cx - halfW, cy, cx + halfW, cy);
    lineGrad.addColorStop(0, "rgba(132,170,220,0.08)");
    lineGrad.addColorStop(0.5, "rgba(215,235,255,0.50)");
    lineGrad.addColorStop(1, "rgba(132,170,220,0.08)");
    g.strokeStyle = lineGrad;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx - halfW, cy);
    g.lineTo(cx + halfW, cy);
    g.stroke();
    for (let i = 1; i <= 4; i++) {
      const d = (halfW * i) / 4;
      const tickH = i === 4 ? 14 : 9;
      g.strokeStyle = i === 4 ? "rgba(119,216,255,0.28)" : "rgba(185,215,250,0.15)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx - d, cy - tickH);
      g.lineTo(cx - d, cy + tickH);
      g.moveTo(cx + d, cy - tickH);
      g.lineTo(cx + d, cy + tickH);
      g.stroke();
    }

    // 未来ノーツを遠いものから描き、判定点付近のノーツが常に手前へ来るようにする。
    if (running && !forcedRest) {
      const start2 = Math.ceil((cur + 0.001) * 2);
      const end2 = Math.floor((cur + cfg.LOOKAHEAD_BEATS) * 2);
      for (let n2 = end2; n2 >= start2; n2--) {
        const beat = n2 / 2;
        const sec = Conductor.sectionAt(beat);
        if (sec.div === 0) continue;
        const isHalf = n2 % 2 !== 0;
        if (isHalf && sec.div !== 2) continue;
        const p = (beat - cur) / cfg.LOOKAHEAD_BEATS;
        if (p < 0 || p > 1) continue;

        const dist = p * halfW;
        const fade = 0.28 + (1 - p) * 0.72;
        const downbeat = !isHalf && Math.round(beat) % beatsPerBar === 0;
        const kind = isHalf ? "eighth" : downbeat ? "downbeat" : "beat";
        const r = isHalf ? cfg.RADIUS.EIGHTH : downbeat ? cfg.RADIUS.DOWNBEAT : cfg.RADIUS.BEAT;
        const color = sec.fever
          ? "#82e8ff"
          : downbeat ? "#8ed8ff" : isHalf ? "#afbdd5" : "#edf5ff";
        drawNote(g, cx - dist, cy, r, kind, color, fade);
        drawNote(g, cx + dist, cy, r, kind, color, fade);
      }
    }

    // 判定ターゲット。拍頭で外輪だけ短く収縮し、ノーツの到達点を強調する。
    const ringR = 31 + beatPulse * 8;
    g.strokeStyle = curRest
      ? "rgba(170,184,210,0.28)"
      : chartFever ? "rgba(119,216,255,0.92)" : "rgba(229,242,255,0.72)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, ringR, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = curRest ? "rgba(130,145,175,0.18)" : "rgba(119,216,255,0.28)";
    g.lineWidth = 7;
    g.beginPath();
    g.arc(cx, cy, 43 + beatPulse * 5, 0, Math.PI * 2);
    g.stroke();
    g.save();
    g.translate(cx, cy);
    g.rotate(Math.PI / 4);
    const targetSize = 13 + beatPulse * 2;
    g.fillStyle = curRest ? "#7c879f" : chartFever ? "#77d8ff" : "#f7fbff";
    g.fillRect(-targetSize, -targetSize, targetSize * 2, targetSize * 2);
    g.strokeStyle = "rgba(7,16,31,0.92)";
    g.lineWidth = 4;
    g.strokeRect(-targetSize, -targetSize, targetSize * 2, targetSize * 2);
    g.restore();

    if (curRest) {
      g.textAlign = "center";
      g.fillStyle = "rgba(190,204,228,0.72)";
      g.font = "800 15px sans-serif";
      g.fillText("BREAK", cx, cy + bandH / 2 - 12);
    }

    drawJudgePop(g, cx, cy, cfg.POP_MS);
    g.restore();
  }

  function drawNote(g, x, y, r, kind, color, alpha) {
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    if (kind === "downbeat") {
      g.rotate(Math.PI / 4);
      g.fillStyle = "rgba(8,20,39,0.92)";
      g.strokeStyle = color;
      g.lineWidth = 5;
      g.fillRect(-r, -r, r * 2, r * 2);
      g.strokeRect(-r, -r, r * 2, r * 2);
      const inner = r * 0.42;
      g.fillStyle = color;
      g.fillRect(-inner, -inner, inner * 2, inner * 2);
    } else if (kind === "eighth") {
      g.strokeStyle = color;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = color;
      g.beginPath();
      g.arc(0, 0, 2.5, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = "rgba(8,20,39,0.92)";
      g.strokeStyle = color;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = color;
      g.beginPath();
      g.arc(0, 0, r * 0.36, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  function drawJudgePop(g, cx, cy, popMs) {
    if (!pop) return;
    const age = performance.now() - pop.born;
    if (age > popMs) {
      pop = null;
      return;
    }

    const t = age / popMs;
    const alpha = 1 - t * t;
    const enter = Math.min(1, age / 90);
    const scale = 0.82 + enter * 0.18;
    const rise = 68 + t * 34;
    const color = COLORS[pop.verdict] || "#fff";

    // 到達点から広がる1本のエコーリング。粒子を乱数生成せず負荷とちらつきを抑える。
    g.save();
    g.globalAlpha = alpha * 0.72;
    g.strokeStyle = color;
    g.lineWidth = 5 * (1 - t) + 1;
    g.beginPath();
    g.arc(cx, cy, 38 + t * 52, 0, Math.PI * 2);
    g.stroke();
    g.restore();

    g.save();
    g.translate(cx, cy - rise);
    g.scale(scale, scale);
    g.globalAlpha = alpha;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "900 42px sans-serif";
    g.lineJoin = "round";
    g.strokeStyle = "rgba(4,10,23,0.92)";
    g.lineWidth = 9;
    g.strokeText(pop.verdict, 0, 0);
    g.fillStyle = color;
    g.fillText(pop.verdict, 0, 0);

    if (pop.verdict !== "MISS" && Math.abs(pop.diffMs) >= 1) {
      const early = pop.diffMs < 0;
      g.font = "800 17px sans-serif";
      g.lineWidth = 5;
      g.strokeStyle = "rgba(4,10,23,0.90)";
      g.strokeText(early ? "はやい" : "おそい", 0, 28);
      g.fillStyle = early ? "#8ed8ff" : "#ffad91";
      g.fillText(early ? "はやい" : "おそい", 0, 28);
    }
    g.restore();
  }

  return { draw, popJudge };
})();
