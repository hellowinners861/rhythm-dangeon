// notesui.js … ノーツレーン・判定表示
// 画面下部中央に判定点(◆)を置き、今後2小節分の拍ノーツが左右から判定点へ流れる。
// 位置は Conductor.currentBeat() から算出(rAFで補間描画)。
// 判定ポップは performance.now を「表示フェードの補間」にのみ使う(拍計算には使わない)。

const NotesUI = (() => {
  const WINDOW_BEATS = 8; // 表示する先読み拍数(2小節=8拍)
  const POP_MS = 500;     // 判定ポップの表示時間
  const NOTE_SCALE = 2.2; // ノーツ表示倍率(調整値・改修バッチで1.5→2.2)

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
    // ノーツ2.2倍化で帯・判定点が大きくなった分、下部タッチボタンと被らないようやや上へ(改修バッチ)
    const cy = viewH - 150;
    const halfW = Math.min(viewW * 0.42, 640);
    const beatsPerBar = CONFIG.METRONOME.BEATS_PER_BAR;

    // 現在区間の状態(休符=暗く / fever=発光)
    let curRest = false, curFever = false;
    if (Conductor.running) {
      const s0 = Conductor.sectionAt(Conductor.currentBeat());
      curRest = s0.div === 0;
      curFever = !!s0.fever;
    }

    // レーン(帯)。fever区間は発光、休符区間は暗く。
    // 帯の高さはノーツ拡大(NOTE_SCALE 2.2)に合わせて60→100へ拡大(改修バッチ)。
    g.save();
    if (curFever) {
      g.fillStyle = "rgba(255,210,120,0.10)";
      g.fillRect(cx - halfW - 40, cy - 58, (halfW + 40) * 2, 116);
      g.fillStyle = "rgba(255,220,150,0.14)";
    } else if (curRest) {
      g.fillStyle = "rgba(255,255,255,0.02)";
    } else {
      g.fillStyle = "rgba(255,255,255,0.06)";
    }
    g.fillRect(cx - halfW - 30, cy - 50, (halfW + 30) * 2, 100);

    // ノーツ:これから来る「グリッド点」を先読み描画。
    //   整数拍=通常ノーツ / 半拍(8分)=小さめ・薄めのノーツ(div=2区間のみ)。
    //   休符区間(div=0)のグリッド点は描かない(区間端で「休符が来る」と分かる)。
    if (Conductor.running) {
      const cur = Conductor.currentBeat();
      // 半拍単位で走査(n2/2 が拍位置)
      const start2 = Math.ceil((cur + 0.001) * 2);
      const end2 = Math.floor((cur + WINDOW_BEATS) * 2);
      for (let n2 = start2; n2 <= end2; n2++) {
        const beat = n2 / 2;
        const sec = Conductor.sectionAt(beat);
        if (sec.div === 0) continue;              // 休符区間はノーツなし
        const isHalf = (n2 % 2 !== 0);
        if (isHalf && sec.div !== 2) continue;    // 8分点は div=2 区間のみ
        const p = (beat - cur) / WINDOW_BEATS;    // 0(判定点)〜1(端)
        if (p < 0 || p > 1) continue;
        const dist = p * halfW;
        const fade = 1 - p;
        let r, color;
        if (isHalf) {
          // 8分ノーツ:小さめ・薄め
          const alpha = (0.22 + 0.4 * fade) * (sec.fever ? 1.2 : 1);
          r = 6 * NOTE_SCALE;
          color = `rgba(200,210,235,${Math.min(1, alpha)})`;
        } else {
          const accent = Math.round(beat) % beatsPerBar === 0;
          const alpha = 0.35 + 0.65 * fade;
          r = (accent ? 15 : 10) * NOTE_SCALE;
          if (sec.fever) {
            color = `rgba(255,210,120,${alpha})`;
          } else {
            color = accent
              ? `rgba(120,190,255,${alpha})`
              : `rgba(220,220,235,${alpha})`;
          }
        }
        g.fillStyle = color;
        // 左右対称に判定点へ向かって流す
        drawNote(g, cx + dist, cy, r);
        drawNote(g, cx - dist, cy, r);
      }
    }

    // 判定点(◆)。fever区間は金色に発光。ノーツ拡大に合わせて1.5倍程度に(改修バッチ)。
    g.fillStyle = curFever ? "#ffe08a" : "#ffffff";
    g.save();
    g.translate(cx, cy);
    g.rotate(Math.PI / 4);
    const s = 24;
    g.fillRect(-s, -s, s * 2, s * 2);
    g.restore();
    g.strokeStyle = curFever ? "rgba(255,210,120,0.85)" : "rgba(255,255,255,0.5)";
    g.lineWidth = curFever ? 6 : 3;
    g.beginPath();
    g.arc(cx, cy, curFever ? 45 : 39, 0, Math.PI * 2);
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
