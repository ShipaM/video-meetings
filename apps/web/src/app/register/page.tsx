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
import { useState } from 'react';
import {
  API_URL,
  EMAIL_MAX_LENGTH,
  EMAIL_PATTERN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from './constants';

type Status = { type: 'idle' } | { type: 'success' } | { type: 'error'; message: string };

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [status, setStatus] = useState<Status>({ type: 'idle' });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setStatus({ type: 'idle' });

    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (response.status === 409) {
        setStatus({ type: 'error', message: 'An account with this email already exists' });
        return;
      }
      if (!response.ok) {
        setStatus({ type: 'error', message: 'Registration failed. Please check your details.' });
        return;
      }

      const { accessToken } = (await response.json()) as { accessToken: string };
      localStorage.setItem('accessToken', accessToken);
      setStatus({ type: 'success' });
    } catch {
      setStatus({ type: 'error', message: 'The server is unavailable. Please try again later.' });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="glass-card w-full max-w-sm rounded-3xl p-6">
        <Card.Header>
          <Card.Title className="text-2xl font-semibold">Create your account</Card.Title>
          <Card.Description>Sign up to host and join video meetings</Card.Description>
        </Card.Header>
        <Card.Content>
          <Form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <TextField
              isRequired
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={setEmail}
              maxLength={EMAIL_MAX_LENGTH}
              validate={(value) =>
                EMAIL_PATTERN.test(value) ? null : 'Enter a valid email address'
              }
            >
              <Label>Email</Label>
              <Input placeholder="you@example.com" />
              <FieldError />
            </TextField>

            <TextField
              isRequired
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              validate={(value) => {
                if (value.length < PASSWORD_MIN_LENGTH) {
                  return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
                }
                if (value.length > PASSWORD_MAX_LENGTH) {
                  return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
                }
                return null;
              }}
            >
              <Label>Password</Label>
              <Input placeholder="At least 8 characters" />
              <FieldError />
            </TextField>

            {status.type === 'error' && (
              <Alert status="danger">
                <Alert.Content>
                  <Alert.Description>{status.message}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}
            {status.type === 'success' && (
              <Alert status="success">
                <Alert.Content>
                  <Alert.Description>Registration successful</Alert.Description>
                </Alert.Content>
              </Alert>
            )}

            <Button type="submit" fullWidth isPending={isPending}>
              {({ isPending }) => (
                <>
                  {isPending ? <Spinner color="current" size="sm" /> : null}
                  Sign up
                </>
              )}
            </Button>
          </Form>
        </Card.Content>
      </Card>
    </main>
  );
}
