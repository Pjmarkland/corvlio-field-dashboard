import { useEffect, useState, type FormEvent } from "react";
import {
  getGetAdminUsageAlertSettingsQueryKey,
  useGetAdminUsageAlertSettings,
  useUpdateAdminUsageAlertSettings,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const DEFAULT_SETTINGS = {
  dailyTotalCallMinutes: 500,
  monthlyTotalCallMinutes: 8000,
  dailyPerBusinessCallMinutes: 120,
  monthlyPerBusinessCallMinutes: 1500,
  dailyProvisionedNumbers: 3,
  monthlyProvisionedNumbers: 20,
};

type Settings = typeof DEFAULT_SETTINGS;
type SettingKey = keyof Settings;

const FIELDS: Array<{ key: SettingKey; label: string; unit: string }> = [
  { key: "dailyTotalCallMinutes", label: "Total Retell minutes per UTC day", unit: "minutes" },
  { key: "monthlyTotalCallMinutes", label: "Total Retell minutes per UTC month", unit: "minutes" },
  { key: "dailyPerBusinessCallMinutes", label: "Call minutes per business per UTC day", unit: "minutes" },
  { key: "monthlyPerBusinessCallMinutes", label: "Call minutes per business per UTC month", unit: "minutes" },
  { key: "dailyProvisionedNumbers", label: "Numbers provisioned per UTC day", unit: "numbers" },
  { key: "monthlyProvisionedNumbers", label: "Numbers provisioned per UTC month", unit: "numbers" },
];

const inputClass =
  "mt-1.5 min-h-11 w-full rounded-xl border border-[#d7dfd7] bg-white px-3 text-sm text-[#25362e] outline-none focus:border-[#4e8d70] focus:ring-2 focus:ring-[#4e8d70]/15";

export default function UsageAlertSettingsSection() {
  const queryClient = useQueryClient();
  const query = useGetAdminUsageAlertSettings();
  const mutation = useUpdateAdminUsageAlertSettings();
  const [values, setValues] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!query.data) return;
    setValues({
      dailyTotalCallMinutes: query.data.dailyTotalCallMinutes,
      monthlyTotalCallMinutes: query.data.monthlyTotalCallMinutes,
      dailyPerBusinessCallMinutes: query.data.dailyPerBusinessCallMinutes,
      monthlyPerBusinessCallMinutes: query.data.monthlyPerBusinessCallMinutes,
      dailyProvisionedNumbers: query.data.dailyProvisionedNumbers,
      monthlyProvisionedNumbers: query.data.monthlyProvisionedNumbers,
    });
  }, [query.data]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    mutation.mutate({ data: values }, {
      onSuccess: () => {
        setSaved(true);
        void queryClient.invalidateQueries({ queryKey: getGetAdminUsageAlertSettingsQueryKey() });
      },
    });
  }

  return (
    <section className="mb-8" data-testid="section-usage-alert-settings">
      <p className="admin-label">Usage and spend guardrails</p>
      <h2 className="mb-3 text-lg font-800 text-[#25362e]">Founder usage alerts</h2>
      <div className="admin-panel rounded-2xl p-4 sm:p-5">
        <p className="mb-4 max-w-3xl text-xs leading-relaxed text-[#647168]">
          Alerts fire when usage reaches a threshold. They are advisory only: calls continue, plans do not change, and phone numbers are not purchased or released. These minute and number counts are usage indicators, not a dollar-cost estimate.
        </p>
        {query.isLoading ? <p role="status" className="text-sm text-[#647168]">Loading thresholds…</p> : null}
        {query.isError ? (
          <p role="alert" className="mb-3 text-sm text-[#a3432d]">
            Usage thresholds could not load. Refresh this page before changing them.
          </p>
        ) : null}
        {!query.isLoading && !query.isError ? (
          <form onSubmit={submit}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {FIELDS.map(({ key, label, unit }) => (
                <label key={key} className="text-xs font-semibold text-[#536258]">
                  {label}
                  <span className="sr-only">, in {unit}</span>
                  <input
                    type="number"
                    min={1}
                    max={1_000_000}
                    step={1}
                    required
                    value={values[key]}
                    onChange={(event) => {
                      setSaved(false);
                      setValues((current) => ({ ...current, [key]: Number(event.target.value) }));
                    }}
                    className={inputClass}
                    data-testid={`input-usage-${key}`}
                  />
                </label>
              ))}
            </div>
            <p className="mt-4 rounded-xl bg-[#f1f4ee] p-3 text-xs leading-relaxed text-[#536258]">
              Plan call-count alerts follow the locked rules at 80% and 100% of the finite call limit for the current billing period. Configurable minute and number thresholds use UTC calendar days and months. Alerts do not block calls or add per-call charges.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={mutation.isPending || query.isError}
                className="min-h-11 rounded-xl bg-[#244d3f] px-4 text-xs font-bold text-white disabled:opacity-55"
                data-testid="button-save-usage-alerts"
              >
                {mutation.isPending ? "Saving…" : "Save thresholds"}
              </button>
              {saved ? <span role="status" className="text-xs font-semibold text-[#2c6b56]">Thresholds saved</span> : null}
              {query.data?.updatedAt ? <span className="text-xs text-[#77847b]">Last saved {new Date(query.data.updatedAt).toLocaleString()}</span> : null}
            </div>
            {mutation.isError ? (
              <p role="alert" className="mt-3 text-xs text-[#a3432d]">Thresholds could not be saved. Your previous settings are still active.</p>
            ) : null}
          </form>
        ) : null}
      </div>
    </section>
  );
}
