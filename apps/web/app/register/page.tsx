import { redirect } from 'next/navigation';

import { AuthForm } from '../components/auth-form';
import { getCurrentUser } from '../lib/server-api';

export default async function RegisterPage() {
  const currentUser = await getCurrentUser();

  if (currentUser) {
    redirect('/dashboard');
  }

  return (
    <main className="auth-page">
      <section className="card auth-shell">
        <span className="eyebrow">Create Account</span>
        <h1>Register a new SkinAlpha workspace session.</h1>
        <p className="auth-subtitle">
          Email delivery is not wired yet, but registration, session cookies,
          and identity linking are ready in the backend.
        </p>
        <AuthForm mode="register" />
      </section>
    </main>
  );
}
