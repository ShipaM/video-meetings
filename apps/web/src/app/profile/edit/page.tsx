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
import { useEffect } from 'react';
import { useAccessToken } from '../../auth-storage';
import { PROFILE_NAME_HINT } from '../constants';
import { AvatarPicker } from './avatar-picker';
import { ChangePasswordForm } from './change-password-form';
import { useProfileForm } from './use-profile-form';

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
  const { nameRef, ...form } = useProfileForm();
  const { loadState } = form;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-4 sm:p-6">
      <Card className="glass-card w-full max-w-md rounded-3xl p-6 sm:p-8">
        <Card.Header className="gap-1">
          <Card.Title className="text-2xl font-semibold">Edit profile</Card.Title>
          <Card.Description>Choose the name and avatar others see</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-5">
          {loadState.type === 'loading' && <ProfileFormSkeleton />}

          {loadState.type === 'error' && (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{loadState.message}</Alert.Description>
              </Alert.Content>
              <Button size="sm" variant="danger" onPress={form.handleRetry}>
                Try again
              </Button>
            </Alert>
          )}

          {loadState.type === 'ready' && <ProfileForm form={form} nameRef={nameRef} />}

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
      <ChangePasswordForm />
    </main>
  );
}

function ProfileFormSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {/* The avatar picker's place, so the form does not jump down once it loads. */}
      <Skeleton className="mb-2 h-5 w-14 rounded-lg" />
      <div className="mb-3 flex items-center gap-4">
        <Skeleton className="size-20 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-11 w-32 rounded-full sm:h-10" />
          <Skeleton className="h-4 w-3/4 rounded-lg" />
        </div>
      </div>
      <Skeleton className="h-5 w-16 rounded-lg" />
      <Skeleton className="h-10 w-full rounded-xl" />
    </div>
  );
}

function ProfileForm({
  form,
  nameRef,
}: {
  form: Omit<ReturnType<typeof useProfileForm>, 'nameRef'>;
  nameRef: ReturnType<typeof useProfileForm>['nameRef'];
}) {
  const { avatar, error, nameError } = form;

  return (
    <Form className="flex flex-col gap-5" validationBehavior="aria" onSubmit={form.handleSubmit}>
      <AvatarPicker
        savedAvatarUrl={form.savedAvatarUrl}
        change={avatar.change}
        isUploading={avatar.isUploading}
        error={avatar.error}
        onPick={avatar.pick}
        onRemove={avatar.remove}
      />

      <TextField
        name="name"
        value={form.name}
        onChange={form.handleNameChange}
        onBlur={form.handleNameBlur}
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
          isPending={form.isPending}
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
  );
}
