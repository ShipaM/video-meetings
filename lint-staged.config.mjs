export default {
  'apps/api/**/*.ts': (files) => [
    `npm exec --workspace=api -- eslint --fix ${files.map((f) => `"${f}"`).join(' ')}`,
    `prettier --write ${files.map((f) => `"${f}"`).join(' ')}`,
  ],
  'apps/web/**/*.{js,jsx,mjs,ts,tsx}': (files) => [
    `npm exec --workspace=web -- eslint --fix ${files.map((f) => `"${f}"`).join(' ')}`,
    `prettier --write ${files.map((f) => `"${f}"`).join(' ')}`,
  ],
  '!(apps/**)*.{js,mjs,json,md,yml,yaml,css}': 'prettier --write',
  'apps/**/*.{json,md,css}': 'prettier --write',
};
