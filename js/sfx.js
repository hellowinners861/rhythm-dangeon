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

  // 音量設定(0..1)。bgm/se いずれか未指定なら据え置き。
  function setVolume(bgm, se) {
    if (typeof bgm === "number") bgmGain.gain.value = bgm;
    if (typeof se === "number") seGain.gain.value = se;
  }

  // AudioBuffer(楽曲)を bgmGain 経由で予約再生する。戻り値は停止用の source。
  // atTime は AudioContext 絶対時刻(拍と同じ時計)。opts.loop でループ再生。
  // opts.loopStart / loopEnd(秒)指定時はその区間で周回する
  // (譜面ループ chartBeat = beat % totalBeats と音声の周期を一致させるため)。
  function playBuffer(buffer, atTime, opts) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !!(opts && opts.loop);
    if (src.loop && opts && typeof opts.loopEnd === "number") {
      src.loopStart = opts.loopStart || 0;
      src.loopEnd = opts.loopEnd;
    }
    src.connect(bgmGain);
    src.start(atTime || ctx.currentTime);
    return src;
  }

  return { ctx, resume, click, judge, setVolume, playBuffer, bgmGain, seGain };
})();
