'use client';

import { Alert, Card, Skeleton, buttonVariants } from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clearAccessToken, useAccessToken } from '../../auth-storage';
import { API_URL, SERVER_UNAVAILABLE_MESSAGE } from '../../constants';
import { formatMeetingDate, type Meeting, type MeetingFile } from '../../meetings';
import { SharedChip } from '../../shared-chip';
import { FileList } from './file-list';
import { ParticipantsSection } from './participants-section';
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
    return { type: 'error', message: SERVER_UNAVAILABLE_MESSAGE };
  }
}

type FilesResult =
  { type: 'files'; files: MeetingFile[] } | { type: 'unauthorized' } | { type: 'error' };

/** Only the file list changes after an upload, so a refresh skips the meeting itself. */
async function fetchFiles(token: string, meetingId: string): Promise<FilesResult> {
  try {
    const response = await fetch(`${API_URL}/meetings/${meetingId}/files`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) return { type: 'unauthorized' };
    if (!response.ok) return { type: 'error' };
    return { type: 'files', files: (await response.json()) as MeetingFile[] };
  } catch {
    return { type: 'error' };
  }
}

const backLinkClass = buttonVariants({ variant: 'secondary', className: 'w-full sm:w-auto' });

export function MeetingView({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const token = useAccessToken();

  useEffect(() => {
    if (token === null) router.replace('/login');
  }, [token, router]);

  if (!token) return <main className="flex flex-1" aria-busy="true" />;

  // Next.js keeps a route's state when it is left. The key gives another user (or meeting) a fresh
  // tree, so nothing of the previous one shows: not the data, uploads or participants.
  return <MeetingContent key={`${token}:${meetingId}`} token={token} meetingId={meetingId} />;
}

function MeetingContent({ token, meetingId }: { token: string; meetingId: string }) {
  const [state, setState] = useState<PageState>({ type: 'loading' });

  const applyResult = useCallback((result: LoadResult) => {
    if (result.type === 'unauthorized') {
      clearAccessToken(); // expired or invalid token: back to the login page
      return;
    }
    setState(result);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchMeeting(token, meetingId, controller.signal).then(applyResult, () => {
      // Aborted: the page was left or the token changed.
    });
    return () => controller.abort();
  }, [token, meetingId, applyResult]);

  // Uploads finishing close together refresh concurrently; only the latest request may apply,
  // and an older one resolves when the latest has applied (so its upload row is removed then).
  const filesHeading = useRef<HTMLHeadingElement>(null);
  const refreshId = useRef(0);
  const latestRefresh = useRef<Promise<void>>(Promise.resolve());

  /** Reloads the file list after an upload; keeps the page if the reload fails. */
  const refresh = useCallback((): Promise<void> => {
    const id = ++refreshId.current;
    const run = fetchFiles(token, meetingId).then((result) => {
      if (id !== refreshId.current) return latestRefresh.current;
      if (result.type === 'unauthorized') {
        clearAccessToken();
      } else if (result.type === 'files') {
        setState((current) =>
          current.type === 'ready' ? { ...current, files: result.files } : current,
        );
      }
    });
    latestRefresh.current = run;
    return run;
  }, [token, meetingId]);

  /**
   * Drops a deleted file at once, then reloads the list: the reload supersedes any refresh started
   * before the delete, whose response would otherwise bring the file back.
   */
  const removeFile = useCallback(
    (fileId: string) => {
      setState((current) =>
        current.type === 'ready'
          ? { ...current, files: current.files.filter((file) => file.id !== fileId) }
          : current,
      );
      void refresh();
      // The delete button left with its row; keep keyboard focus in the file section.
      requestAnimationFrame(() => filesHeading.current?.focus());
    },
    [refresh],
  );

  // Participants get a read-only page: no upload, delete or participant management.
  const isOwner = state.type === 'ready' && state.meeting.role === 'owner';

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
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="min-w-0 text-2xl font-semibold wrap-break-word">
                  {state.meeting.title}
                </h1>
                {!isOwner && <SharedChip />}
              </div>
              <Card.Description>
                <time dateTime={state.meeting.startsAt}>
                  {formatMeetingDate(state.meeting.startsAt)}
                </time>
              </Card.Description>
              {!isOwner && (
                <p className="text-muted text-sm">
                  Shared with you: you can view and download files, only the owner can change them.
                </p>
              )}
            </Card.Header>

            <Card.Content className="flex flex-col gap-6 pt-4">
              {isOwner && <UploadArea meetingId={state.meeting.id} onUploaded={refresh} />}

              <section aria-labelledby="files-heading" className="flex flex-col gap-3">
                <h2
                  id="files-heading"
                  ref={filesHeading}
                  tabIndex={-1}
                  className="text-muted text-sm font-medium outline-none"
                >
                  Files{state.files.length > 0 ? ` (${state.files.length})` : ''}
                </h2>
                <FileList files={state.files} onDeleted={isOwner ? removeFile : undefined} />
              </section>

              {isOwner && <ParticipantsSection meetingId={state.meeting.id} />}
            </Card.Content>
          </>
        )}
      </Card>
    </main>
  );
}
