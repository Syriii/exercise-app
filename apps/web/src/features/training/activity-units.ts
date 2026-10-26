// Drafts and APIs keep seconds/metres. Convert the entered decimal text without
// floating-point multiplication so, for example, 1.001 km stays exactly 1001 m.
function parts(value: string): { negative: boolean; whole: string; fraction: string } | null {
  let text = value.trim();
  if (/e/i.test(text) && Number.isFinite(Number(text))) text = String(Number(text));
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  return match && (match[2] || match[3]) ? { negative: match[1] === "-", whole: match[2] || "0", fraction: match[3] ?? "" } : null;
}
function decimalText(negative: boolean, digits: string, fractionLength: number): string {
  const padded = digits.padStart(fractionLength + 1, "0");
  const whole = padded.slice(0, padded.length - fractionLength).replace(/^0+(?=\d)/, "");
  const fraction = fractionLength ? padded.slice(-fractionLength).replace(/0+$/, "") : "";
  const result = whole + (fraction ? `.${fraction}` : "");
  return negative && result !== "0" ? `-${result}` : result;
}
export function shiftActivityDecimal(value: string, places: number): string | null {
  if (!value.trim()) return "";
  const source = parts(value);
  if (!source) return null;
  const digits = source.whole + source.fraction;
  const fractionLength = source.fraction.length - places;
  return decimalText(source.negative, fractionLength < 0 ? digits + "0".repeat(-fractionLength) : digits, Math.max(0, fractionLength));
}
export function minutesToSeconds(value: string): string | null {
  if (!value.trim()) return "";
  const source = parts(value);
  if (!source) return null;
  const digits = (BigInt(source.whole + source.fraction) * 60n).toString();
  return decimalText(source.negative, digits, source.fraction.length);
}
