// sfx.js … WebAudio効果音(オシレータ合成、音源ファイル不使用)
// 【重要】AudioContextはこのモジュールで1つだけ生成し、全モジュールで SFX.ctx を共有する。
// 拍・タイミングの唯一の時計は SFX.ctx.currentTime。

const SFX = (() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();

  // 2系統のマスター音量(BGM / SE)。Step1ではSEのみ使用。
  const bgmGain = ctx.createGain();
  const seGain = ctx.createGain();
  bgmGain.gain.value = 0.8;
  seGain.gain.value = 0.8;
  bgmGain.connect(ctx.destination);
  seGain.connect(ctx.destination);

  // MISS音用のホワイトノイズバッファ(遅延生成)
  let noiseBuf = null;
  function getNoise() {
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(ctx.sampleRate * 0.2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // ユーザータップから呼ぶ resume(iOS Safari対策)
  function resume() {
    return ctx.resume();
  }

  // AudioContextの一時停止(タブ離脱時に音を止める)。ctx.suspend の薄いラッパ。
  function suspend() {
    return ctx.suspend();
  }

  // デコード済みAudioBufferの先頭 sec 秒を切り落とした新しいバッファを返す(song03の冒頭カット用)。
  // ffmpeg等が使えない環境でも「毎回◯秒目から再生」を全経路(ステージ/曲視聴/ホームBGM/ポーズ再開)で
  // 一貫させるため、再生位置ではなくバッファ自体を短くする。sec<=0 ならそのまま返す。
  function trimBuffer(buffer, sec) {
    if (!sec || sec <= 0) return buffer;
    const sr = buffer.sampleRate;
    const startFrame = Math.min(buffer.length - 1, Math.round(sec * sr));
    const len = Math.max(1, buffer.length - startFrame);
    const out = ctx.createBuffer(buffer.numberOfChannels, len, sr);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      out.copyToChannel(buffer.getChannelData(c).subarray(startFrame), c, 0);
    }
    return out;
  }

  // メトロノーム音。必ず atTime(AudioContext絶対時刻)を指定して予約再生する。
  // accent(小節頭)は高い音。
  function click(atTime, accent) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = accent ? 1760 : 1040;
    const peak = accent ? 0.5 : 0.32;
    g.gain.setValueAtTime(0.0001, atTime);
    g.gain.exponentialRampToValueAtTime(peak, atTime + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.05);
    o.connect(g).connect(seGain);
    o.start(atTime);
    o.stop(atTime + 0.06);
  }

  // 単音を即時に鳴らすヘルパー
  function tone(freq, dur, peak, type) {
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || "triangle";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g).connect(seGain);
    o.start(now);
    o.stop(now + dur + 0.02);
  }

  // 判定音。PERFECT=明るい和音短音 / GOOD=単音 / MISS=低いノイズ風。即時再生。
  function judge(verdict) {
    if (verdict === "PERFECT") {
      // 明るい和音(ルート+長3度+5度)
      tone(880, 0.16, 0.3, "triangle");
      tone(1108.7, 0.16, 0.22, "triangle");
      tone(1318.5, 0.16, 0.22, "triangle");
    } else if (verdict === "GOOD") {
      tone(660, 0.14, 0.28, "triangle");
    } else {
      // MISS: 低いノイズ + 低音のうなり
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = getNoise();
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 700;
      g.gain.setValueAtTime(0.35, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      src.connect(lp).connect(g).connect(seGain);
      src.start(now);
      src.stop(now + 0.2);
      tone(150, 0.18, 0.25, "square");
    }
  }

  // コイン回収音の1音ぶんを鳴らすヘルパー(coin()内でアルペジオを組むのに使う)
  function coinNote(startOffset, freq, dur, peak) {
    const st = ctx.currentTime + startOffset;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(peak, st + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
    o.connect(g).connect(seGain);
    o.start(st);
    o.stop(st + dur + 0.02);
  }

  // コイン回収音。判定音(judge)とは別の軽い上昇音。額面(value)が大きいほど豪華にする(改修バッチ)。
  //   引数なし or 1 … 従来の軽い上昇音(後方互換)
  //   3  … 2音
  //   10 … 3音アルペジオ
  //   50 … 4音アルペジオ+キラン(高音のきらめき)
  function coin(value) {
    const now = ctx.currentTime;
    if (value === undefined || value <= 1) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(1320, now);
      o.frequency.exponentialRampToValueAtTime(1980, now + 0.07);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.2, now + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
      o.connect(g).connect(seGain);
      o.start(now);
      o.stop(now + 0.13);
    } else if (value <= 3) {
      coinNote(0,     1320, 0.11, 0.2);
      coinNote(0.045, 1760, 0.13, 0.2);
    } else if (value <= 10) {
      coinNote(0,    880,    0.12, 0.22);
      coinNote(0.05, 1108.7, 0.12, 0.22);
      coinNote(0.1,  1318.5, 0.14, 0.22);
    } else {
      coinNote(0,     880,    0.12, 0.24);
      coinNote(0.045, 1108.7, 0.12, 0.24);
      coinNote(0.09,  1318.5, 0.12, 0.24);
      coinNote(0.135, 1760,   0.14, 0.24);
      // キラン(高音のきらめき)
      const sp = ctx.createOscillator();
      const sg = ctx.createGain();
      sp.type = "sine";
      sp.frequency.setValueAtTime(2640, now + 0.18);
      sp.frequency.exponentialRampToValueAtTime(3520, now + 0.32);
      sg.gain.setValueAtTime(0.0001, now + 0.18);
      sg.gain.exponentialRampToValueAtTime(0.22, now + 0.19);
      sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
      sp.connect(sg).connect(seGain);
      sp.start(now + 0.18);
      sp.stop(now + 0.36);
    }
  }

  // ジャンプ音。短い上昇スイープ(判定成立時のみ呼ばれる。player.js)
  // high=true で空中ジャンプ(2段ジャンプ)用に少し高いピッチにする(改修バッチ・Step9)
  function jump(high) {
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(high ? 660 : 440, now);
    o.frequency.exponentialRampToValueAtTime(high ? 1320 : 880, now + 0.12);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.28, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    o.connect(g).connect(seGain);
    o.start(now);
    o.stop(now + 0.16);
  }

  // ダッシュ音(移動)。短いノイズ系のシュッ(判定成立時のみ呼ばれる。player.js)
  function dash() {
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    src.connect(hp).connect(g).connect(seGain);
    src.start(now);
    src.stop(now + 0.09);
  }

  // アイテム取得音(コインとは別の音色。二音の上昇チャイム)
  function pickup() {
    const now = ctx.currentTime;
    const notes = [{ f: 988, t: 0 }, { f: 1480, t: 0.07 }];
    for (const n of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = n.f;
      const st = now + n.t;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.26, st + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.14);
      o.connect(g).connect(seGain);
      o.start(st);
      o.stop(st + 0.16);
    }
  }

  // 被弾音。低い衝撃音(サブベース+ローパスノイズ)
  function hurt() {
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(180, now);
    o.frequency.exponentialRampToValueAtTime(60, now + 0.16);
    g.gain.setValueAtTime(0.3, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    o.connect(g).connect(seGain);
    o.start(now);
    o.stop(now + 0.22);
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.25, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    src.connect(lp).connect(ng).connect(seGain);
    src.start(now);
    src.stop(now + 0.16);
  }

  // 敵撃破音。ポップな破裂音(短い上昇矩形波)
  function enemyDie() {
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(180, now);
    o.frequency.exponentialRampToValueAtTime(720, now + 0.08);
    g.gain.setValueAtTime(0.26, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    o.connect(g).connect(seGain);
    o.start(now);
    o.stop(now + 0.12);
  }

  // ボス予兆音。不穏な短い不協和音(半音違いの2音を重ねる)
  function telegraph() {
    const now = ctx.currentTime;
    const freqs = [220, 233.08];
    for (const f of freqs) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sawtooth";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      o.connect(g).connect(seGain);
      o.start(now);
      o.stop(now + 0.16);
    }
  }

  // ボス撃破音。長めの下降+爆発ノイズ
  function bossDie() {
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(600, now);
    o.frequency.exponentialRampToValueAtTime(40, now + 0.9);
    g.gain.setValueAtTime(0.32, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
    o.connect(g).connect(seGain);
    o.start(now);
    o.stop(now + 1.05);
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2000, now);
    lp.frequency.exponentialRampToValueAtTime(200, now + 0.9);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.3, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    src.connect(lp).connect(ng).connect(seGain);
    src.start(now);
    src.stop(now + 0.95);
  }

  // フィーバー突入音。上昇アルペジオ(4音)
  function fever() {
    const now = ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99, 1046.5]; // C5,E5,G5,C6
    freqs.forEach((f, i) => {
      const st = now + i * 0.06;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.28, st + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.16);
      o.connect(g).connect(seGain);
      o.start(st);
      o.stop(st + 0.18);
    });
  }

  // メニュー用の単音ヘルパ(startOffset秒後にfreqを鳴らす)。ui()の各kindで使い回す。
  function uiTone(startOffset, freq, dur, peak, type) {
    const st = ctx.currentTime + startOffset;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(peak, st + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
    o.connect(g).connect(seGain);
    o.start(st);
    o.stop(st + dur + 0.02);
  }

  // メニュータップ音(judge/coinとは別音色)。kindでボタンの種類ごとに音色を変える(改修バッチ・Step9)。
  // 引数なし("select"扱い)は既存の軽いクリックのまま(後方互換)。
  //   "select"  … 項目選択(キャラ・装備・曲・タブ切替)
  //   "confirm" … 決定(モード選択・装備決定・購入確認OKなど)
  //   "back"    … 戻る/閉じる
  //   "launch"  … 「いざ!」専用ファンファーレ
  //   "buy"     … ショップ購入成立
  //   "error"   … 購入失敗・ロック項目タップ
  function ui(kind) {
    const now = ctx.currentTime;
    if (kind === "confirm") {
      // 明るい2音(決定)
      uiTone(0, 740, 0.09, 0.22, "triangle");
      uiTone(0.05, 1108.7, 0.12, 0.24, "triangle");
    } else if (kind === "back") {
      // 下降音(戻る/閉じる)
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(640, now);
      o.frequency.exponentialRampToValueAtTime(320, now + 0.1);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.2, now + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      o.connect(g).connect(seGain);
      o.start(now);
      o.stop(now + 0.14);
    } else if (kind === "launch") {
      // 短いファンファーレ(3音上昇)
      uiTone(0,    523.25, 0.1,  0.22, "triangle");
      uiTone(0.08, 659.25, 0.1,  0.24, "triangle");
      uiTone(0.16, 987.77, 0.22, 0.28, "triangle");
    } else if (kind === "buy") {
      // レジ風チャリン(coin()とは別音色。2音の金属的なベル)
      uiTone(0,    1760, 0.16, 0.22, "square");
      uiTone(0.03, 2637, 0.2,  0.18, "square");
    } else if (kind === "error") {
      // ブブー(短い低音2連)
      uiTone(0,    150, 0.09, 0.24, "sawtooth");
      uiTone(0.11, 150, 0.09, 0.24, "sawtooth");
    } else {
      // "select" / 引数なし(既存の軽いクリック。後方互換)
      uiTone(0, 720, 0.07, 0.18, "sine");
    }
  }

  // 音量設定(0..1)。bgm/se いずれか未指定なら据え置き。
  function setVolume(bgm, se) {
    if (typeof bgm === "number") bgmGain.gain.value = bgm;
    if (typeof se === "number") seGain.gain.value = se;
  }

  // AudioBuffer(楽曲)を bgmGain 経由で予約再生する。戻り値は停止用の source。
  // atTime は AudioContext 絶対時刻(拍と同じ時計)。opts.loop でループ再生。
  // opts.loopStart / loopEnd(秒)指定時はその区間で周回する
  // (譜面ループ chartBeat = beat % totalBeats と音声の周期を一致させるため)。
  // opts.gain(0..1)指定時は bgmGain の手前に個別GainNodeを挟んで音量を絞る(ホームBGM等・仮組み)。
  // opts.startOffset(秒)指定時はバッファのその位置から再生を始める(ポーズからの途中再開用)。
  function playBuffer(buffer, atTime, opts) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !!(opts && opts.loop);
    if (src.loop && opts && typeof opts.loopEnd === "number") {
      src.loopStart = opts.loopStart || 0;
      src.loopEnd = opts.loopEnd;
    }
    if (opts && typeof opts.gain === "number") {
      const g = ctx.createGain();
      g.gain.value = opts.gain;
      src.connect(g).connect(bgmGain);
    } else {
      src.connect(bgmGain);
    }
    const st = atTime || ctx.currentTime;
    if (opts && typeof opts.startOffset === "number") src.start(st, opts.startOffset);
    else src.start(st);
    return src;
  }

  return {
    ctx, resume, suspend, trimBuffer, click, judge, coin, setVolume, playBuffer, bgmGain, seGain,
    jump, dash, pickup, hurt, enemyDie, telegraph, bossDie, fever, ui,
  };
})();
