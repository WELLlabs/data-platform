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

    expect(screen.getByLabelText(/file name for rain.csv/i)).toHaveValue("rain");
    expect(screen.getByText(".csv")).toBeInTheDocument();
    expect(screen.getByLabelText(/file name for notes.txt/i)).toHaveValue("notes");
    expect(screen.getAllByText(/temporal coverage from/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /remove file/i })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: /remove file/i })[0]);
    expect(screen.queryByLabelText(/file name for rain.csv/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/file name for notes.txt/i)).toBeInTheDocument();
  });
});
