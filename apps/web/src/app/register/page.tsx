'use client';

import {
  Alert,
  Button,
  Card,
  Description,
  FieldError,
  Form,
  Input,
  InputGroup,
  Label,
  Spinner,
  TextField,
} from '@heroui/react';
import { useRef, useState } from 'react';
import {
  API_URL,
  EMAIL_MAX_LENGTH,
  EMAIL_PATTERN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from './constants';

type Status = { type: 'idle' } | { type: 'success' } | { type: 'error'; message: string };

function getEmailError(value: string, isTaken: boolean): string | null {
  if (!value.trim()) return 'Enter your email address';
  if (!EMAIL_PATTERN.test(value)) return 'Enter a valid email address, e.g. you@example.com';
  if (isTaken) return 'An account with this email already exists';
  return null;
}

function getPasswordError(value: string): string | null {
  if (!value) return 'Enter a password';
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  return null;
}

function EyeIcon({ isOff }: { isOff: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {isOff ? <path d="m3 3 18 18" /> : null}
    </svg>
  );
}

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false });
  const [emailTaken, setEmailTaken] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
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
      localStorage.setItem('accessToken', accessToken);
      setStatus({ type: 'success' });
    } catch {
      setStatus({ type: 'error', message: 'The server is unavailable. Please try again later.' });
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

            <TextField
              isRequired
              name="password"
              type={isPasswordVisible ? 'text' : 'password'}
              autoComplete="new-password"
              isDisabled={isSuccess}
              value={password}
              onChange={setPassword}
              onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
              isInvalid={passwordError !== null}
              validationBehavior="aria"
            >
              <Label>Password</Label>
              <InputGroup fullWidth>
                <InputGroup.Input ref={passwordRef} placeholder="Create a password" />
                <InputGroup.Suffix className="pr-1">
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    isDisabled={isSuccess}
                    aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
                    aria-pressed={isPasswordVisible}
                    onPress={() => setIsPasswordVisible((visible) => !visible)}
                  >
                    <EyeIcon isOff={isPasswordVisible} />
                  </Button>
                </InputGroup.Suffix>
              </InputGroup>
              {passwordError === null && (
                <Description className="text-sm">
                  Use {PASSWORD_MIN_LENGTH}–{PASSWORD_MAX_LENGTH} characters
                </Description>
              )}
              <FieldError className="text-sm">{passwordError}</FieldError>
            </TextField>

            <div aria-live="polite" className="empty:-mt-5">
              {status.type === 'error' && (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Description>{status.message}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
              {isSuccess && (
                <Alert status="success">
                  <Alert.Content>
                    <Alert.Title>You&apos;re all set</Alert.Title>
                    <Alert.Description>Your account has been created.</Alert.Description>
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
        </Card.Content>
      </Card>
    </main>
  );
}
