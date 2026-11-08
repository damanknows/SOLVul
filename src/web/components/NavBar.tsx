// src/web/components/NavBar.tsx
import Link from "next/link";

export default function NavBar() {
  return (
    <nav className="bg-gray-800 p-4 text-white flex space-x-6">
      <Link href="/overview"><a className="hover:underline">Overview</a></Link>
      <Link href="/inspector"><a className="hover:underline">Inspector</a></Link>
      <Link href="/risk-report"><a className="hover:underline">Risk Report</a></Link>
      <Link href="/settings"><a className="hover:underline">Settings</a></Link>
    </nav>
  );
}

