// jest.setup.js
const { TextEncoder, TextDecoder } = require("util");
const { Buffer } = require("buffer");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === "undefined") {
  global.TextDecoder = TextDecoder;
}
if (typeof global.Buffer === "undefined") {
  global.Buffer = Buffer;
}

// Fix JSDOM realm mismatch where Node's Buffer does not match JSDOM's Uint8Array
try {
  Object.defineProperty(Uint8Array, Symbol.hasInstance, {
    value: (instance) => {
      return (
        instance !== null &&
        typeof instance === "object" &&
        (ArrayBuffer.isView(instance) ||
          instance.constructor?.name === "Uint8Array" ||
          instance.constructor?.name === "Buffer")
      );
    },
    configurable: true,
  });
} catch (_) {}

if (typeof window !== "undefined") {
  try {
    Object.defineProperty(window.Uint8Array, Symbol.hasInstance, {
      value: (instance) => {
        return (
          instance !== null &&
          typeof instance === "object" &&
          (ArrayBuffer.isView(instance) ||
            instance.constructor?.name === "Uint8Array" ||
            instance.constructor?.name === "Buffer")
        );
      },
      configurable: true,
    });
  } catch (_) {}
}
