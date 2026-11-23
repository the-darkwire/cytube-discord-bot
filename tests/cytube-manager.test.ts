import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The manager pulls in ../src/discord/sendMessage, which transitively imports ../src/discord —
// and that logs the Discord client in at import time. Both it and cytube-client are mocked so
// importing the manager never touches the network. Mocks are hoisted, so they're in place
// before the dynamic import below.

const connect = vi.fn();

vi.mock("cytube-client", () => ({
  default: { connect: (...args: unknown[]) => connect(...args) },
}));

vi.mock("../src/discord/sendMessage", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

const uniqueCytubeChannels = vi.fn<() => string[]>(() => []);

vi.mock("../src/persistence/subscriptions", () => ({
  uniqueCytubeChannels: () => uniqueCytubeChannels(),
  getByCytubeChannel: () => [],
}));

let manager: typeof import("../src/cytube/manager");

// A stand-in for cytube-client's CytubeConnection: the `.socket` it exposes plus the `.on` /
// `.close` surface the manager uses. `connected` is settable so a test can simulate a drop.
const makeInstance = (opts: { connected?: boolean } = {}) => {
  const handlers = new Map<string, (arg?: unknown) => void>();
  const socket = {
    connected: opts.connected ?? true,
    on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
      handlers.set(event, cb);
    }),
  };
  return {
    socket,
    handlers,
    on: vi.fn(),
    close: vi.fn(),
  };
};

beforeEach(async () => {
  vi.useFakeTimers();
  connect.mockReset();
  uniqueCytubeChannels.mockReset();
  uniqueCytubeChannels.mockReturnValue([]);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.resetModules();
  manager = await import("../src/cytube/manager");
});

