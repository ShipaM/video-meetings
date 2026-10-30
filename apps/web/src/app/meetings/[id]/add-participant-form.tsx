'use client';

import { Button, FieldError, Form, Input, Label, TextField } from '@heroui/react';
import { useRef, useState } from 'react';
import { EMAIL_MAX_LENGTH, EMAIL_PATTERN } from '../../constants';
import type { Participant } from '../../meetings';
import { addParticipant } from './participants-api';

/** Checks an already trimmed e-mail. */
function getEmailError(value: string): string | null {
  if (!value) return 'Enter the e-mail of a registered user';
  if (!EMAIL_PATTERN.test(value)) return 'Enter a valid e-mail address, e.g. name@example.com';
  return null;
}

/** The e-mail field of the participants section; the API's reason shows under it. */
export function AddParticipantForm({
  meetingId,
  isReady,
  onAdding,
  onAdded,
}: {
  meetingId: string;
  /** Adding needs the loaded list, so the new participant can simply be appended to it. */
  isReady: boolean;
  onAdding: () => void;
  onAdded: (participant: Participant) => void;
}) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isReady) return;
    const value = email.trim();
    const invalid = getEmailError(value);
    if (invalid) {
      setError(invalid);
      inputRef.current?.focus();
      return;
    }

    setIsPending(true);
    setError(null);
    onAdding();
    const result = await addParticipant(meetingId, value);
    setIsPending(false);
    if (result.type === 'added') {
      setEmail('');
      onAdded(result.participant);
    } else if (result.type === 'error') {
      setError(result.message);
      inputRef.current?.focus();
    }
  }

  return (
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
            isDisabled={!isReady}
          >
            {isPending ? 'Adding…' : 'Add'}
          </Button>
        </div>
        <FieldError className="text-sm">{error}</FieldError>
      </TextField>
    </Form>
  );
}
