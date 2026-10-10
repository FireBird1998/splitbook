---
status: accepted
date: 2026-10-11
---

# Confirmed Group deletion uses a shared Mongo transaction fence

A confirmed final-member leave permanently removes the Group and its five dependent collections. Every Group-owned writer and deletion batch writes the same Group document inside a Mongo transaction, so independent servers and delayed writes conflict with the deletion claim. A process mutex or expiring lease cannot prevent a paused writer from creating history after its parent was removed. Financial commits still precede separate recoverable Activity publication. Activity projection and acknowledgement each use their own Group-fenced transaction under the same publication deadline, so an acknowledgement outage preserves the visible event and pending intent.

Destructive claims require a replica set or Atlas transaction support. On standalone Mongo, ordinary reads, writes, leave and archive retain compatibility, but final-member deletion fails before membership removal. Existing historical empty Groups require an exact reviewed maintenance manifest; background recovery processes only previously requested jobs. All deployments and maintenance writers sharing the database must use this fence before destructive cleanup is enabled. An old unfenced writer cannot be protected by transactions in the new deployment alone.

See [operation and rollout](../operations/group-cleanup.md) for bounded traffic-triggered recovery, receipt retention, maintenance approval and test topology.
