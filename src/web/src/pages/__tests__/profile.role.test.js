import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Profile from "../Profile";
import { useAuth } from "../../contexts/AuthContext";
import { jsonResponse, signedInAuth, stubFetch } from "../../testUtils";

jest.mock("../../contexts/AuthContext", () => ({
  useAuth: jest.fn(),
}));

const VIEWER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

function profilePayload(overrides = {}) {
  return {
    id: TARGET_ID,
    full_name: "Ada Lovelace",
    email: "ada@example.com",
    designation: "Researcher",
    organization: ORG_ID,
    organization_name: "WELL Labs",
    role: 0,
    is_superuser: false,
    is_verified: true,
    verified: true,
    contributions: 2,
    created_at: "2026-01-01T00:00:00Z",
    modified_at: "2026-01-02T00:00:00Z",
    privileges: { edit: false, user_datasets: false },
    ...overrides,
  };
}

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={[`/profile?id=${TARGET_ID}`]}>
      <Profile />
    </MemoryRouter>
  );
}

function mockProfile(auth, profile) {
  useAuth.mockReturnValue(auth);
  return stubFetch({
    "/api/profile": jsonResponse(profile),
    "/api/homepage_stats": jsonResponse({ top_contributors: [] }),
    "/api/change_user_role/": jsonResponse({ detail: "User role updated successfully" }),
  });
}

describe("Profile change role permissions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("shows who approved the user's signup", async () => {
    const approverId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    mockProfile(
      signedInAuth({ id: VIEWER_ID, role: 0, is_superuser: false, organization: ORG_ID }),
      profilePayload({
        approved_by: approverId,
        approver_name: "Grace Hopper",
      })
    );
    renderProfile();
    const link = await screen.findByRole("link", { name: "Grace Hopper" });
    expect(link).toHaveAttribute("href", `/profile?id=${approverId}`);
  });

  test("hides Approved by when no admin has approved the signup", async () => {
    mockProfile(
      signedInAuth({ id: VIEWER_ID, role: 0, is_superuser: false, organization: ORG_ID }),
      profilePayload()
    );
    renderProfile();
    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.queryByText("Approved by")).not.toBeInTheDocument();
  });

  test("shows Change role to an admin in the same organisation", async () => {
    mockProfile(
      signedInAuth({ id: VIEWER_ID, role: 1, is_superuser: false, organization: ORG_ID }),
      profilePayload()
    );
    renderProfile();
    expect(await screen.findByRole("button", { name: /change role/i })).toBeInTheDocument();
  });

  test("shows Change role to a super user in another organisation", async () => {
    mockProfile(
      signedInAuth({
        id: VIEWER_ID,
        role: 0,
        is_superuser: true,
        organization: OTHER_ORG,
      }),
      profilePayload()
    );
    renderProfile();
    expect(await screen.findByRole("button", { name: /change role/i })).toBeInTheDocument();
  });

  test.each([
    ["members", { role: 0, is_superuser: false }],
    ["reviewers", { role: 2, is_superuser: false }],
  ])("hides Change role from %s", async (_label, viewer) => {
    mockProfile(
      signedInAuth({ id: VIEWER_ID, organization: ORG_ID, ...viewer }),
      profilePayload()
    );
    renderProfile();
    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /change role/i })).not.toBeInTheDocument();
  });

  test("hides Change role from an admin in a different organisation", async () => {
    mockProfile(
      signedInAuth({
        id: VIEWER_ID,
        role: 1,
        is_superuser: false,
        organization: OTHER_ORG,
      }),
      profilePayload()
    );
    renderProfile();
    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /change role/i })).not.toBeInTheDocument();
  });

  test("admin can submit a new role for a member", async () => {
    const fetchMock = mockProfile(
      signedInAuth({ id: VIEWER_ID, role: 1, is_superuser: false, organization: ORG_ID }),
      profilePayload()
    );
    renderProfile();
    fireEvent.click(await screen.findByRole("button", { name: /change role/i }));
    fireEvent.change(screen.getByLabelText(/^role$/i), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /save role/i }));
    await waitFor(() => {
      const called = fetchMock.mock.calls.some(
        (call) =>
          String(call[0]).includes(`/api/change_user_role/${TARGET_ID}/2`) &&
          call[1]?.method === "PUT"
      );
      expect(called).toBe(true);
    });
  });
});
