import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAdminAppReviewDemoQueryKey,
  getGetAdminOverviewQueryKey,
  useGetAdminAppReviewDemo,
  useLinkAdminAppReviewDemo,
  useResetAdminAppReviewDemo,
} from "@workspace/api-client-react";

const input = "min-h-11 w-full rounded-xl border border-[#d5dfd5] bg-white px-3 text-sm text-[#25362e]";

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "The request failed. Please try again.";
}

export default function AppReviewDemoSection() {
  const queryClient = useQueryClient();
  const status = useGetAdminAppReviewDemo({
    query: { queryKey: getGetAdminAppReviewDemoQueryKey(), retry: false },
  });
  const reset = useResetAdminAppReviewDemo();
  const link = useLinkAdminAppReviewDemo();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetAdminAppReviewDemoQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() }),
    ]);
  };

  const resetDemo = async () => {
    if (!window.confirm("Reset the App Review Demo sample profile and replace its tagged fictional leads with eight fresh leads? Other businesses and non-demo leads will not be changed.")) return;
    setError("");
    setSuccess("");
    try {
      await reset.mutateAsync();
      await refresh();
      setSuccess("The App Review Demo is ready with eight fictional leads.");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const linkReviewer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    try {
      await link.mutateAsync({ data: { email: email.trim() } });
      setEmail("");
      await refresh();
      setSuccess("The existing verified Clerk account is linked to App Review Demo.");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const data = status.data;
  const actionsReady = Boolean(data) && !status.isError;

  return (
    <section className="mb-8" data-testid="section-app-review-demo">
      <p className="admin-label">App Store review</p>
      <h2 className="mb-3 text-lg font-800 text-[#25362e]">App Review Demo</h2>
      <div className="admin-panel rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {status.isLoading ? (
              <p role="status" className="text-sm text-[#647168]">Checking demo status…</p>
            ) : status.isError || !data ? (
              <p role="alert" className="text-sm text-[#a3432d]" data-testid="state-app-review-demo-error">
                App Review Demo status could not load. <button type="button" className="font-semibold underline" onClick={() => void status.refetch()}>Try again</button>
              </p>
            ) : (
              <>
                <p className="text-sm font-semibold text-[#25362e]" data-testid="text-app-review-demo-status">
                  {data.exists ? `${data.leadCount} fictional leads ready` : "Demo business has not been created"}
                </p>
                <p className="mt-1 text-xs text-[#647168]" data-testid="text-app-review-demo-owner">
                  {data.linked ? `Reviewer account linked${data.ownerEmail ? `: ${data.ownerEmail}` : ""}` : "No reviewer account linked"}
                </p>
              </>
            )}
          </div>
          <button
            type="button"
            data-testid="button-reset-app-review-demo"
            disabled={!actionsReady || reset.isPending}
            onClick={() => void resetDemo()}
            className="min-h-11 rounded-xl bg-[#244d3f] px-4 text-xs font-bold text-white disabled:opacity-50"
          >
            {reset.isPending ? "Preparing…" : data?.exists ? "Reset demo data" : "Create demo"}
          </button>
        </div>

        <div className="mt-4 grid gap-2 rounded-xl bg-[#f1f4ee] p-3 text-xs leading-relaxed text-[#536258]">
          <p><strong>Reset scope:</strong> creates or refreshes the clearly labeled sample business profile and eight recent fictional leads. It refuses to change the business if it finds calls, billing or provisioning records, notifications, or leads not tagged as demo data. It never buys a phone or creates a Clerk user.</p>
          <p><strong>Reviewer account:</strong> create a separate Clerk account, sign in once, and verify its email. Enter that exact verified email below to link the existing account. Linking is refused if the demo is already linked to a different account or this account already owns another business.</p>
        </div>

        {data?.linked ? <p className="mt-3 text-xs text-[#647168]">The demo already has an owner. This form will not replace that account.</p> : null}
        <form onSubmit={(event) => void linkReviewer(event)} className="mt-4 grid gap-3 border-t border-[#e1e6df] pt-4 sm:grid-cols-[1fr_auto]" data-testid="form-link-app-review-demo">
          <label className="grid gap-1.5 text-xs font-semibold text-[#536258]" htmlFor="app-review-demo-email">
            Verified reviewer email
            <input
              id="app-review-demo-email"
              type="email"
              maxLength={320}
              required
              autoComplete="email"
              className={input}
              data-testid="input-app-review-demo-email"
              placeholder="reviewer@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button
            type="submit"
            data-testid="button-link-app-review-demo"
            disabled={!data?.exists || data.linked || !actionsReady || link.isPending}
            className="min-h-11 self-end rounded-xl border border-[#cbd8cb] bg-white px-4 text-xs font-bold text-[#244d3f] disabled:opacity-50"
          >
            {link.isPending ? "Linking…" : data?.linked ? "Account already linked" : "Link reviewer account"}
          </button>
        </form>

        {error ? <p role="alert" className="mt-3 text-xs text-[#a3432d]" data-testid="error-app-review-demo">{error}</p> : null}
        {success ? <p role="status" className="mt-3 text-xs text-[#2c6b56]" data-testid="success-app-review-demo">{success}</p> : null}
      </div>
    </section>
  );
}
