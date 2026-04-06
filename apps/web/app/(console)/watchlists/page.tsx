import { WatchlistsManager } from '../../components/watchlists-manager';
import { readSearchParam } from '../../lib/search-params';
import { getWatchlists, requireCurrentUser } from '../../lib/server-api';

interface WatchlistsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function WatchlistsPage({
  searchParams,
}: WatchlistsPageProps) {
  await requireCurrentUser();
  const params = await searchParams;
  const watchlists = await getWatchlists();
  const selectedItemVariantId = readSearchParam(params, 'itemVariantId');
  const quickAddItem = selectedItemVariantId
    ? {
        itemVariantId: selectedItemVariantId,
        ...(readSearchParam(params, 'canonicalDisplayName')
          ? {
              canonicalDisplayName: readSearchParam(
                params,
                'canonicalDisplayName',
              ),
            }
          : {}),
        ...(readSearchParam(params, 'variantDisplayName')
          ? {
              variantDisplayName: readSearchParam(params, 'variantDisplayName'),
            }
          : {}),
      }
    : null;

  return (
    <>
      <section className="page-header">
        <div>
          <span className="eyebrow">Watchlists</span>
          <h1>Track scanner targets for follow-up.</h1>
          <p>
            Persist item variants from the opportunity engine into personal
            watchlists and use them as the basis for alert rules later.
          </p>
        </div>
      </section>

      <WatchlistsManager
        initialWatchlists={watchlists?.watchlists ?? []}
        {...(quickAddItem ? { quickAddItem } : {})}
      />
    </>
  );
}
