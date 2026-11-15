# Testing the lamp on real data

These scripts test the lamp's "slipping mornings" rule on the public [Depresjon dataset](https://datasets.simula.no/depresjon/) (Simula, Norway): minute-by-minute wrist activity from 23 people with depression and 32 without, about two weeks each. The dataset is not included here; download and unzip it first, so that `data/condition/` and `data/control/` hold the CSV files.

| Script | What it does |
|---|---|
| `rhythm.py` | Finds each day's getting-up time and compares the two groups. |
| `drift.py` | Adds a slow, simulated drift to the real mornings of the control group and measures how fast different rules notice it, and how often they flag by mistake. |
| `brain_on_depresjon.py` | Feeds the real getting-up times into the lamp's actual code (`dawn_core.Brain`), with and without a simulated drift. |

```bash
python3 rhythm.py path/to/data
python3 drift.py path/to/data
python3 brain_on_depresjon.py path/to/data ../app/python
```

`brain_on_depresjon.py` gives the numbers on the project page: with no drift, 3 of 32 people without depression get a "check in" flag (about 9 %); with a drift of 25 minutes a day, 22 of 32 are flagged, after a median of about six days.
