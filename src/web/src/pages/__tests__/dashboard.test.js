import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Dashboard from "../Dashboard";
import { useAuth } from "../../contexts/AuthContext";
import {
  guestAuth,
  jsonResponse,
  makeDataset,
  makeDatasets,
  signedInAuth,
  stubFetch,
} from "../../testUtils";

jest.mock("../../contexts/AuthContext", () => ({
  useAuth: jest.fn(),
}));

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={[`/dashboard?userId=${USER_ID}`]}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/signin" element={<div>Sign in page</div>} />
        <Route path="/create-dataset" element={<div>Create dataset</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function stubDashboardApis({ datasets = [], orgName = "WELL Labs" } = {}) {
  return stubFetch({
    "/api/user_datasets": jsonResponse(datasets),
    "/api/organizations/": jsonResponse({ id: "org-1", name: orgName }),
    "/api/organizations/list_organizations": jsonResponse({
      items: [{ id: "11111111-1111-4111-8111-111111111111", name: orgName }],
    }),
  });
}

describe("Dashboard module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("API auth: unauthenticated users are sent to sign-in", async () => {
    const verifyUser = jest.fn().mockResolvedValue(null);
    useAuth.mockReturnValue({
      ...guestAuth,
      verifyUser,
      user: null,
      isAuthenticated: false,
    });
    renderDashboard();
    expect(await screen.findByText(/sign in page/i)).toBeInTheDocument();
    expect(verifyUser).toHaveBeenCalled();
  });

  test("API auth: signed-in user loads /api/user_datasets with user_id", async () => {
    const auth = signedInAuth({ id: USER_ID });
    useAuth.mockReturnValue(auth);
    const fetchMock = stubDashboardApis({
      datasets: [makeDataset(1, { approved: true, organization_name: "WELL Labs" })],
    });
    renderDashboard();
    expect(await screen.findByRole("heading", { name: "Dataset 1" })).toBeInTheDocument();
    await waitFor(() => {
      const called = fetchMock.mock.calls.some(
        ([url]) =>
          String(url).includes("/api/user_datasets") &&
          String(url).includes(`user_id=${USER_ID}`) &&
          String(url).includes("limit=10")
      );
      expect(called).toBe(true);
    });
    expect(auth.verifyUser).toHaveBeenCalled();
    expect(screen.getByText(/published datasets/i)).toBeInTheDocument();
  });

  test("published tab empty state", async () => {
    useAuth.mockReturnValue(signedInAuth({ id: USER_ID }));
    stubDashboardApis({ datasets: [] });
    renderDashboard();
    expect(await screen.findByRole("heading", { name: /no published datasets yet/i })).toBeInTheDocument();
  });

  test("published data with more than 10 items paginates", async () => {
    useAuth.mockReturnValue(signedInAuth({ id: USER_ID }));
    const page1 = makeDatasets(10, (n) =>
      makeDataset(n, { approved: true, organization_name: "WELL Labs" })
    );
    stubFetch({
      "/api/user_datasets": (url) => {
        const offset = Number(new URLSearchParams(String(url).split("?")[1] || "").get("offset") || 0);
        if (offset === 0) return jsonResponse(page1);
        return jsonResponse([
          makeDataset(11, { approved: true, dataset_title: "Published 11" }),
        ]);
      },
      "/api/organizations/": jsonResponse({ name: "WELL Labs" }),
      "/api/organizations/list_organizations": jsonResponse({ items: [] }),
    });
    renderDashboard();
    expect(await screen.findByRole("heading", { name: "Dataset 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dataset 10" })).toBeInTheDocument();
    const publishedCount = screen.getByRole("button", { name: /published/i });
    expect(publishedCount).toHaveTextContent("10");
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByRole("heading", { name: "Published 11" })).toBeInTheDocument();
  });

  test("pending data with more than 10 items paginates on pending tab", async () => {
    useAuth.mockReturnValue(signedInAuth({ id: USER_ID }));
    const page1 = makeDatasets(10, (n) =>
      makeDataset(n, {
        approved: false,
        organization_name: "IFMR",
        dataset_title: `Pending ${n}`,
      })
    );
    stubFetch({
      "/api/user_datasets": (url) => {
        const offset = Number(new URLSearchParams(String(url).split("?")[1] || "").get("offset") || 0);
        if (offset === 0) return jsonResponse(page1);
        return jsonResponse([
          makeDataset(11, { approved: false, dataset_title: "Pending 11" }),
        ]);
      },
      "/api/organizations/": jsonResponse({ name: "IFMR" }),
      "/api/organizations/list_organizations": jsonResponse({ items: [] }),
    });
    renderDashboard();
    expect(await screen.findByText(/10 datasets awaiting approval/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /pending/i }));
    expect(await screen.findByRole("heading", { name: "Pending 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pending 10" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pending/i })).toHaveTextContent("10");
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByRole("heading", { name: "Pending 11" })).toBeInTheDocument();
  });

  test("tabs split published vs pending on the current API page", async () => {
    useAuth.mockReturnValue(signedInAuth({ id: USER_ID }));
    stubDashboardApis({
      datasets: [
        makeDataset(1, { approved: true, dataset_title: "Live set", organization_name: "WELL Labs" }),
        makeDataset(2, { approved: false, dataset_title: "Queued set", organization_name: "IFMR" }),
      ],
    });
    renderDashboard();
    expect(await screen.findByRole("heading", { name: "Live set" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Queued set" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /pending/i }));
    expect(await screen.findByRole("heading", { name: "Queued set" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Live set" })).not.toBeInTheDocument();
  });
});
