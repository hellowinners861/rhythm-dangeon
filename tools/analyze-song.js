// tools/analyze-song.js … 曲のBPM・オフセット・エネルギー構成を解析する(曲追加時にディレクターが使う)
//
// 使い方:
//   1) リポジトリ直下で配信:  python3 -m http.server 8900 &
//   2) 実行:                 NODE_PATH=$(npm root -g) node tools/analyze-song.js songs/song03.mp3 8900
//   3) 出力の見方:
//      - broad.top      … BPM候補(自己相関スコア順)。2:3や1:2の関係の候補が並んだら要注意
//      - refined.cands  … 有力候補とその倍/半のグリッド適合コントラスト(拍上/拍間のオンセット比)。
//                         コントラストが明確に高いものが正解のことが多いが、
//                         【候補が拮抗したら必ずユーザーに正しいBPMを確認する】(song01で110/165を誤った実績)
//      - refined.fine   … 最有力BPM周辺の精密探索(bpm, off=オフセット秒, ratio)
//      - rmsProf        … 4秒ごとの音量RMS。譜面の区間設計(イントロ/サビ/静かな区間)の手がかり
//      - totalBeats     … floor((長さ - offset) / 拍秒)。songs.js には bpm/offset を書けば実行時に再計算される
//
// 譜面設計の指針は .claude/skills/director/SKILL.md §4 を参照。
// 実行には Playwright(グローバルインストール済み)と /opt/pw-browsers/chromium を使う。

const { chromium } = require('playwright');

