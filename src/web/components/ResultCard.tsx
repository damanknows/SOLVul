// src/web/components/ResultCard.tsx
import React from "react";

interface ResultCardProps {
  title: string;
  children: React.ReactNode;
}

export default function ResultCard({ title, children }: ResultCardProps) {
  return (
    <div className="border border-slate-200 rounded-xl p-5 mb-4 shadow-sm bg-white">
      <h3 className="text-base font-bold text-slate-900 mb-3">{title}</h3>
      <div className="text-sm text-slate-700">{children}</div>
    </div>
  );
}
