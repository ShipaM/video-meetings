'use client';

import { Alert, Button, Card, Skeleton, buttonVariants } from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clearAccessToken, useAccessToken } from '../auth-storage';
import { AvatarPlaceholder } from '../avatar-placeholder';
import { API_URL, SERVER_UNAVAILABLE_MESSAGE } from '../constants';
import { getDisplayName, type Profile } from '../profile';
import { CHANGE_PASSWORD_SECTION_ID, PROFILE_LOAD_FAILED_MESSAGE } from './constants';

type ProfileState =
  { type: 'loading' } | { type: 'error'; message: string } | { type: 'ready'; profile: Profile };

export default function ProfilePage() {
  const router = useRouter();
  const token = useAccessToken();

  useEffect(() => {
    if (token === null) router.replace('/login');
  }, [token, router]);

  // Nothing to show until the token is known; also covers the redirect to /login.
  if (!token) return <main className="flex flex-1" aria-busy="true" />;

  // Next.js keeps a route's state when it is left. The key gives another user a fresh tree, so the
  // previous user's profile never shows, not even until the new one has loaded.
  return <ProfileContent key={token} token={token} />;
}

function ProfileContent({ token }: { token: string }) {
  const [state, setState] = useState<ProfileState>({ type: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load(accessToken: string) {
      try {
        const response = await fetch(`${API_URL}/users/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });
        if (response.status === 401) {
          clearAccessToken(); // expired or invalid token: back to the login page
          return;
        }
        if (!response.ok) {
          setState({ type: 'error', message: PROFILE_LOAD_FAILED_MESSAGE });
          return;
        }
        setState({ type: 'ready', profile: (await response.json()) as Profile });
      } catch {
        if (controller.signal.aborted) return;
        setState({ type: 'error', message: SERVER_UNAVAILABLE_MESSAGE });
      }
    }

    void load(token);
    return () => controller.abort();
  }, [token, attempt]);

  function handleRetry() {
    setState({ type: 'loading' });
    setAttempt((current) => current + 1);
  }

  return (
    <main className="flex flex-1 items-center justify-center p-4 sm:p-6">
      <Card className="glass-card w-full max-w-md rounded-3xl p-6 sm:p-8">
        <Card.Header>
          <Card.Title className="text-2xl font-semibold">Profile</Card.Title>
        </Card.Header>

        <Card.Content className="flex flex-col gap-6">
          {state.type === 'loading' && (
            <div className="flex items-center gap-4" aria-busy="true">
              <Skeleton className="size-16 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-6 w-2/3 rounded-lg" />
                <Skeleton className="h-4 w-1/2 rounded-lg" />
              </div>
            </div>
          )}

          {state.type === 'error' && (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{state.message}</Alert.Description>
              </Alert.Content>
              <Button size="sm" variant="danger" onPress={handleRetry}>
                Try again
              </Button>
            </Alert>
          )}

          {state.type === 'ready' && (
            <div className="flex items-center gap-4">
              <AvatarPlaceholder size="lg" className="size-16 shrink-0" iconClassName="size-8" />
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="text-lg font-semibold wrap-break-word">
                  {getDisplayName(state.profile)}
                </h2>
                <dl>
                  <dt className="sr-only">E-mail</dt>
                  <dd className="text-muted text-sm wrap-break-word">{state.profile.email}</dd>
                </dl>
              </div>
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <Link
              href="/"
              className={buttonVariants({
                variant: 'secondary',
                size: 'lg',
                className: 'w-full sm:w-auto sm:flex-1',
              })}
            >
              Back
            </Link>
            <Link
              href="/profile/edit"
              className={buttonVariants({
                variant: 'primary',
                size: 'lg',
                className: 'w-full sm:w-auto sm:flex-1',
              })}
            >
              Edit
            </Link>
          </div>

          <Link
            href={`/profile/edit#${CHANGE_PASSWORD_SECTION_ID}`}
            className={buttonVariants({ variant: 'ghost', size: 'lg', className: 'w-full' })}
          >
            Change password
          </Link>
        </Card.Content>
      </Card>
    </main>
  );
}
