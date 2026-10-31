# Brickwise

Controls the speed and incline of a NordicTrack EXP 5i treadmill over Bluetooth and automatically runs the running workouts planned in Intervals.icu. When you finish, it uploads the activity paired with the workout.

**Live app:** https://ycaceres.github.io/brickwise/

> Brickwise is an independent project, not affiliated with iFIT Inc. NordicTrack and iFit are trademarks of their respective owners.

## Usage

It is a static page: it needs no backend of its own. Web Bluetooth only works over HTTPS or on `localhost`, in Chrome or Edge (desktop or Android; not Safari on iPhone/iPad).

To run it locally:

```bash
git clone https://github.com/ycaceres/brickwise.git
cd brickwise
npm start            # python3 tools/serve.py 8000; open http://localhost:8000
```

`tools/serve.py` is for development only: it enlarges the connection queue (with `python3 -m http.server` macOS drops some module downloads and the app does not start), listens on IPv4 and IPv6 and disables caching. If a module download still fails, the page reloads itself up to twice and then shows a notice.

**Deploy:** the repository root is the site, with no build step. It is published with GitHub Pages from the `main` branch, so every push to `main` updates the live app in a minute or two. Any other static host with HTTPS (Netlify, Cloudflare Pages) works the same way.

**Intervals.icu:** in **Profile**, paste your API key (Intervals.icu → Settings → Developer Settings) and press **Sign in**. The page calls the Intervals.icu API directly, which accepts cross-origin requests. The key is stored only in that browser's `localStorage`: it is not in the code or on the host. If someone might have seen it, regenerate it in Intervals.icu and press **Sign out**. Without a key, the library, the manual profile and the TCX download still work.

The page has a vertical bar of icons on the left: **Home** and **Training library** at the top, **Configuration** and **User profile** at the bottom, and between them contextual buttons (**Run** for treadmill workouts, **Ride** for bike workouts, **Debug**). **Ride** only shows the selected bike workout (power and HR by zone); riding on a bike trainer is not supported yet.

