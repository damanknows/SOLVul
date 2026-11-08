// src/web/components/ResultCard.tsx
import React from "react";

interface ResultCardProps {
  title: string;
  children: React.ReactNode;
}

export default function ResultCard({ title, children }: ResultCardProps) {
  return (
    <div className="border rounded-lg p-4 mb-4 shadow-sm bg-white">
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <div className="text-sm text-gray-800">{children}</div>
    </div>
  );
}

