import { AuthProviderButtons } from '../../../components/auth-provider-buttons';
import { formatDateTime } from '../../../lib/format';
import { requireCurrentUser } from '../../../lib/server-api';

export default async function AccountSettingsPage() {
  const currentUser = await requireCurrentUser();

  return (
    <>
      <section className="page-header">
        <div>
          <span className="eyebrow">Account Settings</span>
          <h1>Identity and session configuration.</h1>
          <p>
            Review linked identities and connect Google or Steam without
            automatically merging providers.
          </p>
        </div>
      </section>

      <section className="page-grid-two">
        <article className="panel card">
          <h2>Profile</h2>
          <p className="panel-subtitle">
            Basic account information from the authenticated session.
          </p>

          <div className="detail-list">
            <div className="detail-card">
              <strong>Email</strong>
              <p className="meta-text">{currentUser.email ?? 'No email set'}</p>
            </div>
            <div className="detail-card">
              <strong>Display Name</strong>
              <p className="meta-text">
                {currentUser.displayName ?? 'No display name configured'}
              </p>
            </div>
            <div className="detail-card">
              <strong>Role and Status</strong>
              <p className="meta-text">
                {currentUser.role} / {currentUser.status}
              </p>
            </div>
          </div>
        </article>

        <article className="panel card">
          <h2>Linked Identities</h2>
          <p className="panel-subtitle">
            Provider identities remain explicit and unmerged unless you link
            them.
          </p>

          <div className="identity-list">
            {currentUser.identities.map((identity) => (
              <div key={identity.id} className="identity-card">
                <strong>{identity.provider}</strong>
                <p className="meta-text">
                  {identity.email ?? 'No provider email'} / last auth{' '}
                  {formatDateTime(identity.lastAuthenticatedAt ?? undefined)}
                </p>
              </div>
            ))}
          </div>

          <div className="auth-divider">
            <span>link another provider</span>
          </div>

          <AuthProviderButtons intent="link" />
        </article>
      </section>
    </>
  );
}