afterEach(() => {
  manager.shutdown();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("cytube manager", () => {
  describe("backoff", () => {
    it("grows with the attempt number and caps at the maximum", () => {
      const { backoffMs, REBUILD_MAX_MS } = manager.__internal;
      // Jitter is 50–100% of the exponential, so compare against that band rather than a value.
      expect(backoffMs(0)).toBeGreaterThanOrEqual(5_000);
      expect(backoffMs(0)).toBeLessThanOrEqual(10_000);
      expect(backoffMs(3)).toBeGreaterThanOrEqual(40_000);
      expect(backoffMs(3)).toBeLessThanOrEqual(80_000);
      for (const attempt of [10, 50, 1000]) {
        expect(backoffMs(attempt)).toBeLessThanOrEqual(REBUILD_MAX_MS);
      }
    });
  });

  describe("reconcile", () => {
    it("opens one client per unique subscribed room", async () => {
      uniqueCytubeChannels.mockReturnValue(["room-a", "room-b"]);
      connect.mockImplementation(() => Promise.resolve(makeInstance()));

      await manager.reconcile();

      expect(connect).toHaveBeenCalledTimes(2);
      expect(connect).toHaveBeenCalledWith("room-a");
      expect(connect).toHaveBeenCalledWith("room-b");
      expect([...manager.__internal.entries.keys()]).toEqual(["room-a", "room-b"]);
    });

    it("does not reopen a room that already has a live client", async () => {
      uniqueCytubeChannels.mockReturnValue(["room-a"]);
      connect.mockImplementation(() => Promise.resolve(makeInstance()));

      await manager.reconcile();
      await manager.reconcile();

      expect(connect).toHaveBeenCalledTimes(1);
    });

    it("schedules a retry when the initial connect fails", async () => {
      uniqueCytubeChannels.mockReturnValue(["room-a"]);
      connect.mockRejectedValueOnce(new Error("cytube unreachable"));

      await manager.reconcile();

      // Nothing live, but a rebuild is queued — the old code left the room dark forever.
      expect(manager.__internal.entries.has("room-a")).toBe(false);
      expect(manager.__internal.pendingRebuilds.has("room-a")).toBe(true);

      connect.mockResolvedValueOnce(makeInstance());
      await vi.advanceTimersByTimeAsync(manager.__internal.REBUILD_MAX_MS);

      expect(connect).toHaveBeenCalledTimes(2);
      expect(manager.__internal.entries.has("room-a")).toBe(true);
    });
  });

  describe("watchdog", () => {
    it("leaves a connected socket alone", async () => {
      uniqueCytubeChannels.mockReturnValue(["room-a"]);
      connect.mockImplementation(() => Promise.resolve(makeInstance({ connected: true })));
      await manager.reconcile();

      manager.__internal.auditOnce();

      expect(manager.__internal.entries.has("room-a")).toBe(true);
      expect(manager.__internal.pendingRebuilds.has("room-a")).toBe(false);
    });

    it("waits for socket.io's own retry before the staleness threshold", async () => {
      uniqueCytubeChannels.mockReturnValue(["room-a"]);
      const instance = makeInstance({ connected: true });
      connect.mockResolvedValueOnce(instance);
      await manager.reconcile();

      instance.socket.connected = false;
      vi.setSystemTime(Date.now() + manager.__internal.STALE_AFTER_MS / 2);
      manager.__internal.auditOnce();

      expect(manager.__internal.entries.has("room-a")).toBe(true);
      expect(manager.__internal.pendingRebuilds.has("room-a")).toBe(false);
    });

    it("rebuilds a socket that has been down past the threshold", async () => {
      uniqueCytubeChannels.mockReturnValue(["room-a"]);
      const dead = makeInstance({ connected: true });
      connect.mockResolvedValueOnce(dead);
      await manager.reconcile();

      dead.socket.connected = false;
      vi.setSystemTime(Date.now() + manager.__internal.STALE_AFTER_MS + 1_000);
      manager.__internal.auditOnce();

      // Retired: closed, dropped from the map, replacement queued.
      expect(dead.close).toHaveBeenCalled();
      expect(manager.__internal.entries.has("room-a")).toBe(false);
      expect(manager.__internal.pendingRebuilds.has("room-a")).toBe(true);

      const fresh = makeInstance();
      connect.mockResolvedValueOnce(fresh);
      await vi.advanceTimersByTimeAsync(manager.__internal.REBUILD_MAX_MS);

      // This is the DW-499 regression: a dead client must not block its own replacement.
      expect(connect).toHaveBeenCalledTimes(2);
      expect(manager.__internal.entries.get("room-a")?.instance).toBe(fresh);
    });

    it("abandons the rebuild if the room was unsubscribed while backing off", async () => {
      uniqueCytubeChannels.mockReturnValue(["room-a"]);
      const dead = makeInstance({ connected: true });
      connect.mockResolvedValueOnce(dead);
      await manager.reconcile();

      dead.socket.connected = false;
      vi.setSystemTime(Date.now() + manager.__internal.STALE_AFTER_MS + 1_000);
      manager.__internal.auditOnce();

      uniqueCytubeChannels.mockReturnValue([]);
      await vi.advanceTimersByTimeAsync(manager.__internal.REBUILD_MAX_MS);

      expect(connect).toHaveBeenCalledTimes(1);
      expect(manager.__internal.entries.has("room-a")).toBe(false);
    });
  });

  describe("socket lifecycle handlers", () => {
    it("rebuilds immediately on a server-initiated disconnect", async () => {
      uniqueCytubeChannels.mockReturnValue(["room-a"]);
      const instance = makeInstance();
      connect.mockResolvedValueOnce(instance);
      await manager.reconcile();

      // socket.io does not retry this case on its own.
      instance.handlers.get("disconnect")?.("io server disconnect");

      expect(manager.__internal.entries.has("room-a")).toBe(false);
      expect(manager.__internal.pendingRebuilds.has("room-a")).toBe(true);
    });

    it("leaves a transport-level disconnect to socket.io", async () => {
      uniqueCytubeChannels.mockReturnValue(["room-a"]);
      const instance = makeInstance();
      connect.mockResolvedValueOnce(instance);
      await manager.reconcile();

      instance.handlers.get("disconnect")?.("transport close");

      expect(manager.__internal.entries.has("room-a")).toBe(true);
      expect(manager.__internal.pendingRebuilds.has("room-a")).toBe(false);
    });

    it("rebuilds when socket.io gives up retrying", async () => {
      uniqueCytubeChannels.mockReturnValue(["room-a"]);
      const instance = makeInstance();
      connect.mockResolvedValueOnce(instance);
      await manager.reconcile();

      instance.handlers.get("reconnect_failed")?.();

      expect(manager.__internal.entries.has("room-a")).toBe(false);
      expect(manager.__internal.pendingRebuilds.has("room-a")).toBe(true);
    });

    it("resets the backoff once a connection is actually established", async () => {
      uniqueCytubeChannels.mockReturnValue(["room-a"]);
      const instance = makeInstance();
      connect.mockResolvedValueOnce(instance);
      await manager.reconcile();

      const entry = manager.__internal.entries.get("room-a");
      if (!entry) throw new Error("expected an entry for room-a");
      entry.attempt = 5;

      instance.handlers.get("connect")?.();

      expect(entry.attempt).toBe(0);
    });
  });

  describe("shutdown", () => {
    it("closes live clients and cancels queued rebuilds", async () => {
      uniqueCytubeChannels.mockReturnValue(["room-a", "room-b"]);
      const a = makeInstance();
      const b = makeInstance();
      connect.mockResolvedValueOnce(a).mockResolvedValueOnce(b);
      await manager.reconcile();

      // Put room-a into the rebuild queue, leaving room-b live.
      a.handlers.get("reconnect_failed")?.();
      expect(manager.__internal.pendingRebuilds.has("room-a")).toBe(true);

      manager.shutdown();

      expect(b.close).toHaveBeenCalled();
      expect(manager.__internal.entries.size).toBe(0);
      expect(manager.__internal.pendingRebuilds.size).toBe(0);

      connect.mockClear();
      await vi.advanceTimersByTimeAsync(manager.__internal.REBUILD_MAX_MS * 2);
      expect(connect).not.toHaveBeenCalled();
    });
  });
});
