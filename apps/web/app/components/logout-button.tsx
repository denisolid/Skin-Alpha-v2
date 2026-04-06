'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useState } from 'react';

import { browserApiRequest } from '../lib/browser-api';

export function LogoutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleLogout() {
    setIsPending(true);

    try {
      await browserApiRequest('/auth/logout', {
        method: 'POST',
      });
    } finally {
      startTransition(() => {
        router.push('/login');
        router.refresh();
      });
    }
  }

  return (
    <button
      className="button-ghost"
      disabled={isPending}
      type="button"
      onClick={() => void handleLogout()}
    >
      {isPending ? 'Signing out...' : 'Sign Out'}
    </button>
  );
}
