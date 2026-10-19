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
import { useEffect, useRef, useState } from 'react';
import { setAccessToken, useAccessToken } from '../auth-storage';
import { API_URL, EMAIL_MAX_LENGTH, EMAIL_PATTERN, SERVER_UNAVAILABLE_MESSAGE } from '../constants';
import { PasswordField } from '../password-field';

function getEmailError(value: string): string | null {
  if (!value.trim()) return 'Enter your email address';
  if (!EMAIL_PATTERN.test(value)) return 'Enter a valid email address, e.g. you@example.com';
  return null;
}

function getPasswordError(value: string): string | null {
  return value ? null : 'Enter your password';
}

export default function LoginPage() {
  const router = useRouter();
  const token = useAccessToken();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false });
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // A signed-in user has nothing to do here.
  useEffect(() => {
    if (token) router.replace('/');
  }, [token, router]);

  const emailError = touched.email ? getEmailError(email) : null;
  const passwordError = touched.password ? getPasswordError(password) : null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched({ email: true, password: true });

    if (getEmailError(email)) {
      emailRef.current?.focus();
      return;
    }
    if (getPasswordError(password)) {
      passwordRef.current?.focus();
      return;
    }

    setIsPending(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (response.status === 400 || response.status === 401) {
        // One message for unknown e-mail and wrong password, so accounts cannot be probed.
        setError('Incorrect email or password');
        return;
      }
      if (!response.ok) {
        setError('Could not sign you in. Please try again.');
        return;
      }

      const { accessToken } = (await response.json()) as { accessToken: string };
      setAccessToken(accessToken);
      router.replace('/');
    } catch {
      setError(SERVER_UNAVAILABLE_MESSAGE);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-4 sm:p-6">
      <Card className="glass-card w-full max-w-md rounded-3xl p-6 sm:p-8">
        <Card.Header className="gap-1">
          <Card.Title className="text-2xl font-semibold">Welcome back</Card.Title>
          <Card.Description>Sign in to your video meetings</Card.Description>
        </Card.Header>
        <Card.Content>
          <Form className="flex flex-col gap-5" validationBehavior="aria" onSubmit={handleSubmit}>
            <TextField
              isRequired
              autoFocus
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(value) => {
                setEmail(value);
                setError(null);
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
              onChange={(value) => {
                setPassword(value);
                setError(null);
              }}
              onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
              error={passwordError}
              autoComplete="current-password"
              placeholder="Your password"
              inputRef={passwordRef}
            />

            <div aria-live="polite" className="empty:-mt-5">
              {error !== null && (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
            </div>

            <Button type="submit" fullWidth size="lg" isPending={isPending}>
              {({ isPending }) => (
                <>
                  {isPending ? <Spinner color="current" size="sm" /> : null}
                  {isPending ? 'Signing in…' : 'Sign in'}
                </>
              )}
            </Button>
          </Form>
          <p className="text-muted mt-5 text-center text-sm">
            Don&apos;t have an account?{' '}
            <Link
              href="/register"
              className="text-accent font-medium underline-offset-4 hover:underline"
            >
              Sign up
            </Link>
          </p>
        </Card.Content>
      </Card>
    </main>
  );
}
