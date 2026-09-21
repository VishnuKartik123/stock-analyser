"""
Nightly Render -> Local SQLite synchronization.

Usage:
    python nightly_sync.py

Optional environment variables:
    RENDER_BACKEND_URL
    APP_USERNAME
    APP_PASSWORD
    TRADE_HISTORY_DB_PATH

The script logs into the Render backend, exports all learning records that are
still available there, and UPSERTs them into the permanent local SQLite DB.
Running it repeatedly is safe: primary keys prevent duplicates.
"""

from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import getpass
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request


DEFAULT_RENDER_BACKEND = "https://stock-analyser-z5sc.onrender.com"
BASE_URL = os.getenv("RENDER_BACKEND_URL", DEFAULT_RENDER_BACKEND).rstrip("/")
LOCAL_DB = Path(
    os.getenv(
        "TRADE_HISTORY_DB_PATH",
        str(Path(__file__).resolve().parent / "stock_analyser_history.db"),
    )
)


def http_json(url, method="GET", payload=None, token=None, timeout=120):
    body = None
    headers = {"Accept": "application/json"}

    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = urllib.request.Request(
        url,
        data=body,
        headers=headers,
        method=method,
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"HTTP {error.code} from {url}: {detail}"
        ) from error
    except urllib.error.URLError as error:
        raise RuntimeError(
            f"Could not connect to {url}: {error.reason}"
        ) from error


def login():
    username = os.getenv("APP_USERNAME") or input("Render username: ").strip()
    password = os.getenv("APP_PASSWORD") or getpass.getpass("Render password: ")

    if not username or not password:
        raise RuntimeError("Username/password cannot be empty")

    response = http_json(
        f"{BASE_URL}/api/auth/login",
        method="POST",
        payload={"username": username, "password": password},
    )

    token = response.get("token")
    if not token:
        raise RuntimeError("Render login succeeded without returning a token")
    return token


def init_local_db(connection):
    connection.execute("""
        CREATE TABLE IF NOT EXISTS intraday_trade_history (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            trade_json TEXT NOT NULL
        )
    """)

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

    connection.execute("""
        CREATE TABLE IF NOT EXISTS nightly_sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            synced_at TEXT NOT NULL,
            render_url TEXT NOT NULL,
            export_json TEXT NOT NULL
        )
    """)


def exists(connection, table, key_column, key):
    row = connection.execute(
        f"SELECT 1 FROM {table} WHERE {key_column}=? LIMIT 1",
        (key,),
    ).fetchone()
    return row is not None


