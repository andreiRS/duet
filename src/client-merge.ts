// Client-side merge for applying a remote scene (#18). Pure, browser-safe
// (imports only ./reconcile -> ./scene-types, no node/fs), so it can live in
// the App.tsx bundle like ./writeback already does.
//
// When a remote (agent) scene arrives, App.tsx replaces the whole canvas via
// updateScene. A human element drawn but not yet debounce-saved (400ms) would
// vanish from view until its pending save round-trips. To stop that flicker, we
// layer the elements CURRENTLY on the canvas over the arriving remote scene by
// the same id + `version` rule the write paths use (ADR-0007, "Client merge").
//
//   - shared id   -> higher `version` wins (the agent bumped its edits; a human
//                    delete is an isDeleted:true tombstone with a higher version
//                    — both carried by mergeById's tiebreak).
//   - remote-only -> kept (the agent's new elements appear).
//   - local-only  -> kept ONLY if it is a genuine in-progress local add (its
//                    fresh id has never appeared in any remote). A local-only id
//                    that WAS in the previous remote but is gone from this one is
//                    a remote deletion -> dropped (B2, see below).
//
// `current` = remote (the arriving truth, whose z-order is preserved), so we
// call mergeById(remote, local). On first load the canvas is empty, so
// mergeById(remote, []) === remote: no behavior change, no flash.
//
// B2 — telling a remote delete from a local add. Keeping every local-only id is
// wrong when the agent HARD-deletes an element: it splices the element out of
// the live array, so reconcileForWrite drops it from disk and the broadcast
// omits it entirely (no tombstone, unlike a browser delete). The element is
// still on the canvas as a local-only id, so a naive merge resurrects it. The
// caller passes `prevRemoteIds` — the ids of the LAST applied remote scene — as
// a baseline (the client analog of the #16 write-path baseline diff). A
// local-only id present in the previous remote but absent from this one is a
// remote deletion (drop it); one never seen in any remote is a genuine local add
// (keep it — this is the #18 in-progress-element fix, which B2 must not regress).

import { mergeById, type El } from "./reconcile";

export function mergeRemoteScene(
  remoteElements: El[],
  localElements: El[],
  prevRemoteIds: ReadonlySet<string> = new Set(),
): El[] {
  const remoteIds = new Set(remoteElements.map((e) => e.id));
  const survivingLocal = localElements.filter(
    (e) => remoteIds.has(e.id as string) || !prevRemoteIds.has(e.id as string),
  );
  return mergeById(remoteElements, survivingLocal);
}
