// main.js
let audioContext;
let recentNotes = [];

async function startAudio() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.audioWorklet.addModule('processor.js');

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioContext.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(audioContext, 'audio-processor');

    node.port.onmessage = (e) => {
        const data = e.data; // Float32Array
        const f0 = detectF0(data); // ここで周波数解析
        const note = findClosestStringFret(f0);
        if (note) updateGUI(f0, note.string, note.fret);
    };

    source.connect(node).connect(audioContext.destination);
}

// ここに既存の detectF0 / findClosestStringFret / updateGUI を統合
// app.js から関数をコピーする形でOK

document.getElementById('start-btn').addEventListener('click', startAudio);