def synchronize(export):
    LOCAL_DB.parent.mkdir(parents=True, exist_ok=True)

    stats = {
        "trades_new": 0,
        "trades_existing": 0,
        "signals_new": 0,
        "signals_existing": 0,
        "candidates_new": 0,
        "candidates_existing": 0,
        "reviews_new": 0,
        "reviews_existing": 0,
    }

    connection = sqlite3.connect(LOCAL_DB, timeout=30)
    try:
        connection.execute("PRAGMA busy_timeout=30000")
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=FULL")
        init_local_db(connection)
        connection.commit()

        connection.execute("BEGIN IMMEDIATE")

        for item in export.get("trades", []):
            trade_id = str(item["id"])
            already = exists(
                connection, "intraday_trade_history", "id", trade_id
            )
            trade = item.get("data") or {}
            trade["id"] = trade_id
            trade["timestamp"] = str(
                item.get("timestamp") or trade.get("timestamp") or ""
            )

            connection.execute(
                """
                INSERT INTO intraday_trade_history(id,timestamp,trade_json)
                VALUES(?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                    timestamp=excluded.timestamp,
                    trade_json=excluded.trade_json
                """,
                (
                    trade_id,
                    trade["timestamp"],
                    json.dumps(trade, ensure_ascii=False, default=str),
                ),
            )
            stats["trades_existing" if already else "trades_new"] += 1

        for item in export.get("signals", []):
            signal_id = str(item["id"])
            already = exists(
                connection, "scanner_signal_history", "id", signal_id
            )
            connection.execute(
                """
                INSERT INTO scanner_signal_history
                (id,trade_date,timestamp,symbol,side,signal_json)
                VALUES(?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                    trade_date=excluded.trade_date,
                    timestamp=excluded.timestamp,
                    symbol=excluded.symbol,
                    side=excluded.side,
                    signal_json=excluded.signal_json
                """,
                (
                    signal_id,
                    str(item.get("trade_date") or ""),
                    str(item.get("timestamp") or ""),
                    str(item.get("symbol") or ""),
                    str(item.get("side") or ""),
                    json.dumps(
                        item.get("data") or {},
                        ensure_ascii=False,
                        default=str,
                    ),
                ),
            )
            stats["signals_existing" if already else "signals_new"] += 1

        for item in export.get("candidates", []):
            candidate_id = str(item["id"])
            already = exists(
                connection, "scanner_candidate_history", "id", candidate_id
            )
            outcome = item.get("outcome")

            connection.execute(
                """
                INSERT INTO scanner_candidate_history
                (id,trade_date,timestamp,symbol,side,qualified,resolved,
                 candidate_json,outcome_json)
                VALUES(?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                    trade_date=excluded.trade_date,
                    timestamp=excluded.timestamp,
                    symbol=excluded.symbol,
                    side=excluded.side,
                    qualified=MAX(
                        scanner_candidate_history.qualified,
                        excluded.qualified
                    ),
                    resolved=MAX(
                        scanner_candidate_history.resolved,
                        excluded.resolved
                    ),
                    candidate_json=excluded.candidate_json,
                    outcome_json=COALESCE(
                        excluded.outcome_json,
                        scanner_candidate_history.outcome_json
                    )
                """,
                (
                    candidate_id,
                    str(item.get("trade_date") or ""),
                    str(item.get("timestamp") or ""),
                    str(item.get("symbol") or ""),
                    str(item.get("side") or ""),
                    int(item.get("qualified") or 0),
                    int(item.get("resolved") or 0),
                    json.dumps(
                        item.get("candidate") or {},
                        ensure_ascii=False,
                        default=str,
                    ),
                    (
                        json.dumps(
                            outcome,
                            ensure_ascii=False,
                            default=str,
                        )
                        if isinstance(outcome, dict)
                        else None
                    ),
                ),
            )
            stats["candidates_existing" if already else "candidates_new"] += 1

        for item in export.get("daily_reviews", []):
            trade_date = str(item["trade_date"])
            already = exists(
                connection, "scanner_daily_review", "trade_date", trade_date
            )
            connection.execute(
                """
                INSERT INTO scanner_daily_review
                (trade_date,created_at,review_json)
                VALUES(?,?,?)
                ON CONFLICT(trade_date) DO UPDATE SET
                    created_at=excluded.created_at,
                    review_json=excluded.review_json
                """,
                (
                    trade_date,
                    str(item.get("created_at") or ""),
                    json.dumps(
                        item.get("data") or {},
                        ensure_ascii=False,
                        default=str,
                    ),
                ),
            )
            stats["reviews_existing" if already else "reviews_new"] += 1

        connection.execute(
            """
            INSERT INTO nightly_sync_log(synced_at,render_url,export_json)
            VALUES(?,?,?)
            """,
            (
                datetime.now(ZoneInfo("Asia/Kolkata")).isoformat(),
                BASE_URL,
                json.dumps(
                    {
                        "exported_at": export.get("exported_at"),
                        "counts": export.get("counts", {}),
                    },
                    ensure_ascii=False,
                ),
            ),
        )

        connection.commit()

        counts = {
            "local_trades": connection.execute(
                "SELECT COUNT(*) FROM intraday_trade_history"
            ).fetchone()[0],
            "local_signals": connection.execute(
                "SELECT COUNT(*) FROM scanner_signal_history"
            ).fetchone()[0],
            "local_candidates": connection.execute(
                "SELECT COUNT(*) FROM scanner_candidate_history"
            ).fetchone()[0],
            "local_reviews": connection.execute(
                "SELECT COUNT(*) FROM scanner_daily_review"
            ).fetchone()[0],
        }

        # Read-back verification for every exported execution.
        missing_trade_ids = []
        for item in export.get("trades", []):
            if not exists(
                connection,
                "intraday_trade_history",
                "id",
                str(item["id"]),
            ):
                missing_trade_ids.append(str(item["id"]))

        if missing_trade_ids:
            raise RuntimeError(
                "Verification failed. Missing local trade IDs: "
                + ", ".join(missing_trade_ids)
            )

        return stats, counts
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()



