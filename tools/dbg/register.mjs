import { register } from 'node:module';
register('./stubloader.mjs', import.meta.url);
// minimal DOM for canvas atlases
const ctx = new Proxy({}, { get: (t, k) => (k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => ctx }) };
