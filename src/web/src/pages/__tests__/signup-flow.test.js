import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SignUp from '../SignUp';
import SignupSuccess from '../SignupSuccess';

describe('Signup and SignupSuccess pages', () => {
  test('SignupSuccess shows fallback when no state', () => {
    render(
      <MemoryRouter initialEntries={["/signupsuccess"]}>
        <Routes>
          <Route path="/signupsuccess" element={<SignupSuccess />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText(/Navigation to this page is invalid/i)).toBeInTheDocument();
    expect(screen.getByText(/Sign Up/i).closest('a')).toHaveAttribute('href', '/signup');
  });

  test('SignupSuccess shows user info when state is present', () => {
    const state = { email: "test@example.com", fullName: "Test User" };
    // MemoryRouter does not support location state, so we mock useLocation
    jest.spyOn(require('react-router-dom'), 'useLocation').mockReturnValue({ state });
    render(
      <MemoryRouter initialEntries={["/signupsuccess"]}>
        <Routes>
          <Route path="/signupsuccess" element={<SignupSuccess />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText(/Hello Test User/i)).toBeInTheDocument();
    expect(screen.getByText(/test@example.com/i)).toBeInTheDocument();
    expect(screen.getByText(/Sign in/i).closest('a')).toHaveAttribute('href', '/signin');
  });

  test('SignUp renders and has submit button', () => {
    render(
      <MemoryRouter>
        <SignUp />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: /Sign Up/i })).toBeInTheDocument();
  });
});
