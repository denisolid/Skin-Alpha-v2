import { AppShell } from '../components/app-shell';
import { getCurrentUser } from '../lib/server-api';

interface ConsoleLayoutProps {
  children: React.ReactNode;
}

export default async function ConsoleLayout({ children }: ConsoleLayoutProps) {
  const currentUser = await getCurrentUser();

  return <AppShell user={currentUser}>{children}</AppShell>;
}
