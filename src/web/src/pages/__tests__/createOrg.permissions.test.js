import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import axios from "axios";
import CreateOrg from "../CreateOrg";

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const PERMISSION_DENIED = "You don't have the permission to access this page.";

function renderCreateOrg() {
  return render(
    <MemoryRouter>
      <CreateOrg />
    </MemoryRouter>
  );
}

describe("Create organisation access", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("shows the form to super users", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { id: "super-1", is_superuser: true },
    });
    renderCreateOrg();
    expect(
      await screen.findByRole("heading", { name: /create organisation/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(PERMISSION_DENIED)).not.toBeInTheDocument();
  });

  test.each([
    ["signed-in members", { status: 200, data: { is_superuser: false, role: 0 } }],
    ["admins", { status: 200, data: { is_superuser: false, role: 1 } }],
    ["reviewers", { status: 200, data: { is_superuser: false, role: 2 } }],
  ])("blocks %s with the permission message", async (_label, response) => {
    axios.get.mockResolvedValue(response);
    renderCreateOrg();
    expect(await screen.findByText(PERMISSION_DENIED)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /create organisation/i })
    ).not.toBeInTheDocument();
  });

  test("blocks signed-out visitors with the permission message", async () => {
    axios.get.mockRejectedValue({ response: { status: 401 } });
    renderCreateOrg();
    expect(await screen.findByText(PERMISSION_DENIED)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /create organisation/i })
    ).not.toBeInTheDocument();
  });
});