# ============================================================
# LOCAL END-OF-DAY LEARNING / TRAINING
# ============================================================
# This deliberately uses transparent historical statistics instead of fitting
# a complex ML model to a small sample.  The profile becomes more influential
# only after a pattern has enough resolved observations.
LEARNING_MIN_SAMPLE = max(5, int(os.getenv("LEARNING_MIN_SAMPLE", "20")))
LEARNING_REPORT_PATH = Path(
    os.getenv(
        "LEARNING_REPORT_PATH",
        str(Path(__file__).resolve().parent / "learning_profile.json"),
    )
)


def _json_object(value):
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _number(*values):
    for value in values:
        try:
            if value is None or value == "":
                continue
            number = float(value)
            if number == number and number not in (float("inf"), float("-inf")):
                return number
        except (TypeError, ValueError):
            pass
    return None


def _first(mapping, *keys, default=None):
    for key in keys:
        if key in mapping and mapping.get(key) not in (None, ""):
            return mapping.get(key)
    return default


def _candidate_result(outcome):
    """Normalize different backend outcome spellings into TARGET/STOP/OTHER."""
    if not outcome:
        return "UNRESOLVED"

    raw_values = []
    for key in (
        "result", "outcome", "status", "resolution", "first_hit",
        "hit_first", "exit_reason", "trigger_type", "label",
    ):
        value = outcome.get(key)
        if value is not None:
            raw_values.append(str(value).upper())

    text = " ".join(raw_values)
    if any(token in text for token in ("TARGET", "T1", "T2", "TP", "PROFIT", "WIN")):
        return "TARGET"
    if any(token in text for token in ("STOP", "SL", "LOSS")):
        return "STOP"
    if any(token in text for token in ("AMBIG", "BOTH")):
        return "AMBIGUOUS"
    if any(token in text for token in ("NO_LEVEL", "NO HIT", "NONE", "EXPIRED", "TIMEOUT")):
        return "NO_LEVEL_HIT"

    # Boolean fallbacks used by some review formats.
    target_hit = any(bool(outcome.get(k)) for k in ("target_hit", "target_1_hit", "t1_hit", "t2_hit"))
    stop_hit = any(bool(outcome.get(k)) for k in ("stop_hit", "stop_loss_hit", "sl_hit"))
    if target_hit and not stop_hit:
        return "TARGET"
    if stop_hit and not target_hit:
        return "STOP"
    if target_hit and stop_hit:
        return "AMBIGUOUS"
    return "OTHER"


