class AudioProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input[0]) {
       // postMessage は構造化クローンを使うので TypedArray を渡しても OK
      this.port.postMessage(input[0]);
    }
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
