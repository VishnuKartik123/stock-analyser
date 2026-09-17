from fastapi import FastAPI, HTTPException, Query, Request
from pathlib import Path
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import sqlite3
import os
import hmac
import hashlib
import base64

import yfinance as yf
import pandas as pd
import numpy as np

from datetime import datetime
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor, as_completed
import math
import traceback
import time
import uuid
import gc
import threading
from typing import Optional


# ============================================================
# APP
# ============================================================

app = FastAPI(
    title="Indian Stock Analyzer",
    version="5.0.0"
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    # Quick Tunnel frontend URLs change whenever cloudflared restarts.
    # For this temporary/public demo setup allow all browser origins.
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# PASSWORD AUTHENTICATION
# ============================================================

APP_USERNAME = os.getenv("APP_USERNAME", "").strip()
APP_PASSWORD = os.getenv("APP_PASSWORD", "")
AUTH_TOKEN_DAYS = int(os.getenv("AUTH_TOKEN_DAYS", "7"))


class LoginRequest(BaseModel):
    username: str
    password: str


def _auth_configured():
    return bool(APP_USERNAME and APP_PASSWORD)


def _auth_signing_key() -> bytes:
    # No separate AUTH_SECRET environment variable is required.
    # Derive a signing key from the configured password without exposing it to the frontend.
    return hashlib.sha256(("stock-analyser-auth-v1:" + APP_PASSWORD).encode("utf-8")).digest()


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64url_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def create_auth_token(username: str) -> str:
    expires_at = int(time.time()) + AUTH_TOKEN_DAYS * 24 * 60 * 60
    payload = json.dumps(
        {"username": username, "exp": expires_at},
        separators=(",", ":"),
    ).encode("utf-8")
    payload_part = _b64url_encode(payload)
    signature = hmac.new(
        _auth_signing_key(),
        payload_part.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return f"{payload_part}.{_b64url_encode(signature)}"


def verify_auth_token(token: str):
    if not _auth_configured() or not token or "." not in token:
        return None
    try:
        payload_part, signature_part = token.split(".", 1)
        expected = hmac.new(
            _auth_signing_key(),
            payload_part.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        supplied = _b64url_decode(signature_part)
        if not hmac.compare_digest(expected, supplied):
            return None
        payload = json.loads(_b64url_decode(payload_part).decode("utf-8"))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        if payload.get("username") != APP_USERNAME:
            return None
        return payload
    except Exception:
        return None


@app.middleware("http")
async def require_authentication(request: Request, call_next):
    path = request.url.path
    public_paths = {"/", "/api/health", "/api/auth/login"}

    host_header = (request.headers.get("host") or "").split(":", 1)[0].lower()
    is_local_request = host_header in {"localhost", "127.0.0.1", "::1"}

    if (
        request.method == "OPTIONS"
        or path in public_paths
        or not path.startswith("/api/")
        or is_local_request
    ):
        return await call_next(request)

    if not _auth_configured():
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Authentication is not configured. Set APP_USERNAME and APP_PASSWORD on the server."
            },
        )

    authorization = request.headers.get("Authorization", "")
    token = authorization[7:].strip() if authorization.startswith("Bearer ") else ""
    payload = verify_auth_token(token)
    if not payload:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=401, content={"detail": "Login required"})

    request.state.auth_user = payload.get("username")
    return await call_next(request)


@app.post("/api/auth/login")
def auth_login(credentials: LoginRequest):
    if not _auth_configured():
        raise HTTPException(
            status_code=503,
            detail="Authentication is not configured on the server.",
        )

    username_ok = hmac.compare_digest(credentials.username.strip(), APP_USERNAME)
    password_ok = hmac.compare_digest(credentials.password, APP_PASSWORD)
    if not (username_ok and password_ok):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    return {
        "status": "ok",
        "username": APP_USERNAME,
        "token": create_auth_token(APP_USERNAME),
        "expires_in_days": AUTH_TOKEN_DAYS,
    }


@app.get("/api/auth/me")
def auth_me(request: Request):
    return {"authenticated": True, "username": request.state.auth_user}


# ============================================================
# PAPER TRADING
# ============================================================

STARTING_BALANCE = 100000.0

paper_account = {
    "starting_balance": STARTING_BALANCE,
    "cash": STARTING_BALANCE,
}

paper_positions = {}
paper_trades = []

# ============================================================
# INTRADAY PAPER TRADING
# ============================================================

# Groww advertises intraday trading with up to 5x leverage.
# Exact margin can vary by stock/risk conditions, so this simulator
# uses a 20% margin requirement (= 5x maximum leverage) as the
# Groww-style intraday estimate.
INTRADAY_STARTING_BALANCE = 100000.0
INTRADAY_MARGIN_RATE = 0.20
INTRADAY_MAX_LEVERAGE = 5.0

intraday_paper_account = {
    "starting_balance": INTRADAY_STARTING_BALANCE,
    "balance": INTRADAY_STARTING_BALANCE,
}

# quantity is signed:
#   positive = LONG
#   negative = SHORT
intraday_paper_positions = {}

# ============================================================
# DURABLE INTRADAY TRADE HISTORY
# ============================================================
#
# Executed intraday trades are stored in SQLite so they remain visible
# after Uvicorn reloads, backend restarts, PC restarts, and code updates.
# The database file is created beside main.py.
#
# IMPORTANT:
# Resetting the intraday paper account does NOT delete trade history.
# It only resets balance/open positions/pending orders.
# ============================================================

TRADE_HISTORY_DB = Path(os.getenv("TRADE_HISTORY_DB_PATH", str(Path(__file__).resolve().parent / "stock_analyser_history.db")))
TRADE_HISTORY_DB.parent.mkdir(parents=True, exist_ok=True)


def init_trade_history_db():
    with sqlite3.connect(TRADE_HISTORY_DB) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS intraday_trade_history (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                trade_json TEXT NOT NULL
            )
            """
        )
        connection.commit()


def load_intraday_trade_history():
    init_trade_history_db()

    with sqlite3.connect(TRADE_HISTORY_DB) as connection:
        rows = connection.execute(
            """
            SELECT trade_json
            FROM intraday_trade_history
            ORDER BY timestamp DESC
            """
        ).fetchall()

    trades = []

    for (trade_json,) in rows:
        try:
            trade = json.loads(trade_json)
            if isinstance(trade, dict):
                trades.append(trade)
        except Exception:
            continue

    return trades


def save_intraday_trade(trade):
    if not isinstance(trade, dict):
        return

    trade_id = str(trade.get("id") or uuid.uuid4().hex)
    trade["id"] = trade_id

    timestamp = str(
        trade.get("timestamp") or datetime.now().isoformat()
    )
    trade["timestamp"] = timestamp

    init_trade_history_db()

    with sqlite3.connect(TRADE_HISTORY_DB) as connection:
        connection.execute(
            """
            INSERT INTO intraday_trade_history (
                id,
                timestamp,
                trade_json
            )
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                timestamp = excluded.timestamp,
                trade_json = excluded.trade_json
            """,
            (
                trade_id,
                timestamp,
                json.dumps(
                    trade,
                    ensure_ascii=False,
                    default=str,
                ),
            ),
        )
        connection.commit()


def save_all_intraday_trade_history():
    for trade in intraday_paper_trades:
        save_intraday_trade(trade)


intraday_paper_trades = load_intraday_trade_history()


# ============================================================
# INTRADAY SCANNER LEARNING / END-OF-DAY OBSERVATIONS
# ============================================================
#
# Daily operating plan (India time):
#   09:15-09:45  -> observe only; never qualify a new suggestion
#   09:45-14:45  -> normal strict qualification
#   14:45-15:15  -> conservative qualification
#   15:15-15:30  -> no new suggestions; manage open positions only
#   after 15:30  -> evaluate saved candidates and create a daily review
#
# The learning layer is intentionally conservative. It never "learns" from
# one trade and immediately rewrites the strategy. Historical setup outcomes
# are used only after a minimum sample exists.
# ============================================================

MAX_QUALIFIED_SUGGESTIONS_PER_DAY = 3
QUALIFIED_MIN_SCORE = 6
QUALIFIED_MIN_RISK_REWARD = 1.50
QUALIFIED_MIN_VOLUME_RATIO = 0.80

LATE_SESSION_START_MINUTES = 14 * 60 + 45
NEW_ENTRY_CUTOFF_MINUTES = 15 * 60 + 15
MARKET_SETTLED_MINUTES = 9 * 60 + 45

# Late-session entries must be stronger because less trading time remains.
LATE_QUALIFIED_MIN_SCORE = 7
LATE_QUALIFIED_MIN_RISK_REWARD = 1.80
LATE_QUALIFIED_MIN_VOLUME_RATIO = 1.00

# Do not use historical performance as a gate until enough resolved examples
# exist. This avoids overfitting a handful of trades.
HISTORICAL_MIN_SAMPLE = 20
HISTORICAL_MIN_SUCCESS_RATE = 0.45


def init_scanner_signal_db():
    with sqlite3.connect(TRADE_HISTORY_DB) as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS scanner_signal_history (
                id TEXT PRIMARY KEY,
                trade_date TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                signal_json TEXT NOT NULL
            )
        """)

        # One durable snapshot per symbol/side/date. This includes both
        # qualified and rejected BUY/SELL candidates so later statistics are
        # not based only on trades we liked.
        connection.execute("""
            CREATE TABLE IF NOT EXISTS scanner_candidate_history (
                id TEXT PRIMARY KEY,
                trade_date TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                qualified INTEGER NOT NULL DEFAULT 0,
                resolved INTEGER NOT NULL DEFAULT 0,
                candidate_json TEXT NOT NULL,
                outcome_json TEXT
            )
        """)

        connection.execute("""
            CREATE TABLE IF NOT EXISTS scanner_daily_review (
                trade_date TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                review_json TEXT NOT NULL
            )
        """)

        connection.commit()


def scanner_signal_count_today():
    init_scanner_signal_db()
    day = datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat()
    with sqlite3.connect(TRADE_HISTORY_DB) as connection:
        row = connection.execute(
            "SELECT COUNT(*) FROM scanner_signal_history WHERE trade_date=?",
            (day,),
        ).fetchone()
    return int(row[0] if row else 0)


def store_qualified_signal(result):
    init_scanner_signal_db()
    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    day = now.date().isoformat()
    symbol = clean_symbol(result.get("symbol", ""))
    side = str(result.get("signal", "")).upper()
    signal_id = f"{day}:{symbol}:{side}"

    with sqlite3.connect(TRADE_HISTORY_DB) as connection:
        before = connection.total_changes
        connection.execute(
            """
            INSERT OR IGNORE INTO scanner_signal_history
            (id,trade_date,timestamp,symbol,side,signal_json)
            VALUES (?,?,?,?,?,?)
            """,
            (
                signal_id,
                day,
                now.isoformat(),
                symbol,
                side,
                json.dumps(result, ensure_ascii=False, default=str),
            ),
        )
        connection.commit()
        inserted = connection.total_changes > before

    return signal_id, inserted


def store_scanner_candidate(result):
    """Persist the latest BUY/SELL candidate snapshot for later evaluation."""
    init_scanner_signal_db()

    signal = str(result.get("signal", "")).upper()
    if signal not in ("BUY", "SELL"):
        return None

    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    day = now.date().isoformat()
    symbol = clean_symbol(result.get("symbol", ""))
    candidate_id = f"{day}:{symbol}:{signal}"

    snapshot = dict(result)
    snapshot["candidate_id"] = candidate_id
    snapshot["captured_at"] = now.isoformat()

    with sqlite3.connect(TRADE_HISTORY_DB) as connection:
        existing = connection.execute(
            """
            SELECT resolved
            FROM scanner_candidate_history
            WHERE id=?
            """,
            (candidate_id,),
        ).fetchone()

        # Never overwrite an already resolved historical observation.
        if existing and int(existing[0] or 0) == 1:
            return candidate_id

        connection.execute(
            """
            INSERT INTO scanner_candidate_history
            (id,trade_date,timestamp,symbol,side,qualified,resolved,candidate_json,outcome_json)
            VALUES (?,?,?,?,?,?,0,?,NULL)
            ON CONFLICT(id) DO UPDATE SET
                timestamp=excluded.timestamp,
                qualified=MAX(scanner_candidate_history.qualified, excluded.qualified),
                candidate_json=excluded.candidate_json
            """,
            (
                candidate_id,
                day,
                now.isoformat(),
                symbol,
                signal,
                1 if result.get("qualified") is True else 0,
                json.dumps(snapshot, ensure_ascii=False, default=str),
            ),
        )
        connection.commit()

    return candidate_id


def _historical_setup_stats(side):
    """Return resolved historical performance for a BUY or SELL setup."""
    init_scanner_signal_db()
    side = str(side or "").upper()

    with sqlite3.connect(TRADE_HISTORY_DB) as connection:
        rows = connection.execute(
            """
            SELECT outcome_json
            FROM scanner_candidate_history
            WHERE side=? AND resolved=1 AND outcome_json IS NOT NULL
            ORDER BY trade_date DESC
            LIMIT 250
            """,
            (side,),
        ).fetchall()

    outcomes = []
    for (raw,) in rows:
        try:
            item = json.loads(raw)
            if isinstance(item, dict):
                outcomes.append(item)
        except Exception:
            continue

    sample = len(outcomes)
    successes = sum(
        1 for x in outcomes
        if x.get("result") in ("T1_FIRST", "T2_FIRST")
    )
    failures = sum(1 for x in outcomes if x.get("result") == "SL_FIRST")
    unresolved = max(0, sample - successes - failures)
    success_rate = (successes / sample) if sample else None

    return {
        "sample_size": sample,
        "successes": successes,
        "failures": failures,
        "other": unresolved,
        "success_rate": round(success_rate, 4) if success_rate is not None else None,
        "sufficient_sample": sample >= HISTORICAL_MIN_SAMPLE,
    }


