// src/web/components/UnsupportedNotice.tsx
import React from "react";

interface UnsupportedNoticeProps {
  count: number;
}

export default function UnsupportedNotice({ count }: UnsupportedNoticeProps) {
  if (count === 0) return null;
  return (
    <div className="border-l-4 border-yellow-400 bg-yellow-50 p-3 mb-4 rounded">
      <p className="text-yellow-800 font-medium">{count} instruction(s) could not be decoded and are shown as unsupported.</p>
    </div>
  );
}

