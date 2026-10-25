"""Carnet value — mise à jour automatique des données.

Lancé chaque soir de semaine par GitHub Actions (voir .github/workflows/update.yml).
Pour chaque action enregistrée dans la base :
  - met à jour le cours (toujours) ;
  - met à jour BPA, ROE, marge, dividende, FCF, valeur comptable et dette/EBITDA
    depuis Yahoo Finance, SAUF pour les fiches marquées « vérifiées » sur rapport officiel ;
  - met à jour la ligne de l'année en cours dans l'historique du simulateur.

Source : Yahoo Finance via la bibliothèque yfinance (accès non officiel, gratuit).
Les données peuvent être incomplètes ou temporairement indisponibles.
"""
import datetime
import math
import os
import sys
import time

import requests
import yfinance as yf

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

# Codes Yahoo différents du code de la fiche (sinon : CODE + ".PA" pour Euronext Paris).
# Tu peux aussi ajouter un champ "yahoo" dans une fiche pour forcer un code.
YAHOO = {"STM": "STMPA.PA"}

MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]


def num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(v) or math.isinf(v) else v


def get(collection):
    r = requests.get(f"{URL}/rest/v1/docs", headers=H, timeout=30,
                     params={"select": "id,data", "collection": f"eq.{collection}"})
    r.raise_for_status()
    return {row["id"]: row["data"] for row in r.json()}


def put(rows):
    for i in range(0, len(rows), 50):
        r = requests.post(f"{URL}/rest/v1/docs", json=rows[i:i + 50], timeout=60,
                          headers={**H, "Prefer": "resolution=merge-duplicates"})
        r.raise_for_status()


def fetch(symbol):
    tk = yf.Ticker(symbol)
    info = {}
    try:
        info = tk.info or {}
    except Exception:
        info = {}
    price = num(info.get("currentPrice")) or num(info.get("regularMarketPrice"))
    if price is None:
        hist = tk.history(period="5d")
        if not hist.empty:
            price = num(hist["Close"].iloc[-1])
    return price, info


def main():
    today = datetime.date.today()
    label = f"{today.day} {MOIS[today.month - 1]} {today.year}"
    stocks = get("stocks")
    history = get("history")
    out, errors, updated = [], [], 0

    for code, s in stocks.items():
        symbol = s.get("yahoo") or YAHOO.get(code) or f"{code}.PA"
        try:
            price, info = fetch(symbol)
        except Exception as e:  # réseau, code inconnu…
            errors.append(f"{code}: {e}")
            continue
        if price is None:
            errors.append(f"{code}: cours introuvable ({symbol})")
            continue

        new = dict(s)
        new["price"] = round(price, 2)
        new["updatedAt"] = label

        # Données financières : seulement si la fiche n'a pas été vérifiée sur rapport officiel,
        # et si l'entreprise publie ses comptes en euros (sinon le BPA serait en dollars).
        if not s.get("verified") and info.get("financialCurrency", "EUR") == "EUR":
            eps = num(info.get("trailingEps"))
            roe = num(info.get("returnOnEquity"))
            om = num(info.get("operatingMargins"))
            dps = num(info.get("dividendRate"))
            bv = num(info.get("bookValue"))
            fcf, shares = num(info.get("freeCashflow")), num(info.get("sharesOutstanding"))
            debt, cash, ebitda = num(info.get("totalDebt")), num(info.get("totalCash")), num(info.get("ebitda"))
            if eps is not None:
                new["eps"] = round(eps, 2)
            if roe is not None:
                new["roe"] = round(roe * 100, 1)
            if om is not None:
                new["opMargin"] = round(om * 100, 1)
            if dps is not None:
                new["dps"] = round(dps, 2)
            if bv is not None:
                new["bvps"] = round(bv, 2)
            if fcf is not None and shares:
                new["fcfps"] = round(fcf / shares, 2)
            if debt is not None and cash is not None and ebitda and ebitda > 0:
                new["netDebtEbitda"] = round((debt - cash) / ebitda, 2)
            new["dataSource"] = "Yahoo Finance (automatique, BPA des 12 derniers mois)"

        out.append({"collection": "stocks", "id": code, "data": new})
        updated += 1

        if code in history:
            h = dict(history[code])
            rows = [r for r in h.get("rows", []) if r.get("y") != today.year]
            rows.append({"y": today.year, "price": new["price"], "eps": new.get("eps"), "dps": new.get("dps")})
            h["rows"] = sorted(rows, key=lambda r: r["y"])
            out.append({"collection": "history", "id": code, "data": h})

        time.sleep(0.5)  # rester raisonnable avec Yahoo

    out.append({"collection": "requests", "id": "latest", "data": {
        "status": "done", "doneAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "updated": updated, "errors": errors[:30]}})
    put(out)
    print(f"{updated} action(s) mise(s) à jour, {len(errors)} erreur(s).")
    for e in errors:
        print("  -", e)
    if updated == 0 and stocks:
        sys.exit(1)  # signale un échec dans GitHub si rien n'a marché


if __name__ == "__main__":
    main()