def is_qualified_setup(result):
    """
    Two-level intraday qualification.

    CONFIRMED:
        Passes every normal strategy filter.

    EXECUTABLE:
        Controlled fallback used for otherwise strong BUY/SELL setups when
        the strict gate produces too few opportunities. It never accepts
        WAIT/NO TRADE signals and still requires market/session, score,
        risk/reward, margin, valid trade levels, and historical filter.

    setup_quality is descriptive only; it is not a probability of profit.
    """
    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    minutes = now.hour * 60 + now.minute
    signal = str(result.get("signal", "")).upper()
    score = abs(safe_float(result.get("score")) or 0)
    rr = safe_float(result.get("risk_reward")) or 0
    volume = safe_float(result.get("volume_ratio")) or 0

    settling = (9 * 60 + 15) <= minutes < MARKET_SETTLED_MINUTES
    late_session = LATE_SESSION_START_MINUTES <= minutes < NEW_ENTRY_CUTOFF_MINUTES
    new_entries_allowed = MARKET_SETTLED_MINUTES <= minutes < NEW_ENTRY_CUTOFF_MINUTES

    min_score = LATE_QUALIFIED_MIN_SCORE if late_session else QUALIFIED_MIN_SCORE
    min_rr = (
        LATE_QUALIFIED_MIN_RISK_REWARD
        if late_session
        else QUALIFIED_MIN_RISK_REWARD
    )
    min_volume = (
        LATE_QUALIFIED_MIN_VOLUME_RATIO
        if late_session
        else QUALIFIED_MIN_VOLUME_RATIO
    )

    # Controlled fallback thresholds. Late-session fallback remains stricter.
    executable_min_score = 7 if late_session else 6
    executable_min_rr = 1.60 if late_session else 1.50
    executable_min_volume = 0.85 if late_session else 0.70

    historical = _historical_setup_stats(signal)
    historical_ok = (
        not historical["sufficient_sample"]
        or (
            historical["success_rate"] is not None
            and historical["success_rate"] >= HISTORICAL_MIN_SUCCESS_RATE
        )
    )

    entry = safe_float(result.get("entry_price"))
    stop = safe_float(result.get("stop_loss"))
    target1 = safe_float(result.get("target_1") or result.get("target1"))
    target2 = safe_float(result.get("target_2") or result.get("target2"))

    valid_levels = (
        entry is not None
        and stop is not None
        and target1 is not None
        and target2 is not None
        and (
            (signal == "BUY" and stop < entry < target1 <= target2)
            or (signal == "SELL" and stop > entry > target1 >= target2)
        )
    )

    checks = {
        "market_settled": not settling and minutes >= MARKET_SETTLED_MINUTES,
        "market_open": get_market_status() == "OPEN",
        "new_entries_allowed": new_entries_allowed,
        "buy_or_sell": signal in ("BUY", "SELL"),
        "score": score >= min_score,
        "risk_reward": rr >= min_rr,
        "volume": volume >= min_volume,
        "margin": bool(result.get("margin_band_eligible")),
        "valid_trade_levels": valid_levels,
        "historical_filter": historical_ok,
    }

    executable_checks = {
        "market_settled": checks["market_settled"],
        "market_open": checks["market_open"],
        "new_entries_allowed": checks["new_entries_allowed"],
        "buy_or_sell": checks["buy_or_sell"],
        "score": score >= executable_min_score,
        "risk_reward": rr >= executable_min_rr,
        "volume": volume >= executable_min_volume,
        "margin": checks["margin"],
        "valid_trade_levels": valid_levels,
        "historical_filter": historical_ok,
    }

    strict_qualified = all(checks.values())
    executable = all(executable_checks.values())

    quality = round(sum(bool(x) for x in checks.values()) / len(checks) * 10, 1)

    result["session_phase"] = (
        "MARKET_SETTLING"
        if settling
        else "NORMAL_SCAN"
        if MARKET_SETTLED_MINUTES <= minutes < LATE_SESSION_START_MINUTES
        else "CONSERVATIVE_SCAN"
        if late_session
        else "NO_NEW_ENTRIES"
    )
    result["historical_observation"] = historical
    result["qualification_thresholds"] = {
        "min_score": min_score,
        "min_risk_reward": min_rr,
        "min_volume_ratio": min_volume,
    }
    result["executable_thresholds"] = {
        "min_score": executable_min_score,
        "min_risk_reward": executable_min_rr,
        "min_volume_ratio": executable_min_volume,
    }
    result["strict_qualified"] = strict_qualified
    result["executable"] = executable
    result["executable_checks"] = executable_checks

    return strict_qualified, quality, checks

def _candidate_outcome_from_intraday_data(candidate, df):
    """Evaluate which level was reached first after a candidate was captured."""
    if df is None or df.empty:
        return None

    side = str(candidate.get("signal") or candidate.get("side") or "").upper()
    entry = safe_float(candidate.get("entry_price"))
    stop = safe_float(candidate.get("stop_loss"))
    t1 = safe_float(candidate.get("target_1") or candidate.get("target1"))
    t2 = safe_float(candidate.get("target_2") or candidate.get("target2"))

    if side not in ("BUY", "SELL") or entry is None or stop is None or t1 is None:
        return None

    captured_at = candidate.get("captured_at") or candidate.get("last_update")
    working = df.copy()

    try:
        if captured_at:
            captured = pd.Timestamp(captured_at)
            if working.index.tz is not None:
                if captured.tzinfo is None:
                    captured = captured.tz_localize("Asia/Kolkata")
                captured = captured.tz_convert(working.index.tz)
            elif captured.tzinfo is not None:
                captured = captured.tz_convert("Asia/Kolkata").tz_localize(None)
            working = working[working.index >= captured]
    except Exception:
        pass

    if working.empty:
        return None

    mfe = 0.0
    mae = 0.0
    first_event = None
    first_event_time = None
    first_event_price = None
    t2_hit_anytime = False

    for idx, row in working.iterrows():
        high = safe_float(row.get("High"))
        low = safe_float(row.get("Low"))
        if high is None or low is None:
            continue

        if side == "BUY":
            mfe = max(mfe, high - entry)
            mae = max(mae, entry - low)
            sl_hit = low <= stop
            t1_hit = high >= t1
            t2_hit = t2 is not None and high >= t2
        else:
            mfe = max(mfe, entry - low)
            mae = max(mae, high - entry)
            sl_hit = high >= stop
            t1_hit = low <= t1
            t2_hit = t2 is not None and low <= t2

        t2_hit_anytime = t2_hit_anytime or t2_hit

        # With OHLC candles we cannot know the intrabar order if both stop and
        # target are touched in the same candle. Mark it ambiguous rather than
        # inventing a winner.
        if first_event is None:
            if sl_hit and (t1_hit or t2_hit):
                first_event = "AMBIGUOUS_SAME_CANDLE"
                first_event_time = str(idx)
                first_event_price = None
            elif sl_hit:
                first_event = "SL_FIRST"
                first_event_time = str(idx)
                first_event_price = stop
            elif t2_hit:
                first_event = "T2_FIRST"
                first_event_time = str(idx)
                first_event_price = t2
            elif t1_hit:
                first_event = "T1_FIRST"
                first_event_time = str(idx)
                first_event_price = t1

    last_close = safe_float(working.iloc[-1].get("Close"))

    if first_event is None:
        first_event = "NO_LEVEL_HIT"

    return {
        "resolved_at": datetime.now(ZoneInfo("Asia/Kolkata")).isoformat(),
        "result": first_event,
        "first_event_time": first_event_time,
        "first_event_price": first_event_price,
        "t2_hit_anytime": bool(t2_hit_anytime),
        "mfe_per_share": round(mfe, 4),
        "mae_per_share": round(mae, 4),
        "last_close": last_close,
        "entry_price": entry,
        "stop_loss": stop,
        "target_1": t1,
        "target_2": t2,
    }


def run_end_of_day_review(trade_date=None, force=False):
    """
    Resolve saved scanner candidates after the NSE session and persist a
    durable daily report. Safe to call repeatedly.
    """
    init_scanner_signal_db()
    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    day = str(trade_date or now.date().isoformat())
    minutes = now.hour * 60 + now.minute

    if not force and day == now.date().isoformat() and minutes < (15 * 60 + 30):
        return {
            "status": "waiting_for_market_close",
            "trade_date": day,
            "message": "End-of-day review becomes available after 15:30 IST.",
        }

    with sqlite3.connect(TRADE_HISTORY_DB) as connection:
        rows = connection.execute(
            """
            SELECT id, candidate_json, qualified, resolved, outcome_json
            FROM scanner_candidate_history
            WHERE trade_date=?
            ORDER BY timestamp ASC
            """,
            (day,),
        ).fetchall()

    resolved_now = 0
    outcomes = []

    for candidate_id, raw_candidate, qualified, resolved, raw_outcome in rows:
        try:
            candidate = json.loads(raw_candidate)
        except Exception:
            continue

        if resolved and raw_outcome:
            try:
                outcomes.append({
                    "candidate": candidate,
                    "qualified": bool(qualified),
                    "outcome": json.loads(raw_outcome),
                })
            except Exception:
                pass
            continue

        symbol = clean_symbol(candidate.get("symbol", ""))
        if not symbol:
            continue

        df = None
        try:
            df = get_history(symbol, "5d", "5m")
            outcome = _candidate_outcome_from_intraday_data(candidate, df)
        except Exception as error:
            outcome = {
                "resolved_at": now.isoformat(),
                "result": "DATA_ERROR",
                "error": str(error),
            }
        finally:
            if df is not None:
                del df

        if not outcome:
            continue

        with sqlite3.connect(TRADE_HISTORY_DB) as connection:
            connection.execute(
                """
                UPDATE scanner_candidate_history
                SET resolved=1, outcome_json=?
                WHERE id=?
                """,
                (
                    json.dumps(outcome, ensure_ascii=False, default=str),
                    candidate_id,
                ),
            )
            connection.commit()

        resolved_now += 1
        outcomes.append({
            "candidate": candidate,
            "qualified": bool(qualified),
            "outcome": outcome,
        })

    total = len(outcomes)
    qualified_count = sum(1 for x in outcomes if x["qualified"])
    t1_or_t2 = sum(
        1 for x in outcomes
        if x["outcome"].get("result") in ("T1_FIRST", "T2_FIRST")
    )
    stop_first = sum(
        1 for x in outcomes if x["outcome"].get("result") == "SL_FIRST"
    )
    ambiguous = sum(
        1 for x in outcomes
        if x["outcome"].get("result") == "AMBIGUOUS_SAME_CANDLE"
    )

    review = {
        "trade_date": day,
        "created_at": now.isoformat(),
        "candidate_count": total,
        "qualified_count": qualified_count,
        "target_first_count": t1_or_t2,
        "stop_first_count": stop_first,
        "ambiguous_count": ambiguous,
        "resolved_now": resolved_now,
        "buy_history": _historical_setup_stats("BUY"),
        "sell_history": _historical_setup_stats("SELL"),
        "learning_policy": {
            "minimum_sample_before_filtering": HISTORICAL_MIN_SAMPLE,
            "minimum_success_rate": HISTORICAL_MIN_SUCCESS_RATE,
            "note": (
                "Historical outcomes are an additional filter only after "
                "the minimum sample is reached; one day never rewrites the strategy."
            ),
        },
    }

    with sqlite3.connect(TRADE_HISTORY_DB) as connection:
        connection.execute(
            """
            INSERT INTO scanner_daily_review (trade_date,created_at,review_json)
            VALUES (?,?,?)
            ON CONFLICT(trade_date) DO UPDATE SET
                created_at=excluded.created_at,
                review_json=excluded.review_json
            """,
            (
                day,
                now.isoformat(),
                json.dumps(review, ensure_ascii=False, default=str),
            ),
        )
        connection.commit()

    return {"status": "success", "review": review}


def load_daily_review(trade_date=None):
    init_scanner_signal_db()
    day = str(
        trade_date
        or datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat()
    )

    with sqlite3.connect(TRADE_HISTORY_DB) as connection:
        row = connection.execute(
            """
            SELECT review_json
            FROM scanner_daily_review
            WHERE trade_date=?
            """,
            (day,),
        ).fetchone()

    if not row:
        return None

    try:
        return json.loads(row[0])
    except Exception:
        return None


init_scanner_signal_db()

# LIMIT orders that are waiting for the market price to reach
# the requested BUY / SELL price.
intraday_pending_orders = []


def rebuild_paper_state(trades):
    """Rebuild paper cash and positions from the remaining executed trades.

    Trades are stored newest-first, so replay them oldest-first using their
    recorded execution prices. This keeps cash, quantities and average prices
    consistent when a paper order is removed.
    """

    cash = STARTING_BALANCE
    positions = {}

    for trade in reversed(trades):
        symbol = clean_symbol(trade.get("symbol", ""))
        side = str(trade.get("side", "")).upper()
        quantity = int(trade.get("quantity", 0) or 0)
        price = safe_float(trade.get("price"))

        if not symbol or side not in ["BUY", "SELL"] or quantity <= 0 or price is None:
            raise ValueError("Trade history contains an invalid paper order")

        value = price * quantity

        if side == "BUY":
            if cash < value:
                raise ValueError(
                    f"Removing this order would make the remaining history invalid: "
                    f"insufficient cash for a later BUY of {symbol}."
                )

            cash -= value

            if symbol in positions:
                old_qty = positions[symbol]["quantity"]
                old_avg = positions[symbol]["average_price"]
                new_qty = old_qty + quantity
                new_avg = ((old_qty * old_avg) + (quantity * price)) / new_qty
                positions[symbol] = {
                    "quantity": new_qty,
                    "average_price": new_avg,
                }
            else:
                positions[symbol] = {
                    "quantity": quantity,
                    "average_price": price,
                }

        else:
            if symbol not in positions or positions[symbol]["quantity"] < quantity:
                raise ValueError(
                    f"Removing this order would make the remaining history invalid: "
                    f"a later SELL of {symbol} would not have enough shares."
                )

            cash += value
            positions[symbol]["quantity"] -= quantity

            if positions[symbol]["quantity"] == 0:
                del positions[symbol]

    return cash, positions

