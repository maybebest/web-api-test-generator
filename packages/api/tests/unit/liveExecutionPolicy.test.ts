import { describe, expect, it } from "vitest";
import {
  assertLiveExecutionPolicy,
  assertMutatingExecutionPolicy,
} from "../../src/safety/liveExecutionPolicy.js";

const validLiveEnv = {
  API_ENVIRONMENT_CLASS: "staging",
  USER_ID: "test-user",
  BASE_URL: "https://api.staging.example.test",
  TRUSTED_API_ORIGINS:
    "https://identity.staging.example.test,https://api.staging.example.test",
};

describe("live execution machine policy", () => {
  it("accepts an exact HTTPS non-production target", () => {
    expect(assertLiveExecutionPolicy(validLiveEnv)).toEqual({
      baseOrigin: "https://api.staging.example.test",
      environmentClass: "staging",
    });
  });

  it("rejects production, HTTP, and non-exact origins", () => {
    expect(() =>
      assertLiveExecutionPolicy({
        ...validLiveEnv,
        API_ENVIRONMENT_CLASS: "production",
      }),
    ).toThrow(/Production is forbidden/);
    expect(() =>
      assertLiveExecutionPolicy({
        ...validLiveEnv,
        BASE_URL: "http://api.staging.example.test",
      }),
    ).toThrow(/must use HTTPS/);
    expect(() =>
      assertLiveExecutionPolicy({
        ...validLiveEnv,
        TRUSTED_API_ORIGINS: "https://api.staging.example.test/v1",
      }),
    ).toThrow(/must be exact origins/);
  });

  it("rejects an untrusted base origin and missing seeded identity", () => {
    expect(() =>
      assertLiveExecutionPolicy({
        ...validLiveEnv,
        TRUSTED_API_ORIGINS: "https://other.staging.example.test",
      }),
    ).toThrow(/must be explicitly listed/);
    expect(() =>
      assertLiveExecutionPolicy({ ...validLiveEnv, USER_ID: " " }),
    ).toThrow(/USER_ID is required/);
  });

  it("allows mutations only in a disposable scope", () => {
    expect(() =>
      assertMutatingExecutionPolicy({ API_MUTATION_SCOPE: "disposable" }),
    ).not.toThrow();
    expect(() =>
      assertMutatingExecutionPolicy({ API_MUTATION_SCOPE: "shared" }),
    ).toThrow(/must be disposable/);
  });
});
