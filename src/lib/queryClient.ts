import { QueryClient } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'

// gcTime must outlive the persister's maxAge, otherwise restored queries are
// garbage-collected immediately on load.
export const PERSIST_MAX_AGE = 1000 * 60 * 60 * 24 * 7 // 7 days

/**
 * Bump whenever a queryFn's stored shape changes. A cache written by an older
 * build is restored verbatim, so a shape change without a buster hands stale,
 * wrongly-shaped data to the new `select` — which is how the Plan tab came to
 * read a rehydrated `{}` as a Set. Busting drops the persisted cache once;
 * everything refetches from Supabase.
 */
export const PERSIST_BUSTER = 'v3-note-primary'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: PERSIST_MAX_AGE,
      retry: (failureCount) => navigator.onLine && failureCount < 3,
    },
  },
})

export const queryPersister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'cloversky-query-cache',
  throttleTime: 2_000,
})

/**
 * Wipes the persisted cache and everything in memory (DESIGN.md §8: the
 * device holds the household's full financial history in plaintext, so
 * logging out has to clear it). Call before signing out — after signOut()
 * the persister could otherwise flush in-memory data back to localStorage.
 */
export async function clearPersistedCache() {
  await queryPersister.removeClient()
  queryClient.clear()
}
