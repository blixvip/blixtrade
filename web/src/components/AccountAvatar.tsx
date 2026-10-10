import { useState } from "react";
import { cn } from "@/lib/utils";

type Profile = { signedIn: boolean; name?: string | null; email?: string; picture?: string | null };
export function AccountAvatar({ me, className }: { me: Profile | null; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const picture = me?.signedIn ? me.picture : null;
  const label = me?.name?.trim() || me?.email || "Account";
  const identity = `${me?.email || ""}:${picture || ""}`;
  const words = (me?.name?.trim() || me?.email?.split("@")[0] || "?").split(/\s+/);
  const initials = (Array.from(words[0])[0] + (words.length > 1 ? Array.from(words.at(-1)!)[0] : "")).toUpperCase();
  return <span className={cn("grid size-full shrink-0 place-items-center overflow-hidden rounded-full bg-paper-4 text-md font-semibold text-ink", className)}>
    {picture && failed !== identity
      ? <img key={identity} src={picture} alt={`${label}'s profile picture`} width={48} height={48} referrerPolicy="no-referrer" draggable={false} className="size-full object-cover" onError={() => setFailed(identity)} />
      : me?.signedIn ? <span aria-label={`${label}'s initials`}>{initials}</span>
        : <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-5"><circle cx="12" cy="8" r="3" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>}
  </span>;
}
