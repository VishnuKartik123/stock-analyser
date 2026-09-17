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
