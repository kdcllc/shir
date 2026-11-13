// Logical-only CSS: physical left/right properties and values are banned (rule B8).

// One value token: a run of non-space, non-paren, non-slash characters or balanced
// one-level ( ... ) groups, so `calc(1px + 2px)` counts as ONE token.
const T = String.raw`(?:[^\s()/]|\([^()]*\))+`;
const FOUR_TOKENS = new RegExp(`^${T}\\s+${T}\\s+${T}\\s+${T}$`);
const RADIUS_BEFORE_SLASH = new RegExp(`^${T}\\s+${T}`);
const RADIUS_AFTER_SLASH = new RegExp(`\\/\\s*${T}\\s+${T}`);

/** @type {import("stylelint").Config} */
export default {
  extends: ["stylelint-config-standard", "stylelint-config-css-modules"],
  plugins: ["stylelint-use-logical"],
  ignoreFiles: [
    "**/dist/**",
    "**/target/**",
    "**/node_modules/**",
    ".agents/**",
    ".claude/**",
    "_memory/**",
  ],
  rules: {
    // Only left/right-bearing properties are reported; block-axis and size properties stay allowed.
    "csstools/use-logical": [
      "always",
      {
        except: [
          "top",
          "bottom",
          "width",
          "height",
          "min-width",
          "max-width",
          "min-height",
          "max-height",
          "margin-top",
          "margin-bottom",
          "padding-top",
          "padding-bottom",
          "border-top",
          "border-bottom",
          "border-top-width",
          "border-bottom-width",
          "border-top-style",
          "border-bottom-style",
          "border-top-color",
          "border-bottom-color",
          "overflow-x",
          "overflow-y",
        ],
      },
    ],
    "property-disallowed-list": [
      [
        "left",
        "right",
        "/^(margin|padding|border)-(left|right)/",
        "/^border-(top|bottom)-(left|right)-radius$/",
        "/^scroll-(margin|padding)-(left|right)$/",
      ],
      { severity: "error" },
    ],
    "declaration-property-value-disallowed-list": [
      {
        "text-align": [/^(left|right)$/],
        float: [/^(left|right)$/],
        clear: [/^(left|right)$/],
        margin: [FOUR_TOKENS],
        padding: [FOUR_TOKENS],
        inset: [FOUR_TOKENS],
        "scroll-margin": [FOUR_TOKENS],
        "scroll-padding": [FOUR_TOKENS],
        "border-width": [FOUR_TOKENS],
        "border-style": [FOUR_TOKENS],
        "border-color": [FOUR_TOKENS],
        "border-radius": [RADIUS_BEFORE_SLASH, RADIUS_AFTER_SLASH],
      },
      { severity: "error" },
    ],
  },
};