# Intraday scanner cache. This prevents every public visitor from
# triggering 50+ Yahoo Finance downloads at the same time.
SCANNER_CACHE_TTL_SECONDS = 60
# Keep scanner concurrency deliberately small on memory-constrained hosts
# such as Render's 512 MB instances. Override with SCANNER_MAX_WORKERS if needed.
SCANNER_MAX_WORKERS = max(1, min(2, int(os.getenv("SCANNER_MAX_WORKERS", "1"))))
scanner_cache = {}

# Only one expensive full-market scan may download/process data at a time.
# Concurrent HTTP requests will wait here and then reuse the fresh cache.
scanner_execution_lock = threading.Lock()


class OrderRequest(BaseModel):
    symbol: str
    side: str
    quantity: int
    order_type: str = "MARKET"
    limit_price: Optional[float] = None
    order_value: Optional[float] = None
    stop_loss: Optional[float] = None


class IntradayExitTargetRequest(BaseModel):
    symbol: str
    target_price: float


# ============================================================
# SYMBOL MAP
# ============================================================

INDEX_SYMBOLS = {
    "NIFTY": "^NSEI",
    "NIFTY50": "^NSEI",
    "NIFTY 50": "^NSEI",

    "BANKNIFTY": "^NSEBANK",
    "BANK NIFTY": "^NSEBANK",

    "NIFTYIT": "^CNXIT",
    "NIFTY IT": "^CNXIT",

    "NIFTY100": "^CNX100",
    "NIFTY 100": "^CNX100",

    "NIFTY NEXT 50": "^NSMIDCP",
}


# ============================================================
# STOCK DATABASE
# ============================================================

COMMON_STOCKS = [
    ("RELIANCE", "Reliance Industries"),
    ("TCS", "Tata Consultancy Services"),
    ("INFY", "Infosys"),
    ("HDFCBANK", "HDFC Bank"),
    ("ICICIBANK", "ICICI Bank"),
    ("SBIN", "State Bank of India"),
    ("BHARTIARTL", "Bharti Airtel"),
    ("ITC", "ITC Limited"),
    ("LT", "Larsen & Toubro"),
    ("AXISBANK", "Axis Bank"),
    ("KOTAKBANK", "Kotak Mahindra Bank"),
    ("MARUTI", "Maruti Suzuki"),
    ("TATAMOTORS", "Tata Motors"),
    ("SUNPHARMA", "Sun Pharmaceutical"),
    ("WIPRO", "Wipro"),
    ("HCLTECH", "HCL Technologies"),
    ("ADANIENT", "Adani Enterprises"),
    ("ADANIPORTS", "Adani Ports"),
    ("TITAN", "Titan Company"),
    ("BAJFINANCE", "Bajaj Finance"),
    ("ASIANPAINT", "Asian Paints"),
    ("ULTRACEMCO", "UltraTech Cement"),
    ("NTPC", "NTPC"),
    ("POWERGRID", "Power Grid Corporation"),
    ("ONGC", "Oil & Natural Gas Corporation"),
    ("COALINDIA", "Coal India"),
    ("TATASTEEL", "Tata Steel"),
    ("JSWSTEEL", "JSW Steel"),
    ("HINDALCO", "Hindalco Industries"),
    ("TECHM", "Tech Mahindra"),
    ("INDUSINDBK", "IndusInd Bank"),
    ("DRREDDY", "Dr. Reddy's Laboratories"),
    ("CIPLA", "Cipla"),
    ("DIVISLAB", "Divi's Laboratories"),
    ("EICHERMOT", "Eicher Motors"),
    ("HEROMOTOCO", "Hero MotoCorp"),
    ("BAJAJ-AUTO", "Bajaj Auto"),
    ("BAJAJFINSV", "Bajaj Finserv"),
    ("APOLLOHOSP", "Apollo Hospitals"),
    ("BEL", "Bharat Electronics"),
    ("HAL", "Hindustan Aeronautics"),
    ("TRENT", "Trent"),
    ("ETERNAL", "Eternal"),
    ("JIOFIN", "Jio Financial Services"),
    ("SHRIRAMFIN", "Shriram Finance"),
    ("M&M", "Mahindra & Mahindra"),
    ("NESTLEIND", "Nestle India"),
    ("HINDUNILVR", "Hindustan Unilever"),
    ("BRITANNIA", "Britannia Industries"),
    ("DABUR", "Dabur India"),
    ("PIDILITIND", "Pidilite Industries"),
    ("SIEMENS", "Siemens"),
    ("ABB", "ABB India"),
    ("INDIGO", "InterGlobe Aviation"),
]


# ============================================================
# HELPERS
# ============================================================

def clean_symbol(symbol: str) -> str:
    if not symbol:
        return ""

    symbol = str(symbol).strip().upper()

    if symbol.endswith(".NS"):
        symbol = symbol[:-3]

    return symbol


def yahoo_symbol(symbol: str) -> str:
    clean = clean_symbol(symbol)

    if clean in INDEX_SYMBOLS:
        return INDEX_SYMBOLS[clean]

    return f"{clean}.NS"


def is_index(symbol: str) -> bool:
    return clean_symbol(symbol) in INDEX_SYMBOLS


def safe_float(value):
    try:
        if value is None:
            return None

        value = float(value)

        if math.isnan(value) or math.isinf(value):
            return None

        return value

    except Exception:
        return None


def get_ticker(symbol: str):
    return yf.Ticker(yahoo_symbol(symbol))


# ============================================================
# DAILY INDICATORS
# ============================================================

def calculate_indicators(df: pd.DataFrame):

    if df is None or df.empty:
        raise ValueError("No market data available")

    df = df.copy()

    df["SMA20"] = df["Close"].rolling(20).mean()
    df["SMA50"] = df["Close"].rolling(50).mean()

    df["EMA20"] = df["Close"].ewm(
        span=20,
        adjust=False
    ).mean()

    delta = df["Close"].diff()

    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.rolling(14).mean()
    avg_loss = loss.rolling(14).mean()

    rs = avg_gain / avg_loss.replace(0, np.nan)

    df["RSI14"] = 100 - (
        100 / (1 + rs)
    )

    ema12 = df["Close"].ewm(
        span=12,
        adjust=False
    ).mean()

    ema26 = df["Close"].ewm(
        span=26,
        adjust=False
    ).mean()

    df["MACD"] = ema12 - ema26

    df["MACD_SIGNAL"] = df["MACD"].ewm(
        span=9,
        adjust=False
    ).mean()

    df["MACD_HIST"] = (
        df["MACD"] -
        df["MACD_SIGNAL"]
    )

    df["BB_MIDDLE"] = (
        df["Close"].rolling(20).mean()
    )

    std = df["Close"].rolling(20).std()

    df["BB_UPPER"] = (
        df["BB_MIDDLE"] +
        2 * std
    )

    df["BB_LOWER"] = (
        df["BB_MIDDLE"] -
        2 * std
    )

    return df


# ============================================================
# DAILY DATA CONVERTER
# ============================================================

def dataframe_to_records(df):

    records = []

    if df is None or df.empty:
        return records

    for index, row in df.iterrows():

        timestamp = index

        if hasattr(timestamp, "isoformat"):
            timestamp = timestamp.isoformat()

        records.append({
            "time": timestamp,

            "open": safe_float(row.get("Open")),
            "high": safe_float(row.get("High")),
            "low": safe_float(row.get("Low")),
            "close": safe_float(row.get("Close")),
            "volume": safe_float(row.get("Volume")),

            "sma20": safe_float(row.get("SMA20")),
            "sma50": safe_float(row.get("SMA50")),
            "ema20": safe_float(row.get("EMA20")),

            "rsi14": safe_float(row.get("RSI14")),

            "macd": safe_float(row.get("MACD")),
            "macd_signal": safe_float(
                row.get("MACD_SIGNAL")
            ),

            "macd_histogram": safe_float(
                row.get("MACD_HIST")
            ),

            "bb_upper": safe_float(
                row.get("BB_UPPER")
            ),

            "bb_middle": safe_float(
                row.get("BB_MIDDLE")
            ),

            "bb_lower": safe_float(
                row.get("BB_LOWER")
            ),
        })

    return records


# ============================================================
# DAILY SIGNAL
# ============================================================

def generate_signal(df):

    if df is None or df.empty:
        return {
            "signal": "HOLD",
            "score": 0,
            "sentiment": "Neutral",
            "reasons": [],
        }

    latest = df.iloc[-1]

    close = safe_float(latest["Close"])
    sma20 = safe_float(latest["SMA20"])
    sma50 = safe_float(latest["SMA50"])
    ema20 = safe_float(latest["EMA20"])
    rsi = safe_float(latest["RSI14"])
    macd = safe_float(latest["MACD"])
    macd_signal = safe_float(
        latest["MACD_SIGNAL"]
    )

    score = 0
    reasons = []

    if close is not None and sma20 is not None:

        if close > sma20:
            score += 1
            reasons.append("Price is above SMA 20")
        else:
            score -= 1
            reasons.append("Price is below SMA 20")

    if close is not None and sma50 is not None:

        if close > sma50:
            score += 1
            reasons.append("Price is above SMA 50")
        else:
            score -= 1
            reasons.append("Price is below SMA 50")

    if close is not None and ema20 is not None:

        if close > ema20:
            score += 1
            reasons.append("Price is above EMA 20")
        else:
            score -= 1
            reasons.append("Price is below EMA 20")

    if rsi is not None:

        if rsi < 30:
            score += 2
            reasons.append(
                "RSI indicates oversold condition"
            )

        elif rsi > 70:
            score -= 2
            reasons.append(
                "RSI indicates overbought condition"
            )

        elif rsi >= 50:
            score += 1
            reasons.append("RSI is above 50")

        else:
            score -= 1
            reasons.append("RSI is below 50")

    if macd is not None and macd_signal is not None:

        if macd > macd_signal:
            score += 2
            reasons.append(
                "MACD is above signal line"
            )

        else:
            score -= 2
            reasons.append(
                "MACD is below signal line"
            )

    if score >= 4:
        signal = "BUY"
        sentiment = "Bullish"

    elif score <= -4:
        signal = "SELL"
        sentiment = "Bearish"

    else:
        signal = "HOLD"
        sentiment = "Neutral"

    return {
        "signal": signal,
        "score": score,
        "sentiment": sentiment,
        "reasons": reasons,
    }


# ============================================================
# HISTORY
# ============================================================

def get_history(
    symbol: str,
    period: str = "6mo",
    interval: str = "1d"
):

    ticker = get_ticker(symbol)

    df = ticker.history(
        period=period,
        interval=interval,
        auto_adjust=False
    )

    if df is None or df.empty:
        raise ValueError(
            f"No market data found for {symbol}"
        )

    return df


# ============================================================
# INTRADAY INDICATORS
# ============================================================

def calculate_intraday_indicators(df):

    if df is None or df.empty:
        raise ValueError(
            "No intraday data available"
        )

    df = df.copy()

    # --------------------------------------------------------
    # EMA 9 / EMA 20
    # --------------------------------------------------------

    df["EMA9"] = df["Close"].ewm(
        span=9,
        adjust=False
    ).mean()

    df["EMA20"] = df["Close"].ewm(
        span=20,
        adjust=False
    ).mean()

    # --------------------------------------------------------
    # RSI 14
    # --------------------------------------------------------

    delta = df["Close"].diff()

    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.rolling(14).mean()
    avg_loss = loss.rolling(14).mean()

    rs = avg_gain / avg_loss.replace(
        0,
        np.nan
    )

    df["RSI14"] = 100 - (
        100 / (1 + rs)
    )

    # --------------------------------------------------------
    # MACD 12 / 26 / 9
    # --------------------------------------------------------

    ema12 = df["Close"].ewm(
        span=12,
        adjust=False
    ).mean()

    ema26 = df["Close"].ewm(
        span=26,
        adjust=False
    ).mean()

    df["MACD"] = ema12 - ema26
    df["MACD_SIGNAL"] = df["MACD"].ewm(
        span=9,
        adjust=False
    ).mean()

    # --------------------------------------------------------
    # VWAP
    # --------------------------------------------------------

    typical_price = (
        df["High"] +
        df["Low"] +
        df["Close"]
    ) / 3

    volume = df["Volume"].replace(
        0,
        np.nan
    )

    cumulative_volume = volume.cumsum()

    cumulative_pv = (
        typical_price * volume
    ).cumsum()

    df["VWAP"] = (
        cumulative_pv /
        cumulative_volume
    )

    # --------------------------------------------------------
    # ATR 14
    # --------------------------------------------------------

    previous_close = df["Close"].shift(1)

    tr1 = (
        df["High"] -
        df["Low"]
    )

    tr2 = (
        df["High"] -
        previous_close
    ).abs()

    tr3 = (
        df["Low"] -
        previous_close
    ).abs()

    true_range = pd.concat(
        [tr1, tr2, tr3],
        axis=1
    ).max(axis=1)

    df["ATR14"] = (
        true_range
        .rolling(14)
        .mean()
    )

    # --------------------------------------------------------
    # Volume ratio
    # --------------------------------------------------------

    df["VOLUME_AVG20"] = (
        df["Volume"]
        .rolling(20)
        .mean()
    )

    df["VOLUME_RATIO"] = (
        df["Volume"] /
        df["VOLUME_AVG20"].replace(
            0,
            np.nan
        )
    )

    return df


