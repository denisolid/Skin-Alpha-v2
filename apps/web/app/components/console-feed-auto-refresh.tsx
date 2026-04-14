'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';

const FEED_REFRESH_INTERVAL_MS = 15_000;
const FEED_AUTO_REFRESH_ENABLED = false;

function isFeedRoute(pathname: string): boolean {
  return (
    pathname === '/dashboard' ||
    pathname === '/opportunities' ||
    pathname.startsWith('/opportunities/')
  );
}

export function ConsoleFeedAutoRefresh() {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isPendingRef = useRef(false);

  useEffect(() => {
    isPendingRef.current = isPending;
  }, [isPending]);

  useEffect(() => {
    if (!FEED_AUTO_REFRESH_ENABLED || !isFeedRoute(pathname)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      if (isPendingRef.current) {
        return;
      }

      startTransition(() => {
        router.refresh();
      });
    }, FEED_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [pathname, router, startTransition]);

  return null;
}
