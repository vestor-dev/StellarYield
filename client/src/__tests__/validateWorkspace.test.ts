import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { execSync } from "child_process";
import {
  checkNodeVersion,
  checkRust,
  checkWorkspaceDependencies,
  checkEnvFiles,
  checkNetworkReachability,
  parseEnvFile,
} from "../../../scripts/validate-workspace.js";

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

describe("Workspace Validator Script Checks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("checkNodeVersion", () => {
    it("passes for Node >= 18", () => {
      const originalVersion = process.version;
      Object.defineProperty(process, "version", {
        value: "v18.15.0",
        writable: true,
      });

      const result = checkNodeVersion();
      expect(result.success).toBe(true);

      Object.defineProperty(process, "version", {
        value: "v20.2.0",
        writable: true,
      });
      const result2 = checkNodeVersion();
      expect(result2.success).toBe(true);

      // Restore
      Object.defineProperty(process, "version", {
        value: originalVersion,
        writable: true,
      });
    });

    it("fails for Node < 18", () => {
      const originalVersion = process.version;
      Object.defineProperty(process, "version", {
        value: "v16.14.0",
        writable: true,
      });

      const result = checkNodeVersion();
      expect(result.success).toBe(false);
      expect(result.message).toContain("Version >= 18 is required");

      // Restore
      Object.defineProperty(process, "version", {
        value: originalVersion,
        writable: true,
      });
    });
  });

  describe("checkRust", () => {
    it("passes when rustc and cargo versions are fetched successfully", () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from("rustc 1.70.0 (90c541806 2023-05-31)"));
      const result = checkRust();
      expect(result.success).toBe(true);
      expect(result.message).toContain("rustc");
    });

    it("fails when rustc or cargo are missing", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("command not found");
      });
      const result = checkRust();
      expect(result.success).toBe(false);
      expect(result.message).toContain("Rust or Cargo compiler not found");
    });
  });

  describe("checkWorkspaceDependencies", () => {
    it("passes when node_modules exists in all workspaces", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const result = checkWorkspaceDependencies();
      expect(result.success).toBe(true);
    });

    it("fails when any node_modules is missing", () => {
      // Mock existsSync to return false (missing dependencies)
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const result = checkWorkspaceDependencies();
      expect(result.success).toBe(false);
      expect(result.message).toContain("Dependencies are missing in");
    });
  });

  describe("checkEnvFiles", () => {
    it("passes when env files exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const result = checkEnvFiles();
      expect(result.success).toBe(true);
    });

    it("fails when client env.local or server env is missing", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const result = checkEnvFiles();
      expect(result.success).toBe(false);
      expect(result.message).toContain("missing");
    });
  });

  describe("parseEnvFile", () => {
    it("correctly parses key-value pairs", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        "VITE_API_BASE_URL=http://localhost:3001\n# Comment\nVITE_SOROBAN_RPC_URL=\"https://soroban-testnet.stellar.org\"\n"
      );

      const envs = parseEnvFile("test-path");
      expect(envs.VITE_API_BASE_URL).toBe("http://localhost:3001");
      expect(envs.VITE_SOROBAN_RPC_URL).toBe("https://soroban-testnet.stellar.org");
    });
  });
});
