/**
 * Audio processing utilities for Gemini Multimodal Live API.
 * The API expects 16-bit PCM (signed) at a 16kHz sample rate for input.
 * It provides the same for output.
 */

/**
 * Converts Float32 audio data to signed 16-bit PCM.
 */
export function floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/**
 * Converts 16-bit PCM data to Float32.
 */
export function pcm16ToFloat32(pcm16Array: Int16Array): Float32Array {
  const float32Array = new Float32Array(pcm16Array.length);
  for (let i = 0; i < pcm16Array.length; i++) {
    float32Array[i] = pcm16Array[i] / 32768;
  }
  return float32Array;
}

/**
 * Converts ArrayBuffer to Base64.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Converts Base64 to ArrayBuffer.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
