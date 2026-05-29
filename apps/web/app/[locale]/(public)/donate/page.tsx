/**
 * /donate — public donation form (SPEC §6.21, Step 21).
 *
 * Visual reference: jp-design-system/preview/admin-forms.html
 *   (field labels in `text-ink-sub`, inputs on white with `border-cream-deeper`,
 *   focused state in saffron 700 + 28% saffron ring) +
 *   jp-design-system/preview/admin-stats.html
 *   (campaign progress card: cream surface, saffron progress fill).
 */

import { DonationForm } from './donation-form';

interface CampaignSummary {
  id: string;
  name: string;
  description: string | null;
  target_amount_paise: number | null;
  raised_amount_paise: number;
}

async function fetchPublicCampaigns(): Promise<CampaignSummary[]> {
  const base = process.env.NEXT_INTERNAL_API_BASE_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${base}/v1/donations/campaigns`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { items?: CampaignSummary[] } };
    return json.data?.items ?? [];
  } catch {
    return [];
  }
}

function paiseToInr(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export default async function DonatePage() {
  const campaigns = await fetchPublicCampaigns();

  return (
    <section className="container py-12 md:py-20">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.4fr_1fr]">
        {/* ===== Form column ============================================ */}
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
            Support the Pathshala
          </p>
          <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
            Plant a seed of seva.
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground">
            Every rupee funds shikshak stipends, classroom material, Shivirs, and scholarships. When
            80G is enabled, an income-tax certificate is generated automatically and emailed to you.
          </p>

          <div className="mt-10 rounded-2xl border border-cream-deeper bg-cream p-6 shadow-1 md:p-8">
            <DonationForm campaigns={campaigns} />
          </div>
        </div>

        {/* ===== Campaign / info column ================================ */}
        <aside className="space-y-6">
          {campaigns.length > 0 ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-sub">
                Active campaigns
              </p>
              {campaigns.map((c) => {
                const pct = c.target_amount_paise
                  ? Math.min(100, Math.round((c.raised_amount_paise / c.target_amount_paise) * 100))
                  : 0;
                return (
                  <div
                    key={c.id}
                    className="rounded-xl border border-cream-deeper bg-white p-5 shadow-1"
                  >
                    <div className="font-display text-lg text-secondary">{c.name}</div>
                    {c.description ? (
                      <p className="mt-2 text-sm text-ink-sub">{c.description}</p>
                    ) : null}
                    <div className="mt-4 space-y-2">
                      <div className="h-2.5 overflow-hidden rounded-full bg-cream-dark">
                        <div
                          className="h-full rounded-full bg-saffron transition-[width]"
                          style={{ width: `${pct}%` }}
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        />
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="font-semibold text-ink">
                          ₹{paiseToInr(c.raised_amount_paise)} raised
                        </span>
                        {c.target_amount_paise ? (
                          <span className="text-ink-sub">
                            of ₹{paiseToInr(c.target_amount_paise)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            <div className="rounded-xl border border-cream-deeper bg-white p-5 text-sm text-ink-sub shadow-1">
              No active public campaigns right now. Your donation goes to the general Pathshala
              fund.
            </div>
          )}

          <div className="rounded-xl border border-saffron-300 bg-saffron-50 p-5 text-sm text-secondary shadow-1">
            <div className="font-display text-base text-saffron-700">Why donate via Pathshala?</div>
            <ul className="mt-3 space-y-2 text-ink">
              <li>· Receipts are emailed within 30 seconds of capture.</li>
              <li>· 80G certificates are generated automatically when registration is active.</li>
              <li>· Razorpay UPI / card / netbanking — encrypted end-to-end.</li>
              <li>· Donor PAN is encrypted at rest (AES-256-GCM).</li>
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
}
