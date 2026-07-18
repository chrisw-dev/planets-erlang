# Orbital Mechanics Sandbox — Erlang Edition

An N-body gravity simulator where **each celestial body is its own operating
system-scheduled process**, holding its own state (mass, diameter, position,
velocity, last acceleration) and updating itself purely by exchanging
messages with the others. No shared memory, no locks, no global position
array anyone mutates directly.

This document covers the architecture, why Erlang/OTP is a genuinely good
fit for this specific problem (and where it isn't), and how the same design
would look in TypeScript, Python, Go, and C.

---

## 1. The approach

### File layout

| File | Role |
|---|---|
| `planet.hrl` | Shared `#planet{}` record: name, mass, diameter, color, x, y, vx, vy, ax, ay |
| `physics.erl` | Pure function: sum gravitational acceleration from a list of other bodies. No process/state concerns. |
| `planet.erl` | One process per body. A message-handling loop that mutates only its own local state. |
| `sim_clock.erl` | The coordinator. Drives ticks, enforces synchronization barriers, prints snapshots. |
| `solar_system.erl` | Bootstrap: real planet data, spawns processes, kicks off the run. |

### Why a naive "just update everyone" approach doesn't work

Velocity Verlet integration needs, for each body:

1. Its **old** acceleration, to move it to a new position.
2. **Everyone's new** position, to compute its **new** acceleration.
3. Both accelerations, to finish the velocity update.

If each planet process just free-runs at its own pace, body A might finish
its full step and start reading positions for the *next* tick while body B
is still using stale data from *this* tick to compute its own step. That's
a race condition dressed up as a physics bug.

### The three-phase barrier protocol

`sim_clock` drives every tick through three phases, each gated by a barrier
(the coordinator waits for all N replies before moving to the next phase):

```
Phase 1  advance_pos   Each planet moves itself using ONLY its own stored
                        velocity + old acceleration. No cross-talk needed —
                        genuinely parallel across all N processes.
                              │
                        (barrier: wait for N × posdone)
                              ▼
Phase 2  snapshot       Coordinator asks every planet for its NEW position,
                        assembles one consistent list.
                              │
                        (barrier: wait for N × snapshot)
                              ▼
Phase 3  finish_step    Each planet receives "everyone else's new position",
                        computes its new acceleration, finishes its velocity
                        update. Parallel again.
                              │
                        (barrier: wait for N × stepdone)
```

This is the standard trick for distributed N-body / distributed physics
generally: split the update into phases where each phase is either "purely
local" (parallelizable, no barrier needed *within* the phase) or "needs a
globally consistent view" (needs a barrier *before* it can start). Erlang's
mailbox + selective receive makes expressing this almost embarrassingly
direct — `collect/3` in `sim_clock.erl` *is* the barrier, in about eight
lines.

### Running it

```bash
erlc *.erl
erl -noshell -s solar_system start -s init stop
```

---

## 2. Why Erlang suits this problem specifically

This isn't "Erlang is generally good, therefore fine here" — a few of its
specific design choices line up unusually well with N-body simulation:

- **Processes are the natural unit of the domain.** A planet already *is*
  an isolated thing with private state that only changes in response to
  events (gravity, in this case). Erlang processes share nothing and can
  only be touched via message — which means the physical isolation of a
  planet in space and the isolation of an Erlang process in the BEAM are
  the same isolation. There's no shared array of positions to accidentally
  mutate from the wrong place.

- **Processes are cheap enough to map one-to-one with domain objects.**
  A BEAM process starts around a few hundred bytes and grows on demand.
  You can spawn hundreds of thousands of them. That means "one process per
  planet" scales to "one process per asteroid" for a full belt simulation
  without redesigning anything — you're not rationing a scarce resource
  the way you would be with OS threads.

- **Preemptive scheduling means no planet can hog the CPU.** The BEAM
  scheduler forcibly reschedules processes based on reduction counts, not
  cooperative yielding. A planet computing gravity from 5,000 nearby
  asteroids can't accidentally starve the others the way a tight loop in a
  cooperatively-scheduled runtime could.

- **The barrier logic reads as what it is.** `collect(N, MatchFun, Acc)`
  with pattern-matched message shapes is close to how you'd describe the
  protocol in English. There's no mutex, no condition variable, no
  `Future.all()` wrapper — just "wait for N messages that look like this."

- **Distribution is nearly free.** Because bodies already only talk via
  message, splitting Jupiter and its moons onto a second physical machine
  is a config change (registering the node), not a rewrite. You'd feel
  real network latency show up in your barrier waits, which is itself a
  useful thing to observe.

- **Supervision trees fit "a planet crashed."** With OTP proper (a
  `supervisor` over `gen_server` planets), a process that dies on bad input
  gets restarted with known-good state, rather than silently corrupting the
  simulation or crashing the whole program.

### Where Erlang is the wrong tool

Be honest about the trade: the BEAM is not built for tight numeric
inner loops. Floating-point-heavy code (this `physics:acceleration/2`
function, run for every pair, every tick) runs meaningfully slower on the
BEAM than as compiled native code. For a few hundred bodies at conversational
speed, that's invisible. For thousands of bodies with a Barnes-Hut tree and
real-time frame rates, the concurrency model stops being the bottleneck and
raw floating-point throughput starts to matter — and that's a different
language's job.

---

## 3. How this looks in other languages

The core question for each language: **what plays the role of "an isolated
process with private state, talked to only via message," and what plays the
role of "a barrier"?**

### TypeScript (Node.js)

Node is single-threaded with an event loop — there is no true parallelism
unless you reach for Worker Threads. A "planet" would most naturally be a
plain object or closure, not a process, because nothing forces isolation:
any function can reach in and mutate any other planet's fields directly.
To get *actual* actor-style isolation you'd spin up a `Worker` per planet
and pass messages via `postMessage` — but each worker is a full V8 isolate
(megabytes, not bytes), so "one process per asteroid" stops being realistic
well before it does in Erlang. The barrier becomes a `Promise.all()` over
worker responses, which reads fine for 9 planets and gets unwieldy fast.
Where TypeScript wins outright: this is genuinely the best language for the
*visualization* side (the canvas artifact from earlier) — nobody's shipping
an Erlang GUI to a browser.

### Python

Same fundamental issue as Node, worse in a different way: the GIL means
threads don't get real CPU parallelism, so an actor-per-planet model built
on `threading` would serialize anyway. `multiprocessing` gives you real
processes and real parallelism, but each one is an OS process — tens of
megabytes, expensive to spawn, and messages have to be pickled across a
pipe. That's fine for 9 planets, but "one process per body" collapses long
before you get to a meaningful asteroid belt. `asyncio` gives you
cooperative concurrency and clean message-passing syntax (queues, similar
readability to the Erlang version) but it's still fundamentally one core.
Python's actual strength here is the opposite approach entirely: don't
model each planet as an actor at all — vectorize the whole system as NumPy
arrays and update everyone in one array operation. Fewer, faster, less
"true to the domain," much more true to how you'd actually simulate physics
in Python.

### Go

The closest analog. Goroutines are cheap (starting ~2KB stack, grows on
demand) and channels give you real message passing with the compiler
enforcing types on what crosses the boundary — this is the language where
"one goroutine per planet, channels for gravity" is not a stretch, it's
idiomatic Go. The barrier becomes a `sync.WaitGroup` or a fan-in channel
pattern, both first-class idioms. What you lose versus Erlang: no
supervision trees or built-in "let it crash and restart with known state"
philosophy (you'd hand-roll recovery), no hot code reloading, and
distribution across machines needs an actual RPC layer (gRPC, NATS) rather
than a config flag. What you gain: it's compiled and close to C in raw
numeric throughput, so the same design scales to far larger N before the
concurrency model runs out of runway. Given this is already your day-to-day
language, Go is arguably the more *practical* choice if you want to keep
extending this past a weekend project — Erlang is the more *illuminating*
one for seeing the actor model in its purest form.

### C

No concurrency primitives at all — you'd build this from `pthread_create`
per planet plus `pthread_barrier_t` for the phase boundaries, or from
scratch with condition variables and mutexes. "Message passing" would mean
either genuinely copying data into a queue you've built yourself, or (more
realistically, and more common in real N-body codes) just sharing a struct
array under a lock, which throws away the isolation property that makes
this design interesting in the other four languages. OS threads are heavy
enough that "one thread per body" tops out at maybe a few thousand before
context-switch overhead dominates — nowhere near Erlang's or Go's
lightweight-process ceiling. What C buys you instead: no runtime overhead
at all, direct control over memory layout (which matters a lot for cache
behavior once you're doing millions of pairwise force calculations), and a
straight line to SIMD/OpenMP/GPU offload if raw throughput becomes the
actual goal. C is the right tool once the project stops being about "how do
independent bodies coordinate" and becomes "how fast can I brute-force
gravity for a hundred thousand particles."

### Summary

| | Isolation unit | Weight per unit | Message passing | Barrier idiom | Fault tolerance | Distribution | Numeric throughput |
|---|---|---|---|---|---|---|---|
| **Erlang** | process | ~KB, cheap | native, async mailbox | `receive` loop | supervision trees | near-free (nodes) | weak |
| **TypeScript** | Worker thread | MBs, expensive | `postMessage` (copies) | `Promise.all` | manual | none built-in | moderate |
| **Python** | OS process | tens of MBs | pickled IPC | manual join/queue | manual | none built-in | weak (unless vectorized) | 
| **Go** | goroutine | ~KB, cheap | typed channels | `WaitGroup`/fan-in | manual | needs RPC layer | strong |
| **C** | OS thread | ~MB, moderate | shared memory + locks (or hand-rolled queue) | `pthread_barrier_t` | manual | needs a library | strongest |

The honest takeaway: Erlang and Go are the two languages where "an actor per
planet" is actually the natural idiom rather than something bolted on.
Erlang wins on expressiveness and fault-tolerance philosophy; Go wins on
raw performance while keeping almost the same concurrency shape. Python and
TypeScript are better served by *not* trying to force an actor-per-body
model at all. C is what you reach for once the interesting problem has
shifted from "coordination" to "how many floating-point operations per
second can this machine do."

---

## 4. Live browser visualization

The simulator remains the Erlang process network. The browser viewer is a
separate TypeScript application in `viewer/`: it starts the Erlang stream,
relays newline-delimited JSON frames through WebSocket, and draws the bodies
on a Canvas. This keeps web server, JSON transport, and drawing concerns out
of the physics processes.

### Run it

Prerequisites:

- Erlang (`erlc` and `erl`) available on `PATH`.
- Node.js 20.19.0. The viewer includes `viewer/.nvmrc`; Vite 8 does not
  support Node 21.

Install the viewer dependencies once, using the pinned Node version:

```bash
cd viewer
source ~/.nvm/nvm.sh
nvm use
npm install
```

From the repository root, start the WebSocket bridge and browser server:

```bash
make start
```

`make start` runs both services in the background, records their process IDs
under `viewer/.run/`, and writes their output to `viewer/.run/bridge.log` and
`viewer/.run/viewer.log`. The bridge listens on port 8787 and compiles and
starts the Erlang simulation when the browser sends **Start simulation**.

Stop both services started by Make with:

```bash
make stop
```

Open the local URL printed by Vite, normally `http://localhost:5173/`, then
select **Start simulation**. If port 5173 is already in use, Vite selects the
next available port; use the URL it prints. If port 8787 is already in use,
an existing bridge is running; use it or stop it with `fuser -k 8787/tcp`
before starting a new one.

The canvas supports pan by dragging, zoom by scrolling, optional orbital
trails, display pause/resume, and reset. The bridge endpoint is
`ws://localhost:8787/stream`.

### Frame protocol

`solar_system:start_stream/0` runs the same initial conditions as `start/0`.
After every fifth completed physics tick, `sim_clock` obtains full records
through the existing barrier protocol and writes one NDJSON frame to stdout:

```json
{
  "type": "frame",
  "tick": 5,
  "simulatedDays": 1.25,
  "bodies": [
    {"name":"Earth","mass":0.000003003,"diameter":12742,"color":"#5ec8d8","x":1.0,"y":0.02,"vx":-0.0003,"vy":0.0172}
  ]
}
```

The final stdout message is `{"type":"complete"}`. Frames are generated
only after every body has completed `finish_step`, so each contains one
consistent simulation state rather than a mix of ticks.