**Configuration** picks the color palette (System, Light, Dark, Monochrome, Vivid) and the language (System — the browser's —, English, Spanish or French). Both are kept in `localStorage` (`brickwise.theme`, `brickwise.lang`). The palette changes only the app chrome: chart and training zone colors are the same in every palette.

- **Home (house):** your Intervals.icu account (name, city, weight, sleep, resting HR, HRV) and the runs and rides planned for a day, filtered by sport.
- **Workout page** (no button): opens when you pick a workout in Home or the library; the sidebar leads back.
- **Profile (person):** works like a sign-in. Signed out, you paste your Intervals.icu API key and press **Sign in**, or enter threshold pace, LTHR and max HR by hand (without LTHR it is estimated as 91 % of max HR). Signed in, you see your Intervals.icu name, photo and city, your key data (threshold pace, LTHR, max HR, resting HR and weight), the zone table, **Refresh** and **Sign out**. Signing out deletes the key and keeps the data as a manual profile.
- **Training library (clipboard):** the library (`data/library.json`), with three dropdowns to filter by duration (30, 45 or 60 min), type and level (1–5). Workouts are in % of threshold pace and zones, so they adapt to the profile; Intervals workouts also use the profile's threshold when their steps are in % or zones. On the workout page you choose the pace within the zone, the base incline and whether speed is adjusted by HR.
- **Run (runner):** a bar with distance, time and HR, the buttons ▶ start, ⏭ skip step, ■ finish, download (CSV or TCX) and upload to Intervals.icu, and incline and pace with their + and − buttons (0.5 % and 0.5 km/h); below, a line with the session status and the chart.
- **Debug (bug):** only shows when the page is opened with `?debug=true`. It has the treadmill state and the communication log.

1. Turn on the treadmill, attach the safety key and, on the **Run** tab, press the **Treadmill** pill at the top and choose **Connect treadmill** (it shows up as `I_TL…`). Activation takes ~10 s.
2. Optional: press the **HRM** pill (also on the Run tab) (any standard Bluetooth heart rate monitor).
3. Pick the workout in **Home** or the **Training library** and, on its page, press ▶ (top right, next to its name) to go to **Run** (or **Ride** for a bike workout).
4. Press **▶ (start)** and then **START on the console**. The workout begins when the belt moves.
5. When done: the **upload to Intervals.icu** icon (needs the API key) or the **download** icon (CSV or TCX). Library workouts are uploaded unpaired.

**Simulators** (in the Treadmill and Trainer pill menus, only with `?debug=true`) test everything without hardware (including a simulated HR if no strap is connected). The Trainer pill (Ride tab) connects a smart trainer for manual ERG or resistance control; riding workouts on it comes later.

## Library (`data/library.json`)

To add or tweak workouts only `data/library.json` is edited; the page reads it on load. Each **type** generates one workout per duration in `durations` and per level in `levels`, and the **featured** ones (`featured`) are fixed workouts, written step by step.

**Segment** (one step), used everywhere:

| Field | Example | Meaning |
|---|---|---|
| `dur` | `"2m"`, `"1m30s"`, `"90s"` | duration |
| `pace` | `72`, `[104, 108]` | % of threshold pace (a range is a ramp if `"ramp": true`) |
| | `"Z2"` | profile pace zone |
| | `"12:00"` | fixed pace in min/km (does not depend on the profile) |
| `hr` | `"Z2"` | target HR zone |
| `hrBy` | `"incline"` | the HR target moves the incline instead of the speed |
| `test` | `true` | step of the threshold test ramp |
| `incline` | `5` | incline in % (without it the base incline is used) |
| `lock` | `true` | HR does not change the speed (it is only the goal) |
| `ramp` | `true` | pace goes from the first to the second `pace` value |

**Type:**

```json
{
  "id": "vo2", "name": "VO2max intervals", "description": "…",
  "hrControl": true,                                             // optional: HR can steer it (see Zones and HR adjustment)
  "warmup": { "dur": "10m", "pace": [70, 80], "ramp": true },   // optional; if missing, the one in "defaults"
  "warmup30": { … },                                             // optional, for 30 min
  "cooldown": null,                                              // null = no cooldown
  "levels": { "1": { …recipe… }, "2": { … }, … }
}
```

**Recipes** (`kind`):

- `"continuous"`: `main` (a segment without `dur`) fills the time; optional `finish` with `reps`, `work` and `recovery` at the end (strides).
- `"intervals"`: `work` and `recovery`. Without `reps`, as many as fit (up to `maxReps`); with `reps`, a fixed number. Leftover time lengthens the warm-up and cooldown.
- `"incline-ramp"`: fixed `pace`; incline goes from `from` to `to`, adding `step` every `every`, and holds at the top until the end. `hr` is the goal (speed does not change).
- `summary` (optional) replaces the automatic summary ("6 × 3′ at 104–108 % · 2′ easy").
- `byDuration` adjusts the level for one duration: `"byDuration": { "30": { "reps": 2, "work": { "dur": "7m" } } }`.

A level can override the type's `hrControl`.

**Featured:** `id`, `name`, `description`, `type`, `minutes`, `level` (for the filters), optional `hrControl` and `steps`, a list of segments (`"warmup": true` or `"cooldown": true` mark the warm-up and cooldown).

`npm test` checks that every combination lasts what it says and that hard work grows with level in interval sessions.

## Chart

A single area, Auuki style. The **?** button explains the colors.

- **In the background, the whole workout:** one block per step; width is duration, height is target speed and color is the zone. What is done gets dimmed and a vertical bar marks progress.
- **On top, the actual data:** pace, HR and incline, growing as you run.
- **Left axis:** pace in min/km. **Right axis:** HR in bpm. Both columns are shaded with each zone's color and, with zones in the profile, they line up: the HR scale is stretched piecewise so the top of each HR zone lands at the height of the top of the same pace zone. The current zone shows above each column.
- **Bike workouts** (workout page and Ride): the left axis is power in W, shaded by power zone; block height is the target watts (ramps slope, steady steps sit in the middle of their range) and HR lines up with the power zones the same way.
- **Zone colors:** Z1 gray, Z2 blue, Z3 green, Z4 yellow, Z5 orange, Z6 red, Z7 violet.
- Dashed lines mark the plan: each step's HR cap (or goal) and the planned incline.
- **Download** (icon next to ■): second-by-second CSV or TCX; enabled when the session ends.

## Heart rate variability (DFA α1)

With a chest strap that sends RR intervals (time between beats; nearly all do: Polar H9/H10, Garmin HRM, Wahoo TICKR), the page computes the **DFA α1** of the last 2 minutes every 5 s (`src/physiology/hrv.js`):

- **> 0.75:** below the aerobic threshold (aerobic). **0.5–0.75:** transition. **< 0.5:** above the anaerobic threshold.
- It shows to the right of HR in the bar and as a **color ribbon under the chart**. Gray: computing (~90 beats needed) or a signal with more than 5 % artifacts (missed or double beats; common with a dry strap).
- The CSV stores `alpha1` and each second's RRs (`rr_ms`, separated by `;`). TCX has no field for RRs, so they do not reach Intervals.icu yet.
- It also says what the control did: `step`, the HR range followed (`hr_lo`, `hr_hi`), the km/h HR added or removed (`hr_adjust_kmh`), and the `reason` on the second speed changed. One row per second of session time.
- With an optical sensor or no strap nothing shows. Simulation mode generates test RRs.

## Zones and HR adjustment

On load, the running HR and pace zones are read from Intervals.icu (running sport-settings) and shown on the workout card. The cycling zones (FTP, power and HR, from the Ride sport-settings) are shown in Profile.

**Which workouts HR can steer.** HR responds 1–2 minutes late, so it only helps on long, steady steps. Those workouts get a **♥ HR** tag in the lists, and only they show the **Adjust speed by HR** checkbox:

- **Library:** the ones with `"hrControl": true` in `data/library.json` (today: Aerobic Z2, Tempo intervals, Z2 walk by incline and Z2 heart rate run). VO2max, threshold, hills, strides and run-walk keep their pace.
- **Intervals.icu:** judged by their steps. They qualify with an HR target, or with steps of 5 min or more in Z1–Z3 and only easy steps (Z1–Z2) in between.

**With the checkbox on**, steps of 5 min or more in pace Z1–Z4 change their target from pace to the **HR zone in the same position** (pace Z3 → HR Z3). Speed starts at the planned pace and then follows HR; from Z3 up it is left alone for the first 2.5 min while HR climbs. Shorter steps (recoveries, strides) keep their pace with no HR control, and the warm-up and cooldown keep the HR cap. The steps table and chart show the HR range of the converted steps.

**Z2 walk by incline:** speed stays fixed (a brisk walk) and the **incline** follows HR to keep it in the middle of Z2, with the same decision as speed (projection, middle of the range, α1 guard). Each correction moves 0.5 % (1 % when HR is far off), within 0–10 %, and at least 40 s apart because the incline motor is slow. Walking, 1 % weighs about as much as 0.9 km/h.

How speed follows HR:

While HR climbs it is projected 30 s ahead with its slope over the last 30 s, so speed drops while HR is still heading up instead of after it got there. A falling HR is not projected, so a short dip does not ask for more speed. Corrections are proportional: 0.1 km/h per bpm off target, between 0.1 and 0.5 km/h when slowing down and at most 0.2 km/h when speeding up, because HR answers a rise 1–2 min later (`src/session/hr-control.js`). Tuning history and the sessions behind it: GitHub project *Adaptative*, starting with [#10](https://github.com/ycaceres/brickwise/issues/10).

- **Steps with a pace target:** the HR cap is that of the HR zone in the same position (pace Z2 → HR Z2). If HR is heading above that cap, speed drops, up to 2 km/h in total. Once HR is 5 bpm below the cap and no longer rising, the removed speed returns, 0.2 km/h at a time.
- **Steps with an HR target:** the starting speed comes from the matching pace zone. Then speed moves to keep HR in the **middle** of the range (±3 bpm), not at its top (at most +1.5 km/h and −2 km/h). In Z1–Z2 it aims lower, at 40 % of the range (Z2 135–150 → 141), because VT1 tends to sit near the middle of Z2. Speed never rises while HR is still climbing.
- **α1 guard on aerobic steps (Z1–Z2, not the warm-up nor the cool-down):** with a chest strap, once the median α1 of the last minute is below 0.75 the effort is above the aerobic threshold even when HR is still in its zone. While the guard is on, speed is **never raised** (even with HR in Z1), and with HR above Z1 it also **drops 0.2 km/h**, at most every 90 s (the 2-minute α1 window needs that long to show a change). It turns off only once the median α1 of a minute is above 0.80. α1 is only trusted after the first 2 minutes and with a clean signal; early in exercise and at easy effort it is not in steady state and reads low, which is why it does not slow down a warm-up or HR in Z1.
- **Cool-down:** it starts no faster than the previous step ended (when HR had brought that step down) and keeps its ramp from there, without giving speed back.
- **Warm-up ramps end early** when the next step is aerobic (Z1–Z2): once HR has been at or above the top of Z1 for 5 s, the warm-up is over. Before harder steps the whole warm-up is kept.
- The same correction must be asked for 10 s in a row, and at least 25 s pass between adjustments (60 s between two rises). Nothing is adjusted in the first 45 s of each step (2.5 min on HR-zone steps from Z3 up), because HR takes time to respond. Every adjustment is logged with its reason.

## Aerobic runs: decoupling and VT1 (#4)

At the end of a **steady aerobic run** (every step that is not the warm-up or the cool-down is in Z1–Z2, no test; a free session counts too) with at least 20 min of steady part, the note and **Profile → Aerobic runs** show (`src/physiology/aerobic.js`):

- **Pa:HR decoupling:** how much efficiency (flat-equivalent speed ÷ HR) falls from the first half of the steady part to the second. The steady part leaves out the warm-up, the cool-down, pauses and the first 5 min of the main steps. Under 5 % the aerobic base held for that pace; 5–10 % moderate; over 10 % the pace was too much that day. With HR control, HR stays flat, so it shows as the speed dropping. Intervals.icu computes its own decoupling over the whole activity, so the numbers differ.
- **HR at VT1 of the run** (chest strap with RR): where α1 crosses 0.75 on a straight line α1 = f(HR), as in the threshold test. The warm-up's rise gives the line its slope. The line is fitted on the median α1 of each 3 bpm band, so the long minutes at the run's HR do not outweigh the rest. It needs at least 5 bands over 15 bpm and r² ≥ 0.6. Otherwise only the median α1 at the run's HR is shown.
- It is an estimate, not a test: α1 also falls with time and fatigue and varies from day to day. Profile shows the **trend**, the median VT1 of the last 5 runs that have one; if it drifts away from your zones, repeat the threshold test or review the zones.

The last 50 runs are kept in the `runs` setting.

## Threshold test (α1)

The featured **Threshold test (α1)** finds your aerobic (VT1) and anaerobic (VT2) thresholds from DFA α1, without going to exhaustion. It needs a chest strap that sends RR intervals.

1. 8′ warm-up jog.
2. **Ramp:** easy jog (75 % of threshold pace) while the incline rises 1 % per minute up to 10 %, then the speed rises 3 % of threshold every minute. A ramp by incline is gentler than one by speed and its steps are finer.
3. The ramp **ends by itself** once α1 stays below 0.45 for 20 s (just past VT2), or when HR gets within 2 bpm of max HR. You can also end it with ■. The log notes when α1 crosses 0.75 and 0.5.
4. 5′ cooldown.

**Analysis** (`src/physiology/thresholds.js`, after Rogers et al., 2021): every α1 is paired with the mean HR and the mean flat-equivalent speed of its own 2-minute window, and a straight line α1 = f(HR) is fitted over α1 values between 0.3 and 1.1. **VT1** is where the line crosses 0.75 and **VT2** where it crosses 0.5 (VT2 HR is close to LTHR). Speed with incline is turned into flat-equivalent speed with the ACSM running equation, v · (1 + 4.5 · grade). If α1 did not quite reach 0.5, VT2 is extrapolated (up to 0.1) and marked with *.

Results are kept in **Profile › Threshold tests** (last 20, in this browser). A button there uses the latest VT2 as LTHR and threshold pace for the profile. With Intervals.icu connected, also update its running settings, or **Refresh** brings its values back. Repeat the test every 4–6 weeks, rested and at the same time of day, to compare.

## Safety
- The belt is started only from the console, with the safety key attached (same as qdomyos-zwift with this model).
- **■ (finish)**, and also the end of the workout's last step, **slow the belt down before pausing it**: never from running speed to 0 at once, which can make you stumble. The incline goes to 0 and the speed comes down 0.5 km/h every 2 s to a 3 km/h walk (8 km/h → 3 in 20 s), stays there 5 s, then the belt pauses (Mode = 3, like the console's pause button). At 3 km/h or less it pauses right away. Pausing or stopping from the console during the slow-down ends it. From the console you can resume or finish. The EXP 5i rejects speed 0 with code 4, so it is not used. If the treadmill does not respond, STOP on the console or pulling the key is still required.
- **Closing or reloading the page** during an active workout, or while the belt slows down after it, pauses the belt at once (Mode = 3): nobody would be left to slow it down. The command goes out when the browser asks whether to leave; if you stay, the session remains paused and START on the console resumes it. It is best effort: if the browser closes abruptly (or hangs), the command may not arrive.
- If the belt stops for more than 2 s, the session pauses. If the connection drops or data stops arriving, no distance is counted.
- Speed is limited to 0.8–16 km/h and incline to 0–10 %.
- **The screen stays on** from ▶ until the session ends (Screen Wake Lock API). The browser drops the lock whenever the page is hidden, so it is requested again when you come back to it. If the browser cannot keep the screen on (no Wake Lock support, or battery saver mode), a note under the controls says so: turn off auto-lock in the device settings.

## Files

| File | What it does |
|---|---|
| `index.html` | The shell: sidebar, header with the device pills, footer and the startup scripts |
| `manifest.webmanifest`, `sw.js`, `icons/` | Installable app (PWA): name, colors and icons; the service worker serves the latest version from the network and the cached copy when offline. `tools/icons.sh` renders the PNG icons from the SVGs |
| `pages/*.html` | One file per page (home, config, profile, workouts, workout, run, ride, debug) |
| `src/main.js`, `src/lib/pages.js` | Startup: loads every page in parallel, then calls each UI module's `init…()` and loads the data |
| `src/components/` | Reusable custom elements (light DOM, so `css/app.css` and the palettes apply): `bw-icon`, `bw-user-card` (Home and Profile), `bw-zone-table` (running and cycling), `bw-workout-list` (Home and library), `bw-chart` (workout page and Run). Data goes in through properties; actions come out as bubbling events (`bw-select`, `bw-refresh`, `bw-signout`) |
| `src/ui/format.js` | UI text without the DOM (account stats, zone tables): pure functions, tested in Node |
| `src/state.js` | App-wide state (profile and zones, the workout picked, connected devices, account) with change events; no DOM |
| `src/ui/tabs.js` | Which tab or page is shown |
| `src/ui/config.js` | Configuration tab: color palette and language |
| `src/i18n/index.js`, `src/i18n/languages.js`, `src/i18n/en.js` | Interface text by language: `t()` with placeholders and plurals, `data-i18n` attributes, languages loaded on demand, English as fallback; see [`src/i18n/README.md`](src/i18n/README.md) to add one |
| `src/i18n/format.js` | Numbers and dates in the interface language |
| `css/app.css` | Page styles |
| `src/ui/devices.js` | Treadmill and HR strap pills: connect, simulator, disconnect |
| `src/ui/profile.js` | Profile tab: threshold pace, LTHR and max HR, the Intervals.icu account and the threshold test history |
| `src/ui/home.js` | Home: the day's planned workouts, date and sport filter |
| `src/ui/library.js` | Training library and its filters |
| `src/ui/selection.js` | The workout picked: turns it into steps for the current zones and options, remembers library picks |
| `src/ui/workout.js` | Workout page: options, steps table, totals and preview |
| `src/ui/ride.js` | Ride tab: the selected bike workout's chart (power axis), view only |
| `src/ui/run.js` | Run tab: live numbers, session buttons, chart, export and upload |
| `src/ui/debug.js` | Debug tab: communication log and console state |
| `src/ui/session-chart.js` | Chart of actual data over the workout by zones (SVG, no libraries) |
| `src/ui/chart-axes.js` | The chart's left axis, one object per kind (pace for runs, power for bike workouts): zones, domain, block heights, ticks, unit, tooltip |
| `src/session/runner.js` | Runs the session: steps, speed and incline commands, samples, HR and α1 adjustments, threshold test. No DOM or UI imports: it reports through events (`change`, `tick`, `log`, `note`, `beep`, `active`, `test`) and `tick(now)` takes the clock, so it runs in Node tests |
| `src/session/test-history.js` | Threshold test history (newest first, 20 kept) and how a result reads |
| `src/session/run-history.js` | Aerobic run history (newest first, 50 kept) and how a run reads |
| `src/session/policies.js` | How each sport drives its device: a run drives the treadmill (speed, incline, belt), a ride the smart trainer (power, pedaling) |
| `src/session/hr-control.js` | Speed (or incline) adjustment by HR: projection, proportional correction and the α1 guard |
| `src/session/live.js` | Live device readings: speed, incline, HR, console state, RR intervals and α1 |
| `src/session/wake-lock.js` | Keeps the screen on during a session |
| `src/devices/registry.js`, `src/devices/types.js` | Every device driver by kind (treadmill, trainer, HR…) and the contract they follow; see [`src/devices/README.md`](src/devices/README.md) to add one |
| `src/devices/treadmill/nordictrack-exp5i/driver.js` | Web Bluetooth connection to the EXP 5i (write queue, retries) |
| `src/devices/treadmill/nordictrack-exp5i/protocol.js` | iFit protocol packets for the EXP 5i: init and activation, polling cycle, speed and incline |
| `src/devices/treadmill/nordictrack-exp5i/messages.js` | Full decoding: reassembles multi-packet messages, pairs each response with its request and reads every field (table from [ianchi/ifit](https://github.com/ianchi/ifit)) |
| `src/devices/treadmill/ftms/` | Generic driver for treadmills with the standard Bluetooth FTMS service (protocol + driver, unit tested; **not yet tested on a real treadmill**) |
| `src/devices/treadmill/simulated/driver.js` | Treadmill simulator with the same interface (and simulated RR), a driver like any other (debug only) |
| `src/devices/sensors/hr-strap/driver.js` | Standard Bluetooth heart rate strap: HR, contact and RR intervals |
| `src/devices/ble/` | Shared Web Bluetooth helpers for new drivers: GATT connect with timeout, notifications, write queue with retries |
| `src/physiology/zones.js` | Profile, HR and pace zones, cycling power and HR zones, HR ranges of each step and resolution of relative paces |
| `src/physiology/hrv.js` | RR intervals: artifact cleanup and DFA α1 |
| `src/physiology/thresholds.js` | VT1 and VT2 from the threshold test (α1 vs HR fit, flat-equivalent speed) |
| `src/physiology/aerobic.js` | Steady aerobic runs: Pa:HR decoupling, HR at VT1 from α1 and its trend |
| `src/workouts/steps.js` | Turns the Intervals.icu `workout_doc` into steps (shared walk: repeats, labels, durations, incline); targets are the plan as written, the session clamps what it sends to the treadmill |
| `src/workouts/run.js`, `src/workouts/ride.js` | Per-sport step targets: speed and HR caps/targets for running, watts and power zones for cycling |
| `src/workouts/format.js` | Pace and duration formatting |
| `src/workouts/info.js` | A workout's approximate length and whether HR can steer it |
| `src/workouts/library.js` | Turns `data/library.json` into workouts for every duration and level |
| `data/library.json` | The workout library (data; edited by hand) |
| `src/export/tcx.js`, `src/export/csv.js` | Build the session TCX and CSV |
| `src/services/intervals.js` | Intervals.icu API calls from the browser: workouts, zones and activity upload, with the API key stored in the browser |
| `src/lib/timer.js` | Timers in a Web Worker, which keep running with the tab in the background |
| `src/lib/settings.js`, `src/lib/storage.js` | Every stored setting in one list (see below) and the raw `localStorage` access behind it |
| `src/lib/events.js` | Tiny event emitter used by the app state and the session |
| `src/lib/dom.js`, `src/lib/sound.js` | DOM helpers and beeps |
| `tools/serve.py` | Static server for local development (not deployed) |
| `tests/` | Hardware-free tests by area (`*.test.mjs`, shared data in `fixtures.mjs`): `npm test` |

## Supported treadmills

| Treadmill | Driver | Status |
|---|---|---|
| NordicTrack EXP 5i (iFit Bluetooth) | `nordictrack-exp5i` | Tested on the real treadmill |
| Treadmills with Bluetooth FTMS (Fitness Machine Service) | `ftms-treadmill` (generic) | Written from the specification and tested against a simulated Bluetooth device; not yet on a real treadmill |

**Connect treadmill** opens one Bluetooth chooser for all of them; the treadmill is recognized by its name (iFit `I_…`) and any other one is tried with FTMS. In every case the belt starts from the console (safety key).

## Stored settings

Everything the app keeps in the browser is listed in `src/lib/settings.js` and saved with the `brickwise.` prefix (nothing is sent anywhere except the API key to Intervals.icu):

| Setting | What |
|---|---|
| `profile`, `athlete`, `wellness`, `tests`, `runs` | Threshold pace / LTHR / max HR and cycling settings, the Intervals.icu account, latest wellness, threshold test history, aerobic run history |
| `tab`, `workout`, `libFilter`, `homeSport` | Last tab, last library workout, library filters, Home sport filter |
| `theme`, `lang` | Color palette and language |
| `intervalsKey` | The Intervals.icu API key (**secret**: never logged or shown) |
| `loadRetry` | Retries when app files fail to download (this visit only) |

## Protocol origin

Everything comes from qdomyos-zwift's `nordictrack_treadmill_exp_5i` profile ([source](https://github.com/cagnulein/qdomyos-zwift/blob/master/src/devices/proformtreadmill/proformtreadmill.cpp)), built from a real capture of an EXP 5i ([issue #2502](https://github.com/cagnulein/qdomyos-zwift/issues/2502)). The message format is in [ianchi/ifit](https://github.com/ianchi/ifit/blob/main/docs/IFIT_PROTOCOL.md).

- **Activation:** 25 packets. They include command `0x90` with a 36-byte code; without it, the treadmill ignores commands.
- **Polling:** a 6-packet cycle every 200 ms. Speed and incline are only sent on step 2.
- **Speed:** `ff 0d 02 04 02 09 04 09 02 01 01 <lo> <hi> 00 <cs>`, in km/h×100 with `cs = lo + hi + 0x11`.
- **Incline:** same packet with `02` in byte 10, in %×100 with `cs = lo + hi + 0x12`.
- **Responses:** arrive in several packets (`fe 02 <length> <n>`, then `00 12 …`, `01 12 …`, `ff …`). They are reassembled and decoded according to the fields the request asked for.
- **Polling cycle:** the first message asks for fields 7, 11, 22, 103 and 116 (uptime, paused time…). The second asks for fields 0, 1, 4, 9, 10, 12, 15, 16, 20, 21, 46, 52, 71, 75, 76 and 96. Among them are requested and actual speed, incline, distance, pulse, mode, time and calories. Its response is 50 bytes long and starts with `00 12 01 04 02 2e`, the packet qdomyos-zwift filters on.
- **Mode:** 1 idle, 2 running, 3 paused, 4 summary, 8 safety key missing, 10 warm-up.
- **Equipment info:** on connect, firmware, serial number, model and the list of supported fields are read.
- **Limits:** on connect, the treadmill's minimum and maximum speed and incline are read (fields 27, 28, 30 and 31), and commands are clamped to them.
- **Actual speed:** on the EXP 5i (firmware 0.1.06122017.0908) field 16 is always 0. With the console running, the requested speed (field 0) is used, which the treadmill confirms in every response.
- **Background tab:** timers run in a Web Worker, so the polling cycle does not slow down when the tab is hidden.

## Troubleshooting

Open the page with `?debug=true` (for example https://ycaceres.github.io/brickwise/?debug=true) and go to the **Debug** tab. Look at **Devices** first. The treadmill's **belt** and **mode** tell you whether the console is running, paused or missing the key, and the equipment info confirms that activation got a response.

Then open **Communication log**, tick **Show TX/RX packets** and use **Download log**. The log includes:
- every decoded response (`= {…}` lines);
- mode changes;
- `Accepted: {"Kph":…}` when the treadmill confirms a speed;
- a warning with the status code when it rejects one.

If the treadmill does not respond, the most likely culprit is the activation code: qdomyos-zwift captured it on a different EXP 5i. In that case you need to capture your unit's code with `ifit discover-activation` from the [`ifit`](https://pypi.org/project/ifit/) package, or with an Android HCI log while using the iFit app.

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
