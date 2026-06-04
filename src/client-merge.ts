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
//   - local-only  -> kept (the in-progress human element, whose fresh id is not
//                    yet in the remote scene — this is the flicker fix).
//
// `current` = remote (the arriving truth, whose z-order is preserved), so we
// call mergeById(remote, local). On first load the canvas is empty, so
// mergeById(remote, []) === remote: no behavior change, no flash.

import { mergeById, type El } from "./reconcile";

export function mergeRemoteScene(remoteElements: El[], localElements: El[]): El[] {
  return mergeById(remoteElements, localElements);
}
