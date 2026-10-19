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
  useOverlayState,
} from '@heroui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EMAIL_MAX_LENGTH, EMAIL_PATTERN } from '../../constants';
import { formatMeetingDate, type Participant } from '../../meetings';
import { DIALOG_CLOSE_FALLBACK_MS } from './constants';
import {
  addParticipant,
  listParticipants,
  removeParticipant,
  type ParticipantsResult,
} from './participants-api';
import { UnmountListener } from './unmount-listener';

type ListState =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'ready'; participants: Participant[] };

function getEmailError(value: string): string | null {
  if (!value.trim()) return 'Enter the e-mail of a registered user';
  if (!EMAIL_PATTERN.test(value.trim()))
    return 'Enter a valid e-mail address, e.g. name@example.com';
  return null;
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
  const dialog = useOverlayState();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // As with file deletion, the row goes only once the dialog has closed and returned focus.
  const isRemoved = useRef(false);
  const isReported = useRef(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const reportRemoved = useCallback(() => {
    if (isReported.current) return;
    isReported.current = true;
    onRemoved();
  }, [onRemoved]);

  useEffect(() => () => clearTimeout(fallbackTimer.current), []);

  function handleOpenChange(isOpen: boolean) {
    if (isPending) return;
    setError(null);
    dialog.setOpen(isOpen);
  }

  async function handleConfirm() {
    setIsPending(true);
    setError(null);
    const result = await removeParticipant(meetingId, participant.userId);
    setIsPending(false);
    if (result.type === 'removed') {
      isRemoved.current = true;
      dialog.close();
      fallbackTimer.current = setTimeout(reportRemoved, DIALOG_CLOSE_FALLBACK_MS);
    } else if (result.type === 'error') {
      setError(result.message);
    }
    // `unauthorized`: the token is cleared, the page goes to the login page.
  }

  return (
    <>
      <Button
        isIconOnly
        variant="danger-soft"
        className="size-11 shrink-0 sm:size-10"
        aria-label={`Remove ${participant.email}`}
        onPress={dialog.open}
      >
        <RemoveIcon />
      </Button>
      <AlertDialog.Backdrop
        isOpen={dialog.isOpen}
        onOpenChange={handleOpenChange}
        isKeyboardDismissDisabled={false}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-105">
            <UnmountListener onUnmount={() => isRemoved.current && reportRemoved()} />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Remove this participant?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="flex flex-col gap-3">
              <p>
                <strong className="break-all">{participant.email}</strong> will lose access to the
                meeting and its files at once, download links included. You can add them again
                later.
              </p>
              {error !== null && (
                <p role="alert" className="text-danger text-sm">
                  {error}
                </p>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary" isDisabled={isPending}>
                Keep participant
              </Button>
              <Button variant="danger" isPending={isPending} onPress={handleConfirm}>
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

  useEffect(() => {
    const controller = new AbortController();
    listParticipants(meetingId, controller.signal).then(applyResult, () => {
      // Aborted: the page was left.
    });
    return () => controller.abort();
  }, [meetingId, applyResult]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      if (state.type === 'ready') {
        setState({ ...state, participants: [...state.participants, result.participant] });
      } else {
        // The list never loaded: load it now, so the new participant shows up.
        setState({ type: 'loading' });
        void listParticipants(meetingId).then(applyResult);
      }
      setEmail('');
      setAnnouncement(`${result.participant.email} can now open this meeting.`);
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
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{state.message}</Alert.Description>
          </Alert.Content>
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
                <span className="font-medium break-all">{participant.email}</span>
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
