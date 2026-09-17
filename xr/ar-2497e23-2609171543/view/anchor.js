// Keeps the installation where it was put down in the real room.
//
// The Quest moves the origin of local-floor when the headset is taken off and
// put on someone else (or recentred), and a placement kept in those coordinates
// moves with it. A WebXR anchor is fixed to the room instead: every frame the
// placement is read back from the anchor's pose. The anchor is also made
// persistent where the browser allows it (Quest Browser), and its handle is
// kept in localStorage, so the next session opens with the installation where
// it stood, and locked.
//
// Anything that moves the installation calls placementChanged(); half a second
// after the last change, and never while it is carried, a new anchor replaces
// the old one. Without anchor support nothing here does anything.
import { qp } from '../config.js';
import { place } from './placement.js';

const KEY = 'rozsda.placement';
const SETTLE_MS = 500;                     // a stick held down is one change, not one per frame
const RESTORE_WAIT_MS = 5000;              // how long a saved anchor may take to be found

let anchor = null, anchorUuid = null;      // the anchor holding the current placement
let creating = false, dirtyAt = 0;
let restoring = false, restoreStarted = 0;
let status = 'no anchor';

function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }

export function placementChanged() { dirtyAt = performance.now(); }
export const anchorStatus = () => status;
// a saved placement is still being looked for: do not drop the installation yet
export const anchorWaiting = () => restoring && performance.now() - restoreStarted < RESTORE_WAIT_MS;

export function startAnchors(session) {
  anchor = null; anchorUuid = null; creating = false; dirtyAt = 0; restoring = false;
  status = 'no anchor';
  const saved = load();
  if (saved && saved.height && !qp.has('scale')) place.height = saved.height;
  if (!saved || !saved.uuid || !session.restorePersistentAnchor) return;
  restoring = true; restoreStarted = performance.now();
  place.locked = true;
  status = 'finding saved place';
  anchorUuid = saved.uuid;
  session.restorePersistentAnchor(saved.uuid)
    .then(a => { if (restoring) anchor = a; else a.delete(); })   // moved meanwhile: the new place wins
    .catch(() => { restoring = false; anchorUuid = null; place.locked = false; status = 'saved place lost'; });
  // leftovers from earlier placements count against the per-site limit
  for (const uuid of session.persistentAnchors || [])
    if (uuid !== saved.uuid && session.deletePersistentAnchor) session.deletePersistentAnchor(uuid).catch(() => {});
}

// Once per frame, before the placement is used. Returns true when the
// placement came from the anchor this frame.
export function syncAnchor(frame, session, space) {
  if (place.carrying) return false;
  if (dirtyAt && !creating && performance.now() - dirtyAt > SETTLE_MS) {
    dirtyAt = 0;
    if (frame.createAnchor) replaceAnchor(frame, session, space);
    else status = 'anchors unsupported';
  }
  if (!anchor || creating || dirtyAt) return false;
  const p = frame.getPose(anchor.anchorSpace, space);
  if (!p) return false;
  const { position: t, orientation: q } = p.transform;
  place.x = t.x; place.z = t.z;
  // yaw of the anchor's x axis, the convention of worldFromPainting
  place.face = Math.atan2(-2 * (q.x * q.z - q.w * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
  place.turn = 0;
  if (restoring) { restoring = false; status = 'anchored (saved)'; }
  return true;
}

function replaceAnchor(frame, session, space) {
  const yaw = place.face + place.turn;
  const pose = new XRRigidTransform({ x: place.x, y: 0, z: place.z },
                                    { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
  const old = anchor, oldUuid = anchorUuid;
  anchor = null; anchorUuid = null; restoring = false;
  creating = true;
  status = 'anchoring';
  frame.createAnchor(pose, space).then(async a => {
    if (old) try { old.delete(); } catch (e) {}
    if (oldUuid && session.deletePersistentAnchor) session.deletePersistentAnchor(oldUuid).catch(() => {});
    anchor = a;
    let uuid = null;
    if (a.requestPersistentHandle) uuid = await a.requestPersistentHandle().catch(() => null);
    anchorUuid = uuid;
    save({ uuid, height: place.height });
    status = uuid ? 'anchored, saved' : 'anchored, not saved';
  }).catch(e => {
    status = 'anchor failed: ' + (e && e.message || e);
    save({ uuid: null, height: place.height });
  }).finally(() => { creating = false; });
}
