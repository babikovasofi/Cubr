import { defineConfig } from "vite";

// Temporary: build the gate-spike page (spike.html) instead of index.html.
// Swap to the real index.html once the spike proves cubing/twisty under Vite.
export default defineConfig({
  // cubing (randomScrambleForEvent) runs the solver in an ESM module worker.
  // Vite's default prod worker output can mismatch the {type:"module"} the lib
  // instantiates with → "Module worker instantiation failed" at runtime (dev ok,
  // prod broken — same dev/prod asymmetry cubejs hit). Force ESM worker output.
  worker: { format: "es" },
  build: {
    rollupOptions: {
      input: "spike.html",
    },
  },
});
