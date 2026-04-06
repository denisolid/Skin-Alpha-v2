import { ItemCategory } from '@prisma/client';

import { OpportunityEnginePolicyService } from '../src/modules/opportunities/services/opportunity-engine-policy.service';

describe('OpportunityEnginePolicyService', () => {
  it('keeps positive but sub-threshold confidence spreads visible as candidates', () => {
    const service = new OpportunityEnginePolicyService();

    const result = service.classifyOpportunity({
      category: ItemCategory.SKIN,
      expectedNetProfit: 12.4,
      rawSpreadPercent: 8.1,
      finalConfidence: 0.27,
      antiFakeAssessment: {
        hardReject: false,
        riskScore: 0.18,
        matchConfidence: 0.72,
        premiumContaminationRisk: 0,
        marketSanityRisk: 0.12,
        confirmationScore: 0,
        reasonCodes: ['LOW_SOURCE_CONFIDENCE'],
      },
      penalties: {
        freshnessPenalty: 0.01,
        liquidityPenalty: 0.11,
        stalePenalty: 0,
        categoryPenalty: 0.035,
        sourceDisagreementPenalty: 0.18,
        backupConfirmationBoost: 0,
        totalPenalty: 0.335,
      },
      reasonCodes: ['source_disagreement_penalty_elevated'],
    });

    expect(result.disposition).toBe('candidate');
    expect(result.reasonCodes).toContain('confidence_below_candidate_floor');
  });

  it('still rejects extremely low-confidence spreads', () => {
    const service = new OpportunityEnginePolicyService();

    const result = service.classifyOpportunity({
      category: ItemCategory.SKIN,
      expectedNetProfit: 12.4,
      rawSpreadPercent: 8.1,
      finalConfidence: 0.08,
      antiFakeAssessment: {
        hardReject: false,
        riskScore: 0.82,
        matchConfidence: 0.36,
        premiumContaminationRisk: 0.2,
        marketSanityRisk: 0.48,
        confirmationScore: 0,
        reasonCodes: ['LOW_MATCH_CONFIDENCE', 'LOW_SOURCE_CONFIDENCE'],
      },
      penalties: {
        freshnessPenalty: 0.01,
        liquidityPenalty: 0.11,
        stalePenalty: 0.04,
        categoryPenalty: 0.035,
        sourceDisagreementPenalty: 0.18,
        backupConfirmationBoost: 0,
        totalPenalty: 0.375,
      },
      reasonCodes: ['source_disagreement_penalty_elevated'],
    });

    expect(result.disposition).toBe('rejected');
    expect(result.reasonCodes).toContain('confidence_below_candidate_floor');
  });

  it('downgrades severe anti-fake risk into risky high upside instead of normal eligible', () => {
    const service = new OpportunityEnginePolicyService();

    const result = service.classifyOpportunity({
      category: ItemCategory.KNIFE,
      expectedNetProfit: 68,
      rawSpreadPercent: 11.4,
      finalConfidence: 0.41,
      antiFakeAssessment: {
        hardReject: false,
        riskScore: 0.61,
        matchConfidence: 0.74,
        premiumContaminationRisk: 0.42,
        marketSanityRisk: 0.37,
        confirmationScore: 0,
        reasonCodes: ['UNKNOWN_PHASE_PREMIUM', 'NO_CONFIRMING_SOURCE'],
      },
      penalties: {
        freshnessPenalty: 0.02,
        liquidityPenalty: 0.06,
        stalePenalty: 0.03,
        categoryPenalty: 0.075,
        sourceDisagreementPenalty: 0.04,
        backupConfirmationBoost: 0,
        totalPenalty: 0.225,
      },
      reasonCodes: ['UNKNOWN_PHASE_PREMIUM', 'NO_CONFIRMING_SOURCE'],
    });

    expect(result.disposition).toBe('risky_high_upside');
    expect(result.reasonCodes).toContain('high_upside_with_elevated_risk');
  });
});
