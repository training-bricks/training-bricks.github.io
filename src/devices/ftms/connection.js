/**
 * The connection every FTMS driver makes (treadmill/ftms, trainer/ftms):
 * GATT, the Feature characteristic, the machine's data characteristic, the
 * Machine Status, and the Control Point with its answers through a write
 * queue, then Request Control. Both kinds share the Fitness Machine service,
 * so a device without the expected data characteristic is refused with a
 * clear message (a bike picked as a treadmill, or the other way round).
 */
import { connectGatt, subscribe } from '../ble/gatt.js';
import { createWriteQueue } from '../ble/write-queue.js';
import { SERVICE, FEATURE, CONTROL_POINT, MACHINE_STATUS, parseFeatures, parseControlResponse, parseMachineStatus, requestControl } from './common.js';

const ANSWER_MS = 3000;

/**
 * @param device     BluetoothDevice
 * @param opts.data  { uuid, kind: 'treadmill' | 'smart trainer' } the data characteristic and what it means
 * @param opts.onData(DataView), opts.onStatus(parsed Machine Status), opts.onDisconnect(), opts.onLog(kind, text)
 * @returns {{ features, read(uuid), command(bytes), send(bytes), close(), lastResult }}
 */
export async function openFtms(device, { data, onData, onStatus, onDisconnect, onLog }) {
  const server = await connectGatt(device, { onDisconnect });
  const service = await server.getPrimaryService(SERVICE);
  const char = async (uuid) => { try { return await service.getCharacteristic(uuid); } catch { return null; } };
  const read = async (uuid) => { try { return await (await char(uuid))?.readValue() ?? null; } catch { return null; } };
  const stops = [];
  const close = () => {
    for (const stop of stops.splice(0)) stop().catch?.(() => {});
    if (device.gatt?.connected) device.gatt.disconnect();
  };

  const dataChar = await char(data.uuid);
  if (!dataChar) {
    close();
    throw new Error(`${device.name || 'This device'} is not a ${data.kind} (no FTMS ${data.kind} data)`);
  }
  const feat = await read(FEATURE);
  const features = feat ? parseFeatures(feat) : null;
  stops.push(await subscribe(dataChar, onData));
  const status = await char(MACHINE_STATUS);
  if (status) {
    try { stops.push(await subscribe(status, (v) => onStatus(parseMachineStatus(v)))); } catch { /* optional characteristic */ }
  }

  const cp = await char(CONTROL_POINT);
  const conn = { features, read, close, lastResult: null };
  let pending = null;
  stops.push(await subscribe(cp, (v) => {
    const res = parseControlResponse(v);
    if (!res) return;
    conn.lastResult = res;
    pending?.(res);
  }));
  const write = createWriteQueue((bytes) => cp.writeValueWithResponse(bytes), { retries: 2 });

  /** Writes a command and waits for its Control Point answer (null after ANSWER_MS). */
  conn.command = async (bytes) => {
    const answer = new Promise((resolve) => {
      pending = resolve;
      setTimeout(() => resolve(null), ANSWER_MS);
    });
    await write(bytes);
    return answer;
  };
  /** Fire and forget: a refused command is only logged. */
  conn.send = (bytes) => {
    conn.command(bytes).then((res) => {
      if (res && !res.ok) onLog?.('warn', `FTMS command 0x${bytes[0].toString(16)}: ${res.text}`);
    }).catch((err) => onLog?.('error', `FTMS: ${err.message}`));
  };
  /** Straight to the write queue, without waiting (closing the page). */
  conn.writeNow = (bytes) => write(bytes).catch(() => {});

  const res = await conn.command(requestControl());
  if (!res?.ok) {
    close();
    throw new Error(`the ${data.kind} refused control (${res?.text ?? 'no answer'})`);
  }
  return conn;
}
