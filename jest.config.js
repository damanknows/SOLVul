// jest.config.js
module.exports = {
  testEnvironment: "jsdom",
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
  },
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js", "@testing-library/jest-dom"],
  moduleNameMapper: {
    "^uuid$": "<rootDir>/__mocks__/uuid.js",
    "^@google/genai$": require.resolve("@google/genai"),
  },
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["lcov", "text"],
};

