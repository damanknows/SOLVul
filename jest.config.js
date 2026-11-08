// jest.config.js
module.exports = {
  testEnvironment: "jsdom",
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
  },
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js", "@testing-library/jest-dom"],
  moduleNameMapper: {
    "^uuid$": require.resolve("uuid"),
  },
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["lcov", "text"],
};

