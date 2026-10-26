'use client';

import {
  Alert,
  Button,
  Card,
  Description,
  FieldError,
  Form,
  Input,
  Label,
  Skeleton,
  Spinner,
  TextField,
  buttonVariants,
} from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { authorizedFetch } from '../../api';
import { useAccessToken } from '../../auth-storage';
import { SERVER_UNAVAILABLE_MESSAGE } from '../../constants';
import type { Profile } from '../../profile';
import {
  PROFILE_LOAD_FAILED_MESSAGE,
  PROFILE_NAME_HINT,
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_NAME_REJECTED_MESSAGE,
  PROFILE_NAME_TOO_LONG_MESSAGE,
  PROFILE_SAVE_FAILED_MESSAGE,
} from '../constants';

type LoadState = { type: 'loading' } | { type: 'error'; message: string } | { type: 'ready' };

function getNameError(value: string): string | null {
  return value.trim().length > PROFILE_NAME_MAX_LENGTH ? PROFILE_NAME_TOO_LONG_MESSAGE : null;
}

/** The API's reason for a `400`: a string, or the first entry of a validation list. */
async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const { message } = (await response.json()) as { message?: unknown };
    const first: unknown = Array.isArray(message) ? message[0] : message;
    return typeof first === 'string' && first ? first : null;
  } catch {
    return null;
  }
}

export default function ProfileEditPage() {
  const router = useRouter();
  const token = useAccessToken();

  useEffect(() => {
    if (token === null) router.replace('/login');
  }, [token, router]);

  // Nothing to show until the token is known; also covers the redirect to /login.
  if (!token) return <main className="flex flex-1" aria-busy="true" />;

  // A fresh tree per user, so the previous user's name never shows (see apps/web/CLAUDE.md).
  return <ProfileEditContent key={token} />;
}

function ProfileEditContent() {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>({ type: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [nameServerError, setNameServerError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        // `null` means the token was cleared, which redirects to /login.
        const response = await authorizedFetch('/users/me', { signal: controller.signal });
        if (!response) return;
        if (!response.ok) {
          setLoadState({ type: 'error', message: PROFILE_LOAD_FAILED_MESSAGE });
          return;
        }
        const profile = (await response.json()) as Profile;
        setName(profile.name ?? '');
        setLoadState({ type: 'ready' });
      } catch {
        if (controller.signal.aborted) return;
        setLoadState({ type: 'error', message: SERVER_UNAVAILABLE_MESSAGE });
      }
    }

    void load();
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (loadState.type === 'ready') nameRef.current?.focus();
  }, [loadState.type]);

  function handleRetry() {
    setLoadState({ type: 'loading' });
    setAttempt((current) => current + 1);
  }

  function handleNameChange(value: string) {
    setName(value);
    setNameServerError(null);
  }

  const nameError = nameServerError ?? (touched ? getNameError(name) : null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);

    if (getNameError(name)) {
      nameRef.current?.focus();
      return;
    }

    setIsPending(true);
    setError(null);
    setNameServerError(null);

    try {
      // An empty name clears it; the API trims as well.
      const response = await authorizedFetch('/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!response) return;
      if (response.status === 400) {
        setNameServerError((await readErrorMessage(response)) ?? PROFILE_NAME_REJECTED_MESSAGE);
        nameRef.current?.focus();
        return;
      }
      if (!response.ok) {
        setError(PROFILE_SAVE_FAILED_MESSAGE);
        return;
      }
      router.push('/profile');
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
          <Card.Title className="text-2xl font-semibold">Edit profile</Card.Title>
          <Card.Description>Choose the name others see</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-5">
          {loadState.type === 'loading' && (
            <div className="flex flex-col gap-2" aria-busy="true">
              <Skeleton className="h-5 w-16 rounded-lg" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          )}

          {loadState.type === 'error' && (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{loadState.message}</Alert.Description>
              </Alert.Content>
              <Button size="sm" variant="danger" onPress={handleRetry}>
                Try again
              </Button>
            </Alert>
          )}

          {loadState.type === 'ready' && (
            <Form className="flex flex-col gap-5" validationBehavior="aria" onSubmit={handleSubmit}>
              <TextField
                name="name"
                value={name}
                onChange={handleNameChange}
                onBlur={() => setTouched(true)}
                isInvalid={nameError !== null}
                validationBehavior="aria"
              >
                <Label>Name</Label>
                <Input ref={nameRef} placeholder="Your name" autoComplete="name" />
                {nameError === null ? (
                  <Description className="text-sm">{PROFILE_NAME_HINT}</Description>
                ) : null}
                <FieldError className="text-sm">{nameError}</FieldError>
              </TextField>

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

              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                <Link
                  href="/profile"
                  className={buttonVariants({
                    variant: 'secondary',
                    size: 'lg',
                    className: 'w-full sm:w-auto sm:flex-1',
                  })}
                >
                  Cancel
                </Link>
                <Button
                  type="submit"
                  size="lg"
                  className="w-full sm:w-auto sm:flex-1"
                  isPending={isPending}
                >
                  {({ isPending }) => (
                    <>
                      {isPending ? <Spinner color="current" size="sm" /> : null}
                      {isPending ? 'Saving…' : 'Save'}
                    </>
                  )}
                </Button>
              </div>
            </Form>
          )}

          {loadState.type !== 'ready' && (
            <Link
              href="/profile"
              className={buttonVariants({ variant: 'secondary', size: 'lg', className: 'w-full' })}
            >
              Cancel
            </Link>
          )}
        </Card.Content>
      </Card>
    </main>
  );
}
