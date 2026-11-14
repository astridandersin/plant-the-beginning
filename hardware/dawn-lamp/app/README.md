# Plant the beginning: lamp app (Arduino UNO Q, App Lab)

The bedside planter-lamp's software. Two halves, talking over the Bridge:

| Part | Runs on | Does |
|---|---|---|
| `sketch/sketch.ino` | STM32 (Zephyr) | Reads the Modulinos and the soil sensor, draws the LED matrix, drives the light strip / Pixels and the buzzer. No logic. |
| `python/main.py` | Linux | Asks the sketch for a reading every 0.2 s, runs the brain, shows its scene, sends events to the website relay, runs commands from the web. |
| `python/dawn_core.py` | Linux (and laptop) | The brain: mood check-in on the knob (hold 3 s = away), watering, room, camera light and movement, wake cue and reminder, the two-level morning-rhythm check, and the learning loop. Pure Python, tested. |
| `python/camera.py` | Linux | Optional: the kit's USB camera as a light and movement sensor. One tiny grey frame every 5 s becomes two numbers; frames are never stored or sent. |
| `python/relay_client.py` | Linux | Sends events to `/api/junction2026/relay`, keeps an offline queue. |
| `python/sim.py`, `test_core.py` | laptop | Simulated person (14 days) and tests. `sim.py --demo-out` makes the clinic view's demo data. |

Clinic view: `junction2026/aalto/clinic/` on the website (demo patients, or live from this lamp).

## Hardware

Everything runs on the **Arduino UNO Q (2 GB is enough)**. Each part is an option at the top of `sketch/sketch.ino`, so the lamp can be built from what's at hand. Modulinos on the Qwiic connector (Knob, Buzzer, Thermo, Distance, Pixels) are found automatically and win over header parts. **Header parts take 3.3 V only: power them from the 3.3V pin, never 5V.**

### The current build (defaults in the sketch)

