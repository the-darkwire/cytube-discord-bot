import CytubeClient from "cytube-client";
import { sendMessage } from "../discord/sendMessage";
import * as subscriptions from "../persistence/subscriptions";

// biome-ignore lint/suspicious/noExplicitAny: cytube-client ships no types (see CLAUDE.md).
type CytubeInstance = any;

type Entry = {
  instance: CytubeInstance;
  // Set once we give up on this instance, so the watchdog and the socket handlers can't both
  // kick off a rebuild for the same channel.
  retiring: boolean;
  // Wall-clock of the last moment we observed the socket connected. The watchdog measures
  // staleness from here; `connect`/`disconnect` handlers keep it current.
  lastConnectedAt: number;
  attempt: number;
};

const entries = new Map<string, Entry>();

// Rebuild timers, keyed by channel. Tracked (rather than fired and forgotten) so that shutdown
// can cancel them and so a pending rebuild can't race reconcile into a second client for the
// same room.
const pendingRebuilds = new Map<string, NodeJS.Timeout>();

const cancelPendingRebuild = (cytubeChannel: string) => {
  const timer = pendingRebuilds.get(cytubeChannel);
  if (timer) {
    clearTimeout(timer);
    pendingRebuilds.delete(cytubeChannel);
  }
};

const handleChangeMedia =
  (cytubeChannel: string) =>
  // biome-ignore lint/suspicious/noExplicitAny: cytube-client event payload is untyped.
  async (data: any) => {
    const title = String(data.title ?? "Unknown");
    const duration = String(data.duration ?? "");
    const message = `Now playing on **[${cytubeChannel}](<https://cytu.be/r/${cytubeChannel}>)**: **${title}** [${duration}]`;
    const subs = subscriptions.getByCytubeChannel(cytubeChannel);
    for (const sub of subs) {
      try {
        await sendMessage(message, sub.discordChannelId);
      } catch (err) {
        console.error(`[cytube] failed to post for ${sub.discordChannelId}:`, err);
      }
    }
  };

// cytube-client fires `changeMedia` once on connect with the room's current media (so the
// client can render initial state). Treating that as a real change means we repost the current
// video into Discord on every bot restart. Suppress any changeMedia event within this window
// of opening the connection — real videos are minutes apart, so we lose nothing.
const INITIAL_STATE_SUPPRESS_WINDOW_MS = 5_000;

// How often the watchdog audits every entry.
const WATCHDOG_INTERVAL_MS = 60_000;

// How long a socket may sit disconnected before we stop trusting socket.io's own retry and
// rebuild the client from scratch. Generous enough that an ordinary blip reconnects on its own
// without us tearing anything down.
const STALE_AFTER_MS = 5 * 60_000;

// Rebuild backoff. Capped well under STALE_AFTER_MS so a failing rebuild keeps retrying at a
// steady ~2 min rather than drifting toward hours.
const REBUILD_BASE_MS = 10_000;
const REBUILD_MAX_MS = 120_000;

const backoffMs = (attempt: number) => {
  const exp = Math.min(REBUILD_BASE_MS * 2 ** attempt, REBUILD_MAX_MS);
  // Jitter so several rooms that drop together don't retry in lockstep.
  return Math.round(exp * (0.5 + Math.random() * 0.5));
};

// Tear an instance down and drop it from the map. `close()` is best-effort: a wedged socket may
// throw, and we want the entry gone either way so startClient can build a fresh one.
const retire = (cytubeChannel: string, entry: Entry, reason: string) => {
  if (entry.retiring) return;
  entry.retiring = true;
  console.warn(`[cytube] retiring ${cytubeChannel} client: ${reason}`);
  try {
    if (typeof entry.instance?.close === "function") entry.instance.close();
    else if (typeof entry.instance?.disconnect === "function") entry.instance.disconnect();
  } catch (err) {
    console.error(`[cytube] error closing ${cytubeChannel} during retire:`, err);
  }
  entries.delete(cytubeChannel);
};

// Rebuild after a delay, but only if the channel is still subscribed — someone may have
// unsubscribed while we were backing off.
const scheduleRebuild = (cytubeChannel: string, attempt: number) => {
  cancelPendingRebuild(cytubeChannel);
  const delay = backoffMs(attempt);
  console.log(`[cytube] rebuilding ${cytubeChannel} in ${Math.round(delay / 1000)}s`);
  const timer = setTimeout(() => {
    pendingRebuilds.delete(cytubeChannel);
    if (!subscriptions.uniqueCytubeChannels().includes(cytubeChannel)) {
      console.log(`[cytube] ${cytubeChannel} no longer subscribed; abandoning rebuild`);
      return;
    }
    void startClient(cytubeChannel, attempt + 1);
  }, delay);
  // Don't hold the process open on this timer alone.
  timer.unref?.();
  pendingRebuilds.set(cytubeChannel, timer);
};

// Replace a channel's client with a brand-new one. This goes through startClient, which calls
// CytubeClient.connect and therefore re-fetches the room's socket server from
// /socketconfig/<room>.json. That re-fetch is the reason we rebuild rather than leaning on
// socket.io's retry: socket.io retries the *same* server URL forever, so if CyTube moves the
// room to a different node, its internal reconnection can never succeed.
const rebuild = (cytubeChannel: string, entry: Entry, reason: string) => {
  const attempt = entry.attempt;
  retire(cytubeChannel, entry, reason);
  scheduleRebuild(cytubeChannel, attempt);
};

