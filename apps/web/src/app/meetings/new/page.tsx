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
  buttonVariants,
} from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { clearAccessToken, useAccessToken } from '../../auth-storage';
import { API_URL, MEETING_TITLE_MAX_LENGTH } from '../../constants';

function getTitleError(value: string): string | null {
  return value.trim() ? null : 'Enter a meeting title';
}

function getStartsAtError(value: string): string | null {
  return value && !Number.isNaN(Date.parse(value)) ? null : 'Choose a start date and time';
}

export default function NewMeetingPage() {
  const router = useRouter();
  const token = useAccessToken();
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [touched, setTouched] = useState({ title: false, startsAt: false });
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const startsAtRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (token === null) router.replace('/login');
  }, [token, router]);

  if (!token) return <main className="flex flex-1" aria-busy="true" />;

  const titleError = touched.title ? getTitleError(title) : null;
  const startsAtError = touched.startsAt ? getStartsAtError(startsAt) : null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched({ title: true, startsAt: true });

    if (getTitleError(title)) {
      titleRef.current?.focus();
      return;
    }
    if (getStartsAtError(startsAt)) {
      startsAtRef.current?.focus();
      return;
    }

    setIsPending(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        // datetime-local has no zone; convert from the user's local time to an ISO instant.
        body: JSON.stringify({ title: title.trim(), startsAt: new Date(startsAt).toISOString() }),
      });

      if (response.status === 401) {
        clearAccessToken();
        return;
      }
      if (!response.ok) {
        setError('Could not create the meeting. Please check the details.');
        return;
      }
      router.replace('/');
    } catch {
      setError('The server is unavailable. Please try again later.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-4 sm:p-6">
      <Card className="glass-card w-full max-w-md rounded-3xl p-6 sm:p-8">
        <Card.Header className="gap-1">
          <Card.Title className="text-2xl font-semibold">Create meeting</Card.Title>
          <Card.Description>Pick a title and when it starts</Card.Description>
        </Card.Header>
        <Card.Content>
          <Form className="flex flex-col gap-5" validationBehavior="aria" onSubmit={handleSubmit}>
            <TextField
              isRequired
              autoFocus
              name="title"
              value={title}
              onChange={setTitle}
              onBlur={() => setTouched((prev) => ({ ...prev, title: true }))}
              isInvalid={titleError !== null}
              validationBehavior="aria"
            >
              <Label>Title</Label>
              <Input
                ref={titleRef}
                placeholder="Weekly sync"
                maxLength={MEETING_TITLE_MAX_LENGTH}
              />
              <FieldError className="text-sm">{titleError}</FieldError>
            </TextField>

            <TextField
              isRequired
              name="startsAt"
              type="datetime-local"
              value={startsAt}
              onChange={setStartsAt}
              onBlur={() => setTouched((prev) => ({ ...prev, startsAt: true }))}
              isInvalid={startsAtError !== null}
              validationBehavior="aria"
            >
              <Label>Starts at</Label>
              <Input ref={startsAtRef} />
              <FieldError className="text-sm">{startsAtError}</FieldError>
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
                href="/"
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
                    {isPending ? 'Creating…' : 'Create meeting'}
                  </>
                )}
              </Button>
            </div>
          </Form>
        </Card.Content>
      </Card>
    </main>
  );
}