# ============================================================
# OPENING RANGE
# ============================================================

def get_opening_range(df):

    if df is None or df.empty:
        return None, None

    working = df.copy()

    try:

        if working.index.tz is not None:
            local_index = (
                working.index
                .tz_convert("Asia/Kolkata")
            )
        else:
            local_index = working.index

        working["local_time"] = local_index

        # First 15 minutes of NSE session
        opening = working[
            (
                working["local_time"].dt.hour == 9
            )
            &
            (
                working["local_time"].dt.minute >= 15
            )
            &
            (
                working["local_time"].dt.minute < 30
            )
        ]

        if opening.empty:
            # Fallback: first three 5-minute candles
            opening = working.head(3)

        if opening.empty:
            return None, None

        opening_high = safe_float(
            opening["High"].max()
        )

        opening_low = safe_float(
            opening["Low"].min()
        )

        return opening_high, opening_low

    except Exception:

        opening = working.head(3)

        if opening.empty:
            return None, None

        return (
            safe_float(opening["High"].max()),
            safe_float(opening["Low"].min()),
        )


# ============================================================
# INTRADAY SUPPORT / RESISTANCE
# ============================================================

def get_support_resistance(df):

    if df is None or df.empty:
        return None, None

    recent = df.tail(
        min(len(df), 48)
    )

    support = safe_float(
        recent["Low"].min()
    )

    resistance = safe_float(
        recent["High"].max()
    )

    return support, resistance


# ============================================================
# MARKET STATUS
# ============================================================

def get_market_status():
    now = datetime.now(ZoneInfo("Asia/Kolkata"))

    if now.weekday() >= 5:
        return "CLOSED"

    minutes = now.hour * 60 + now.minute
    open_minutes = 9 * 60 + 15
    close_minutes = 15 * 60 + 30

    if open_minutes <= minutes <= close_minutes:
        return "OPEN"

    return "CLOSED"


# ============================================================
# INTRADAY SIGNAL ENGINE
# ============================================================

def generate_intraday_signal(
    df,
    symbol="",
    risk_percent=1.0
):

    if df is None or df.empty:
        raise ValueError(
            "No intraday data available"
        )

    if len(df) < 25:
        raise ValueError(
            "Not enough intraday candles for analysis"
        )

    latest = df.iloc[-1]

    price = safe_float(
        latest["Close"]
    )

    vwap = safe_float(
        latest["VWAP"]
    )

    ema9 = safe_float(
        latest["EMA9"]
    )

    ema20 = safe_float(
        latest["EMA20"]
    )

    rsi = safe_float(
        latest["RSI14"]
    )

    macd = safe_float(
        latest.get("MACD")
    )

    macd_signal = safe_float(
        latest.get("MACD_SIGNAL")
    )

    atr = safe_float(
        latest["ATR14"]
    )

    volume_ratio = safe_float(
        latest["VOLUME_RATIO"]
    )

    if price is None:
        raise ValueError(
            "Invalid current price"
        )

    opening_high, opening_low = (
        get_opening_range(df)
    )

    support, resistance = (
        get_support_resistance(df)
    )

    score = 0
    reasons = []
    warnings = []

    # ========================================================
    # VWAP
    # ========================================================

    if vwap is not None:

        if price > vwap:
            score += 2
            reasons.append(
                "Price is above VWAP"
            )
        else:
            score -= 2
            reasons.append(
                "Price is below VWAP"
            )

    # ========================================================
    # EMA 9 / EMA 20
    # ========================================================

    if (
        ema9 is not None
        and ema20 is not None
    ):

        if ema9 > ema20:
            score += 2
            reasons.append(
                "EMA 9 is above EMA 20"
            )
        else:
            score -= 2
            reasons.append(
                "EMA 9 is below EMA 20"
            )

    # ========================================================
    # RSI
    # ========================================================

    if rsi is not None:

        if 50 <= rsi <= 70:

            score += 1

            reasons.append(
                "RSI supports bullish momentum"
            )

        elif 30 <= rsi < 50:

            score -= 1

            reasons.append(
                "RSI shows weak momentum"
            )

        elif rsi > 70:

            warnings.append(
                "RSI is overbought"
            )

        elif rsi < 30:

            warnings.append(
                "RSI is oversold"
            )

    # ========================================================
    # MACD
    # ========================================================

    if macd is not None and macd_signal is not None:

        if macd > macd_signal:
            score += 1
            reasons.append(
                "MACD is above its signal line"
            )
        else:
            score -= 1
            reasons.append(
                "MACD is below its signal line"
            )

    # ========================================================
    # VOLUME
    # ========================================================

    if volume_ratio is not None:

        if volume_ratio >= 1.5:

            if score > 0:
                score += 2
            elif score < 0:
                score -= 2

            reasons.append(
                f"Strong volume confirmation ({volume_ratio:.2f}x)"
            )

        elif volume_ratio >= 1.0:

            if score > 0:
                score += 1
            elif score < 0:
                score -= 1

            reasons.append(
                f"Volume is above average ({volume_ratio:.2f}x)"
            )

        else:

            warnings.append(
                "Volume confirmation is weak"
            )

    # ========================================================
    # OPENING RANGE BREAKOUT
    # ========================================================

    breakout = "NONE"

    if (
        opening_high is not None
        and opening_low is not None
    ):

        if price > opening_high:

            breakout = "BULLISH"
            score += 2

            reasons.append(
                "Price broke above the opening range"
            )

        elif price < opening_low:

            breakout = "BEARISH"
            score -= 2

            reasons.append(
                "Price broke below the opening range"
            )

        else:

            reasons.append(
                "Price remains inside the opening range"
            )

    # ========================================================
    # DETERMINE SIGNAL
    # ========================================================

    if score >= 6:

        signal = "BUY"

    elif score <= -6:

        signal = "SELL"

    elif score >= 4:

        signal = "WAIT"

        warnings.append(
            "Bullish setup is not strong enough for confirmation"
        )

    elif score <= -4:

        signal = "WAIT"

        warnings.append(
            "Bearish setup is not strong enough for confirmation"
        )

    else:

        signal = "NO TRADE"

        warnings.append(
            "Indicators are not aligned"
        )

    # ========================================================
    # ENTRY
    # ========================================================

    entry_low = None
    entry_high = None

    if signal == "BUY":

        if vwap is not None:
            entry_low = min(
                price,
                vwap
            )
        else:
            entry_low = price

        entry_high = price

    elif signal == "SELL":

        entry_low = price

        if vwap is not None:
            entry_high = max(
                price,
                vwap
            )
        else:
            entry_high = price

    # ========================================================
    # STOP LOSS
    # ========================================================

    stop_loss = None

    if atr is not None and atr > 0:

        if signal == "BUY":

            stop_loss = price - (
                1.2 * atr
            )

        elif signal == "SELL":

            stop_loss = price + (
                1.2 * atr
            )

    # Use recent support/resistance
    if signal == "BUY":

        if (
            support is not None
            and support < price
        ):

            candidate = support

            if stop_loss is None:
                stop_loss = candidate
            else:
                stop_loss = max(
                    stop_loss,
                    candidate
                )

    elif signal == "SELL":

        if (
            resistance is not None
            and resistance > price
        ):

            candidate = resistance

            if stop_loss is None:
                stop_loss = candidate
            else:
                stop_loss = min(
                    stop_loss,
                    candidate
                )

    # ========================================================
    # RISK PER SHARE
    # ========================================================

    risk_per_share = None

    if stop_loss is not None:

        if signal == "BUY":

            risk_per_share = (
                price - stop_loss
            )

        elif signal == "SELL":

            risk_per_share = (
                stop_loss - price
            )

    if (
        risk_per_share is not None
        and risk_per_share <= 0
    ):

        risk_per_share = None
        stop_loss = None

    # ========================================================
    # TARGETS
    # ========================================================

    target1 = None
    target2 = None

    if (
        risk_per_share is not None
        and risk_per_share > 0
    ):

        if signal == "BUY":

            target1 = price + (
                risk_per_share * 1.5
            )

            target2 = price + (
                risk_per_share * 2.0
            )

        elif signal == "SELL":

            target1 = price - (
                risk_per_share * 1.5
            )

            target2 = price - (
                risk_per_share * 2.0
            )

    # ========================================================
    # POSITION SIZE: ~₹10,000 ESTIMATED INTRADAY MARGIN
    # ========================================================

    capital = INTRADAY_STARTING_BALANCE

    maximum_risk = (
        capital *
        risk_percent /
        100
    )

    # The simulator uses a 20% intraday margin estimate (= up to 5x
    # exposure). Suggestions are therefore sized so estimated margin
    # targets approximately ₹10,000 per suggested trade whenever the stock price permits.
    min_estimated_margin = 8000.0
    max_estimated_margin = 10000.0
    target_estimated_margin = 9000.0

    quantity = 0
    risk_based_quantity = 0

    if (
        risk_per_share is not None
        and risk_per_share > 0
    ):
        risk_based_quantity = int(
            maximum_risk /
            risk_per_share
        )

    if price > 0:
        margin_per_share = price * INTRADAY_MARGIN_RATE

        min_margin_quantity = max(
            1,
            int(math.ceil(
                min_estimated_margin /
                margin_per_share
            ))
        )

        max_margin_quantity = max(
            0,
            int(
                max_estimated_margin /
                margin_per_share
            )
        )

        target_margin_quantity = max(
            1,
            int(
                target_estimated_margin /
                margin_per_share
            )
        )

        # If even one share needs more than ₹10k estimated margin,
        # this stock is not suitable for the requested margin band.
        if max_margin_quantity >= 1:
            if risk_based_quantity > 0:
                quantity = min(
                    risk_based_quantity,
                    target_margin_quantity,
                    max_margin_quantity,
                )

                # Prefer the ₹10k target when doing so does not exceed
                # the user's risk-based size.
                if (
                    quantity < min_margin_quantity
                    and risk_based_quantity >= min_margin_quantity
                ):
                    quantity = min_margin_quantity
            else:
                quantity = min(
                    target_margin_quantity,
                    max_margin_quantity,
                )

            # Never exceed currently available simulated intraday margin.
            affordable_by_margin = int(
                intraday_available_margin() /
                margin_per_share
            )
            quantity = min(
                quantity,
                affordable_by_margin,
                max_margin_quantity,
            )

    position_value = (
        quantity * price
    )

    estimated_margin = (
        position_value *
        INTRADAY_MARGIN_RATE
    )

    margin_band_eligible = (
        quantity > 0
        and estimated_margin >= min_estimated_margin
        and estimated_margin <= max_estimated_margin
    )

    # ========================================================
    # SCORE / CONFIDENCE
    # ========================================================

    # Maximum theoretical score is approximately 10.
    confidence = min(
        100,
        max(
            0,
            int(
                abs(score) /
                10 *
                100
            )
        )
    )

    # For non-confirmed signals, don't present
    # confidence as a probability.
    if signal in [
        "WAIT",
        "NO TRADE"
    ]:
        confidence = min(
            confidence,
            65
        )

    # ========================================================
    # RISK / REWARD
    # ========================================================

    risk_reward = None

    if (
        risk_per_share is not None
        and risk_per_share > 0
        and target2 is not None
    ):

        reward = abs(
            target2 - price
        )

        risk_reward = (
            reward /
            risk_per_share
        )

    # ========================================================
    # SENTIMENT
    # ========================================================

    if score >= 4:
        sentiment = "Bullish"

    elif score <= -4:
        sentiment = "Bearish"

    else:
        sentiment = "Neutral"

    entry_price = None

    if signal == "BUY":
        entry_price = entry_high if entry_high is not None else price
    elif signal == "SELL":
        entry_price = entry_low if entry_low is not None else price

    exit_rules = []

    if signal == "BUY":
        exit_rules = [
            "Book part of the position at Target 1",
            "Book the remaining position at Target 2",
            "Exit immediately if Stop Loss is reached",
            "Exit early if price falls below VWAP and EMA 9 crosses below EMA 20",
        ]
    elif signal == "SELL":
        exit_rules = [
            "Book part of the position at Target 1",
            "Book the remaining position at Target 2",
            "Exit immediately if Stop Loss is reached",
            "Exit early if price rises above VWAP and EMA 9 crosses above EMA 20",
        ]

    return {

        "symbol": clean_symbol(symbol),

        "signal": signal,

        "score": score,

        "confidence": confidence,

        "sentiment": sentiment,

        "price": price,

        # Frontend-friendly aliases
        "current_price": price,
        "entry_price": safe_float(entry_price),

        "entry_low": safe_float(entry_low),

        "entry_high": safe_float(entry_high),

        "stop_loss": safe_float(stop_loss),

        "target1": safe_float(target1),
        "target_1": safe_float(target1),

        "target2": safe_float(target2),
        "target_2": safe_float(target2),

        "risk_per_share": safe_float(
            risk_per_share
        ),

        "risk_reward": safe_float(
            risk_reward
        ),

        "suggested_quantity": quantity,

        "position_value": safe_float(
            position_value
        ),

        "estimated_margin": safe_float(
            estimated_margin
        ),

        "min_estimated_margin": min_estimated_margin,
        "max_estimated_margin": max_estimated_margin,
        "target_estimated_margin": target_estimated_margin,
        "margin_band_eligible": margin_band_eligible,
        "margin_rate": INTRADAY_MARGIN_RATE,
        "max_leverage": INTRADAY_MAX_LEVERAGE,

        "capital": capital,

        "maximum_risk": maximum_risk,

        "market_status": get_market_status(),
        "last_update": datetime.now(ZoneInfo("Asia/Kolkata")).isoformat(),
        "exit_rules": exit_rules,

        # Flat indicator aliases for the React frontend
        "vwap": vwap,
        "ema9": ema9,
        "ema20": ema20,
        "rsi14": rsi,
        "macd": macd,
        "macd_signal": macd_signal,
        "atr14": atr,
        "volume_ratio": volume_ratio,
        "opening_range_high": opening_high,
        "opening_range_low": opening_low,
        "support": support,
        "resistance": resistance,

        "indicators": {

            "vwap": vwap,

            "ema9": ema9,

            "ema20": ema20,

            "rsi14": rsi,

            "macd": macd,
            "macd_signal": macd_signal,

            "atr14": atr,

            "volume_ratio": volume_ratio,

            "opening_high":
                opening_high,

            "opening_low":
                opening_low,

            "support":
                support,

            "resistance":
                resistance,

        },

        "breakout": breakout,

        "reasons": reasons,

        "warnings": warnings,

        "last_candle": (
            df.index[-1].isoformat()
            if hasattr(
                df.index[-1],
                "isoformat"
            )
            else str(df.index[-1])
        ),
    }


