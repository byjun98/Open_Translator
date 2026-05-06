type BridgeGlobal = typeof globalThis & {
  __lstBridgeToken?: string;
};

function createBridgeToken() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(36)).join('-');
}

export function getOrCreateBridgeToken() {
  const bridgeGlobal = globalThis as BridgeGlobal;
  bridgeGlobal.__lstBridgeToken ??= createBridgeToken();
  return bridgeGlobal.__lstBridgeToken;
}
