import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { fetchOnnxCommunityIndexPage } from "@/lib/model-catalog/hugging-face";
import type { CommunityModelSummary } from "@/lib/model-catalog/types";

const DATABASE_NAME = "sophon-community-catalog";
const DATABASE_VERSION = 1;
const MODEL_STORE = "models";
const STATE_STORE = "state";
const SYNC_KEY = "catalog";
const INDEX_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_INDEX_PAGES_PER_REFRESH = 40;

type CatalogSyncState = {
  key: typeof SYNC_KEY;
  cursor: string | null;
  complete: boolean;
  refreshedAt: number;
};

interface CommunityCatalogDatabase extends DBSchema {
  models: { key: string; value: CommunityModelSummary };
  state: { key: string; value: CatalogSyncState };
}

let databasePromise: Promise<IDBPDatabase<CommunityCatalogDatabase>> | null = null;
let refreshPromise: Promise<void> | null = null;
let cachedModelsPromise: Promise<CommunityModelSummary[]> | null = null;
const listeners = new Set<() => void>();

export function subscribeCommunityCatalogIndex(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function refreshCommunityCatalogIndex() {
  refreshPromise ??= runRefresh().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export type CommunityCatalogSort = "popular" | "lightweight" | "alphabetical";

export async function searchCommunityCatalogIndexPage(query: string, { limit = 8, offset = 0, sort = "popular" }: { limit?: number; offset?: number; sort?: CommunityCatalogSort } = {}) {
  const database = await getDatabase();
  const entries = await (cachedModelsPromise ??= database.getAll(MODEL_STORE));
  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  const ranked = entries
    .filter(isDiscoverableTextModel)
    .filter((model) => terms.length > 0 || hasTextGenerationEvidence(model))
    .flatMap((model) => {
      const rank = rankModel(model, terms);
      return rank === null ? [] : [{ model, rank }];
    })
    .sort((left, right) => {
      if (sort === "alphabetical") {
        return left.model.name.localeCompare(right.model.name)
          || left.model.repo.localeCompare(right.model.repo);
      }
      if (sort === "lightweight") {
        return compareOptionalNumbers(estimateParameterCount(left.model), estimateParameterCount(right.model))
          || right.model.downloads - left.model.downloads
          || left.model.name.localeCompare(right.model.name)
          || left.model.repo.localeCompare(right.model.repo);
      }
      return right.rank - left.rank
        || right.model.downloads - left.model.downloads
        || left.model.name.localeCompare(right.model.name)
        || left.model.repo.localeCompare(right.model.repo);
    });
  const pageSize = Math.max(1, Math.min(50, Math.trunc(limit)));
  const pageOffset = Math.max(0, Math.trunc(offset));
  return {
    models: ranked.slice(pageOffset, pageOffset + pageSize).map(({ model }) => model),
    total: ranked.length
  };
}

function compareOptionalNumbers(left: number | null, right: number | null) {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return left - right;
}

export function estimateParameterCount(model: CommunityModelSummary) {
  if (typeof model.parameterCount === "number" && model.parameterCount > 0) return model.parameterCount;
  const matches = [model.name, model.repo, ...model.tags].flatMap((value) => {
    const match = value.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*([bm])(?:$|[^a-z0-9])/i);
    if (!match) return [];
    const amount = Number(match[1]);
    return Number.isFinite(amount) && amount > 0 ? [amount * (match[2]?.toLowerCase() === "b" ? 1_000_000_000 : 1_000_000)] : [];
  });
  return matches.length > 0 ? Math.min(...matches) : null;
}

async function runRefresh() {
  const database = await getDatabase();
  let state = await database.get(STATE_STORE, SYNC_KEY);
  const now = Date.now();
  if (state?.complete && now - state.refreshedAt < INDEX_TTL_MS) return;
  if (state?.complete) {
    const reset = database.transaction([MODEL_STORE, STATE_STORE], "readwrite");
    await reset.objectStore(MODEL_STORE).clear();
    await reset.objectStore(STATE_STORE).delete(SYNC_KEY);
    await reset.done;
    cachedModelsPromise = null;
    state = undefined;
  }

  let cursor = state?.cursor ?? null;
  for (let pageNumber = 0; pageNumber < MAX_INDEX_PAGES_PER_REFRESH; pageNumber += 1) {
    const page = await fetchOnnxCommunityIndexPage({ cursor: cursor ?? undefined, limit: 50 });
    const transaction = database.transaction([MODEL_STORE, STATE_STORE], "readwrite");
    for (const model of page.models) await transaction.objectStore(MODEL_STORE).put(model);
    cursor = page.nextCursor;
    await transaction.objectStore(STATE_STORE).put({
      key: SYNC_KEY,
      cursor,
      complete: cursor === null,
      refreshedAt: now
    });
    await transaction.done;
    cachedModelsPromise = null;
    for (const listener of listeners) listener();
    if (cursor === null) return;
  }
}

function hasTextGenerationEvidence(model: CommunityModelSummary) {
  return model.pipelineTask === "text-generation"
    || model.tags.some((tag) => normalizeSearch(tag) === "text generation");
}

function isDiscoverableTextModel(model: CommunityModelSummary) {
  const taskCompatible = model.pipelineTask === null || model.pipelineTask === "text-generation";
  const libraryCompatible = model.libraryName === null
    || model.libraryName === "transformers.js"
    || model.tags.includes("transformers.js");
  return taskCompatible && libraryCompatible && model.revision !== null;
}

function rankModel(model: CommunityModelSummary, terms: readonly string[]) {
  if (terms.length === 0) return Math.log10(model.downloads + 1);
  const name = normalizeSearch(model.name);
  const repo = normalizeSearch(model.repo);
  const tags = model.tags.map(normalizeSearch);
  const corpus = `${repo} ${tags.join(" ")}`;
  if (!terms.every((term) => corpus.includes(term))) return null;
  let rank = 0;
  for (const term of terms) {
    if (name === term) rank += 100;
    else if (name.startsWith(term)) rank += 50;
    else if (name.includes(term)) rank += 30;
    else if (tags.some((tag) => tag.startsWith("base model ") && tag.includes(term))) rank += 20;
    else if (tags.some((tag) => tag.includes(term))) rank += 10;
    else rank += 1;
  }
  return rank + Math.log10(model.downloads + 1);
}

function normalizeSearch(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function getDatabase() {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable in this browser.");
  databasePromise ??= openDB<CommunityCatalogDatabase>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(MODEL_STORE)) database.createObjectStore(MODEL_STORE, { keyPath: "repo" });
      if (!database.objectStoreNames.contains(STATE_STORE)) database.createObjectStore(STATE_STORE, { keyPath: "key" });
    }
  });
  return databasePromise;
}
