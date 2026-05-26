import fs from "node:fs";
import path from "node:path";

// One JSON file on disk. Atomic writes via tmp + rename. In dev this lives at ./data/
// (gitignored). In Docker it's mounted as a named volume so it survives container rebuilds.
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const FILE_PATH = path.join(DATA_DIR, "subscriptions.json");

export type Subscription = {
  cytubeChannel: string;
  discordGuildId: string;
  discordChannelId: string;
};

type Store = {
  subscriptions: Subscription[];
};

let cache: Store = { subscriptions: [] };

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

const load = (): Store => {
  ensureDataDir();
  if (!fs.existsSync(FILE_PATH)) return { subscriptions: [] };
  const content = fs.readFileSync(FILE_PATH, "utf-8");
  return JSON.parse(content) as Store;
};

const persist = (store: Store) => {
  ensureDataDir();
  const tmp = `${FILE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(tmp, FILE_PATH);
};

export const init = () => {
  cache = load();
  console.log(`[subscriptions] loaded ${cache.subscriptions.length} subscription(s)`);
};

export const getAll = (): Subscription[] => [...cache.subscriptions];

export const getByGuild = (guildId: string): Subscription[] =>
  cache.subscriptions.filter((s) => s.discordGuildId === guildId);

export const getByCytubeChannel = (cytubeChannel: string): Subscription[] =>
  cache.subscriptions.filter((s) => s.cytubeChannel === cytubeChannel);

export const getByChannel = (discordChannelId: string): Subscription[] =>
  cache.subscriptions.filter((s) => s.discordChannelId === discordChannelId);

export const add = (sub: Subscription): { added: boolean } => {
  const exists = cache.subscriptions.some(
    (s) => s.discordChannelId === sub.discordChannelId && s.cytubeChannel === sub.cytubeChannel,
  );
  if (exists) return { added: false };
  cache.subscriptions.push(sub);
  persist(cache);
  return { added: true };
};

export const removeOne = (
  discordChannelId: string,
  cytubeChannel: string,
): Subscription | undefined => {
  const existing = cache.subscriptions.find(
    (s) => s.discordChannelId === discordChannelId && s.cytubeChannel === cytubeChannel,
  );
  if (!existing) return undefined;
  cache.subscriptions = cache.subscriptions.filter(
    (s) => !(s.discordChannelId === discordChannelId && s.cytubeChannel === cytubeChannel),
  );
  persist(cache);
  return existing;
};

export const removeAllForChannel = (discordChannelId: string): Subscription[] => {
  const removed = cache.subscriptions.filter((s) => s.discordChannelId === discordChannelId);
  if (removed.length === 0) return [];
  cache.subscriptions = cache.subscriptions.filter(
    (s) => s.discordChannelId !== discordChannelId,
  );
  persist(cache);
  return removed;
};

export const uniqueCytubeChannels = (): string[] =>
  Array.from(new Set(cache.subscriptions.map((s) => s.cytubeChannel)));
