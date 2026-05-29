import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Subscription } from "../src/persistence/subscriptions";

// The persistence module reads DATA_DIR at import time, so we set env + reset module cache
// + dynamic-import for every test to get a fresh isolated store on a clean temp directory.

let subscriptions: typeof import("../src/persistence/subscriptions");
let tempDir: string;

const FIXTURE_A: Subscription = {
  cytubeChannel: "room-a",
  discordGuildId: "guild-1",
  discordChannelId: "channel-1",
};
const FIXTURE_B: Subscription = {
  cytubeChannel: "room-b",
  discordGuildId: "guild-1",
  discordChannelId: "channel-1",
};
const FIXTURE_C: Subscription = {
  cytubeChannel: "room-a",
  discordGuildId: "guild-2",
  discordChannelId: "channel-2",
};

beforeEach(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "cytube-subs-test-"));
  process.env.DATA_DIR = tempDir;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.resetModules();
  subscriptions = await import("../src/persistence/subscriptions");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  vi.restoreAllMocks();
});

describe("subscriptions persistence", () => {
  describe("init", () => {
    it("starts empty when no file exists", () => {
      subscriptions.init();
      expect(subscriptions.getAll()).toEqual([]);
    });

    it("loads existing data from disk", () => {
      // Seed the file with one subscription
      subscriptions.init();
      subscriptions.add(FIXTURE_A);

      // Reload fresh module to confirm it reads from disk
      vi.resetModules();
      return import("../src/persistence/subscriptions").then((fresh) => {
        fresh.init();
        expect(fresh.getAll()).toEqual([FIXTURE_A]);
      });
    });
  });

  describe("add", () => {
    beforeEach(() => subscriptions.init());

    it("returns { added: true } for a new subscription", () => {
      expect(subscriptions.add(FIXTURE_A)).toEqual({ added: true });
      expect(subscriptions.getAll()).toEqual([FIXTURE_A]);
    });

    it("dedupes on (discordChannelId, cytubeChannel) pairs", () => {
      subscriptions.add(FIXTURE_A);
      expect(subscriptions.add(FIXTURE_A)).toEqual({ added: false });
      expect(subscriptions.getAll()).toEqual([FIXTURE_A]);
    });

    it("allows the same Discord channel to subscribe to multiple CyTube rooms", () => {
      subscriptions.add(FIXTURE_A);
      subscriptions.add(FIXTURE_B);
      expect(subscriptions.getAll()).toHaveLength(2);
    });

    it("allows the same CyTube room to fan out to multiple Discord channels", () => {
      subscriptions.add(FIXTURE_A);
      subscriptions.add(FIXTURE_C);
      expect(subscriptions.getAll()).toHaveLength(2);
    });

    it("persists writes atomically (the data file exists after add, no .tmp left behind)", () => {
      subscriptions.add(FIXTURE_A);
      const files = readdirSync(tempDir);
      expect(files).toContain("subscriptions.json");
      expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
      const persisted = JSON.parse(readFileSync(path.join(tempDir, "subscriptions.json"), "utf-8"));
      expect(persisted.subscriptions).toEqual([FIXTURE_A]);
    });
  });

  describe("removeOne", () => {
    beforeEach(() => {
      subscriptions.init();
      subscriptions.add(FIXTURE_A);
      subscriptions.add(FIXTURE_B);
    });

    it("removes the matching subscription and returns it", () => {
      const removed = subscriptions.removeOne(FIXTURE_A.discordChannelId, FIXTURE_A.cytubeChannel);
      expect(removed).toEqual(FIXTURE_A);
      expect(subscriptions.getAll()).toEqual([FIXTURE_B]);
    });

    it("returns undefined and changes nothing when no match", () => {
      expect(subscriptions.removeOne("nonexistent", "room-x")).toBeUndefined();
      expect(subscriptions.getAll()).toHaveLength(2);
    });
  });

  describe("removeAllForChannel", () => {
    beforeEach(() => {
      subscriptions.init();
      subscriptions.add(FIXTURE_A);
      subscriptions.add(FIXTURE_B);
      subscriptions.add(FIXTURE_C);
    });

    it("removes every subscription for the given channel and returns them", () => {
      const removed = subscriptions.removeAllForChannel("channel-1");
      expect(removed).toEqual([FIXTURE_A, FIXTURE_B]);
      expect(subscriptions.getAll()).toEqual([FIXTURE_C]);
    });

    it("returns an empty array when the channel has no subscriptions", () => {
      expect(subscriptions.removeAllForChannel("channel-none")).toEqual([]);
      expect(subscriptions.getAll()).toHaveLength(3);
    });
  });

  describe("filtering helpers", () => {
    beforeEach(() => {
      subscriptions.init();
      subscriptions.add(FIXTURE_A);
      subscriptions.add(FIXTURE_B);
      subscriptions.add(FIXTURE_C);
    });

    it("getByGuild filters by Discord guild id", () => {
      expect(subscriptions.getByGuild("guild-1")).toEqual([FIXTURE_A, FIXTURE_B]);
      expect(subscriptions.getByGuild("guild-2")).toEqual([FIXTURE_C]);
      expect(subscriptions.getByGuild("guild-none")).toEqual([]);
    });

    it("getByCytubeChannel filters by CyTube room", () => {
      expect(subscriptions.getByCytubeChannel("room-a")).toEqual([FIXTURE_A, FIXTURE_C]);
      expect(subscriptions.getByCytubeChannel("room-b")).toEqual([FIXTURE_B]);
    });

    it("getByChannel filters by Discord channel id", () => {
      expect(subscriptions.getByChannel("channel-1")).toEqual([FIXTURE_A, FIXTURE_B]);
      expect(subscriptions.getByChannel("channel-2")).toEqual([FIXTURE_C]);
    });

    it("uniqueCytubeChannels deduplicates the room list", () => {
      expect(subscriptions.uniqueCytubeChannels().sort()).toEqual(["room-a", "room-b"]);
    });
  });

  describe("getAll", () => {
    it("returns a snapshot that callers cannot use to mutate the internal store", () => {
      subscriptions.init();
      subscriptions.add(FIXTURE_A);
      const snapshot = subscriptions.getAll();
      snapshot.push(FIXTURE_B);
      expect(subscriptions.getAll()).toEqual([FIXTURE_A]);
    });
  });

  describe("data dir creation", () => {
    it("creates the data directory on first write if it doesn't exist", () => {
      const nested = path.join(tempDir, "nested", "deeper");
      process.env.DATA_DIR = nested;
      vi.resetModules();
      return import("../src/persistence/subscriptions").then((fresh) => {
        fresh.init();
        fresh.add(FIXTURE_A);
        expect(existsSync(path.join(nested, "subscriptions.json"))).toBe(true);
      });
    });
  });
});
