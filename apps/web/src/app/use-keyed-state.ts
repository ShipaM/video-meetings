import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * State that belongs to `key` (e.g. the access token): read under another key it is `initial`.
 * Next.js keeps a route's state when the user leaves it, so without this a page would show the
 * previous user's data after signing in as someone else, until its own data loads. A setter keeps
 * the key it was created with, so a late response for an old key never shows under a new one.
 */
export function useKeyedState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [stored, setStored] = useState({ key, value: initial });
  const value = stored.key === key ? stored.value : initial;

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (update) =>
      setStored((current) => {
        const base = current.key === key ? current.value : initial;
        const next = typeof update === 'function' ? (update as (value: T) => T)(base) : update;
        return { key, value: next };
      }),
    [key, initial],
  );

  return [value, setValue];
}
