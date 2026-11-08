// src/web/components/AuditReceiptExport.tsx
import React, { useState } from "react";
import {
  generateAuditReceipt,
  downloadAuditReceipt,
  SecurityAuditReceipt,
  AuditRagCitation,
} from "../../lib/audit/auditReceipt";
import type { DecodedTransaction } from "../../solana/transactionDecoder";
import type { TransactionRiskAssessment } from "../../solana/transactionRiskScore";
import type { Explanation } from "../../gemini/explanation";

export interface AuditReceiptExportProps {
  receipt?: SecurityAuditReceipt;
  base64Tx?: string;
  sha256Hash?: string;
  decodedTx?: DecodedTransaction | null;
  riskAssessment?: TransactionRiskAssessment | null;
  explanation?: Explanation | null;
  ragCitations?: AuditRagCitation[];
  isTampered?: boolean;
  className?: string;
}

export const AuditReceiptExport: React.FC<AuditReceiptExportProps> = ({
  receipt: propReceipt,
  base64Tx = "",
  sha256Hash = "",
  decodedTx,
  riskAssessment,
  explanation,
  ragCitations,
  isTampered = false,
  className = "",
}) => {
  const [downloadedFormat, setDownloadedFormat] = useState<string | null>(null);

  const getReceipt = (): SecurityAuditReceipt => {
    if (propReceipt) return propReceipt;
    return generateAuditReceipt({
      base64Tx,
      sha256Hash,
      decodedTx,
      riskAssessment,
      explanation,
      ragCitations,
      isTampered,
    });
  };

  const handleDownload = (format: "json" | "md") => {
    try {
      const receipt = getReceipt();
      downloadAuditReceipt(receipt, format);
      setDownloadedFormat(format);
      setTimeout(() => setDownloadedFormat(null), 2500);
    } catch (err) {
      console.error("Failed to export audit receipt:", err);
    }
  };

  return (
    <div
      className={`p-3 rounded-lg border border-indigo-200 bg-indigo-50/70 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${className}`}
      data-testid="audit-receipt-export-card"
    >
      <div className="flex items-center gap-2.5">
        <span className="text-xl">📜</span>
        <div>
          <h4 className="text-sm font-bold text-slate-900">
            Export Verifiable Audit Receipt
          </h4>
          <p className="text-xs text-slate-600">
            Self-contained, cryptographically bound security receipt with STRS breakdown, RAG citations, and Gemini audit.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => handleDownload("json")}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-md shadow-xs transition-colors flex items-center gap-1.5"
          data-testid="download-receipt-json-btn"
          title="Download machine-verifiable JSON audit receipt"
        >
          <span>📥</span>
          <span>{downloadedFormat === "json" ? "Downloaded!" : "Export (.JSON)"}</span>
        </button>

        <button
          type="button"
          onClick={() => handleDownload("md")}
          className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-semibold rounded-md shadow-xs transition-colors flex items-center gap-1.5"
          data-testid="download-receipt-md-btn"
          title="Download human-readable GitHub Markdown audit report"
        >
          <span>📝</span>
          <span>{downloadedFormat === "md" ? "Downloaded!" : "Export (.MD)"}</span>
        </button>
      </div>
    </div>
  );
};

export default AuditReceiptExport;
