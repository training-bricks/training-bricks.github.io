# Device drivers

Every treadmill, smart trainer and sensor Brickwise talks to is a **driver**: a folder with the code that speaks its protocol and a **descriptor** (`index.js`) that says what it is, how to find it and what it can do. The session engine and the screens only use the common interface, so a new brand or model never touches them. Simulators are drivers too (`debugOnly`), which is how development and tests run without hardware.

```
src/devices/
  types.js                 the contract (JSDoc typedefs)
  registry.js              every driver, by kind
  ble/                     shared Web Bluetooth helpers
  ftms/                    what every FTMS machine shares: common.js (features, Control Point, Machine Status), connection.js (openFtms)
  treadmill/
    nordictrack-exp5i/     driver.js, protocol.js, messages.js, index.js
    ftms/                  driver.js, protocol.js, index.js (generic: any FTMS treadmill)
    simulated/             driver.js, index.js (debug only)
  trainer/
    trainer.js             Trainer base class (modes, ERG ramp, clamping)
    ftms/                  driver.js, protocol.js, index.js (generic: any FTMS smart trainer)
    simulated/             driver.js, index.js (debug only)
  sensors/
    hr-strap/              driver.js, index.js
```

## Adding a driver

1. **Folder:** `src/devices/<kind>/<brand-model>/` with `driver.js` (the class), `protocol.js` (pure packet building / parsing, so it can be unit tested) and `index.js` (the descriptor).
2. **Descriptor** (see `DriverDescriptor` in `types.js`):
   ```js
   export default {
     id: 'brand-model',            // lowercase, dashes
     kind: 'treadmill',            // 'treadmill' | 'trainer' | 'hr' | 'power' | 'cadence'
     name: 'Brand Model (protocol)',
     match: { namePrefix: ['ABC'], services: ['fitness_machine'] },   // how to find and recognize it
     capabilities: { speed: true, incline: true, remoteStart: false, remotePause: true },
     limits: { speedMin: 1, speedMax: 18, speedStep: 0.1, inclineMin: 0, inclineMax: 12, inclineStep: 0.5 },
     create: (events) => new BrandModelTreadmill(events),
   };
   ```
3. **Generic drivers:** a driver for a standard protocol (FTMS) sets `generic: true`; a chosen device no other driver recognizes by name is tried with it.
4. **Register it:** one import and one entry in `DRIVERS` in `registry.js`. It then appears in the device menus by itself (`ui/device-menu.js`): "Connect treadmill" / "Connect smart trainer" uses the driver directly when it is the only one of its kind, or one Bluetooth chooser for all of them plus `detect()` when there are several; debug-only drivers are listed as simulators with `?debug=true`, and a `simulate(...)` method adds their controls to the menu. The Run and Ride controls follow `capabilities` (e.g. no incline buttons without `incline`).
4. **Events:** call `onStatus('connecting' | 'initializing' | 'ready' | 'disconnected' | 'error', detail)`, `onData(state)` with every reading (always set `state.updatedAt = Date.now()`), `onInfo(info)` and `onLog(kind, text)`.
5. **Connect:** `connect({ device })` may receive a Bluetooth device already chosen by the app (one chooser for every driver of a kind); without it, the driver calls `navigator.bluetooth.requestDevice` with its own `match`. Use `ble/gatt.js` (`connectGatt`, `subscribe`) and `ble/write-queue.js` (`createWriteQueue`) instead of re-implementing them. After a drop during a session the app calls `connect({ device })` again with the same device (`reconnect.js`), so a driver must be able to connect more than once.
6. **Safety:** `pause()` stops the belt (or releases the trainer); `pauseNow()` must be synchronous and safe when not connected (it runs while the page closes).
7. **Tests:** `tests/devices.test.mjs` runs the shared checks in `tests/devices/contract.mjs` on every registered driver (descriptor sanity; full lifecycle for drivers that run without Bluetooth). Add protocol tests for `protocol.js` with real captures, like `tests/treadmill.test.mjs` does for iFit.
8. **Hardware:** test against the real device, or an emulator (for FTMS, a GATT server profile in nRF Connect or zwack). Do not change a driver proven on hardware without testing on it again.

## Treadmills

Treadmill drivers extend `Treadmill` (`treadmill/treadmill.js`) and implement `setSpeed(kmh)`, `setIncline(pct)`, `pause()`, `pauseNow()`, `connect()`, `disconnect()` and `connected`. The app only calls `setTarget({ speed, incline })`, which clamps to `limits` and rounds to their steps first; a driver may narrow `limits` once the device reports its real ranges (the EXP 5i does).

Every reading published with `onData(state)` carries these normalized fields next to the driver's own (see `TreadmillState` in `types.js`):

| Field | Meaning |
|---|---|
| `speed`, `incline` | actual km/h and % |
| `targetSpeed` | what the treadmill reports as requested (it changes when someone uses the console) |
| `distance`, `time` | the console's counters (m, s), if any |
| `belt` | `'running'` \| `'paused'` \| `'stopped'` |
| `alerts` | e.g. `['safety-key-missing']`; the Run page shows a notice for each known alert |
| `hr`, `hrSource` | HR from the console (`'console'`), or null |
| `updatedAt` | ms timestamp of the reading |

`diagnostics()` returns extra `[label, value]` rows for the Debug page (the EXP 5i shows its iFit mode and where the console HR comes from).

## Smart trainers

Trainer drivers extend `Trainer` (`trainer/trainer.js`). The app calls `setMode(mode)`, `setTarget({ power })` (ERG), `setResistance(pct)`, `setSimulation({ grade, windSpeed, crr, cw })` and `stop()`; the base class clamps to `limits` and, in ERG, spreads a power change over `ERG_RAMP_S` (2.5 s, see `ergRamp`) so a big jump does not stall the rider. A driver implements the hooks `_sendPower(w)`, `_sendResistance(pct)`, `_sendSimulation(params)`, `_sendStop()` and `_applyMode(mode)`, plus `connect`, `disconnect` and `connected`, and calls `onControlLost()` if another app takes over.

Readings are published as `TrainerState` (`types.js`): `power`, `cadence`, `speed`, `distance`, `elapsed`, `mode`, `controlled`, `hr`, `updatedAt`.

The simulated trainer (`trainer/simulated/`, debug only) is the reference implementation; `simulate({ pedaling })` starts or stops the simulated rider.

The **FTMS trainer** (`trainer/ftms/`, generic) parses Indoor Bike Data (0x2AD2) and the Supported Power and Resistance ranges (0x2AD8, 0x2AD6), and sends Set Target Power (ERG), Set Target Resistance and Set Indoor Bike Simulation Parameters. Its `capabilities` (ERG, resistance, simulation) follow the machine's Feature bits.

FTMS treadmills and trainers share `ftms/common.js` and `ftms/connection.js`. `openFtms()` connects, subscribes to the machine's data, the Machine Status and the Control Point (with a write queue), and requests control. A device without the expected data characteristic is refused ("… is not a treadmill / smart trainer"), since both kinds match the same Fitness Machine service. Tacx FE-C (#9) would go in `trainer/tacx-fec/`.
