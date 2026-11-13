CREATE TABLE IF NOT EXISTS invites (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS turns (
 invite_id TEXT NOT NULL REFERENCES invites(id), request_id TEXT NOT NULL,
 conversation TEXT NOT NULL, created_at INTEGER NOT NULL, question TEXT NOT NULL,
 answer TEXT, sources TEXT, status TEXT NOT NULL DEFAULT 'pending',
 PRIMARY KEY(invite_id,request_id)
);
CREATE INDEX IF NOT EXISTS turns_recent ON turns(invite_id,created_at);
