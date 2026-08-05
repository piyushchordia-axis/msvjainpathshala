import { useRef, useState } from 'react';
import { Camera, LogOut } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/lib/locale-context';
import { writeSessionUserCookie, type SessionUser } from '@/lib/auth';
import { apiPut, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';
import { t, type Locale } from '@workspace/i18n';
import { filterNavForRole, type NavGroup } from './sidebar-nav';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

function initials(name: string, phone: string): string {
  const trimmed = name.trim();
  if (trimmed) {
    return trimmed.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  }
  return phone.slice(-2);
}

function navLabel(href: string, fallback: string, locale: Locale): string {
  if (href === '/admin/media-curation') return t('mediaCuration.navLabel', locale);
  return fallback;
}

function NavBlock({
  groups,
  pathname,
  locale,
}: {
  groups: NavGroup[];
  pathname: string;
  locale: Locale;
}) {
  return (
    <nav aria-label="Admin" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {groups.map((group) => (
        <div key={group.heading}>
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cream-deeper/70">
            {group.heading}
          </div>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground shadow-1'
                        : 'text-cream-deeper/85 hover:bg-maroon-700 hover:text-cream',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate leading-snug">
                      {navLabel(item.href, item.label, locale)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

async function uploadUserPhoto(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('folder', 'user-photos');
  const res = await fetch(`${API_BASE}/v1/uploads`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    body: form,
  });
  if (!res.ok) {
    let code = 'ERR_UPLOAD';
    let message = res.statusText;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(code, message, res.status);
  }
  const json = (await res.json()) as { data: { url: string } };
  return json.data;
}

export function Sidebar({ user }: { user: SessionUser }) {
  const [pathname] = useLocation();
  const locale = useLocale() as Locale;
  const groups = filterNavForRole(user.role);
  const { logout, setUser } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(file: File | null) {
    if (!file || busy) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Choose an image file.');
      return;
    }
    setBusy(true);
    try {
      const uploaded = await uploadUserPhoto(file);
      const res = await apiPut<{ user: SessionUser }>('/v1/me/photo', {
        photo_url: uploaded.url,
      });
      if (res?.user) {
        writeSessionUserCookie(res.user);
        setUser(res.user);
      }
      toast.success('Profile photo updated.');
    } catch (err) {
      toast.error(
        'Could not update photo.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <aside className="hidden h-screen w-[220px] shrink-0 flex-col border-r border-maroon-700/40 bg-secondary text-cream md:flex">
      <div className="flex h-16 items-center gap-3 border-b border-maroon-700/40 px-4">
        <img src={`${import.meta.env.BASE_URL}logo-mark.svg`} alt="" className="h-8 w-8" />
        <div className="leading-tight">
          <div className="font-display text-base text-cream">Jain Pathshala</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-cream-deeper/70">Admin</div>
        </div>
      </div>

      <NavBlock groups={groups} pathname={pathname} locale={locale} />

      <div className="border-t border-maroon-700/40 p-3">
        <div className="flex items-center gap-3 rounded-md bg-maroon-700/40 px-3 py-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            aria-label={user.photo_url ? 'Change profile photo' : 'Add profile photo'}
            title={user.photo_url ? 'Change photo' : 'Add photo'}
            className="relative size-9 shrink-0 overflow-hidden rounded-full bg-primary text-primary-foreground ring-offset-2 hover:ring-2 hover:ring-primary/60 disabled:opacity-60"
          >
            {user.photo_url ? (
              <img
                src={user.photo_url}
                alt=""
                width={36}
                height={36}
                className="size-full object-cover"
              />
            ) : (
              <span className="flex size-full items-center justify-center font-semibold text-sm">
                {initials(user.full_name, user.phone)}
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 flex justify-center bg-ink/55 py-0.5">
              <Camera className="size-2.5 text-cream" aria-hidden />
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-cream">{user.full_name || user.phone}</div>
            <div className="truncate text-[11px] uppercase tracking-wide text-cream-deeper/70">{user.role}</div>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            aria-label="Sign out"
            className="rounded-md p-1.5 text-cream-deeper/80 hover:bg-maroon-700 hover:text-cream"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
