// sqlite: the replay ledger and the payment log, one row per signed delegate action.
//
// A payment is keyed by the sha256 of its signed delegate bytes (the same key @x402/near uses for its settlement cache) and
// moves through   reserved -> submitted -> settled -> delivered   or ends in   failed.
//   reserved   the payment passed verification and the upstream call is in flight; nothing is on the chain yet
//   submitted  the relayer transaction is signed and its hash and bytes are stored BEFORE it is broadcast, so a crash after this point
//              is reconciled by looking the hash up on the chain and, if the chain never saw it, broadcasting the same bytes again
//   settled    the chain confirms the inner ft_transfer receipt succeeded: the agent has been charged
//   delivered  the data was handed to the agent. A payment can be delivered once; "settled" without "delivered" only exists
//              after a crash, and the same payment header then collects the data without paying again
//   failed     the transfer did not happen (or the delegate expired unsubmitted); the agent was not charged
import Database from 'better-sqlite3';

export function openStore(path) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL,
      route TEXT NOT NULL,
      payer TEXT NOT NULL,
      amount TEXT NOT NULL,
      max_block_height TEXT,
      tx_hash TEXT,
      relayer TEXT,
      ts_created INTEGER NOT NULL,
      ts_settled INTEGER,
      ts_delivered INTEGER,
      upstream_ms INTEGER,
      settle_ms INTEGER,
      total_ms INTEGER,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS payments_state ON payments(state);
  `);
  // Databases created before the signed transaction was stored get the column added in place.
  if (!db.prepare('PRAGMA table_info(payments)').all().some((c) => c.name === 'signed_tx')) db.exec('ALTER TABLE payments ADD COLUMN signed_tx TEXT');
  // A crash before broadcast leaves nothing on the chain, so a stranded reservation is simply dropped.
  db.prepare("DELETE FROM payments WHERE state = 'reserved'").run();

  const get = db.prepare('SELECT * FROM payments WHERE hash = ?');
  const ins = db.prepare(`INSERT INTO payments (hash, state, route, payer, amount, max_block_height, ts_created)
                          VALUES (@hash, 'reserved', @route, @payer, @amount, @max_block_height, @ts)`);
  const now = () => Math.floor(Date.now() / 1000);

  const counted = "state IN ('settled','delivered')";

  return {
    db,
    get: (hash) => get.get(hash),
    // true when the hash was free and is now reserved; false when any row (any state) already exists
    reserve(p) {
      try { ins.run({ ...p, ts: now() }); return true; } catch (e) { if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return false; throw e; }
    },
    release: (hash) => db.prepare("DELETE FROM payments WHERE hash = ? AND state = 'reserved'").run(hash),
    // the exact signed relayer transaction is stored with its hash: after a crash the same bytes can be broadcast again (same hash, so the chain executes them at most once)
    submitted: (hash, txHash, relayer, signedTx) => db.prepare("UPDATE payments SET state = 'submitted', tx_hash = ?, relayer = ?, signed_tx = ? WHERE hash = ? AND state = 'reserved'").run(txHash, relayer, signedTx ?? null, hash),
    settled: (hash, settleMs) => db.prepare("UPDATE payments SET state = 'settled', ts_settled = ?, settle_ms = COALESCE(?, settle_ms), error = NULL WHERE hash = ? AND state IN ('submitted','settled')").run(now(), settleMs ?? null, hash),
    delivered: (hash, m) => db.prepare("UPDATE payments SET state = 'delivered', ts_delivered = ?, upstream_ms = COALESCE(?, upstream_ms), total_ms = COALESCE(?, total_ms) WHERE hash = ? AND state = 'settled'").run(now(), m?.upstream_ms ?? null, m?.total_ms ?? null, hash),
    failed: (hash, error) => db.prepare("UPDATE payments SET state = 'failed', error = ? WHERE hash = ? AND state IN ('reserved','submitted')").run(String(error).slice(0, 500), hash),
    pending: () => db.prepare("SELECT * FROM payments WHERE state = 'submitted' ORDER BY id").all(),
    stranded: () => db.prepare("SELECT * FROM payments WHERE state = 'settled' ORDER BY id").all(),
    stats() {
      const rows = db.prepare(`SELECT amount FROM payments WHERE ${counted}`).all();
      const t = { n: rows.length, atomic: rows.reduce((a, r) => a + BigInt(r.amount), 0n) };
      const byState = db.prepare('SELECT state, COUNT(*) n FROM payments GROUP BY state').all();
      const byRoute = db.prepare(`SELECT route, COUNT(*) n FROM payments WHERE ${counted} GROUP BY route ORDER BY n DESC`).all();
      const payers = db.prepare(`SELECT COUNT(DISTINCT payer) n FROM payments WHERE ${counted}`).get().n;
      const day = db.prepare(`SELECT COUNT(*) n FROM payments WHERE ${counted} AND ts_settled > ?`).get(now() - 86400).n;
      const lat = db.prepare(`SELECT settle_ms FROM payments WHERE ${counted} AND settle_ms IS NOT NULL ORDER BY settle_ms`).all().map((r) => r.settle_ms);
      const pct = (q) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] : null);
      return { settled: t.n, atomic: t.atomic, byState, byRoute, payers, last24h: day, settleMs: { n: lat.length, p50: pct(0.5), p90: pct(0.9), max: lat.at(-1) ?? null } };
    },
    recent: (limit = 20) => db.prepare(`SELECT * FROM payments WHERE ${counted} ORDER BY id DESC LIMIT ?`).all(limit),
    all: () => db.prepare(`SELECT * FROM payments WHERE ${counted} ORDER BY id ASC`).all(),
    close: () => db.close(),
  };
}
