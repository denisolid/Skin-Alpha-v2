'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  bootstrapCatalog,
  rebuildMarketState,
  rescanOpportunities,
  syncAllSources,
  syncSource,
} from '../lib/browser-api';
import type {
  CatalogBootstrapResult,
  CurrentUser,
  MarketStateRebuildResult,
  OpportunityRescanResult,
  SourceSyncAccepted,
  SourceSyncBatchAccepted,
} from '../lib/types';

type StartupAction =
  | 'catalog-bootstrap'
  | 'sync-skinport'
  | 'sync-csfloat'
  | 'sync-dmarket'
  | 'sync-waxpeer'
  | 'sync-steam'
  | 'sync-all'
  | 'market-state-rebuild'
  | 'opportunities-rescan';

type StartupResult =
  | CatalogBootstrapResult
  | SourceSyncAccepted
  | SourceSyncBatchAccepted
  | MarketStateRebuildResult
  | OpportunityRescanResult;

interface StartupHistoryEntry {
  readonly action: StartupAction;
  readonly completedAt: string;
  readonly result: StartupResult;
}

interface AdminMarketStartupPanelProps {
  readonly user: Pick<CurrentUser, 'role'>;
}

const startupSteps = [
  '1. Bootstrap the controlled catalog once.',
  '2. Enqueue parser jobs to fetch raw market payloads.',
  '3. Let workers archive, normalize, and project market state.',
  '4. Rebuild latest market state if you need a full projection sweep.',
  '5. Rescan opportunities from internal normalized market state only.',
] as const;

export function AdminMarketStartupPanel({
  user,
}: AdminMarketStartupPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<StartupAction | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly StartupHistoryEntry[]>([]);

  if (user.role !== 'ADMIN') {
    return (
      <section className="panel card">
        <h2>Admin Startup</h2>
        <p className="panel-subtitle">
          Market startup actions are available only to administrator accounts.
        </p>
        <div className="callout">
          This account currently has the <strong>{user.role}</strong> role, so
          catalog bootstrap and source sync actions are hidden here.
        </div>
      </section>
    );
  }

  function runAction(
    action: StartupAction,
    execute: () => Promise<StartupResult>,
    successMessage: string,
  ) {
    setActiveAction(action);
    setErrorMessage(null);
    setStatusMessage(null);

    startTransition(() => {
      void execute()
        .then((result) => {
          setHistory((currentHistory) => [
            {
              action,
              completedAt: new Date().toISOString(),
              result,
            },
            ...currentHistory,
          ]);
          setStatusMessage(successMessage);
          router.refresh();
        })
        .catch((error: unknown) => {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Admin startup action failed.',
          );
        })
        .finally(() => {
          setActiveAction(null);
        });
    });
  }

  return (
    <section className="panel card admin-startup-panel">
      <div className="stack-row">
        <div>
          <h2>Admin Startup</h2>
          <p className="panel-subtitle">
            Bootstrap the market, enqueue source syncs, rebuild internal state,
            and rescan opportunities from the browser.
          </p>
        </div>
        <span className="badge">Admin only</span>
      </div>

      <div className="callout">
        Source sync actions enqueue jobs only. Rebuild and rescan should be run
        after the queued sync workers have finished.
      </div>

      <div className="stack-list">
        {startupSteps.map((step) => (
          <div key={step} className="detail-card">
            <p className="meta-text">{step}</p>
          </div>
        ))}
      </div>

      {statusMessage ? (
        <div className="form-success">{statusMessage}</div>
      ) : null}
      {errorMessage ? <div className="form-error">{errorMessage}</div> : null}

      <div className="admin-actions-grid">
        <button
          className="button-primary"
          disabled={isPending}
          type="button"
          onClick={() => {
            runAction(
              'catalog-bootstrap',
              () => bootstrapCatalog(),
              'Catalog bootstrap completed.',
            );
          }}
        >
          {activeAction === 'catalog-bootstrap' && isPending
            ? 'Bootstrapping...'
            : 'Bootstrap Catalog'}
        </button>

        <button
          className="button-secondary"
          disabled={isPending}
          type="button"
          onClick={() => {
            runAction(
              'sync-skinport',
              () => syncSource('skinport'),
              'Skinport sync accepted.',
            );
          }}
        >
          {activeAction === 'sync-skinport' && isPending
            ? 'Queueing...'
            : 'Sync Skinport'}
        </button>

        <button
          className="button-secondary"
          disabled={isPending}
          type="button"
          onClick={() => {
            runAction(
              'sync-csfloat',
              () => syncSource('csfloat'),
              'CSFloat sync accepted.',
            );
          }}
        >
          {activeAction === 'sync-csfloat' && isPending
            ? 'Queueing...'
            : 'Sync CSFloat'}
        </button>

        <button
          className="button-secondary"
          disabled={isPending}
          type="button"
          onClick={() => {
            runAction(
              'sync-dmarket',
              () => syncSource('dmarket'),
              'DMarket sync accepted.',
            );
          }}
        >
          {activeAction === 'sync-dmarket' && isPending
            ? 'Queueing...'
            : 'Sync DMarket'}
        </button>

        <button
          className="button-secondary"
          disabled={isPending}
          type="button"
          onClick={() => {
            runAction(
              'sync-waxpeer',
              () => syncSource('waxpeer'),
              'Waxpeer sync accepted.',
            );
          }}
        >
          {activeAction === 'sync-waxpeer' && isPending
            ? 'Queueing...'
            : 'Sync Waxpeer'}
        </button>

        <button
          className="button-secondary"
          disabled={isPending}
          type="button"
          onClick={() => {
            runAction(
              'sync-steam',
              () => syncSource('steam-snapshot'),
              'Steam snapshot sync accepted.',
            );
          }}
        >
          {activeAction === 'sync-steam' && isPending
            ? 'Queueing...'
            : 'Sync Steam'}
        </button>

        <button
          className="button-primary"
          disabled={isPending}
          type="button"
          onClick={() => {
            runAction(
              'sync-all',
              () => syncAllSources(),
              'All source syncs accepted.',
            );
          }}
        >
          {activeAction === 'sync-all' && isPending
            ? 'Queueing...'
            : 'Sync All Sources'}
        </button>

        <button
          className="button-secondary"
          disabled={isPending}
          type="button"
          onClick={() => {
            runAction(
              'market-state-rebuild',
              () => rebuildMarketState(),
              'Market state rebuild completed.',
            );
          }}
        >
          {activeAction === 'market-state-rebuild' && isPending
            ? 'Rebuilding...'
            : 'Rebuild Market State'}
        </button>

        <button
          className="button-secondary"
          disabled={isPending}
          type="button"
          onClick={() => {
            runAction(
              'opportunities-rescan',
              () => rescanOpportunities(),
              'Opportunity rescan completed.',
            );
          }}
        >
          {activeAction === 'opportunities-rescan' && isPending
            ? 'Rescanning...'
            : 'Rescan Opportunities'}
        </button>
      </div>

      <div className="stack-list">
        {history.length === 0 ? (
          <div className="empty-state">
            No admin startup actions have been run in this browser session yet.
          </div>
        ) : (
          history.map((entry) => (
            <article
              key={`${entry.action}:${entry.completedAt}`}
              className="detail-card"
            >
              <div className="stack-item-header">
                <strong>{entry.action}</strong>
                <span className="badge">
                  {new Date(entry.completedAt).toLocaleTimeString()}
                </span>
              </div>
              <pre className="admin-response-block">
                {JSON.stringify(entry.result, null, 2)}
              </pre>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
