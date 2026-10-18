'use client';

import { Alert, Card, Skeleton, buttonVariants } from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { clearAccessToken, useAccessToken } from '../../auth-storage';
import { API_URL } from '../../constants';
import { formatMeetingDate, type Meeting, type MeetingFile } from '../../meetings';
import { FileList } from './file-list';
import { UploadArea } from './upload-area';

type PageState =
  | { type: 'loading' }
  | { type: 'not-found' }
  | { type: 'error'; message: string }
  | { type: 'ready'; meeting: Meeting; files: MeetingFile[] };

type LoadResult = Exclude<PageState, { type: 'loading' }> | { type: 'unauthorized' };

async function fetchMeeting(
  token: string,
  meetingId: string,
  signal?: AbortSignal,
): Promise<LoadResult> {
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const [meetingResponse, filesResponse] = await Promise.all([
      fetch(`${API_URL}/meetings/${meetingId}`, { headers, signal }),
      fetch(`${API_URL}/meetings/${meetingId}/files`, { headers, signal }),
    ]);
    if (meetingResponse.status === 401 || filesResponse.status === 401) {
      return { type: 'unauthorized' };
    }
    // 400 is a malformed (non-UUID) id: for the user it is the same as a missing meeting.
    if ([400, 404].includes(meetingResponse.status)) return { type: 'not-found' };
    if (!meetingResponse.ok || !filesResponse.ok) {
      return { type: 'error', message: 'Could not load the meeting.' };
    }
    return {
      type: 'ready',
      meeting: (await meetingResponse.json()) as Meeting,
      files: (await filesResponse.json()) as MeetingFile[],
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { type: 'error', message: 'The server is unavailable. Please try again later.' };
  }
}

const backLinkClass = buttonVariants({ variant: 'secondary', className: 'w-full sm:w-auto' });

export function MeetingView({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const token = useAccessToken();
  const [state, setState] = useState<PageState>({ type: 'loading' });

  useEffect(() => {
    if (token === null) router.replace('/login');
  }, [token, router]);

  const applyResult = useCallback((result: LoadResult) => {
    if (result.type === 'unauthorized') {
      clearAccessToken(); // expired or invalid token: back to the login page
      return;
    }
    setState(result);
  }, []);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    fetchMeeting(token, meetingId, controller.signal).then(applyResult, () => {
      // Aborted: the page was left or the token changed.
    });
    return () => controller.abort();
  }, [token, meetingId, applyResult]);

  /** Reloads the meeting and its files after an upload; keeps the page if the reload fails. */
  const refresh = useCallback(async () => {
    if (!token) return;
    const result = await fetchMeeting(token, meetingId);
    if (result.type === 'error') return;
    applyResult(result);
  }, [token, meetingId, applyResult]);

  if (!token) return <main className="flex flex-1" aria-busy="true" />;

  return (
    <main className="flex flex-1 items-start justify-center p-4 pt-16 sm:p-6 sm:pt-20">
      <Card className="glass-card w-full max-w-3xl rounded-3xl p-5 sm:p-8">
        {state.type === 'loading' && (
          <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the meeting">
            <Skeleton className="h-8 w-2/3 rounded-xl" />
            <Skeleton className="h-5 w-1/3 rounded-lg" />
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </div>
        )}

        {state.type === 'not-found' && (
          <>
            <Card.Header className="gap-1">
              <Card.Title className="text-2xl font-semibold">Meeting not found</Card.Title>
              <Card.Description>
                It does not exist, or you do not have access to it.
              </Card.Description>
            </Card.Header>
            <Card.Content className="pt-4">
              <Link href="/" className={backLinkClass}>
                Back to meetings
              </Link>
            </Card.Content>
          </>
        )}

        {state.type === 'error' && (
          <Card.Content className="flex flex-col gap-4">
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{state.message}</Alert.Description>
              </Alert.Content>
            </Alert>
            <Link href="/" className={backLinkClass}>
              Back to meetings
            </Link>
          </Card.Content>
        )}

        {state.type === 'ready' && (
          <>
            <Card.Header className="gap-2">
              <Link
                href="/"
                className="text-muted hover:text-foreground w-fit text-sm transition-colors"
              >
                ← All meetings
              </Link>
              <h1 className="text-2xl font-semibold wrap-break-word">{state.meeting.title}</h1>
              <Card.Description>
                <time dateTime={state.meeting.startsAt}>
                  {formatMeetingDate(state.meeting.startsAt)}
                </time>
              </Card.Description>
            </Card.Header>

            <Card.Content className="flex flex-col gap-6 pt-4">
              <UploadArea meetingId={state.meeting.id} onUploaded={refresh} />

              <section aria-labelledby="files-heading" className="flex flex-col gap-3">
                <h2 id="files-heading" className="text-muted text-sm font-medium">
                  Files{state.files.length > 0 ? ` (${state.files.length})` : ''}
                </h2>
                <FileList files={state.files} />
              </section>
            </Card.Content>
          </>
        )}
      </Card>
    </main>
  );
}
