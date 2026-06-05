/* =====================================================================
   冷やしたぬきそば タイムアタック（新仕様・クリーン実装）
   - 論理解像度 180×320 に1回描いて、表示用canvasへ nearest-neighbor で一括拡大
   - 実バッファは ×devicePixelRatio / imageSmoothingEnabled=false / CSS image-rendering:pixelated
   - スプライトは原則 元ピクセル等倍（整数倍）。背景のみアスペクト調整のため cover-fit
   - HTML+CSS+JS（Canvas API）のみ。外部ライブラリ不使用。index.html を開くだけで動く
   - 画像は /assets から固定ファイル名で読み込み、未配置なら仮グラフィックで動く
   ===================================================================== */

'use strict';

/* =====================================================================
   調整用 CONFIG（バランスはここで変える）
   ===================================================================== */
const CONFIG = {
  // 論理解像度
  W: 180,
  H: 320,

  GAME_TIME: 60,             // 制限時間（秒）
  COMPLETE_HOLD: 0.35,       // 1杯完成の演出硬直（短いほど連投テンポUP。旧0.7）

  // フリック投げ物理（座標=論理px、速度=px/秒）
  // 具材を狙う方向へ素早くスワイプ → スワイプ速度＝発射の勢い。引いて溜める動作はナシ。
  GRAVITY: 2200,             // 重力（大きいほど速く落ちて爽快。空中時間≈0.5s）
  FLICK_POWER: 1.4,          // スワイプ速度 → 発射速度 の倍率
  LAUNCH_MIN: 1000,          // 発射速度の下限（弱フリックでも中央へ届く）
  LAUNCH_MAX: 1050,          // 発射速度の上限（範囲を狭めて飛行時間をほぼ一定に＝強く投げても遅くならない／飛び抜けない）
  MIN_FLICK_SPEED: 130,      // これ未満のスワイプ速度なら発射しない（タップ誤爆防止）
  FLICK_WINDOW: 0.09,        // フリック速度を測る直近時間窓（秒）
  GRAB_RADIUS: 22,           // 具材が指に追従する半径（持ち運び防止）
  AIM_DEADZONE: 6,           // アンカーからこの距離未満は方向不定（ガイド非表示・真上扱い）

  // 手元（アンカー）と丼
  ANCHOR_X: 90,
  ANCHOR_Y: 278,             // 手元を画面下寄りに（親指から自然に上へ放れる）
  BOWL_X: 90,
  BOWL_Y: 92,                // 丼の中心Y（上方）
  BOWL_SIZE: 96,             // 丼の表示サイズ（96px ≒ 画面横の53%）
  MOUTH_DY: -6,              // 丼中心→受け口ライン（イン判定の高さ）

  // 当たり判定：受け口の当たり幅は「丼の現在の見た目幅 × 比率」。
  // 丼に対して常に同じ寛容さ＝丼が小さくなっても“サクサク入る”手応えは保つ。
  CATCH_RATIO: 0.74,

  // 予測軌道ガイド
  TRAJECTORY_STEPS: 40,
  TRAJECTORY_DT: 1 / 60,

  // 動的難度：当たり幅は狭めず、丼を「だんだん小さく」「だんだん速く動かす」ことで難化させる
  DYNAMIC_DIFFICULTY: true,
  // ① 丼が小さくなる（小さい的＝難しい。当たり幅は比率で一緒に縮むので理不尽にはならない）
  BOWL_SHRINK_START: 1,         // 早めに開始（中位層も難化を体感）
  BOWL_SHRINK_PER_BOWL: 0.04,   // 1杯ごとの縮小は控えめに（なだらか化）
  BOWL_SCALE_MIN: 0.55,         // 縮小の下限
  // ② 丼が左右に動く（始動の杯数・振れ幅）
  DRIFT_START_BOWL: 2,          // 早めに開始
  DRIFT_AMP_PER_BOWL: 4,        // 振れ幅の増分は控えめに（なだらか化）
  DRIFT_AMP_MAX: 28,         // 終盤の横移動量を抑制（飛行中に丼が逃げすぎて運ゲー化するのを防ぐ）
  // ③ 往復がだんだん速くなる（sin の角速度）
  DRIFT_SPEED_BASE: 1.0,
  DRIFT_SPEED_PER_BOWL: 0.06,   // 速度の増分も控えめに（壁を緩和）
  DRIFT_SPEED_MAX: 2.4,      // 上げすぎると着弾までに丼が逃げて理不尽になるため上限を抑える

  // 食材サイズ（元ピクセル等倍）
  FOOD_SIZE: 64,
  WASABI_SIZE: 48,
  FLY_MIN_SCALE: 0.5,        // 飛行中、丼に近づくほど縮小（奥行き感）。1=縮小なし
};

// 盛り付け順: そば→つゆ→ねぎ→わさび→あげ→天かす（成功ごとに bowl_1..5 → bowl_done と段送り）
const INGREDIENTS = [
  { key: 'soba',    name: 'そば',   img: 'soba.png',    color: '#d8b878', edge: '#9c7b3e', size: CONFIG.FOOD_SIZE },
  { key: 'tsuyu',   name: 'つゆ',   img: 'tsuyu.png',   color: '#6b502e', edge: '#3a2a14', size: CONFIG.FOOD_SIZE },
  { key: 'negi',    name: 'ねぎ',   img: 'negi.png',    color: '#7ac84e', edge: '#3f8a26', size: CONFIG.FOOD_SIZE },
  { key: 'wasabi',  name: 'わさび', img: 'wasabi.png',  color: '#46a13a', edge: '#256b1d', size: CONFIG.WASABI_SIZE },
  { key: 'age',     name: 'あげ',   img: 'age.png',     color: '#e0a23e', edge: '#a66a18', size: CONFIG.FOOD_SIZE },
  { key: 'tenkasu', name: '天かす', img: 'tenkasu.png', color: '#f0d27a', edge: '#bb9433', size: CONFIG.FOOD_SIZE },
];

const HISCORE_KEY = 'hiyashi_tanuki_hiscore';
const MUTED_KEY = 'hiyashi_tanuki_muted';
const RANKING_NAME_KEY = 'hiyashi_tanuki_name';

/* =====================================================================
   ユーティリティ
   ===================================================================== */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const ri = Math.round;
// localStorage は環境により例外を投げる（Safariプライベート等）。失敗してもゲームは動かす。
function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

// GTM/GA4 計測：dataLayer にイベントを安全に push（GTM未読込でも壊さない）
function track(event, params) {
  try { (window.dataLayer = window.dataLayer || []).push(Object.assign({ event: event }, params || {})); } catch (_) {}
}

const IN_FLASH_DUR = 0.25;   // 受け口の成功フラッシュの初期寿命（onIn と drawInFlash で共有）
const TOAST_LIFE = 0.9;      // 浮遊テキスト（トースト）の寿命
// 受け口ライン（イン判定の高さ）。丼の縮小に追従。当たり判定と描画で同一式を共有する。
function mouthAt(b) { return b.y + CONFIG.MOUTH_DY * b.scale; }

/* =====================================================================
   描画パイプライン（180×320 バッファ → 表示canvasへ拡大）
   ===================================================================== */
const W = CONFIG.W;
const H = CONFIG.H;

const view = document.getElementById('view');
const vctx = view.getContext('2d');
const stage = document.getElementById('stage');

// オフスクリーン論理バッファ
const buf = document.createElement('canvas');
buf.width = W;
buf.height = H;
const g = buf.getContext('2d');

function resize() {
  // モバイルのURLバー等を除いた『実際に見えている領域』(visualViewport)に #stage を合わせる。
  // これをしないと Canvas がブラウザUIの裏へはみ出し、上下（HUD・手元）が見切れる。
  const vv = window.visualViewport;
  if (vv && stage) {
    stage.style.left = vv.offsetLeft + 'px';
    stage.style.top = vv.offsetTop + 'px';
    stage.style.right = 'auto';
    stage.style.bottom = 'auto';
    stage.style.width = vv.width + 'px';
    stage.style.height = vv.height + 'px';
  }
  // safe-area padding（ノッチ/ホームインジケータ）を差し引いた実可用領域
  let availW = window.innerWidth, availH = window.innerHeight;
  if (stage) {
    const cs = getComputedStyle(stage);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    availW = Math.max(1, stage.clientWidth - padX);
    availH = Math.max(1, stage.clientHeight - padY);
  }
  const scale = Math.min(availW / W, availH / H);
  // 縦横比を厳密に W:H へ固定（軸ごとに floor すると微小に歪み、拡大と入力写像がズレるため）
  const cssW = Math.max(1, Math.floor(W * scale));
  const cssH = Math.max(1, Math.round(cssW * H / W));
  const dpr = window.devicePixelRatio || 1;
  const nextW = Math.round(cssW * dpr);   // 実バッファは ×dpr
  const nextH = Math.round(cssH * dpr);
  // CSS表示サイズは変わった時だけ更新
  if (view.style.width !== cssW + 'px') view.style.width = cssW + 'px';
  if (view.style.height !== cssH + 'px') view.style.height = cssH + 'px';
  // 実バッファは実寸が変わった時だけ再代入する。毎回代入するとcanvasがクリアされ、
  // resize連打（キーボード復帰用の遅延resize等）でiOSが2〜3回点滅するため冪等化。
  if (view.width !== nextW || view.height !== nextH) {
    view.width = nextW;
    view.height = nextH;
    vctx.imageSmoothingEnabled = false;
    try { present(); } catch (_) {} // クリア直後の黒フレームを直近bufで即埋める
  }
}

// iOS Safari は回転直後に visualViewport の値が遅れて確定することがあるため、複数タイミングで再適用
function scheduleResize() {
  resize();
  requestAnimationFrame(resize);
  setTimeout(resize, 120);
  setTimeout(resize, 320);
}
// iOSのソフトキーボード収納はアニメーションで遅れるため、収納後に複数回resizeしてcanvasサイズを確実に復帰させる
function scheduleResizeAfterKeyboard() {
  scheduleResize();
  setTimeout(scheduleResize, 500);
  setTimeout(scheduleResize, 900);
  setTimeout(scheduleResize, 1400);
}
window.addEventListener('resize', scheduleResize);
window.addEventListener('orientationchange', scheduleResize);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', scheduleResize);
  window.visualViewport.addEventListener('scroll', resize);
}
resize();

// 論理バッファを表示canvasへ nearest-neighbor で一括拡大
function present() {
  vctx.imageSmoothingEnabled = false;
  vctx.clearRect(0, 0, view.width, view.height);
  vctx.drawImage(buf, 0, 0, W, H, 0, 0, view.width, view.height);
}

// クライアント座標 → 論理座標(0..180, 0..320)
function toLogical(clientX, clientY) {
  const r = view.getBoundingClientRect();
  return {
    x: (clientX - r.left) / r.width * W,
    y: (clientY - r.top) / r.height * H,
  };
}

/* =====================================================================
   画像アセット（/assets から。未配置なら仮グラフィック）
   ===================================================================== */
const ASSETS = {};
function loadImage(name) {
  const e = { img: new Image(), ready: false };
  e.img.onload = () => { e.ready = true; };
  e.img.onerror = () => { e.ready = false; };
  e.img.src = 'assets/' + name;
  ASSETS[name] = e;
  return e;
}
function asset(name) { return ASSETS[name]; }

loadImage('background.png');
loadImage('bowl_empty.png');
loadImage('bowl_done.png');
for (let i = 1; i <= 5; i++) loadImage('bowl_' + i + '.png'); // 段階画像（無ければフォールバック）
loadImage('title_logo.png');
INGREDIENTS.forEach((ing) => loadImage(ing.img));