| Part | Wiring | Does | Option |
|---|---|---|---|
| Keys **+** and **−**, and a confirm button | **+** to **D2**, **−** to **D8**, confirm to **D11**, other side of each to GND | **green** opens the mood picker (on 3), **+ / −** choose, **green** again saves; hold green 3 s = away. With the picker closed, **+ / −** dim the lamp: off, dim, soft, bright | `MOOD_INPUT 2` |
| Piezo buzzer | **D3** to GND | the chime | `PIEZO 1` |
| DHT22 (or DHT11) on its small board | plugged straight into the UNO Q: **−** in **A1**, **out** in **A2**, **+** in **A3** (the sketch powers it from those pins). Wired instead: + to 3.3V, − to GND, out to A2, and set `DHT_GND_PIN` / `DHT_VCC_PIN` to -1 | room temperature and humidity | `TEMP_SENSOR 2` (3 for DHT11) |
| Grove Digital Light Sensor (TSL2561) | header I2C pins: red 3.3V, black GND, white **SDA**, yellow **SCL** (push male jumper wires into the Grove cable's free end) | room light: daylight, curtains opened | `LIGHT_SENSOR 2` |
| Home-made soil probe | two stripped jumper wires (or stainless screws) in the soil, ~3 cm apart: one from **D4**, one to **A0**, + 10 kΩ from A0 to GND | watering. D4 is on only while reading, which slows corrosion | `SOIL_DIY 1` |
| 12 V RGB strip + 3 transistors | see below | the lamp's warm light | `LIGHT_OUTPUT 3` |

**The 12 V strip with 3 transistors** (TIP120 or IRLZ44N, one per colour). Keep the strip's 12 V adapter; its + and − come from the cut DC extension cable.

```
adapter +12V ──► strip 12V+   (and, optionally, UNO Q VIN: one plug for everything)
adapter −    ──► UNO Q GND    (one shared ground)

TIP120 (flat side facing you, legs: base, collector, emitter)
  D5  ─ 1 kΩ ─► base     collector ─► strip R     emitter ─► GND
  D9  ─ 1 kΩ ─► base     collector ─► strip G     emitter ─► GND
  D10 ─ 1 kΩ ─► base     collector ─► strip B     emitter ─► GND

IRLZ44N instead (legs: gate, drain, source)
  D5/D9/D10 ─ 220 Ω ─► gate (+ 10 kΩ gate to GND)   drain ─► strip R/G/B   source ─► GND
```

12 V may touch **only VIN** on the UNO Q, never 5V, 3.3V or any D/A pin. Keep the USB-C cable for setting it up from the Mac. Use ~30–50 cm of strip, cut at the marked copper lines. If the colours come out wrong, swap the R/G/B wires.

### Other options

- **Mood:** potentiometer (ends to 3.3V and GND, middle to **A1**) + pushbutton on **D2**: `MOOD_INPUT 1`.
- **Temperature:** TMP36 on **A2**: `TEMP_SENSOR 1`.
- **Light sensor:** phototransistor, long leg to 3.3V, short leg to **A3** + 10 kΩ A3 to GND: `LIGHT_SENSOR 1`.
- **Soil:** capacitive sensor, VCC 3.3V, GND, AOUT to **A0**: `SOIL_DIY 0`, and swap `soil_dry_raw` / `soil_wet_raw` in `config.json` (it reads high when dry).
- **Light through an L293D chip** instead of transistors: `LIGHT_OUTPUT 2`. Chip pin 16 → 5V, 8 → +12 V, 4/5/12/13 → GND, 1 and 9 → **D7**, 2/7/10 ← D5/D9/D10, 3/6/11 → strip R/G/B. Keep `strip_max` at 0.6 so the chip stays cool.
- **Small LEDs** (yellow on D5 and D9, red on D10, 220 Ω each): `LIGHT_OUTPUT 1`, `strip_max` 1.0.
- **Addressable strip (WS2812B, 5 V)** on **D6** through 220 Ω: power it from 5V through a diode (or use a 74AHCT125 level shifter), 100 µF across its 5V/GND, then `USE_STRIP 1`, `STRIP_LEDS`, `Adafruit NeoPixel (1.15.5)` in `sketch.yaml`, and `strip_max` 0.3.

## Using the lamp

- **Check in:** green, then + / − (or nothing, for 3), then green. The strip shows the mood's colour while choosing.
- **Colours, "the sun rising":** 1 dim ember, 2 soft peach, 3 warm white, 4 golden, 5 bright and sunny. No mood gets a "sad" colour, and nothing blue glows at night.
- **Between check-ins** the lamp keeps glowing softly in the last mood's colour. **+ / −** (picker closed) work as a dimmer: off, dim, soft, bright. At 22:00 a glow left on drops to dim by itself; a check-in brings it back to soft.
- **Off:** press − until it's dark (a low bump means it's already off). The morning wake cue still comes; it's the alarm, not the reading light.
- **Away:** hold green 3 s (again to come back). Lights off, days not judged.

## Smarter parts

- **Learning what helps this person.** Each day the lamp picks one of three gentle responses (long wake cue with a chime, short silent cue, cue plus a plant reminder) by Thompson sampling. The day is scored by how close the morning was to the person's usual time and their mood. Estimates and their uncertainty go to the clinic view; it says "still learning" until one response clearly leads.
- **Two-level rhythm check, tuned on real data.** Separate weekday and weekend baselines from the person's own first week, rolling after three weeks; early waking counts like sleeping in; the baseline week isn't judged; days the lamp was off or marked away are skipped. "Keep an eye" = the 3-day median is >60 min off on 5 of the last 6 days, or mornings are 2.5x more irregular than usual. "Check in" = 5 off days in a row. On the Depresjon wristband data (32 healthy people, about a week judged each) the lamp's own code reached "check in" for 3 and "keep an eye" for 6; with a simulated 25-min/day slip it caught 22 and 24 of 32.
- **Camera (optional).** Set `"camera": true` in `python/config.json` and add the line in `python/requirements.txt`. Gives room light ("daylight in the room", curtains opened) and movement as first activity. The lamp's own wake-cue glow isn't counted as daylight.
- **Gemini** (on the website, not the board): a weekly clinic note with a suggested step from a fixed list, and a two-line explanation of what the lamp has learned, both checked on the server.

