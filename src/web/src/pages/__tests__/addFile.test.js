import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AddFile from "../AddFile";
import { useAuth } from "../../contexts/AuthContext";
import { signedInAuth } from "../../testUtils";

jest.mock("../../contexts/AuthContext", () => ({
  useAuth: jest.fn(),
}));

describe("Add file page", () => {
  beforeEach(() => {
    useAuth.mockReturnValue(signedInAuth());
  });

  test("opens per-file metadata and a remove control for each selected file", async () => {
    render(
      <MemoryRouter initialEntries={["/add-file?dataset_id=ds-1"]}>
        <AddFile />
      </MemoryRouter>
    );
    const input = await screen.findByLabelText(/add files/i);
    const first = new File(["a"], "rain.csv", { type: "text/csv" });
    const second = new File(["b"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [first, second] } });

    expect(screen.queryByLabelText(/file name for/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^File name/i)).not.toBeInTheDocument();
    const rainTitle = screen.getByLabelText(/file title for rain.csv/i, { hidden: true });
    const notesTitle = screen.getByLabelText(/file title for notes.txt/i, { hidden: true });
    expect(rainTitle).toHaveValue("rain.csv");
    expect(rainTitle).toHaveAttribute("readonly");
    expect(rainTitle).not.toBeVisible();
    expect(notesTitle).toHaveValue("notes.txt");
    expect(notesTitle).not.toBeVisible();
    expect(screen.getAllByText(/temporal coverage from/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /remove file/i })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: /remove file/i })[0]);
    expect(screen.queryByLabelText(/file title for rain.csv/i, { hidden: true })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/file title for notes.txt/i, { hidden: true })).toBeInTheDocument();
  });
});
