import { expect, test } from "vitest";
import { CAPACITY_MESSAGE, humanizeRuntimeError, isCapacityError } from "./runtime-errors";

test("the flow capacity error becomes an instruction the user can follow", () => {
  const raw = "Error: Submission retention limit reached; admission is held.";
  expect(isCapacityError(raw)).toBe(true);
  expect(humanizeRuntimeError(raw)).toBe(CAPACITY_MESSAGE);
  expect(humanizeRuntimeError(raw)).not.toMatch(/retention|admission|submission/i);
});

test("other runtime errors are not rewritten", () => {
  const raw = "Error: Runtime exited (1); unfinished work was not replayed";
  expect(isCapacityError(raw)).toBe(false);
  expect(humanizeRuntimeError(raw)).toBe(raw);
  expect(isCapacityError(null)).toBe(false);
  expect(isCapacityError("")).toBe(false);
});
