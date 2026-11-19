import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Organization from "../Organization";
import { useAuth } from "../../contexts/AuthContext";
import { jsonResponse, signedInAuth, stubFetch } from "../../testUtils";

jest.mock("../../contexts/AuthContext", () => ({
  useAuth: jest.fn(),
}));

const ORG_ID = "11111111-1111-4111-8111-111111111111";

function renderOrganization() {
  return render(
    <MemoryRouter initialEntries={[`/organisation?id=${ORG_ID}`]}>
      <Organization />
    </MemoryRouter>
  );
}

describe("Organization page permissions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.mockReturnValue(
      signedInAuth({ role: 1, is_superuser: true, organization: ORG_ID })
    );
    stubFetch({
      [`/api/organizations/${ORG_ID}`]: jsonResponse({
        id: ORG_ID,
        name: "WELL Labs",
        privileges: { edit: true },
        members: [
          {
            id: "member-1",
            full_name: "Ada Lovelace",
            email: "ada@example.com",
            role: 0,
            verified: true,
          },
        ],
      }),
    });
  });

  test("does not offer Create organization or Manage members", async () => {
    renderOrganization();
    expect(await screen.findByRole("heading", { name: "WELL Labs" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /create organization/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /manage members/i })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add member/i })).toBeInTheDocument();
  });
});
