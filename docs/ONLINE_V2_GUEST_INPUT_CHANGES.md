# Guest input timing correction

## Problem and behavior

A slower remote player could connect, load the game and see character selection,
but every input was rejected as late. Both menu scheduling and the server's
future-input limit were capped at the eight-tick rollback window (about 267 ms).
A confirmation reaching the guest and a control returning to the host can take
longer than that, including through a tunnel.

Network input scheduling now uses the measured RTT/jitter budget independently
of rollback history, with a bounded 2–64 tick lead. Prediction still retains at
most eight ticks. Menus use the full network budget; quick press/release edges
within a single confirmation tick receive separate target ticks. Driving uses
immediate prediction on shorter connections. When the required input lead
exceeds eight ticks, only the excess is buffered so the same input is applied
at its scheduled tick in both simulations. A slower guest does not impose this
extra buffer on the host.

Inputs remain socket-owned, tick-specific and rate-limited. Late packets cannot
rewrite a completed tick. The larger future-control queue stores small pad
values, not additional game checkpoints or disc bytes.

Restart the Node server with `npm --prefix web run start:online-v2`, hard-refresh
both browsers, and create a new lobby. Server and browser JavaScript must both
be updated. Retest character movement/confirmation and driving through the
actual Cloudflare connection with the guest's keyboard.

## Files modified

| File | Description |
| --- | --- |
| `web/online-v2-protocol.mjs` | Defines the separate 64-tick maximum network input lead; leaves the eight-tick rollback limit unchanged. |
| `web/online-v2-latency.mjs` | Computes network input lead separately from local prediction lead using the same RTT/jitter samples. |
| `web/online-v2-client.js` | Schedules menus with the network lead, preserves quick menu edges and buffers excess race input lead before local application. |
| `web/online-v2-server.mjs` | Accepts future controls within the bounded network input window while preserving socket ownership and rejection of expired inputs. |
| `web/online-v2-engine-probe.mjs` | Adds an independently delayed guest connection, per-player input diagnostics and assertions that authority receives both players' driving controls. |
| `web/tests/online-v2.test.mjs` | Covers quick menu edges, separate lead budgets, delayed racing input, immediate short-RTT behavior and bounded/socket-owned future input acceptance. |
| `docs/ONLINE_V2.md` | Describes the separate network/prediction budgets and excess-input buffering. |
| `docs/ONLINE_V2_ENGINE_MENU_CHANGES.md` | Updates the menu timing description and links this correction. |

## Files created

| File | Description |
| --- | --- |
| `docs/ONLINE_V2_GUEST_INPUT_CHANGES.md` | Records the cause, implementation, validation, file summary and live retest instructions. |

## Verification

- The original failure was reproduced with a 30 ms upstream / 40 ms downstream
  host and a 200 ms upstream / 220 ms downstream guest with 25 ms jitter.
  Character selection stayed stuck: the host queued 1,185 controls while all
  1,114 guest controls arrived late.
- With the same setup, manual disc loading, Create/Join, each player's character
  movement/confirmation, original race loading, individual cameras, driving,
  fullscreen and pause/resume passed. The authority queued 603 guest controls
  and applied guest acceleration in 137 observed driving frames.
- All 36 web tests passed. The production browser build and JavaScript syntax
  checks passed. No C/WASM changes were needed.
- The independent 300-frame normal-latency regression passed with 50 ms upstream,
  70 ms downstream, 15 ms jitter and every 31st input dropped. Prediction
  processing p95 was 4.3/5.4 ms and maximum reconciliation was 23.1/23.3 ms on
  this machine. These are CPU timings, not end-to-end input-to-display latency.
- Reports and screenshots are under `.cache/online-v2/guest-input-*`.
