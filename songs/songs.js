// songs/songs.js … 曲リスト+譜面(区間ベース)。譜面は設計者が曲解析に基づいて作成する。
// div: 1=4分(毎拍) / 2=8分(半拍も行動可) / 0=休符(行動不可・敵停止)
// fever: 演出強化区間(背景・レーンが派手になる。コンボフィーバーとは独立)
const SONGS = [
  {
    id: "song01",
    title: "Song 01(仮)",        // 曲名判明後に差し替え
    audio: "songs/song01.mp3",
    bpm: 110,
    offset: 0.24,                 // 最初の1拍目までの秒数(実測)
    durationSec: 143.99,          // 参考値(実際はデコード結果を使う)
    bpmChanges: [],
    chart: [
      { from: 0,   to: 16,  div: 1, mood: "intro"  },
      { from: 16,  to: 48,  div: 1, mood: "verse"  },
      { from: 48,  to: 96,  div: 2, mood: "chorus", fever: true },
      { from: 96,  to: 124, div: 1, mood: "verse"  },
      { from: 124, to: 144, div: 2, mood: "build"  },
      { from: 144, to: 192, div: 2, mood: "chorus", fever: true },
      { from: 192, to: 200, div: 0, mood: "break"  },
      { from: 200, to: 204, div: 1, mood: "build"  },
      { from: 204, to: 248, div: 2, mood: "chorus", fever: true },
      { from: 248, to: 263, div: 1, mood: "outro"  },
    ],
  },
];
