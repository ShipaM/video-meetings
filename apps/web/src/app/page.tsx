'use client';

import { Alert, Button, Card, Skeleton, buttonVariants } from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clearAccessToken, getEmailFromToken, useAccessToken } from './auth-storage';
import { API_URL, RECENT_MEETINGS_COUNT, SERVER_UNAVAILABLE_MESSAGE } from './constants';
import { formatMeetingDate, type Meeting } from './meetings';

type MeetingsState =
  { type: 'loading' } | { type: 'error'; message: string } | { type: 'ready'; meetings: Meeting[] };

export default function HomePage() {
  const router = useRouter();
  const token = useAccessToken();
  const [state, setState] = useState<MeetingsState>({ type: 'loading' });

  useEffect(() => {
    if (token === null) router.replace('/login');
  }, [token, router]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();

    async function load(accessToken: string) {
      try {
        const response = await fetch(`${API_URL}/meetings`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });
        if (response.status === 401) {
          clearAccessToken(); // expired or invalid token: back to the login page
          return;
        }
        if (!response.ok) {
          setState({ type: 'error', message: 'Could not load your meetings.' });
          return;
        }
        setState({ type: 'ready', meetings: (await response.json()) as Meeting[] });
      } catch {
        if (controller.signal.aborted) return;
        setState({ type: 'error', message: SERVER_UNAVAILABLE_MESSAGE });
      }
    }

    void load(token);
    return () => controller.abort();
  }, [token]);

  // Nothing to show until the token is known; also covers the redirect to /login.
  if (!token) return <main className="flex flex-1" aria-busy="true" />;

  const email = getEmailFromToken(token);
  const meetings = state.type === 'ready' ? state.meetings : [];
  const recent = [...meetings]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, RECENT_MEETINGS_COUNT);

  function handleLogout() {
    clearAccessToken();
  }

  return (
    <main className="flex flex-1 items-center justify-center p-4 sm:p-6">
      <Card className="glass-card w-full max-w-2xl rounded-3xl p-6 sm:p-8">
        <Card.Header className="gap-1">
          <Card.Title className="text-xl font-semibold wrap-break-word sm:text-2xl">
            Hello{email ? `, ${email}` : ''}
          </Card.Title>
          <Card.Description>
            {state.type === 'ready'
              ? `You have ${meetings.length} ${meetings.length === 1 ? 'meeting' : 'meetings'}`
              : 'Your video meetings'}
          </Card.Description>
        </Card.Header>

        <Card.Content className="flex flex-col gap-5">
          <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
            <h2 id="recent-heading" className="text-muted text-sm font-medium">
              Recent meetings
            </h2>

            {state.type === 'loading' && (
              <div className="flex flex-col gap-2" aria-busy="true">
                {Array.from({ length: RECENT_MEETINGS_COUNT }, (_, index) => (
                  <Skeleton key={index} className="h-16 rounded-2xl" />
                ))}
              </div>
            )}

            {state.type === 'error' && (
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>{state.message}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}

            {state.type === 'ready' && recent.length === 0 && (
              <p className="border-default rounded-2xl border border-dashed p-6 text-center text-sm">
                You have no meetings yet. Create your first one to get started.
              </p>
            )}

            {recent.length > 0 && (
              <ul className="flex flex-col gap-2">
                {recent.map((meeting) => (
                  <li key={meeting.id}>
                    <Link
                      href={`/meetings/${meeting.id}`}
                      className="border-default hover:border-accent hover:bg-accent/5 focus-visible:ring-accent flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors duration-200 focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="font-medium wrap-break-word">{meeting.title}</span>
                        <time dateTime={meeting.startsAt} className="text-muted text-sm">
                          {formatMeetingDate(meeting.startsAt)}
                        </time>
                      </span>
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="text-muted size-5 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/meetings/new"
              className={buttonVariants({
                variant: 'primary',
                size: 'lg',
                className: 'w-full sm:w-auto sm:flex-1',
              })}
            >
              Create meeting
            </Link>
            <Button
              size="lg"
              variant="secondary"
              className="w-full sm:w-auto"
              onPress={handleLogout}
            >
              Log out
            </Button>
          </div>
        </Card.Content>
      </Card>
    </main>
  );
}
