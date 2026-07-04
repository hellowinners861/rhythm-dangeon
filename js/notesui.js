// notesui.js … ノーツレーン・判定表示
// 画面下部中央に判定点(◆)を置き、今後2小節分の拍ノーツが左右から判定点へ流れる。
// 位置は Conductor.currentBeat() から算出(rAFで補間描画)。
// 判定ポップは performance.now を「表示フェードの補間」にのみ使う(拍計算には使わない)。

const NotesUI = (() => {
  const WINDOW_BEATS = 8; // 表示する先読み拍数(2小節=8拍)
  const POP_MS = 500;     // 判定ポップの表示時間

  let pop = null; // { verdict, diffMs, born } bornはperformance.now

  function popJudge(verdict, diffMs) {
    pop = { verdict, diffMs, born: performance.now() };
  }

  const COLORS = {
    PERFECT: "#ffd54a",
    GOOD: "#5adf7a",
    MISS: "#ff5a6a",
  };

  // レーンとノーツを描画。cx,cy=判定点の中心、halfW=左右の流れる幅
  function draw(g, viewW, viewH) {
    const cx = viewW / 2;
    const cy = viewH - 96;
    const halfW = Math.min(viewW * 0.42, 640);
    const beatsPerBar = CONFIG.METRONOME.BEATS_PER_BAR;

    // レーン(帯)
    g.save();
    g.fillStyle = "rgba(255,255,255,0.06)";
    g.fillRect(cx - halfW - 30, cy - 30, (halfW + 30) * 2, 60);

    if (Conductor.running) {
      const cur = Conductor.currentBeat();
      const first = Math.ceil(cur - 0.001);
      for (let n = first; n <= cur + WINDOW_BEATS; n++) {
        const p = (n - cur) / WINDOW_BEATS; // 0(判定点)〜1(端)
        if (p < 0 || p > 1) continue;
        const dist = p * halfW;
        const accent = n % beatsPerBar === 0;
        const r = accent ? 15 : 10;
        const alpha = 0.35 + 0.65 * (1 - p);
        g.fillStyle = accent
          ? `rgba(120,190,255,${alpha})`
          : `rgba(220,220,235,${alpha})`;
        // 左右対称に判定点へ向かって流す
        drawNote(g, cx + dist, cy, r);
        drawNote(g, cx - dist, cy, r);
      }
    }

    // 判定点(◆)
    g.fillStyle = "#ffffff";
    g.save();
    g.translate(cx, cy);
    g.rotate(Math.PI / 4);
    const s = 16;
    g.fillRect(-s, -s, s * 2, s * 2);
    g.restore();
    g.strokeStyle = "rgba(255,255,255,0.5)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, 26, 0, Math.PI * 2);
    g.stroke();

    // 判定ポップ
    if (pop) {
      const age = performance.now() - pop.born;
      if (age > POP_MS) {
        pop = null;
      } else {
        const t = age / POP_MS;
        const alpha = 1 - t;
        const rise = 44 + t * 26;
        g.textAlign = "center";
        g.globalAlpha = alpha;
        g.fillStyle = COLORS[pop.verdict] || "#fff";
        g.font = "bold 44px sans-serif";
        g.fillText(pop.verdict, cx, cy - rise);
        // はやい/おそいの添え字(MISS以外で意味がある。二重判定は非表示)
        if (pop.verdict !== "MISS") {
          const early = pop.diffMs < 0;
          g.font = "bold 20px sans-serif";
          g.fillStyle = early ? "#8fd0ff" : "#ffb08f";
          g.fillText(early ? "はやい" : "おそい", cx, cy - rise + 26);
        }
        g.globalAlpha = 1;
      }
    }
    g.restore();
  }

  function drawNote(g, x, y, r) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  return { draw, popJudge };
})();
