'use client';

import { Alert, Button, Card, Form, Spinner } from '@heroui/react';
import { useEffect } from 'react';
import { PasswordField } from '../../password-field';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../register/constants';
import { CHANGE_PASSWORD_SECTION_ID, PASSWORD_CHANGED_MESSAGE } from '../constants';
import { useChangePasswordForm } from './use-change-password-form';

/** Whether the page was opened through the Change password action on `/profile`. */
export function isChangePasswordTarget(): boolean {
  return window.location.hash === `#${CHANGE_PASSWORD_SECTION_ID}`;
}

export function ChangePasswordForm() {
  const {
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
  } = useChangePasswordForm();

  useEffect(() => {
    if (isChangePasswordTarget()) oldRef.current?.focus();
  }, [oldRef]);

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
            onBlur={() => handleBlur('oldPassword')}
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
            onBlur={() => handleBlur('newPassword')}
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
            onBlur={() => handleBlur('confirmPassword')}
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