// ドットフォントの明示ロード。canvas の fillText は DOM と違いフォントロードを自動で
// トリガーしないため、ここで読み込む。毎フレーム再描画なのでロード完了後は自動反映。
// 未配置（assets/fonts/pixel.* が無い）なら失敗を握りつぶし、FONT_UI のフォールバックで描画。
if (document.fonts && document.fonts.load) {
  try { document.fonts.load("16px 'PixelFont'").catch(() => {}); } catch (e) {}
}

// 画像を中心指定で等倍描画（無ければ fallback）
function drawSprite(name, cx, cy, w, h, fallback) {
  const a = asset(name);
  if (a && a.ready) {
    g.drawImage(a.img, ri(cx - w / 2), ri(cy - h / 2), w, h);
  } else if (fallback) {
    fallback(cx, cy, w, h);
  }
}

/* =====================================================================
   サウンド（Web Audio API で手続き生成。音声ファイル不要）
   ===================================================================== */
const Sound = {
  ctx: null, master: null, muted: false, bgmOn: false, bgmStep: 0, nextNoteTime: 0, unlocked: false,
  init() { this.muted = lsGet(MUTED_KEY) === '1'; },
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.bgmOn = true;
      this.nextNoteTime = this.ctx.currentTime + 0.06;
    }
    // Chrome/iOS は生成直後も suspended/interrupted のことがある。ジェスチャ内で resume を試みる。
    if (this.ctx.state !== 'running' && this.ctx.resume) {
      this.ctx.resume().then(() => { this.nextNoteTime = this.ctx.currentTime + 0.06; }).catch(() => {});
    }
    // iOS Safari は resume だけでは解錠されないことがある。ジェスチャ内で極小音を1回鳴らして確実に解錠。
    if (!this.unlocked) {
      try {
        const o = this.ctx.createOscillator(), gg = this.ctx.createGain();
        gg.gain.value = 0.0001;
        o.connect(gg); gg.connect(this.ctx.destination);
        o.start(); o.stop(this.ctx.currentTime + 0.03);
        this.unlocked = true;
      } catch (_) {}
    }
  },
  setMuted(m) { this.muted = m; lsSet(MUTED_KEY, m ? '1' : '0'); if (this.master) this.master.gain.value = m ? 0 : 1; },
  toggleMute() { this.setMuted(!this.muted); },
  // 結果画面で止めたループBGMを再開（タイトル復帰/次ゲーム開始で使用）
  resumeBgm() { this.bgmOn = true; if (this.ctx) this.nextNoteTime = this.ctx.currentTime + 0.1; },
  note(freq, start, dur, type, vol) {
    if (!this.ctx || this.muted) return; // ミュート中はノードを作らない（無駄なCPU/GCを避ける）
    const o = this.ctx.createOscillator(), gain = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(gain); gain.connect(this.master);
    o.start(start); o.stop(start + dur + 0.02);
  },
  sweep(f0, f1, dur, type, vol) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), gain = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gain); gain.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  sfxThrow(speed) { this.ensure(); const s = clamp(((speed || 800) - 200) / 1200, 0, 1); this.sweep(180 + s * 220, 520 + s * 360, 0.14, 'square', 0.18); },
  // 具材ごとに音程を変え、コンボで上がる「入った」音
  sfxIn(combo, ingIndex) {
    this.ensure(); if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const semis = [0, 2, 3, 5, 7, 9][(ingIndex || 0) % 6] + Math.min(5, combo || 0);
    const base = 660 * Math.pow(2, semis / 12);
    this.note(base, t, 0.09, 'square', 0.22);
    this.note(base * 1.5, t + 0.05, 0.12, 'square', 0.18);
  },
  sfxMiss() { this.ensure(); this.sweep(380, 90, 0.30, 'sawtooth', 0.16); },
  // 弱すぎフリック（投げ不成立）の軽い合図
  sfxWeak() { this.ensure(); if (!this.ctx) return; this.note(200, this.ctx.currentTime, 0.07, 'sine', 0.10); },
  sfxComplete() { this.ensure(); if (!this.ctx) return; const t = this.ctx.currentTime; [523, 659, 784, 1047].forEach((f, i) => this.note(f, t + i * 0.08, 0.18, 'square', 0.22)); },
  sfxTimeup() { this.ensure(); if (!this.ctx) return; const t = this.ctx.currentTime; [392, 330, 262].forEach((f, i) => this.note(f, t + i * 0.16, 0.26, 'triangle', 0.22)); },
  // コンボ節目の上昇キラ音
  sfxComboMilestone() { this.ensure(); if (!this.ctx || this.muted) return; const t = this.ctx.currentTime; [784, 988, 1319].forEach((f, i) => this.note(f, t + i * 0.05, 0.12, 'square', 0.16)); },
  // ラストスパートのカウントダウン音（残り秒が小さいほど高音）
  sfxTick(sec) { this.ensure(); if (!this.ctx || this.muted) return; const f = 440 + (6 - Math.min(6, sec)) * 70; this.note(f, this.ctx.currentTime, 0.07, 'square', 0.14); },
  // 残り10秒突入の合図
  sfxSpurt() { this.ensure(); if (!this.ctx || this.muted) return; const t = this.ctx.currentTime; [523, 660, 880].forEach((f, i) => this.note(f, t + i * 0.07, 0.16, 'square', 0.18)); },
  // 結果発表のファンファーレ。grand=true（ハイスコア更新）で長く豪華に。
  sfxResult(grand) {
    this.ensure(); if (!this.ctx) return;
    this.bgmOn = false; // 結果中はループBGMを止めてファンファーレを際立たせる
    if (this.muted) return;
    const t = this.ctx.currentTime + 0.04;
    const lead = (f, o, d, v) => this.note(f, t + o, d, 'square', v == null ? 0.20 : v);
    const chord = (fs, o, d, v) => fs.forEach((f) => this.note(f, t + o, d, 'triangle', v));
    if (!grand) {
      // 通常：明るい上昇ジングル → C和音で締め（約1.0秒）
      lead(523, 0.00, 0.12); lead(659, 0.12, 0.12); lead(784, 0.24, 0.14); lead(1047, 0.40, 0.42);
      chord([523, 659, 784, 1047], 0.40, 0.48, 0.10);
    } else {
      // ハイスコア更新：豪華・長め・高いクライマックス＋キラキラ装飾（約1.7秒）
      lead(392, 0.00, 0.10); lead(523, 0.10, 0.10); lead(659, 0.20, 0.10);
      lead(784, 0.30, 0.16); lead(880, 0.50, 0.16); lead(1047, 0.70, 0.52);
      chord([523, 659, 784, 1047, 1319], 0.70, 0.62, 0.09);
      [1568, 1976, 2349].forEach((f, i) => this.note(f, t + 0.95 + i * 0.07, 0.10, 'square', 0.07));
    }
  },
  melody: [
    784, 0, 659, 784, 880, 0, 784, 659, 587, 0, 659, 587, 523, 0, 587, 0,
    784, 0, 659, 784, 880, 988, 1047, 880, 784, 659, 587, 659, 523, 0, 0, 0,
  ],
  bass: [
    262, 262, 196, 196, 220, 220, 247, 247, 262, 262, 196, 196, 220, 220, 247, 247,
    262, 262, 196, 196, 220, 220, 247, 247, 175, 175, 196, 196, 131, 131, 196, 196,
  ],
  STEP_DUR: 0.16,
  schedule() {
    if (!this.ctx || !this.bgmOn || this.ctx.state !== 'running') return; // 非runningはノードを作らず待機
    // タブ/画面非アクティブで rAF が止まると currentTime だけ進み、復帰時に
    // 過去分のノートが一気に発音されるバーストになる。大きく遅れていたら現在から再同期する。
    if (this.nextNoteTime < this.ctx.currentTime) this.nextNoteTime = this.ctx.currentTime + 0.06;
    const lookahead = 0.12;
    while (this.nextNoteTime < this.ctx.currentTime + lookahead) {
      const i = this.bgmStep % this.melody.length;
      if (this.melody[i] > 0) this.note(this.melody[i], this.nextNoteTime, this.STEP_DUR * 0.9, 'square', 0.05);
      if (this.bass[i] > 0) this.note(this.bass[i], this.nextNoteTime, this.STEP_DUR * 0.9, 'triangle', 0.06);
      this.nextNoteTime += this.STEP_DUR;
      this.bgmStep++;
    }
  },
};
Sound.init();

/* =====================================================================
   ゲーム状態
   ===================================================================== */
const STATE = { TITLE: 'title', PLAY: 'play', RESULT: 'result', RANKING: 'ranking' };

const game = {
  state: STATE.TITLE,
  timeLeft: CONFIG.GAME_TIME,
  lastSec: CONFIG.GAME_TIME, // 直近の残り秒（ラストスパートのカウントダウン検出用）
  bowls: 0,              // 完成した丼の数（難易度=ドリフト/縮小を駆動）
  bonusBowls: 0,         // コンボ達成で増える“ボーナス杯”（スコアに加算・難易度には影響させない）
  hiscore: 0,
  newRecord: false,
  elapsed: 0,
  driftPhase: 0,         // 丼ドリフトの位相（速度を変えても位置が飛ばないよう積算）

  bowl: { x: CONFIG.BOWL_X, y: CONFIG.BOWL_Y, scale: 1, hitW: CONFIG.BOWL_SIZE * CONFIG.CATCH_RATIO },
  ingIndex: 0,
  poured: 0,

  phase: 'aim',          // 'aim' | 'fly' | 'done'
  dragging: false,
  dragPointerId: null,
  food: { x: CONFIG.ANCHOR_X, y: CONFIG.ANCHOR_Y }, // ドラッグ中の具材表示位置
  pointer: { x: CONFIG.ANCHOR_X, y: CONFIG.ANCHOR_Y }, // 最新の指の位置
  dragStart: { x: CONFIG.ANCHOR_X, y: CONFIG.ANCHOR_Y }, // ドラッグ開始位置（フリック方向の基準）
  flickSamples: [],      // {x,y,t} 直近のポインタ軌跡（フリック速度の算出用）
  proj: { x: 0, y: 0, vx: 0, vy: 0, prevY: 0, y0: 0, minY: 0, scale: 1, trail: [] },

  completing: false,
  completeTimer: 0,
  combo: 0,              // 連続成功数（外すと0）
  maxCombo: 0,           // 最高コンボ（リザルト用）
  inFlash: 0,            // 受け口の成功フラッシュ
  particles: [],
  toasts: [],
  flash: 0,
  shake: 0,
  firstThrowDone: false,

  // オンライン全国ランキング
  lastScore: 0,                 // 直近ゲームの得点（=totalBowls）。endGameで確定し送信に使う
  myEntryId: null,              // 自分が登録した行のid（一覧で金ハイライトに使う）
  rankFrom: STATE.TITLE,        // ランキング画面から戻る先
  ranking: { phase: 'idle', rows: [], error: '' }, // phase: idle|loading|ok|error|unset
  submit: { phase: 'idle', error: '' },            // phase: idle|sending|done|error
};

(function loadHiscore() {
  const v = parseInt(lsGet(HISCORE_KEY) || '0', 10);
  game.hiscore = isNaN(v) ? 0 : v;
})();

/* =====================================================================
   ゲームロジック
   ===================================================================== */
function currentIng() { return INGREDIENTS[game.ingIndex]; }

