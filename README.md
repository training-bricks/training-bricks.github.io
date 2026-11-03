# Brickwise

Runs your Intervals.icu workouts on a treadmill or a smart trainer over Bluetooth, straight from the browser. It controls the NordicTrack EXP 5i and any FTMS treadmill (speed and incline) and any FTMS smart trainer (ERG watts). Speed or watts can follow your heart rate, guarded by DFA α1. When you finish, it uploads the activity to Intervals.icu.

**Live app:** https://ycaceres.github.io/brickwise/ · **Documentation:** [wiki](https://github.com/ycaceres/brickwise/wiki)

> Brickwise is an independent project, not affiliated with iFIT Inc. NordicTrack and iFit are trademarks of their respective owners.

## Features

- **Workouts:**
  - the Intervals.icu calendar (runs and rides);
  - a built-in library of 214 run and bike workouts (3 durations × 5 levels), in % of threshold pace or FTP and in zones;
  - free sessions.
- **Devices:** NordicTrack EXP 5i, FTMS treadmills and FTMS smart trainers (tested on a Wahoo KICKR CORE), any Bluetooth HR strap. There are simulators for testing without hardware.
- **HR control:** speed (or incline) on the treadmill and watts in ERG follow HR, with projection, proportional corrections and a **DFA α1 guard** that holds you under the aerobic threshold. See [HR control and DFA α1](https://github.com/ycaceres/brickwise/wiki/HR-control-and-DFA-alpha1).
- **Physiology:**
  - live DFA α1;
  - an α1 threshold test (VT1 / VT2), on the treadmill and on the bike;
  - a warning when the HR zones disagree with VT1;
  - Pa:HR / Pw:HR decoupling and VT1 after steady aerobic sessions.
  
  See [Threshold test and aerobic metrics](https://github.com/ycaceres/brickwise/wiki/Threshold-test-and-aerobic-metrics).
- **Output:** a live chart by zones, a second-by-second CSV with the reason for every change, FIT (one lap per step, RR) and TCX, and upload to Intervals.icu with a session summary, RPE and Feel.
- **During a session:** workout intensity (70–120 %), voice cues, automatic reconnection after a Bluetooth drop, and recovery after a reload or a closed tab.
- **App:** an installable PWA that works offline, in English, Spanish and French, with light and dark palettes.

## Getting started

It is a static page with no backend of its own. Web Bluetooth only works over HTTPS or on `localhost`, in Chrome or Edge (desktop or Android). On iPhone or iPad it needs a browser like Bluefy.

```bash
git clone https://github.com/ycaceres/brickwise.git
cd brickwise
npm start            # python3 tools/serve.py 8000; open http://localhost:8000
```

`tools/serve.py` is for development only:
- it enlarges the connection queue (with `python3 -m http.server`, macOS drops some module downloads and the app does not start);
- it listens on IPv4 and IPv6;
- it disables caching.

**Deploy:** the repository root is the site, with no build step. It is published with GitHub Pages from `main`, so every push to `main` updates the live app in a minute or two. Any static host with HTTPS works the same way.

**Intervals.icu:** in **Profile**, paste your API key (Intervals.icu → Settings → Developer Settings) and press **Sign in**.
- The page calls the Intervals.icu API directly.
- The key is stored only in that browser's `localStorage`, never in the code or on the host. If someone might have seen it, regenerate it in Intervals.icu and press **Sign out**.
- Without a key, the library, the manual profile and the downloads still work.

### Quick start

1. **Treadmill:** on the **Run** tab, turn on the treadmill with the safety key attached, then go to the **Treadmill** pill → **Connect treadmill** (~10 s to activate).
   **Smart trainer:** on the **Ride** tab, go to the **Trainer** pill → **Connect smart trainer**, and close Zwift or other apps first.
2. Optional: the **HRM** pill, for a strap. α1 needs a chest strap with RR intervals.
3. Pick a workout in **Home** or the **Training library**, and press ▶ on its page (or start a free session).
4. Press **▶ (start)**. On a treadmill, press START on the console. The session begins when the belt moves or you pedal, and it pauses when you stop.
5. When done, upload to Intervals.icu or download the CSV / FIT / TCX.

More in the [User guide](https://github.com/ycaceres/brickwise/wiki/User-guide). Open the page with `?debug=true` for the simulators and the Debug tab ([Troubleshooting](https://github.com/ycaceres/brickwise/wiki/Troubleshooting)).

## Safety
- The belt is started only from the console, with the safety key attached (same as qdomyos-zwift with this model).
- **■ (finish)**, and also the end of the workout's last step, **slow the belt down before pausing it**: never from running speed to 0 at once, which can make you stumble. The incline goes to 0 and the speed comes down 0.5 km/h every 2 s to a 3 km/h walk (8 km/h → 3 in 20 s), stays there 5 s, then the belt pauses (Mode = 3, like the console's pause button). At 3 km/h or less it pauses right away. Pausing or stopping from the console during the slow-down ends it. From the console you can resume or finish. The EXP 5i rejects speed 0 with code 4, so it is not used. If the treadmill does not respond, STOP on the console or pulling the key is still required.
- **Closing or reloading the page** during an active workout, or while the belt slows down after it, pauses the belt at once (Mode = 3): nobody would be left to slow it down. The command goes out when the browser asks whether to leave; if you stay, the session remains paused and START on the console resumes it. It is best effort: if the browser closes abruptly (or hangs), the command may not arrive.
- If the belt stops for more than 2 s, the session pauses. If the connection drops or data stops arriving, no distance is counted.
- Speed is limited to 0.8–16 km/h and incline to 0–10 %.
- **On a smart trainer**, ■ and the end of the workout release the trainer (no ERG load). Stopping pedaling for 2 s pauses the session.
- **The screen stays on** from ▶ until the session ends (Screen Wake Lock API). The browser drops the lock whenever the page is hidden, so it is requested again when you come back to it. If the browser cannot keep the screen on (no Wake Lock support, or battery saver mode), a note under the controls says so: turn off auto-lock in the device settings.

## Supported devices

| Device | Driver | Status |
|---|---|---|
| NordicTrack EXP 5i (iFit Bluetooth) | `nordictrack-exp5i` | Tested on the real treadmill ([protocol](https://github.com/ycaceres/brickwise/wiki/NordicTrack-EXP-5i-protocol)) |
| Treadmills with Bluetooth FTMS | `ftms-treadmill` (generic) | Written from the specification and tested against a simulated device; not yet on a real treadmill |
| Smart trainers with Bluetooth FTMS (Wahoo KICKR, Elite, Saris, Zwift Hub, recent Tacx…) | `ftms-trainer` (generic) | Tested on a Wahoo KICKR CORE |
| Bluetooth HR straps | `hr-strap` | HR and RR intervals (Polar H9/H10, Garmin HRM, Wahoo TICKR…) |

**Connect treadmill** opens a single Bluetooth chooser for all treadmills: an iFit treadmill is recognized by its name (`I_…`), and any other one is tried with FTMS. In every case the belt starts from the console (safety key).

## Development

- `npm test` runs the hardware-free tests (`node --test`): drivers against fake GATT devices, the session engine with simulated devices and a fake clock, workouts, physiology, exports and pages.
- The code is static ES modules with no build step and no dependencies. Every file is described in [Code structure](https://github.com/ycaceres/brickwise/wiki/Code-structure), together with the settings kept in the browser.
- To add a device driver, see [`src/devices/README.md`](src/devices/README.md). To add a language, see [`src/i18n/README.md`](src/i18n/README.md). The workout library is [`data/library.json`](data/library.json) ([format](https://github.com/ycaceres/brickwise/wiki/Workout-library-format)).
- Plans and ideas are in the [issues](https://github.com/ycaceres/brickwise/issues) and in the [competitive analysis](https://github.com/ycaceres/brickwise/wiki/Competitive-analysis-and-improvements).

## References

Open-source projects consulted while building Brickwise:

| Repository | What it contributed |
|---|---|
| [cagnulein/qdomyos-zwift](https://github.com/cagnulein/qdomyos-zwift) | The EXP 5i activation sequence, polling cycle and speed/incline packets (`nordictrack_treadmill_exp_5i` profile), captured from a real unit |
| [ianchi/ifit](https://github.com/ianchi/ifit) ([PyPI](https://pypi.org/project/ifit/)) | The iFit message format, characteristics table and response decoding used in `src/devices/treadmill/nordictrack-exp5i/messages.js`; its `ifit discover-activation` command captures a unit's activation code |
| [dawsontoth/zwifit](https://github.com/dawsontoth/zwifit) | An earlier iFit treadmill bridge, reviewed to understand the BLE protocol |
| [cagnulein/QZCompanionNordictrackTreadmill](https://github.com/cagnulein/QZCompanionNordictrackTreadmill) | Companion app for NordicTrack treadmills, reviewed for alternative connection methods |
| [nategreco/uBike](https://github.com/nategreco/uBike) | Console replacement firmware for NordicTrack equipment, reviewed for the low-level protocol |
| [dvmarinoff/Auuki](https://github.com/dvmarinoff/Auuki) | Web Bluetooth trainer app whose workout graph inspired the session chart |

Workouts, zones and uploads use the [Intervals.icu API](https://intervals.icu/api-docs.html).
