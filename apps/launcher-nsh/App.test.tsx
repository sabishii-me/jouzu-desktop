// The entry mounts and reaches the backend: the shell shows its name and the
// launcher state (or the backend's error) instead of staying on the loader.
import { expect, open, test } from "nsh/test";

test("shows the launcher shell", async () => {
  const app = await open("./App.tsx");
  expect(app.texts()).toContain("Jouzu Desktop");
});