function updateBowlDifficulty() {
  // 丼の見た目サイズ（杯数が進むほど縮む）
  if (CONFIG.DYNAMIC_DIFFICULTY) {
    const over = Math.max(0, game.bowls - CONFIG.BOWL_SHRINK_START + 1);
    game.bowl.scale = Math.max(CONFIG.BOWL_SCALE_MIN, 1 - over * CONFIG.BOWL_SHRINK_PER_BOWL);
  } else {
    game.bowl.scale = 1;
  }
  // 当たり幅は「現在の丼の見た目幅 × 比率」＝丼に対して常に寛容
  game.bowl.hitW = CONFIG.BOWL_SIZE * game.bowl.scale * CONFIG.CATCH_RATIO;
}

function resetBowl() {
  game.ingIndex = 0;
  game.poured = 0;
  updateBowlDifficulty();
  game.bowl.x = CONFIG.BOWL_X;
  game.bowl.y = CONFIG.BOWL_Y;
  game.driftPhase = 0; // 新しい丼はドリフトを中央（位相0）から開始
}

function setAim() {
  game.phase = 'aim';
  game.dragging = false;
  game.dragPointerId = null;
  game.food.x = CONFIG.ANCHOR_X;
  game.food.y = CONFIG.ANCHOR_Y;
  game.pointer.x = CONFIG.ANCHOR_X;
  game.pointer.y = CONFIG.ANCHOR_Y;
  game.flickSamples.length = 0;
}

function startGame(autoStarted) {
  track('game_start', { auto: !!autoStarted }); // GA4: プレイ開始（auto=?play自動開始）
  game.state = STATE.PLAY;
  game.timeLeft = CONFIG.GAME_TIME;
  game.lastSec = CONFIG.GAME_TIME;
  game.bowls = 0;
  game.bonusBowls = 0;
  game.elapsed = 0;
  game.driftPhase = 0;
  game.combo = 0;
  game.maxCombo = 0;
  game.inFlash = 0;
  game.newRecord = false;
  game.completing = false;
  game.particles.length = 0;
  game.toasts.length = 0;
  game.flash = 0;
  game.shake = 0;
  game.firstThrowDone = false;
  resetBowl();
  setAim();
  // ?play の自動開始(autoStarted)はユーザー操作前なので音声初期化を遅延し、AudioContext autoplay警告を避ける。
  // 最初のフリック/タップ（window pointerdown / onDown が Sound.ensure を呼ぶ）で解錠・BGM開始する。
  if (!autoStarted) { Sound.ensure(); Sound.resumeBgm(); }
}

// 直近サンプルからフリック速度（px/秒）を求める。releaseT は離した時刻（秒）。
function flickVelocity(releaseT) {
  const s = game.flickSamples;
  if (s.length < 2) return { vx: 0, vy: 0, speed: 0 };
  const latest = s[s.length - 1];
  // 離す前に指を止めていた（最後の動きから時間が空いた）＝フリックではない → 発射しない
  if (releaseT != null && releaseT - latest.t > 0.12) return { vx: 0, vy: 0, speed: 0 };
  let base = s[0];
  for (let i = s.length - 1; i >= 0; i--) { base = s[i]; if (latest.t - s[i].t >= CONFIG.FLICK_WINDOW) break; }
  const dt = Math.max(0.001, latest.t - base.t);
  const vx = (latest.x - base.x) / dt, vy = (latest.y - base.y) / dt;
  return { vx, vy, speed: Math.hypot(vx, vy) };
}

// フリック方向＝「ドラッグ開始位置 → 現在の指」。下から上へ振れば、指が手元より下でも上へ飛ぶ。
function aimDir() {
  const dx = game.pointer.x - game.dragStart.x, dy = game.pointer.y - game.dragStart.y;
  const len = Math.hypot(dx, dy);
  if (len < CONFIG.AIM_DEADZONE) return null;
  return { x: dx / len, y: dy / len };
}

// フリック発射：向き＝狙い方向（ガイドと一致）、勢い＝フリック速度（クランプ）
function releaseFlick(releaseT) {
  const fv = flickVelocity(releaseT);
  game.dragging = false;
  game.dragPointerId = null;
  if (fv.speed < CONFIG.MIN_FLICK_SPEED) { setAim(); Sound.sfxWeak(); return; } // 弱すぎ＝投げない（軽い合図）
  const dir = aimDir() || { x: 0, y: -1 };                      // 方向不定なら真上へ
  const sp = clamp(fv.speed * CONFIG.FLICK_POWER, CONFIG.LAUNCH_MIN, CONFIG.LAUNCH_MAX);
  game.proj.x = game.food.x; game.proj.y = game.food.y;
  game.proj.prevY = game.food.y; game.proj.y0 = game.food.y;
  game.proj.minY = game.food.y; game.proj.scale = 1; game.proj.trail.length = 0;
  game.proj.vx = dir.x * sp;
  game.proj.vy = dir.y * sp;
  game.phase = 'fly';
  game.flickSamples.length = 0;
  game.firstThrowDone = true;
  Sound.sfxThrow(fv.speed);
}

function spawnParticles(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(22, 96);
    game.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 24, life: rand(0.4, 0.9), max: 0.9, color, size: rand(1.5, 3) });
  }
}
function addToast(text, x, y, color, combo, finish) { game.toasts.push({ text, x, y, life: finish ? 1.1 : TOAST_LIFE, max: finish ? 1.1 : TOAST_LIFE, color: color || '#ffd23f', combo: combo || 0, finish: !!finish }); }

function onIn() {
  const ing = currentIng();
  game.combo++;
  if (game.combo > game.maxCombo) game.maxCombo = game.combo;
  Sound.sfxIn(game.combo, game.ingIndex);
  spawnParticles(game.bowl.x, mouthAt(game.bowl), ing.color, 10);
  game.poured++;
  game.shake = Math.min(game.shake + 2, 4);
  game.inFlash = IN_FLASH_DUR; // 受け口の成功フラッシュ

  // コンボ報酬（ボーナス杯）：仕様は「6連続成功(=INGREDIENTS.length)ごとに【ボーナス杯+1】」。
  // ノーミスなら 6コンボ＝1杯完成と一致するが、ミス後は丼の途中で6コンボに達することもある（=仕様として許容）。
  // ボーナス杯は game.bonusBowls に積み、難易度を駆動する game.bowls には足さない（飛行中に丼が急加速して理不尽になるのを防ぐ）。
  const N = INGREDIENTS.length;
  const milestone = game.combo >= N && game.combo % N === 0;
  if (milestone) {
    game.bonusBowls++;
    game.flash = Math.max(game.flash, 0.6);
    game.shake = Math.min(game.shake + 4, 8);
    spawnParticles(game.bowl.x, game.bowl.y - 18, '#ffd23f', 20);
    Sound.sfxComboMilestone();
  }

  if (game.poured >= INGREDIENTS.length) {
    // 1杯完成。コンボが続くほど完成硬直を短く＝テンポUP＝結果的に杯数が伸びる（コンボの実利・スコアは杯数のまま）
    game.bowls++;
    game.flash = 1;
    game.completing = true;
    game.completeTimer = Math.max(0.18, CONFIG.COMPLETE_HOLD - Math.min(game.combo, 12) * 0.012);
    game.phase = 'done';
    game.shake = 5;
    addToast('完成！', game.bowl.x, game.bowl.y - 40, '#ffd23f', 0, true); // コンボより格上＝最も派手に
    if (milestone) addToast('＋ ボーナス +1杯！', game.bowl.x, game.bowl.y - 18, '#ffd23f', game.combo); // ノーミス6コンボで完成＝ボーナスも同時に見せる
    Sound.sfxComplete();
    spawnParticles(game.bowl.x, game.bowl.y, '#ffd23f', 28 + Math.min(game.combo, 14)); // 高コンボほど派手
    spawnParticles(game.bowl.x, game.bowl.y - 8, '#fff3b0', 12);
  } else {
    game.ingIndex++;
    if (milestone) {
      addToast('ボーナス +1杯！', game.bowl.x, game.bowl.y - 28, '#ffd23f', game.combo); // コンボ達成のボーナス杯
    } else if (game.combo >= 2) {
      addToast(game.combo + ' れんぞく！', game.bowl.x, game.bowl.y - 24, '#ffd23f', game.combo);
      if (game.combo >= 3) spawnParticles(game.bowl.x, game.bowl.y - 18, '#ffd23f', Math.min(4 + game.combo, 12)); // 高コンボでキラ粒子
    } else {
      addToast('ナイス', game.bowl.x, game.bowl.y - 24, '#8ef0a0', 1);
    }
    setAim();
  }
}

function onMiss(x, y, sideExit) {
  game.combo = 0;
  Sound.sfxMiss();
  spawnParticles(x, clamp(y, 0, H), currentIng().edge, 6);
  // 横に抜けた or 受け口の高さに届いて外した→「よこにズレた」、純粋に高さ不足→「とどかない」
  const reachedHeight = game.proj.minY <= mouthAt(game.bowl);
  const reason = (sideExit || reachedHeight) ? 'よこにズレた！' : 'とどかない！';
  addToast(reason, game.bowl.x, game.bowl.y - 6, '#ff9a6a');
  setAim(); // 同じ食材を投げ直し
}

function updatePlay(dt) {
  game.elapsed += dt;
  game.timeLeft -= dt;
  if (game.timeLeft <= 0) { game.timeLeft = 0; endGame(); return; }

  // ラストスパート：残り10秒で突入アナウンス、残り1〜5秒はカウントダウン音（緊張ピーク）
  const sec = Math.ceil(game.timeLeft);
  if (sec !== game.lastSec) {
    game.lastSec = sec;
    if (sec === 10) { addToast('ラストスパート！', W / 2, 150, '#ff7a3a'); Sound.sfxSpurt(); }
    else if (sec >= 1 && sec <= 5) Sound.sfxTick(sec);
  }

  // 完成演出の保持 → 終わったら次の丼へ
  if (game.completing) {
    game.completeTimer -= dt;
    if (game.completeTimer <= 0) { game.completing = false; resetBowl(); setAim(); }
  }

  // 丼ドリフト（動的難度）
  const b = game.bowl;
  if (game.completing) {
    // 完成演出中は丼を中央へ寄せて演出を見やすく
    b.x += (CONFIG.BOWL_X - b.x) * Math.min(1, dt * 8);
  } else if (CONFIG.DYNAMIC_DIFFICULTY && game.bowls >= CONFIG.DRIFT_START_BOWL) {
    const amp = Math.min(CONFIG.DRIFT_AMP_MAX, (game.bowls - CONFIG.DRIFT_START_BOWL + 1) * CONFIG.DRIFT_AMP_PER_BOWL);
    const speed = Math.min(CONFIG.DRIFT_SPEED_MAX, CONFIG.DRIFT_SPEED_BASE + (game.bowls - CONFIG.DRIFT_START_BOWL) * CONFIG.DRIFT_SPEED_PER_BOWL);
    game.driftPhase += speed * dt;            // 位相を積算（速度を上げても位置が飛ばない）
    b.x = CONFIG.BOWL_X + Math.sin(game.driftPhase) * amp;
  } else {
    b.x = CONFIG.BOWL_X;
  }

  // 飛行中
  if (game.phase === 'fly') {
    const p = game.proj;
    p.prevY = p.y;
    p.vy += CONFIG.GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // 奥行き縮小は「最高到達点」基準で固定（落下時に大きく戻らない）＋残像を記録
    if (p.y < p.minY) p.minY = p.y;
    const span = p.y0 - CONFIG.BOWL_Y;
    const tt = span > 0 ? clamp((p.y0 - p.minY) / span, 0, 1) : 0;
    p.scale = 1 - (1 - CONFIG.FLY_MIN_SCALE) * tt;
    p.trail.push({ x: p.x, y: p.y, s: p.scale });
    if (p.trail.length > 5) p.trail.shift();
    const mouthY = mouthAt(b);
    const inX = Math.abs(p.x - b.x) < b.hitW / 2;
    if (p.vy > 0 && p.prevY <= mouthY && p.y >= mouthY && inX) { onIn(); return; }
    const side = p.x < -40 || p.x > W + 40;
    if (side || p.y > H + 30) { onMiss(p.x, p.y, side); return; }
  }
}

