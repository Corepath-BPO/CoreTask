# 0005. Redis and BullMQ for background work

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

Several things must not happen inside a request:

- Sending e-mail (welcome, invitations, digests, due-date reminders).
- Notification fan-out to many users.
- Recurring work: reminders, SLA checks, purging expired refresh tokens.
- Imports, exports and report generation.
- Automations — "when a task moves to Done, do X".

Doing any of it synchronously ties response time to a third party's availability.
A slow SMTP server should not slow down registration.

## Decision

**Redis** for queues and caching, **BullMQ** as the queue library, consumed by a
**separate worker process** built from the same image with a different entry
point.

## Alternatives considered

**PostgreSQL as the queue** (`SELECT … FOR UPDATE SKIP LOCKED`, or pg-boss). One
fewer service to run, and transactionally consistent with the data — genuinely
attractive. Rejected because Redis is wanted anyway for caching, rate limiting
and the Socket.IO adapter once the API runs more than one replica. Given that,
adding queue polling load to the primary database buys nothing.

**RabbitMQ / SQS.** Stronger delivery guarantees and better suited to
service-to-service messaging. Heavier to operate, and the guarantees are aimed at
a problem we do not have: this is one application's background work, not a
distributed system's message bus.

**In-process (`setTimeout`, an async queue).** Jobs die with the process, cannot
be retried after a deploy, and cannot be scaled independently. Fine for a demo.

## Consequences

**Easier**

- Retries with exponential backoff, delayed and repeatable jobs, priorities and
  concurrency control come from the library.
- The worker scales independently of the API: a long import cannot slow request
  handling, and the API can be replaced without draining the queue.
- Redis also covers caching, rate-limit storage and the Socket.IO adapter needed
  for multi-replica realtime.
- Producers (API) and consumers (worker) are separated by construction —
  processors are registered only in `WorkerModule`.

**Harder / accepted**

- One more stateful service to run, monitor and back up.
- Redis is configured with `maxmemory-policy noeviction`: evicting a queued job
  under memory pressure would silently lose work.
- Job payloads are eventually consistent with the database. Producers enqueue
  ids, not snapshots, so a processor always reads current state.
- Enqueue failures are swallowed and logged. A Redis outage should degrade the
  welcome e-mail, not the registration that triggered it — but that means a lost
  job is a log line, so the log needs to be watched.