def _time_bucket(timestamp_text):
    try:
        dt = datetime.fromisoformat(str(timestamp_text).replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(ZoneInfo("Asia/Kolkata"))
        minutes = dt.hour * 60 + dt.minute
        if minutes < 9 * 60 + 45:
            return "BEFORE_09_45"
        if minutes < 10 * 60 + 30:
            return "09_45_10_30"
        if minutes < 12 * 60:
            return "10_30_12_00"
        if minutes < 14 * 60 + 45:
            return "12_00_14_45"
        return "AFTER_14_45"
    except Exception:
        return "UNKNOWN"


def _range_bucket(value, cuts, labels):
    if value is None:
        return "UNKNOWN"
    for cut, label in zip(cuts, labels):
        if value < cut:
            return label
    return labels[-1]


def _pattern_stats(rows, key_function):
    groups = {}
    for row in rows:
        key = str(key_function(row) or "UNKNOWN")
        group = groups.setdefault(key, {"samples": 0, "targets": 0, "stops": 0, "other": 0})
        group["samples"] += 1
        if row["result"] == "TARGET":
            group["targets"] += 1
        elif row["result"] == "STOP":
            group["stops"] += 1
        else:
            group["other"] += 1

    for group in groups.values():
        decisive = group["targets"] + group["stops"]
        group["decisive_samples"] = decisive
        group["success_rate"] = round(group["targets"] / decisive, 4) if decisive else None
        group["eligible_for_learning"] = decisive >= LEARNING_MIN_SAMPLE
    return dict(sorted(groups.items(), key=lambda item: (-item[1]["samples"], item[0])))


def _build_trade_statistics(connection):
    trades = []
    for timestamp, payload in connection.execute(
        "SELECT timestamp, trade_json FROM intraday_trade_history ORDER BY timestamp"
    ):
        trade = _json_object(payload)
        pnl = _number(trade.get("realized_pnl"), 0.0) or 0.0
        action = str(trade.get("action") or "").upper()
        is_close = action.startswith("CLOSE") or abs(pnl) > 1e-12
        trades.append({
            "timestamp": timestamp,
            "symbol": str(trade.get("symbol") or "").upper(),
            "side": str(trade.get("side") or "").upper(),
            "action": action,
            "price": _number(trade.get("price"), trade.get("market_price")),
            "quantity": _number(trade.get("quantity")),
            "realized_pnl": pnl,
            "stop_loss": _number(trade.get("stop_loss")),
            "exit_reason": str(_first(trade, "exit_reason", "trigger_type", default="") or "").upper(),
            "is_close": is_close,
        })

    closes = [trade for trade in trades if trade["is_close"]]
    wins = [trade for trade in closes if trade["realized_pnl"] > 0]
    losses = [trade for trade in closes if trade["realized_pnl"] < 0]
    breakeven = [trade for trade in closes if abs(trade["realized_pnl"]) <= 1e-12]
    net = sum(trade["realized_pnl"] for trade in closes)
    gross_profit = sum(trade["realized_pnl"] for trade in wins)
    gross_loss = abs(sum(trade["realized_pnl"] for trade in losses))

    return {
        "execution_records": len(trades),
        "completed_trades": len(closes),
        "wins": len(wins),
        "losses": len(losses),
        "breakeven": len(breakeven),
        "win_rate": round(len(wins) / len(closes), 4) if closes else None,
        "net_realized_pnl": round(net, 2),
        "gross_profit": round(gross_profit, 2),
        "gross_loss": round(gross_loss, 2),
        "profit_factor": round(gross_profit / gross_loss, 4) if gross_loss > 0 else None,
        "average_win": round(gross_profit / len(wins), 2) if wins else None,
        "average_loss": round(-gross_loss / len(losses), 2) if losses else None,
        "by_symbol": _trade_symbol_stats(closes),
    }


def _trade_symbol_stats(closes):
    result = {}
    for trade in closes:
        symbol = trade["symbol"] or "UNKNOWN"
        row = result.setdefault(symbol, {"completed": 0, "wins": 0, "losses": 0, "net_pnl": 0.0})
        row["completed"] += 1
        row["net_pnl"] += trade["realized_pnl"]
        if trade["realized_pnl"] > 0:
            row["wins"] += 1
        elif trade["realized_pnl"] < 0:
            row["losses"] += 1
    for row in result.values():
        row["net_pnl"] = round(row["net_pnl"], 2)
        row["win_rate"] = round(row["wins"] / row["completed"], 4) if row["completed"] else None
    return dict(sorted(result.items()))


def build_learning_profile(connection):
    resolved_rows = []
    total_candidates = 0
    qualified_candidates = 0

    query = """
        SELECT trade_date,timestamp,symbol,side,qualified,resolved,candidate_json,outcome_json
        FROM scanner_candidate_history
        ORDER BY timestamp
    """
    for trade_date, timestamp, symbol, side, qualified, resolved, candidate_json, outcome_json in connection.execute(query):
        total_candidates += 1
        qualified_candidates += int(bool(qualified))
        candidate = _json_object(candidate_json)
        outcome = _json_object(outcome_json)
        result = _candidate_result(outcome)
        if not resolved and result == "UNRESOLVED":
            continue
        if result == "UNRESOLVED":
            result = "OTHER"

        interval = str(_first(candidate, "interval", "timeframe", default="UNKNOWN") or "UNKNOWN")
        quality = _number(_first(candidate, "setup_quality", "quality", "score"))
        rr = _number(_first(candidate, "risk_reward", "rr", "risk_reward_ratio"))
        volume_ratio = _number(_first(candidate, "volume_ratio", "relative_volume", "rvol"))
        rsi = _number(_first(candidate, "rsi", "rsi_14"))
        price = _number(_first(candidate, "entry_price", "entry", "current_price", "price"))
        vwap = _number(_first(candidate, "vwap", "VWAP"))
        ema9 = _number(_first(candidate, "ema9", "ema_9", "EMA9"))
        ema20 = _number(_first(candidate, "ema20", "ema_20", "EMA20"))

        if ema9 is not None and ema20 is not None:
            ema_alignment = "BULLISH" if ema9 > ema20 else "BEARISH" if ema9 < ema20 else "FLAT"
        else:
            ema_alignment = "UNKNOWN"
        if price is not None and vwap is not None:
            vwap_position = "ABOVE" if price > vwap else "BELOW" if price < vwap else "AT"
        else:
            vwap_position = "UNKNOWN"

        resolved_rows.append({
            "trade_date": trade_date,
            "timestamp": timestamp,
            "symbol": str(symbol or "").upper(),
            "side": str(side or "").upper(),
            "qualified": bool(qualified),
            "result": result,
            "interval": interval,
            "time_bucket": _time_bucket(timestamp),
            "quality": quality,
            "rr": rr,
            "volume_ratio": volume_ratio,
            "rsi": rsi,
            "ema_alignment": ema_alignment,
            "vwap_position": vwap_position,
        })

    decisive = [row for row in resolved_rows if row["result"] in ("TARGET", "STOP")]
    target_count = sum(row["result"] == "TARGET" for row in decisive)
    stop_count = sum(row["result"] == "STOP" for row in decisive)

    dimensions = {
        "side": _pattern_stats(decisive, lambda r: r["side"]),
        "interval": _pattern_stats(decisive, lambda r: r["interval"]),
        "time_bucket": _pattern_stats(decisive, lambda r: r["time_bucket"]),
        "qualified": _pattern_stats(decisive, lambda r: "QUALIFIED" if r["qualified"] else "REJECTED"),
        "setup_quality": _pattern_stats(
            decisive,
            lambda r: _range_bucket(r["quality"], [6, 7, 8, 9], ["<6", "6-6.99", "7-7.99", "8+"])
        ),
        "risk_reward": _pattern_stats(
            decisive,
            lambda r: _range_bucket(r["rr"], [1.2, 1.5, 1.8, 2.0], ["<1.2", "1.2-1.49", "1.5-1.79", "1.8+"])
        ),
        "volume_ratio": _pattern_stats(
            decisive,
            lambda r: _range_bucket(r["volume_ratio"], [0.8, 1.0, 1.2, 1.5], ["<0.8", "0.8-0.99", "1.0-1.19", "1.2+"])
        ),
        "rsi": _pattern_stats(
            decisive,
            lambda r: _range_bucket(r["rsi"], [40, 50, 60, 70], ["<40", "40-49.9", "50-59.9", "60+"])
        ),
        "ema_alignment": _pattern_stats(decisive, lambda r: r["ema_alignment"]),
        "vwap_position": _pattern_stats(decisive, lambda r: r["vwap_position"]),
    }

    eligible_patterns = []
    for dimension, groups in dimensions.items():
        for name, stats in groups.items():
            if not stats["eligible_for_learning"] or stats["success_rate"] is None:
                continue
            eligible_patterns.append({
                "dimension": dimension,
                "value": name,
                "decisive_samples": stats["decisive_samples"],
                "success_rate": stats["success_rate"],
            })
    eligible_patterns.sort(key=lambda item: (-item["decisive_samples"], -item["success_rate"]))

    return {
        "generated_at": datetime.now(ZoneInfo("Asia/Kolkata")).isoformat(),
        "minimum_pattern_sample": LEARNING_MIN_SAMPLE,
        "candidate_summary": {
            "total": total_candidates,
            "qualified": qualified_candidates,
            "resolved": len(resolved_rows),
            "decisive": len(decisive),
            "target_first": target_count,
            "stop_first": stop_count,
            "historical_success_rate": round(target_count / len(decisive), 4) if decisive else None,
        },
        "trade_summary": _build_trade_statistics(connection),
        "dimensions": dimensions,
        "eligible_patterns": eligible_patterns,
        "policy": {
            "mode": "STATISTICAL_OBSERVATION",
            "auto_change_live_thresholds": False,
            "reason": (
                "Learning profile records evidence but does not automatically rewrite trading thresholds. "
                "Only patterns meeting the minimum sample are marked eligible, and changes should be "
                "validated on later out-of-sample sessions."
            ),
        },
    }


def save_learning_profile(profile):
    LEARNING_REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp_path = LEARNING_REPORT_PATH.with_suffix(LEARNING_REPORT_PATH.suffix + ".tmp")
    temp_path.write_text(
        json.dumps(profile, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    temp_path.replace(LEARNING_REPORT_PATH)

    connection = sqlite3.connect(LOCAL_DB, timeout=30)
    try:
        connection.execute("PRAGMA busy_timeout=30000")
        connection.execute("""
            CREATE TABLE IF NOT EXISTS learning_profile_history (
                generated_at TEXT PRIMARY KEY,
                profile_json TEXT NOT NULL
            )
        """)
        connection.execute("""
            INSERT OR REPLACE INTO learning_profile_history(generated_at, profile_json)
            VALUES(?, ?)
        """, (
            profile["generated_at"],
            json.dumps(profile, ensure_ascii=False, default=str),
        ))
        connection.commit()
    finally:
        connection.close()


def train_local_archive():
    connection = sqlite3.connect(LOCAL_DB, timeout=30)
    try:
        connection.execute("PRAGMA busy_timeout=30000")
        init_local_db(connection)
        profile = build_learning_profile(connection)
    finally:
        connection.close()

    save_learning_profile(profile)
    return profile


def print_learning_summary(profile):
    candidates = profile["candidate_summary"]
    trades = profile["trade_summary"]

    print()
    print("LOCAL LEARNING / TRAINING COMPLETE")
    print("-" * 64)
    print(f"Candidates total    : {candidates['total']}")
    print(f"Candidates resolved : {candidates['resolved']}")
    print(f"Decisive outcomes   : {candidates['decisive']}")
    print(f"Target first        : {candidates['target_first']}")
    print(f"Stop first          : {candidates['stop_first']}")
    if candidates["historical_success_rate"] is not None:
        print(f"Candidate success   : {candidates['historical_success_rate'] * 100:.2f}%")
    else:
        print("Candidate success   : Not enough resolved target/stop outcomes")

    print("-" * 64)
    print(f"Execution records   : {trades['execution_records']}")
    print(f"Completed trades    : {trades['completed_trades']}")
    print(f"Wins / Losses       : {trades['wins']} / {trades['losses']}")
    if trades["win_rate"] is not None:
        print(f"Executed win rate   : {trades['win_rate'] * 100:.2f}%")
    else:
        print("Executed win rate   : No completed trades")
    print(f"Net realized P&L    : INR {trades['net_realized_pnl']:.2f}")
    print("-" * 64)

    eligible = profile.get("eligible_patterns") or []
    if eligible:
        print("Patterns with enough decisive samples:")
        for item in eligible[:10]:
            print(
                f"  {item['dimension']}={item['value']} | "
                f"n={item['decisive_samples']} | "
                f"success={item['success_rate'] * 100:.2f}%"
            )
    else:
        print(
            f"No individual pattern has {LEARNING_MIN_SAMPLE} decisive samples yet. "
            "Data was learned and retained, but thresholds were not auto-changed."
        )

    print(f"Learning profile    : {LEARNING_REPORT_PATH}")
    print("Mode                : observation + evidence collection")
    print("Live thresholds     : unchanged automatically")

def main():
    print("=" * 64)
    print("STOCK ANALYSER - NIGHTLY RENDER -> LOCAL SYNC")
    print("=" * 64)
    print(f"Render backend : {BASE_URL}")
    print(f"Local database : {LOCAL_DB}")
    print()

    token = login()

    # Export everything still available on Render. Local UPSERTs make this
    # idempotent, and exporting all available records is safer than relying
    # on a single date around midnight or after a delayed EOD review.
    print("Downloading Render learning data...")
    export = http_json(
        f"{BASE_URL}/api/learning/export",
        token=token,
        timeout=180,
    )

    remote = export.get("counts", {})
    print(
        "Render export   : "
        f"{remote.get('trades', 0)} trades, "
        f"{remote.get('signals', 0)} signals, "
        f"{remote.get('candidates', 0)} candidates, "
        f"{remote.get('daily_reviews', 0)} reviews"
    )

    stats, counts = synchronize(export)

    print()
    print("SYNC COMPLETE")
    print("-" * 64)
    print(
        f"Trades      : +{stats['trades_new']} new, "
        f"{stats['trades_existing']} already local"
    )
    print(
        f"Signals     : +{stats['signals_new']} new, "
        f"{stats['signals_existing']} already local"
    )
    print(
        f"Candidates  : +{stats['candidates_new']} new, "
        f"{stats['candidates_existing']} already local"
    )
    print(
        f"Daily review: +{stats['reviews_new']} new, "
        f"{stats['reviews_existing']} already local"
    )
    print("-" * 64)
    print(f"Local trade history : {counts['local_trades']}")
    print(f"Local signals       : {counts['local_signals']}")
    print(f"Local candidates    : {counts['local_candidates']}")
    print(f"Local daily reviews : {counts['local_reviews']}")
    print("Database verification: PASSED")
    print()
    print("The local SQLite database is now the permanent learning archive.")

    # Train immediately after every successful nightly synchronization.
    profile = train_local_archive()
    print_learning_summary(profile)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nSync cancelled.")
        sys.exit(130)
    except Exception as error:
        print()
        print("SYNC FAILED")
        print(str(error))
        sys.exit(1)
