import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import axios from "axios";
import SignUp from "../SignUp";
import SignupSuccess from "../SignupSuccess";
import { jsonResponse, stubFetch } from "../../testUtils";

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    isCancel: jest.fn(() => false),
  },
}));

const ORGS = {
  items: [
    { id: "org-well", name: "WELL Labs" },
    { id: "org-ifmr", name: "IFMR" },
  ],
};

function renderSignUp() {
  return render(
    <MemoryRouter initialEntries={["/signup"]}>
      <Routes>
        <Route path="/signup" element={<SignUp />} />
        <Route
          path="/signupsuccess"
          element={<div data-testid="signup-success">Signup success</div>}
        />
        <Route path="/signin" element={<div>Sign in page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

async function fillValidForm({
  email = "new.user@example.com",
  organization = "org-well",
} = {}) {
  fireEvent.change(screen.getByLabelText(/full name/i), {
    target: { value: "Ada Lovelace" },
  });
  fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^password/i), {
    target: { value: "password1" },
  });
  fireEvent.change(screen.getByLabelText(/confirm password/i), {
    target: { value: "password1" },
  });
  fireEvent.change(screen.getByLabelText(/organization/i), {
    target: { value: organization },
  });
}

describe("SignUp module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.get.mockResolvedValue({ data: ORGS });
    axios.post.mockResolvedValue({
      status: 201,
      data: { email: "new.user@example.com", full_name: "Ada Lovelace" },
    });
    stubFetch({
      "/api/auth/login-options": jsonResponse({
        google_enabled: false,
        allowed_email_domain: null,
      }),
    });
  });

  test("loads organizations into the select", async () => {
    renderSignUp();
    expect(await screen.findByRole("option", { name: "WELL Labs" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "IFMR" })).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith(
      "/api/organizations/list_organizations",
      expect.objectContaining({ withCredentials: true })
    );
  });

  test("keeps submit disabled until required fields are valid", async () => {
    renderSignUp();
    const submit = await screen.findByRole("button", { name: /create account/i });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "Ada" },
    });
    fireEvent.change(screen.getByLabelText(/^email/i), {
      target: { value: "not-an-email" },
    });
    expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
    expect(submit).toBeDisabled();
  });

  test("shows password mismatch and short-password errors", async () => {
    renderSignUp();
    fireEvent.change(await screen.findByLabelText(/^password/i), {
      target: { value: "short" },
    });
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^password/i), {
      target: { value: "password1" },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "password2" },
    });
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
  });

  test("posts signup payload and navigates on success", async () => {
    renderSignUp();
    await screen.findByRole("option", { name: "WELL Labs" });
    await fillValidForm();
    const submit = screen.getByRole("button", { name: /create account/i });
    expect(submit).toBeEnabled();
    fireEvent.submit(submit.closest("form"));
    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith(
        "/api/auth/signup",
        expect.objectContaining({
          email: "new.user@example.com",
          full_name: "Ada Lovelace",
          organization: "org-well",
          role: 0,
        }),
        expect.objectContaining({ withCredentials: true })
      )
    );
    expect(await screen.findByTestId("signup-success")).toBeInTheDocument();
  });

  test("shows API error detail on failed signup", async () => {
    axios.post.mockRejectedValue({
      response: { data: { detail: "Email already registered" } },
    });
    renderSignUp();
    await screen.findByRole("option", { name: "WELL Labs" });
    await fillValidForm({ email: "taken@example.com" });
    fireEvent.submit(screen.getByRole("button", { name: /create account/i }).closest("form"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/email already registered/i);
  });

  test("blocks submit for an email outside the configured domains", async () => {
    stubFetch({
      "/api/auth/login-options": jsonResponse({
        google_enabled: false,
        allowed_email_domains: ["welllabs.org", "ifmr.ac.in"],
      }),
    });
    renderSignUp();
    await screen.findByRole("option", { name: "WELL Labs" });
    await fillValidForm({ email: "ada@gmail.com" });
    expect(screen.getByText(/allowed domain/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account/i })).toBeDisabled();
  });

  test("SignupSuccess shows fallback without location state", () => {
    render(
      <MemoryRouter initialEntries={["/signupsuccess"]}>
        <Routes>
          <Route path="/signupsuccess" element={<SignupSuccess />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText(/navigation to this page is invalid/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign up/i })).toHaveAttribute("href", "/signup");
  });
});
