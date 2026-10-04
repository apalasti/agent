import { expect, it } from "vitest";
import { experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";

it("imports only public SDK surfaces and declared dependencies", async () => {
  const result = await experimental_scanPublicSdkOnly(new URL(".", import.meta.url).pathname, {
    // Frontend imports the host's React and shimmed packages plus the
    // vendored @/ alias; zod is a declared runtime dependency.
    allow: [
      /^react(-dom)?$/,
      /^react\//,
      /^sonner$/,
      /^@radix-ui\//,
      /^@\/(components|lib|hooks)\//,
      /^(clsx|tailwind-merge|class-variance-authority)$/,
      /^zod$/,
    ],
  });
  expect(result.violations).toEqual([]);
  expect(result.privateDependencies).toEqual([]);
});
