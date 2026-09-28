import { render, screen } from "@testing-library/react";

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({ data: { items: [] } }),
    post: jest.fn(),
    isCancel: () => false,
  },
}));

import App from "./App";
import { jsonResponse, stubFetch } from "./testUtils";

beforeEach(() => {
  stubFetch({
    "/api/auth/me": jsonResponse({}, { ok: false, status: 401 }),
    "/api/branding": jsonResponse({ host_name: "" }),
    "/api/homepage_stats": jsonResponse({}),
    "/api/datasets": jsonResponse([]),
    "/api/organizations/list_organizations": jsonResponse({ items: [] }),
    "/api/auth/login-options": jsonResponse({ google_enabled: false }),
  });
});

test("renders the public home shell", async () => {
  render(<App />);
  expect(await screen.findByRole("link", { name: /^explore$/i })).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /data platform home/i }).length).toBeGreaterThan(0);
});
