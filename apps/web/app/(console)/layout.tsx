import { AppShell } from '../components/app-shell';
import { ConsoleFeedAutoRefresh } from '../components/console-feed-auto-refresh';
import { getCurrentUser } from '../lib/server-api';

interface ConsoleLayoutProps {
  children: React.ReactNode;
}

export default async function ConsoleLayout({ children }: ConsoleLayoutProps) {
  const currentUser = await getCurrentUser();

  return (
    <AppShell user={currentUser}>
      <ConsoleFeedAutoRefresh />
      {children}
    </AppShell>
  );
}
