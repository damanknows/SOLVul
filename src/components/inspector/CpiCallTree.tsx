// src/components/inspector/CpiCallTree.tsx
import React, { useState } from "react";
import type { CpiCallNode } from "./types";
import { parseCpiCallTree } from "./cpiParser";
import type { DecodedTransaction } from "../../solana/transactionDecoder";
import type { SimulationResult } from "../../solana/simulateTransaction";
import type { RuleResult } from "../../solana/transactionRiskScore";

export interface CpiCallTreeProps {
  nodes?: CpiCallNode[];
  decoded?: DecodedTransaction | null;
  simulation?: SimulationResult | null;
  findings?: RuleResult[];
  className?: string;
}

interface TreeNodeProps {
  node: CpiCallNode;
  isLast?: boolean;
}

const CpiTreeNode: React.FC<TreeNodeProps> = ({ node }) => {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children && node.children.length > 0;

  const truncate = (str: string, len = 12) => {
    if (!str) return "";
    if (str.length <= len) return str;
    return `${str.slice(0, 4)}…${str.slice(-4)}`;
  };

  return (
    <div
      className={`relative my-2 text-xs font-mono transition-all ${
        node.depth > 0 ? "ml-4 pl-4 border-l-2 border-indigo-200" : ""
      }`}
      data-testid={`cpi-node-${node.id}`}
    >
      <div
        className={`p-3 rounded-lg border shadow-xs transition-colors ${
          node.isSignerEscalation || node.isWritableEscalation
            ? "bg-amber-50/70 border-amber-300"
            : node.status === "failed"
            ? "bg-red-50/70 border-red-200"
            : "bg-white border-slate-200 hover:border-slate-300"
        }`}
      >
        {/* Node Header: Caller -> Callee */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Depth Badge */}
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                node.depth === 0
                  ? "bg-slate-100 text-slate-700 border border-slate-300"
                  : node.depth === 1
                  ? "bg-indigo-100 text-indigo-800 border border-indigo-200"
                  : "bg-purple-100 text-purple-800 border border-purple-200"
              }`}
            >
              {node.depth === 0 ? "Top-Level" : `Depth ${node.depth} CPI`}
            </span>

            {/* Caller -> Callee flow */}
            <span
              className="text-slate-600 font-medium"
              title={node.callerProgramId}
            >
              {node.callerProgramName || truncate(node.callerProgramId)}
            </span>
            <span className="text-slate-400 font-bold">➜</span>
            <span
              className="text-slate-900 font-bold bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200"
              title={node.calleeProgramId}
            >
              {node.calleeProgramName || truncate(node.calleeProgramId)}
            </span>

            {/* Instruction Name */}
            <span className="text-indigo-600 font-semibold ml-1">
              {node.instructionName}
            </span>

            {/* Discriminator if available */}
            {node.discriminator && (
              <span className="text-[10px] text-slate-500 bg-slate-50 px-1 py-0.5 rounded border border-slate-200">
                {node.discriminator}
              </span>
            )}
          </div>

          {/* Status & Collapsible toggle */}
          <div className="flex items-center gap-2">
            {hasChildren && (
              <button
                type="button"
                onClick={() => setCollapsed(!collapsed)}
                className="px-2 py-0.5 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded border border-slate-300 transition-colors"
                aria-label={collapsed ? "Expand CPI invocations" : "Collapse CPI invocations"}
              >
                {collapsed ? `+ ${node.children.length} CPIs` : "− Collapse"}
              </button>
            )}
          </div>
        </div>

        {/* Badges: Privilege Escalations & Triggered VS-* Rules */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {/* Privilege Escalation Badges */}
          {node.isSignerEscalation && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-800 text-[10px] font-bold rounded-full border border-red-300"
              data-testid="signer-escalation-badge"
            >
              ⚠️ Signer Escalation
            </span>
          )}

          {node.isWritableEscalation && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded-full border border-amber-300"
              data-testid="writable-escalation-badge"
            >
              ⚠️ Writable Escalation
            </span>
          )}

          {/* Triggered STRS Rules Badges */}
          {node.triggeredRules && node.triggeredRules.length > 0 && (
            <div className="inline-flex items-center gap-1">
              {node.triggeredRules.map((ruleId) => (
                <span
                  key={ruleId}
                  className="px-1.5 py-0.2 bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold rounded"
                  title={`Triggered Rule: ${ruleId}`}
                  data-testid={`rule-badge-${ruleId}`}
                >
                  {ruleId}
                </span>
              ))}
            </div>
          )}

          {/* Accounts Count */}
          {node.accounts && node.accounts.length > 0 && (
            <span className="text-[10px] text-slate-500">
              {node.accounts.length} account{node.accounts.length > 1 ? "s" : ""} (
              {node.accounts.filter((a) => a.isSigner).length} signers,{" "}
              {node.accounts.filter((a) => a.isWritable).length} writable)
            </span>
          )}
        </div>
      </div>

      {/* Children CPI Calls */}
      {hasChildren && !collapsed && (
        <div className="mt-1">
          {node.children.map((child, idx) => (
            <CpiTreeNode
              key={child.id || `cpi-${child.depth}-${idx}`}
              node={child}
              isLast={idx === node.children.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const CpiCallTree: React.FC<CpiCallTreeProps> = ({
  nodes: propNodes,
  decoded,
  simulation,
  findings = [],
  className = "",
}) => {
  const nodes = propNodes || parseCpiCallTree(decoded, simulation, findings);

  if (!nodes || nodes.length === 0) {
    return (
      <div
        className={`p-4 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 text-sm ${className}`}
        data-testid="cpi-tree-empty"
      >
        No instructions or CPI calls detected in this transaction.
      </div>
    );
  }

  const totalCpiHops = nodes.reduce(
    (acc, n) => acc + countDescendants(n),
    0,
  );

  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white p-4 shadow-xs ${className}`}
      data-testid="cpi-call-tree"
    >
      <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-slate-200 gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base">🌳</span>
          <h3 className="font-bold text-sm text-slate-900">
            Inner CPI Execution Tree
          </h3>
          <span className="text-xs text-slate-500 font-mono">
            ({nodes.length} top-level, {totalCpiHops} inner CPIs)
          </span>
        </div>
        <div className="text-xs text-slate-500">
          Hierarchical Cross-Program Invocations & Privilege Flow
        </div>
      </div>

      <div className="space-y-1">
        {nodes.map((node) => (
          <CpiTreeNode key={node.id} node={node} />
        ))}
      </div>
    </div>
  );
};

function countDescendants(node: CpiCallNode): number {
  if (!node.children || node.children.length === 0) return 0;
  return (
    node.children.length +
    node.children.reduce((acc, c) => acc + countDescendants(c), 0)
  );
}

export default CpiCallTree;