const startClient = async (cytubeChannel: string, attempt = 0) => {
  if (entries.has(cytubeChannel)) return;
  // A rebuild may already be queued for this room (e.g. reconcile ran while we were backing
  // off). We're building it now, so that timer must not fire a second client later.
  cancelPendingRebuild(cytubeChannel);
  console.log(
    `[cytube] connecting to ${cytubeChannel}${attempt ? ` (attempt ${attempt + 1})` : ""}`,
  );

  let instance: CytubeInstance;
  try {
    instance = await CytubeClient.connect(cytubeChannel);
  } catch (err) {
    console.error(`[cytube] failed to connect to ${cytubeChannel}:`, err);
    // A failed connect used to be terminal — the room stayed dark until the next deploy.
    scheduleRebuild(cytubeChannel, attempt);
    return;
  }

  const connectedAt = Date.now();
  const entry: Entry = {
    instance,
    retiring: false,
    lastConnectedAt: connectedAt,
    attempt,
  };
  entries.set(cytubeChannel, entry);

  const handler = handleChangeMedia(cytubeChannel);
  // biome-ignore lint/suspicious/noExplicitAny: cytube-client event payload is untyped.
  instance.on("changeMedia", async (data: any) => {
    if (Date.now() - connectedAt < INITIAL_STATE_SUPPRESS_WINDOW_MS) {
      console.log(`[cytube] ${cytubeChannel} suppressing initial-state changeMedia event`);
      return;
    }
    entry.lastConnectedAt = Date.now();
    await handler(data);
  });

  // Socket lifecycle. cytube-client exposes the raw socket.io socket as `.socket`; its own
  // `.on()` proxies there but drops extra callback args, and we want the disconnect reason and
  // error objects, so we bind directly. Every one of these logs: the six-month outage in DW-499
  // was invisible precisely because nothing here was observed.
  const socket = instance.socket;
  if (socket && typeof socket.on === "function") {
    socket.on("connect", () => {
      entry.lastConnectedAt = Date.now();
      // Reaching a usable connection is what resets the backoff, not merely attempting one.
      entry.attempt = 0;
      console.log(`[cytube] ${cytubeChannel} socket connected`);
    });
    socket.on("disconnect", (reason: string) => {
      console.warn(`[cytube] ${cytubeChannel} socket disconnected: ${reason}`);
      // "io server disconnect" means the server dismissed us and socket.io will NOT retry on
      // its own, so rebuild immediately instead of waiting for the watchdog.
      if (reason === "io server disconnect") {
        rebuild(cytubeChannel, entry, `server disconnect (${reason})`);
      }
    });
    socket.on("connect_error", (err: Error) => {
      console.warn(`[cytube] ${cytubeChannel} connect_error: ${err?.message ?? err}`);
    });
    socket.on("error", (err: unknown) => {
      console.error(`[cytube] ${cytubeChannel} socket error:`, err);
    });
    // socket.io gives up entirely here. Nothing but a rebuild recovers the room.
    socket.on("reconnect_failed", () => {
      rebuild(cytubeChannel, entry, "socket.io exhausted its reconnection attempts");
    });
  } else {
    console.warn(`[cytube] ${cytubeChannel}: no raw socket exposed; relying on the watchdog alone`);
  }
};

// Audits every live entry. This is the backstop that makes the whole thing self-healing: it
// doesn't trust socket.io's internal state machine, it just asks "has this socket been
// disconnected too long?" and rebuilds if so. Any failure mode that leaves a client wedged —
// including ones we haven't seen yet — is caught here.
const auditOnce = () => {
  const now = Date.now();
  for (const [cytubeChannel, entry] of [...entries.entries()]) {
    if (entry.retiring) continue;
    const connected = entry.instance?.socket?.connected;
    if (connected) {
      entry.lastConnectedAt = now;
      continue;
    }
    const staleFor = now - entry.lastConnectedAt;
    if (staleFor >= STALE_AFTER_MS) {
      rebuild(cytubeChannel, entry, `socket not connected for ${Math.round(staleFor / 1000)}s`);
    } else {
      console.warn(
        `[cytube] ${cytubeChannel} socket down for ${Math.round(staleFor / 1000)}s; waiting for socket.io retry`,
      );
    }
  }
};

let watchdog: NodeJS.Timeout | undefined;

const startWatchdog = () => {
  if (watchdog) return;
  watchdog = setInterval(auditOnce, WATCHDOG_INTERVAL_MS);
  watchdog.unref?.();
};

// Bring the set of running CyTube clients into line with the current set of subscriptions.
// Starts clients for new channels; leaves existing clients running (idle CyTube clients are
// cheap). Entries are removed on retire, so a dead client no longer blocks its own replacement —
// that stale-entry bug is what made DW-499 permanent.
export const reconcile = async () => {
  const desired = new Set(subscriptions.uniqueCytubeChannels());
  for (const ch of desired) {
    if (!entries.has(ch)) await startClient(ch);
  }
  startWatchdog();
};

// Close every active CyTube WebSocket so the server can free its connection slots immediately
// instead of waiting for timeout. cytube-client wraps socket.io; either close() or disconnect()
// is available depending on the version, so we probe both.
export const shutdown = () => {
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = undefined;
  }
  for (const timer of pendingRebuilds.values()) clearTimeout(timer);
  pendingRebuilds.clear();
  for (const [ch, entry] of entries.entries()) {
    try {
      if (typeof entry.instance?.close === "function") entry.instance.close();
      else if (typeof entry.instance?.disconnect === "function") entry.instance.disconnect();
    } catch (err) {
      console.error(`[cytube] error closing ${ch}:`, err);
    }
  }
  entries.clear();
};

// Exported for tests.
export const __internal = {
  entries,
  pendingRebuilds,
  auditOnce,
  backoffMs,
  STALE_AFTER_MS,
  REBUILD_MAX_MS,
};