# ============================================================
# INTRADAY DATA CONVERTER
# ============================================================

def intraday_dataframe_to_records(df):

    records = []

    if df is None or df.empty:
        return records

    for index, row in df.iterrows():

        timestamp = index

        if hasattr(
            timestamp,
            "isoformat"
        ):
            timestamp = timestamp.isoformat()

        records.append({

            "time": timestamp,

            "open": safe_float(
                row.get("Open")
            ),

            "high": safe_float(
                row.get("High")
            ),

            "low": safe_float(
                row.get("Low")
            ),

            "close": safe_float(
                row.get("Close")
            ),

            "volume": safe_float(
                row.get("Volume")
            ),

            "vwap": safe_float(
                row.get("VWAP")
            ),

            "ema9": safe_float(
                row.get("EMA9")
            ),

            "ema20": safe_float(
                row.get("EMA20")
            ),

            "rsi14": safe_float(
                row.get("RSI14")
            ),

            "macd": safe_float(
                row.get("MACD")
            ),

            "macd_signal": safe_float(
                row.get("MACD_SIGNAL")
            ),

            "atr14": safe_float(
                row.get("ATR14")
            ),

            "volume_ratio": safe_float(
                row.get("VOLUME_RATIO")
            ),
        })

    return records


# ============================================================
# INTRADAY HISTORY
# ============================================================

@app.get("/api/stock/intraday")
def stock_intraday(
    symbol: str = Query(...),
    period: str = Query("5d"),
    interval: str = Query("5m"),
):

    clean = clean_symbol(symbol)

    if not clean:
        raise HTTPException(
            status_code=400,
            detail="Invalid stock symbol"
        )

    try:

        if is_index(clean):
            # Yahoo supports intraday data for these indexes
            pass

        df = get_history(
            clean,
            period,
            interval
        )

        df = calculate_intraday_indicators(
            df
        )

        signal = generate_intraday_signal(
            df,
            clean
        )

        return {

            "symbol": clean,

            "period": period,

            "interval": interval,

            "data":
                intraday_dataframe_to_records(
                    df
                ),

            "signal": signal["signal"],
            "signal_details": signal,
        }

    except Exception as error:

        print(
            "Intraday error:",
            traceback.format_exc()
        )

        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


# ============================================================
# INTRADAY ANALYSIS ONLY
# ============================================================

@app.get("/api/stock/intraday-analysis")
def intraday_analysis(
    symbol: str = Query(...),
    interval: str = Query("5m"),
    risk_percent: float = Query(
        1.0,
        ge=0.1,
        le=5.0
    ),
):

    clean = clean_symbol(symbol)

    if not clean:
        raise HTTPException(
            status_code=400,
            detail="Invalid stock symbol"
        )

    try:

        if interval not in ["5m", "15m"]:
            raise ValueError("interval must be 5m or 15m")

        df = get_history(
            clean,
            "5d",
            interval
        )

        df = calculate_intraday_indicators(
            df
        )

        result = generate_intraday_signal(
            df,
            clean,
            risk_percent
        )

        return result

    except Exception as error:

        print(
            "Intraday analysis error:",
            traceback.format_exc()
        )

        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


# ============================================================
# INTRADAY HISTORY FOR CHART
# ============================================================

@app.get("/api/stock/intraday-history")
def intraday_history(
    symbol: str = Query(...),
    interval: str = Query("5m"),
    period: str = Query("1d"),
):
    clean = clean_symbol(symbol)

    if not clean:
        raise HTTPException(
            status_code=400,
            detail="Invalid stock symbol"
        )

    if interval not in ["5m", "15m"]:
        raise HTTPException(
            status_code=400,
            detail="interval must be 5m or 15m"
        )

    allowed_periods = {
        "1d",
        "2d",
        "5d",
        "1wk",
        "1mo",
    }

    if period not in allowed_periods:
        raise HTTPException(
            status_code=400,
            detail="period must be 1d, 2d, 5d, 1wk or 1mo"
        )

    try:
        df = get_history(clean, period, interval)
        df = calculate_intraday_indicators(df)

        return {
            "symbol": clean,
            "interval": interval,
            "period": period,
            "data": intraday_dataframe_to_records(df),
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


# ============================================================
# INTRADAY SCANNER
# ============================================================

@app.get("/api/intraday/scanner")
def intraday_scanner(
    force: bool = Query(False),
    interval: str = Query("5m"),
):
    if interval not in ["5m", "15m"]:
        raise HTTPException(
            status_code=400,
            detail="interval must be 5m or 15m"
        )

    now_ist = datetime.now(ZoneInfo("Asia/Kolkata"))
    minutes = now_ist.hour * 60 + now_ist.minute
    market_status = get_market_status()

    if now_ist.weekday() >= 5:
        session_phase = "MARKET_CLOSED"
    elif minutes < (9 * 60 + 15):
        session_phase = "PRE_MARKET"
    elif minutes < MARKET_SETTLED_MINUTES:
        session_phase = "MARKET_SETTLING"
    elif minutes < LATE_SESSION_START_MINUTES:
        session_phase = "NORMAL_SCAN"
    elif minutes < NEW_ENTRY_CUTOFF_MINUTES:
        session_phase = "CONSERVATIVE_SCAN"
    elif minutes <= (15 * 60 + 30):
        session_phase = "NO_NEW_ENTRIES"
    else:
        session_phase = "END_OF_DAY"

    # Calling the scanner after the close automatically performs the durable
    # end-of-day observation pass once data is available.
    eod_review = None
    if session_phase == "END_OF_DAY":
        try:
            eod_review = run_end_of_day_review()
        except Exception as error:
            eod_review = {"status": "error", "detail": str(error)}

    cache_key = f"scanner_{interval}"
    cached = scanner_cache.get(cache_key)
    now_ts = time.time()

    if (
        not force
        and cached
        and now_ts - cached["timestamp"] < SCANNER_CACHE_TTL_SECONDS
    ):
        payload = dict(cached["payload"])
        payload["cached"] = True
        payload["session_phase"] = session_phase
        payload["end_of_day_review"] = eod_review
        return payload

    def scan_one(item):
        stock_symbol, stock_name = item
        df = None

        try:
            df = get_history(
                stock_symbol,
                "5d",
                interval
            )
            df = calculate_intraday_indicators(df)
            result = generate_intraday_signal(
                df,
                stock_symbol
            )
            result["name"] = stock_name
            result["error"] = None
            return result

        except Exception as error:
            return {
                "symbol": stock_symbol,
                "name": stock_name,
                "signal": "NO TRADE",
                "score": 0,
                "confidence": 0,
                "sentiment": "Neutral",
                "price": None,
                "current_price": None,
                "entry_price": None,
                "stop_loss": None,
                "target_1": None,
                "target_2": None,
                "suggested_quantity": 0,
                "position_value": 0,
                "estimated_margin": 0,
                "min_estimated_margin": 10000.0,
                "max_estimated_margin": 10000.0,
                "target_estimated_margin": 10000.0,
                "margin_band_eligible": False,
                "margin_rate": INTRADAY_MARGIN_RATE,
                "max_leverage": INTRADAY_MAX_LEVERAGE,
                "exit_rules": [],
                "qualified": False,
                "setup_quality": 0,
                "session_phase": session_phase,
                "error": str(error),
            }
        finally:
            # pandas/yfinance frames can be several MB each. Drop the worker's
            # last reference as soon as that symbol has been converted to a result.
            if df is not None:
                del df

    results = []

    # The scanner may still collect observations while the market is settling,
    # but qualification is blocked by is_qualified_setup().
    # Serialize full scans so multiple frontend requests cannot each launch
    # their own Yahoo/pandas workload at the same time on a 512 MB service.
    with scanner_execution_lock:
        # A different request may have completed a scan while this request
        # waited for the lock. Reuse that newly-created payload when possible.
        cached_after_wait = scanner_cache.get(cache_key)
        lock_now_ts = time.time()
        if (
            not force
            and cached_after_wait
            and lock_now_ts - cached_after_wait["timestamp"] < SCANNER_CACHE_TTL_SECONDS
        ):
            payload = dict(cached_after_wait["payload"])
            payload["cached"] = True
            payload["session_phase"] = session_phase
            payload["end_of_day_review"] = eod_review
            return payload

        with ThreadPoolExecutor(max_workers=SCANNER_MAX_WORKERS) as executor:
            futures = [
                executor.submit(scan_one, stock)
                for stock in COMMON_STOCKS
            ]

            for future in as_completed(futures):
                results.append(future.result())

        # Release executor/future references promptly after a large scan.
        futures.clear()
        gc.collect()

    # Rank candidates first. Strictly qualified setups get first priority.
    # If fewer than two setups have qualified today, the best controlled
    # EXECUTABLE fallback candidates may fill the remaining slots.
    slots = max(
        0,
        MAX_QUALIFIED_SUGGESTIONS_PER_DAY - scanner_signal_count_today()
    )

    ranked = sorted(
        results,
        key=lambda r: (
            -abs(float(r.get("score") or 0)),
            -float(r.get("risk_reward") or 0),
            -float(r.get("volume_ratio") or 0),
        ),
    )

    # First calculate qualification state for every result.
    for result in ranked:
        qualified, quality, checks = is_qualified_setup(result)
        result["setup_quality"] = quality
        result["qualification_checks"] = checks
        result["qualified"] = False
        result["qualification_level"] = "NONE"

        if qualified:
            result["qualification_level"] = "CONFIRMED"

    # Strict setups always have first priority.
    for result in ranked:
        if result.get("qualification_level") != "CONFIRMED":
            continue

        day = now_ist.date().isoformat()
        signal_id = (
            f"{day}:"
            f"{clean_symbol(result.get('symbol',''))}:"
            f"{str(result.get('signal','')).upper()}"
        )

        with sqlite3.connect(TRADE_HISTORY_DB) as connection:
            exists = connection.execute(
                "SELECT 1 FROM scanner_signal_history WHERE id=?",
                (signal_id,),
            ).fetchone() is not None

        if exists:
            result["qualified"] = True
            result["signal_id"] = signal_id
        elif slots > 0:
            saved_id, inserted = store_qualified_signal(result)
            result["qualified"] = True
            result["signal_id"] = saved_id
            if inserted:
                slots -= 1

    # Controlled fallback:
    # Try to provide at least two valid setups for the day, but never manufacture
    # a WAIT/NO TRADE signal and never exceed the daily maximum.
    qualified_today_now = scanner_signal_count_today()
    fallback_needed = max(0, min(2 - qualified_today_now, slots))

    if fallback_needed > 0:
        fallback_candidates = [
            r for r in ranked
            if r.get("qualified") is not True
            and r.get("executable") is True
            and str(r.get("signal", "")).upper() in ("BUY", "SELL")
        ]

        fallback_candidates.sort(
            key=lambda r: (
                -float(r.get("setup_quality") or 0),
                -abs(float(r.get("score") or 0)),
                -float(r.get("risk_reward") or 0),
                -float(r.get("volume_ratio") or 0),
            )
        )

        for result in fallback_candidates[:fallback_needed]:
            day = now_ist.date().isoformat()
            signal_id = (
                f"{day}:"
                f"{clean_symbol(result.get('symbol',''))}:"
                f"{str(result.get('signal','')).upper()}"
            )

            with sqlite3.connect(TRADE_HISTORY_DB) as connection:
                exists = connection.execute(
                    "SELECT 1 FROM scanner_signal_history WHERE id=?",
                    (signal_id,),
                ).fetchone() is not None

            if exists:
                result["qualified"] = True
                result["qualification_level"] = "EXECUTABLE"
                result["signal_id"] = signal_id
            elif slots > 0:
                # Mark the fallback level before storing so history records
                # exactly why this candidate was surfaced.
                result["qualified"] = True
                result["qualification_level"] = "EXECUTABLE"
                saved_id, inserted = store_qualified_signal(result)
                result["signal_id"] = saved_id
                if inserted:
                    slots -= 1

    # Persist BUY/SELL candidates whether they passed or failed.
    for result in ranked:
        candidate_id = store_scanner_candidate(result)
        if candidate_id:
            result["candidate_id"] = candidate_id

    signal_order = {
        "BUY": 0,
        "SELL": 1,
        "WAIT": 2,
        "NO TRADE": 3,
    }

    results.sort(
        key=lambda x: (
            0 if x.get("qualified") is True else 1,
            signal_order.get(x.get("signal"), 4),
            -float(x.get("setup_quality") or 0),
            -abs(int(x.get("score") or 0)),
        )
    )

    buys = [
        x for x in results
        if x.get("signal") == "BUY" and x.get("qualified") is True
    ]
    sells = [
        x for x in results
        if x.get("signal") == "SELL" and x.get("qualified") is True
    ]
    waits = [
        x for x in results
        if x.get("qualified") is not True
    ]

    phase_message = {
        "PRE_MARKET": "Market has not opened yet.",
        "MARKET_SETTLING": (
            "Market settling: collecting opening data. "
            "No new BUY/SELL suggestions before 09:45 IST."
        ),
        "NORMAL_SCAN": "Normal qualified scanning is active.",
        "CONSERVATIVE_SCAN": (
            "Late session: stronger qualification thresholds are active."
        ),
        "NO_NEW_ENTRIES": (
            "No new suggestions after 15:15 IST. "
            "Manage existing positions only."
        ),
        "END_OF_DAY": (
            "Market closed. End-of-day observations are being saved "
            "for future sessions."
        ),
        "MARKET_CLOSED": "Market is closed.",
    }.get(session_phase, "")

    payload = {
        "timestamp": now_ist.isoformat(),
        "market_status": market_status,
        "session_phase": session_phase,
        "phase_message": phase_message,
        "qualified_today": scanner_signal_count_today(),
        "max_qualified_per_day": MAX_QUALIFIED_SUGGESTIONS_PER_DAY,
        "interval": interval,
        "count": len(results),
        "buy_count": len(buys),
        "sell_count": len(sells),
        "results": results,
        "buy": buys,
        "sell": sells,
        "wait": waits,
        "end_of_day_review": eod_review,
        "historical_buy": _historical_setup_stats("BUY"),
        "historical_sell": _historical_setup_stats("SELL"),
        "cached": False,
    }

    scanner_cache[cache_key] = {
        "timestamp": now_ts,
        "payload": payload,
    }

    return payload


@app.post("/api/intraday/end-of-day-review")
def intraday_end_of_day_review(
    trade_date: Optional[str] = Query(None),
    force: bool = Query(False),
):
    """Manually run/re-run the durable post-market observation pass."""
    try:
        return run_end_of_day_review(trade_date=trade_date, force=force)
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))


