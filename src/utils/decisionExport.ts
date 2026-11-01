import type { CurveType } from '@paretomol/core';

export interface DecisionExportInput {
  kind: 'review' | 'workspace';
  /** Profile selected on the MPO tab. */
  profileRef: string;
  /** Curve selected on the MPO tab. */
  curve: CurveType;
  /** Profile carried by a review link. Used only for a review export. */
  reviewProfile?: string;
  admetColumns: number;
  admetEndpoint: string;
}

export interface DecisionExportFields {
  profile: string;
  curve: CurveType;
  admetEndpoint: string | null;
}

/**
 * What a decision-record export should store.
 * The workspace export uses the MPO tab's profile and curve.
 * A review export keeps the link's profile and the linear curve the review
 * panel scores with, and records the ADMET endpoint whenever ADMET columns exist.
 */
export function decisionExportFields(o: DecisionExportInput): DecisionExportFields {
  const admetEndpoint = o.admetColumns > 0 ? o.admetEndpoint : null;
  if (o.kind === 'review') {
    return { profile: o.reviewProfile || 'oral@1', curve: 'linear', admetEndpoint };
  }
  return { profile: o.profileRef || 'oral@1', curve: o.curve, admetEndpoint };
}
