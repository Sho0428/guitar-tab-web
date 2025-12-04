// app.js (main logic)
(() => {
  // ==== 設定 ====
  const BLOCK = 2048;          // YIN に送るバッファ長
  const SAMPLE_RATE = 44100;   // 想定サンプリング（AudioContext.sampleRateを利用）
  const FMIN = 50;
  const FMAX = 800;

  const OPEN_STRINGS = [82.41, 110.00, 146.83, 196.00, 246.94, 329.63];

  const TOLERANCES = { 6:5, 5:5, 4:7, 3:10, 2:12, 1:15 };

  // ====== 追加：音量メーター処理 ======
  let rms = 0;
  for (let i = 0; i < buf.length; i++) {
      rms += buf[i] * buf[i];
  }
  rms = Math.sqrt(rms / buf.length);

  // 0.0〜1.0 で正規化してメーターに反映
  let volumePercent = Math.min(100, rms * 400);  // 400は感度調整
  document.getElementById("volume-bar").style.width = volumePercent + "%";
  // 周波数テーブル（6弦〜1弦, 0〜3フレット）
  const freqTable = [];
  for (let string = 6; string >= 1; string--) {
    const base = OPEN_STRINGS[6 - string];
    for (let fret = 0; fret <= 3; fret++) {
      freqTable.push({ string, fret, freq: base * Math.pow(2, fret / 12) });
    }
  }

  // UI 要素
  const freqLabel = document.getElementById('freq');
  const tabEl = document.getElementById('tab');
  const startBtn = document.getElementById('start-btn');
  const stopBtn = document.getElementById('stop-btn');

  // TAB 表示保持
  let tabLines = ["E|","A|","D|","G|","B|","E|"];

  function updateTAB(string, fret) {
    const idx = 6 - string;
    for (let i = 0; i < 6; i++) tabLines[i] += (i === idx ? fret : "-");
    tabEl.textContent = tabLines.map(l => l.slice(-30)).join("\n");
  }

  function findClosest(f0) {
    if (!f0) return null;
    const c = freqTable.reduce((a, b) => Math.abs(a.freq - f0) < Math.abs(b.freq - f0) ? a : b);
    if (Math.abs(c.freq - f0) > TOLERANCES[c.string]) return null;
    return c;
  }

  // ==== YIN 実装 ====
  // buffer: Float32Array (length = BLOCK)
  function yin(buffer, threshold = 0.15, sampleRate = SAMPLE_RATE) {
    const bufferSize = buffer.length;
    const tauMax = Math.min(Math.floor(sampleRate / FMIN), bufferSize - 1);
    const tauMin = Math.max(2, Math.floor(sampleRate / FMAX));

    const yinBuffer = new Float64Array(tauMax + 1);

    // difference function
    for (let t = tauMin; t <= tauMax; t++) {
      let sum = 0.0;
      for (let i = 0; i < bufferSize - t; i++) {
        const diff = buffer[i] - buffer[i + t];
        sum += diff * diff;
      }
      yinBuffer[t] = sum;
    }

    // cumulative mean normalized difference
    let runningSum = 0.0;
    for (let t = tauMin; t <= tauMax; t++) {
      runningSum += yinBuffer[t];
      yinBuffer[t] = yinBuffer[t] * t / runningSum;
    }

    // absolute threshold
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (yinBuffer[t] < threshold) {
        tau = t;
        break;
      }
    }
    if (tau === -1) return null;

    // parabolic interpolation for better precision
    if (tau + 1 <= tauMax && tau - 1 >= tauMin) {
      const x0 = yinBuffer[tau - 1];
      const x1 = yinBuffer[tau];
      const x2 = yinBuffer[tau + 1];
      const a = (x0 + x2 - 2 * x1) / 2;
      const b = (x2 - x0) / 2;
      if (a) tau = tau - b / (2 * a);
    }

    return sampleRate / tau;
  }

  // ==== AudioWorklet / バッファ処理 ====
  let audioContext = null;
  let workletNode = null;
  let mediaStream = null;

  // 小さなチャンク（128）で届くのでキューしてから BLOCK 長で処理する
  const ring = new Float32Array(BLOCK * 2); // 少し余裕
  let ringWrite = 0;
  let ringCount = 0;

  // 安定化：最近のノートを数えて確定する
  const recentNotes = [];
  const RECENT_MAX = 6;

  function pushToRing(chunk) {
    // chunk: Float32Array
    for (let i = 0; i < chunk.length; i++) {
      ring[ (ringWrite + i) % ring.length ] = chunk[i];
    }
    ringWrite = (ringWrite + chunk.length) % ring.length;
    ringCount = Math.min(ringCount + chunk.length, ring.length);
  }

  function readBlock() {
    // 最新 BLOCK サンプルを取り出す
    if (ringCount < BLOCK) return null;
    const out = new Float32Array(BLOCK);
    // start index:
    let start = (ringWrite - BLOCK + ring.length) % ring.length;
    for (let i = 0; i < BLOCK; i++) {
      out[i] = ring[(start + i) % ring.length];
    }
    // consume BLOCK (we'll allow overlap, so just decrease count by BLOCK/2 to have overlap)
    ringCount = Math.max(0, ringCount - Math.floor(BLOCK / 2));
    return out;
  }

  function handleIncomingChunk(chunk) {
    // chunk may be a Float32Array or regular Array
    const arr = (chunk instanceof Float32Array) ? chunk : Float32Array.from(chunk);
    pushToRing(arr);

    const block = readBlock();
    if (!block) return;

    const f0 = yin(block, 0.15, audioContext.sampleRate || SAMPLE_RATE);
    if (!f0 || isNaN(f0) || f0 <= 0) return;

    // UI update freq
    freqLabel.textContent = `${f0.toFixed(1)} Hz`;

    // find closest
    const n = findClosest(f0);
    if (!n) return;

    recentNotes.push(`${n.string}-${n.fret}`);
    if (recentNotes.length > RECENT_MAX) recentNotes.shift();

    // count occurrences
    const counts = {};
    for (const r of recentNotes) {
      counts[r] = (counts[r] || 0) + 1;
    }
    const best = Object.entries(counts).find(([k, v]) => v >= 3);
    if (!best) return;

    const [s, f] = best[0].split('-').map(Number);
    updateTAB(s, f);
  }

  // ==== start / stop ====
  async function startAudio() {
    if (audioContext) return;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();

      // load worklet
      await audioContext.audioWorklet.addModule('processor.js');

      // request mic
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // source
      const source = audioContext.createMediaStreamSource(mediaStream);

      // create node
      workletNode = new AudioWorkletNode(audioContext, 'audio-processor');

      // receive chunks from worklet
      workletNode.port.onmessage = (e) => {
        try {
          handleIncomingChunk(e.data);
        } catch (err) {
          console.error('handleIncomingChunk error:', err);
        }
      };

      // connect
      source.connect(workletNode);
      // Don't connect to destination loudly; keep very low playback or omit:
      // workletNode.connect(audioContext.destination);

      // UI
      startBtn.disabled = true;
      stopBtn.disabled = false;
      startBtn.textContent = '実行中…';
      startBtn.style.background = '#aa0000';
      startBtn.style.cursor = 'not-allowed';
    } catch (err) {
      console.error('startAudio error:', err);
      alert('マイクの初期化でエラーが発生しました。コンソールを確認してください。');
      cleanup();
    }
  }

  function stopAudio() {
    if (!audioContext) return;
    try {
      if (workletNode) {
        workletNode.port.onmessage = null;
        workletNode.disconnect?.();
        workletNode = null;
      }
      if (mediaStream) {
        const tracks = mediaStream.getTracks();
        tracks.forEach(t => t.stop());
        mediaStream = null;
      }
      audioContext.close?.();
    } catch (err) {
      console.warn('stopAudio warning:', err);
    } finally {
      cleanup();
    }
  }

  function cleanup() {
    audioContext = null;
    workletNode = null;
    ringWrite = 0;
    ringCount = 0;
    recentNotes.length = 0;

    startBtn.disabled = false;
    stopBtn.disabled = true;
    startBtn.textContent = '▶ 開始';
    startBtn.style.background = '#008000';
    startBtn.style.cursor = 'pointer';
  }

  // ==== イベントバインド ====
  startBtn.addEventListener('click', async () => {
    await startAudio();
  });
  stopBtn.addEventListener('click', () => {
    stopAudio();
  });

  // 初期 UI
  cleanup();
})();