const file = process.argv[2];
const port = process.argv[3] || '8900';
const centerBpm = process.argv[4] ? Number(process.argv[4]) : null; // 省略時はbroadの1位を使う
if (!file) {
  console.error('使い方: node tools/analyze-song.js <songs/xxx.mp3> [port] [精密探索の中心BPM]');
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${port}/`);
  const result = await page.evaluate(async ({ file, centerBpm }) => {
    const res = await fetch('/' + file);
    const buf = await res.arrayBuffer();
    const ac = new OfflineAudioContext(1, 44100, 44100);
    const audio = await ac.decodeAudioData(buf);
    const sr = audio.sampleRate;
    const ch = audio.getChannelData(0);
    const dur = audio.duration;

    // --- オンセット包絡(hop 512 ≒ 11.6ms のエネルギー正差分) ---
    const hop = 512;
    const nF = Math.floor(ch.length / hop) - 1;
    const env = new Float32Array(nF);
    let prev = 0;
    for (let i = 0; i < nF; i++) {
      let e = 0;
      for (let j = i * hop; j < (i + 1) * hop; j++) e += ch[j] * ch[j];
      e = Math.sqrt(e / hop);
      env[i] = Math.max(0, e - prev);
      prev = e;
    }
    const hopSec = hop / sr;
    const at = (t) => {
      const i = Math.round(t / hopSec);
      return i >= 0 && i < nF ? env[i] + (env[i - 1] || 0) + (env[i + 1] || 0) : 0;
    };

    // --- 広域スキャン: 自己相関で60〜200bpm ---
    const scores = [];
    for (let bpm = 60; bpm <= 200; bpm += 0.5) {
      const lag = Math.round((60 / bpm) / hopSec);
      let s = 0, n = 0;
      for (let i = 0; i + lag < nF; i++) { s += env[i] * env[i + lag]; n++; }
      scores.push({ bpm, score: s / n });
    }
    scores.sort((a, b) => b.score - a.score);
    const broadTop = scores.slice(0, 6).map((c) => c.bpm);

    // --- 位相(オフセット)推定とグリッド適合コントラスト ---
    function bestPhase(bpm, t0, t1) {
      const bs = 60 / bpm;
      let bo = 0, bsum = -1;
      for (let k = 0; k < 300; k++) {
        const off = (k / 300) * bs;
        let s = 0;
        for (let t = t0 + off; t < t1; t += bs) s += at(t);
        if (s > bsum) { bsum = s; bo = off; }
      }
      return bo;
    }
    // ratio: 拍上/拍間のオンセット比(格子の「きれいさ」)
    // cover: 拍上オンセットの平均量(格子が実際の打点をどれだけ拾えているか)
    // 【重要】2/3倍のBPM(例: 135に対する90)は「拍間が無音地帯に落ちる」ためratioが偽勝ちする。
    //         正解判定は cover を主、ratio を従とする(coverは正しい格子が全打点を拾うので最大になる)。
    function gridStats(bpm, off) {
      const bs = 60 / bpm;
      let on = 0, offE = 0, n = 0;
      for (let t = off; t < dur - 0.1; t += bs) { on += at(t); offE += at(t + bs / 2); n++; }
      return { ratio: on / Math.max(1e-9, offE), cover: on / n };
    }
    // 候補BPMの周辺±0.6を精密探索(位相ドリフトで過小評価されるのを防ぐ)
    function refineAround(bpm0) {
      let best = null;
      for (let bpm = bpm0 - 0.6; bpm <= bpm0 + 0.6; bpm += 0.02) {
        const off = bestPhase(bpm, 0, Math.min(dur, 60));
        const s = gridStats(bpm, off);
        if (!best || s.cover > best.cover) best = { bpm: +bpm.toFixed(2), off: +off.toFixed(4), ratio: +s.ratio.toFixed(3), cover: +s.cover.toFixed(4) };
      }
      return best;
    }

    const base = centerBpm || broadTop[0];
    // 有力候補とその倍・半・3/2系列を比較(2:3・1:2の取り違え対策)。各候補を精密化してから比較する
    const rel = [0.5, 2 / 3, 1, 1.5, 2].map((r) => base * r).filter((b) => b >= 55 && b <= 220);
    const cands = rel.map((bpm0) => refineAround(bpm0));

    // 推奨: ratioが1.15以上ある候補のうち cover 最大
    const ok = cands.filter((c) => c.ratio >= 1.15);
    const pool = ok.length ? ok : cands;
    const fine = pool.reduce((a, b) => (b.cover > a.cover + 1e-6 ? b : a));
    // 【曖昧判定】上位2候補のcoverが10%以内なら自動判定は信用できない。
    // song01(アダチレイ・アダチレイ)はこの状態で、正解165に対し82/110系を誤選択した実績がある。
    // ambiguous=true のときは必ずユーザーに正しいBPMを確認すること。
    const sorted = [...pool].sort((a, b) => b.cover - a.cover);
    const ambiguous = sorted.length >= 2 && sorted[1].cover > sorted[0].cover * 0.9;

    // --- RMSプロファイル(4秒ごと)= 区間設計の手がかり ---
    const seg = 4;
    const rmsProf = [];
    for (let t = 0; t < dur; t += seg) {
      let e = 0, n = 0;
      const s0 = Math.floor(t * sr), s1 = Math.min(ch.length, Math.floor((t + seg) * sr));
      for (let j = s0; j < s1; j += 8) { e += ch[j] * ch[j]; n++; }
      rmsProf.push(+Math.sqrt(e / n).toFixed(4));
    }

    const beatSec = 60 / fine.bpm;
    const totalBeats = Math.floor((dur - fine.off) / beatSec);
    return {
      file, durationSec: +dur.toFixed(2),
      broad: { top: broadTop },
      refined: { cands, fine, ambiguous },
      totalBeats,
      rmsProf,
      hint: (ambiguous ? '【要注意】候補が拮抗。必ずユーザーに正しいBPMを確認すること / ' : '') +
        '拍→秒: t = off + beat*' + beatSec.toFixed(4) + ' / RMSの山=サビ候補(fever)、谷=休符候補',
    };
  }, { file, centerBpm });
  console.log(JSON.stringify(result, null, 1));
  await browser.close();
})();
