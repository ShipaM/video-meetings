'use client';

import { Skeleton } from '@heroui/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { authorizedFetch } from './api';
import { AvatarPlaceholder } from './avatar-placeholder';
import { HEADER_PROFILE_FALLBACK_NAME } from './constants';
import { getDisplayName, type Profile } from './profile';

/**
 * The signed-in user in the home page header, linking to /profile. Loads `GET /users/me` whenever
 * the page is shown: Next.js keeps the page's state when it is left but runs the effects again on
 * return, so a name saved on /profile/edit shows without signing in again.
 */
export function HeaderProfile({ email }: { email: string | null }) {
  // `undefined` until the first load answers.
  const [displayName, setDisplayName] = useState<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        // `null` means the token was cleared, which redirects to /login.
        const response = await authorizedFetch('/users/me', { signal: controller.signal });
        if (!response) return;
        if (response.ok) {
          setDisplayName(getDisplayName((await response.json()) as Profile));
          return;
        }
      } catch {
        if (controller.signal.aborted) return;
      }
      // Not loaded: keep the name shown so far, or fall back to the e-mail from the token.
      setDisplayName((current) => current ?? email ?? HEADER_PROFILE_FALLBACK_NAME);
    }

    void load();
    return () => controller.abort();
  }, [email]);

  return (
    <Link
      href="/profile"
      className="hover:bg-accent/5 focus-visible:ring-accent -mx-2 flex min-h-11 min-w-0 items-center gap-3 self-start rounded-2xl px-2 py-1.5 transition-colors duration-200 focus-visible:ring-2 focus-visible:outline-none"
    >
      <AvatarPlaceholder className="size-10 shrink-0" iconClassName="size-5" />
      <span className="flex min-w-0 flex-col">
        {displayName === undefined ? (
          <span aria-busy="true">
            <span className="sr-only">Loading your profile</span>
            <Skeleton className="my-0.5 h-5 w-32 rounded-lg" />
          </span>
        ) : (
          <span className="truncate font-medium">{displayName}</span>
        )}
        <span className="text-muted text-xs">View profile</span>
      </span>
    </Link>
  );
}
