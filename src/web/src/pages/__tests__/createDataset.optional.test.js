import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CreateDataset from "../CreateDataset";
import { useAuth } from "../../contexts/AuthContext";
import { jsonResponse, signedInAuth, stubFetch } from "../../testUtils";

jest.mock("../../contexts/AuthContext", () => ({
  useAuth: jest.fn(),
}));

describe("Publish dataset optional coverage fields", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.scrollTo = jest.fn();
    useAuth.mockReturnValue(signedInAuth());
    stubFetch({
      "/api/organizations/": jsonResponse({ private: false }),
      "/api/tags/suggest": jsonResponse({ suggestions: [] }),
      "/api/upload_job": jsonResponse({ job_id: "job-1" }),
    });
  });

  test("groundtruthed defaults to No and coverage fields are not required", async () => {
    render(
      <MemoryRouter>
        <CreateDataset />
      </MemoryRouter>
    );

    await screen.findByText(/dataset details/i);
    const title = screen.getAllByRole("textbox")[0];
    fireEvent.change(title, { target: { value: "Rainfall" } });
    const tagInput = screen.getByPlaceholderText(/search tags or add a custom tag/i);
    fireEvent.change(tagInput, { target: { value: "water" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /next: attribution/i }));

    const file = new File(["a,b"], "rain.csv", { type: "text/csv" });
    const input = await screen.findByLabelText(/add files/i);
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole("button", { name: /rain\.csv/i })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByText(/defaults to/i)).toBeInTheDocument();
    expect(screen.getAllByText(/\(optional\)/i).length).toBeGreaterThanOrEqual(3);
    const noButton = screen.getByRole("button", { name: /^no$/i });
    expect(noButton.className).toMatch(/\bon\b/);

    fireEvent.click(screen.getByRole("button", { name: /publish dataset/i }));

    await waitFor(() => {
      expect(screen.queryByText(/groundtruthed required/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/temporal coverage from required/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/temporal coverage to required/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/geographical extent required/i)).not.toBeInTheDocument();
    });
  });
});
