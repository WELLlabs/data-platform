import React from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Datasets from "../Datasets";
import { useAuth } from "../../contexts/AuthContext";
import {
  guestAuth,
  jsonResponse,
  makeDataset,
  makeDatasets,
  signedInAuth,
  stubFetch,
} from "../../testUtils";

jest.mock("../../contexts/AuthContext", () => ({
  useAuth: jest.fn(),
}));

function pageFromUrl(url) {
  const query = url.split("?")[1] || "";
  const params = new URLSearchParams(query);
  const offset = Number(params.get("offset") || 0);
  const limit = Number(params.get("limit") || 10);
  return { offset, limit };
}

function renderDatasets() {
  return render(
    <MemoryRouter>
      <Datasets />
    </MemoryRouter>
  );
}

function stubDatasets({ page1 = [], page2 = [], orgs = { items: [] } } = {}) {
  return stubFetch({
    "/api/datasets": (url) => {
      const { offset } = pageFromUrl(url);
      return jsonResponse(offset === 0 ? page1 : page2);
    },
    "/api/organizations/list_organizations": jsonResponse(orgs),
  });
}

describe("Datasets module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.mockReturnValue({ ...guestAuth });
  });

  test("list view empty state when API returns no datasets", async () => {
    stubDatasets({ page1: [] });
    renderDatasets();
    expect(await screen.findByText(/no datasets match/i)).toBeInTheDocument();
    expect(screen.getByText(/page 1/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
    expect(document.querySelector(".rows")).not.toBeInTheDocument();
  });

  test("list view with fewer than 10 datasets does not enable next page", async () => {
    stubDatasets({
      page1: makeDatasets(3, (n) =>
        makeDataset(n, { organization_name: "WELL Labs" })
      ),
    });
    renderDatasets();
    expect(await screen.findByRole("heading", { name: "Dataset 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dataset 3" })).toBeInTheDocument();
    expect(document.querySelectorAll(".drow")).toHaveLength(3);
    expect(document.querySelector(".count").textContent).toMatch(/3\s*datasets/i);
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  test("list view with more than 10 datasets paginates", async () => {
    const page1 = makeDatasets(10, (n) => makeDataset(n, { organization_name: "WELL Labs" }));
    const page2 = makeDatasets(2, (n) =>
      makeDataset(n + 10, { organization_name: "WELL Labs" })
    );
    stubDatasets({ page1, page2 });
    renderDatasets();
    expect(await screen.findByRole("heading", { name: "Dataset 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dataset 10" })).toBeInTheDocument();
    expect(document.querySelectorAll(".drow")).toHaveLength(10);
    const next = screen.getByRole("button", { name: /next/i });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(await screen.findByRole("heading", { name: "Dataset 11" })).toBeInTheDocument();
    expect(screen.getByText(/page 2/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dataset 12" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dataset 1" })).not.toBeInTheDocument();
  });

  test("grid view empty state", async () => {
    stubDatasets({ page1: [] });
    renderDatasets();
    await screen.findByText(/no datasets match/i);
    fireEvent.click(screen.getByRole("button", { name: /grid view/i }));
    expect(screen.getByText(/no datasets match/i)).toBeInTheDocument();
    expect(document.querySelector(".explore-grid")).not.toBeInTheDocument();
  });

  test("grid view with fewer than 10 datasets", async () => {
    stubDatasets({
      page1: makeDatasets(4, (n) => makeDataset(n, { organization_name: "IFMR" })),
    });
    renderDatasets();
    await screen.findByRole("heading", { name: "Dataset 1" });
    fireEvent.click(screen.getByRole("button", { name: /grid view/i }));
    expect(document.querySelector(".explore-grid")).toBeInTheDocument();
    expect(document.querySelectorAll(".dcard")).toHaveLength(4);
    expect(document.querySelector(".rows")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  test("grid view with more than 10 datasets paginates", async () => {
    stubDatasets({
      page1: makeDatasets(10, (n) => makeDataset(n)),
      page2: [makeDataset(11, { dataset_title: "Dataset 11" })],
    });
    renderDatasets();
    await screen.findByRole("heading", { name: "Dataset 1" });
    fireEvent.click(screen.getByRole("button", { name: /grid view/i }));
    expect(document.querySelectorAll(".dcard")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByRole("heading", { name: "Dataset 11" })).toBeInTheDocument();
    expect(document.querySelectorAll(".dcard")).toHaveLength(1);
  });

  function multiOrgPage() {
    return [
      makeDataset(1, {
        organization_name: "WELL Labs",
        availability: 0,
        dataset_title: "Public WELL set",
      }),
      makeDataset(2, {
        organization_name: "IFMR",
        availability: 2,
        dataset_title: "Org IFMR set",
      }),
      makeDataset(3, {
        organization_name: "WELL Labs",
        availability: 1,
        dataset_title: "Private WELL set",
      }),
    ];
  }

  test("guest can filter by organization among multiple orgs", async () => {
    stubDatasets({ page1: multiOrgPage() });
    renderDatasets();
    expect(await screen.findByRole("heading", { name: "Public WELL set" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Org IFMR set" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Private WELL set" })).toBeInTheDocument();

    const orgGroup = Array.from(document.querySelectorAll(".filters .fgroup")).find((el) =>
      el.querySelector("h4")?.textContent?.includes("Organization")
    );
    fireEvent.click(within(orgGroup).getByRole("checkbox", { name: /ifmr/i }));
    expect(screen.getByRole("heading", { name: "Org IFMR set" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Public WELL set" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Private WELL set" })).not.toBeInTheDocument();
    expect(document.querySelector(".count").textContent).toMatch(/1\s*dataset/i);
  });

  test("guest can filter datasets by availability", async () => {
    stubDatasets({ page1: multiOrgPage() });
    renderDatasets();
    expect(await screen.findByRole("heading", { name: "Public WELL set" })).toBeInTheDocument();

    const availGroup = Array.from(document.querySelectorAll(".filters .fgroup")).find((el) =>
      el.querySelector("h4")?.textContent?.includes("Availability")
    );
    const privateBox = within(availGroup)
      .getAllByRole("checkbox")
      .find((el) => el.parentElement?.textContent?.trim() === "Private");
    fireEvent.click(privateBox);
    expect(screen.getByRole("heading", { name: "Private WELL set" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Public WELL set" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Org IFMR set" })).not.toBeInTheDocument();
  });

  test("signed-in users skip org/availability filters and can publish", async () => {
    useAuth.mockReturnValue(signedInAuth());
    stubDatasets({
      page1: [
        makeDataset(1, { organization_name: "WELL Labs", availability: 0 }),
        makeDataset(2, { organization_name: "IFMR", availability: 2 }),
      ],
    });
    renderDatasets();
    expect(await screen.findByRole("heading", { name: "Dataset 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dataset 2" })).toBeInTheDocument();
    expect(document.querySelector(".filters")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /publish a dataset/i })).toBeInTheDocument();
  });
});
