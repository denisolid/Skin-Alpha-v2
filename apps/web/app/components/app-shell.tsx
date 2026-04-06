'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { CurrentUser } from '../lib/types';
import { LogoutButton } from './logout-button';

interface AppShellProps {
  readonly user: CurrentUser | null;
  readonly children: React.ReactNode;
}

const navigation = [
  {
    href: '/dashboard',
    label: 'Dashboard',
  },
  {
    href: '/opportunities',
    label: 'Opportunities',
  },
  {
    href: '/watchlists',
    label: 'Watchlists',
  },
  {
    href: '/account/settings',
    label: 'Account',
  },
];

export function AppShell({ user, children }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link className="brand-mark" href="/">
          SkinAlpha v2
        </Link>

        <nav className="sidebar-nav">
          {navigation.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                className={`sidebar-link${isActive ? ' sidebar-link-active' : ''}`}
                href={item.href}
              >
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <strong>
              {user?.displayName ?? user?.email ?? 'Guest Session'}
            </strong>
            <span>{user ? user.role : 'Public opportunities view'}</span>
          </div>

          {user ? (
            <LogoutButton />
          ) : (
            <Link className="button-primary" href="/login">
              Sign In
            </Link>
          )}
        </div>
      </aside>

      <main className="app-main">
        <div className="page-stack">{children}</div>
      </main>
    </div>
  );
}
