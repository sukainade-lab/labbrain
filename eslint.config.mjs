import next from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...next,
  { ignores: [".next/**", "node_modules/**", "docs/**", "EO-Brain/**", "eo-brainstorming-foundry/**"] }
];

export default eslintConfig;
