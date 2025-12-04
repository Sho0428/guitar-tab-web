const SAMPLE_RATE = 44100;
const FMIN = 50;
const FMAX = 800;
const BLOCK = 2048;

const OPEN_STRINGS = [82.41, 110.00, 146.83, 196.00, 246.94, 329.63];

let freqTable = [];
for (let string = 6; string >= 1; string--) {
    for (let fret = 0; fret <= 3; fret++) {
        let base = OPEN_STRINGS[6 - string];
        let freq = base * Math.pow(2, fret / 12);
        freqTable.push({ string, fret, freq });
    }
}

let tolerances = { 6:5, 5:5, 4:7, 3:10, 2:12, 1:15 };

let tab = ["E|","A|","D|","G|","B|","E|"];
let recent = [];

function updateTAB(string, fret) {
    let idx = 6 - string;
    for (let i = 0; i < 6; i++) {
        tab[i] += (i === idx ? fret : "-");
    }
    let txt = tab.map(line => line.slice(-30)).join("\n");
    document.getElementById("tab").textContent = txt;
}

function findClosest(f0) {
    let c = freqTable.reduce((a, b) => 
        Math.abs(a.freq - f0) < Math.abs(b.freq - f0) ? a : b
    );
    if (Math.abs(c.freq - f0) > tolerances[c.string]) return null;
    return c;
}

document.getElementById("start").onclick = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(BLOCK, 1, 1);

    src.connect(processor);
    processor.connect(ctx.destination);

    processor.onaudioprocess = (e) => {
        let buf = e.inputBuffer.getChannelData(0);
        let f0 = yin(buf, 0.15, SAMPLE_RATE);

        if (!f0 || f0 < FMIN || f0 > FMAX) return;

        document.getElementById("freq").textContent = `${f0.toFixed(1)} Hz`;

        let note = findClosest(f0);
        if (!note) return;

        recent.push(`${note.string}-${note.fret}`);
        if (recent.length > 5) recent.shift();

        let counts = {};
        for (let r of recent) counts[r] = (counts[r] || 0) + 1;

        let best = Object.entries(counts).find(([k,v]) => v >= 3);
        if (!best) return;

        let [s, f] = best[0].split("-").map(Number);
        updateTAB(s, f);
    };
};
