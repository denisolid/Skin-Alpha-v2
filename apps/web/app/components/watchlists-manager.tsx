'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { browserApiRequest } from '../lib/browser-api';
import type { Watchlist } from '../lib/types';

interface WatchlistsManagerProps {
  readonly initialWatchlists: readonly Watchlist[];
  readonly quickAddItem?: {
    readonly itemVariantId: string;
    readonly canonicalDisplayName?: string | undefined;
    readonly variantDisplayName?: string | undefined;
  };
}

export function WatchlistsManager({
  initialWatchlists,
  quickAddItem,
}: WatchlistsManagerProps) {
  const router = useRouter();
  const [activeWatchlistId, setActiveWatchlistId] = useState(
    initialWatchlists[0]?.id ?? '',
  );
  const [newWatchlistName, setNewWatchlistName] = useState('');
  const [newWatchlistDescription, setNewWatchlistDescription] = useState('');
  const [addNotes, setAddNotes] = useState('');
  const [scopeKey, setScopeKey] = useState('all');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const activeWatchlist =
    initialWatchlists.find((watchlist) => watchlist.id === activeWatchlistId) ??
    initialWatchlists[0] ??
    null;

  function refreshWithSuccess(message: string) {
    setStatusMessage(message);
    setErrorMessage(null);
    router.refresh();
  }

  async function createWatchlist(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction('create');
    setErrorMessage(null);

    try {
      await browserApiRequest<Watchlist>('/watchlists', {
        method: 'POST',
        body: {
          name: newWatchlistName,
          ...(newWatchlistDescription.trim().length > 0
            ? { description: newWatchlistDescription.trim() }
            : {}),
        },
      });

      setNewWatchlistName('');
      setNewWatchlistDescription('');
      refreshWithSuccess('Watchlist created.');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to create watchlist.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function quickAddToWatchlist() {
    if (!quickAddItem || !activeWatchlist) {
      return;
    }

    setBusyAction('add');
    setErrorMessage(null);

    try {
      await browserApiRequest<Watchlist>(
        `/watchlists/${activeWatchlist.id}/items`,
        {
          method: 'POST',
          body: {
            itemVariantId: quickAddItem.itemVariantId,
            scopeKey,
            ...(addNotes.trim().length > 0 ? { notes: addNotes.trim() } : {}),
          },
        },
      );

      setAddNotes('');
      refreshWithSuccess('Item added to watchlist.');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to add item.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function removeWatchlistItem(
    watchlistId: string,
    watchlistItemId: string,
  ) {
    setBusyAction(`remove:${watchlistItemId}`);
    setErrorMessage(null);

    try {
      await browserApiRequest<Watchlist>(
        `/watchlists/${watchlistId}/items/${watchlistItemId}`,
        {
          method: 'DELETE',
        },
      );

      refreshWithSuccess('Watchlist item removed.');
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to remove watchlist item.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteWatchlist(watchlistId: string) {
    setBusyAction(`delete:${watchlistId}`);
    setErrorMessage(null);

    try {
      await browserApiRequest<void>(`/watchlists/${watchlistId}`, {
        method: 'DELETE',
      });

      refreshWithSuccess('Watchlist deleted.');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to delete watchlist.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="watchlist-shell">
      {statusMessage ? (
        <div className="form-success">{statusMessage}</div>
      ) : null}
      {errorMessage ? <div className="form-error">{errorMessage}</div> : null}

      <div className="watchlist-grid">
        <section className="panel card">
          <div className="stack-row">
            <div>
              <h2>Watchlists</h2>
              <p className="panel-subtitle">
                Select a list to inspect tracked items and remove stale entries.
              </p>
            </div>
          </div>

          <div className="stack-list">
            {initialWatchlists.length === 0 ? (
              <div className="empty-state">
                No watchlists yet. Create one to start tracking scanner targets.
              </div>
            ) : (
              initialWatchlists.map((watchlist) => (
                <div
                  key={watchlist.id}
                  className={`stack-item${
                    activeWatchlist?.id === watchlist.id
                      ? ' stack-item-active'
                      : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveWatchlistId(watchlist.id);
                    }}
                  >
                    <div className="stack-item-header">
                      <strong>{watchlist.name}</strong>
                      <span className="badge">{watchlist.itemCount} items</span>
                    </div>
                    <p className="meta-text">
                      {watchlist.description || 'No description provided.'}
                    </p>
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel card">
          <div className="stack-row">
            <div>
              <h2>Create Watchlist</h2>
              <p className="panel-subtitle">
                Keep separate lists for trade focus, research, and manual
                review.
              </p>
            </div>
          </div>

          <form
            className="stack-form"
            onSubmit={(event) => {
              void createWatchlist(event);
            }}
          >
            <div className="field">
              <label htmlFor="watchlistName">Name</label>
              <input
                id="watchlistName"
                placeholder="High conviction knives"
                required
                value={newWatchlistName}
                onChange={(event) => {
                  setNewWatchlistName(event.target.value);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="watchlistDescription">Description</label>
              <textarea
                id="watchlistDescription"
                placeholder="Optional context for this list"
                value={newWatchlistDescription}
                onChange={(event) => {
                  setNewWatchlistDescription(event.target.value);
                }}
              />
            </div>
            <button
              className="button-primary"
              disabled={busyAction === 'create'}
              type="submit"
            >
              {busyAction === 'create' ? 'Creating...' : 'Create Watchlist'}
            </button>
          </form>
        </section>
      </div>

      {quickAddItem ? (
        <section className="panel card">
          <h2>Quick Add From Opportunity</h2>
          <p className="panel-subtitle">
            {quickAddItem.variantDisplayName ?? 'Selected item'} /{' '}
            {quickAddItem.canonicalDisplayName ?? 'Opportunity context'}
          </p>

          {activeWatchlist ? (
            <div className="stack-form">
              <div className="field">
                <label htmlFor="scopeKey">Scope</label>
                <select
                  id="scopeKey"
                  value={scopeKey}
                  onChange={(event) => {
                    setScopeKey(event.target.value);
                  }}
                >
                  <option value="all">All sources</option>
                  <option value="scanner">Scanner review</option>
                  <option value="manual">Manual review</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="addNotes">Notes</label>
                <textarea
                  id="addNotes"
                  placeholder="Optional watch note"
                  value={addNotes}
                  onChange={(event) => {
                    setAddNotes(event.target.value);
                  }}
                />
              </div>
              <button
                className="button-primary"
                disabled={busyAction === 'add'}
                type="button"
                onClick={() => {
                  void quickAddToWatchlist();
                }}
              >
                {busyAction === 'add'
                  ? 'Adding...'
                  : `Add To ${activeWatchlist.name}`}
              </button>
            </div>
          ) : (
            <div className="empty-state">
              Create a watchlist first, then add the selected item.
            </div>
          )}
        </section>
      ) : null}

      <section className="panel card">
        <div className="stack-row">
          <div>
            <h2>{activeWatchlist?.name ?? 'Active Watchlist'}</h2>
            <p className="panel-subtitle">
              {activeWatchlist?.description || 'Tracked items for this list.'}
            </p>
          </div>

          {activeWatchlist ? (
            <button
              className="button-ghost"
              disabled={busyAction === `delete:${activeWatchlist.id}`}
              type="button"
              onClick={() => {
                void deleteWatchlist(activeWatchlist.id);
              }}
            >
              {busyAction === `delete:${activeWatchlist.id}`
                ? 'Deleting...'
                : 'Delete Watchlist'}
            </button>
          ) : null}
        </div>

        {activeWatchlist && activeWatchlist.items.length > 0 ? (
          <div className="watchlist-items">
            {activeWatchlist.items.map((item) => (
              <div key={item.id} className="watchlist-item-card">
                <div className="stack-item-header">
                  <div>
                    <strong>{item.variantDisplayName}</strong>
                    <p className="meta-text">{item.canonicalDisplayName}</p>
                  </div>
                  <button
                    className="button-ghost"
                    disabled={busyAction === `remove:${item.id}`}
                    type="button"
                    onClick={() => {
                      void removeWatchlistItem(activeWatchlist.id, item.id);
                    }}
                  >
                    {busyAction === `remove:${item.id}`
                      ? 'Removing...'
                      : 'Remove'}
                  </button>
                </div>
                <p className="meta-text">
                  {item.category} / Scope {item.scopeKey}
                  {item.source ? ` / ${item.source.name}` : ''}
                </p>
                {item.notes ? <p className="meta-text">{item.notes}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            {activeWatchlist
              ? 'This watchlist has no items yet.'
              : 'Choose a watchlist to inspect its items.'}
          </div>
        )}
      </section>
    </div>
  );
}
