/**
 * base64 helpers that work in both Node and browsers without relying on a
 * single implementation (Buffer when available, atob/btoa otherwise).
 */

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof (globalThis as any).Buffer !== 'undefined') {
    return (globalThis as any).Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return (globalThis as any).btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof (globalThis as any).Buffer !== 'undefined') {
    return new Uint8Array((globalThis as any).Buffer.from(b64, 'base64'));
  }
  const binary = (globalThis as any).atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
