"""
prepare_data.py - Turn the three COVID-19 datasets into the small data file the game loads.

Inputs (data/):
  time_series_covid19_confirmed_global.csv   Johns Hopkins CSSE cumulative confirmed cases
  time_series_covid19_deaths_global.csv      Johns Hopkins CSSE cumulative deaths
  covid_worldwide_daily_compact.csv          Our World in Data (trimmed): cases, deaths, people_vaccinated, population
  owid_full.csv (optional)                   full Our World in Data file, only for the country profile and stringency index

Outputs:
  app/data.js              window.DATA = {...}  (Philippines series, wave windows, calibration targets)
  data/ph_daily.csv        the cleaned Philippine daily series, for the report

Preprocessing steps (shown on the Historical replay screen):
  1. cumulative counts -> daily new counts (difference)
  2. negative corrections clipped to zero
  3. 7-day centred average to remove weekend reporting dips
  4. vaccination gaps filled forward
Run:  python py/prepare_data.py
"""
import json, os
import numpy as np
import pandas as pd

D = "data"
COUNTRY = "Philippines"
INCUBATION, INFECTIOUS = 5.0, 7.0
WAVES = [  # key, label, variant, first day, last day
    ("first", "First wave", "Original strain", "2020-06-15", "2020-10-31"),
    ("delta", "Delta wave", "Delta", "2021-07-11", "2021-11-07"),
    ("omicron", "Omicron wave", "Omicron", "2021-12-20", "2022-03-15"),
]


def jhu(path):
    df = pd.read_csv(os.path.join(D, path))
    row = df[df["Country/Region"] == COUNTRY].drop(columns=["Province/State", "Country/Region", "Lat", "Long"]).sum()
    s = pd.Series(row.values.astype(float), index=pd.to_datetime(row.index, format="%m/%d/%y"))
    return s


def daily(cum):
    d = cum.diff().fillna(cum.iloc[0])
    negatives = int((d < 0).sum())
    return d.clip(lower=0), negatives


cases_cum, deaths_cum = jhu("time_series_covid19_confirmed_global.csv"), jhu("time_series_covid19_deaths_global.csv")
cases, neg_c = daily(cases_cum)
deaths, neg_d = daily(deaths_cum)
cases7 = cases.rolling(7, center=True, min_periods=1).mean()
deaths7 = deaths.rolling(7, center=True, min_periods=1).mean()

ow = pd.read_csv(os.path.join(D, "covid_worldwide_daily_compact.csv"), low_memory=False)
ph = ow[ow.iso_code == "PHL"].copy()
ph["date"] = pd.to_datetime(ph.date)
ph = ph.set_index("date").sort_index()
population = float(ph.population.dropna().iloc[-1])
vacc = (ph.people_vaccinated.ffill() / population * 100).reindex(cases.index).ffill().fillna(0)

profile = {"population": population}
strg = pd.Series(np.nan, index=cases.index)
full_vacc = pd.Series(np.nan, index=cases.index)
full_path = os.path.join(D, "owid_full.csv")
if os.path.exists(full_path):
    cols = ["iso_code", "date", "median_age", "aged_65_older", "aged_70_older", "hospital_beds_per_thousand",
            "population_density", "stringency_index", "people_fully_vaccinated"]
    f = pd.read_csv(full_path, usecols=cols, low_memory=False)
    f = f[f.iso_code == "PHL"].copy()
    f["date"] = pd.to_datetime(f.date); f = f.set_index("date").sort_index()
    for k in ("median_age", "aged_65_older", "aged_70_older", "hospital_beds_per_thousand", "population_density"):
        profile[k] = float(f[k].dropna().iloc[-1])
    strg = f.stringency_index.reindex(cases.index).ffill()
    full_vacc = (f.people_fully_vaccinated.ffill() / population * 100).reindex(cases.index).ffill().fillna(0)

table = pd.DataFrame({"new_cases": cases, "new_cases_7d": cases7.round(1), "new_deaths": deaths, "new_deaths_7d": deaths7.round(2),
                      "vaccinated_pct": vacc.round(2), "fully_vaccinated_pct": full_vacc.round(2), "stringency_index": strg.round(1)})