@app.get("/api/intraday/end-of-day-review")
def get_intraday_end_of_day_review(
    trade_date: Optional[str] = Query(None),
):
    review = load_daily_review(trade_date)
    if review is None:
        return {
            "status": "not_available",
            "trade_date": trade_date,
            "review": None,
        }
    return {"status": "success", "review": review}


@app.get("/api/intraday/learning-summary")
def intraday_learning_summary():
    """Historical observations available to the next trading session."""
    return {
        "buy": _historical_setup_stats("BUY"),
        "sell": _historical_setup_stats("SELL"),
        "minimum_sample": HISTORICAL_MIN_SAMPLE,
        "minimum_success_rate": HISTORICAL_MIN_SUCCESS_RATE,
        "policy": (
            "Historical performance is used only after the minimum sample "
            "is reached. Setup quality is not a probability of profit."
        ),
    }


# ============================================================
# HEALTH
# ============================================================

@app.get("/api/health")
def health():

    return {

        "status":
            "ok",

        "message":
            "Indian Stock Analyzer backend is running",

        "version":
            "5.0.0",

        "https":
            True,

        "time":
            datetime.now().isoformat(),
    }


# ============================================================
# SEARCH
# ============================================================

@app.get("/api/search")
def search_stocks(
    q: str = Query(None),
    symbol: str = Query(None),
):

    raw_query = q if q is not None else symbol

    if raw_query is None:
        return []

    query = raw_query.strip().upper()

    if not query:
        return []

    results = []

    for name, yahoo in INDEX_SYMBOLS.items():

        if query in name:

            display_name = name

            if name in [
                "NIFTY",
                "NIFTY50",
                "NIFTY 50"
            ]:
                display_name = "NIFTY 50"

            results.append({

                "symbol": name,

                "name": display_name,

                "exchange": "NSE",

                "type": "INDEX",
            })

    for stock_symbol, name in COMMON_STOCKS:

        if (
            query in stock_symbol
            or query in name.upper()
        ):

            results.append({

                "symbol":
                    stock_symbol,

                "name":
                    name,

                "exchange":
                    "NSE",

                "type":
                    "EQUITY",
            })

    if not results:

        clean = clean_symbol(query)

        if clean:

            try:

                ticker = get_ticker(clean)

                info = ticker.info

                name = (
                    info.get("longName")
                    or info.get("shortName")
                    or clean
                )

                results.append({

                    "symbol":
                        clean,

                    "name":
                        name,

                    "exchange":
                        "NSE",

                    "type":
                        "EQUITY",
                })

            except Exception:

                results.append({

                    "symbol":
                        clean,

                    "name":
                        clean,

                    "exchange":
                        "NSE",

                    "type":
                        "EQUITY",
                })

    return results[:15]


# ============================================================
# QUOTE
# ============================================================

@app.get("/api/stock/quote")
def get_quote(
    symbol: str = Query(...)
):

    clean = clean_symbol(symbol)

    if not clean:

        raise HTTPException(
            status_code=400,
            detail="Invalid symbol"
        )

    try:

        ticker = get_ticker(clean)

        data = ticker.history(
            period="5d",
            interval="1d",
            auto_adjust=False
        )

        if data.empty:

            raise Exception(
                "No quote data available"
            )

        latest = data.iloc[-1]

        previous_close = None

        if len(data) >= 2:

            previous_close = safe_float(
                data["Close"].iloc[-2]
            )

        current = safe_float(
            latest["Close"]
        )

        change = None
        change_percent = None

        if (
            current is not None
            and previous_close is not None
        ):

            change = (
                current -
                previous_close
            )

            if previous_close != 0:

                change_percent = (
                    change /
                    previous_close
                ) * 100

        return {

            "symbol":
                clean,

            "name":
                (
                    "NIFTY 50"
                    if clean in [
                        "NIFTY",
                        "NIFTY50",
                        "NIFTY 50"
                    ]
                    else clean
                ),

            "price":
                current,

            "ltp":
                current,

            "change":
                safe_float(change),

            "change_percent":
                safe_float(
                    change_percent
                ),

            "open":
                safe_float(
                    latest["Open"]
                ),

            "high":
                safe_float(
                    latest["High"]
                ),

            "low":
                safe_float(
                    latest["Low"]
                ),

            "close":
                current,

            "previous_close":
                previous_close,

            "volume":
                safe_float(
                    latest["Volume"]
                ),
        }

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


# ============================================================
# DAILY HISTORY
# ============================================================

@app.get("/api/stock/history")
def stock_history(
    symbol: str = Query(...),
    period: str = Query("6mo"),
    interval: str = Query("1d")
):

    clean = clean_symbol(symbol)

    try:

        df = get_history(
            clean,
            period,
            interval
        )

        df = calculate_indicators(df)

        return {

            "symbol":
                clean,

            "period":
                period,

            "interval":
                interval,

            "data":
                dataframe_to_records(df),
        }

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


# ============================================================
# DAILY ANALYSIS
# ============================================================

@app.get("/api/stock/analysis")
def stock_analysis(
    symbol: str = Query(...)
):

    clean = clean_symbol(symbol)

    try:

        df = get_history(
            clean,
            "6mo",
            "1d"
        )

        df = calculate_indicators(df)

        signal = generate_signal(df)

        latest = df.iloc[-1]

        return {

            "symbol":
                clean,

            "price":
                safe_float(
                    latest["Close"]
                ),

            "sma20": safe_float(latest["SMA20"]),
            "sma50": safe_float(latest["SMA50"]),
            "ema20": safe_float(latest["EMA20"]),
            "rsi14": safe_float(latest["RSI14"]),
            "macd": safe_float(latest["MACD"]),
            "macd_signal": safe_float(latest["MACD_SIGNAL"]),
            "macd_histogram": safe_float(latest["MACD_HIST"]),
            "bb_upper": safe_float(latest["BB_UPPER"]),
            "bb_middle": safe_float(latest["BB_MIDDLE"]),
            "bb_lower": safe_float(latest["BB_LOWER"]),

            "score": signal["score"],
            "sentiment": signal["sentiment"],
            "reasons": signal["reasons"],

            "indicators": {

                "sma20":
                    safe_float(
                        latest["SMA20"]
                    ),

                "sma50":
                    safe_float(
                        latest["SMA50"]
                    ),

                "ema20":
                    safe_float(
                        latest["EMA20"]
                    ),

                "rsi14":
                    safe_float(
                        latest["RSI14"]
                    ),

                "macd":
                    safe_float(
                        latest["MACD"]
                    ),

                "macd_signal":
                    safe_float(
                        latest["MACD_SIGNAL"]
                    ),

                "macd_histogram":
                    safe_float(
                        latest["MACD_HIST"]
                    ),

                "bb_upper":
                    safe_float(
                        latest["BB_UPPER"]
                    ),

                "bb_middle":
                    safe_float(
                        latest["BB_MIDDLE"]
                    ),

                "bb_lower":
                    safe_float(
                        latest["BB_LOWER"]
                    ),
            },

            "signal": signal["signal"],
            "signal_details": signal,
        }

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


# ============================================================
# PAPER ACCOUNT
# ============================================================

@app.get("/api/paper/account")
def get_account():

    total_position_value = 0.0

    for symbol, position in paper_positions.items():

        quantity = position["quantity"]

        try:

            ticker = get_ticker(symbol)

            data = ticker.history(
                period="2d",
                interval="1d",
                auto_adjust=False
            )

            if not data.empty:

                price = safe_float(
                    data["Close"].iloc[-1]
                )

                if price is not None:

                    total_position_value += (
                        price *
                        quantity
                    )

        except Exception:
            pass

    total_value = (
        paper_account["cash"] +
        total_position_value
    )

    pnl = (
        total_value -
        paper_account[
            "starting_balance"
        ]
    )

    return {

        "starting_balance":
            paper_account[
                "starting_balance"
            ],

        "cash":
            paper_account[
                "cash"
            ],

        "position_value":
            total_position_value,

        "total_value":
            total_value,

        "pnl":
            pnl,
    }


# ============================================================
# POSITIONS
# ============================================================

@app.get("/api/paper/positions")
def get_positions():

    result = []

    for symbol, position in paper_positions.items():

        quantity = position["quantity"]

        average_price = position[
            "average_price"
        ]

        current_price = None

        try:

            ticker = get_ticker(symbol)

            data = ticker.history(
                period="2d",
                interval="1d",
                auto_adjust=False
            )

            if not data.empty:

                current_price = safe_float(
                    data["Close"].iloc[-1]
                )

        except Exception:
            pass

        pnl = None

        if current_price is not None:

            pnl = (
                current_price -
                average_price
            ) * quantity

        result.append({

            "symbol":
                symbol,

            "quantity":
                quantity,

            "average_price":
                average_price,

            "ltp":
                current_price,

            "current_price":
                current_price,

            "pnl":
                pnl,
        })

    return result


# ============================================================
# TRADES
# ============================================================

@app.get("/api/paper/trades")
def get_trades():

    return paper_trades


# ============================================================
# PLACE ORDER
# ============================================================

@app.post("/api/paper/order")
def place_order(
    order: OrderRequest
):

    symbol = clean_symbol(
        order.symbol
    )

    side = order.side.upper()

    quantity = order.quantity

    if not symbol:

        raise HTTPException(
            status_code=400,
            detail="Invalid stock symbol"
        )

    if is_index(symbol):

        raise HTTPException(
            status_code=400,
            detail=(
                "Index paper trading is not enabled. "
                "Select an equity stock."
            )
        )

    if side not in [
        "BUY",
        "SELL"
    ]:

        raise HTTPException(
            status_code=400,
            detail=(
                "Side must be BUY or SELL"
            )
        )

    if quantity <= 0:

        raise HTTPException(
            status_code=400,
            detail=(
                "Quantity must be greater than zero"
            )
        )

    try:

        ticker = get_ticker(symbol)

        data = ticker.history(
            period="2d",
            interval="1d",
            auto_adjust=False
        )

        if data.empty:

            raise Exception(
                "Unable to get current price"
            )

        price = safe_float(
            data["Close"].iloc[-1]
        )

        if price is None:

            raise Exception(
                "Invalid market price"
            )

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=(
                f"Unable to get price: {error}"
            )
        )

    order_type = str(order.order_type or "MARKET").upper()

    if order_type not in ["MARKET", "LIMIT"]:
        raise HTTPException(
            status_code=400,
            detail="Order type must be MARKET or LIMIT",
        )

    market_price = price

    if order_type == "LIMIT":
        limit_price = safe_float(order.limit_price)

        if limit_price is None or limit_price <= 0:
            raise HTTPException(
                status_code=400,
                detail="Enter a valid Buy / Sell price",
            )

        # Paper simulator: execute at the user-entered price.
        price = limit_price
    else:
        limit_price = None

    total_value = (
        price *
        quantity
    )

    if side == "BUY":

        if (
            paper_account["cash"] <
            total_value
        ):

            raise HTTPException(
                status_code=400,
                detail=(
                    "Insufficient "
                    "paper-trading cash"
                )
            )

        paper_account[
            "cash"
        ] -= total_value

        if symbol in paper_positions:

            position = paper_positions[
                symbol
            ]

            old_quantity = position[
                "quantity"
            ]

            old_average = position[
                "average_price"
            ]

            new_quantity = (
                old_quantity +
                quantity
            )

            new_average = (
                (
                    old_quantity *
                    old_average
                )
                +
                (
                    quantity *
                    price
                )
            ) / new_quantity

            position[
                "quantity"
            ] = new_quantity

            position[
                "average_price"
            ] = new_average

        else:

            paper_positions[
                symbol
            ] = {

                "quantity":
                    quantity,

                "average_price":
                    price,
            }

    else:

        if symbol not in paper_positions:

            raise HTTPException(
                status_code=400,
                detail=(
                    "No position "
                    "available to sell"
                )
            )

        position = paper_positions[
            symbol
        ]

        if quantity > position[
            "quantity"
        ]:

            raise HTTPException(
                status_code=400,
                detail=(
                    "Sell quantity "
                    "exceeds position"
                )
            )

        paper_account[
            "cash"
        ] += total_value

        position[
            "quantity"
        ] -= quantity

        if position[
            "quantity"
        ] == 0:

            del paper_positions[
                symbol
            ]

    trade = {

        "id":
            uuid.uuid4().hex,

        "timestamp":
            datetime.now().isoformat(),

        "symbol":
            symbol,

        "side":
            side,

        "quantity":
            quantity,

        "price":
            price,

        "value":
            total_value,

        "order_type":
            order_type,

        "market_price":
            market_price,

        "limit_price":
            limit_price,

        "stop_loss": order.stop_loss,
    }

    paper_trades.insert(
        0,
        trade
    )

    return {

        "status":
            "success",

        "message":
            (
                f"{side} {order_type} order executed at "
                f"₹{price:,.2f}"
            ),

        "trade":
            trade,
    }



