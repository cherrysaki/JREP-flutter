// 集中モニター（all2.py のブラウザ移植版）
// カメラ映像から 瞬き・集中判定・眠気・離席・姿勢・脈波（心拍/血圧推定）を計測し、
// 60秒ごとに GAS（スプレッドシート）へ送信、集中判定を Flutter 側へコールバックする。
import {
  FaceLandmarker,
  FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs';
import { butterBandpass, filtfilt, computeAllCyclesFeatures, calcHrFft } from './dsp.js';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// ==============================================================
// 設定（all2.py と同じ値）
// ==============================================================
const SEND_INTERVAL = 60;
const BLINK_WINDOW_SEC = 60;
const BLINK_FALSE_THRESHOLD = 10;
const DROWSY_WINDOW_SEC = 30;
const EAR_DROWSY_THRESHOLD = 0.19;
const ABSENCE_THRESHOLD_SEC = 10.0;
const NOT_FOCUSED_NOTIFY_DELAY_SEC = 120.0;
const NOT_FOCUSED_NOTIFY_COOLDOWN_SEC = 600.0;
const FACE_CLOSE_AREA_RATIO_THRESHOLD = 0.2;
const FACE_CLOSE_NOTIFY_DELAY_SEC = 20.0;
const FACE_CLOSE_NOTIFY_COOLDOWN_SEC = 3600.0;
const FRAME_INTERVAL_MS = 33; // all2.py の frame_timer と同じ（約30fps）

// Iris モデルの 71 点の目輪郭に対応する Face Mesh のランドマーク番号
// （Upper0/Lower0/Upper1/Lower1/Upper2/Lower2/Lower3/EyebrowUpper/EyebrowLower）
const RIGHT_EYE_71 = [
  246, 161, 160, 159, 158, 157, 173, 33, 7, 163, 144, 145, 153, 154, 155, 133, 247, 30, 29, 27,
  28, 56, 190, 130, 25, 110, 24, 23, 22, 26, 112, 243, 113, 225, 224, 223, 222, 221, 189, 226,
  31, 228, 229, 230, 231, 232, 233, 244, 143, 111, 117, 118, 119, 120, 121, 128, 245, 156, 70,
  63, 105, 66, 107, 55, 193, 35, 124, 46, 53, 52, 65,
];
const LEFT_EYE_71 = [
  466, 388, 387, 386, 385, 384, 398, 263, 249, 390, 373, 374, 380, 381, 382, 362, 467, 260, 259,
  257, 258, 286, 414, 359, 255, 339, 254, 253, 252, 256, 341, 463, 342, 445, 444, 443, 442, 441,
  413, 446, 261, 448, 449, 450, 451, 452, 453, 464, 372, 340, 346, 347, 348, 349, 350, 357, 465,
  383, 300, 293, 334, 296, 336, 285, 417, 265, 353, 276, 283, 282, 295,
];
const IRIS_A = [468, 469, 470, 471, 472];
const IRIS_B = [473, 474, 475, 476, 477];

// ==============================================================
// 瞬き・視線（all2.py: BlinkStateMachine をそのまま移植）
// ==============================================================
class BlinkStateMachine {
  constructor({
    calibSec = 3.0,
    minSamples = 30,
    kClose = 2.0,
    kOpen = 1.2,
    minCloseFrames = 1,
    maxCloseFrames = 18,
    smoothAlpha = 0.45,
    adaptAlpha = 0.01,
    initCloseTh = 0.33,
    initOpenTh = 0.35,
  } = {}) {
    Object.assign(this, {
      calibSec, minSamples, kClose, kOpen, minCloseFrames, maxCloseFrames,
      smoothAlpha, adaptAlpha, initCloseTh, initOpenTh,
    });
    this.state = 'OPEN';
    this.closeFrames = 0;
    this.earSmooth = null;
    this.calibStarted = null;
    this.calibDone = false;
    this.calibSamples = [];
    this.openSamples = [];
    this.openMean = null;
    this.openVar = null;
    this.closeTh = initCloseTh;
    this.openTh = initOpenTh;
    this.calibHint = '目を開いた状態で待ってください';
    this.guidedPhase = 'OPEN_HOLD';
    this.tempOpenStd = null;
    this.tempCloseTh = null;
    this.tempOpenTh = null;
    this.slowCloseFrames = 0;
    this.slowCloseMin = null;
    this.closedMin = null;
    this.blinkGap = null;
  }

  _adaptOpenLevel(ear, alpha = null) {
    if (this.openMean === null || this.openVar === null) return;
    alpha = alpha === null ? this.adaptAlpha : alpha;
    const delta = ear - this.openMean;
    this.openMean = (1 - alpha) * this.openMean + alpha * ear;
    this.openVar = (1 - alpha) * this.openVar + alpha * (delta * delta);
    this._refreshThresholds();
  }

  _robustMeanStd(arr) {
    if (arr.length === 0) return [null, null];
    const lo = percentile(arr, 10);
    const hi = percentile(arr, 90);
    const x = arr.filter((v) => v >= lo && v <= hi);
    if (x.length === 0) return [null, null];
    const m = mean(x);
    const sd = Math.sqrt(mean(x.map((v) => (v - m) ** 2)));
    return [m, Math.max(sd, 1e-3)];
  }

  _refreshThresholds() {
    if (this.openMean === null || this.openVar === null) return;
    if (this.blinkGap !== null) {
      const gap = Math.max(this.blinkGap, 0.03);
      this.closeTh = this.openMean - 0.4 * gap;
      this.openTh = this.openMean - 0.22 * gap;
    } else {
      const sd = Math.sqrt(Math.max(this.openVar, 1e-6));
      this.closeTh = this.openMean - Math.max(this.kClose * sd, 0.025);
      this.openTh = this.openMean - Math.max(this.kOpen * sd, 0.015);
    }
    if (this.openTh <= this.closeTh + 1e-4) this.openTh = this.closeTh + 1e-4;
  }

  // 戻り値: [blinkEvent, calibDone, calibHint]
  update(earNow, now) {
    if (earNow === null || earNow === undefined) return [false, this.calibDone, this.calibHint];
    this.earSmooth =
      this.earSmooth === null
        ? earNow
        : (1 - this.smoothAlpha) * this.earSmooth + this.smoothAlpha * earNow;

    if (this.calibStarted === null) this.calibStarted = now;
    if (!this.calibDone) {
      const elapsed = now - this.calibStarted;
      this.calibSamples.push(this.earSmooth);

      if (this.guidedPhase === 'OPEN_HOLD') {
        this.openSamples.push(this.earSmooth);
        const remain = Math.max(0, this.calibSec - elapsed);
        this.calibHint = `目を開いた状態で待つ ${remain.toFixed(1)}s`;
        if (elapsed >= this.calibSec && this.openSamples.length >= this.minSamples) {
          const [m, sd] = this._robustMeanStd(this.openSamples);
          if (m !== null && sd !== null) {
            this.openMean = m;
            this.tempOpenStd = sd;
            this.openVar = sd * sd;
            this.tempCloseTh = this.openMean - Math.max(1.0 * sd, 0.02);
            this.tempOpenTh = this.openMean - Math.max(0.5 * sd, 0.01);
            this.guidedPhase = 'SLOW_BLINK';
            this.slowCloseFrames = 0;
            this.slowCloseMin = null;
            this.calibHint = 'ゆっくり1回閉じて開いてください';
          }
        }
        return [false, this.calibDone, this.calibHint];
      }

      if (this.guidedPhase === 'SLOW_BLINK') {
        this.calibHint = 'ゆっくり1回閉じて開いてください';
        if (this.earSmooth < this.tempCloseTh) {
          this.slowCloseFrames += 1;
          this.slowCloseMin =
            this.slowCloseMin === null ? this.earSmooth : Math.min(this.slowCloseMin, this.earSmooth);
        } else if (this.slowCloseFrames > 0 && this.earSmooth > this.tempOpenTh) {
          if (this.slowCloseFrames >= this.minCloseFrames && this.slowCloseMin !== null) {
            const gap = Math.max(this.openMean - this.slowCloseMin, 0.02);
            this.closedMin = this.slowCloseMin;
            this.blinkGap = gap;
            this._refreshThresholds();
            this.calibDone = true;
            this.state = 'OPEN';
            this.closeFrames = 0;
            this.calibHint = '校正完了';
          }
          this.slowCloseFrames = 0;
          this.slowCloseMin = null;
        }
        // ガイド校正が長引いた場合は自動しきい値へフォールバック
        if (!this.calibDone && elapsed >= 12.0 && this.openMean !== null) {
          this._refreshThresholds();
          this.calibDone = true;
          this.calibHint = '校正完了(自動)';
        }
        return [false, this.calibDone, this.calibHint];
      }
    }

    let blinkEvent = false;
    if (this.state === 'OPEN') {
      if (this.earSmooth < this.closeTh) {
        this.state = 'CLOSED';
        this.closeFrames = 1;
      } else if (this.openMean !== null && this.earSmooth > this.openTh) {
        this._adaptOpenLevel(this.earSmooth);
      }
    } else {
      this.closeFrames += 1;
      if (this.earSmooth > this.openTh) {
        if (this.minCloseFrames <= this.closeFrames && this.closeFrames <= this.maxCloseFrames) {
          blinkEvent = true;
        }
        this.state = 'OPEN';
        this.closeFrames = 0;
      } else if (this.closeFrames > this.maxCloseFrames) {
        this._adaptOpenLevel(this.earSmooth, 0.08);
        this.state = 'OPEN';
        this.closeFrames = 0;
      }
    }
    this.calibHint = '校正完了';
    return [blinkEvent, this.calibDone, this.calibHint];
  }
}

// ==============================================================
// 補助関数（all2.py の同名関数を移植）
// ==============================================================
function mean(a) {
  return a.reduce((s, v) => s + v, 0) / a.length;
}

// numpy.percentile（linear 補間）
function percentile(arr, q) {
  const s = [...arr].sort((x, y) => x - y);
  const pos = ((s.length - 1) * q) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

// all2.py: compute_eye_metrics（pts / iris はピクセル座標 [x, y] の配列）
function computeEyeMetrics(pts, iris, prevGaze) {
  if (!pts || pts.length === 0) return {};
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const xMax = Math.max(...xs);
  const xMin = Math.min(...xs);
  const yMax = Math.max(...ys);
  const yMin = Math.min(...ys);
  const eyeWidth = xMax - xMin;
  if (eyeWidth <= 1e-6) return {};
  const center = [(xMax + xMin) / 2, (yMax + yMin) / 2];
  const upper = pts.filter((p) => p[1] < center[1]);
  const lower = pts.filter((p) => p[1] >= center[1]);
  if (upper.length === 0 || lower.length === 0) return { center, eyeWidth };
  const ear = (mean(lower.map((p) => p[1])) - mean(upper.map((p) => p[1]))) / eyeWidth;
  if (!iris || iris.length === 0) return { ear, center, eyeWidth };
  const ic = [mean(iris.map((p) => p[0])), mean(iris.map((p) => p[1]))];
  const gaze = [(ic[0] - center[0]) / eyeWidth, (ic[1] - center[1]) / eyeWidth];
  const speed = prevGaze ? Math.hypot(gaze[0] - prevGaze[0], gaze[1] - prevGaze[1]) : 0.0;
  return { ear, gaze, speed, center, eyeWidth };
}

function formatDurationMmss(total) {
  total = Math.max(0, Math.trunc(total));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function localTimestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
}

const nowSec = () => Date.now() / 1000;

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

// ==============================================================
// UI
// ==============================================================
const STYLE = `
.jm-root{box-sizing:border-box;width:100%;height:100%;overflow-y:auto;padding:8px;
  font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif;color:#222;
  -webkit-overflow-scrolling:touch}
.jm-root *{box-sizing:border-box}
.jm-wrap{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start}
.jm-left{flex:1 1 320px;min-width:0}
.jm-right{flex:1 1 280px;min-width:0;display:flex;flex-direction:column;gap:8px}
.jm-video{position:relative;width:100%;aspect-ratio:4/3;background:#111;border-radius:12px;overflow:hidden}
.jm-video video{display:none}
.jm-video canvas{width:100%;height:100%;object-fit:contain;transform:scaleX(-1);display:block}
.jm-video.blink{outline:6px solid #E53935;outline-offset:-6px}
.jm-overlay{position:absolute;left:0;right:0;bottom:0;padding:8px 10px;background:rgba(0,0,0,.6);
  color:#fff;font-size:14px;line-height:1.4;text-align:center}
.jm-overlay:empty{display:none}
.jm-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:10px;color:#fff;text-align:center;padding:16px;font-size:14px}
.jm-center:empty{display:none}
.jm-btn{appearance:none;border:none;border-radius:10px;padding:10px 16px;font-size:15px;font-weight:600;
  background:#1976D2;color:#fff;cursor:pointer}
.jm-btn:disabled{background:#9e9e9e;cursor:default}
.jm-btn.sub{background:#fff;color:#1976D2;border:1px solid #1976D2;padding:6px 12px;font-size:13px}
.jm-status{font-size:13px;color:#555;min-height:1.4em}
.jm-focus{font-size:22px;font-weight:700;text-align:center;padding:8px;border-radius:10px;background:#fff}
.jm-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.jm-card{background:#fff;border-radius:10px;padding:6px 8px;text-align:center}
.jm-card .t{font-size:11px;color:#666}
.jm-card .v{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
.jm-card .u{font-size:11px;color:#888;margin-left:2px}
.jm-vpg{background:#fff;border-radius:10px;padding:8px}
.jm-vpg canvas{width:100%;height:60px;display:block}
.jm-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:13px}
.jm-row input{width:64px;padding:4px 6px;font-size:14px;border:1px solid #bbb;border-radius:6px}
.jm-small{font-size:11px;color:#777}
.jm-banner{border-radius:10px;padding:8px 10px;font-size:14px;font-weight:600;background:#FFF3E0;color:#E65100}
.jm-banner:empty{display:none}
`;

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.appendChild(c);
  return e;
}

function card(title, unit, color) {
  const v = el('span', { class: 'v', text: '-' });
  if (color) v.style.color = color;
  const c = el('div', { class: 'jm-card' }, [
    el('div', { class: 't', text: title }),
    el('div', {}, [v, el('span', { class: 'u', text: unit })]),
  ]);
  return { c, v };
}

// ==============================================================
// モニタ本体
// ==============================================================
class FocusMonitor {
  constructor() {
    this.landmarker = null;
    this.landmarkerPromise = null;
    this.stream = null;
    this.running = false;
    this.opts = null;
    this.worker = null;
    this.wakeLock = null;
    this._buildUi();
  }

  // ---------------- UI 構築 ----------------
  _buildUi() {
    if (!document.getElementById('jm-style')) {
      document.head.appendChild(el('style', { id: 'jm-style', text: STYLE }));
    }
    this.video = el('video', { playsinline: '', muted: '', autoplay: '' });
    this.video.muted = true;
    this.canvas = el('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.roiCanvas = document.createElement('canvas');
    this.roiCtx = this.roiCanvas.getContext('2d', { willReadFrequently: true });
    this.overlay = el('div', { class: 'jm-overlay' });
    this.center = el('div', { class: 'jm-center' });
    this.videoBox = el('div', { class: 'jm-video' }, [this.video, this.canvas, this.overlay, this.center]);

    this.statusEl = el('div', { class: 'jm-status' });
    this.focusEl = el('div', { class: 'jm-focus', text: '-' });
    this.banner = el('div', { class: 'jm-banner' });

    const cards = {
      blinkTotal: card('瞬き合計', '回'),
      blinkWindow: card(`瞬き(${BLINK_WINDOW_SEC}s)`, '回'),
      blinkRate: card('瞬き率', '/分'),
      drowsy: card('眠気率', '%', '#7E57C2'),
      absenceCount: card('離席回数', '回', '#EF6C00'),
      absenceTime: card('離席時間', '', '#EF6C00'),
      seated: card('在席率', '%'),
      totalTime: card('計測時間', ''),
      focusedTime: card('集中時間', '', '#2E7D32'),
      hr: card('心拍数', 'bpm', '#E53935'),
      bp: card('血圧(推定)', 'mmHg', '#E65100'),
      facePos: card('顔位置 X / Y', ''),
    };
    this.cards = Object.fromEntries(Object.entries(cards).map(([k, v]) => [k, v.v]));
    const grid = el('div', { class: 'jm-grid' }, Object.values(cards).map((x) => x.c));

    this.vpgCanvas = el('canvas', { width: '600', height: '120' });
    this.vpgParams = el('div', { class: 'jm-small', text: 'a:-  b:-  d:-' });
    this.sbpInput = el('input', { type: 'number', min: '70', max: '200', value: '115' });
    this.dbpInput = el('input', { type: 'number', min: '40', max: '130', value: '75' });
    this.calibBtn = el('button', { class: 'jm-btn sub', text: '🎯 VPG校正' });
    this.calibBtn.disabled = true;
    this.calibBtn.addEventListener('click', () => this._onCalibClick());
    const vpg = el('div', { class: 'jm-vpg' }, [
      el('div', { class: 'jm-small', text: '脈波（VPG）' }),
      this.vpgCanvas,
      this.vpgParams,
      el('div', { class: 'jm-row' }, [
        el('span', { text: '基準 SBP' }),
        this.sbpInput,
        el('span', { text: 'DBP' }),
        this.dbpInput,
        this.calibBtn,
      ]),
      el('div', {
        class: 'jm-small',
        text: '※心拍数・血圧はカメラ映像からの簡易推定であり、医療機器としての測定値ではありません。',
      }),
    ]);

    this.notifyBtn = el('button', { class: 'jm-btn sub', text: '🔔 デスクトップ通知を許可' });
    this.notifyBtn.addEventListener('click', async () => {
      try {
        await Notification.requestPermission();
      } catch (_) {}
      this._refreshNotifyBtn();
    });
    this._refreshNotifyBtn();

    const tip = el('div', {
      class: 'jm-small',
      text:
        'このページ（タブ）は開いたままにしてください。PCで作業するときは、このウィンドウを閉じたり最小化したりせず、作業用のアプリや別ウィンドウを横に並べてください。',
    });

    this.root = el('div', { class: 'jm-root' }, [
      el('div', { class: 'jm-wrap' }, [
        el('div', { class: 'jm-left' }, [this.videoBox, this.statusEl, tip]),
        el('div', { class: 'jm-right' }, [this.focusEl, this.banner, grid, vpg, this.notifyBtn]),
      ]),
    ]);
  }

  _refreshNotifyBtn() {
    const show = typeof Notification !== 'undefined' && Notification.permission === 'default';
    this.notifyBtn.style.display = show ? '' : 'none';
  }

  mount(container) {
    container.appendChild(this.root);
  }

  _showCenter(message, buttonLabel, onClick) {
    this.center.replaceChildren();
    if (!message) return;
    this.center.appendChild(el('div', { text: message }));
    if (buttonLabel) {
      const b = el('button', { class: 'jm-btn', text: buttonLabel });
      b.addEventListener('click', onClick);
      this.center.appendChild(b);
    }
  }

  _setStatus(text) {
    this.statusEl.textContent = text;
  }

  // ---------------- 初期化 ----------------
  _loadLandmarker() {
    if (this.landmarkerPromise) return this.landmarkerPromise;
    this.landmarkerPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const make = (delegate) =>
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
        });
      try {
        this.landmarker = await make('GPU');
      } catch (e) {
        console.warn('GPU delegate unavailable, falling back to CPU', e);
        this.landmarker = await make('CPU');
      }
      return this.landmarker;
    })();
    this.landmarkerPromise.catch(() => {
      this.landmarkerPromise = null;
    });
    return this.landmarkerPromise;
  }

  _resetState() {
    // VPG
    this.vpgRoi = null;
    this.lastRoiUpdate = 0;
    this.timeBuf = [];
    this.gBuf = [];
    this.maxBufferSec = 6.0;
    this.coef = { alpha: 18.0, beta: -12.0, gamma: 0.25, delta: 10.0, epsilon: -6.0, zeta: 0.15 };
    this.isCalibrated = false;
    this.baseRb = 0.0;
    this.baseRd = 0.0;
    this.baseHr = 60.0;
    this.baseSbp0 = 115.0;
    this.baseDbp0 = 75.0;
    this.batchHr = [];
    this.batchSys = [];
    this.batchDia = [];
    this.batchSize = 10;
    this.lastTRel = null;
    this.lastG2 = null;
    this._lastHr = null;
    this._lastRb = 0.0;
    this._lastRd = 0.0;
    this.latestHr = null;
    this.latestSbp = null;
    this.latestDbp = null;
    // 虹彩・瞬き
    this.leftBlinker = new BlinkStateMachine();
    this.rightBlinker = new BlinkStateMachine();
    this.prevLeftGaze = null;
    this.prevRightGaze = null;
    this.blinkTotal = 0;
    this.blinkTimes = [];
    this.lastBlinkEventTime = null;
    this.faceX = null;
    this.faceY = null;
    this.distFromCenter = null;
    this.faceAreaRatio = null;
    this.drowsyFlags = [];
    this.latestDrowsyRatio = 0.0;
    this.absenceCount = 0;
    this.absenceStartTime = null;
    this.absenceActive = false;
    this.totalAbsenceSec = 0.0;
    this.sessionStartTime = nowSec();
    this.seatedPercentage = 100.0;
    this.focusedTimeSec = 0.0;
    this.lastFocusEvalTime = this.sessionStartTime;
    this.notFocusedSince = null;
    this.lastBreakNotificationTime = null;
    this.faceTooCloseSince = null;
    this.lastFaceCloseNotificationTime = null;
    this.postureWarningActive = false;
    this.lastVpgAnalysis = 0;
    this.lastFrameMs = 0;
    this.lastVideoTime = -1;
  }

  // ---------------- 起動 / 停止 ----------------
  async start(opts) {
    if (this.running) await this.stop({ sendFinal: true });
    this.opts = opts || {};
    this.subjectId = (this.opts.subjectId || '').trim() || 'unknown';
    this.banner.textContent = '';
    this._setStatus('準備中…');
    this._showCenter('カメラと解析モデルを準備しています…');
    try {
      const [stream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        }),
        this._loadLandmarker(),
      ]);
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
    } catch (e) {
      console.error(e);
      this._stopStream();
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      const noCam = e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError');
      const msg = denied
        ? 'カメラの使用が許可されていません。ブラウザのアドレスバーのカメラアイコンから許可して、もう一度お試しください。'
        : noCam
          ? 'カメラが見つかりません。接続を確認してください。'
          : 'カメラを開始できませんでした。';
      this._setStatus(msg);
      this._showCenter(msg, 'カメラを開始', () => this.start(this.opts));
      return false;
    }
    this._showCenter('');
    this._resetState();
    this.running = true;
    this.calibBtn.disabled = false;
    this.calibBtn.textContent = '🎯 VPG校正';
    this._setStatus('瞬き校正中...');
    this._startTicker();
    this._acquireWakeLock();
    return true;
  }

  async stop({ sendFinal = true } = {}) {
    if (!this.running) return;
    this.running = false;
    this._stopTicker();
    const now = nowSec();
    this._finalizeAbsenceTracking(now);
    if (sendFinal) this._sendGas(true);
    this._stopStream();
    this.calibBtn.disabled = true;
    this.faceAreaRatio = null;
    this.postureWarningActive = false;
    this._releaseWakeLock();
    this._setStatus('停止');
    this.overlay.textContent = '';
    this._showCenter('停止中');
  }

  _stopStream() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  // バックグラウンドのタブでも止まりにくいよう、Worker のタイマーで駆動する
  _startTicker() {
    this._stopTicker();
    const src = `setInterval(()=>postMessage('f'),${FRAME_INTERVAL_MS});setInterval(()=>postMessage('g'),${
      SEND_INTERVAL * 1000
    });`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    this.worker = new Worker(url);
    URL.revokeObjectURL(url);
    this.worker.onmessage = (ev) => {
      if (!this.running) return;
      if (ev.data === 'g') this._sendGas(false);
      else this._onFrame();
    };
  }

  _stopTicker() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
  }

  async _acquireWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (_) {}
    if (!this._visHandler) {
      this._visHandler = () => {
        if (this.running && document.visibilityState === 'visible') this._acquireWakeLock();
      };
      document.addEventListener('visibilitychange', this._visHandler);
    }
  }

  _releaseWakeLock() {
    try {
      if (this.wakeLock) this.wakeLock.release();
    } catch (_) {}
    this.wakeLock = null;
  }

  // ---------------- フレーム処理 ----------------
  _onFrame() {
    const v = this.video;
    if (!this.landmarker || v.readyState < 2 || !v.videoWidth) return;
    const ms = performance.now();
    if (ms - this.lastFrameMs < FRAME_INTERVAL_MS - 3) return;
    if (v.currentTime === this.lastVideoTime) return;
    this.lastFrameMs = ms;
    this.lastVideoTime = v.currentTime;

    const W = v.videoWidth;
    const H = v.videoHeight;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const ctx = this.ctx;
    ctx.drawImage(v, 0, 0, W, H);

    let result = null;
    try {
      result = this.landmarker.detectForVideo(v, ms);
    } catch (e) {
      console.warn(e);
    }
    const lm = result && result.faceLandmarks && result.faceLandmarks[0];
    const pts = lm ? lm.map((p) => [p.x * W, p.y * H]) : null;

    this._processVpg(pts, W, H);
    this._processIris(pts, W, H);

    const t = nowSec();
    if (t - this.lastVpgAnalysis >= 1.0) {
      this.lastVpgAnalysis = t;
      this._runVpgAnalysis();
    }
  }

  // ---------------- VPG ----------------
  _processVpg(pts, W, H) {
    this._autoUpdateRoi(pts, W, H);
    if (!this.vpgRoi) return;
    const [x, y, w, h] = this.vpgRoi;
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgb(76,175,80)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    if (this.roiCanvas.width !== w || this.roiCanvas.height !== h) {
      this.roiCanvas.width = w;
      this.roiCanvas.height = h;
    }
    this.roiCtx.drawImage(this.video, x, y, w, h, 0, 0, w, h);
    const data = this.roiCtx.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 1; i < data.length; i += 4) sum += data[i];
    const n = data.length / 4;
    if (n > 0) {
      this.timeBuf.push(nowSec());
      this.gBuf.push(sum / n);
      while (this.timeBuf.length > 2 && this.timeBuf[this.timeBuf.length - 1] - this.timeBuf[0] > this.maxBufferSec) {
        this.timeBuf.shift();
        this.gBuf.shift();
      }
      this._updateVpgPlot();
    }
  }

  // all2.py は Haar 顔検出の矩形の (0.70w, 0.50h) 付近＝画像右側の頬を ROI にしている。
  // ここでは同じ頬の位置（Face Mesh 425 番）を中心に、顔幅・高さの 7% の領域を使う。
  _autoUpdateRoi(pts, W, H) {
    if (nowSec() - this.lastRoiUpdate < 0.5) return;
    if (pts) {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      let fw = Math.max(Math.trunc(w * 0.07), 5);
      let fh = Math.max(Math.trunc(h * 0.07), 5);
      let fx = Math.trunc(pts[425][0] - fw / 2);
      let fy = Math.trunc(pts[425][1] - fh / 2);
      fx = Math.max(0, Math.min(fx, W - 1));
      fy = Math.max(0, Math.min(fy, H - 1));
      fw = Math.min(fw, W - fx);
      fh = Math.min(fh, H - fy);
      if (fw > 0 && fh > 0) this.vpgRoi = [fx, fy, fw, fh];
    } else if (this.vpgRoi === null) {
      const cx = Math.trunc(W / 2);
      const cy = Math.trunc(H / 2);
      this.vpgRoi = [cx - 25, cy - 25, 50, 50];
    }
    this.lastRoiUpdate = nowSec();
  }

  _updateVpgPlot() {
    if (this.timeBuf.length < 10) return;
    const t0 = this.timeBuf[0];
    const tRel = this.timeBuf.map((v) => v - t0);
    let dt = 0;
    for (let i = 1; i < tRel.length; i++) dt += tRel[i] - tRel[i - 1];
    dt /= tRel.length - 1;
    if (dt <= 0) return;
    let g2;
    try {
      const nyq = 0.5 / dt;
      if (nyq <= 3.0) return;
      const { b, a } = butterBandpass(4, 0.75 / nyq, 3.0 / nyq);
      g2 = filtfilt(b, a, this.gBuf).map((v) => -v);
    } catch (_) {
      return;
    }
    const m = mean(g2);
    const sd = Math.sqrt(mean(g2.map((v) => (v - m) ** 2)));
    const g2n = sd > 1e-6 ? g2.map((v) => (v - m) / sd) : g2.map((v) => v - m);
    const c = this.vpgCanvas;
    const cx = c.getContext('2d');
    cx.clearRect(0, 0, c.width, c.height);
    cx.strokeStyle = '#00897B';
    cx.lineWidth = 3;
    cx.beginPath();
    const tMax = tRel[tRel.length - 1] || 1;
    g2n.forEach((v, i) => {
      const px = (tRel[i] / tMax) * c.width;
      const py = c.height / 2 - (Math.max(-3, Math.min(3, v)) / 3) * (c.height / 2);
      if (i === 0) cx.moveTo(px, py);
      else cx.lineTo(px, py);
    });
    cx.stroke();
    this.lastTRel = tRel;
    this.lastG2 = g2;
  }

  _runVpgAnalysis() {
    if (this.lastTRel === null) return;
    const fftHr = calcHrFft(this.lastTRel, this.lastG2);
    if (fftHr === null) return;
    const currentHr = Math.trunc(fftHr);
    const results = computeAllCyclesFeatures(this.lastTRel, this.lastG2);
    if (!results.length) return;
    const seg = results[results.length - 1];
    const { a_val: a, b_val: b, d_val: d, ratio_b_a: rb, ratio_d_a: rd } = seg;
    this._lastHr = currentHr;
    this._lastRb = rb;
    this._lastRd = rd;
    const baseRb = this.isCalibrated ? this.baseRb : rb;
    const baseRd = this.isCalibrated ? this.baseRd : rd;
    const baseHr = this.isCalibrated ? this.baseHr : currentHr;
    const drb = rb - baseRb;
    const drd = rd - baseRd;
    const dhr = currentHr - baseHr;
    const c = this.coef;
    const estSys = this.baseSbp0 + c.alpha * drb + c.beta * drd + c.gamma * dhr;
    const estDia = this.baseDbp0 + c.delta * drb + c.epsilon * drd + c.zeta * dhr;
    if (!(estSys > 50 && estSys < 250) || !(estDia > 30 && estDia < 150) || estSys <= estDia + 10) return;
    this.batchHr.push(currentHr);
    this.batchSys.push(estSys);
    this.batchDia.push(estDia);
    const blinkReady = this.leftBlinker.calibDone && this.rightBlinker.calibDone;
    if (blinkReady) {
      this._setStatus(
        this.isCalibrated
          ? `VPG測定中(${this.batchHr.length}/${this.batchSize})`
          : '🎯 VPG校正ボタンを押してください（任意）'
      );
    }
    if (this.batchHr.length >= this.batchSize) {
      const tm = (data) => {
        if (data.length <= 2) return mean(data);
        const s = [...data].sort((x, y) => x - y);
        return mean(s.slice(1, -1));
      };
      this.latestHr = Math.trunc(tm(this.batchHr));
      this.latestSbp = Math.trunc(tm(this.batchSys));
      this.latestDbp = Math.trunc(tm(this.batchDia));
      this.cards.bp.textContent = `${this.latestSbp}/${this.latestDbp}`;
      this.cards.bp.style.color = this.latestSbp > 140 ? '#E53935' : '#E65100';
      this.cards.hr.textContent = String(this.latestHr);
      this.batchHr = [];
      this.batchSys = [];
      this.batchDia = [];
      if (blinkReady) this._setStatus('✅ VPG測定完了');
    }
    this.vpgParams.textContent = `a:${(a || 0).toFixed(3)}  b:${(b || 0).toFixed(3)}  d:${(d || 0).toFixed(3)}`;
  }

  _onCalibClick() {
    if (!this.running) return;
    if (this._lastHr === null) {
      alert('データ不足。しばらく待ってください。');
      return;
    }
    const sbp = parseFloat(this.sbpInput.value);
    const dbp = parseFloat(this.dbpInput.value);
    this.calibrateVpg(Number.isFinite(sbp) ? sbp : 115, Number.isFinite(dbp) ? dbp : 75);
    alert(`校正完了\nSBP:${Math.trunc(this.baseSbp0)}  DBP:${Math.trunc(this.baseDbp0)}  HR:${this.baseHr}`);
  }

  calibrateVpg(sbp, dbp) {
    if (this._lastHr === null) return false;
    this.baseSbp0 = sbp;
    this.baseDbp0 = dbp;
    this.baseHr = this._lastHr;
    this.baseRb = this._lastRb;
    this.baseRd = this._lastRd;
    this.isCalibrated = true;
    this.calibBtn.textContent = '✅ 校正済み';
    return true;
  }

  // ---------------- 在席・集中時間 ----------------
  _updateSessionPresenceMetrics(now) {
    const absence = this._currentAbsenceTotal(now);
    const elapsed = Math.max(0, now - this.sessionStartTime);
    if (elapsed <= 0) {
      this.seatedPercentage = 100.0;
      return;
    }
    const seated = Math.max(0, elapsed - absence);
    this.seatedPercentage = Math.max(0, Math.min(100, (seated / elapsed) * 100));
  }

  _currentAbsenceTotal(now) {
    let total = this.totalAbsenceSec;
    if (this.absenceActive && this.absenceStartTime !== null) total += Math.max(0, now - this.absenceStartTime);
    return total;
  }

  _currentSessionElapsed(now) {
    return Math.max(0, now - this.sessionStartTime);
  }

  _handleFacePresent(now) {
    if (this.absenceActive && this.absenceStartTime !== null) {
      this.totalAbsenceSec += now - this.absenceStartTime;
      this.absenceActive = false;
      this.absenceStartTime = null;
    } else if (this.absenceStartTime !== null && !this.absenceActive) {
      this.absenceStartTime = null;
    }
    this._updateSessionPresenceMetrics(now);
  }

  _handleFaceAbsent(now) {
    if (this.absenceStartTime === null) this.absenceStartTime = now;
    else if (!this.absenceActive && now - this.absenceStartTime >= ABSENCE_THRESHOLD_SEC) {
      this.absenceCount += 1;
      this.absenceActive = true;
    }
    this._updateSessionPresenceMetrics(now);
  }

  _finalizeAbsenceTracking(now) {
    if (this.absenceActive && this.absenceStartTime !== null) {
      this.totalAbsenceSec += now - this.absenceStartTime;
      this.absenceActive = false;
      this.absenceStartTime = null;
    }
    this._updateSessionPresenceMetrics(now);
  }

  _updateFocusedTime(now, isFocused, calibReady, faceDetected) {
    if (this.lastFocusEvalTime === null) {
      this.lastFocusEvalTime = now;
      return;
    }
    const delta = Math.max(0, now - this.lastFocusEvalTime);
    this.lastFocusEvalTime = now;
    if (calibReady && faceDetected && isFocused) this.focusedTimeSec += delta;
  }

  // ---------------- 通知（all2.py の osascript 通知の置き換え） ----------------
  _notify(title, message) {
    this.banner.textContent = `${title}：${message}`;
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => {
      this.banner.textContent = '';
    }, 30000);
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body: message });
      }
    } catch (_) {}
  }

  _updateFocusNotification(now, isFocused, calibReady) {
    if (!calibReady || isFocused) {
      this.notFocusedSince = null;
      return;
    }
    if (this.notFocusedSince === null) {
      this.notFocusedSince = now;
      return;
    }
    const sustained = now - this.notFocusedSince;
    const cooldownOk =
      this.lastBreakNotificationTime === null ||
      now - this.lastBreakNotificationTime >= NOT_FOCUSED_NOTIFY_COOLDOWN_SEC;
    if (sustained >= NOT_FOCUSED_NOTIFY_DELAY_SEC && cooldownOk) {
      this.lastBreakNotificationTime = now;
      this._notify('集中モニター', '集中が下がっています。少し休憩しましょう。');
    }
  }

  _updateFaceCloseNotification(now, ratio, faceDetected) {
    if (!faceDetected || ratio === null || ratio < FACE_CLOSE_AREA_RATIO_THRESHOLD) {
      this.faceTooCloseSince = null;
      this.postureWarningActive = false;
      return;
    }
    if (this.faceTooCloseSince === null) {
      this.faceTooCloseSince = now;
      this.postureWarningActive = false;
      return;
    }
    const sustained = now - this.faceTooCloseSince;
    this.postureWarningActive = sustained >= FACE_CLOSE_NOTIFY_DELAY_SEC;
    const cooldownOk =
      this.lastFaceCloseNotificationTime === null ||
      now - this.lastFaceCloseNotificationTime >= FACE_CLOSE_NOTIFY_COOLDOWN_SEC;
    if (sustained >= FACE_CLOSE_NOTIFY_DELAY_SEC && cooldownOk) {
      this.lastFaceCloseNotificationTime = now;
      this._notify('姿勢リマインド', '顔が近いかもしれません。少し画面から離れましょう。');
    }
  }

  // ---------------- 虹彩・瞬き ----------------
  _processIris(pts, W, H) {
    const now = nowSec();
    while (this.blinkTimes.length && this.blinkTimes[0] < now - BLINK_WINDOW_SEC) this.blinkTimes.shift();

    let blinkWindow = this.blinkTimes.length;
    const rate = blinkWindow * (60.0 / BLINK_WINDOW_SEC);
    const isFocused = blinkWindow < BLINK_FALSE_THRESHOLD;
    const absenceTotal = this._currentAbsenceTotal(now);
    const sessionElapsed = this._currentSessionElapsed(now);

    let calibReady = this.leftBlinker.calibDone && this.rightBlinker.calibDone;
    const faceDetected = !!pts;
    this._updateFocusedTime(now, isFocused, calibReady, faceDetected);
    const ctx = this.ctx;
    let overlayText = '';

    if (faceDetected) {
      this._handleFacePresent(now);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      // all2.py: get_face_center_xy / compute_face_xy / compute_face_area_ratio
      const cx = Math.trunc(mean(xs));
      const cy = Math.trunc(mean(ys));
      this.faceX = (cx - W / 2) / (W / 2);
      this.faceY = (cy - H / 2) / (H / 2);
      this.distFromCenter = Math.hypot(this.faceX, this.faceY);
      const fw = Math.max(...xs) - Math.min(...xs);
      const fh = Math.max(...ys) - Math.min(...ys);
      this.faceAreaRatio = fw > 1e-6 && fh > 1e-6 ? (fw * fh) / (W * H) : null;

      const eyeL = LEFT_EYE_71.map((i) => pts[i]);
      const eyeR = RIGHT_EYE_71.map((i) => pts[i]);
      let irisL = null;
      let irisR = null;
      if (pts.length >= 478) {
        const ia = IRIS_A.map((i) => pts[i]);
        const ib = IRIS_B.map((i) => pts[i]);
        // 目の中心に近い方の虹彩を割り当てる
        const cL = pts[386];
        const da = Math.hypot(ia[0][0] - cL[0], ia[0][1] - cL[1]);
        const db = Math.hypot(ib[0][0] - cL[0], ib[0][1] - cL[1]);
        [irisL, irisR] = db < da ? [ib, ia] : [ia, ib];
      }
      const l = computeEyeMetrics(eyeL, irisL, this.prevLeftGaze);
      const [lbEv, lCalib, lHint] = this.leftBlinker.update(l.ear ?? null, now);
      this.prevLeftGaze = l.gaze || null;
      const r = computeEyeMetrics(eyeR, irisR, this.prevRightGaze);
      const [rbEv, rCalib, rHint] = this.rightBlinker.update(r.ear ?? null, now);
      this.prevRightGaze = r.gaze || null;

      const ears = [l.ear, r.ear].filter((v) => v !== undefined && v !== null);
      if (ears.length) {
        const avg = mean(ears);
        this.drowsyFlags.push([now, avg < EAR_DROWSY_THRESHOLD ? 1 : 0]);
      }
      while (this.drowsyFlags.length && this.drowsyFlags[0][0] < now - DROWSY_WINDOW_SEC) this.drowsyFlags.shift();
      this.latestDrowsyRatio = this.drowsyFlags.length ? mean(this.drowsyFlags.map((f) => f[1])) : 0.0;

      const canCount = this.lastBlinkEventTime === null || now - this.lastBlinkEventTime >= 0.25;
      if (lCalib && rCalib && (lbEv || rbEv) && canCount) {
        this.lastBlinkEventTime = now;
        this.blinkTotal += 1;
        this.blinkTimes.push(now);
        blinkWindow += 1;
        this.videoBox.classList.add('blink');
        clearTimeout(this._blinkFlash);
        this._blinkFlash = setTimeout(() => this.videoBox.classList.remove('blink'), 120);
      }

      // 描画：虹彩（緑）・目輪郭（青）・視線矢印
      ctx.fillStyle = 'rgb(0,255,0)';
      for (const p of [...(irisL || []), ...(irisR || [])]) ctx.fillRect(p[0] - 1, p[1] - 1, 2, 2);
      ctx.fillStyle = 'rgb(0,0,255)';
      for (const p of [...eyeL, ...eyeR]) ctx.fillRect(p[0] - 1, p[1] - 1, 2, 2);
      for (const [m, color] of [
        [l, 'rgb(0,255,0)'],
        [r, 'rgb(255,0,255)'],
      ]) {
        if (m.gaze && m.center && m.eyeWidth) drawArrow(ctx, m.center, m.gaze, m.eyeWidth, color);
      }

      calibReady = lCalib && rCalib;
      if (!calibReady) {
        const hint = !lCalib ? lHint : rHint;
        overlayText = `瞬き校正中：1) 3秒開眼で待機  2) ゆっくり1回閉眼→開眼\n${hint}`;
      }
    } else {
      this.faceAreaRatio = null;
      this._handleFaceAbsent(now);
      if (!calibReady) overlayText = '顔をカメラ中央に合わせてください';
      else overlayText = '顔が検出されていません';
    }
    this.overlay.textContent = overlayText;
    this.overlay.style.whiteSpace = 'pre-line';

    if (calibReady) {
      if (this.statusEl.textContent.startsWith('瞬き校正中')) this._setStatus('計測中...');
    } else {
      this._setStatus('瞬き校正中...');
    }

    this._updateFocusNotification(now, isFocused, calibReady);
    this._updateFaceCloseNotification(now, this.faceAreaRatio, faceDetected);

    // 表示更新
    const cards = this.cards;
    cards.blinkTotal.textContent = String(this.blinkTotal);
    cards.blinkWindow.textContent = String(blinkWindow);
    cards.blinkRate.textContent = rate.toFixed(1);
    cards.drowsy.textContent = (this.latestDrowsyRatio * 100).toFixed(0);
    cards.absenceCount.textContent = String(this.absenceCount);
    cards.absenceTime.textContent = formatDurationMmss(absenceTotal);
    cards.seated.textContent = this.seatedPercentage.toFixed(0);
    cards.totalTime.textContent = formatDurationMmss(sessionElapsed);
    cards.focusedTime.textContent = formatDurationMmss(this.focusedTimeSec);
    if (this.faceX !== null) {
      cards.facePos.textContent = `${fmtSigned(this.faceX)} / ${fmtSigned(this.faceY)}`;
    }
    if (calibReady) {
      this.focusEl.textContent = isFocused ? '集中しています' : '集中できていません';
      this.focusEl.style.color = isFocused ? '#2E7D32' : '#E53935';
    } else {
      this.focusEl.textContent = '瞬き校正中…';
      this.focusEl.style.color = '#555';
    }
  }

  // ---------------- GAS 送信 ----------------
  _sendGas(isFinal) {
    const now = nowSec();
    const absenceTotal = this._currentAbsenceTotal(now);
    const sessionElapsed = this._currentSessionElapsed(now);
    this._updateSessionPresenceMetrics(now);
    const ts = localTimestamp();
    while (this.blinkTimes.length && this.blinkTimes[0] < now - BLINK_WINDOW_SEC) this.blinkTimes.shift();
    const blinkWindow = this.blinkTimes.length;
    const rate = blinkWindow * (60.0 / BLINK_WINDOW_SEC);
    const isFocused = blinkWindow < BLINK_FALSE_THRESHOLD;
    const blinkReady = this.leftBlinker.calibDone && this.rightBlinker.calibDone;
    const sid = this.subjectId;
    const gasUrl = this.opts && this.opts.gasUrl;

    const post = (payload) => {
      if (!gasUrl) return;
      // GAS は CORS ヘッダーを返さないため no-cors（text/plain）で送る。doPost では e.postData.contents を JSON.parse する。
      fetch(gasUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch((e) => console.warn('POST error:', e));
    };
    post({ sheet: 'FocusStatus', timestamp: ts, isFocused, subjectId: sid });
    post({
      sheet: 'Face',
      timestamp: ts,
      subjectId: sid,
      isFocused,
      blinkTotal: this.blinkTotal,
      blinkRatePerMin: rate,
      faceX: this.faceX,
      faceY: this.faceY,
      distFromCenter: this.distFromCenter,
      faceAreaRatio: this.faceAreaRatio,
      postureWarning: this.postureWarningActive,
      blinkCalibrationReady: blinkReady,
      isFinal,
      drowsyRatio: this.latestDrowsyRatio,
      absenceCount: this.absenceCount,
      absenceTimeSec: round3(absenceTotal),
      seatedPercentage: round3(this.seatedPercentage),
      totalMeasurementTimeSec: round3(sessionElapsed),
      focusedTimeSec: round3(this.focusedTimeSec),
    });
    post({
      sheet: 'Vitals',
      timestamp: ts,
      subjectId: sid,
      heartRate: this.latestHr,
      systolicBP: this.latestSbp,
      diastolicBP: this.latestDbp,
    });

    try {
      if (this.opts && typeof this.opts.onFocusStatus === 'function') {
        this.opts.onFocusStatus(isFocused, isFinal);
      }
    } catch (e) {
      console.warn(e);
    }
    if (blinkReady) {
      const d = new Date();
      this._setStatus(`送信 ${d.toLocaleTimeString('ja-JP', { hour12: false })}`);
    }
  }
}

function fmtSigned(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(3);
}

function drawArrow(ctx, center, gaze, width, color) {
  const [x0, y0] = center;
  const x1 = x0 + gaze[0] * width;
  const y1 = y0 + gaze[1] * width;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.hypot(x1 - x0, y1 - y0) * 0.3;
  ctx.lineTo(x1 - len * Math.cos(ang - Math.PI / 6), y1 - len * Math.sin(ang - Math.PI / 6));
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - len * Math.cos(ang + Math.PI / 6), y1 - len * Math.sin(ang + Math.PI / 6));
  ctx.stroke();
}

// ==============================================================
// 公開 API（Flutter から dart:js_interop で呼び出す）
// ==============================================================
const monitor = new FocusMonitor();
window.JrepMonitor = {
  mount: (container) => monitor.mount(container),
  start: (opts) => monitor.start(opts),
  stop: () => monitor.stop({ sendFinal: true }),
  calibrateVpg: (sbp, dbp) => monitor.calibrateVpg(sbp, dbp),
  // モデルを先読みしてカメラ起動を速くする
  preload: () => monitor._loadLandmarker().then(() => true, () => false),
};
window.dispatchEvent(new Event('jrep-monitor-ready'));
