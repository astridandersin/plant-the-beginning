# Plant the beginning

**Smart plant.** A bedside planter-lamp for the months after TMS treatment for depression. It asks one question each morning, notices when mornings drift from the person's own usual time, learns which gentle wake-up helps them, and gives the clinic one calm line: who to check in with this week. The lamp flags; the clinic decides.

Built solo by Astrid Andersin at Junction 2026 for Aalto University's *Beyond the Clinic* challenge, entered in Best use of Arduino UNO Q and Best Use of Gemini API. A prototype, not a medical device.

- Project page: https://www.astridandersin.com/junction2026/aalto
- Clinic view (simulated people, or "Live lamp" for the real one): https://www.astridandersin.com/junction2026/aalto/clinic

## What's here

| Folder | What it is |
|---|---|
| [`hardware/dawn-lamp/app/`](hardware/dawn-lamp/app/) | The lamp's software for the Arduino UNO Q (App Lab app): `sketch/` runs on the microcontroller (buttons, DHT22, light sensor, soil probe, LED matrix, 12 V strip through TIP120s), `python/` runs on Linux (check-in, rhythm check, learning loop, relay client) with tests and a simulator. Wiring and setup in its README. |
| [`hardware/dawn-lamp/enclosure/`](hardware/dawn-lamp/enclosure/) | The 3D-printed planter: parametric OpenSCAD source, STL files and a browser viewer. |
| [`api/junction2026/`](api/junction2026/), [`api/_lib/junction2026/`](api/_lib/junction2026/) | Vercel serverless functions: the device relay (Upstash Redis) and the guarded Gemini proxy. |
| [`junction2026/aalto/`](junction2026/aalto/) | The project page and the clinic view (plain HTML, CSS and JavaScript). |

## How it works, in short

1. **Check in:** green opens a mood picker on the lamp, + and − choose 1 to 5, green saves. The strip shows the mood in the colours of a rising sun and keeps glowing softly until the next check-in.
2. **Sense:** the first activity of each day, watering, room temperature, humidity and daylight. No camera, no microphone.
3. **Respond and learn:** a gentle wake cue each morning; the lamp tries three styles and estimates (Thompson sampling) which one is followed by steadier mornings for this person.
4. **Flag:** two levels ("keep an eye", "check in") against the person's own weekday and weekend baseline, in both directions. Tested on the public Depresjon dataset: 9 % false alarms among 32 healthy people, 22 of 32 simulated slips caught after a median of 6 days.
5. **Explain:** in the clinic view, Gemini writes a weekly note from the lamp's numbers, with every answer checked on the server (no invented numbers, no diagnostic words, a suggested step only from a fixed list).

## Run the tests

```bash
cd hardware/dawn-lamp/app/python
python3 test_core.py
python3 sim.py | head
```

## Secrets

None are in this repository. The relay needs `DEVICE_TOKEN` and Upstash Redis variables, and the Gemini proxy a Gemini key, all set as Vercel environment variables. On the lamp the token lives in `python/device_token.txt`, which is git-ignored.

## Licence

MIT, see [LICENSE](LICENSE).
