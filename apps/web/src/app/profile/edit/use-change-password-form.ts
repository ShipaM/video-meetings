import { useEffect, useRef, useState } from 'react';
import { getPasswordLengthError } from '../../password-field';
import {
  CONFIRM_PASSWORD_MISMATCH_MESSAGE,
  CONFIRM_PASSWORD_MISSING_MESSAGE,
  NEW_PASSWORD_MISSING_MESSAGE,
  OLD_PASSWORD_MISSING_MESSAGE,
} from '../constants';
import { changePassword } from './password-api';

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

type PasswordFieldName = keyof typeof UNTOUCHED;

/** The Change password form: its fields, their errors and the request. */
export function useChangePasswordForm() {
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

  function handleBlur(field: PasswordFieldName) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Enter in a field submits even while the button is pending.
    if (isPending) return;
    // A previous result never stays next to the errors of this attempt.
    setStatus({ type: 'idle' });
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
    setOldServerError(null);
    setNewServerError(null);

    // `unauthorized`: the session ended (401), which redirects to /login.
    const result = await changePassword(oldPassword, newPassword);
    setIsPending(false);
    if (result.type === 'old-password-rejected') {
      setOldServerError(result.message);
      oldRef.current?.focus();
    } else if (result.type === 'new-password-rejected') {
      setNewServerError(result.message);
      newRef.current?.focus();
    } else if (result.type === 'error') {
      setStatus(result);
    } else if (result.type === 'changed') {
      // The token stays valid, so the user stays signed in; only the form starts over.
      resetFields();
      setStatus({ type: 'success' });
    }
  }

  return {
    oldPassword,
    newPassword,
    confirmPassword,
    oldError,
    newError,
    confirmError,
    status,
    isPending,
    oldRef,
    newRef,
    confirmRef,
    handleOldChange,
    handleNewChange,
    handleConfirmChange,
    handleBlur,
    handleSubmit,
  };
}
