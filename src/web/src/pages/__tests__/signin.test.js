import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SignIn from "../SignIn";
import { useAuth } from "../../contexts/AuthContext";
import { guestAuth, jsonResponse, signedInAuth, stubFetch } from "../../testUtils";

jest.mock("../../contexts/AuthContext", () => ({
  useAuth: jest.fn(),
}));

function renderSignIn(path = "/signin") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/dashboard" element={<div>Dashboard landing</div>} />
        <Route path="/complete-profile" element={<div>Complete profile</div>} />
        <Route path="/signup" element={<div>Sign up page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("SignIn module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.mockReturnValue({ ...guestAuth, signIn: jest.fn() });
    stubFetch({
      "/api/auth/login-options": jsonResponse({
        google_enabled: false,
        allowed_email_domain: null,
      }),
    });
  });

  test("renders email/password form and signup link", async () => {
    renderSignIn();
    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create an account/i })).toHaveAttribute(
      "href",
      "/signup"
    );
    expect(screen.queryByText(/sign in with google/i)).not.toBeInTheDocument();
  });

  test("shows Google sign-in when login-options enables it", async () => {
    stubFetch({
      "/api/auth/login-options": jsonResponse({
        google_enabled: true,
        allowed_email_domain: "ifmr.ac.in",
      }),
    });
    renderSignIn();
    expect(await screen.findByRole("link", { name: /sign in with google/i })).toHaveAttribute(
      "href",
      "/api/auth/google"
    );
  });

  test("redirects authenticated users to dashboard", async () => {
    useAuth.mockReturnValue(signedInAuth());
    renderSignIn();
    expect(await screen.findByText(/dashboard landing/i)).toBeInTheDocument();
  });

  test("redirects users with incomplete profile", async () => {
    useAuth.mockReturnValue(signedInAuth({ profile_complete: false }));
    renderSignIn();
    expect(await screen.findByText(/complete profile/i)).toBeInTheDocument();
  });

  test("shows credential error on failed sign-in", async () => {
    const signIn = jest.fn();
    useAuth.mockReturnValue({ ...guestAuth, signIn });
    stubFetch({
      "/api/auth/login-options": jsonResponse({ google_enabled: false }),
      "/api/auth/signin": jsonResponse({ detail: "Invalid" }, { ok: false, status: 401 }),
    });
    renderSignIn();
    fireEvent.change(await screen.findByLabelText(/^email$/i), {
      target: { value: "bad@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "wrongpass" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /^sign in$/i }).closest("form"));
    expect(
      await screen.findByRole("alert")
    ).toHaveTextContent(/sign in failed/i);
    expect(signIn).not.toHaveBeenCalled();
  });

  test("calls signIn with API user payload on success", async () => {
    const signIn = jest.fn();
    const userData = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "ok@example.com",
      profile_complete: true,
    };
    useAuth.mockReturnValue({ ...guestAuth, signIn });
    stubFetch({
      "/api/auth/login-options": jsonResponse({ google_enabled: false }),
      "/api/auth/signin": jsonResponse(userData),
    });
    renderSignIn();
    fireEvent.change(await screen.findByLabelText(/^email$/i), {
      target: { value: "ok@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "correct-horse" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /^sign in$/i }).closest("form"));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith(userData));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/signin",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
  });
});
