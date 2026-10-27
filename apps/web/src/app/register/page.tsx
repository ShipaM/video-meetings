'use client';

import {
  Alert,
  Button,
  Card,
  FieldError,
  Form,
  Input,
  Label,
  Spinner,
  TextField,
} from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { setAccessToken } from '../auth-storage';
import { API_URL, EMAIL_MAX_LENGTH, EMAIL_PATTERN, SERVER_UNAVAILABLE_MESSAGE } from '../constants';
import { getPasswordLengthError, PasswordField } from '../password-field';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './constants';

type Status = { type: 'idle' } | { type: 'success' } | { type: 'error'; message: string };

function getEmailError(value: string, isTaken: boolean): string | null {
  if (!value.trim()) return 'Enter your email address';
  if (!EMAIL_PATTERN.test(value)) return 'Enter a valid email address, e.g. you@example.com';
  if (isTaken) return 'An account with this email already exists';
  return null;
}

function getPasswordError(value: string): string | null {
  if (!value) return 'Enter a password';
  return getPasswordLengthError(value);
}

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false });
  const [emailTaken, setEmailTaken] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [status, setStatus] = useState<Status>({ type: 'idle' });
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Errors appear after the field is left (or on submit), not while the user is still typing.
  const emailError = touched.email ? getEmailError(email, emailTaken) : null;
  const passwordError = touched.password ? getPasswordError(password) : null;
  const isSuccess = status.type === 'success';

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched({ email: true, password: true });

    if (getEmailError(email, false)) {
      emailRef.current?.focus();
      return;
    }
    if (getPasswordError(password)) {
      passwordRef.current?.focus();
      return;
    }

    setIsPending(true);
    setStatus({ type: 'idle' });

    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (response.status === 409) {
        setEmailTaken(true);
        emailRef.current?.focus();
        return;
      }
      if (!response.ok) {
        setStatus({ type: 'error', message: 'Registration failed. Please check your details.' });
        return;
      }

      const { accessToken } = (await response.json()) as { accessToken: string };
      setAccessToken(accessToken);
      setStatus({ type: 'success' });
      router.replace('/');
    } catch {
      setStatus({ type: 'error', message: SERVER_UNAVAILABLE_MESSAGE });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-4 sm:p-6">
      <Card className="glass-card w-full max-w-md rounded-3xl p-6 sm:p-8">
        <Card.Header className="gap-1">
          <Card.Title className="text-2xl font-semibold">Create your account</Card.Title>
          <Card.Description>Sign up to host and join video meetings</Card.Description>
        </Card.Header>
        <Card.Content>
          <Form className="flex flex-col gap-5" validationBehavior="aria" onSubmit={handleSubmit}>
            <TextField
              isRequired
              autoFocus
              name="email"
              type="email"
              autoComplete="email"
              isDisabled={isSuccess}
              value={email}
              onChange={(value) => {
                setEmail(value);
                setEmailTaken(false);
              }}
              onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
              isInvalid={emailError !== null}
              validationBehavior="aria"
            >
              <Label>Email</Label>
              <Input
                ref={emailRef}
                placeholder="you@example.com"
                maxLength={EMAIL_MAX_LENGTH}
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
              />
              <FieldError className="text-sm">{emailError}</FieldError>
            </TextField>

            <PasswordField
              value={password}
              onChange={setPassword}
              onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
              error={passwordError}
              autoComplete="new-password"
              placeholder="Create a password"
              hint={`Use ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`}
              isDisabled={isSuccess}
              inputRef={passwordRef}
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
              {isSuccess && (
                <Alert status="success">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>You&apos;re all set</Alert.Title>
                    <Alert.Description>Taking you to your meetings…</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
            </div>

            <Button type="submit" fullWidth size="lg" isPending={isPending} isDisabled={isSuccess}>
              {({ isPending }) => (
                <>
                  {isPending ? <Spinner color="current" size="sm" /> : null}
                  {isPending ? 'Creating account…' : 'Create account'}
                </>
              )}
            </Button>
          </Form>
          <p className="text-muted mt-5 text-center text-sm">
            Already have an account?{' '}
            <Link
              href="/login"
              className="text-accent font-medium underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </Card.Content>
      </Card>
    </main>
  );
}
