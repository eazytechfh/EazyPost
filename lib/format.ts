export function formatCurrency(value: number | string) {
  const numberValue = typeof value === "string" ? Number(value) : value;

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number.isFinite(numberValue) ? numberValue : 0);
}

export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function cleanCurrencyInput(value: string) {
  const [integerPart] = value.split(",");

  return onlyDigits(integerPart);
}

export function parseCurrencyInput(value: string) {
  const digits = cleanCurrencyInput(value);
  const numeric = Number(digits);

  return Number.isFinite(numeric) ? numeric : 0;
}
