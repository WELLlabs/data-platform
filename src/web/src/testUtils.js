export function jsonResponse(data, { ok = true, status = 200 } = {}) {
  return Promise.resolve({
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: { get: () => "application/json" },
  });
}

export function makeDataset(index, overrides = {}) {
  return {
    dataset_id: `ds-${index}`,
    dataset_title: `Dataset ${index}`,
    dataset_description: `Description for dataset ${index}`,
    organization: overrides.organization ?? "11111111-1111-4111-8111-111111111111",
    organization_name: overrides.organization_name ?? "WELL Labs",
    availability: overrides.availability ?? 0,
    approved: overrides.approved ?? true,
    file_count: overrides.file_count ?? 2,
    downloads: overrides.downloads ?? index,
    created_at: "2026-01-01T00:00:00Z",
    creator_name: overrides.creator_name ?? "Ada Lovelace",
    tags: overrides.tags ?? ["water", "open-data"],
    ...overrides,
  };
}

export function makeDatasets(count, mapper) {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return mapper ? mapper(n) : makeDataset(n);
  });
}

export function stubFetch(routes) {
  global.fetch = jest.fn((input) => {
    const url = String(input);
    const match = Object.keys(routes).find((key) => url.includes(key));
    if (match) {
      const value = routes[match];
      return typeof value === "function" ? value(url, input) : value;
    }
    return jsonResponse({}, { ok: false, status: 404 });
  });
  return global.fetch;
}

export const guestAuth = {
  user: null,
  isAuthenticated: false,
  loading: false,
  signIn: jest.fn(),
  signOut: jest.fn(),
  verifyUser: jest.fn().mockResolvedValue(null),
};

export function signedInAuth(overrides = {}) {
  const user = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "tester@example.com",
    full_name: "Test User",
    is_verified: true,
    verified: true,
    profile_complete: true,
    organization: "11111111-1111-4111-8111-111111111111",
    designation: "Researcher",
    ...overrides,
  };
  return {
    user,
    isAuthenticated: true,
    loading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
    verifyUser: jest.fn().mockResolvedValue(user),
  };
}