function endGame() {
  game.state = STATE.RESULT;
  game.newRecord = false;
  const z = totalBowls();
  if (z > game.hiscore) {
    game.hiscore = z;
    game.newRecord = true;
    lsSet(HISCORE_KEY, String(game.hiscore));
  }
  Sound.sfxResult(game.newRecord); // 結果発表のファンファーレ（更新時は豪華版）

  // ランキング登録用に得点を確定し、前回の送信/取得状態をリセット
  game.lastScore = z;
  game.myEntryId = null;
  game.ranking = { phase: 'idle', rows: [], error: '' };
  game.submit = { phase: 'idle', error: '' };
  rankPreview = null; // 未設定プレビューも今回の結果でリセット

  // GA4: タイムアップ（スコア=提供数, 内訳, 最高コンボ, 職人ランク, 自己ベスト更新）
  track('game_over', {
    score: z,
    completed: game.bowls,
    bonus: game.bonusBowls,
    max_combo: game.maxCombo,
    rank: rankFor(z),
    new_record: game.newRecord,
  });
}

function updateEffects(dt) {
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
    p.life -= dt;
    if (p.life <= 0) { game.particles.splice(i, 1); continue; }
    p.vy += 240 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
  }
  for (let i = game.toasts.length - 1; i >= 0; i--) {
    const t = game.toasts[i];
    t.life -= dt; t.y -= 12 * dt;
    if (t.life <= 0) game.toasts.splice(i, 1);
  }
  if (game.flash > 0) game.flash = Math.max(0, game.flash - dt * 3.2); // 完成ホールド(0.35s)内で消えるよう速め
  if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 16);
  if (game.inFlash > 0) game.inFlash = Math.max(0, game.inFlash - dt * 3);
}

/* =====================================================================
   入力（Pointer Events：マウス/タッチ統一・マルチタッチ対策）
   ===================================================================== */
// ミュートは「見た目アイコン」と「タップ判定」を分離。
// アイコンは20px帯の内側に余白を持たせて配置（下端y=18<帯20→はみ出し解消）。
// 判定は約30×24論理px＝実機44〜52px相当に拡大し、押しやすく取りこぼしを防ぐ。
// 見た目: 右マージン5px（遊び方の左マージンと一致）・高さ16px（遊び方/中心y10と一致）。
function muteIconRect() { return { x: W - 23, y: 2, w: 18, h: 16 }; }
function muteHitRect() { return { x: W - 34, y: 0, w: 34, h: 24 }; }
function startRect() { return { x: W / 2 - 64, y: 222, w: 128, h: 40 }; }      // タイトル中央CTA（上げて下部に余白）
function retryRect() { return { x: W / 2 - 66, y: 282, w: 132, h: 30 }; }      // 結果：もう一度（カード枠外。下に余白を確保）
function rankingRect() { const w = navW('ランキング'); return { x: W / 2 - w / 2, y: 296, w: w, h: 16 }; } // タイトル最下部・中央
function registerRect() { return { x: W / 2 - 64, y: 216, w: 128, h: 24 }; }   // 結果：ランキングに登録（カード内。上に間隔・下にハイスコア＋余白）
function inRect(r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

function onDown(x, y, pid, t) {
  Sound.ensure();
  if (inRect(muteHitRect(), x, y)) { Sound.toggleMute(); return false; }
  if (game.state === STATE.TITLE) {
    if (inRect(howtoRect(), x, y)) { try { window.location.href = 'howto.html'; } catch (e) {} return false; }
    if (inRect(rankingRect(), x, y)) { openRanking(STATE.TITLE); return false; }
    if (inRect(startRect(), x, y)) startGame();
    return false; // ボタンの範囲だけで反応（誤動作防止）
  }
  if (game.state === STATE.RESULT) {
    if (inRect(backRect(), x, y)) { game.state = STATE.TITLE; game.elapsed = 0; Sound.resumeBgm(); return false; }
    if (inRect(registerRect(), x, y)) { onRegisterTap(); return false; }
    if (inRect(retryRect(), x, y)) startGame();
    return false;
  }
  if (game.state === STATE.RANKING) {
    if (inRect(backRectRanking(), x, y)) { game.state = game.rankFrom || STATE.TITLE; game.elapsed = 0; return false; }
    // それ以外はリストのドラッグスクロール開始（ポインタを掴んで確実に追従）
    rankDragging = true; rankLastY = y; rankDragPid = pid;
    return true;
  }
  if (game.state === STATE.PLAY && game.phase === 'aim' && !game.dragging) {
    game.dragging = true;
    game.dragPointerId = pid;
    game.flickSamples.length = 0;
    game.flickSamples.push({ x, y, t });
    game.pointer.x = x; game.pointer.y = y;
    game.dragStart.x = x; game.dragStart.y = y;
    updateFoodPos(x, y);
    return true;
  }
  return false;
}
function onMove(x, y, pid, t) {
  if (game.state === STATE.RANKING && rankDragging && pid === rankDragPid) {
    rankScroll = clamp(rankScroll + (rankLastY - y), 0, rankMaxScroll); rankLastY = y; // 指と逆にスクロール
    return;
  }
  if (game.state === STATE.PLAY && game.dragging && pid === game.dragPointerId) {
    game.flickSamples.push({ x, y, t });
    if (game.flickSamples.length > 8) game.flickSamples.shift();
    game.pointer.x = x; game.pointer.y = y;
    updateFoodPos(x, y);
  }
}
function onUp(pid, t) {
  if (game.state === STATE.RANKING && pid === rankDragPid) { rankDragging = false; return; }
  if (game.state === STATE.PLAY && game.dragging && pid === game.dragPointerId) releaseFlick(t);
}
// OS/ブラウザがポインタを奪った場合（着信・ジェスチャ割り込み等）は発射せずドラッグ中断
function onCancel(pid) {
  if (pid === rankDragPid) rankDragging = false; // ランキングのスクロールも中断
  if (game.dragging && pid === game.dragPointerId) {
    game.dragging = false;
    game.dragPointerId = null;
    game.food.x = CONFIG.ANCHOR_X;
    game.food.y = CONFIG.ANCHOR_Y;
    game.pointer.x = CONFIG.ANCHOR_X;
    game.pointer.y = CONFIG.ANCHOR_Y;
    game.flickSamples.length = 0;
  }
}
// 具材を指に追従（アンカー周りの小半径にクランプ＝持ち運び防止）
function updateFoodPos(x, y) {
  let dx = x - CONFIG.ANCHOR_X, dy = y - CONFIG.ANCHOR_Y;
  const len = Math.hypot(dx, dy);
  if (len > CONFIG.GRAB_RADIUS) { dx = dx / len * CONFIG.GRAB_RADIUS; dy = dy / len * CONFIG.GRAB_RADIUS; }
  game.food.x = CONFIG.ANCHOR_X + dx;
  game.food.y = CONFIG.ANCHOR_Y + dy;
}

view.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (game.dragging && game.dragPointerId !== null && e.pointerId !== game.dragPointerId) return;
  const p = toLogical(e.clientX, e.clientY);
  const started = onDown(p.x, p.y, e.pointerId, e.timeStamp / 1000);
  if (started) { try { view.setPointerCapture(e.pointerId); } catch (_) {} }
}, { passive: false });
view.addEventListener('pointermove', (e) => {
  e.preventDefault();
  const p = toLogical(e.clientX, e.clientY);
  onMove(p.x, p.y, e.pointerId, e.timeStamp / 1000);
}, { passive: false });
window.addEventListener('pointerup', (e) => onUp(e.pointerId, e.timeStamp / 1000));
window.addEventListener('pointercancel', (e) => onCancel(e.pointerId));
// ランキング画面はマウスホイールでもスクロール（PC向け。clampは描画側）
view.addEventListener('wheel', (e) => { if (game.state === STATE.RANKING) { rankScroll = clamp(rankScroll + e.deltaY, 0, rankMaxScroll); e.preventDefault(); } }, { passive: false });
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
// 音声アンロックの保険：最初のユーザー操作で AudioContext を resume（Chrome/iOS の自動再生制限対策）
window.addEventListener('pointerdown', () => Sound.ensure(), { passive: true });
window.addEventListener('touchend', () => Sound.ensure(), { passive: true });
// 着信/アプリ切替などで interrupted になった AudioContext を、画面復帰時に再開＋BGM位相を再同期
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Sound.ctx && Sound.ctx.state !== 'running' && Sound.ctx.resume) {
    Sound.ctx.resume().then(() => { Sound.nextNoteTime = Sound.ctx.currentTime + 0.06; }).catch(() => {});
  }
});

/* =====================================================================
   描画
   ===================================================================== */
// 習字風（明朝/筆書体）フォントスタック。論理解像度で描いて拡大するのでドット感も残る。
const FONT_BRUSH = "'Klee One','Klee','Hiragino Mincho ProN','YuMincho','Yu Mincho','MS Mincho',serif";
// UIはレトロなドットフォント優先。'PixelFont' は style.css の @font-face（assets/fonts/pixel.*）。
// 未配置/未ロード時は丸ゴシックにフォールバックして必ず描画される。
const FONT_UI = "'PixelFont','Hiragino Maru Gothic ProN','Yu Gothic',sans-serif";

function drawText(str, x, y, size, color, align, bold, family) {
  g.font = `${bold ? '700' : '500'} ${size}px ${family || FONT_UI}`;
  g.textAlign = align || 'left';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.7)';
  g.fillText(str, ri(x + 1), ri(y + 1));
  g.fillStyle = color;
  g.fillText(str, ri(x), ri(y));
}

