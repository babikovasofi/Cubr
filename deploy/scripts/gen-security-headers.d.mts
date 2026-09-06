// Types for the generator so frontend/tests/security/headers.test.ts can import
// `render` under the app's `strict` tsconfig (the script itself stays plain JS —
// it runs from a bare `node`, with no build step, on a server that has no
// TypeScript toolchain).
export interface SecurityHeaderSpec {
  removeHeaders?: string[];
  common: Record<string, string>;
  httpsOnly: Record<string, string>;
}

export function render(spec: SecurityHeaderSpec): string;
