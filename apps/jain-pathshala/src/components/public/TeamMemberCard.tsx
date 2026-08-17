import { useEffect } from "react";
import { cn } from "@/lib/utils";

/** Initials from a display name (Latin or Devanagari). */
export function teamInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = [...parts[0]!][0] ?? "";
  if (parts.length === 1) {
    const second = [...parts[0]!][1] ?? "";
    return (first + second).toUpperCase() || "?";
  }
  const last = [...parts[parts.length - 1]!][0] ?? "";
  return (first + last).toUpperCase() || "?";
}

/**
 * Prefer thumb_md when the storage URL encodes variants.
 * Running schema exposes photo_url on the user; photo_asset_id alone has no public media route yet.
 */
export function teamPhotoSrc(
  photoUrl: string | null | undefined,
  _photoAssetId?: string | null,
): string | null {
  if (!photoUrl) return null;
  if (photoUrl.includes("/thumb_md/") || photoUrl.includes("_thumb_md")) return photoUrl;
  if (photoUrl.includes("/original/")) return photoUrl.replace("/original/", "/thumb_md/");
  return photoUrl;
}

export type TeamCardModel = {
  id: string;
  honorific: string | null;
  name_en: string;
  name_hi: string;
  designation_en: string | null;
  designation_hi: string | null;
  photo_asset_id: string | null;
  photo_url: string | null;
  centre_names?: string[];
};

type TeamMemberCardProps = {
  member: TeamCardModel;
  locale: "en" | "hi";
  /** Core Team / LCP row — eager + high priority. */
  priority?: boolean;
  /** Core Team: circular portrait + name; designation only when present (trustees). */
  variant?: "default" | "core";
  className?: string;
};

function Portrait({
  src,
  initials,
  priority,
  circular,
}: {
  src: string | null;
  initials: string;
  priority: boolean;
  circular: boolean;
}) {
  return (
    <div
      className={cn(
        "relative aspect-square w-full overflow-hidden bg-muted",
        circular && "rounded-full",
      )}
    >
      {src ? (
        <img
          src={src}
          alt=""
          width={400}
          height={400}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          className="h-full w-full object-cover object-top"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center bg-saffron text-cream"
          aria-hidden
        >
          <span
            className="font-display text-3xl tracking-wide"
            style={{ lineHeight: "22px" }}
          >
            {initials}
          </span>
        </div>
      )}
    </div>
  );
}

export function TeamMemberCard({
  member,
  locale,
  priority = false,
  variant = "default",
  className,
}: TeamMemberCardProps) {
  const name = locale === "hi" ? member.name_hi : member.name_en;
  const designation = locale === "hi" ? member.designation_hi : member.designation_en;
  const honorific = member.honorific?.trim() || null;
  const centreLabel =
    member.centre_names && member.centre_names.length > 0
      ? member.centre_names.join(" · ")
      : null;
  const src = teamPhotoSrc(member.photo_url, member.photo_asset_id);
  const initials = teamInitials(name);
  const isCore = variant === "core";

  return (
    <article
      className={cn(
        "flex h-full min-w-0 flex-col overflow-hidden rounded-xl border text-card-foreground",
        isCore
          ? "items-center border-border/70 bg-cream-dark px-4 pb-5 pt-5 shadow-sm"
          : "border-border bg-card shadow-sm",
        className,
      )}
    >
      <div className={cn("w-full", isCore && "mx-auto max-w-[11rem]")}>
        <Portrait src={src} initials={initials} priority={priority} circular={isCore} />
      </div>
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-1.5",
          isCore ? "items-center px-1 pt-4 text-center" : "p-4 sm:p-5",
        )}
      >
        <h3
          className="break-words font-display text-lg text-secondary"
          style={{ lineHeight: "22px", minHeight: "1.375em" }}
        >
          {honorific ? (
            <span className="text-muted-foreground">
              {honorific}
              {" "}
            </span>
          ) : null}
          {name}
        </h3>
        {designation ? (
          <p
            className="break-words text-sm text-muted-foreground"
            style={{ lineHeight: "22px" }}
          >
            {designation}
          </p>
        ) : null}
        {!isCore && centreLabel ? (
          <p
            className="mt-auto break-words pt-2 text-xs text-ink-sub"
            style={{ lineHeight: "22px" }}
          >
            {centreLabel}
          </p>
        ) : null}
      </div>
    </article>
  );
}

/** Same footprint as TeamMemberCard — avoids layout shift while a batch loads. */
export function TeamMemberCardSkeleton({
  className,
  variant = "default",
}: {
  className?: string;
  variant?: "default" | "core";
}) {
  const isCore = variant === "core";
  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-border shadow-sm",
        isCore ? "items-center bg-cream-dark px-4 pb-5 pt-5" : "bg-card",
        className,
      )}
      aria-hidden
    >
      <div className={cn("w-full", isCore && "mx-auto max-w-[11rem]")}>
        <div
          className={cn(
            "aspect-square w-full animate-pulse bg-muted",
            isCore && "rounded-full",
          )}
        />
      </div>
      <div
        className={cn(
          "flex flex-1 flex-col gap-2",
          isCore ? "w-full items-center pt-4" : "p-4 sm:p-5",
        )}
      >
        <div className="h-5 w-[80%] max-w-[12rem] animate-pulse rounded bg-muted" />
        {isCore ? null : (
          <>
            <div className="h-4 w-[60%] max-w-[9rem] animate-pulse rounded bg-muted" />
            <div className="mt-auto h-3 w-[40%] max-w-[7rem] animate-pulse rounded bg-muted pt-2" />
          </>
        )}
      </div>
    </div>
  );
}

/** Inject schema.org JSON-LD once for the Team page. */
export function useTeamJsonLd(payload: unknown) {
  useEffect(() => {
    if (!payload) return;
    const id = "jp-team-jsonld";
    let el = document.getElementById(id) as HTMLScriptElement | null;
    if (!el) {
      el = document.createElement("script");
      el.id = id;
      el.type = "application/ld+json";
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(payload);
    return () => {
      el?.remove();
    };
  }, [payload]);
}