function drawBackground() {
  const a = asset('background.png');
  if (a && a.ready) {
    // 背景は cover-fit。180×320ネイティブならそのまま等倍、サイズ違いでも中央合わせで対応。
    // （縮小が要る場合に備え、背景描画の間だけ平滑化を許可）
    g.imageSmoothingEnabled = true;
    const iw = a.img.width, ih = a.img.height;
    const s = Math.max(W / iw, H / ih);
    const dw = iw * s, dh = ih * s;
    g.drawImage(a.img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    g.imageSmoothingEnabled = false;
    return;
  }
  // フォールバック（店内風グラデ＋カウンター）
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#241a33'); grad.addColorStop(0.55, '#1a1228'); grad.addColorStop(1, '#0f0a18');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.03)';
  for (let y = 24; y < 150; y += 16) g.fillRect(0, y, W, 1);
  g.fillStyle = '#3a2a1c'; g.fillRect(0, 232, W, H - 232);
  g.fillStyle = '#4a3624'; g.fillRect(0, 232, W, 3);
}

function drawBowlFallbackShape(cx, cy, s) {
  g.fillStyle = '#15151f';
  g.beginPath(); g.ellipse(cx, cy + s * 0.10, s / 2, s * 0.42, 0, 0, Math.PI); g.fill();
  g.fillStyle = '#26263a';
  g.beginPath(); g.ellipse(cx, cy - s * 0.16, s / 2, s * 0.28, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2b3550';
  g.beginPath(); g.ellipse(cx, cy - s * 0.16, s / 2 - 4, s * 0.22, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3c3c58'; g.lineWidth = 1;
  g.beginPath(); g.ellipse(cx, cy - s * 0.16, s / 2, s * 0.28, 0, 0, Math.PI * 2); g.stroke();
}

function drawIngredientShape(ing, cx, cy, size) {
  const r = size / 2;
  g.save();
  if (ing.key === 'soba') {
    g.strokeStyle = ing.color; g.lineWidth = 2;
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(cx - r, cy + i * 3); g.quadraticCurveTo(cx, cy + i * 3 - 4, cx + r, cy + i * 3); g.stroke(); }
  } else if (ing.key === 'negi') {
    g.fillStyle = ing.color; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d7f6c0'; g.beginPath(); g.arc(cx, cy, r * 0.45, 0, Math.PI * 2); g.fill();
    g.strokeStyle = ing.edge; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  } else if (ing.key === 'tenkasu') {
    g.fillStyle = ing.color;
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.beginPath(); g.arc(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5, r * 0.32, 0, Math.PI * 2); g.fill(); }
  } else {
    g.fillStyle = ing.color; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(cx - r * 0.3, cy - r * 0.3, r * 0.32, 0, Math.PI * 2); g.fill();
    g.strokeStyle = ing.edge; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  }
  g.restore();
}
function drawIngredient(ing, cx, cy, scale) {
  const s = ing.size * (scale || 1);
  drawSprite(ing.img, cx, cy, s, s, () => drawIngredientShape(ing, cx, cy, s));
}

// 丼（段階画像 bowl_empty→bowl_1..5→bowl_done。無ければ bowl_empty＋盛り描画でフォールバック）
function bowlImageName() {
  if (game.completing || game.poured >= INGREDIENTS.length) return 'bowl_done.png';
  if (game.poured <= 0) return 'bowl_empty.png';
  return 'bowl_' + game.poured + '.png';
}
function drawBowl() {
  const b = game.bowl, S = CONFIG.BOWL_SIZE * b.scale; // 杯数で縮む
  const name = bowlImageName();
  const a = asset(name);
  if (a && a.ready) {
    g.drawImage(a.img, ri(b.x - S / 2), ri(b.y - S / 2), S, S);
    return;
  }
  // フォールバック: bowl_empty（あれば）or 仮の丼
  const be = asset('bowl_empty.png');
  if (be && be.ready) g.drawImage(be.img, ri(b.x - S / 2), ri(b.y - S / 2), S, S);
  else drawBowlFallbackShape(b.x, b.y, S);
  // 段階画像が無い時は盛った食材を小さく積んで進捗を見せる
  const n = Math.min(game.poured, INGREDIENTS.length);
  for (let i = 0; i < n; i++) {
    const ing = INGREDIENTS[i];
    const px = b.x + Math.cos(i * 1.9) * (S * 0.14);
    const py = b.y - 8 - i * 2 + Math.sin(i * 2.3) * 2;
    drawIngredientShape(ing, px, py, ing.size * 0.45 * b.scale);
  }
}

function drawMouthHint() {
  const b = game.bowl, mouthY = mouthAt(b);
  g.save();
  g.globalAlpha = 0.22 + Math.sin(game.elapsed * 6) * 0.08;
  g.fillStyle = '#9fe0ff';
  g.fillRect(ri(b.x - b.hitW / 2), ri(mouthY - 1), ri(b.hitW), 2);
  g.restore();
}

// 入った瞬間に受け口が白く光る（少し広がりながらフェード）
function drawInFlash() {
  const b = game.bowl, mouthY = mouthAt(b);
  const t = clamp(game.inFlash / IN_FLASH_DUR, 0, 1); // 1→0 で減衰
  const w = b.hitW * (1 + (1 - t) * 0.6);             // 少し広がる
  g.save();
  g.globalAlpha = t * 0.6;
  g.fillStyle = '#ffffff';
  g.fillRect(ri(b.x - w / 2), ri(mouthY - 2), ri(w), 4);
  g.restore();
}

// 狙い方向に沿って予測軌道を点線表示（ドラッグ中は速度に関係なく安定表示）
function drawTrajectory() {
  const dir = aimDir();
  if (!dir) return;
  const sp = (CONFIG.LAUNCH_MIN + CONFIG.LAUNCH_MAX) / 2; // 代表速度で安定した目安を表示
  let x = game.food.x, y = game.food.y;
  let vx = dir.x * sp, vy = dir.y * sp;
  const dt = CONFIG.TRAJECTORY_DT;
  g.save(); g.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < CONFIG.TRAJECTORY_STEPS; i++) {
    vy += CONFIG.GRAVITY * dt; x += vx * dt; y += vy * dt;
    if (y > H || x < 0 || x > W) break;
    if (i % 2 === 0) { const s = 2.6 - (i / CONFIG.TRAJECTORY_STEPS) * 1.2; g.fillRect(ri(x - s / 2), ri(y - s / 2), Math.max(1, ri(s)), Math.max(1, ri(s))); }
  }
  g.restore();
}

function drawParticles() {
  game.particles.forEach((p) => { g.globalAlpha = clamp(p.life / p.max, 0, 1); g.fillStyle = p.color; g.fillRect(ri(p.x - p.size / 2), ri(p.y - p.size / 2), Math.max(1, ri(p.size)), Math.max(1, ri(p.size))); });
  g.globalAlpha = 1;
}
function drawToasts() {
  game.toasts.forEach((t) => {
    const k = clamp(t.life / t.max, 0, 1);
    g.globalAlpha = k;
    if (t.finish) drawFinishToast(t, k);           // 完成（最大・金）
    else if (t.combo >= 1) drawPopToast(t, k);      // ナイス(1)＆コンボ(>=2)
    else drawText(t.text, t.x, t.y, 12, t.color, 'center', true); // ミス等
  });
  g.globalAlpha = 1;
}

// 縁取りつき中央テキスト（原点描画。translate/scale済みの座標系で使う）
function drawOutlinedText(text, size, fill, outline, rad) {
  g.font = '700 ' + size + 'px ' + FONT_UI;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = outline;
  for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) if ((dx || dy) && dx * dx + dy * dy <= rad * rad + 0.5) g.fillText(text, dx, dy);
  g.fillStyle = fill;
  g.fillText(text, 0, 0);
}

// 1杯完成「完成！」：得点イベント＝最も大きく派手（金＋白ツヤ＋太縁＋強ポップ）
function drawFinishToast(t, k) {
  const age = 1 - k;
  const pop = 1 + 0.7 * Math.max(0, 1 - age / 0.28);
  const size = 26; // コンボ最大(~23)より大きい
  g.font = '700 ' + size + 'px ' + FONT_UI; g.textAlign = 'center'; g.textBaseline = 'middle';
  const sc = Math.min(pop, 172 / Math.max(1, g.measureText(t.text).width));
  g.save();
  g.translate(ri(t.x), ri(t.y)); g.scale(sc, sc);
  drawOutlinedText(t.text, size, '#ffd23f', '#7a2e06', 3);
  g.fillStyle = 'rgba(255,255,255,0.65)'; g.fillText(t.text, 0, -1.4); // 上側に白ツヤ
  g.restore();
}

// 成功トースト：ナイス(combo=1)は控えめ緑、コンボ(>=2)はコンボ数で拡大＆黄→赤エスカレーション。
// いずれも縁取り＋ポップで、派手な「完成」に対して地味になりすぎないようにする。
function drawPopToast(t, k) {
  const combo = t.combo, age = 1 - k;
  let size, fill, rad, pop, wob = 0;
  const outline = combo >= 2 ? '#3a1606' : '#123a1c';
  if (combo >= 2) {
    pop = 1 + 0.4 * Math.max(0, 1 - age / 0.22);
    wob = combo >= 4 ? Math.sin(age * 20) * 0.05 : 0; // 高コンボで小刻みに揺れる
    size = 14 + Math.min(combo, 8) * 1.1; // コンボで拡大（最大~23px）
    const colors = ['#ffe24a', '#ffd23f', '#ffb02e', '#ff8a2a', '#ff5a3a'];
    fill = colors[Math.min(colors.length - 1, combo - 2)];
    rad = 2;
  } else {
    pop = 1 + 0.3 * Math.max(0, 1 - age / 0.2);
    size = 16; fill = '#9bf0a8'; rad = 2; // ナイス：緑・中サイズ・縁取りで存在感
  }
  g.font = '700 ' + size + 'px ' + FONT_UI; g.textAlign = 'center'; g.textBaseline = 'middle';
  const sc = Math.min(pop, 168 / Math.max(1, g.measureText(t.text).width));
  g.save();
  g.translate(ri(t.x), ri(t.y));
  if (wob) g.rotate(wob);
  g.scale(sc, sc);
  drawOutlinedText(t.text, size, fill, outline, rad);
  g.restore();
}

function drawButton(r, label, color) {
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(r.x + 2, r.y + 2, r.w, r.h);
  g.fillStyle = color || '#e8b84a'; g.fillRect(r.x, r.y, r.w, r.h);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(r.x, r.y, r.w, 2);
  g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(r.x, r.y, r.w, r.h);
  drawText(label, r.x + r.w / 2, r.y + r.h / 2, 13, '#1a1228', 'center', true);
}

// 角丸の矩形パス
function roundRectPath(x, y, w, h, rad) {
  g.beginPath();
  g.moveTo(x + rad, y);
  g.arcTo(x + w, y, x + w, y + h, rad);
  g.arcTo(x + w, y + h, x, y + h, rad);
  g.arcTo(x, y + h, x, y, rad);
  g.arcTo(x, y, x + w, y, rad);
  g.closePath();
}

// 共通の金角丸ボタン枠（影・縦グラデ・上ハイライト・白フチ）。スタート/もう一度で共用。
function drawButtonFrame(r, bright) {
  const rad = Math.min(11, r.h / 2);
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.5)';
  roundRectPath(r.x, r.y + 4, r.w, r.h, rad); g.fill();
  const grad = g.createLinearGradient(0, r.y, 0, r.y + r.h);
  grad.addColorStop(0, bright ? '#ffe28e' : '#f3c860');
  grad.addColorStop(1, bright ? '#e3aa40' : '#d2922a');
  g.fillStyle = grad;
  roundRectPath(r.x, r.y, r.w, r.h, rad); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.26)';
  roundRectPath(r.x + 3, r.y + 3, r.w - 6, r.h * 0.34, Math.max(2, rad - 5)); g.fill();
  g.strokeStyle = '#fff8df'; g.lineWidth = 2;
  roundRectPath(r.x, r.y, r.w, r.h, rad); g.stroke();
  g.restore();
}

// 魅力的なスタートボタン（2行「60秒タイムアタック / ▶スタート」）
function drawStartButton(r, bright) {
  drawButtonFrame(r, bright);
  const cx = r.x + r.w / 2;
  // 上段「60秒タイムアタック」：明るいハイライト帯の上なので、暗い影ではなく
  // 濃色文字＋淡いハイライト（彫り込み風）で可読性を確保。サイズも少し拡大。
  const subY = r.y + 11;
  g.font = '700 11px ' + FONT_UI;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillText('60秒タイムアタック', ri(cx), ri(subY + 1));
  g.fillStyle = '#3a2206';
  g.fillText('60秒タイムアタック', ri(cx), ri(subY));

  // 下段「▶ スタート」：2行ブロックがボタン縦中央に来るよう配置
  const ly = r.y + 27;
  drawText('スタート', cx + 7, ly, 16, '#2a1804', 'center', true);
  g.fillStyle = '#2a1804';
  g.beginPath();
  g.moveTo(cx - 36, ly - 6); g.lineTo(cx - 36, ly + 6); g.lineTo(cx - 27, ly); g.closePath(); g.fill();
}

