import {defineConfig} from 'vitest/config';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // The real module is only available inside the extension host.
      vscode: path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'test/vscode-stub.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