# ============================================================
# INTRADAY PAPER TRADING HELPERS
# ============================================================

def get_latest_equity_price(symbol: str):
    """Return the latest available intraday price, with daily fallback."""

    ticker = get_ticker(symbol)

    try:
        intraday_data = ticker.history(
            period="1d",
            interval="1m",
            auto_adjust=False,
        )

        if not intraday_data.empty:
            price = safe_float(intraday_data["Close"].dropna().iloc[-1])
            if price is not None:
                return price
    except Exception:
        pass

    daily_data = ticker.history(
        period="2d",
        interval="1d",
        auto_adjust=False,
    )

    if daily_data.empty:
        raise ValueError("Unable to get current market price")

    price = safe_float(daily_data["Close"].dropna().iloc[-1])

    if price is None:
        raise ValueError("Invalid current market price")

    return price


def intraday_margin_used_total():
    return sum(
        float(position.get("margin_used", 0.0) or 0.0)
        for position in intraday_paper_positions.values()
    )


def intraday_available_margin():
    return max(
        0.0,
        float(intraday_paper_account["balance"]) -
        intraday_margin_used_total(),
    )


# ============================================================
# INTRADAY PAPER ACCOUNT
# ============================================================

@app.get("/api/intraday-paper/account")
def get_intraday_paper_account():

    margin_used = intraday_margin_used_total()
    unrealized_pnl = 0.0
    gross_exposure = 0.0

    for symbol, position in intraday_paper_positions.items():
        qty = int(position.get("quantity", 0) or 0)
        avg = safe_float(position.get("average_price"))

        if qty == 0 or avg is None:
            continue

        try:
            ltp = get_latest_equity_price(symbol)
        except Exception:
            ltp = avg

        gross_exposure += abs(qty) * ltp

        if qty > 0:
            unrealized_pnl += (ltp - avg) * qty
        else:
            unrealized_pnl += (avg - ltp) * abs(qty)

    balance = float(intraday_paper_account["balance"])
    available_margin = max(0.0, balance - margin_used)

    return {
        "starting_balance": intraday_paper_account["starting_balance"],
        "balance": balance,
        "cash": available_margin,
        "available_margin": available_margin,
        "margin_used": margin_used,
        "unrealized_pnl": unrealized_pnl,
        "equity": balance + unrealized_pnl,
        "gross_exposure": gross_exposure,
        "margin_rate": INTRADAY_MARGIN_RATE,
        "margin_percent": INTRADAY_MARGIN_RATE * 100.0,
        "max_leverage": INTRADAY_MAX_LEVERAGE,
        "margin_model": "Groww-style estimated intraday margin",
    }


# ============================================================
# INTRADAY PAPER POSITIONS
# ============================================================

@app.get("/api/intraday-paper/positions")
def get_intraday_paper_positions():

    result = []

    for symbol, position in intraday_paper_positions.items():

        qty = int(position.get("quantity", 0) or 0)
        avg = safe_float(position.get("average_price"))
        margin_used = safe_float(position.get("margin_used")) or 0.0

        if qty == 0 or avg is None:
            continue

        try:
            ltp = get_latest_equity_price(symbol)
        except Exception:
            ltp = avg

        if qty > 0:
            pnl = (ltp - avg) * qty
            direction = "LONG"
        else:
            pnl = (avg - ltp) * abs(qty)
            direction = "SHORT"

        result.append({
            "symbol": symbol,
            "direction": direction,
            "quantity": abs(qty),
            "signed_quantity": qty,
            "average_price": avg,
            "current_price": ltp,
            "ltp": ltp,
            "margin_used": margin_used,
            "exposure": abs(qty) * ltp,
            "pnl": pnl,
            "exit_target": safe_float(position.get("exit_target")),
            "stop_loss": safe_float(position.get("stop_loss")),
        })

    return result


# ============================================================
# INTRADAY PAPER TRADES
# ============================================================

@app.get("/api/intraday-paper/trades")
def get_intraday_paper_trades():
    # Read directly from SQLite for every history request. This guarantees
    # that the website shows the persisted executions, even if the in-memory
    # list was stale or the backend process was restarted.
    global intraday_paper_trades
    intraday_paper_trades = load_intraday_trade_history()
    return intraday_paper_trades


# ============================================================
# PLACE INTRADAY PAPER ORDER
# ============================================================

@app.post("/api/intraday-paper/order")
def place_intraday_paper_order(order: OrderRequest):

    symbol = clean_symbol(order.symbol)
    side = str(order.side).upper()
    quantity = int(order.quantity)
    manual_order_value = safe_float(order.order_value)

    if not symbol:
        raise HTTPException(status_code=400, detail="Invalid stock symbol")

    if is_index(symbol):
        raise HTTPException(
            status_code=400,
            detail="Select an equity stock for intraday paper trading",
        )

    if side not in ["BUY", "SELL"]:
        raise HTTPException(status_code=400, detail="Side must be BUY or SELL")

    if quantity <= 0:
        raise HTTPException(
            status_code=400,
            detail="Quantity must be greater than zero",
        )

    try:
        price = get_latest_equity_price(symbol)
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Unable to get price: {error}",
        )

    order_type = str(order.order_type or "MARKET").upper()

    if order_type not in ["MARKET", "LIMIT"]:
        raise HTTPException(
            status_code=400,
            detail="Order type must be MARKET or LIMIT",
        )

    market_price = round(float(price), 2)

    if order_type == "LIMIT":
        limit_price = safe_float(order.limit_price)

        if limit_price is None or limit_price <= 0:
            raise HTTPException(
                status_code=400,
                detail="Enter a valid intraday Buy / Sell price",
            )

        limit_price = round(float(limit_price), 2)
        reference_price = limit_price
    else:
        limit_price = None
        reference_price = market_price

    # Optional manual rupee order value. When entered, it overrides
    # Quantity and is converted to the maximum whole-share quantity.
    if manual_order_value is not None:
        if manual_order_value <= 0:
            raise HTTPException(
                status_code=400,
                detail="Manual order value must be greater than zero",
            )

        quantity = int(manual_order_value // reference_price)

        if quantity <= 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Order value ₹{manual_order_value:,.2f} is too small "
                    f"for one share at ₹{reference_price:,.2f}."
                ),
            )

    if quantity <= 0:
        raise HTTPException(
            status_code=400,
            detail="Quantity must be greater than zero",
        )

    if order_type == "LIMIT":
        # BUY and SELL orders are independent.
        # BOTH execute only on an exact 2-decimal market-price match.
        exact_match = market_price == limit_price

        if not exact_match:
            pending_order = {
                "id": uuid.uuid4().hex,
                "timestamp": datetime.now().isoformat(),
                "symbol": symbol,
                "side": side,
                "quantity": quantity,
                "requested_order_value": manual_order_value,
                "calculated_order_value": round(quantity * limit_price, 2),
                "order_type": "LIMIT",
                "limit_price": limit_price,
                "stop_loss": order.stop_loss,
                "status": "WAITING",
                "initial_market_price": market_price,
                "previous_market_price": market_price,
                "last_market_price": market_price,
                "last_error": None,
            }

            intraday_pending_orders.insert(0, pending_order)

            return {
                "status": "waiting",
                "message": (
                    f"{side} order for {quantity} share(s) of {symbol} is "
                    f"WAITING for exact market price ₹{limit_price:,.2f}. "
                    f"Current market price is ₹{market_price:,.2f}."
                ),
                "pending_order": pending_order,
                "account": get_intraday_paper_account(),
            }

        price = market_price
    else:
        price = market_price

    existing = intraday_paper_positions.get(symbol)
    current_qty = int(existing.get("quantity", 0) or 0) if existing else 0
    current_avg = safe_float(existing.get("average_price")) if existing else None
    current_margin = (
        safe_float(existing.get("margin_used")) or 0.0
        if existing
        else 0.0
    )

    delta = quantity if side == "BUY" else -quantity
    realized_pnl = 0.0
    released_margin = 0.0
    new_margin_required = 0.0
    order_action = ""

    # --------------------------------------------------------
    # No existing position OR increasing same-direction exposure
    # --------------------------------------------------------
    if current_qty == 0 or (current_qty > 0 and delta > 0) or (current_qty < 0 and delta < 0):

        new_margin_required = price * quantity * INTRADAY_MARGIN_RATE

        if intraday_available_margin() + 1e-9 < new_margin_required:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Insufficient intraday margin. Required about "
                    f"₹{new_margin_required:,.2f}, available "
                    f"₹{intraday_available_margin():,.2f}."
                ),
            )

        if current_qty == 0:
            new_qty = delta
            new_avg = price
            new_margin = new_margin_required
            order_action = "OPEN_LONG" if new_qty > 0 else "OPEN_SHORT"
        else:
            old_abs = abs(current_qty)
            new_abs = old_abs + quantity
            new_avg = (
                (old_abs * float(current_avg)) +
                (quantity * price)
            ) / new_abs
            new_qty = current_qty + delta
            new_margin = current_margin + new_margin_required
            order_action = "ADD_LONG" if new_qty > 0 else "ADD_SHORT"

        intraday_paper_positions[symbol] = {
            "quantity": new_qty,
            "average_price": new_avg,
            "margin_used": new_margin,
            "exit_target": (
                existing.get("exit_target")
                if existing
                else None
            ),
            "stop_loss": (
                safe_float(order.stop_loss)
                if safe_float(order.stop_loss) is not None
                else (
                    safe_float(existing.get("stop_loss"))
                    if existing
                    else None
                )
            ),
        }

    # --------------------------------------------------------
    # Order reduces/closes/reverses an existing position
    # --------------------------------------------------------
    else:

        close_qty = min(abs(current_qty), quantity)

        if current_qty > 0:
            realized_pnl = (price - float(current_avg)) * close_qty
            closing_direction = "LONG"
        else:
            realized_pnl = (float(current_avg) - price) * close_qty
            closing_direction = "SHORT"

        released_margin = (
            current_margin * (close_qty / abs(current_qty))
            if current_qty != 0
            else 0.0
        )

        intraday_paper_account["balance"] += realized_pnl

        remaining_old_qty = abs(current_qty) - close_qty
        residual_order_qty = quantity - close_qty

        if remaining_old_qty > 0:
            # Partial close; average entry stays unchanged.
            new_signed_qty = remaining_old_qty if current_qty > 0 else -remaining_old_qty
            intraday_paper_positions[symbol] = {
                "quantity": new_signed_qty,
                "average_price": current_avg,
                "margin_used": max(0.0, current_margin - released_margin),
                "exit_target": (
                    existing.get("exit_target")
                    if existing
                    else None
                ),
                "stop_loss": safe_float(existing.get("stop_loss")),
            }
            order_action = f"PARTIAL_CLOSE_{closing_direction}"

        else:
            intraday_paper_positions.pop(symbol, None)

            if residual_order_qty > 0:
                # The order crosses through zero and opens the opposite side.
                new_margin_required = (
                    price * residual_order_qty * INTRADAY_MARGIN_RATE
                )

                if intraday_available_margin() + 1e-9 < new_margin_required:
                    # Restore the closed position if the reverse leg cannot be opened.
                    intraday_paper_account["balance"] -= realized_pnl
                    intraday_paper_positions[symbol] = {
                        "quantity": current_qty,
                        "average_price": current_avg,
                        "margin_used": current_margin,
                        "exit_target": (
                            existing.get("exit_target")
                            if existing
                            else None
                        ),
                        "stop_loss": safe_float(existing.get("stop_loss")),
                    }

                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Position can be closed, but there is not enough "
                            f"margin to open the reverse position. Required about "
                            f"₹{new_margin_required:,.2f}, available "
                            f"₹{intraday_available_margin():,.2f}."
                        ),
                    )

                new_signed_qty = (
                    residual_order_qty
                    if delta > 0
                    else -residual_order_qty
                )

                intraday_paper_positions[symbol] = {
                    "quantity": new_signed_qty,
                    "average_price": price,
                    "margin_used": new_margin_required,
                    "exit_target": None,
                    "stop_loss": safe_float(order.stop_loss),
                }

                order_action = (
                    "REVERSE_TO_LONG"
                    if new_signed_qty > 0
                    else "REVERSE_TO_SHORT"
                )
            else:
                order_action = f"CLOSE_{closing_direction}"

    trade_value = price * quantity

    trade = {
        "id": uuid.uuid4().hex,
        "timestamp": datetime.now().isoformat(),
        "symbol": symbol,
        "side": side,
        "quantity": quantity,
        "price": price,
        "value": trade_value,
        "action": order_action,
        "realized_pnl": realized_pnl,
        "margin_required": new_margin_required,
        "margin_released": released_margin,
        "margin_rate": INTRADAY_MARGIN_RATE,
        "max_leverage": INTRADAY_MAX_LEVERAGE,
        "order_type": order_type,
        "market_price": market_price,
        "limit_price": limit_price,
        "requested_order_value": manual_order_value,
        "executed_order_value": round(price * quantity, 2),
        "stop_loss": order.stop_loss,
    }

    intraday_paper_trades.insert(0, trade)

    # Persist immediately. The trade remains in history even if the
    # backend is restarted or --reload reloads main.py.
    save_intraday_trade(trade)

    return {
        "status": "success",
        "message": (
            f"{side} intraday order executed for {quantity} share(s) of {symbol}"
        ),
        "trade": trade,
        "execution_price": round(float(price), 2),
        "account": get_intraday_paper_account(),
    }


