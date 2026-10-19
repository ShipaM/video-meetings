'use client';

import {
  Alert,
  AlertDialog,
  Button,
  FieldError,
  Form,
  Input,
  Label,
  Skeleton,
  TextField,
} from '@heroui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EMAIL_MAX_LENGTH, EMAIL_PATTERN } from '../../constants';
import { formatMeetingDate, type Participant } from '../../meetings';
import {
  addParticipant,
  listParticipants,
  removeParticipant,
  type ParticipantsResult,
} from './participants-api';
import { UnmountListener } from './unmount-listener';
import { useConfirmedRemoval } from './use-confirmed-removal';

type ListState =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'ready'; participants: Participant[] };

/** Checks an already trimmed e-mail. */
function getEmailError(value: string): string | null {
  if (!value) return 'Enter the e-mail of a registered user';
  if (!EMAIL_PATTERN.test(value)) return 'Enter a valid e-mail address, e.g. name@example.com';
  return null;
}

/** An e-mail that, when it must wrap, wraps after the `@` before breaking inside a part. */
function EmailText({ email }: { email: string }) {
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;
  return (
    <>
      {email.slice(0, at + 1)}
      <wbr />
      {email.slice(at + 1)}
    </>
  );
}

function RemoveIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M17 11h6" />
    </svg>
  );
}

/** Remove button with a confirmation dialog; the dialog stays open until the API has answered. */
function RemoveParticipantButton({
  meetingId,
  participant,
  onRemoved,
}: {
  meetingId: string;
  participant: Participant;
  onRemoved: () => void;
}) {
  const removal = useConfirmedRemoval(onRemoved);

  return (
    <>
      <Button
        isIconOnly
        variant="danger-soft"
        className="size-11 shrink-0 sm:size-10"
        aria-label={`Remove ${participant.email}`}
        onPress={removal.open}
      >
        <RemoveIcon />
      </Button>
      <AlertDialog.Backdrop
        isOpen={removal.isOpen}
        onOpenChange={removal.onOpenChange}
        isKeyboardDismissDisabled={false}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-105">
            <UnmountListener onUnmount={removal.onDialogUnmount} />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Remove this participant?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="flex flex-col gap-3">
              <p>
                <strong className="wrap-anywhere">
                  <EmailText email={participant.email} />
                </strong>{' '}
                will lose access to the meeting and its files at once, download links included. You
                can add them again later.
              </p>
              {removal.error !== null && (
                <p role="alert" className="text-danger text-sm">
                  {removal.error}
                </p>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary" isDisabled={removal.isPending}>
                Keep participant
              </Button>
              <Button
                variant="danger"
                isPending={removal.isPending}
                onPress={() =>
                  removal.confirm(() => removeParticipant(meetingId, participant.userId))
                }
              >
                Remove
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}

/** Owner only: who the meeting is shared with, add by e-mail, remove. */
export function ParticipantsSection({ meetingId }: { meetingId: string }) {
  const [state, setState] = useState<ListState>({ type: 'loading' });
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Adding needs the loaded list, so the new participant can simply be appended to it.
    if (state.type !== 'ready') return;
    const value = email.trim();
    const invalid = getEmailError(value);
    if (invalid) {
      setError(invalid);
      inputRef.current?.focus();
      return;
    }

    setIsPending(true);
    setError(null);
    setAnnouncement('');
    const result = await addParticipant(meetingId, value);
    setIsPending(false);
    if (result.type === 'added') {
      const added = result.participant;
      // Updater, not the `state` captured before the await: a removal meanwhile must stay.
      setState((current) =>
        current.type === 'ready' &&
        !current.participants.some((item) => item.userId === added.userId)
          ? { ...current, participants: [...current.participants, added] }
          : current,
      );
      setEmail('');
      setAnnouncement(`${added.email} can now open this meeting.`);
    } else if (result.type === 'error') {
      setError(result.message);
      inputRef.current?.focus();
    }
  }

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

      <Form validationBehavior="aria" onSubmit={handleSubmit}>
        <TextField
          name="email"
          type="email"
          autoComplete="off"
          className="flex w-full flex-col gap-1"
          value={email}
          onChange={(value) => {
            setEmail(value);
            setError(null);
          }}
          isInvalid={error !== null}
          validationBehavior="aria"
        >
          <Label>Add a participant by e-mail</Label>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              placeholder="name@example.com"
              maxLength={EMAIL_MAX_LENGTH}
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              className="min-h-11 min-w-0 flex-1 sm:min-h-10"
            />
            <Button
              type="submit"
              variant="secondary"
              className="min-h-11 shrink-0 sm:min-h-10"
              isPending={isPending}
              isDisabled={state.type !== 'ready'}
            >
              {isPending ? 'Adding…' : 'Add'}
            </Button>
          </div>
          <FieldError className="text-sm">{error}</FieldError>
        </TextField>
      </Form>

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
            <li
              key={participant.userId}
              className="border-default flex items-center gap-3 rounded-2xl border px-4 py-3"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-medium wrap-anywhere">
                  <EmailText email={participant.email} />
                </span>
                <span className="text-muted text-sm">
                  Added{' '}
                  <time dateTime={participant.addedAt}>
                    {formatMeetingDate(participant.addedAt)}
                  </time>
                </span>
              </div>
              <RemoveParticipantButton
                meetingId={meetingId}
                participant={participant}
                onRemoved={() => removeFromList(participant.userId)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