// もう一度あそぶボタン（スタートと同じ金角丸・▶＋テキストを実寸計測して中央やや左に配置）
function drawRetryButton(r, bright) {
  drawButtonFrame(r, bright);
  const cy = r.y + r.h / 2 - 1; // textBaseline middle の下ズレを1px補正
  const label = 'もう一度あそぶ';
  g.font = '700 14px ' + FONT_UI;
  g.textBaseline = 'middle'; g.textAlign = 'left';
  const tw = g.measureText(label).width;
  const arrowW = 7, gap = 5;
  // [▶＋テキスト]の合計幅を測ってボタン中央へ。さらに-3pxだけ左に寄せて右詰まり感を解消。
  const startX = Math.round(r.x + (r.w - (arrowW + gap + tw)) / 2 - 3);
  g.fillStyle = '#2a1804';
  g.beginPath();
  g.moveTo(startX, cy - 5); g.lineTo(startX, cy + 5); g.lineTo(startX + arrowW, cy); g.closePath(); g.fill();
  const tx = startX + arrowW + gap;
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillText(label, ri(tx), ri(cy + 1));
  g.fillStyle = '#2a1804';
  g.fillText(label, ri(tx), ri(cy));
}

// 小型ナビボタン（暗色角丸＋金フチ＋クリーム文字）。タイトルの遊び方／結果のトップへ戻る で共用。
// 右上のミュート(y2-18,中心y10)と高さを揃え、開始時の「N杯」スコア(x6,y11)とほぼ同位置。
// dir: 'right'=▶（進む/遊び方） 'left'=◀（戻る）。低解像度で潰れる「？」丸バッジは廃止。
// ナビボタンの幅＝中身（矢印5＋間隔4＋文字）＋左右パディング各5。中身に合わせて短く。
function navW(label) { g.font = '700 9px ' + FONT_UI; return Math.round(g.measureText(label).width + 19); }
function howtoRect() { return { x: 5, y: 2, w: navW('あそびかた'), h: 16 }; }
function backRect() { return { x: 5, y: 2, w: navW('トップへ'), h: 16 }; }       // 結果画面：トップへ
function backRectRanking() { return { x: 5, y: 2, w: navW('もどる'), h: 16 }; }   // ランキング：もどる
function drawNavButton(r, label, dir) {
  const rad = Math.min(5, r.h / 2);
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.4)'; roundRectPath(r.x, r.y + 1, r.w, r.h, rad); g.fill();
  g.fillStyle = 'rgba(28,18,10,0.82)'; roundRectPath(r.x, r.y, r.w, r.h, rad); g.fill();
  g.strokeStyle = '#e0a336'; g.lineWidth = 1; roundRectPath(r.x, r.y, r.w, r.h, rad); g.stroke();
  g.restore();
  const cy = r.y + r.h / 2;
  // 矢印＋ラベルを1グループとして中央寄せ（矢印と文字の間隔を4pxに詰める。dir で向き切替＝▶進む / ◀戻る）
  g.font = '700 9px ' + FONT_UI;
  const tw = g.measureText(label).width, aw = 5, gap = 4;
  const sx = Math.round(r.x + (r.w - (aw + gap + tw)) / 2);
  g.fillStyle = '#e0a336';
  g.beginPath();
  if (dir === 'left') { g.moveTo(sx + aw, cy - 3); g.lineTo(sx + aw, cy + 3); g.lineTo(sx, cy); }
  else { g.moveTo(sx, cy - 3); g.lineTo(sx, cy + 3); g.lineTo(sx + aw, cy); }
  g.closePath(); g.fill();
  drawText(label, sx + aw + gap + tw / 2, cy, 9, '#ffe9a8', 'center', true);
}

// 結果画面のランク別ひとこと（最下部の意味不明な『岐阜・冷やしたぬきそば』を置換）
function resultComment(n) {
  if (n >= 9) return 'お見事な職人技！';
  if (n >= 5) return 'いい提供テンポ！';
  if (n >= 3) return 'その調子！';
  if (n >= 1) return 'また挑戦してね！';
  return 'まずは1杯、いってみよう！';
}

function drawMuteButton() {
  const r = muteIconRect();
  const rad = Math.min(5, r.h / 2);
  // 遊び方ボタンと同じ体裁（暗色角丸＋金フチ＋影）で統一し、浮いて見えないように。
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.4)'; roundRectPath(r.x, r.y + 1, r.w, r.h, rad); g.fill();
  g.fillStyle = 'rgba(28,18,10,0.82)'; roundRectPath(r.x, r.y, r.w, r.h, rad); g.fill();
  g.strokeStyle = '#e0a336'; g.lineWidth = 1; roundRectPath(r.x, r.y, r.w, r.h, rad); g.stroke();
  g.restore();
  // スピーカー（遊び方の文字色に合わせてクリーム）
  const cx = r.x + 6, cy = r.y + r.h / 2;
  g.fillStyle = '#ffe9a8';
  g.beginPath();
  g.moveTo(cx - 2, cy - 2); g.lineTo(cx, cy - 2); g.lineTo(cx + 3, cy - 4); g.lineTo(cx + 3, cy + 4); g.lineTo(cx, cy + 2); g.lineTo(cx - 2, cy + 2);
  g.closePath(); g.fill();
  if (Sound.muted) {
    g.strokeStyle = '#ff6a6a'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx + 1, cy - 5); g.lineTo(cx + 8, cy + 5); g.stroke();
  } else {
    g.strokeStyle = '#ffe9a8'; g.lineWidth = 1;
    g.beginPath(); g.arc(cx + 4, cy, 3, -0.6, 0.6); g.stroke();
    g.beginPath(); g.arc(cx + 4, cy, 6, -0.6, 0.6); g.stroke();
  }
}

function drawHUD() {
  g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, 0, W, 20);
  drawText(totalBowls() + '杯', 6, 11, 12, '#fff', 'left', true);
  const t = Math.ceil(game.timeLeft);
  const tc = t <= 10 ? '#ff5a5a' : (t <= 20 ? '#ffd23f' : '#fff');
  drawText(String(t), W / 2, 11, 16, tc, 'center', true);
  // コンボは完成時に中央の緑トースト「N れんぞく！」で大きく出るため、HUD常時表示は冗長＆
  // タイマー≤20秒の黄(#ffd23f)と同色で中央寄せ時に融合するので、HUDからは表示しない。
  // これで右上角はミュート専有となり、密集・はみ出し・衝突が解消する。
  drawMuteButton();

  // 進捗ピップ（6種）
  const py = 30, sx = W / 2 - 5 * 8;
  for (let i = 0; i < INGREDIENTS.length; i++) {
    const dx = sx + i * 16;
    const done = i < game.poured, cur = i === game.ingIndex && !game.completing;
    g.fillStyle = done ? INGREDIENTS[i].color : 'rgba(255,255,255,0.2)';
    g.beginPath(); g.arc(dx, py, cur ? 4 : 3, 0, Math.PI * 2); g.fill();
    if (cur) { g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.arc(dx, py, 5.5, 0, Math.PI * 2); g.stroke(); }
  }

  // 現在の食材名（丼と手元の間）：最初は「盛り付けスタート」、最後の具は「最後は○○」
  if (!game.completing) {
    const name = currentIng().name;
    const label = game.poured === 0 ? '盛り付けスタート！'
      : game.poured === INGREDIENTS.length - 1 ? '最後は ' + name + '！'
      : 'つぎは ' + name + '！';
    drawText(label, W / 2, 160, 11, '#ffd23f', 'center', true);
  }
}

function drawAimScene() {
  if (game.dragging) drawTrajectory();
  // 台座
  g.fillStyle = '#2a1f14'; g.fillRect(CONFIG.ANCHOR_X - 16, CONFIG.ANCHOR_Y + 4, 32, 5);
  drawIngredient(currentIng(), game.food.x, game.food.y);

  if (!game.dragging && !game.firstThrowDone) {
    const pulse = 0.45 + Math.sin(game.elapsed * 5) * 0.4;
    g.save(); g.globalAlpha = clamp(pulse + 0.15, 0, 1);
    drawText('上へすばやくフリック！', CONFIG.ANCHOR_X, CONFIG.ANCHOR_Y - 40, 10, '#fff', 'center', true);
    g.restore();
  }
}

function drawFlyScene() {
  const ing = currentIng();
  // 残像（古いほど薄く・小さく）でスピード感を出す
  const tr = game.proj.trail;
  for (let i = 0; i < tr.length - 1; i++) {
    g.save();
    g.globalAlpha = (i + 1) / tr.length * 0.3;
    drawIngredient(ing, tr[i].x, tr[i].y, tr[i].s * 0.92);
    g.restore();
  }
  // 本体（奥行き縮小は最高到達点で固定）
  drawIngredient(ing, game.proj.x, game.proj.y, game.proj.scale);
}

function drawPlay() {
  drawBowl();
  // 受け口の補助表示（青バー・着弾ゴースト）は視覚ノイズになるため非表示。丼の見た目で位置を判断。
  if (game.inFlash > 0) drawInFlash();
  if (game.phase === 'aim') drawAimScene();
  else if (game.phase === 'fly') drawFlyScene();
  drawParticles();
  drawToasts();
  drawHUD();
  // 残り10秒：脈動する赤いふちでラストスパートの緊張を演出
  if (game.timeLeft <= 10 && game.timeLeft > 0) {
    const p = 0.22 + Math.abs(Math.sin(game.elapsed * 6)) * 0.4;
    g.save();
    g.strokeStyle = `rgba(255,58,40,${p})`;
    g.lineWidth = 6;
    g.strokeRect(3, 3, W - 6, H - 6);
    g.restore();
  }
  if (game.flash > 0) { g.fillStyle = `rgba(255,255,255,${game.flash * 0.55})`; g.fillRect(0, 0, W, H); }
}

function drawTitle() {
  const logo = asset('title_logo.png');
  if (logo && logo.ready) {
    g.drawImage(logo.img, ri(W / 2 - 80), 32, 160, 72);
  } else {
    // 習字風の2行タイトル「一分の / 冷やしたぬき」。
    drawText('一分の', W / 2, 42, 20, '#fffef6', 'center', true, FONT_BRUSH);
    drawText('冷やしたぬき', W / 2, 76, 24, '#fffef6', 'center', true, FONT_BRUSH);
  }
  drawSprite('bowl_done.png', W / 2, 162, CONFIG.BOWL_SIZE, CONFIG.BOWL_SIZE, () => {
    const sx = game.bowl.x, sy = game.bowl.y, sp = game.poured, sc = game.completing, ss = game.bowl.scale;
    game.bowl.x = W / 2; game.bowl.y = 162; game.poured = INGREDIENTS.length; game.completing = true; game.bowl.scale = 1;
    drawBowl();
    game.bowl.x = sx; game.bowl.y = sy; game.poured = sp; game.completing = sc; game.bowl.scale = ss;
  });

  drawStartButton(startRect(), Math.floor(game.elapsed * 2) % 2 === 0);
  // 下部：ハイスコア（情報）→ ランキング（導線）を余白を取って縦に並べる
  drawText('ハイスコア  ' + game.hiscore + ' 杯', W / 2, 280, 11, '#fff', 'center', true);
  drawNavButton(rankingRect(), 'ランキング', 'right');
  drawNavButton(howtoRect(), 'あそびかた', 'right');
  drawMuteButton();
}

// 完成杯数 → 職人ランク（60秒のテンポで上位称号も狙える閾値に）
// スコア＝完成杯＋コンボのボーナス杯
function totalBowls() { return game.bowls + game.bonusBowls; }

