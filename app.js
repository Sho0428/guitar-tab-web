(() => {
  // ==== 設定 ====
  const BLOCK = 2048;
  const SAMPLE_RATE = 44100;
  const FMIN = 50;
  const FMAX = 800;

  const OPEN_STRINGS = [82.41, 110.00, 146.83, 196.00, 246.94, 329.63];
  const TOLERANCES = { 6:5, 5:5, 4:7, 3:10, 2:12, 1:15 };

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

  // ==== AudioWorklet + リングバッファ ====
  let audioContext = null;
  let workletNode = null;
  let mediaStream = null;

  const ring = new Float32Array(BLOCK * 2);
  let ringWrite = 0;
  let ringCount = 0;

  const recentNotes = [];
  const RECENT_MAX = 6;

  function pushToRing(chunk) {
    for (let i = 0; i < chunk.length; i++) {
      ring[(ringWrite + i) % ring.length] = chunk[i];
    }
    ringWrite = (ringWrite + chunk.length) % ring.length;
    ringCount = Math.min(ringCount + chunk.length, ring.length);
  }

  function readBlock() {
    if (ringCount < BLOCK) return null;
    const out = new Float32Array(BLOCK);
    let start = (ringWrite - BLOCK + ring.length) % ring.length;
    for (let i = 0; i < BLOCK; i++) {
      out[i] = ring[(start + i) % ring.length];
    }
    ringCount = Math.max(0, ringCount - Math.floor(BLOCK / 2));
    return out;
  }

  function handleIncomingChunk(chunk) {
    const arr = (chunk instanceof Float32Array) ? chunk : Float32Array.from(chunk);
    pushToRing(arr);

    const block = readBlock();
    if (!block) return;

    // ==== 音量計算 ====
    let rms = 0;
    for (let i = 0; i < block.length; i++) rms += block[i] ** 2;
    rms = Math.sqrt(rms / block.length);
    const volumePercent = Math.min(100, rms * 400);

    // 上部バー
    document.getElementById("volume-bar").style.width = volumePercent + "%";
    // 下部 VUメーター
    document.getElementById("vu-meter").style.width = volumePercent + "%";

    // ==== 周波数判定 ====
    const f0 = yin(block, 0.15, audioContext.sampleRate || SAMPLE_RATE);
    if (!f0 || isNaN(f0) || f0 <= 0) return;
    freqLabel.textContent = `${f0.toFixed(1)} Hz`;

    const n = findClosest(f0);
    if (!n) return;

    recentNotes.push(`${n.string}-${n.fret}`);
    if (recentNotes.length > RECENT_MAX) recentNotes.shift();

    const counts = {};
    for (const r of recentNotes) counts[r] = (counts[r] || 0) + 1;
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
      await audioContext.audioWorklet.addModule('processor.js');

      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = audioContext.createMediaStreamSource(mediaStream);
      workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
      workletNode.port.onmessage = (e) => handleIncomingChunk(e.data);

      source.connect(workletNode);
      // workletNode.connect(audioContext.destination); // 出力不要

      startBtn.disabled = true;
      stopBtn.disabled = false;
      startBtn.textContent = '実行中…';
      startBtn.style.background = '#aa0000';
      startBtn.style.cursor = 'not-allowed';
    } catch (err) {
      console.error(err);
      alert('マイクの初期化に失敗しました。コンソールを確認してください。');
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
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
      }
      audioContext.close?.();
    } catch (err) {
      console.warn(err);
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
  startBtn.addEventListener('click', startAudio);
  stopBtn.addEventListener('click', stopAudio);

  cleanup();
})();
