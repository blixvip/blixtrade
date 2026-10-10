// The profile header (banner, picture, name, bio, counts) shown on #/u/<username> and on your own Account
// page, and the window that edits it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FollowButton } from "@/components/follow";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { shortAddr } from "@/lib/format";
import { pictureFrom, social, type Profile } from "@/lib/social";
import { cn } from "@/lib/utils";
import { thumb } from "@/lib/thumb";
import { Icon } from "@/shell/icons";

export const userHref = (username: string) => `#/u/${encodeURIComponent(username)}`;
const joined = (t: number) => new Date(t).toLocaleDateString([], { month: "long", year: "numeric" });

export function Avatar({ p, size = 40, className }: { p: Pick<Profile, "avatar" | "display" | "username">; size?: number; className?: string }) {
  return (
    <span style={{ width: size, height: size, fontSize: size * 0.4 }}
      className={cn("grid shrink-0 place-items-center overflow-hidden rounded-full bg-paper-4 font-semibold text-ink-2 uppercase", className)}>
      {p.avatar ? <img src={thumb(p.avatar, size)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-full object-cover" /> : (p.display || p.username || "?").slice(0, 1)}
    </span>
  );
}

// No banner yet: a quiet grey band, never a loud gradient.
const Banner = ({ src, className, children }: { src: string | null; className?: string; children?: ReactNode }) => (
  <div className={cn("relative overflow-hidden bg-paper-4 bg-cover bg-center", className)} style={src ? { backgroundImage: `url("${src}")` } : undefined}>
    {!src && <div aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_140%_at_0%_0%,oklch(100%_0_0/0.06),transparent_60%)]" />}
    {children}
  </div>
);

export function ProfileHero({ p, onEdit, onCounts, tabs, actions }: {
  p: Profile; onEdit?: () => void; onCounts?: (followers: number) => void; tabs?: (dir: "following" | "followers") => void; actions?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-rule bg-paper-2">
      <Banner src={p.banner} className="aspect-[3/1] max-h-56 w-full" />
      <div className="px-5 pb-5 max-sm:px-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Avatar p={p} size={104} className="relative z-10 -mt-13 border-4 border-paper-2" />
          <div className="flex flex-wrap items-center gap-2 pt-3">
            {actions}
            {p.isMe ? onEdit && <Button size="lg" className="rounded-full" onClick={onEdit}><Icon.settings />Edit profile</Button>
              : <FollowButton kind="user" target={p.id} initial={p.following} onChange={(_, c) => c?.followers != null && onCounts?.(c.followers)} />}
          </div>
        </div>
        <h1 className="mt-3 text-2xl leading-tight font-bold tracking-tight text-ink">{p.display}</h1>
        <p className="text-md text-muted">@{p.username}</p>
        {p.bio && <p className="mt-3 max-w-2xl text-md whitespace-pre-line text-ink-2">{p.bio}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-md text-muted">
          {p.address && (
            <button onClick={() => { navigator.clipboard?.writeText(p.address!); toast("Address copied"); }} className="flex items-center gap-1.5 font-outlier hover:text-ink [&_svg]:size-3.5">
              <Icon.wallets />{shortAddr(p.address)}<Icon.copy /></button>
          )}
          <span className="flex items-center gap-1.5 [&_svg]:size-3.5"><Icon.record />Joined {joined(p.joined)}</span>
        </div>
        <div className="mt-3 flex gap-4 text-md">
          <button onClick={() => tabs?.("following")} className="text-muted hover:text-ink"><b className="num font-semibold text-ink">{p.follows}</b> Following</button>
          <button onClick={() => tabs?.("followers")} className="text-muted hover:text-ink"><b className="num font-semibold text-ink">{p.followers}</b> Followers</button>
        </div>
      </div>
    </section>
  );
}

// Edit profile: banner and picture (click to change), name, username, bio, and whether others see holdings.
export function EditProfile({ p, open, onOpenChange, onSaved }: { p: Profile; open: boolean; onOpenChange: (o: boolean) => void; onSaved: (p: Profile) => void }) {
  const [display, setDisplay] = useState(p.display), [username, setUsername] = useState(p.username), [bio, setBio] = useState(p.bio);
  const [avatar, setAvatar] = useState<string | null | undefined>(undefined), [banner, setBanner] = useState<string | null | undefined>(undefined);
  const [show, setShow] = useState(p.showHoldings), [busy, setBusy] = useState(false);
  const avatarIn = useRef<HTMLInputElement>(null), bannerIn = useRef<HTMLInputElement>(null);
  const pick = async (f: File | undefined, w: number, h: number, set: (v: string) => void) => {
    if (!f) return;
    try { set(await pictureFrom(f, w, h)); } catch (e) { toast((e as Error).message); }
  };
  const shownAvatar = avatar === undefined ? p.avatar : avatar, shownBanner = banner === undefined ? p.banner : banner;

  const save = async () => {
    setBusy(true);
    try {
      const out = await social<Profile>("profile", { display, username, bio, showHoldings: show,
        ...(avatar !== undefined ? { avatar: avatar ?? "" } : {}), ...(banner !== undefined ? { banner: banner ?? "" } : {}) });
      onSaved(out); onOpenChange(false); toast("Profile saved");
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };

  const input = "h-9 min-w-0 rounded-control border border-rule-2 bg-paper px-3 text-md text-ink outline-none focus:border-accent-dim";
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Edit profile">
      <div className="-mx-5 -mt-1">
        <button onClick={() => bannerIn.current?.click()} className="group relative block w-full" aria-label="Change banner">
          <Banner src={shownBanner} className="aspect-[3/1] w-full" />
          <span className="absolute inset-0 grid place-items-center bg-black/35 text-sm font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">Change banner</span>
        </button>
        <div className="flex items-end justify-between px-5">
          <button onClick={() => avatarIn.current?.click()} className="group relative -mt-9 rounded-full" aria-label="Change picture">
            <Avatar p={{ ...p, avatar: shownAvatar, display }} size={76} className="relative z-10 border-4 border-paper-2" />
            <span className="absolute inset-1 grid place-items-center rounded-full bg-black/45 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">Change</span>
          </button>
          <span className="flex gap-3 pt-2 text-sm">
            {shownAvatar && <button onClick={() => setAvatar(null)} className="text-muted hover:text-down">Remove picture</button>}
            {shownBanner && <button onClick={() => setBanner(null)} className="text-muted hover:text-down">Remove banner</button>}
          </span>
        </div>
      </div>
      <input ref={avatarIn} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { pick(e.target.files?.[0], 400, 400, setAvatar); e.target.value = ""; }} />
      <input ref={bannerIn} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { pick(e.target.files?.[0], 1500, 500, setBanner); e.target.value = ""; }} />

      <label className="flex flex-col gap-1.5"><span className="label">Name</span><input value={display} maxLength={40} onChange={(e) => setDisplay(e.target.value)} className={input} /></label>
      <label className="flex flex-col gap-1.5"><span className="label">Username</span>
        <span className={cn(input, "flex items-center gap-0.5 focus-within:border-accent-dim")}><span className="text-muted">@</span>
          <input value={username} maxLength={20} onChange={(e) => setUsername(e.target.value.replace(/[^a-z0-9_]/gi, ""))} className="min-w-0 flex-1 bg-transparent outline-none" /></span></label>
      <label className="flex flex-col gap-1.5"><span className="flex justify-between"><span className="label">Bio</span><span className="num text-xs text-muted">{bio.length}/280</span></span>
        <textarea value={bio} maxLength={280} rows={3} onChange={(e) => setBio(e.target.value)} className={cn(input, "h-auto resize-none py-2")} /></label>
      <label className="flex items-center justify-between gap-3 text-md text-ink-2">
        <span>Show my holdings and trades on my profile</span>
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="size-4 accent-[var(--color-ink)]" />
      </label>
      <div className="flex justify-end gap-2">
        <Button size="lg" variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>Cancel</Button>
        <button onClick={save} disabled={busy} className="h-8 rounded-full bg-ink px-4 text-md font-semibold text-on-fill hover:bg-focus disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
      </div>
    </Dialog>
  );
}

// Your own profile on the Account page: the same header everyone sees, with Edit profile, and your wallet
// buttons beside it. Following and followers open your public page.
export function MyProfile({ actions }: { actions?: ReactNode }) {
  const [p, setP] = useState<Profile | null>(null), [editing, setEditing] = useState(false), [error, setError] = useState("");
  useEffect(() => { social<Profile>("profile").then(setP).catch((e) => setError(e.message)); }, []);
  if (error) return <p className="rounded-control border border-warn/40 bg-warn/10 px-3 py-2 text-md text-ink-2">Your profile could not be loaded: {error}</p>;
  if (!p) return <div className="h-72 animate-pulse rounded-card border border-rule bg-paper-2" />;
  return <>
    <ProfileHero p={p} onEdit={() => setEditing(true)} tabs={() => { location.hash = userHref(p.username); }}
      actions={<>{actions}<a href={userHref(p.username)} className="flex h-8 items-center rounded-full border border-rule-2 px-3.5 text-md font-semibold text-ink-2 hover:text-ink">View profile</a></>} />
    <EditProfile key={String(editing)} p={p} open={editing} onOpenChange={setEditing} onSaved={setP} />
  </>;
}