# ============================================================
# INTRADAY WAITING / PENDING LIMIT ORDERS
# ============================================================

@app.get("/api/intraday-paper/pending")
def get_intraday_pending_orders():

    # Refresh the displayed market price for each waiting order.
    for pending in intraday_pending_orders:
        try:
            pending["last_market_price"] = get_latest_equity_price(
                pending["symbol"]
            )
        except Exception:
            pass

    waiting_count = sum(
        1 for item in intraday_pending_orders
        if item.get("status") == "WAITING"
    )
    not_possible_count = sum(
        1 for item in intraday_pending_orders
        if item.get("status") == "NOT_POSSIBLE"
    )

    return {
        "status": "success",
        "count": len(intraday_pending_orders),
        "waiting_count": waiting_count,
        "not_possible_count": not_possible_count,
        "orders": intraday_pending_orders,
    }


@app.delete("/api/intraday-paper/pending/{order_id}")
def cancel_intraday_pending_order(order_id: str):

    order_index = next(
        (
            index
            for index, item in enumerate(intraday_pending_orders)
            if str(item.get("id", "")) == str(order_id)
        ),
        None,
    )

    if order_index is None:
        raise HTTPException(
            status_code=404,
            detail="Waiting intraday order not found",
        )

    removed = intraday_pending_orders.pop(order_index)

    return {
        "status": "success",
        "message": (
            f"Waiting {removed.get('side')} order for "
            f"{removed.get('symbol')} cancelled."
        ),
        "order": removed,
    }


@app.post("/api/intraday-paper/check-pending")
def check_intraday_pending_orders():

    executed = []
    waiting = []
    not_possible = []

    snapshot = list(intraday_pending_orders)

    for pending in snapshot:

        if pending.get("status") == "NOT_POSSIBLE":
            not_possible.append(pending)
            continue

        symbol = clean_symbol(pending.get("symbol", ""))
        side = str(pending.get("side", "")).upper()
        quantity = int(pending.get("quantity", 0) or 0)
        limit_price = safe_float(pending.get("limit_price"))

        if (
            not symbol or
            side not in ["BUY", "SELL"] or
            quantity <= 0 or
            limit_price is None
        ):
            pending["status"] = "NOT_POSSIBLE"
            pending["last_error"] = "Invalid waiting order"
            not_possible.append(pending)
            continue

        limit_price = round(float(limit_price), 2)
        previous_price = safe_float(
            pending.get("previous_market_price")
        )

        try:
            market_price = round(
                float(get_latest_equity_price(symbol)),
                2,
            )
            pending["last_market_price"] = market_price
        except Exception as error:
            pending["status"] = "WAITING"
            pending["last_error"] = f"Price unavailable: {error}"
            waiting.append(pending)
            continue

        # Exact equality is the ONLY execution condition.
        if market_price == limit_price:
            try:
                result = place_intraday_paper_order(
                    OrderRequest(
                        symbol=symbol,
                        side=side,
                        quantity=quantity,
                        order_type="MARKET",
                        limit_price=None,
                        order_value=None,
                        stop_loss=pending.get("stop_loss"),
                    )
                )

                trade = result.get("trade")

                if trade:
                    trade["order_type"] = "EXACT_PRICE_TRIGGERED"
                    trade["limit_price"] = limit_price
                    trade["pending_order_id"] = pending.get("id")
                    trade["trigger_market_price"] = market_price
                    trade["requested_order_value"] = pending.get(
                        "requested_order_value"
                    )

                executed.append({
                    "pending_order_id": pending.get("id"),
                    "symbol": symbol,
                    "side": side,
                    "quantity": quantity,
                    "limit_price": limit_price,
                    "trigger_market_price": market_price,
                    "trade": trade,
                })
                continue

            except Exception as error:
                detail = getattr(error, "detail", str(error))
                pending["status"] = "NOT_POSSIBLE"
                pending["last_error"] = str(detail)
                not_possible.append(pending)
                continue

        # If the observed market jumps across the requested price without
        # ever matching it, do not pretend the order filled.
        crossed_without_match = False

        if previous_price is not None:
            previous_price = round(float(previous_price), 2)

            crossed_without_match = (
                (previous_price < limit_price < market_price) or
                (previous_price > limit_price > market_price)
            )

        if crossed_without_match:
            pending["status"] = "NOT_POSSIBLE"
            pending["last_error"] = (
                f"Market moved from ₹{previous_price:,.2f} to "
                f"₹{market_price:,.2f} without matching "
                f"₹{limit_price:,.2f}."
            )
            pending["previous_market_price"] = market_price
            not_possible.append(pending)
            continue

        pending["status"] = "WAITING"
        pending["last_error"] = None
        pending["previous_market_price"] = market_price
        waiting.append(pending)

    intraday_pending_orders.clear()
    intraday_pending_orders.extend(waiting + not_possible)

    return {
        "status": "success",
        "executed_count": len(executed),
        "waiting_count": len(waiting),
        "not_possible_count": len(not_possible),
        "executed": executed,
        "waiting": waiting,
        "not_possible": not_possible,
        "orders": intraday_pending_orders,
    }


# ============================================================
# SET / REMOVE AUTOMATIC INTRADAY EXIT TARGET
# ============================================================

@app.post("/api/intraday-paper/target")
def set_intraday_exit_target(request: IntradayExitTargetRequest):

    symbol = clean_symbol(request.symbol)
    target_price = safe_float(request.target_price)

    if not symbol or symbol not in intraday_paper_positions:
        raise HTTPException(
            status_code=404,
            detail="No open intraday position found for this stock",
        )

    if target_price is None or target_price <= 0:
        raise HTTPException(
            status_code=400,
            detail="Enter a valid automatic exit price",
        )

    position = intraday_paper_positions[symbol]
    qty = int(position.get("quantity", 0) or 0)

    if qty == 0:
        raise HTTPException(
            status_code=400,
            detail="No open intraday quantity found",
        )

    try:
        current_price = get_latest_equity_price(symbol)
    except Exception:
        current_price = safe_float(position.get("average_price"))

    if current_price is None:
        raise HTTPException(
            status_code=500,
            detail="Unable to determine current stock price",
        )

    # This is a take-profit style automatic exit:
    # LONG -> target must be above current market price.
    # SHORT -> target must be below current market price.
    if qty > 0 and target_price <= current_price:
        raise HTTPException(
            status_code=400,
            detail=(
                f"For a LONG position, automatic exit price must be above "
                f"the current price ₹{current_price:,.2f}."
            ),
        )

    if qty < 0 and target_price >= current_price:
        raise HTTPException(
            status_code=400,
            detail=(
                f"For a SHORT position, automatic exit price must be below "
                f"the current price ₹{current_price:,.2f}."
            ),
        )

    position["exit_target"] = target_price

    return {
        "status": "success",
        "symbol": symbol,
        "direction": "LONG" if qty > 0 else "SHORT",
        "target_price": target_price,
        "current_price": current_price,
        "message": (
            f"Automatic exit target set for {symbol} at "
            f"₹{target_price:,.2f}."
        ),
    }


@app.delete("/api/intraday-paper/target/{symbol}")
def remove_intraday_exit_target(symbol: str):

    clean = clean_symbol(symbol)

    if not clean or clean not in intraday_paper_positions:
        raise HTTPException(
            status_code=404,
            detail="No open intraday position found for this stock",
        )

    intraday_paper_positions[clean]["exit_target"] = None

    return {
        "status": "success",
        "symbol": clean,
        "message": f"Automatic exit target removed for {clean}.",
    }


@app.post("/api/intraday-paper/check-triggers")
def check_intraday_exit_targets():

    triggered = []

    # Check BOTH take-profit targets and stop losses.
    # LONG:
    #   target    -> current >= target
    #   stop loss -> current <= stop loss
    # SHORT:
    #   target    -> current <= target
    #   stop loss -> current >= stop loss
    snapshot = list(intraday_paper_positions.items())

    for symbol, position in snapshot:

        qty = int(position.get("quantity", 0) or 0)
        target = safe_float(position.get("exit_target"))
        stop_loss = safe_float(position.get("stop_loss"))

        if qty == 0:
            continue

        if target is None and stop_loss is None:
            continue

        try:
            current_price = get_latest_equity_price(symbol)
        except Exception:
            continue

        target_hit = (
            target is not None and (
                (qty > 0 and current_price >= target) or
                (qty < 0 and current_price <= target)
            )
        )

        stop_loss_hit = (
            stop_loss is not None and (
                (qty > 0 and current_price <= stop_loss) or
                (qty < 0 and current_price >= stop_loss)
            )
        )

        if not target_hit and not stop_loss_hit:
            continue

        trigger_type = "STOP_LOSS" if stop_loss_hit else "TARGET"
        trigger_price = stop_loss if stop_loss_hit else target
        side = "SELL" if qty > 0 else "BUY"
        close_qty = abs(qty)

        # Clear both exit controls before sending the close order so the
        # same position cannot be triggered twice during this check.
        if symbol in intraday_paper_positions:
            intraday_paper_positions[symbol]["exit_target"] = None
            intraday_paper_positions[symbol]["stop_loss"] = None

        try:
            # Execute the square-off at the latest market price available
            # when the trigger is detected.
            result = place_intraday_paper_order(
                OrderRequest(
                    symbol=symbol,
                    side=side,
                    quantity=close_qty,
                    order_type="MARKET",
                    limit_price=None,
                    order_value=None,
                    stop_loss=None,
                )
            )
        except Exception:
            # Restore controls if execution fails.
            if symbol in intraday_paper_positions:
                intraday_paper_positions[symbol]["exit_target"] = target
                intraday_paper_positions[symbol]["stop_loss"] = stop_loss
            continue

        trade = result.get("trade")

        if trade:
            trade["trigger_type"] = trigger_type
            trade["trigger_price"] = trigger_price
            trade["position_stop_loss"] = stop_loss
            trade["position_exit_target"] = target
            save_intraday_trade(trade)

        triggered.append({
            "symbol": symbol,
            "side": side,
            "quantity": close_qty,
            "trigger_type": trigger_type,
            "trigger_price": trigger_price,
            "target_price": target,
            "stop_loss": stop_loss,
            "trigger_market_price": current_price,
            "trade": trade,
        })

    return {
        "status": "success",
        "triggered_count": len(triggered),
        "triggered": triggered,
    }


# ============================================================
# RESET INTRADAY PAPER ACCOUNT
# ============================================================

@app.post("/api/intraday-paper/reset")
def reset_intraday_paper_account():

    intraday_paper_account["balance"] = INTRADAY_STARTING_BALANCE
    intraday_paper_positions.clear()
    intraday_pending_orders.clear()

    # Do NOT clear intraday_paper_trades here.
    # Executed trades are permanent history and remain in SQLite.
    return {
        "status": "success",
        "message": (
            "Intraday paper account reset. "
            "Executed trade history has been preserved."
        ),
        "balance": INTRADAY_STARTING_BALANCE,
        "history_count": len(intraday_paper_trades),
    }


# ============================================================
# REMOVE / UNDO PAPER ORDER
# ============================================================

@app.delete("/api/paper/order/{trade_id}")
def remove_order(trade_id: str):

    trade_index = next(
        (
            index
            for index, trade in enumerate(paper_trades)
            if str(trade.get("id", "")) == str(trade_id)
        ),
        None,
    )

    if trade_index is None:
        raise HTTPException(
            status_code=404,
            detail="Paper order not found"
        )

    trade = paper_trades[trade_index]
    remaining_trades = [
        item
        for index, item in enumerate(paper_trades)
        if index != trade_index
    ]

    try:
        new_cash, new_positions = rebuild_paper_state(remaining_trades)
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )

    paper_trades[:] = remaining_trades
    paper_account["cash"] = new_cash
    paper_positions.clear()
    paper_positions.update(new_positions)

    return {
        "status": "success",
        "message": (
            f"Removed {trade.get('side', '')} order for "
            f"{trade.get('quantity', 0)} share(s) of {trade.get('symbol', '')}"
        ),
        "removed_trade": trade,
        "cash": paper_account["cash"],
    }


# ============================================================
# RESET
# ============================================================

@app.post("/api/paper/reset")
def reset_account():

    paper_account[
        "cash"
    ] = STARTING_BALANCE

    paper_positions.clear()

    paper_trades.clear()

    return {

        "status":
            "success",

        "message":
            "Paper trading account reset",

        "cash":
            STARTING_BALANCE,
    }


# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():

    return {

        "message":
            "Indian Stock Analyzer API",

        "version":
            "5.0.0",

        "https":
            True,
    }