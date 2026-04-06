'use client';

import { startTransition, useState } from 'react';

import { browserApiRequest } from '../lib/browser-api';
import type { ExternalAuthUrlResponse } from '../lib/types';

interface AuthProviderButtonsProps {
  readonly intent: 'login' | 'link';
}

export function AuthProviderButtons({ intent }: AuthProviderButtonsProps) {
  const [pendingProvider, setPendingProvider] = useState<
    'google' | 'steam' | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleProviderAuth(provider: 'google' | 'steam') {
    setPendingProvider(provider);
    setErrorMessage(null);

    try {
      const endpoint =
        intent === 'link'
          ? `/auth/${provider}/link/start`
          : `/auth/${provider}/start`;
      const response = await browserApiRequest<ExternalAuthUrlResponse>(
        endpoint,
        {
          method: 'GET',
        },
      );

      startTransition(() => {
        window.location.assign(response.authorizationUrl);
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to start external auth.',
      );
      setPendingProvider(null);
    }
  }

  return (
    <div className="field-grid">
      <div className="hero-actions">
        <button
          className="button-secondary"
          disabled={pendingProvider !== null}
          type="button"
          onClick={() => void handleProviderAuth('google')}
        >
          {pendingProvider === 'google'
            ? 'Opening Google...'
            : 'Continue With Google'}
        </button>
        <button
          className="button-secondary"
          disabled={pendingProvider !== null}
          type="button"
          onClick={() => void handleProviderAuth('steam')}
        >
          {pendingProvider === 'steam'
            ? 'Opening Steam...'
            : 'Continue With Steam'}
        </button>
      </div>
      {errorMessage ? <div className="form-error">{errorMessage}</div> : null}
    </div>
  );
}
