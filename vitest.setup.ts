import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Shared mock router so tests can inspect calls
export const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  prefetch: vi.fn(),
};

// Mock next/navigation for all tests
vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  useParams: () => ({}),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
