"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export function Breadcrumbs({
  items,
}: {
  items: Array<{ href?: string; label: string }>;
}) {
  const router = useRouter();
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-3 text-sm text-white/70">
      <button
        className="border border-white/25 px-2.5 py-1 text-white hover:bg-white/10"
        type="button"
        onClick={() => router.back()}
      >
        Back
      </button>
      <ol className="flex min-w-0 flex-wrap items-center gap-1.5">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? <span className="text-white/40">/</span> : null}
            {item.href ? (
              <Link className="hover:text-white" href={item.href}>
                {item.label}
              </Link>
            ) : (
              <span className="truncate text-white">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
