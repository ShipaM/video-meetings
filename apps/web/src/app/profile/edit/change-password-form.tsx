'use client';

import { Alert, Button, Card, Form, Spinner } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import { authorizedFetch, readErrorMessage } from '../../api';
import { SERVER_UNAVAILABLE_MESSAGE } from '../../constants';
import { getPasswordLengthError, PasswordField } from '../../password-field';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../register/constants';
import {
  CHANGE_PASSWORD_SECTION_ID,
  CONFIRM_PASSWORD_MISMATCH_MESSAGE,
  CONFIRM_PASSWORD_MISSING_MESSAGE,
  NEW_PASSWORD_MISSING_MESSAGE,
  NEW_PASSWORD_REJECTED_MESSAGE,
  OLD_PASSWORD_MISSING_MESSAGE,
  OLD_PASSWORD_WRONG_MESSAGE,
  PASSWORD_CHANGED_MESSAGE,
  PASSWORD_CHANGE_FAILED_MESSAGE,
} from '../constants';

type Status = { type: 'idle' } | { type: 'success' } | { type: 'error'; message: string };

const UNTOUCHED = { oldPassword: false, newPassword: false, confirmPassword: false };

function getOldPasswordError(value: string): string | null {
  return value ? null : OLD_PASSWORD_MISSING_MESSAGE;
}

/** Same limits as registration, mirrors `ChangePasswordDto` in the API. */
function getNewPasswordError(value: string): string | null {
  if (!value) return NEW_PASSWORD_MISSING_MESSAGE;
  return getPasswordLengthError(value);
}

function getConfirmPasswordError(value: string, newPassword: string): string | null {
  if (!value) return CONFIRM_PASSWORD_MISSING_MESSAGE;
  return value === newPassword ? null : CONFIRM_PASSWORD_MISMATCH_MESSAGE;
}

/** Whether the page was opened through the Change password action on `/profile`. */
export function isChangePasswordTarget(): boolean {
  return window.location.hash === `#${CHANGE_PASSWORD_SECTION_ID}`;
}

export function ChangePasswordForm() {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [touched, setTouched] = useState(UNTOUCHED);
  const [oldServerError, setOldServerError] = useState<string | null>(null);
  const [newServerError, setNewServerError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ type: 'idle' });
  const [isPending, setIsPending] = useState(false);
  const oldRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  function resetFields() {
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setTouched(UNTOUCHED);
  }

  useEffect(() => {
    if (isChangePasswordTarget()) oldRef.current?.focus();
    // Next.js keeps this page's state when it is left: drop the typed passwords, so a return visit
    // starts with an empty form. A request in flight is not aborted: the server may already have
    // changed the password, and its answer still shows on return.
    return () => {
      resetFields();
      setOldServerError(null);
      setNewServerError(null);
      setStatus({ type: 'idle' });
    };
  }, []);

  // Errors appear after the field is left (or on submit), not while the user is still typing.
  const oldError =
    oldServerError ?? (touched.oldPassword ? getOldPasswordError(oldPassword) : null);
  const newError =
    newServerError ?? (touched.newPassword ? getNewPasswordError(newPassword) : null);
  const confirmError = touched.confirmPassword
    ? getConfirmPasswordError(confirmPassword, newPassword)
    : null;

  function handleOldChange(value: string) {
    setOldPassword(value);
    setOldServerError(null);
    setStatus({ type: 'idle' });
  }

  function handleNewChange(value: string) {
    setNewPassword(value);
    setNewServerError(null);
    setStatus({ type: 'idle' });
  }

  function handleConfirmChange(value: string) {
    setConfirmPassword(value);
    setStatus({ type: 'idle' });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Enter in a field submits even while the button is pending.
    if (isPending) return;
    setTouched({ oldPassword: true, newPassword: true, confirmPassword: true });

    if (getOldPasswordError(oldPassword)) {
      oldRef.current?.focus();
      return;
    }
    if (getNewPasswordError(newPassword)) {
      newRef.current?.focus();
      return;
    }
    if (getConfirmPasswordError(confirmPassword, newPassword)) {
      confirmRef.current?.focus();
      return;
    }

    setIsPending(true);
    setStatus({ type: 'idle' });
    setOldServerError(null);
    setNewServerError(null);

    try {
      // `null` means the session ended (401), which redirects to /login.
      const response = await authorizedFetch('/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      if (!response) return;
      if (response.status === 403) {
        setOldServerError(OLD_PASSWORD_WRONG_MESSAGE);
        oldRef.current?.focus();
        return;
      }
      if (response.status === 400) {
        setNewServerError((await readErrorMessage(response)) ?? NEW_PASSWORD_REJECTED_MESSAGE);
        newRef.current?.focus();
        return;
      }
      if (!response.ok) {
        setStatus({ type: 'error', message: PASSWORD_CHANGE_FAILED_MESSAGE });
        return;
      }
      // The token stays valid, so the user stays signed in; only the form starts over.
      resetFields();
      setStatus({ type: 'success' });
    } catch {
      setStatus({ type: 'error', message: SERVER_UNAVAILABLE_MESSAGE });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card
      id={CHANGE_PASSWORD_SECTION_ID}
      className="glass-card w-full max-w-md scroll-mt-6 rounded-3xl p-6 sm:p-8"
    >
      <Card.Header className="gap-1">
        <Card.Title className="text-2xl font-semibold">Change password</Card.Title>
        <Card.Description>You stay signed in on this device</Card.Description>
      </Card.Header>
      <Card.Content>
        <Form className="flex flex-col gap-5" validationBehavior="aria" onSubmit={handleSubmit}>
          <PasswordField
            label="Current password"
            name="oldPassword"
            value={oldPassword}
            onChange={handleOldChange}
            onBlur={() => setTouched((prev) => ({ ...prev, oldPassword: true }))}
            error={oldError}
            autoComplete="current-password"
            placeholder="Your current password"
            inputRef={oldRef}
          />

          <PasswordField
            label="New password"
            name="newPassword"
            value={newPassword}
            onChange={handleNewChange}
            onBlur={() => setTouched((prev) => ({ ...prev, newPassword: true }))}
            error={newError}
            autoComplete="new-password"
            placeholder="Create a new password"
            hint={`Use ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`}
            inputRef={newRef}
          />

          <PasswordField
            label="Confirm new password"
            name="confirmPassword"
            value={confirmPassword}
            onChange={handleConfirmChange}
            onBlur={() => setTouched((prev) => ({ ...prev, confirmPassword: true }))}
            error={confirmError}
            autoComplete="new-password"
            placeholder="Repeat the new password"
            inputRef={confirmRef}
          />

          <div aria-live="polite" className="empty:-mt-5">
            {status.type === 'error' && (
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>{status.message}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}
            {status.type === 'success' && (
              <Alert status="success">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>{PASSWORD_CHANGED_MESSAGE}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}
          </div>

          <Button type="submit" fullWidth size="lg" isPending={isPending}>
            {({ isPending }) => (
              <>
                {isPending ? <Spinner color="current" size="sm" /> : null}
                {isPending ? 'Changing password…' : 'Change password'}
              </>
            )}
          </Button>
        </Form>
      </Card.Content>
    </Card>
  );
}
