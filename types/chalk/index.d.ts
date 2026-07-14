type ChalkColor = (s: string) => string;

declare const chalk: {
  magenta: ChalkColor;
  white: ChalkColor;
  red: ChalkColor;
  green: ChalkColor;
  blue: ChalkColor;
  stripColor: ChalkColor;
};

export = chalk;
