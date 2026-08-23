import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** Next 16 ships flat config natively — no FlatCompat shim needed. */
const config = [
  ...(Array.isArray(nextVitals) ? nextVitals : [nextVitals]),
  ...(Array.isArray(nextTs) ? nextTs : [nextTs]),
  {
    ignores: [".next/**", "node_modules/**", "fixtures/**", "next-env.d.ts"],
  },
];

export default config;
