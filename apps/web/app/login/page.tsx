import { redirect } from 'next/navigation';

import { AuthForm } from '../components/auth-form';
import { getCurrentUser } from '../lib/server-api';

export default async function LoginPage() {
  const currentUser = await getCurrentUser();

  if (currentUser) {
    redirect('/dashboard');
  }

  return (
    <main className="auth-page">
      <section className="card auth-shell">
        <span className="eyebrow">Session Access</span>
        <h1>Sign in to the scanner console.</h1>
        <p className="auth-subtitle">
          Use email/password or link into Google and Steam identities without
          merging them automatically.
        </p>
        <AuthForm mode="login" />
      </section>
    </main>
  );
}
