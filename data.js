// USJまわり方プランナー: アトラクション・混雑カーブのマスタデータ
//
// 注意: ここに含まれる待ち時間・混雑カーブは公開情報や一般的な傾向をもとにした
// 「目安」であり、公式の実測データではありません。実績記録機能で補正してください。

// エリアはメインエントランスから見て概ね反時計回りの並び順(移動時間の概算に使用)
const AREAS = [
  "ハリウッド・エリア",
  "ニューヨーク・エリア",
  "サンフランシスコ・エリア",
  "ジュラシック・パーク",
  "ウォーターワールド",
  "アミティ・ビレッジ",
  "ミニオン・パーク",
  "スーパー・ニンテンドー・ワールド",
  "ウィザーディング・ワールド・オブ・ハリー・ポッター",
  "ユニバーサル・ワンダーランド",
];

// 時間帯(9時〜21時、1時間刻み13点)ごとの混雑倍率カーブ。人気度ティア別の基本形。
const CURVES = {
  tier5: [0.5, 0.75, 0.95, 1.0, 1.0, 0.95, 0.9, 0.85, 0.8, 0.7, 0.55, 0.4, 0.3],
  // フライング・ダイナソーのように、午前〜昼に混みやすく夕方以降に大きく空く傾向のカーブ
  tier5_evening_dip: [0.55, 0.8, 1.0, 1.05, 1.0, 0.9, 0.8, 0.65, 0.5, 0.4, 0.3, 0.25, 0.2],
  tier4: [0.4, 0.65, 0.85, 0.95, 0.95, 0.9, 0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25],
  tier3: [0.3, 0.55, 0.75, 0.85, 0.85, 0.8, 0.75, 0.65, 0.55, 0.45, 0.35, 0.3, 0.2],
  tier2: [0.25, 0.4, 0.55, 0.6, 0.6, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.2],
  tier1: [0.2, 0.3, 0.4, 0.45, 0.45, 0.45, 0.4, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15],
};

// ティア別の「ピーク時」想定待ち時間(分)
const PEAK_MINUTES = { tier5: 95, tier4: 65, tier3: 40, tier2: 20, tier1: 10 };

// 混雑区分(平日/土日/繁忙期など)ごとの全体倍率
const DAY_TYPE_MULTIPLIER = {
  weekday: 0.8,
  weekend: 1.1,
  holiday: 1.15,
  peak: 1.3,
  event: 1.25,
};

const ATTRACTIONS = [
  {
    id: "flying_dinosaur",
    name: "フライング・ダイナソー",
    area: 3,
    tier: "tier5",
    curve: "tier5_evening_dip",
    duration: 2,
    note: "午前〜昼が混みやすく、夕方以降は比較的空く傾向。整理券(バーチャル・パス)対象になる場合あり、公式アプリを確認。",
  },
  {
    id: "hollywood_dream",
    name: "ハリウッド・ドリーム・ザ・ライド",
    area: 0,
    tier: "tier4",
    duration: 2,
    note: "",
  },
  {
    id: "hollywood_dream_backdrop",
    name: "ハリウッド・ドリーム・ザ・ライド ~バックドロップ~",
    area: 0,
    tier: "tier3",
    duration: 2,
    note: "夜間のみ運行の場合あり。",
  },
  {
    id: "space_fantasy",
    name: "スペース・ファンタジー・ザ・ライド",
    area: 1,
    tier: "tier3",
    duration: 3,
    note: "",
  },
  {
    id: "jurassic_park_ride",
    name: "ジュラシック・パーク・ザ・ライド",
    area: 3,
    tier: "tier3",
    duration: 5,
    note: "",
  },
  {
    id: "jaws",
    name: "ジョーズ",
    area: 5,
    tier: "tier3",
    duration: 5,
    note: "",
  },
  {
    id: "backdraft",
    name: "バックドラフト",
    area: 2,
    tier: "tier2",
    duration: 5,
    note: "",
  },
  {
    id: "minion_ride",
    name: "ミニオン・ハチャメチャ・ライド",
    area: 6,
    tier: "tier5",
    duration: 4,
    note: "混雑日はミニオン・パークへのエリア入場整理券が必要な場合あり、公式アプリを確認。",
  },
  {
    id: "harry_potter_forbidden_journey",
    name: "ハリー・ポッター・アンド・ザ・フォービドゥン・ジャーニー",
    area: 8,
    tier: "tier5",
    duration: 4,
    note: "混雑日はウィザーディング・ワールドへのエリア入場整理券が必要な場合あり、公式アプリを確認。",
  },
  {
    id: "hippogriff",
    name: "フライト・オブ・ザ・ヒッポグリフ",
    area: 8,
    tier: "tier4",
    duration: 1,
    note: "",
  },
  {
    id: "yoshi_adventure",
    name: "ヨッシー・アドベンチャー",
    area: 7,
    tier: "tier5",
    duration: 5,
    note: "混雑日はスーパー・ニンテンドー・ワールドへの整理券が必要な場合あり、公式アプリを確認。",
  },
  {
    id: "mario_kart",
    name: "マリオカート ~クッパの挑戦状~",
    area: 7,
    tier: "tier5",
    duration: 5,
    note: "混雑日はスーパー・ニンテンドー・ワールドへの整理券が必要な場合あり、公式アプリを確認。",
  },
  {
    id: "sesame_4d",
    name: "セサミストリート・4-Dムービーマジック",
    area: 9,
    tier: "tier1",
    duration: 15,
    note: "上映形式のためシアター入替のタイミングで待ち時間が変動。",
  },
  {
    id: "elmo_bubble",
    name: "エルモのバブル・バブル",
    area: 9,
    tier: "tier2",
    duration: 2,
    note: "小さい子ども向け。",
  },
  {
    id: "hello_kitty_cupcake",
    name: "ハローキティのカップケーキ・ドリーム",
    area: 9,
    tier: "tier1",
    duration: 2,
    note: "小さい子ども向け。",
  },
];