table.index.name = "date"
table.to_csv(os.path.join(D, "ph_daily.csv"))


def growth_R(series):
    """R from the exponential growth rate on the rising side of a wave (SEIR relation)."""
    s = series[: series.idxmax()]
    lo, hi = 0.15 * series.max(), 0.75 * series.max()
    seg = s[(s >= lo) & (s <= hi)]
    start = seg.index[0] if len(seg) else s.index[0]
    seg = s[start:][lambda x: x <= hi]
    if len(seg) < 7:
        seg = s.iloc[-21:]
    t = np.arange(len(seg)); r = np.polyfit(t, np.log(seg.values.clip(min=1)), 1)[0]
    return float((1 + r * INCUBATION) * (1 + r * INFECTIOUS)), float(r), len(seg)


def best_lag(c, d, max_lag=45):
    c, d = (c - c.mean()) / c.std(), (d - d.mean()) / d.std()
    out = [(float(np.corrcoef(c.values[: len(c) - k], d.values[k:])[0, 1]), k) for k in range(0, max_lag + 1)]
    return max(out)


waves = []
for key, label, variant, a, b in WAVES:
    c, c7, d, d7 = cases[a:b], cases7[a:b], deaths[a:b], deaths7[a:b]
    R, r, n = growth_R(c7)
    month = c.groupby(c.index.to_period("M")).sum()
    corr, lag = best_lag(cases7[a:pd.Timestamp(b) + pd.Timedelta(days=45)], deaths7[a:pd.Timestamp(b) + pd.Timedelta(days=45)])
    waves.append({
        "key": key, "label": label, "variant": variant, "start": a, "end": b, "days": len(c),
        "cases7": [round(float(x), 1) for x in c7], "deaths7": [round(float(x), 2) for x in d7],
        "vaccinated": [round(float(x), 1) for x in vacc[a:b]], "fullyVaccinated": [round(float(x), 1) for x in full_vacc[a:b].fillna(0)],
        "stringency": [None if np.isnan(x) else round(float(x), 1) for x in strg[a:b]],
        "peakDay": c.idxmax().strftime("%Y-%m-%d"), "peakCases": int(c.max()),
        "peak7Day": c7.idxmax().strftime("%Y-%m-%d"), "peak7": round(float(c7.max())),
        "busiestMonth": month.idxmax().strftime("%b %Y"), "busiestMonthCases": int(month.max()),
        "totalCases": int(c.sum()), "totalDeaths": int(d.sum()), "deathsPer100": round(100 * d.sum() / c.sum(), 2),
        "R": round(R, 2), "growthRate": round(r, 4), "fitDays": n, "deathLagDays": lag, "deathLagCorr": round(corr, 2),
    })

out = {
    "country": COUNTRY, "source": {"jhu": "Johns Hopkins CSSE, cumulative confirmed cases and deaths, 22 Jan 2020 to 9 Mar 2023",
                                     "owid": "Our World in Data COVID-19 dataset, 1 Jan 2020 to 14 Aug 2024"},
    "profile": profile, "waves": waves,
    "prep": {"days": int(len(cases)), "first": cases.index[0].strftime("%Y-%m-%d"), "last": cases.index[-1].strftime("%Y-%m-%d"),
             "negativeCaseCorrections": neg_c, "negativeDeathCorrections": neg_d,
             "totalCases": int(cases_cum.iloc[-1]), "totalDeaths": int(deaths_cum.iloc[-1])},
    "assumed": {"incubationDays": INCUBATION, "infectiousDays": INFECTIOUS},
}
os.makedirs("app", exist_ok=True)
open("app/data.js", "w").write("window.DATA = " + json.dumps(out, separators=(",", ":")) + ";\n")
print(json.dumps({k: v for k, v in out.items() if k != "waves"}, indent=1))
for w in waves:
    print({k: v for k, v in w.items() if not isinstance(v, list)})
print("app/data.js", os.path.getsize("app/data.js"), "bytes")
