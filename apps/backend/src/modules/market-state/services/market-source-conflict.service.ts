import { Injectable } from '@nestjs/common';

import type {
  MarketConflictState,
  MarketConflictSummaryDto,
  MergedMarketMatrixRowDto,
} from '../dto/merged-market-matrix.dto';

interface RowConflictDetail {
  readonly state: Exclude<MarketConflictState, 'insufficient-data'>;
  readonly deviationPercent: number;
}

interface MarketConflictAnalysis {
  readonly summary: MarketConflictSummaryDto;
  readonly rowDetails: ReadonlyMap<string, RowConflictDetail>;
}

@Injectable()
export class MarketSourceConflictService {
  analyze(rows: readonly MergedMarketMatrixRowDto[]): MarketConflictAnalysis {
    const pricedRows = rows.filter(
      (row) =>
        row.ask !== undefined && row.freshness.usable && row.confidence > 0,
    );
    const consensusRows =
      pricedRows.filter((row) => row.fetchMode !== 'backup').length >= 2
        ? pricedRows.filter((row) => row.fetchMode !== 'backup')
        : pricedRows;

    if (consensusRows.length < 2) {
      return {
        summary: {
          state: 'insufficient-data',
          comparedSourceCount: consensusRows.length,
          usableSourceCount: pricedRows.length,
        },
        rowDetails: new Map<string, RowConflictDetail>(),
      };
    }

    const asks = consensusRows
      .map((row) => row.ask)
      .filter((value): value is number => value !== undefined)
      .sort((left, right) => left - right);
    const consensusAsk = this.median(asks);
    const minAsk = asks[0]!;
    const maxAsk = asks[asks.length - 1]!;
    const safeConsensusAsk = Math.max(consensusAsk, Number.EPSILON);
    const spreadPercent = this.toPercent((maxAsk - minAsk) / safeConsensusAsk);
    const rowDetails = new Map<string, RowConflictDetail>();

    for (const row of pricedRows) {
      if (row.ask === undefined) {
        continue;
      }

      const deviationPercent = this.toPercent(
        Math.abs(row.ask - consensusAsk) / safeConsensusAsk,
      );
      const state = this.resolveConflictState(deviationPercent);

      rowDetails.set(row.source, {
        state,
        deviationPercent,
      });
    }

    return {
      summary: {
        state: this.resolveConflictState(spreadPercent),
        comparedSourceCount: consensusRows.length,
        usableSourceCount: pricedRows.length,
        consensusAsk,
        minAsk,
        maxAsk,
        spreadPercent,
      },
      rowDetails,
    };
  }

  resolveConfidenceMultiplier(state: MarketConflictState | undefined): number {
    switch (state) {
      case 'aligned':
        return 1;
      case 'divergent':
        return 0.92;
      case 'conflicted':
        return 0.8;
      case 'insufficient-data':
      case undefined:
        return 1;
    }
  }

  private resolveConflictState(
    deviationPercent: number,
  ): Exclude<MarketConflictState, 'insufficient-data'> {
    if (deviationPercent <= 3) {
      return 'aligned';
    }

    if (deviationPercent <= 10) {
      return 'divergent';
    }

    return 'conflicted';
  }

  private median(values: readonly number[]): number {
    const middleIndex = Math.floor(values.length / 2);

    if (values.length % 2 === 1) {
      return values[middleIndex]!;
    }

    return (values[middleIndex - 1]! + values[middleIndex]!) / 2;
  }

  private toPercent(value: number): number {
    return Number((value * 100).toFixed(2));
  }
}
