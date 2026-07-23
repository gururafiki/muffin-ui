# getState latency — checkpointer read is a flat ~27s (Track 2)

Measured against the deployed API on a finished criteria_analysis thread
(019f85d6-2cdc-719e-a3f0-d8f01e5b3016), identical ~46KB of state values:

| Endpoint | Path | Time (x3) |
|---|---|---|
| GET /threads/{id}/state | checkpointer (langgraph-postgres) | 27.9 / 27.3 / 27.4 s |
| GET /threads/{id} | denormalized thread.values (JSONB) | 0.12 / 0.11 s |
| POST /threads/search | denormalized thread.values | 0.11 / 0.14 s |
| POST /threads/{id}/history (8 checkpoints) | checkpointer | 27.6 s |

Findings: cost is ~240x the thread.values path, independent of checkpoint count
(getState=1 ckpt ≈ getHistory=8 ckpts ≈ 27s) and of payload size (46KB). NOT
checkpoint bloat. Points at the langgraph-postgres checkpointer connection/pool/
setup path (cold/slow connection, tiny pool, per-call setup) — separate from the
fast threads-table SELECT that serves thread.values.

First diagnostics (deliver as a muffin-agent / muffin-deployment patch):
- langgraph-api checkpointer connection-pool config (size, min/max, lifetime) +
  DB connection latency from the node; whether a per-call setup()/migration runs.
- Instrument/time the checkpointer aget_tuple; compare a raw psql query.
- langgraph-postgres image version + known checkpointer perf issues; node CPU/IO
  under the ~14-service load.

The muffin-ui Track-1 fix (hydrate reopens from thread.values) sidesteps this for
the Calls-reopen path but does NOT help live runs / resume, which still call
getState — hence this remains worth root-causing.
