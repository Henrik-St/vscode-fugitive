/**@type {import('eslint').Linter.Config} */
// eslint-disable-next-line no-undef
module.exports = {
    root: true,
    parser: "@typescript-eslint/parser",
    plugins: ["@typescript-eslint"],
    extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
    rules: {
        semi: [2, "always"],
        "@typescript-eslint/no-unused-vars": [
            1,
            {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                caughtErrorsIgnorePattern: "^_",
            },
        ],
        "@typescript-eslint/no-explicit-any": 1,
        "@typescript-eslint/explicit-module-boundary-types": 1,
        "@typescript-eslint/no-non-null-assertion": 0,
        "@typescript-eslint/naming-convention": [
            "warn",
            {
                selector: "variableLike",
                format: ["snake_case"],
                leadingUnderscore: "allow",
            },
            {
                selector: "classProperty",
                format: ["camelCase"],
            },
            {
                selector: "classMethod",
                format: ["camelCase"],
                leadingUnderscore: "allow",
            },
            {
                selector: "typeLike",
                format: ["PascalCase"],
            },
            {
                selector: "function",
                format: ["camelCase"],
                leadingUnderscore: "allow",
            },
            {
                selector: "typeProperty",
                format: ["camelCase"],
            },
            {
                selector: "enumMember",
                format: ["UPPER_CASE"],
            },
        ],
    },
    ignorePatterns: ["vscode-git.ts"],
};