// 職人ランクの梯子（細分化）。提供数 z（完成＋ボーナス）で判定。閾値はボーナス杯導入後の到達分布で校正。
function rankFor(z) {
  // 馴染みやすい段位（腕前が上がっていく実感）。提供数で昇格。
  if (z >= 16) return '伝説のたぬき';
  if (z >= 12) return '名人';
  if (z >= 9) return '達人';
  if (z >= 6) return 'ベテラン';
  if (z >= 4) return '一人前';
  if (z >= 2) return 'かけだし';
  return '見習い';
}

// 次の職人ランクまで「あと何杯」か（継続動機の可視化）。最高ランクなら max=true。
function nextRankInfo(z) {
  const ths = [2, 4, 6, 9, 12, 16]; // rankFor の昇格しきい値
  for (let i = 0; i < ths.length; i++) { if (z < ths[i]) return { need: ths[i] - z, max: false }; }
  return { need: 0, max: true };
}

// 結果のランクバッジ。★付きで描き、長い称号はプレート幅を広げ文字を自動縮小して収める。
function drawRankBadge(rank, cy) {
  const label = '★ ' + rank + ' ★';
  let size = 15;
  g.font = '700 ' + size + 'px ' + FONT_UI;
  const maxW = W - 44; // カード内に収まる最大文字幅
  const tw0 = g.measureText(label).width;
  if (tw0 > maxW) size = 15 * maxW / tw0;
  g.font = '700 ' + size + 'px ' + FONT_UI;
  const plW = Math.min(W - 36, g.measureText(label).width + 16);
  const plX = W / 2 - plW / 2, plY = cy - 11;
  g.fillStyle = 'rgba(255,210,90,0.10)'; roundRectPath(plX, plY, plW, 22, 7); g.fill();
  g.strokeStyle = 'rgba(224,163,54,0.7)'; g.lineWidth = 1; roundRectPath(plX, plY, plW, 22, 7); g.stroke();
  drawText(label, W / 2, cy, size, '#ffd23f', 'center', true);
}

function drawResult() {
  // 暗幕＋中央カード。情報を「数(主役・特大)→ランク(★バッジ)→サブ統計(小)」と階層化し、
  // 余白を配分してメリハリ・可読性を確保（同サイズの文章が続く“壁”を解消）。
  g.fillStyle = 'rgba(0,0,0,0.62)'; g.fillRect(0, 0, W, H);

  // 中央カード＝情報パネル。全国ランキングの枠と「幅・上位置」を統一（cardX12 / cardY26 / cardW W-24）。
  const cardX = 12, cardY = 26, cardW = W - 24, cardH = 246;
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.45)'; roundRectPath(cardX, cardY + 4, cardW, cardH, 12); g.fill();
  const cg = g.createLinearGradient(0, cardY, 0, cardY + cardH);
  cg.addColorStop(0, '#2b1b0e'); cg.addColorStop(1, '#1b1009');
  g.fillStyle = cg; roundRectPath(cardX, cardY, cardW, cardH, 12); g.fill();
  roundRectPath(cardX, cardY, cardW, cardH, 12); g.clip();
  const bw = asset('bowl_done.png');
  if (bw && bw.ready) { g.globalAlpha = 0.06; g.drawImage(bw.img, ri(W / 2 - 58), 112, 116, 116); g.globalAlpha = 1; }
  g.restore();
  g.strokeStyle = '#caa24a'; g.lineWidth = 2; roundRectPath(cardX, cardY, cardW, cardH, 12); g.stroke();
  g.strokeStyle = 'rgba(255,236,180,0.22)'; g.lineWidth = 1; roundRectPath(cardX + 3, cardY + 3, cardW - 6, cardH - 6, 9); g.stroke();

  const z = totalBowls();

  // 見出し（タイムアップ！は維持。下線は距離・太さで読みやすく）
  drawText('タイムアップ！', W / 2, cardY + 17, 18, '#ffd23f', 'center', true);
  g.strokeStyle = 'rgba(202,162,74,0.6)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(cardX + 14, cardY + 31); g.lineTo(cardX + cardW - 14, cardY + 31); g.stroke();

  // ① 提供数 → 大数字（主役）→ 内訳。ラベルは杯数に少し近づける（見出し下げ）。
  drawText('提供数', W / 2, cardY + 45, 11, '#f2dca8', 'center', true);
  drawText(z + ' 杯', W / 2, cardY + 68, 34, '#fff', 'center', true);
  if (game.bonusBowls > 0) {
    drawText('完成 ' + game.bowls + ' 杯＋ボーナス ' + game.bonusBowls + ' 杯', W / 2, cardY + 94, 10, '#f0d6a0', 'center', true);
  }

  // ② 職人ランク群（内訳の次）。全体を上げて、下の「登録」ボタンとの間隔を広く取る。
  drawText('職人ランク', W / 2, cardY + 122, 11, '#f2dca8', 'center', true);
  drawRankBadge(rankFor(z), cardY + 144);
  const nr = nextRankInfo(z);
  if (nr.max) drawText('最高ランク到達！', W / 2, cardY + 166, 10, '#ffce7a', 'center', false);
  else drawText('次のランクまで あと ' + nr.need + ' 杯', W / 2, cardY + 166, 10, '#e0c79a', 'center', false);

  // ランキングに登録：タイトルの「ランキング」ボタンと同じ体裁（暗い下地＋金枠＋金の▶＋金文字）。送信状態でラベル可変。
  const rr = registerRect();
  const sending = game.submit.phase === 'sending';
  let regLabel = 'ランキングに登録';
  if (sending) regLabel = '送信中…';
  else if (game.submit.phase === 'done' || game.myEntryId) regLabel = 'ランキングを見る';
  else if (game.submit.phase === 'error') regLabel = '登録に失敗・再試行';
  const rrad = Math.min(5, rr.h / 2);
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.4)'; roundRectPath(rr.x, rr.y + 1, rr.w, rr.h, rrad); g.fill();
  g.fillStyle = 'rgba(28,18,10,0.82)'; roundRectPath(rr.x, rr.y, rr.w, rr.h, rrad); g.fill();
  g.strokeStyle = '#e0a336'; g.lineWidth = 1; roundRectPath(rr.x, rr.y, rr.w, rr.h, rrad); g.stroke();
  g.restore();
  const rcy = rr.y + rr.h / 2;
  g.font = '700 12px ' + FONT_UI;
  const rtw = g.measureText(regLabel).width, raw = 7, rgp = 6;
  const groupW = sending ? rtw : (raw + rgp + rtw);
  let rtx = Math.round(rr.x + (rr.w - groupW) / 2);
  if (!sending) {
    g.fillStyle = '#e0a336';
    g.beginPath(); g.moveTo(rtx, rcy - 4); g.lineTo(rtx, rcy + 4); g.lineTo(rtx + raw, rcy); g.closePath(); g.fill();
    rtx += raw + rgp;
  }
  drawText(regLabel, rtx + rtw / 2, rcy, 12, '#ffe9a8', 'center', true);

  // ③ これまでのハイスコア／ベスト更新は「登録ボタンの下」のフッターへ（自己ベスト＝補足）。下にしっかり余白を残す。
  if (game.newRecord) {
    const hsBlink = Math.floor(game.elapsed * 3) % 2 === 0;
    drawText('★ ベスト更新！ ★', W / 2, cardY + 226, 10, hsBlink ? '#ff6a6a' : '#ffd23f', 'center', true);
  } else {
    drawText('これまでのハイスコア ' + game.hiscore + ' 杯', W / 2, cardY + 226, 10, '#e6cda0', 'center', false);
  }

  // 枠外（カードの下・暗幕上）＝もう一度あそぶ（主役・最下部）
  drawRetryButton(retryRect(), Math.floor(game.elapsed * 2) % 2 === 0);

  // 左上：トップへ戻る（◀）＋右上：ミュート。タイトルの遊び方と同じ体裁。
  drawNavButton(backRect(), 'トップへ', 'left');
  drawMuteButton();
}

/* =====================================================================
   オンライン全国ランキング（Supabase REST / fetch のみ・外部ライブラリ不使用）
   config.js の window.RANKING を読む。未設定や通信失敗でもゲーム本体は壊さない。
   ===================================================================== */
function rankCfg() { return window.RANKING || {}; }
function rankingEnabled() { const c = rankCfg(); return !!(c.url && c.anonKey); }
function rankBase() { const c = rankCfg(); return String(c.url).replace(/\/+$/, '') + '/rest/v1/' + (c.table || 'scores'); }
function rankHeaders(extra) {
  const c = rankCfg();
  return Object.assign({ apikey: c.anonKey, Authorization: 'Bearer ' + c.anonKey, 'Content-Type': 'application/json' }, extra || {});
}

// ランキング画面の縦スクロール状態（100位までドラッグ/ホイールで見る）。rankMaxScroll は描画側で更新。
let rankScroll = 0, rankDragging = false, rankLastY = 0, rankDragPid = null, rankMaxScroll = 0;
// 未設定時の「登録プレビュー」（保存はしないが、登録の流れと自分の行をサンプル内に見せる）
let rankPreview = null;

function openRanking(from) {
  game.rankFrom = from || STATE.TITLE;
  game.state = STATE.RANKING;
  game.elapsed = 0;
  rankScroll = 0; rankDragging = false; // 先頭から表示
  fetchTopScores();
  scheduleResize(); // 軽い保険のみ。キーボード収納後の複数回resizeは closeNameEntry に集約（連打で点滅させない）
}

// 未設定時にレイアウトをプレビューできるサンプル（実データではない）。100位までのスクロール確認用に100件。
const SAMPLE_RANKING = (function () {
  const base = ['たぬきめいじん', 'そば次郎', 'ねぎだく大盛', 'あげ太郎', 'わさび', 'てんかす', 'つゆだく', 'ぎふの民', 'はやてのコック', 'まかないマン',
    'ぬき子', 'どんぶり王', 'れんぞく職人', 'ミスゼロ', 'おかわり', 'むぎゅ', 'そばずき', 'コンボ太郎', 'ゆうしゃ', 'ねこまんま',
    'たぬ吉', 'もりもり', 'スピード狂', 'のんびり屋', 'ラスト1秒'];
  const out = [];
  for (let i = 0; i < 100; i++) {
    out.push({ id: -(i + 1), name: base[i % base.length], score: Math.max(0, 28 - Math.floor(i * 0.27)), combo: Math.max(0, 26 - Math.floor(i * 0.27)) });
  }
  return out;
})();

let rankReqSeq = 0; // 取得リクエストの世代。古い応答が新しい状態を上書きしないよう最新だけ反映する。
function fetchTopScores() {
  // 未設定（config.js未入力）なら、空ではなくサンプルを見せてレイアウトを確認できるようにする
  if (!rankingEnabled()) {
    let rows = SAMPLE_RANKING;
    if (rankPreview) rows = SAMPLE_RANKING.concat([rankPreview]).sort((a, b) => (b.score - a.score) || (b.combo - a.combo)); // 登録プレビューをスコア順に差し込む
    game.ranking = { phase: 'ok', sample: true, rows: rows, error: '' };
    return;
  }
  const myReq = ++rankReqSeq;
  game.ranking = { phase: 'loading', rows: [], error: '' };
  const c = rankCfg();
  const url = rankBase() + '?select=id,name,score,combo,created_at&order=score.desc,created_at.asc&limit=' + (c.topN || 20);
  fetch(url, { headers: rankHeaders() })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((rows) => { if (myReq !== rankReqSeq) return; game.ranking = { phase: 'ok', rows: Array.isArray(rows) ? rows : [], error: '' }; })
    .catch((e) => { if (myReq !== rankReqSeq) return; game.ranking = { phase: 'error', rows: [], error: String((e && e.message) || e) }; });
}

