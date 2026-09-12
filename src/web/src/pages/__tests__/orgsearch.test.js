import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import OrgSearch from "../OrgSearch";
import { useAuth } from "../../contexts/AuthContext";
import { jsonResponse, stubFetch, signedInAuth } from "../../testUtils";

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
});
