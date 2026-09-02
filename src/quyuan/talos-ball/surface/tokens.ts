import type {
  OrbTheme,
  OrbThemeInput,
  OrbThemeName
} from "../semantics/types";

export const TALOS_COLORS = Object.freeze({
  cloudBlue: "#76B0FA",
  signalYellow: "#FAD861",
  deepInk: "#17191F",
  appleWhite: "#F5F5F7"
});

const themes: Readonly<Record<OrbThemeName, Readonly<OrbTheme>>> = {
  light: {
    name: "light",
    background: TALOS_COLORS.appleWhite,
    surface: TALOS_COLORS.appleWhite,
    ink: TALOS_COLORS.deepInk,
    cloudBlue: TALOS_COLORS.cloudBlue,
    signalYellow: TALOS_COLORS.signalYellow
  },
  dark: {
    name: "dark",
    background: TALOS_COLORS.deepInk,
    surface: TALOS_COLORS.appleWhite,
    ink: TALOS_COLORS.deepInk,
    cloudBlue: TALOS_COLORS.cloudBlue,
    signalYellow: TALOS_COLORS.signalYellow
  }
};

export function resolveTheme(input: OrbThemeInput = "light"): Readonly<OrbTheme> {
  return themes[input];
}

export function themeCssVariables(theme: Readonly<OrbTheme>): string {
  return [
    `--talos-orb-background:${theme.background}`,
    `--talos-orb-surface:${theme.surface}`,
    `--talos-orb-ink:${theme.ink}`,
    `--talos-orb-blue:${theme.cloudBlue}`,
    `--talos-orb-yellow:${theme.signalYellow}`
  ].join(";");
}
