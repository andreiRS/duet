# ADR-0001: The shared file is the only interface between agent and Duet

**Status:** Accepted
**Date:** 2026-06-03

## Context

Duet needs an AI agent (Claude Code in a terminal) and a human (in a browser) to co-edit one Excalidraw diagram. Something has to carry edits between the agent and the browser.

The genuine alternatives:

- **An HTTP/MCP protocol** Duet exposes (`getScene`, `patchElements`, `runGeometryCheck`). The agent calls Duet instead of touching the file. Centralizes shared logic and lets Duet reject a bad write before it lands.
- **A sidecar state file** Duet maintains for the agent to read ("what changed since your last turn").
- **The shared `.excalidraw` file as the sole interface.** The agent uses its normal file read/write tools; Duet only watches the file and bridges it to the browser.

A protocol means building and versioning an API and wiring the agent's integration to it; the agent is a general-purpose tool we don't want to couple to one server.

## Decision

We will make the shared `.excalidraw` file the only interface. The agent reads and writes it directly with its own file tools. Duet watches the file and bridges it to the browser over a websocket, and writes the browser's edits back. **Duet never talks to the agent**, and the agent never talks to Duet. A change to the file is the only handoff signal, in both directions.

## Consequences

- **Easier:** no protocol to design, version, or integrate; the agent stays a plain file editor; the two sides are fully decoupled and independently testable.
- **Easier:** the agent's authoring helper and geometry check run in the agent's own process, with no dependency on Duet being up.
- **Harder:** Duet cannot reject a bad write before it lands, and cannot tell the agent "you're working" or stream progress. Feedback to the human is limited to what the file-watch can observe (a post-hoc "updated" flash).
- **Accepted cost:** no diff baseline is shared between the sides. The agent must reconstruct what the human changed from its own context plus stable ids (see ADR-0002). A persistent checkpoint is deferred to a later version.
