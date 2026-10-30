'use client';

import { AlertDialog, Button } from '@heroui/react';
import { formatMeetingDate, type Participant } from '../../meetings';
import { removeParticipant } from './participants-api';
import { UnmountListener } from './unmount-listener';
import { useConfirmedRemoval } from './use-confirmed-removal';

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

/** A participant of the meeting with the date they were added and the remove button. */
export function ParticipantRow({
  meetingId,
  participant,
  onRemoved,
}: {
  meetingId: string;
  participant: Participant;
  onRemoved: () => void;
}) {
  return (
    <li className="border-default flex items-center gap-3 rounded-2xl border px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium wrap-anywhere">
          <EmailText email={participant.email} />
        </span>
        <span className="text-muted text-sm">
          Added <time dateTime={participant.addedAt}>{formatMeetingDate(participant.addedAt)}</time>
        </span>
      </div>
      <RemoveParticipantButton
        meetingId={meetingId}
        participant={participant}
        onRemoved={onRemoved}
      />
    </li>
  );
}
