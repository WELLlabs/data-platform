import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import OrgSearch from "../OrgSearch";
import { useAuth } from "../../contexts/AuthContext";
import { guestAuth, jsonResponse, stubFetch, signedInAuth } from "../../testUtils";

jest.mock("../../contexts/AuthContext", () => ({
  useAuth: jest.fn(),
}));

function renderOrgSearch() {
  return render(
    <MemoryRouter>
      <OrgSearch />
    </MemoryRouter>
  );
}

describe("Organization directory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.mockReturnValue(signedInAuth({ is_superuser: true }));
    stubFetch({
      "/api/organizations/list_organizations": jsonResponse({
        items: [
          { id: "org-well", name: "WELL Labs" },
          { id: "org-new", name: "New Research Lab", description: "Just created" },
        ],
      }),
    });
  });

  test("shows all organizations including newly created ones", async () => {
    renderOrgSearch();
    expect(await screen.findByText("WELL Labs")).toBeInTheDocument();
    expect(screen.getByText("New Research Lab")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /your organization/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create organization/i })).toBeInTheDocument();
  });

  test.each([
    ["guests", guestAuth],
    ["members", signedInAuth({ role: 0, is_superuser: false })],
    ["reviewers", signedInAuth({ role: 2, is_superuser: false })],
    ["admins", signedInAuth({ role: 1, is_superuser: false })],
  ])("hides Create organization from %s", async (_label, auth) => {
    useAuth.mockReturnValue(auth);
    renderOrgSearch();
    expect(await screen.findByText("WELL Labs")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /create organization/i })
    ).not.toBeInTheDocument();
  });
});
