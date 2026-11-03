/**
 * Small Web Bluetooth helpers shared by drivers. They only use the objects
 * they are given (BluetoothDevice, characteristics), so tests pass fakes.
 */

// The listener of each device: connecting again (#37) replaces it, so one drop is told once
const dropListeners = new WeakMap();

/** Connects to the device's GATT server, failing after timeoutMs. onDisconnect fires when the link drops. */
export async function connectGatt(device, { timeoutMs = 15000, onDisconnect } = {}) {
  if (onDisconnect) {
    device.removeEventListener?.('gattserverdisconnected', dropListeners.get(device));
    device.addEventListener('gattserverdisconnected', onDisconnect);
    dropListeners.set(device, onDisconnect);
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer from ${device.name || 'the device'} in ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
  });
  try {
    return await Promise.race([device.gatt.connect(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Starts notifications; onValue gets each DataView. Returns a function that stops them. */
export async function subscribe(characteristic, onValue) {
  const handler = (e) => onValue(e.target.value);
  characteristic.addEventListener('characteristicvaluechanged', handler);
  await characteristic.startNotifications();
  return async () => {
    characteristic.removeEventListener('characteristicvaluechanged', handler);
    try { await characteristic.stopNotifications(); } catch { /* already disconnected */ }
  };
}
