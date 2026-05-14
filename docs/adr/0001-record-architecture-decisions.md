# 1. Record architecture decisions

**Status:** Accepted
**Date:** 2026-05-14

## Context

This codebase will evolve quickly post-MVP. Reviewers can read the commit graph to see *what* changed; ADRs are how we explain *why*. A short, append-only record is more useful to future readers (and to interviewers) than a polished but stale wiki.

## Decision

Adopt [Michael Nygard's ADR format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions). One file per decision under `docs/adr/`. Numbered sequentially. Status field at the top: `Proposed`, `Accepted`, `Superseded by NNNN`.

Each ADR follows three sections: **Context**, **Decision**, **Consequences**.

## Consequences

- ADRs are append-only. Superseded decisions get a `Superseded by NNNN` status; they are not deleted.
- New ADRs open with a short Context, name the Decision in one or two sentences, and list Consequences (positive and negative).
- A reviewer reading `docs/adr/` in numbered order gets a chronological narrative of the system's thinking.

## Planned future ADRs

- 0002 — money as scaled BigInt minor units (vs `Decimal` everywhere)
- 0003 — idempotency at the HTTP layer (vs DB-only)
- 0004 — audit inside the same transaction (vs async via queue)
- 0005 — single-entry → double-entry ledger migration
- 0006 — JWT + rotating refresh token (vs session cookies)
- 0007 — Fastify over Express
- 0008 — Why we don't event-source today
- 0009 — SOAP anti-corruption layer for legacy core-banking integration
- 0010 — hash-chained audit log
