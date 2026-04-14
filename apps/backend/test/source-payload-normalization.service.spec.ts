import type { ArchivedRawPayloadDto } from '../src/modules/source-adapters/dto/archived-raw-payload.dto';
import { SourcePayloadNormalizationService } from '../src/modules/source-adapters/services/source-payload-normalization.service';

describe('SourcePayloadNormalizationService', () => {
  it.each([
    'skinport-sales-history',
    'skinport-items-snapshot',
    'bitskins-listings',
  ] as const)(
    'skips duplicate unchanged %s payloads that were already normalized',
    async (endpointName) => {
    const archive: ArchivedRawPayloadDto = {
      id: 'archive-1',
      sourceId: 'source-1',
      source: endpointName === 'bitskins-listings' ? 'bitskins' : 'skinport',
      endpointName,
      observedAt: new Date('2026-04-11T18:23:33.929Z'),
      entityType: 'SOURCE_SYNC',
      entityId: `${endpointName}:hash-1`,
      payload: [],
      payloadHash: 'hash-1',
      fetchedAt: new Date('2026-04-11T18:23:34.000Z'),
      archivedAt: new Date('2026-04-11T18:23:36.000Z'),
    };
    const rawPayloadArchiveService = {
      getArchivedPayloadById: jest.fn().mockResolvedValue(archive),
      findPreviouslyNormalizedEquivalentArchive: jest
        .fn()
        .mockResolvedValue({
          id: 'previous-archive-1',
        }),
    };
    const bitSkinsPayloadNormalizerService = {
      normalize: jest.fn(),
    };
    const skinportPayloadNormalizerService = {
      normalize: jest.fn(),
    };
    const waxpeerPayloadNormalizerService = {
      normalize: jest.fn(),
    };
    const service = new SourcePayloadNormalizationService(
      {
        log: jest.fn(),
        error: jest.fn(),
      } as never,
      rawPayloadArchiveService as never,
      bitSkinsPayloadNormalizerService as never,
      {} as never,
      {} as never,
      waxpeerPayloadNormalizerService as never,
      {} as never,
      skinportPayloadNormalizerService as never,
      {} as never,
    );

    const result = await service.normalizeArchivedPayload({
      rawPayloadArchiveId: archive.id,
      source: archive.source,
    });

    expect(
      rawPayloadArchiveService.findPreviouslyNormalizedEquivalentArchive,
    ).toHaveBeenCalledWith(archive);
    expect(bitSkinsPayloadNormalizerService.normalize).not.toHaveBeenCalled();
    expect(skinportPayloadNormalizerService.normalize).not.toHaveBeenCalled();
    expect(result.listings).toEqual([]);
    expect(result.marketStates).toEqual([]);
    expect(result.warnings).toEqual([
      expect.stringContaining(`Skipped unchanged ${archive.source}:${endpointName}`),
    ]);
    expect(result.equivalentMarketStateSourceArchiveId).toBe('previous-archive-1');
    expect(result.fetchJobId).toBeUndefined();
    expect(result.normalizedAt).toBeInstanceOf(Date);
    },
  );
});
