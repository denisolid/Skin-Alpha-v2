import { BlockedCandidatesDebugPanel } from './blocked-candidates-debug-panel';
import type { OpportunityRejectDiagnosticsPage } from '../lib/types';

interface AdminRejectDiagnosticsSectionProps {
  readonly rejectDiagnosticsPromise: Promise<OpportunityRejectDiagnosticsPage | null>;
}

export async function AdminRejectDiagnosticsSection({
  rejectDiagnosticsPromise,
}: AdminRejectDiagnosticsSectionProps) {
  const rejectDiagnostics = await rejectDiagnosticsPromise;

  if (!rejectDiagnostics || rejectDiagnostics.items.length === 0) {
    return null;
  }

  return <BlockedCandidatesDebugPanel rejectDiagnostics={rejectDiagnostics} />;
}

export function AdminRejectDiagnosticsFallback() {
  return (
    <section className="panel card">
      <div className="stack-row">
        <div>
          <h2>Blocked Pair Samples</h2>
          <p className="panel-subtitle">
            Loading rejected-pair diagnostics after the feed has rendered.
          </p>
        </div>
        <span className="badge">Loading</span>
      </div>
      <div className="callout">
        The feed is ready. Rejected-pair diagnostics are being fetched
        separately so empty admin views do not block initial render.
      </div>
    </section>
  );
}