function submitScore(name) {
  if (game.submit.phase === 'sending') return; // 送信中の二重登録を防止
  if (!rankingEnabled()) {
    // 未設定：保存はしないが、登録の流れをプレビュー（自分の行をサンプルに差し込み・ハイライト表示）
    rankPreview = { id: -999, name: name, score: game.lastScore | 0, combo: game.maxCombo | 0, you: true };
    game.submit = { phase: 'done', error: '' };
    openRanking(STATE.RESULT);
    return;
  }
  game.submit = { phase: 'sending', error: '' };
  track('ranking_register', { score: game.lastScore | 0, combo: game.maxCombo | 0 }); // GA4: ランキング登録（送信時。名前はPIIのため送らない）
  const body = JSON.stringify({ name: name, score: game.lastScore | 0, combo: game.maxCombo | 0 });
  fetch(rankBase(), { method: 'POST', headers: rankHeaders({ Prefer: 'return=representation' }), body })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((rows) => {
      const row = (rows && rows[0]) || null;
      game.myEntryId = row ? row.id : null;
      game.submit = { phase: 'done', error: '' };
      openRanking(STATE.RESULT); // 送信後そのままランキングへ
    })
    .catch((e) => { game.submit = { phase: 'error', error: String((e && e.message) || e) }; });
}

// 結果画面「ランキングに登録」タップ：未登録なら名前入力、登録済みなら一覧へ
function onRegisterTap() {
  if (game.submit.phase === 'sending') return; // 送信中はタップ無視（二重登録防止）
  if (game.submit.phase === 'done' || game.myEntryId) { openRanking(STATE.RESULT); return; }
  openNameEntry(); // 未設定でも名前入力を出して「登録の流れ」を見せる（保存はプレビュー）
}

/* 名前入力（DOMの一時モーダル＝スマホのキーボードが出る）。要素は index.html に常設し hidden で切替。 */
const nameModal = document.getElementById('nameModal');
const nameInput = document.getElementById('nameInput');
function openNameEntry() {
  if (!nameModal || !nameInput) { submitScore('ゲスト'); return; } // 念のためのフォールバック
  nameInput.value = lsGet(RANKING_NAME_KEY) || '';
  nameModal.hidden = false;
  setTimeout(() => { try { nameInput.focus(); nameInput.select(); } catch (_) {} }, 30);
}
function closeNameEntry() {
  if (nameInput) { try { nameInput.blur(); } catch (_) {} } // キーボードを確実に閉じる
  if (nameModal) nameModal.hidden = true;
  scheduleResizeAfterKeyboard(); // iOS: キーボード収納後にcanvasが縮んだままになるのを復帰
}
function confirmNameEntry() {
  if (!nameInput) return;
  const v = (nameInput.value || '').trim().replace(/\s+/g, ' ').slice(0, 12);
  if (!v) { try { nameInput.focus(); } catch (_) {} return; }
  lsSet(RANKING_NAME_KEY, v);
  closeNameEntry();
  submitScore(v);
}
(function wireNameEntry() {
  const ok = document.getElementById('nameOk');
  const cancel = document.getElementById('nameCancel');
  if (ok) ok.addEventListener('click', confirmNameEntry);
  if (cancel) cancel.addEventListener('click', closeNameEntry);
  if (nameInput) nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmNameEntry(); } });
})();

// ランキング画面
function drawRanking() {
  g.fillStyle = 'rgba(0,0,0,0.66)'; g.fillRect(0, 0, W, H);
  const cardX = 12, cardY = 26, cardW = W - 24, cardH = 276;
  const cg = g.createLinearGradient(0, cardY, 0, cardY + cardH);
  cg.addColorStop(0, '#2b1b0e'); cg.addColorStop(1, '#1b1009');
  g.fillStyle = cg; roundRectPath(cardX, cardY, cardW, cardH, 12); g.fill();
  g.strokeStyle = '#caa24a'; g.lineWidth = 2; roundRectPath(cardX, cardY, cardW, cardH, 12); g.stroke();

  drawText('全国ランキング', W / 2, cardY + 16, 15, '#ffd23f', 'center', true);
  g.strokeStyle = 'rgba(202,162,74,0.45)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(cardX + 16, cardY + 30); g.lineTo(cardX + cardW - 16, cardY + 30); g.stroke();

  const rk = game.ranking;
  let rowsTopY = cardY + 46;
  if (rk.phase === 'loading') {
    drawText('読み込み中…', W / 2, cardY + 120, 11, '#d8bd90', 'center', false);
  } else if (rk.phase === 'error') {
    drawText('読み込めませんでした', W / 2, cardY + 116, 11, '#ff9a6a', 'center', false);
    drawText('通信状態や設定を確認してください', W / 2, cardY + 134, 9, '#d8bd90', 'center', false);
  } else if (rk.phase === 'ok' && !rk.rows.length) {
    drawText('まだ記録がありません', W / 2, cardY + 118, 11, '#d8bd90', 'center', false);
    drawText('いちばんに登録しよう！', W / 2, cardY + 136, 10, '#8ef0a0', 'center', false);
  } else if (rk.phase === 'ok') {
    if (rk.sample) { drawText('※ サンプル表示（未設定）', W / 2, cardY + 42, 9, '#ffb86a', 'center', false); rowsTopY = cardY + 60; }
    // 縦スクロール：リスト領域でクリップし、可視行だけ描画（100位までドラッグ/ホイールで見られる）
    const rowH = 18;
    const listTop = rowsTopY - 10;          // クリップ上端
    const listBottom = cardY + cardH - 24;   // 「あなた」行の上まで
    const viewH = listBottom - listTop;
    const totalH = rk.rows.length * rowH;
    const maxScroll = Math.max(0, totalH - viewH);
    rankMaxScroll = maxScroll;                      // 入力側のclamp用に共有
    rankScroll = clamp(rankScroll, 0, maxScroll);   // 入力で動かした値をここで正規化
    const sc = rankScroll;
    const nameMaxW = cardW - 92;             // 順位＋杯数＋スクロールバーぶんを除く
    g.save();
    g.beginPath(); g.rect(cardX + 4, listTop, cardW - 8, viewH); g.clip();
    const first = Math.max(0, Math.floor(sc / rowH));
    const last = Math.min(rk.rows.length, Math.ceil((sc + viewH) / rowH) + 1);
    for (let i = first; i < last; i++) {
      const row = rk.rows[i];
      const ry = rowsTopY + i * rowH - sc;   // baseline(middle)
      const mine = !!row.you || (game.myEntryId != null && row.id === game.myEntryId);
      if (mine) { g.fillStyle = 'rgba(255,210,90,0.18)'; roundRectPath(cardX + 7, ry - 9, cardW - 20, rowH - 1, 4); g.fill(); }
      const col = mine ? '#ffe9a8' : '#fff2c5';
      // 1〜3位は金・銀・銅のメダル円つきで特別扱い
      const numX = cardX + 16;
      if (i < 3) {
        const medal = ['#ffd23f', '#dfe7ee', '#e3a368'][i];
        g.globalAlpha = 0.20; g.fillStyle = medal; g.beginPath(); g.arc(numX, ry, 8.5, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
        g.strokeStyle = medal; g.lineWidth = 1.2; g.beginPath(); g.arc(numX, ry, 8.5, 0, Math.PI * 2); g.stroke();
        drawText(String(i + 1), numX, ry, 12, medal, 'center', true);
      } else {
        drawText(String(i + 1), numX, ry, 11, '#caa24a', 'center', true);
      }
      let nm = String(row.name || '？');
      g.font = '700 12px ' + FONT_UI;
      while (nm.length > 1 && g.measureText(nm).width > nameMaxW) nm = nm.slice(0, -1);
      drawText(nm, cardX + 30, ry, 12, col, 'left', mine);
      drawText((row.score | 0) + '杯', cardX + cardW - 16, ry, 12, col, 'right', true);
    }
    g.restore();
    // スクロールバー（右端）
    if (maxScroll > 0) {
      const barX = cardX + cardW - 8, barTop = listTop + 2, trackH = viewH - 4;
      g.fillStyle = 'rgba(255,255,255,0.12)'; roundRectPath(barX, barTop, 3, trackH, 1.5); g.fill();
      const thumbH = Math.max(16, trackH * viewH / totalH);
      const thumbY = barTop + (trackH - thumbH) * (sc / maxScroll);
      g.fillStyle = 'rgba(255,210,90,0.75)'; roundRectPath(barX, thumbY, 3, thumbH, 1.5); g.fill();
    }
  }

  // 下部：プレビュー登録済みなら自分の順位、サンプルのみなら設定案内、実データなら自分のスコア（圏外でも必ず見える）
  if (rk.sample && rankPreview) {
    const idx = rk.rows.findIndex((r) => r.you);
    const rk2 = idx >= 0 ? (idx + 1) + '位  ' : '';
    let pnm = String(rankPreview.name);
    if (pnm.length > 8) pnm = pnm.slice(0, 8); // 下部に収める
    drawText('あなた ' + rk2 + pnm + ' ' + rankPreview.score + '杯（未保存）', W / 2, cardY + cardH - 13, 10, '#ffd23f', 'center', true);
  } else if (rk.sample) {
    drawText('config.js を設定すると実データに', W / 2, cardY + cardH - 13, 9, '#b7a98c', 'center', false);
  } else if (game.lastScore > 0) {
    let myRank = 0;
    if (game.myEntryId != null && rk.rows) { const idx = rk.rows.findIndex((r) => r.id === game.myEntryId); if (idx >= 0) myRank = idx + 1; }
    const nm = lsGet(RANKING_NAME_KEY) || '—';
    const txt = myRank > 0 ? ('あなた  ' + myRank + '位  ' + nm + '  ' + game.lastScore + '杯')
                           : ('あなた  ' + nm + '  ' + game.lastScore + '杯');
    drawText(txt, W / 2, cardY + cardH - 13, 10, '#ffd23f', 'center', true);
  }

  drawNavButton(backRectRanking(), 'もどる', 'left');
  drawMuteButton();
}

/* =====================================================================
   メインループ
   ===================================================================== */
let lastTime = 0;
function frame(now) {
  // 何が起きても次フレームは必ず予約する（1回の例外で恒久停止しないための保険）
  try {
    if (!lastTime) lastTime = now;
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.05) dt = 0.05;

    if (game.state === STATE.PLAY) updatePlay(dt);
    else game.elapsed += dt; // タイトル/結果の演出用
    updateEffects(dt);
    Sound.schedule();

    // --- バッファへ描画 ---
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, W, H);
    g.save();
    if (game.shake > 0) g.translate(rand(-game.shake, game.shake), rand(-game.shake, game.shake));
    drawBackground();
    if (game.state === STATE.TITLE) drawTitle();
    else if (game.state === STATE.PLAY) drawPlay();
    else if (game.state === STATE.RESULT) drawResult();
    else drawRanking();
    g.restore();

    // --- 表示canvasへ一括拡大 ---
    present();
  } catch (e) {
    if (window.console) console.error(e);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 遊び方ページの「あそぶ」ボタン（index.html?play）から来た場合はタイトルを飛ばして即プレイ開始。
// 音はブラウザ仕様で最初の操作（フリック等）まで鳴らないが、その操作で自動解錠される。
if (new URLSearchParams(location.search).get('play') === '1') {
  startGame(true); // autoStarted=true：ユーザー操作前なので音声初期化は遅延
  // ?play は一度きり消費。URLに残るとリロードで再度即開始してしまうため index.html に正規化。
  try { if (history.replaceState) history.replaceState(null, '', location.pathname); } catch (e) {}
}
