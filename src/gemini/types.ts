// src/gemini/types.ts
/**
 * Type contracts for Google Gemini Security Explanation Engine in SOLVul.
 */

export interface FindingInput {
  ruleId: string;
  severity: string | number;
  confidence: number;
  explanation: string;
  instructionIndex?: number;
  affectedAccounts: string[];
  evidence: Record<string, unknown>;
}

export interface InstructionInput {
  index: number;
  programId: string;
  programName?: string;
  instructionName?: string;
  accounts: string[];
  decodedData?: Record<string, unknown>;
}

export interface SimulationInput {
  status: string;
  error?: string;
  logs?: string[];
  limitations: string[];
}

export interface RetrievedEvidenceInput {
  documentId: string;
  title: string;
  sourceUrl?: string;
  excerpt: string;
}

/**
 * Structured inspection input passed to Gemini for explanation generation.
 */
export interface GeminiAnalysisInput {
  transactionId?: string;
  transactionHash?: string;
  network?: string;

  riskScore: number;
  riskLevel: string;
  confidence: number;

  findings: FindingInput[];
  instructions: InstructionInput[];
  simulation: SimulationInput;
  retrievedEvidence: RetrievedEvidenceInput[];
}

/**
 * Single critical finding explanation in Gemini output.
 */
export interface CriticalFindingExplanation {
  ruleId: string;
  explanation: string;
  evidenceReferenceIds: string[];
}

/**
 * Reference to a security corpus document in Gemini output.
 */
export interface EvidenceReference {
  documentId: string;
  reason: string;
}

/**
 * Validated, structured explanation produced by Gemini.
 */
export interface GeminiExplanation {
  transactionSummary: string;
  riskExplanation: string;
  criticalFindings: CriticalFindingExplanation[];
  affectedAssets: string[];
  securityConcerns: string[];
  recommendedActions: string[];
  simulationInterpretation: string;
  limitations: string[];
  evidenceReferences: EvidenceReference[];

  // Engine metadata
  isFallback: boolean;
  modelUsed?: string;
  disagreementsWithSTRS?: string[];
  diagnosticMessage?: string;
}
