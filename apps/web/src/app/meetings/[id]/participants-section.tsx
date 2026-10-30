'use client';

import { Alert, Button, Skeleton } from '@heroui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Participant } from '../../meetings';
import { AddParticipantForm } from './add-participant-form';
import { ParticipantRow } from './participant-row';
import { listParticipants, type ParticipantsResult } from './participants-api';

type ListState =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'ready'; participants: Participant[] };

/** Owner only: who the meeting is shared with, add by e-mail, remove. */
export function ParticipantsSection({ meetingId }: { meetingId: string }) {
  const [state, setState] = useState<ListState>({ type: 'loading' });
  const [announcement, setAnnouncement] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  const applyResult = useCallback((result: ParticipantsResult) => {
    if (result.type === 'participants') {
      setState({ type: 'ready', participants: result.participants });
    } else if (result.type === 'error') {
      setState(result);
    }
    // `unauthorized`: the token is cleared, the page goes to the login page.
  }, []);

  // One list request at a time: a retry replaces the previous one, leaving the page aborts it.
  const loadController = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    listParticipants(meetingId, controller.signal).then(applyResult, () => {
      // Aborted: replaced by a retry, or the page was left.
    });
  }, [meetingId, applyResult]);

  useEffect(() => {
    load();
    return () => loadController.current?.abort();
  }, [load]);

  function handleRetry() {
    setState({ type: 'loading' });
    load();
  }

  const handleAdded = useCallback((added: Participant) => {
    // Updater, not a `state` captured before the request: a removal meanwhile must stay.
    setState((current) =>
      current.type === 'ready' && !current.participants.some((item) => item.userId === added.userId)
        ? { ...current, participants: [...current.participants, added] }
        : current,
    );
    setAnnouncement(`${added.email} can now open this meeting.`);
  }, []);

  const clearAnnouncement = useCallback(() => setAnnouncement(''), []);

  const removeFromList = useCallback((userId: string) => {
    setState((current) =>
      current.type === 'ready'
        ? {
            ...current,
            participants: current.participants.filter((item) => item.userId !== userId),
          }
        : current,
    );
    setAnnouncement('');
    // The remove button left with its row; keep keyboard focus in the section.
    requestAnimationFrame(() => headingRef.current?.focus());
  }, []);

  const count = state.type === 'ready' ? state.participants.length : 0;

  return (
    <section aria-labelledby="participants-heading" className="flex flex-col gap-3">
      <h2
        id="participants-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-muted text-sm font-medium outline-none"
      >
        Participants{count > 0 ? ` (${count})` : ''}
      </h2>

      <AddParticipantForm
        meetingId={meetingId}
        isReady={state.type === 'ready'}
        onAdding={clearAnnouncement}
        onAdded={handleAdded}
      />

      {/* Always in the DOM, so the first message is announced too. */}
      <div role="status" className="empty:-mt-3">
        {announcement && <p className="text-success text-sm">{announcement}</p>}
      </div>

      {state.type === 'loading' && (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading participants">
          <Skeleton className="h-16 rounded-2xl" />
        </div>
      )}

      {state.type === 'error' && (
        <Alert status="danger" className="items-center">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{state.message}</Alert.Description>
          </Alert.Content>
          <Button
            size="sm"
            variant="secondary"
            className="min-h-11 sm:min-h-9"
            onPress={handleRetry}
          >
            Retry
          </Button>
        </Alert>
      )}

      {state.type === 'ready' && state.participants.length === 0 && (
        <p className="border-default rounded-2xl border border-dashed p-6 text-center text-sm">
          Only you can open this meeting. Add registered users by e-mail to share it with them; they
          can view and download files but not change anything.
        </p>
      )}

      {state.type === 'ready' && state.participants.length > 0 && (
        <ul className="flex flex-col gap-2">
          {state.participants.map((participant) => (
            <ParticipantRow
              key={participant.userId}
              meetingId={meetingId}
              participant={participant}
              onRemoved={() => removeFromList(participant.userId)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
