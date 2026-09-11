/**
 * The proprietary severity rubric. In the deployed workflow this is a secret
 * input fetched inside the TEE, so node operators never see the scoring policy.
 * Kept in code here only so local simulation and the orchestrator fallback can
 * run; treat it as confidential.
 */
export interface RubricRule {
  category: string;
  weight: number;
  denyThreshold: number;
}

export const AUDIT_RUBRIC: RubricRule[] = [
  { category: "Sensitive data exposure", weight: 1.0, denyThreshold: 8 },
  { category: "Access control", weight: 0.95, denyThreshold: 8 },
  { category: "Transport security", weight: 0.7, denyThreshold: 9 },
  { category: "Information disclosure", weight: 0.5, denyThreshold: 9 },
  { category: "Reliability and disclosure", weight: 0.4, denyThreshold: 9.5 },
  { category: "General", weight: 0.6, denyThreshold: 9 },
];

export function ruleFor(category: string): RubricRule {
  return AUDIT_RUBRIC.find((r) => r.category === category) ?? AUDIT_RUBRIC[AUDIT_RUBRIC.length - 1];
}
