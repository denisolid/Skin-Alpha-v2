'use client';

import Link from 'next/link';
import { useState } from 'react';

import { browserApiRequest } from '../lib/browser-api';
import type { AuthSessionResponse } from '../lib/types';
import { AuthProviderButtons } from './auth-provider-buttons';

interface AuthFormProps {
  readonly mode: 'login' | 'register';
}

export function AuthForm({ mode }: AuthFormProps) {
  const [formState, setFormState] = useState({
    email: '',
    password: '',
    displayName: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const payload =
        mode === 'register'
          ? {
              email: formState.email,
              password: formState.password,
              ...(formState.displayName.trim().length > 0
                ? { displayName: formState.displayName.trim() }
                : {}),
            }
          : {
              email: formState.email,
              password: formState.password,
            };
      await browserApiRequest<AuthSessionResponse>(`/auth/${mode}`, {
        method: 'POST',
        body: payload,
      });

      window.location.assign('/dashboard');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Authentication failed.',
      );
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <form
        className="auth-form"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <div className="field-grid">
          {mode === 'register' ? (
            <div className="field">
              <label htmlFor="displayName">Display name</label>
              <input
                autoComplete="nickname"
                id="displayName"
                placeholder="Optional"
                value={formState.displayName}
                onChange={(event) =>
                  setFormState((currentState) => ({
                    ...currentState,
                    displayName: event.target.value,
                  }))
                }
              />
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              autoComplete="email"
              id="email"
              inputMode="email"
              placeholder="you@example.com"
              required
              type="email"
              value={formState.email}
              onChange={(event) =>
                setFormState((currentState) => ({
                  ...currentState,
                  email: event.target.value,
                }))
              }
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
              id="password"
              minLength={8}
              placeholder="Minimum 8 characters"
              required
              type="password"
              value={formState.password}
              onChange={(event) =>
                setFormState((currentState) => ({
                  ...currentState,
                  password: event.target.value,
                }))
              }
            />
          </div>
        </div>

        {errorMessage ? <div className="form-error">{errorMessage}</div> : null}

        <button
          className="button-primary"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting
            ? mode === 'login'
              ? 'Signing in...'
              : 'Creating account...'
            : mode === 'login'
              ? 'Sign In'
              : 'Create Account'}
        </button>
      </form>

      <div className="auth-divider">
        <span>or use an external identity</span>
      </div>

      <AuthProviderButtons intent="login" />

      <p className="auth-footer">
        {mode === 'login' ? 'Need an account? ' : 'Already registered? '}
        <Link href={mode === 'login' ? '/register' : '/login'}>
          {mode === 'login' ? 'Create one' : 'Sign in'}
        </Link>
      </p>
    </>
  );
}