## Install on the board

1. Open Arduino App Lab, connected to the UNO Q.
2. Create a new app called **Plant the beginning**, then replace its files with this folder's `sketch/` and `python/` contents (or copy the folder to `/home/arduino/ArduinoApps/Plant the beginning/` over SSH).
3. Device token: on the board, put the token in `python/device_token.txt` (one line, nothing else) or set `DEVICE_TOKEN` in the app's environment. It must match `DEVICE_TOKEN` in Vercel. Never commit it (the folder's `.gitignore` covers it).
4. Run the app. The console should print `[lamp] Plant the beginning nb-0.2 starting; relay on`.

## First-time checks (2 minutes)

- **Mood keys:** press + once (the picker wakes on 3), press + again (4), then the confirm button: the console should show a check-in of 4. With a Modulino Knob instead: if one click jumps two moods, set `"knob_step": 2` in `python/config.json`.
- **Soil:** note the `s=` raw value in dry soil and right after watering; put them in `soil_dry_raw` / `soil_wet_raw`. The home-made probe reads low when dry (defaults 100 / 2000); a capacitive sensor reads high when dry.
- **Light sensor:** note `l=` with the room dark and with the curtains open; set `daylight_pct` between the two (default 35).
- **Temperature:** `t=` and `h=` should appear within a few seconds. If they never do, check that the DHT's − / out / + sit in A1 / A2 / A3 and `TEMP_SENSOR` (2 = DHT22, 3 = DHT11).
- **Clock:** the board must have the right time (it uses Europe/Helsinki). Check with `date` over SSH.
- **Clinic view:** open `/junction2026/aalto/clinic?live`, press "Play the dawn cue"; the lamp should glow within ~10 s.

## What the lamp sends (flat events, via the relay)

| type | when | fields |
|---|---|---|
| `status` | start, hourly, module change | `fw`, `modules`, `queued` |
| `first_activity` | first knob touch / movement / watering of the day | `source`, `late`, `late_run`, `baseline_at`, `flag` |
| `checkin` | knob pressed and released on a mood | `mood` 1-5, `mood_word`, `late_run`, `flag` (`via: web` from the page) |
| `watering` | soil moisture jumps ≥ 15 points | `soil_before`, `soil_after` |
| `reading` | every 10 min | `temp`, `hum`, `soil` (%), `light` (camera), `motion` |
| `plan` | each morning | `arm` (the response chosen today), `dawn_minutes` |
| `daylight` | room gets bright after a dark night | `light` |
| `away` | knob held 3 s | `on` 1/0 |
| `dawn` | sunrise starts | `trigger` (schedule/remote), `minutes` |
| `reminder` | no check-in 90 min after wake | |
| `day` | day closes (04:00) | first activity, `dev` (minutes from usual), mood, watered, averages, daylight minutes, `away`, `level` (0 steady, 1 keep an eye, 2 check in), `late_run`, `irregular`, `direction`, `arm`, `reward`, and the learning estimates `arm_<name>_mean/lo/hi/days` |

Every event also has `day` (the day starts at 04:00) and `at` (local hh:mm). The relay adds `t` (server time).

**The lamp flags; the clinic decides.** It never diagnoses.

**Privacy:** the relay is readable by anyone with the link. Demo device only: never connect it to a real patient.

## Clean slate before a demo

With the app **stopped** in App Lab, run `./reset-demo.sh` from this folder (add the board's address if it isn't 172.20.10.6). It empties the live history on the website (authorised with the device token, which it never prints) and the lamp's memory of past days, then press **Run**. The learning and the "usual time" start again from zero.

## Test on a laptop

```bash
cd python
python3 test_core.py
python3 sim.py | head
python3 sim.py --demo-out "../../../../junction2026/aalto/clinic/demo.json"
```
