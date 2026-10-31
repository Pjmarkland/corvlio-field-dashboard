import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: {} as Record<string, unknown>,
  reset: vi.fn(),
  link: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetAdminAppReviewDemoQueryKey: () => ["app-review-demo"],
  getGetAdminOverviewQueryKey: () => ["admin-overview"],
  useGetAdminAppReviewDemo: () => mocks.status,
  useResetAdminAppReviewDemo: () => ({ mutateAsync: mocks.reset, isPending: false }),
  useLinkAdminAppReviewDemo: () => ({ mutateAsync: mocks.link, isPending: false }),
}));

import AppReviewDemoSection from "./AppReviewDemoSection";

function view() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AppReviewDemoSection />
    </QueryClientProvider>,
  );
}

describe("AppReviewDemoSection", () => {
  beforeEach(() => {
    mocks.status = {
      data: {
        exists: true,
        businessId: 52,
        businessName: "App Review Demo",
        ownerEmail: null,
        linked: false,
        leadCount: 8,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    mocks.reset.mockReset().mockResolvedValue({});
    mocks.link.mockReset().mockResolvedValue({});
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the lead count and current reviewer-link state", () => {
    view();
    expect(screen.getByTestId("text-app-review-demo-status").textContent).toBe("8 fictional leads ready");
    expect(screen.getByTestId("text-app-review-demo-owner").textContent).toBe("No reviewer account linked");
    expect((screen.getByTestId("button-link-app-review-demo") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("checkbox-allow-unverified-app-review-email") as HTMLInputElement).checked).toBe(false);
  });

  it("does not reset unless the admin confirms the limited sample-data reset", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    view();
    fireEvent.click(screen.getByTestId("button-reset-app-review-demo"));
    expect(mocks.reset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("button-reset-app-review-demo"));
    await waitFor(() => expect(mocks.reset).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("success-app-review-demo").textContent).toContain("eight fictional leads");
  });

  it("links the exact email the admin submits", async () => {
    view();
    fireEvent.change(screen.getByTestId("input-app-review-demo-email"), {
      target: { value: "reviewer@example.test" },
    });
    fireEvent.submit(screen.getByTestId("form-link-app-review-demo"));
    await waitFor(() => expect(mocks.link).toHaveBeenCalledWith({
      data: { email: "reviewer@example.test", allowUnverifiedEmail: false },
    }));
    expect(screen.getByTestId("success-app-review-demo").textContent).toContain("existing verified Clerk account");
  });

  it("sends the explicit override only when checked and then turns it back off", async () => {
    view();
    fireEvent.change(screen.getByTestId("input-app-review-demo-email"), {
      target: { value: "reviewer@example.test" },
    });
    fireEvent.click(screen.getByTestId("checkbox-allow-unverified-app-review-email"));
    expect((screen.getByTestId("checkbox-allow-unverified-app-review-email") as HTMLInputElement).checked).toBe(true);

    fireEvent.submit(screen.getByTestId("form-link-app-review-demo"));
    await waitFor(() => expect(mocks.link).toHaveBeenCalledWith({
      data: { email: "reviewer@example.test", allowUnverifiedEmail: true },
    }));
    expect(screen.getByTestId("success-app-review-demo").textContent).toContain("unverified-email admin override");
    expect((screen.getByTestId("checkbox-allow-unverified-app-review-email") as HTMLInputElement).checked).toBe(false);
  });

  it("prevents linking before the demo business exists", () => {
    mocks.status = {
      data: { exists: false, businessId: null, businessName: null, ownerEmail: null, linked: false, leadCount: 0 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    view();
    expect((screen.getByTestId("button-link-app-review-demo") as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not offer to replace an existing reviewer account", () => {
    mocks.status = {
      data: {
        exists: true,
        businessId: 52,
        businessName: "App Review Demo",
        ownerEmail: "existing-reviewer@example.test",
        linked: true,
        leadCount: 8,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    view();
    expect((screen.getByTestId("button-link-app-review-demo") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("The demo already has an owner. This form will not replace that account.")).toBeTruthy();
  });
});
