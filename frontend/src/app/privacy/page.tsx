import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-stone-500 hover:text-stone-700 text-sm mb-6 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </Link>

      <div className="bg-white rounded-xl border border-stone-200 p-4 sm:p-6 shadow-sm">
        <h1 className="text-xl font-bold text-[#1A1A2E] mb-1">Privacy Policy</h1>
        <p className="text-sm text-stone-500 mb-6">Last updated: February 23, 2026</p>

        <div className="space-y-6 text-sm text-stone-700 leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-[#1A1A2E] mb-2">What we collect</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Email address</strong> — used for authentication (magic link login) and sending job alert emails.</li>
              <li><strong>Company subscriptions and favorites</strong> — which companies you track and which jobs you save.</li>
              <li><strong>Email preferences</strong> — your chosen alert frequency (daily, weekly, or off).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1A1A2E] mb-2">Analytics and error monitoring</h2>
            <p className="mb-2">We use third-party services to understand how the app is used and to fix bugs:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>PostHog</strong> — product analytics (page views, feature usage). Your email is hashed before being sent to PostHog; no raw email addresses are shared.</li>
              <li><strong>Sentry</strong> — error monitoring and performance tracing. Captures error details and stack traces when something goes wrong. Session replays are sampled at 10% on errors only.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1A1A2E] mb-2">Third-party services</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Supabase</strong> — database and authentication. Stores your account, subscriptions, and favorites.</li>
              <li><strong>Resend</strong> — email delivery. Sends magic link login emails and daily job alert emails.</li>
              <li><strong>Vercel</strong> — hosts the frontend application.</li>
              <li><strong>Railway</strong> — hosts the backend API.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1A1A2E] mb-2">Cookies</h2>
            <p>
              We use HttpOnly cookies to store your authentication session. These are essential for keeping you logged in and cannot be accessed by JavaScript in the browser. We do not use advertising or tracking cookies.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1A1A2E] mb-2">Data retention</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Your account and preferences are stored as long as your account exists.</li>
              <li>Job listings older than 60 days are archived (not deleted) to preserve your favorites.</li>
              <li>Compensation cache data refreshes every 24 hours.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1A1A2E] mb-2">Your rights</h2>
            <p>
              You can delete your account and all associated data at any time by contacting us. You can also change your email alert preferences to &quot;off&quot; in Settings to stop receiving emails.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#1A1A2E] mb-2">Contact</h2>
            <p>
              Questions about this policy? Email{" "}
              <a href="mailto:vik@viktoriousllc.com" className="text-[#0EA5E9] hover:underline">
                vik@viktoriousllc.com
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
